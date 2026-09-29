-- F11, M2: the accept step (docs/f11-plan.md, §2; owner's word 2026-09-28).
--
-- A cleaner says "I am taking it" with one tap. Until now nothing wrote
-- 'accepted': the status was in the enum and the generator already handled it
-- (20260926160000), but guard_task_transitions() refused the move to an
-- executor. What changes:
--
-- - guard_task_transitions: an executor may go assigned -> accepted and
--   accepted -> in_progress, under the same start window as ever; and
--   unassigned -> accepted, which is taking free work (below). Accepting is a
--   signal, not a lock: assigned -> in_progress stays, so a cleaner who forgot
--   to tap still starts at the door. A replay of the tap writes the same status
--   and the guard lets an unchanged status through, as it always has. A take
--   that writes only her name, leaving 'unassigned', is refused: the trigger
--   now wakes for assignee_id too.
--
-- - the claim policy: taking a free cleaning from the queue is accepting it
--   (owner's word 5c). What lets a take write 'accepted' is the guard above
--   (unassigned -> accepted). The policy's WITH CHECK lists 'accepted' beside
--   'assigned' only to name what a take writes: permissive UPDATE checks are
--   OR'ed, and 'assignee updates own tasks' admits any row of hers, so the
--   list refuses nothing ('assigned' is what a phone without the update
--   writes). What the policy does decide is its USING: only a cleaning can be
--   taken. Until now it let a cleaner take a free inspection or maintenance
--   on her listing, which the phone's queue and the push about free work (M3)
--   both leave to the office.
--
-- - save_task and assign_problem: 'accepted' means accepted by THIS person for
--   THIS day and flat. When the office hands the job to someone else, or moves
--   it to another day, flat or kind of job, nobody has accepted the new state,
--   and the status goes back to 'assigned' — as the generator already does when
--   a booking moves its cleaning (20260927120000, the moved pass). An edit that
--   changes neither keeps 'accepted'.
--
-- - set_property_status, property_open_cleanings, open_cleanings_by_listing:
--   taking a listing out of service cancels accepted cleanings too (owner's
--   word 5b). Until now 'accepted' counted as started, which cost nothing while
--   nothing wrote it; with the button nearly every handed-out cleaning is
--   accepted, and archiving would leave them all standing. The three places
--   change together, as 20260924170000 requires; the push that tells her comes
--   with M3.
--
-- Bodies are copied from their latest migrations (guard 20260908120000,
-- save_task 20260927120000, assign_problem 20260923130000, the three archive
-- functions 20260924170000) with only the changes above. Same signatures, so
-- the ACLs and the generated types stay as they are. No table changes; the
-- policy swap takes a brief lock on tasks.

set local lock_timeout = '3s';

-- ---------- the executor's moves ----------

create or replace function public.guard_task_transitions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_running   integer;
  v_allowed   boolean;
  v_remaining integer;
  v_opens_at  timestamptz;
  v_timezone  text;
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  -- A take says so: an executor who puts her name on free work moves it out
  -- of 'unassigned'. Her name on a row left 'unassigned' would make it neither
  -- free (gone from the queue) nor hers (nothing says she took it) — night
  -- review 2026-09-29. The trigger wakes for assignee_id too, for this.
  if new.status = 'unassigned'
     and new.assignee_id is distinct from old.assignee_id
     and not public.is_manager() then
    raise exception 'An executor takes free work by moving it out of unassigned'
      using errcode = 'check_violation',
            hint = 'serverErrors.transitionNotAllowed',
            detail = jsonb_build_object('from', old.status, 'to', new.status)::text;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not public.is_manager()
     and not (
       (old.status = 'unassigned'  and new.status in ('assigned', 'accepted')) or
       (old.status = 'assigned'    and new.status in ('accepted', 'in_progress')) or
       (old.status = 'accepted'    and new.status = 'in_progress') or
       (old.status = 'in_progress' and new.status = 'done')
     ) then
    raise exception 'Move % -> % is not available to an executor', old.status, new.status
      using errcode = 'check_violation',
            hint = 'serverErrors.transitionNotAllowed',
            detail = jsonb_build_object('from', old.status, 'to', new.status)::text;
  end if;

  if new.status = 'in_progress' then
    if not public.is_manager() then
      v_opens_at := public.task_start_not_before(new.property_id, new.scheduled_date, new.time_from);

      if now() < v_opens_at then
        select p.timezone into v_timezone from public.properties p where p.id = new.property_id;

        raise exception 'Cleaning cannot start before %', v_opens_at
          using errcode = 'check_violation',
                hint = 'serverErrors.startTooEarly',
                detail = jsonb_build_object(
                  'date', to_char(v_opens_at at time zone v_timezone, 'YYYY-MM-DD'),
                  'time', to_char(v_opens_at at time zone v_timezone, 'HH24:MI')
                )::text;
      end if;
    end if;

    new.started_at := coalesce(old.started_at, now());

    select count(*) into v_running
    from public.tasks t
    where t.assignee_id = new.assignee_id
      and t.status = 'in_progress'
      and t.id <> new.id;

    if v_running > 0 then
      select h.parallel_start_allowed into v_allowed
      from public.hosts h where h.id = new.host_id;

      if not coalesce(v_allowed, true) then
        raise exception 'Parallel start is off: finish the running cleaning first'
          using errcode = 'check_violation',
                hint = 'serverErrors.parallelStartOff';
      end if;

      -- Both sides of the overlap are marked: the one starting now and every
      -- one still running. Overlap is symmetric, and the later start is the
      -- only moment at which it is certain to be visible.
      new.is_parallel := true;

      update public.tasks t
      set is_parallel = true
      where t.assignee_id = new.assignee_id
        and t.status = 'in_progress'
        and t.id <> new.id
        and not t.is_parallel;
    end if;
  end if;

  if new.status = 'done' then
    -- The gate. Required steps neither completed nor waived hold the finish;
    -- the count travels in `detail` because it is the one number the cleaner
    -- needs. Managers pass: releasing a task by hand is their call.
    if not public.is_manager() then
      select count(*) into v_remaining
      from public.task_steps s
      where s.task_id = new.id
        and s.required
        and s.completed_at is null
        and s.waived_at is null;

      if v_remaining > 0 then
        raise exception 'Required steps are still open: %', v_remaining
          using errcode = 'check_violation',
                hint = 'serverErrors.requiredStepsLeft',
                detail = jsonb_build_object('count', v_remaining)::text;
      end if;
    end if;

    new.completed_at := coalesce(old.completed_at, now());
    new.completed_by := coalesce(new.completed_by, (select auth.uid()));
  end if;

  return new;
end;
$$;

-- The guard wakes for a change of the person as well as of the status: a take
-- that writes only the name must meet the rule above (night review
-- 2026-09-29). Until now it woke for the status alone (20260905100000).
create or replace trigger tasks_guard_transitions
  before update of status, assignee_id on public.tasks
  for each row execute function public.guard_task_transitions();

-- ---------- taking free work ----------

drop policy "cleaner claims a free task on her listings" on public.tasks;
create policy "cleaner claims a free task on her listings"
  on public.tasks for update
  to authenticated
  using (assignee_id is null
         and status = 'unassigned'
         -- What the queue offers (apps/mobile tasks/api.ts, FREE_TASK_TYPES)
         -- and the push about free work announces: an inspection or a
         -- maintenance is the office's to hand out. Here and not in WITH CHECK:
         -- the check of the policy on her own tasks would admit the new row
         -- anyway, and the old row is the one that must be free work.
         and type in ('cleaning', 'midstay')
         and host_id = public.current_host_id()
         and not public.task_is_stale(property_id, scheduled_date)
         and not public.task_is_beyond_horizon(property_id, scheduled_date)
         and public.cleans_property(property_id)
         and public.is_active_user())
  with check (assignee_id = (select auth.uid())
              -- Refuses nothing on its own (OR'ed with 'assignee updates own
              -- tasks'): it names what a take writes — 'accepted' since
              -- 20260928110000, 'assigned' from a phone without the update.
              -- The guard decides the status.
              and status in ('assigned', 'accepted')
              and host_id = public.current_host_id());

-- ---------- the office's form ----------

create or replace function public.save_task(
  p_id              uuid,
  p_property_id     bigint,
  p_type            public.task_type,
  p_scheduled_date  date,
  p_title           text default null,
  -- Null, not '{}': the default is what an omitted argument means, and an
  -- omitted argument here says nothing about the translations rather than
  -- asking for them to be emptied.
  p_title_i18n      jsonb default null,
  p_assignee_id     uuid default null,
  p_time_from       time default null,
  p_time_to         time default null,
  p_notes           text default null,
  p_priority        integer default null,
  p_allow_duplicate boolean default false,
  -- The day the form was opened with. A booking may move its cleaning while
  -- the form is open, and the day the form then sends is not a manager's
  -- move but a stale one; with a move now holding (20260926160000) it would
  -- stay. Null — a caller that does not send it, the panel before this
  -- migration — says nothing: nothing is checked, and no move is recorded;
  -- the booking takes its cleaning back on the next run, as before.
  p_expected_date   date default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host      uuid := public.current_host_id();
  v_task      public.tasks;
  v_title     text := nullif(btrim(coalesce(p_title, '')), '');
  v_property  bigint := p_property_id;
  v_type      public.task_type := p_type;
  v_status    public.task_status;
  v_arrival          date;
  v_departure        date;
  v_pinned_arrival   date;
  v_pinned_departure date;
  v_pinned_rooms     bigint[];
  v_booking_cleaning boolean := false;
  v_moves            boolean := false;
  v_priority         smallint;
  v_due_at           timestamptz;
  v_guests           smallint;
  v_window_from      time;
  v_window_to        time;
  v_lands            boolean;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select t.* into v_task
  from public.tasks t
  where t.id = p_id and t.host_id = v_host
  for update;

  if found then
    if v_task.status in ('done', 'cancelled', 'expired') then
      raise exception 'Task is % and can no longer be edited', v_task.status
        using errcode = 'check_violation',
              hint = 'serverErrors.taskClosed',
              detail = jsonb_build_object('status', v_task.status)::text;
    end if;
    -- A save that lands on the day the task already stands on is no stale
    -- form: the replay of a move whose answer was lost, most often
    -- (20260927120000).
    if p_expected_date is not null
       and p_expected_date is distinct from v_task.scheduled_date
       and p_scheduled_date is distinct from v_task.scheduled_date then
      raise exception 'Task % was moved to % while the form was open', p_id, v_task.scheduled_date
        using errcode = 'check_violation',
              hint = 'serverErrors.taskMovedMeanwhile',
              detail = jsonb_build_object('date', v_task.scheduled_date)::text;
    end if;
    -- A generated task keeps the flat and the kind it was generated with.
    if v_task.reservation_id is not null or v_task.problem_id is not null then
      v_property := v_task.property_id;
      v_type     := v_task.type;
    end if;
  end if;

  -- No title is a title: the app calls the task by its type.
  if length(v_title) > public.task_title_max_length() then
    raise exception 'The title is longer than % characters', public.task_title_max_length()
      using errcode = 'check_violation',
            hint = 'serverErrors.taskTitleTooLong',
            detail = jsonb_build_object('limit', public.task_title_max_length())::text;
  end if;
  if p_title_i18n is not null and not public.is_localized_text(p_title_i18n) then
    raise exception 'Translations must be an object of language code to text'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.translationsInvalid';
  end if;
  if v_property is null
     or not exists (select 1 from public.properties pr
                    where pr.id = v_property and pr.host_id = v_host) then
    raise exception 'Listing % is not in this company', v_property
      using errcode = 'check_violation', hint = 'serverErrors.propertyNotFound';
  end if;
  if p_scheduled_date is null then
    raise exception 'A task needs a day'
      using errcode = 'check_violation', hint = 'serverErrors.taskDateRequired';
  end if;
  if p_assignee_id is not null
     and not exists (select 1 from public.profiles pr
                     where pr.id = p_assignee_id and pr.host_id = v_host and pr.is_active) then
    raise exception 'Assignee is not an active member of this company'
      using errcode = 'check_violation', hint = 'serverErrors.taskAssigneeInvalid';
  end if;

  -- Both questions below are asked when a task lands on a flat and a day —
  -- created, or moved there, or turned into another kind of job — and not
  -- again on every later edit of a pair the manager has already confirmed
  -- (20260926160000; before, the first one was asked on every save).
  v_lands := v_task.id is null
             or p_scheduled_date is distinct from v_task.scheduled_date
             or v_property is distinct from v_task.property_id
             or v_type is distinct from v_task.type;

  -- The same kind of job, on the same flat, on the same day. A job from a
  -- booking or from a report is not one of these — it was not written by
  -- hand — and a cancelled or expired one is out of the way by definition.
  if not coalesce(p_allow_duplicate, false)
     and v_lands
     and exists (select 1 from public.tasks t
                 where t.host_id = v_host
                   and t.property_id = v_property
                   and t.type = v_type
                   and t.scheduled_date = p_scheduled_date
                   and t.reservation_id is null
                   and t.problem_id is null
                   and t.status not in ('cancelled', 'expired')
                   and t.id <> p_id) then
    raise exception 'A % task for listing % on % already exists',
      v_type, v_property, p_scheduled_date
      using errcode = 'check_violation',
            hint = 'serverErrors.taskDuplicate',
            detail = jsonb_build_object('type', v_type, 'date', p_scheduled_date)::text;
  end if;

  -- A booking's cleaning on the same flat and day is the same question
  -- (20260926160000): the flat is already being cleaned.
  if not coalesce(p_allow_duplicate, false)
     and v_lands
     and v_type = 'cleaning'
     and exists (select 1 from public.tasks t
                 where t.host_id = v_host
                   and t.property_id = v_property
                   and t.type = 'cleaning'
                   and t.scheduled_date = p_scheduled_date
                   and t.reservation_id is not null
                   and t.status not in ('cancelled', 'expired')
                   and t.id <> p_id) then
    raise exception 'A cleaning for listing % on % already exists',
      v_property, p_scheduled_date
      using errcode = 'check_violation',
            hint = 'serverErrors.taskDuplicate',
            detail = jsonb_build_object('type', 'cleaning', 'date', p_scheduled_date)::text;
  end if;

  -- A booking's cleaning moved off its departure day holds there while the
  -- booking keeps the dates and the rooms it had at the move (the rooms since
  -- 20260927120000); moved back onto the departure, it follows the booking
  -- again. An edit that says nothing new about the day keeps what was. A move
  -- brings what the phone says about the next check-in to the new day
  -- (option B, 20260926160000), and the window with it: the window of a
  -- booking's cleaning is the server's, moved or not, as the generator writes
  -- it for every unmoved one nobody has started — so a save that keeps the day
  -- keeps the window, whatever times it sends and whatever the status
  -- (20260927120000).
  v_pinned_arrival   := v_task.pinned_arrival;
  v_pinned_departure := v_task.pinned_departure;
  v_pinned_rooms     := v_task.pinned_rooms;
  if v_task.reservation_id is not null and v_task.type = 'cleaning' then
    v_booking_cleaning := true;
    select r.arrival_date, r.departure_date into v_arrival, v_departure
    from public.reservations r
    where r.id = v_task.reservation_id;

    v_moves := p_expected_date is not null
               and p_scheduled_date is distinct from v_task.scheduled_date;
    if p_expected_date is null then
      null;  -- the old panel: no word on a move either way
    elsif p_scheduled_date = v_departure then
      v_pinned_arrival   := null;
      v_pinned_departure := null;
      v_pinned_rooms     := null;
    elsif v_moves then
      v_pinned_arrival   := v_arrival;
      v_pinned_departure := v_departure;
      v_pinned_rooms     := public.reservation_rooms(v_task.reservation_id);
    end if;

    if v_moves then
      select f.priority, f.due_at, f.guests_count, f.window_from, f.window_to
        into v_priority, v_due_at, v_guests, v_window_from, v_window_to
      from public.cleaning_turnover_on(v_task.reservation_id, v_task.property_id,
                                       p_scheduled_date) f;
    end if;
  end if;

  -- Handing the job out moves it out of the queue; taking the executor away
  -- puts it back, but only while nobody has started. A task already in
  -- progress keeps its status: the work happened, whatever the roster says.
  v_status := case
    when v_task.id is null then
      case when p_assignee_id is null then 'unassigned'::public.task_status
           else 'assigned'::public.task_status end
    when p_assignee_id is null and v_task.status in ('unassigned', 'assigned', 'accepted')
      then 'unassigned'::public.task_status
    when p_assignee_id is not null and v_task.status = 'unassigned'
      then 'assigned'::public.task_status
    -- What she accepted was this job, for her, on this day and flat
    -- (20260928110000). Another person, day, flat or kind of job has
    -- been accepted by nobody yet.
    when v_task.status = 'accepted'
         and (p_assignee_id is distinct from v_task.assignee_id or v_lands)
      then 'assigned'::public.task_status
    else v_task.status
  end;

  if v_task.id is null then
    insert into public.tasks (
      id, host_id, property_id, type, status, priority, assignee_id,
      scheduled_date, time_from, time_to, notes, title, title_i18n
    ) values (
      p_id, v_host, v_property, v_type, v_status, coalesce(p_priority, 0), p_assignee_id,
      p_scheduled_date, p_time_from, p_time_to, nullif(btrim(coalesce(p_notes, '')), ''),
      v_title, coalesce(p_title_i18n, '{}'::jsonb)
    )
    returning * into v_task;
  else
    update public.tasks t
    set property_id      = v_property,
        type             = v_type,
        status           = v_status,
        priority         = case when v_moves then v_priority
                                else coalesce(p_priority, t.priority) end,
        assignee_id      = p_assignee_id,
        scheduled_date   = p_scheduled_date,
        time_from        = case when v_moves then v_window_from
                                when v_booking_cleaning then t.time_from
                                else p_time_from end,
        time_to          = case when v_moves then v_window_to
                                when v_booking_cleaning then t.time_to
                                else p_time_to end,
        notes            = nullif(btrim(coalesce(p_notes, '')), ''),
        title            = v_title,
        -- Nothing sent means nothing said about the translations.
        title_i18n       = coalesce(p_title_i18n, t.title_i18n),
        due_at           = case when v_moves then v_due_at else t.due_at end,
        guests_count     = case when v_moves then v_guests else t.guests_count end,
        pinned_arrival   = v_pinned_arrival,
        pinned_departure = v_pinned_departure,
        pinned_rooms     = v_pinned_rooms
    where t.id = p_id
    returning * into v_task;
  end if;

  return v_task;
end;
$$;

-- ---------- a repair ----------

create or replace function public.assign_problem(
  p_id             uuid,
  p_assignee_id    uuid,
  p_scheduled_date date default null,
  p_time_from      time default null,
  p_time_to        time default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
  v_task_id uuid;
  v_date    date;
begin
  v_problem := public.problem_for_manager(p_id);

  if v_problem.status in ('resolved', 'cancelled') then
    raise exception 'Problem is % and cannot be assigned', v_problem.status
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;
  if v_problem.archived_at is not null then
    raise exception 'Problem is archived and cannot be assigned'
      using errcode = 'check_violation', hint = 'serverErrors.problemArchived';
  end if;
  if v_problem.property_id is null then
    raise exception 'A problem without a listing cannot be scheduled'
      using errcode = 'check_violation', hint = 'serverErrors.problemNoProperty';
  end if;
  if not exists (select 1 from public.profiles pr
                 where pr.id = p_assignee_id
                   and pr.host_id = v_problem.host_id
                   and pr.is_active) then
    raise exception 'Assignee is not an active member of this company'
      using errcode = 'check_violation', hint = 'serverErrors.problemAssigneeInvalid';
  end if;

  v_date := coalesce(
    p_scheduled_date,
    (select (now() at time zone pr.timezone)::date
     from public.properties pr where pr.id = v_problem.property_id));

  select t.id into v_task_id
  from public.tasks t
  where t.problem_id = p_id and t.status not in ('done', 'cancelled', 'expired')
  for update;

  if found then
    update public.tasks t
    set assignee_id    = p_assignee_id,
        -- Another technician, or another day, has been accepted by nobody
        -- yet (20260928110000). SET reads the row as it was.
        status         = case when t.status = 'unassigned' then 'assigned'
                              when t.status = 'accepted'
                                   and (t.assignee_id is distinct from p_assignee_id
                                        or t.scheduled_date is distinct from v_date)
                                then 'assigned'
                              else t.status end,
        scheduled_date = v_date,
        time_from      = p_time_from,
        time_to        = p_time_to
    where t.id = v_task_id;
  else
    insert into public.tasks (
      host_id, property_id, type, status, priority, assignee_id,
      scheduled_date, time_from, time_to, notes, problem_id
    ) values (
      v_problem.host_id, v_problem.property_id, 'maintenance', 'assigned', 0, p_assignee_id,
      v_date, p_time_from, p_time_to, v_problem.description, p_id
    );
  end if;

  select p.* into v_problem from public.problems p where p.id = p_id;
  return v_problem;
end;
$$;

-- ---------- taking a listing out of service ----------

create or replace function public.set_property_status(
  p_property_id  bigint,
  p_status       public.property_status,
  p_cancel_tasks boolean default false
)
returns public.properties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host     uuid := public.current_host_id();
  v_property public.properties;
  v_parent   public.property_status;
  v_open     integer;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may change a listing status'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select * into v_property
  from public.properties
  where id = p_property_id and host_id = v_host;

  if not found then
    raise exception 'Property % is not in this company', p_property_id
      using errcode = 'no_data_found', hint = 'serverErrors.propertyNotFound';
  end if;

  if v_property.parent_id is not null and p_status = 'active' then
    select status into v_parent
    from public.properties
    where id = v_property.parent_id and host_id = v_host;

    if v_parent is distinct from 'active' then
      raise exception 'Unit % cannot go back to work while listing % is not active',
        p_property_id, v_property.parent_id
        using errcode = 'check_violation',
              hint = 'serverErrors.unitParentNotActive',
              detail = json_build_object('parentId', v_property.parent_id)::text;
    end if;
  end if;

  -- Saying again what is already true is not a change, and must not sweep
  -- anything: the panel may send the same press twice on a slow connection.
  --
  -- Rooms are NOT part of that question, and an earlier draft that made them
  -- part of it was wrong. A room under repair inside a working listing is the
  -- ordinary case and the whole reason a room carries a status of its own;
  -- reading it as drift meant a second manager pressing "in service" on the
  -- listing — or one stale panel retrying — quietly sent the room back to work
  -- with a burst pipe in it. The other direction cannot drift: a room more
  -- alive than its listing is refused above.
  if v_property.status = p_status then
    return v_property;
  end if;

  if p_status <> 'active' then
    -- Only cleanings nobody has started, stay-over ones included. `accepted`
    -- is not started: since the accept step (20260928110000) nearly every
    -- handed-out cleaning is accepted, and she is told when it goes.
    select count(*) into v_open
    from public.tasks t
    where (t.property_id = p_property_id or t.property_id in (
             select u.id from public.properties u
             where u.parent_id = p_property_id and u.hostaway_unit_id is not null
           ))
      and t.host_id = v_host
      and t.type in ('cleaning', 'midstay')
      and t.status in ('unassigned', 'assigned', 'accepted');

    if v_open > 0 and not coalesce(p_cancel_tasks, false) then
      raise exception 'Listing % still has % cleanings on the books', p_property_id, v_open
        using errcode = 'check_violation',
              hint = 'serverErrors.propertyHasOpenTasks',
              detail = json_build_object('total', v_open)::text;
    end if;

    update public.tasks
    set status = 'cancelled'
    where (property_id = p_property_id or property_id in (
             select u.id from public.properties u
             where u.parent_id = p_property_id and u.hostaway_unit_id is not null
           ))
      and host_id = v_host
      and type in ('cleaning', 'midstay')
      and status in ('unassigned', 'assigned', 'accepted');
  end if;

  update public.properties
  set status = p_status
  where (id = p_property_id
         or (parent_id = p_property_id and hostaway_unit_id is not null))
    and host_id = v_host;

  select * into v_property
  from public.properties
  where id = p_property_id;

  return v_property;
end;
$$;

create or replace function public.property_open_cleanings(p_property_id bigint)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'Only a manager may ask what archiving would cancel'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  return (
    select count(*)::integer
    from public.tasks t
    where t.host_id = public.current_host_id()
      and t.type in ('cleaning', 'midstay')
      and t.status in ('unassigned', 'assigned', 'accepted')
      and (t.property_id = p_property_id
           or t.property_id in (select u.id
                                from public.properties u
                                where u.parent_id = p_property_id
                                  and u.hostaway_unit_id is not null)));
end;
$$;

create or replace function public.open_cleanings_by_listing()
returns table (property_id bigint, cleanings integer)
language sql
stable
set search_path = ''
as $$
  select case when p.hostaway_unit_id is not null then p.parent_id else p.id end,
         count(*)::integer
  from public.tasks t
  join public.properties p on p.id = t.property_id
  where t.type in ('cleaning', 'midstay')
    and t.status in ('unassigned', 'assigned', 'accepted')
  group by 1;
$$;
