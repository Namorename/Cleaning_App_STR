-- A cleaning moved by hand stays where the manager put it.
--
-- Found 2026-09-26 on a listing of the owner's: a cleaning from a booking,
-- moved in the panel, came back to the departure day on the next generator
-- run — twice, at 20:04 and 20:42 UTC, each run reporting one "rescheduled".
-- The reschedule pass moved every unassigned or assigned cleaning back to its
-- booking's departure, whoever had set its day. In the same minutes a
-- cleaning written by hand on that departure day went in without a word:
-- save_task's check for "the same job twice" looked at hand-made tasks only.
--
-- The owner's decisions of 2026-09-26 (and one of 2026-09-25):
--   * A manager may move a cleaning from a booking. The move pins it:
--     tasks.pinned_departure keeps the booking's departure at the moment of
--     the move. The generator leaves a pinned cleaning alone entirely — its
--     day, window, priority, guest count, deadline — and never writes a
--     second cleaning for the booking (it never did: the insert looks for any
--     live cleaning of the booking, on any day, and the unique index
--     tasks_one_cleaning_per_reservation backs it).
--   * Moving it back onto the departure day unpins it; so does the booking's
--     own departure arriving on the pinned day. It is then an ordinary
--     cleaning again, under the generator.
--   * A booking that no longer owes a cleaning — cancelled, an inquiry, a
--     block or a "#" service booking, moved to another listing or room, or
--     its listing out of service — cancels the cleaning while nobody has
--     started it: unassigned, assigned and, by the owner's decision of
--     2026-09-25 that the rollout of step 1 did not carry, accepted; pinned or
--     not. in_progress and paused are left alone. A taken or pinned cleaning
--     is cancelled only for that reason, never because its booking's
--     departure moved out of the run's window: its booking still owes it.
--   * A cleaning written by hand on a listing and day that already have a
--     booking's cleaning asks first, with the same question — serverErrors.
--     taskDuplicate — as two hand-made ones. It asks when the task lands on
--     that day: when it is created or moved there, not on every later edit
--     of a pair the manager has already confirmed.
--
-- Proposed with this migration, for the owner to settle before the push: a
-- booking that moves to another day takes an accepted cleaning with it, back
-- to «assigned» — the same cleaner, asked to confirm the new day. Until now
-- an accepted cleaning stayed on the old day, and the panel said «бронь
-- изменилась». (The push that tells her is F11.)
--
-- The panel reads the column once this migration is in the cloud: «бронь
-- изменилась» on a pinned cleaning means its booking has gone or leaves on
-- another day than the one it was pinned against — not merely that the pinned
-- day differs from the departure.
--
-- An executor may not pin or unpin: guard_task_fields reverts the column for
-- anyone but a manager, as it does the day itself.
--
-- The generator's body is that of 20260926102000 but for the reschedule and
-- the cancel passes; save_task's is that of 20260910150000 but for the pin
-- and the second duplicate check; guard_task_fields's is that of
-- 20260923130000 plus one line.
--
-- Tests: supabase/tests/pinned_cleaning.sql.

alter table public.tasks add column pinned_departure date;

comment on column public.tasks.pinned_departure is
  'Set when a manager moved a booking''s cleaning off its departure day: the '
  'departure at that moment. The generator leaves a pinned cleaning alone. '
  'Null for every other task.';


/**
 * What an executor may not change on her own task.
 *
 * Unchanged from 20260923130000 apart from pinned_departure, which joins the
 * pinned fields: a pin is the manager's word on a day, and the day is already
 * the executor's only to read.
 */
create or replace function public.guard_task_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if old.started_at is not null then
    new.started_at := old.started_at;
  end if;
  if old.completed_at is not null then
    new.completed_at := old.completed_at;
  end if;

  -- Who asked for the job is a record, not a field: nobody rewrites it.
  new.created_by := old.created_by;

  if not public.is_manager() then
    if old.status in ('done', 'cancelled', 'expired') then
      raise exception 'Task is % and cannot be changed by its executor', old.status
        using errcode = 'check_violation',
              hint = 'serverErrors.taskClosed',
              detail = jsonb_build_object('status', old.status)::text;
    end if;

    -- assignee_id is deliberately NOT reverted here: a change of owner is
    -- caught by the policy's WITH CHECK, which says so. A silent revert here
    -- would intercept it before the check, and the client would read the
    -- handover as a save that worked.
    new.property_id           := old.property_id;
    new.reservation_id        := old.reservation_id;
    new.type                  := old.type;
    new.priority              := old.priority;
    new.scheduled_date        := old.scheduled_date;
    new.due_at                := old.due_at;
    new.time_from             := old.time_from;
    new.time_to               := old.time_to;
    new.guests_count          := old.guests_count;
    new.started_at            := old.started_at;
    new.completed_at          := old.completed_at;
    new.completed_by          := old.completed_by;
    new.is_parallel           := old.is_parallel;
    new.duration_override_min := old.duration_override_min;
    new.title                 := old.title;
    new.title_i18n            := old.title_i18n;
    -- Which problem a task repairs is the manager's to say (20260923130000).
    new.problem_id            := old.problem_id;
    -- So is whether a cleaning's day is pinned (20260926160000).
    new.pinned_departure      := old.pinned_departure;
  end if;

  return new;
