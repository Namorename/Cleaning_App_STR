-- The technician and the cleanings (docs/tech-plan.md, §2; owner's word 2026-10-01).
--
-- A technician sees and does only the work handed to him; cleanings are not
-- his — nor the head technician's (§3). The database refuses the writes that
-- would make one his, and every rule below holds for both roles:
--
-- - a link to a listing (property_cleaners): a trigger, so the RPC
--   save_property_cleaner, the manager's direct write and the server context
--   are all refused. Without links the generator, which hands work out only
--   through 'auto' links, never gives him a cleaning; cleans_property is false
--   for him, so he sees no free queue and has nothing to take; the push about
--   free work and the morning count of it go to linked people only. Those are
--   proven by supabase/tests/tech_rules.sql, not coded here.
--
-- - a change of role to tech or head_tech while the person still holds links
--   or open cleanings (a cleaning, a mid-stay cleaning or an inspection that is
--   neither done, cancelled nor expired): a trigger on profiles, which both
--   paths that change a role hit — manage-staff, which upserts the row as the
--   service role, and a manager writing the row. The manager takes them off
--   first; nothing is lost quietly. Only a change asks: an old link in the
--   cloud (one technician, docs/tech-plan.md §1) does not stop an edit of his
--   phone number, and the owner takes those rows off himself.
--
-- - save_task handing a cleaning, a mid-stay cleaning or an inspection to a
--   technician, on creation or by an edit that changes the person or the kind
--   of job. A repair still goes to anybody on the spot (owner, 2026-10-01).
--
-- Reading tasks does not change (§2.4): a role in the hot policies would cost a
-- call on every row of a feed, and reading must not hide a cleaning already
-- handed out — it would be a cleaning nobody does.
--
-- The three refusals follow CLAUDE.md: an English message, the i18n key in
-- hint, the parameters as JSON in detail. The role check and the write it
-- guards meet on the person's profile row: the link and the save read it FOR
-- SHARE, and the role change writes it, so whichever comes second waits for
-- the first and then sees what it wrote.
--
-- save_task's body is copied from 20260928110000 with only the change above;
-- same signature, so its ACL and the generated types stay. The triggers take
-- a brief lock on property_cleaners and profiles.

set local lock_timeout = '3s';

-- ---------- 1. a technician is linked to no listing ----------

create or replace function public.guard_link_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = new.cleaner_id
  for share;

  if v_role in ('tech', 'head_tech') then
    raise exception 'A technician is not linked to listings: % is %', new.cleaner_id, v_role
      using errcode = 'check_violation', hint = 'serverErrors.techNotLinkable';
  end if;

  return new;
end;
$$;

create trigger property_cleaners_no_tech
  before insert or update of cleaner_id on public.property_cleaners
  for each row execute function public.guard_link_role();

comment on function public.guard_link_role() is
  'A technician or the head technician holds no link to a listing: cleanings are '
  'not their work (docs/tech-plan.md, 2.1; 20261003110000).';

-- ---------- 2. nobody becomes a technician with cleanings on them ----------

create or replace function public.guard_tech_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_links     integer;
  v_cleanings integer;
begin
  -- Only a change into a technician's role is asked: an edit that keeps the
  -- role is an edit, whatever old rows the person still holds. The privilege
  -- guard runs first (its name sorts first) and has already put back a role
  -- the caller may not change.
  if new.role not in ('tech', 'head_tech') or new.role = old.role then
    return new;
  end if;

  select count(*) into v_links
  from public.property_cleaners pc
  where pc.cleaner_id = new.id;

  select count(*) into v_cleanings
  from public.tasks t
  where t.assignee_id = new.id
    and t.type in ('cleaning', 'midstay', 'inspection')
    and t.status not in ('done', 'cancelled', 'expired');

  if v_links > 0 or v_cleanings > 0 then
    raise exception 'Person % still holds % listing links and % open cleanings',
      new.id, v_links, v_cleanings
      using errcode = 'check_violation',
            hint = 'serverErrors.techRoleBlocked',
            detail = jsonb_build_object('links', v_links, 'cleanings', v_cleanings)::text;
  end if;

  return new;
end;
$$;

create trigger profiles_guard_tech_role
  before update of role on public.profiles
  for each row execute function public.guard_tech_role_change();

comment on function public.guard_tech_role_change() is
  'Nobody becomes a technician or the head technician while holding listing links '
  'or open cleanings; the manager takes them off first (docs/tech-plan.md, 2.1; '
  '20261003110000). Both paths that change a role hit it: manage-staff and a '
  'manager writing the profile.';

revoke all on function public.guard_link_role() from public, anon, authenticated;
revoke all on function public.guard_tech_role_change() from public, anon, authenticated;

-- ---------- 3. save_task hands no cleaning to a technician ----------

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
  v_assignee_role    public.app_role;
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
  if p_assignee_id is not null then
    -- FOR SHARE: a change of the person's role waits for this save, and this
    -- save for a change already under way (20261003110000).
    select pr.role into v_assignee_role
    from public.profiles pr
    where pr.id = p_assignee_id and pr.host_id = v_host and pr.is_active
    for share;
    if not found then
      raise exception 'Assignee is not an active member of this company'
        using errcode = 'check_violation', hint = 'serverErrors.taskAssigneeInvalid';
    end if;
    -- Cleanings of every kind are a cleaner's; a repair goes to whoever is on
    -- the spot (docs/tech-plan.md, 2.2). Asked of the kind the task ends up
    -- with, so neither a new task nor an edit of one hands it to a technician.
    if v_type in ('cleaning', 'midstay', 'inspection')
       and v_assignee_role in ('tech', 'head_tech') then
      raise exception 'A % is not handed to a technician', v_type
        using errcode = 'check_violation',
              hint = 'serverErrors.cleaningNotForTech',
              detail = jsonb_build_object('type', v_type)::text;
    end if;
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