end;
$$;


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
  p_allow_duplicate boolean default false
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
  v_departure date;
  v_pinned    date;
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

  -- The same kind of job, on the same flat, on the same day. A job from a
  -- booking or from a report is not one of these — it was not written by
  -- hand — and a cancelled or expired one is out of the way by definition.
  if not coalesce(p_allow_duplicate, false)
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
  -- (20260926160000): the flat is already being cleaned. Asked when a
  -- cleaning lands on that day — created, or moved there — and not again on
  -- every edit of a pair the manager has already confirmed.
  if not coalesce(p_allow_duplicate, false)
     and v_type = 'cleaning'
     and (v_task.id is null
          or p_scheduled_date is distinct from v_task.scheduled_date
          or v_property is distinct from v_task.property_id)
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

  -- A booking's cleaning moved off its departure day is pinned there, against
  -- the departure of the moment; moved back onto it, it is the generator's
  -- again. An edit that says nothing new about the day keeps what was.
  v_pinned := v_task.pinned_departure;
  if v_task.reservation_id is not null and v_task.type = 'cleaning' then
    select r.departure_date into v_departure
    from public.reservations r
    where r.id = v_task.reservation_id;

    v_pinned := case
      when p_scheduled_date = v_departure then null
      when p_scheduled_date is distinct from v_task.scheduled_date then v_departure
      else v_task.pinned_departure
    end;
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
        priority         = coalesce(p_priority, t.priority),
        assignee_id      = p_assignee_id,
        scheduled_date   = p_scheduled_date,
        time_from        = p_time_from,
        time_to          = p_time_to,
        notes            = nullif(btrim(coalesce(p_notes, '')), ''),
        title            = v_title,
        -- Nothing sent means nothing said about the translations.
        title_i18n       = coalesce(p_title_i18n, t.title_i18n),
        pinned_departure = v_pinned
    where t.id = p_id
    returning * into v_task;
  end if;

  return v_task;
end;
$$;


create or replace function public.generate_cleaning_tasks(from_date date, to_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_relocated   integer;
  v_created     integer;
  v_rescheduled integer;
  v_assigned    integer;
  v_cancelled   integer;
  v_past_bound  integer;
  v_answer      jsonb;
begin
  -- One row per cleaning owed: a booking on an ordinary listing owes one, a
  -- booking that took three rooms owes three. `p` is the thing being cleaned
  -- from here on — the room where there is one, the listing where there is
  -- not — and every column below is read off it.
  create temporary table _wanted on commit drop as
  select
    r.id             as reservation_id,
    p.id             as property_id,
    -- Carried for one reason: a cleaning finished before this migration stands
    -- on the listing and answers for every room at once. See the insert.
    r.property_id    as listing_id,
    r.departure_date as scheduled_date,
    (case when w.same_day_turnover then 1 else 0 end)::smallint as priority,
    w.window_from    as time_from,
    w.window_to      as time_to,
    w.guests_count,
    case
      when w.same_day_turnover and w.window_to is not null
      -- The next guest may arrive at that hour, so that is the hard deadline.
      -- Computed in the property's own timezone: a date is a calendar date
      -- there, not an instant in UTC.
      then (r.departure_date + w.window_to) at time zone p.timezone
    end as due_at,
    -- The regular cleaner: this property's own, the listing above it
    -- otherwise. Each arm matches at most one row — that is exactly what
    -- property_cleaners_one_auto guarantees, and it guarantees it per property,
    -- which is why the arms are a coalesce and not one widened WHERE.
    -- `pc.property_id in (p.id, p.parent_id)` would match both at once for a
    -- room carrying its own auto link under a listing that has one too, and a
    -- scalar subquery returning two rows does not mis-assign a cleaning — it
    -- aborts the whole nightly reconciliation with 21000.
    --
    -- Both arms are keyed off `p` and never off `r.property_id`, though the
    -- join makes those the same value today. `p` is the property being cleaned.
    -- A booking takes its rooms through public.reservation_units, and the
    -- fan-out over them is the next stage; the day this query stops being one
    -- row per booking, the first arm has to follow the room and not the
    -- booking. Keyed off `p` it follows whatever `p` becomes. Keyed off
    -- `r.property_id` it would quietly begin reading the listing in both arms,
    -- leaving the precedence below inert with every test still green.
    --
    -- A room's own 'claim' link does not stop the listing's auto link from
    -- reaching it. Inside a single listing a claim link has never stopped an
    -- auto link either: it puts a colleague in the queue, it does not empty
    -- the queue. Only an auto link answers "whose is this the moment it is
    -- made", so only an auto link on the room itself overrides the listing's.
    coalesce(
      (select pc.cleaner_id
       from public.property_cleaners pc
       where pc.property_id = p.id and pc.mode = 'auto'),
      (select pc.cleaner_id
       from public.property_cleaners pc
       where p.hostaway_unit_id is not null
         and pc.property_id = p.parent_id
         and pc.mode = 'auto')
    ) as auto_cleaner_id
  from public.reservations r
  -- No row in reservation_units means the booking named no rooms, and the
  -- listing itself is what gets cleaned. A left join says exactly that, and
  -- says it without a second branch to keep in step.
  left join public.reservation_units ru on ru.reservation_id = r.id
  join public.properties p on p.id = coalesce(ru.property_id, r.property_id)
  cross join lateral public.reservation_cleaning_window(r.id, p.id) w
  where r.departure_date between from_date and to_date
    and r.status in ('new', 'modified')
    and not r.is_block
    -- A service booking is a block by another name (20260926102000).
    and not public.is_service_booking(r.guest_name)
    and p.status = 'active';


  -- Move a cleaning that still stands on the listing onto the room the booking
  -- turns out to have taken.
  --
  -- A booking can learn its room after its cleaning exists: Hostaway assigns
  -- the unit later, or a listing grows rooms it did not have. The row on the
  -- listing and the row owed on the room are then the same cleaning under two
  -- names, and moving it keeps its id and with it the cleaner's name, her
  -- photos, her steps and the problems filed against it.
  --
  -- Without this pass the insert below reads the listing row as "already
  -- served" and skips the room, and the cancel pass — which judges by the pair
  -- — then takes that very row away: the booking comes out of the run owing
  -- nothing, and tomorrow's run gives back a stranger with no cleaner on it.
  -- Measured against a copy of production, that pair cancelled 192 cleanings
  -- and created none, 96 of them with a cleaner's name on them.
  --
  -- Only untouched work, which is the rule the other three passes keep: a
  -- cleaning somebody has accepted or started stays where she accepted it, and
  -- the insert's listing branch below is what keeps it from being duplicated
  -- onto a room.
  with wanted_room as (
    -- The lowest room id the booking took: an arbitrary choice among them, but
    -- a stable one, and the same one the one-off backfill makes. The booking's
    -- other rooms are owed cleanings of their own and the insert writes them.
    select distinct on (reservation_id) reservation_id, property_id, listing_id
    from _wanted
    where property_id <> listing_id
    order by reservation_id, property_id
  ),
  relocated as (
    update public.tasks t
    set property_id = w.property_id
    from wanted_room w
    where t.reservation_id = w.reservation_id
      and t.property_id = w.listing_id
      and t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned')
      -- If the room already holds this booking's cleaning, the move would
      -- collide with the pair that names one. The listing row is then a
      -- duplicate of work that already exists where it belongs, and the cancel
      -- pass below is what clears it.
      and not exists (
        select 1 from public.tasks x
        where x.reservation_id = w.reservation_id
          and x.property_id = w.property_id
          and x.type = 'cleaning'
          and x.status not in ('cancelled', 'expired')
      )
    returning 1
  )
  select count(*) into v_relocated from relocated;

  -- Insert missing tasks. A repeated run writes nothing twice because `owed`
  -- leaves out every booking whose cleaning is already there (the not exists
  -- below); there is no `on conflict`. The partial unique index
  -- tasks_one_cleaning_per_reservation, on (reservation_id, property_id), is
  -- the backstop for two runs at once: both may find the same cleaning
  -- missing, the second insert then waits for the first run and fails with
  -- 23505 once it commits, and the whole second run rolls back -- the next
  -- run writes whatever it still finds missing.
  --
  -- A pinned cleaning is live work of its booking whatever day it stands on,
  -- so its booking is never owed a second one (20260926160000).
  --
  -- `owed` is every cleaning the bookings ask for that the table does not yet
  -- answer. Those whose day is already past grace are counted as past_bound
  -- and not written; both numbers come from the one list, so they cannot
  -- disagree about what "missing" means.
  with owed as (
    select w.*,
           -- No cleaning is born for a day the sweep would close: task_is_stale
           -- is the one boundary the sweep and the claim policy already share.
           -- The bound sits here and not in _wanted on purpose -- see the header.
           public.task_is_stale(w.property_id, w.scheduled_date) as is_past
    from _wanted w
    where not exists (
      select 1 from public.tasks t
      where t.reservation_id = w.reservation_id
        and t.type = 'cleaning'
        -- Live work already exists for this booking -- or the very day was
        -- already tried and closed unfinished. The second half is what stops
        -- the nightly loop; the header of this migration says why.
        and (t.status not in ('cancelled', 'expired')
             or (t.status = 'expired' and t.scheduled_date = w.scheduled_date))
        and (t.property_id = w.property_id
             -- ...or it stands on the booking's own listing, which is where
             -- every cleaning stood before this migration. Such a row is the
             -- same cleaning recorded under the identity of the day, and it
             -- answers for every room the booking took.
             --
             -- Without this the ten cleanings finished last week on the nine
             -- multi-unit listings would each be created again, on a room, for
             -- work already done — and three of them would arrive already
             -- assigned to the cleaner who did it. History is not moved onto a
             -- room (it is not ours to restate), so it has to be read where it
             -- lies.
             --
             -- The branch cannot suppress work that is genuinely owed: after
             -- this migration the generator never puts a cleaning on a listing
             -- whose booking names rooms, so a row it matches is always one
             -- from before. On an ordinary listing w.property_id and
             -- w.listing_id are the same value and it says nothing new.
             or t.property_id = w.listing_id)
    )
  ),
  inserted as (
    insert into public.tasks (
      property_id, reservation_id, type, status, priority,
      scheduled_date, time_from, time_to, guests_count, due_at, assignee_id
    )
    select
      o.property_id, o.reservation_id, 'cleaning',
      (case when o.auto_cleaner_id is not null then 'assigned' else 'unassigned' end)
        ::public.task_status,
      o.priority, o.scheduled_date, o.time_from, o.time_to, o.guests_count,
      o.due_at, o.auto_cleaner_id
    from owed o
    where not o.is_past
    returning 1
  )
  select (select count(*) from inserted),
         (select count(*) from owed where is_past)
    into v_created, v_past_bound;

  -- Move tasks whose booking shifted, whose window changed, or whose guest
  -- count changed.
  --
  -- Work nobody has started: unassigned, assigned and — since 20260926160000
  -- — accepted. An accepted cleaning that moves to another day goes back to
  -- «assigned», still hers: the day she said yes to is not this one, and she
  -- is asked again rather than dropped. Work under way is left for a human.
  --
  -- A pinned cleaning is the manager's day and is not rewritten at all —
  -- until the booking's own departure arrives on that day: then it is an
  -- ordinary cleaning again, unpinned, and brought up to date here with the
  -- rest (it counts as rescheduled).
  with moved as (
    update public.tasks t
    set scheduled_date   = w.scheduled_date,
        priority         = w.priority,
        time_from        = w.time_from,
        time_to          = w.time_to,
        guests_count     = w.guests_count,
        due_at           = w.due_at,
        status           = case
                             when t.status = 'accepted'
                              and t.scheduled_date is distinct from w.scheduled_date
                             then 'assigned'::public.task_status
                             else t.status
                           end,
        pinned_departure = null
    from _wanted w
    where t.reservation_id = w.reservation_id
      and t.property_id = w.property_id
      and t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned', 'accepted')
      and ((t.pinned_departure is null
            and (t.scheduled_date is distinct from w.scheduled_date
                 or t.priority is distinct from w.priority
                 or t.time_from is distinct from w.time_from
                 or t.time_to is distinct from w.time_to
                 or t.guests_count is distinct from w.guests_count
                 or t.due_at is distinct from w.due_at))
           or (t.pinned_departure is not null
               and t.scheduled_date = w.scheduled_date))
    returning 1
  )
  select count(*) into v_rescheduled from moved;

  -- Hand over tasks that are still waiting on a listing with a default
  -- cleaner. This covers the link being switched to 'auto' after the task
  -- already existed — the same shape as a stale deadline, where state set once
  -- at creation was never revisited.
  --
  -- Only genuinely free work: a task someone already holds, whether claimed by
  -- a cleaner or handed over by the manager, is left exactly as it is.
  with taken as (
    update public.tasks t
    set assignee_id = w.auto_cleaner_id,
        status      = 'assigned'
    from _wanted w
    where t.reservation_id = w.reservation_id
      and t.property_id = w.property_id
      and t.type = 'cleaning'
      and t.status = 'unassigned'
      and t.assignee_id is null
      and w.auto_cleaner_id is not null
    returning 1
  )
  select count(*) into v_assigned from taken;

  -- Cancel tasks whose reservation no longer qualifies: cancelled, turned into
  -- an inquiry, became a block or a service booking, moved to another listing
  -- or room, moved out of the window entirely — or whose listing has since
  -- gone into maintenance or been archived.
  --
  -- Two readings of "no longer wanted" (20260926160000):
  --   * untouched, unpinned work — unassigned, assigned — on a day of the
  --     run's window is judged by the run, as before: absent from `_wanted`,
  --     it goes;
  --   * any work nobody has started — accepted and pinned included — is
  --     judged by its booking alone: it goes when the booking owes this
  --     cleaning nothing any more. Never because the departure moved out of
  --     this run's window: the booking still owes it, and a later run finds it.
  -- The second reading repeats the conditions of `_wanted` without its window;
  -- the two lists have to be kept in step.
  --
  -- The second reading reaches the cleaning either by its day or by its
  -- booking's departure. A webhook's run spans only the departures of its
  -- batch, and a pinned cleaning stands on another day: reached by its day
  -- alone, it would outlive its cancelled booking until a sync's wider run
  -- came by.
  --
  -- A cleaning `_wanted` names is owed by both readings, so that test comes
  -- first and is shared: the booking is looked up only for what the run did
  -- not name. Measured by calling the generator on 9000 synthetic cleanings
  -- (local stack, rolled back, three runs each against the body of
  -- 20260926102000): asking the booking of every cleaning in the window
  -- doubled the run; with the shared test first a 100-day run takes what it
  -- took (0.40-0.51 s), and a one-day run, a webhook's, 40-47 ms against
  -- 25-37 ms — the reach by departure, a scan of tasks.
  --
  -- Work under way or done is never touched, and neither is work that
  -- expired: those are answers about what happened, not open questions.
  with dropped as (
    update public.tasks t
    set status = 'cancelled'
    where t.type = 'cleaning'
      and t.reservation_id is not null
      and t.status in ('unassigned', 'assigned', 'accepted')
      and not exists (
        select 1 from _wanted w
        where w.reservation_id = t.reservation_id
          and w.property_id = t.property_id
      )
      and ((t.scheduled_date between from_date and to_date
            and t.status in ('unassigned', 'assigned')
            and t.pinned_departure is null)
           or ((t.scheduled_date between from_date and to_date
                or t.reservation_id in (select r0.id from public.reservations r0
                                        where r0.departure_date between from_date and to_date))
               and not exists (
                 select 1
                 from public.reservations r
                 join public.properties p on p.id = t.property_id
                 where r.id = t.reservation_id
                   and r.status in ('new', 'modified')
                   and not r.is_block
                   and not public.is_service_booking(r.guest_name)
                   and p.status = 'active'
                   -- The booking's own listing, or one of the rooms it took.
                   and (t.property_id = r.property_id
                        or exists (select 1 from public.reservation_units u
                                   where u.reservation_id = r.id
                                     and u.property_id = t.property_id))
               )))
    returning 1
  )
  select count(*) into v_cancelled from dropped;

  drop table _wanted;

  v_answer := jsonb_build_object(
    'window_from', from_date,
    'window_to', to_date,
    'relocated', v_relocated,
    'created', v_created,
    'rescheduled', v_rescheduled,
    'assigned', v_assigned,
    'cancelled', v_cancelled,
    'past_bound', v_past_bound
  );

  -- The trace, in its own block: a failure here rolls back only this insert
  -- and is reported, never the run. See the header.
  begin
    lock table raw.generator_runs in row exclusive mode nowait;
    insert into raw.generator_runs (window_from, window_to, answer)
    values (from_date, to_date, v_answer);
  exception when others then
    raise warning 'generate_cleaning_tasks: run trace not written: % (SQLSTATE %)',
      sqlerrm, sqlstate;
  end;

  return v_answer;
end;
$function$;
