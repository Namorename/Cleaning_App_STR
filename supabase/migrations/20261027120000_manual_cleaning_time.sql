-- A manager's time of a booking's cleaning (docs/manual-cleaning-time.md;
-- the rollout plan of 2026-10-28, step 2).
--
-- The window of a booking's cleaning — time_from, the hour it may start, and
-- time_to, the hour it should be done by — is the server's: the generator
-- writes it from the booking (its check-out, the next guest's check-in, the
-- listing's hours where the booking names none) and writes it again on every
-- run, a webhook's every two minutes and the night's; save_task keeps it,
-- whatever times the panel sends (20260926160000, 20260927120000). A guest who
-- leaves late, or a cleaning the office wants done after lunch, had no way in:
-- a time typed in the panel was taken back by the next run.
--
-- From this migration a manager may set the window of one booking's cleaning
-- by hand, and the hand wins over the booking while the cleaning stays on the
-- day it was set for (the owner's task of 2026-10-29):
--   * set_cleaning_time writes the two times and marks the cleaning
--     (manual_time_on = its day). No run of the generator — the reschedule of
--     every unmoved cleaning, the refresh of every moved one, a webhook's run
--     and the night's alike — and no save_task rewrites the times of a marked
--     cleaning. Everything else still follows the booking: the day, the room,
--     the next check-in (priority, due_at, guests_count).
--   * clear_cleaning_time gives the cleaning back to the booking at once: the
--     window of its day as the generator writes it (cleaning_turnover_on, the
--     rule of a move in save_task), the mark off.
--   * A change of the cleaning's day undoes the hand — a booking moved, a
--     manager's move undone by the booking, the manager moving it in the
--     panel: the times of the new day are the booking's, and
--     manual_time_lost_on keeps the day the hand was for, so the panel can say
--     «the time was set by hand, the day changed» until the manager sets a
--     time again or says she has seen it (clear_cleaning_time). A time set for
--     one day says nothing about another: an hour after a late check-out on a
--     Friday is no answer for a Saturday with its own guests.
--   * A change of room within the listing does not undo it: the cleaning keeps
--     its day, and the rooms of one listing share its hours.
--   * A booking cancelled and then live again gets its cleaning written anew
--     (the cancelled row stays as history); the new row takes the manager's
--     time of the cancelled one while the day is the same, and the mark when
--     it is not.
--   * Each change goes into task_events — time_set, time_auto, time_dropped —
--     with who wrote it and the window before and after
--     (journal_cleaning_time).
--   * The cleaner reads time_from and time_to as before: the phone shows the
--     manager's hours, and its start gate (task_start_not_before, the server's
--     startTooEarly) opens at them. A change of hours of an assigned cleaning
--     today or tomorrow is already a push (cleaning_window,
--     push_on_task_change, 20261003160000): nothing new is sent, and the
--     phone needs no update.
--   * Only a manager (is_manager: manager, admin), as for save_task. An
--     executor's write of the two marks is reverted by guard_task_fields, as
--     her write of the times already is.
-- Open cleanings only — unassigned, assigned, accepted: those are the ones a
-- run rewrites. Work under way keeps the hours it started with.
--
-- The bodies: guard_task_fields as 20261003130000 plus two lines; save_task as
-- 20261003110000 plus the drop of the hand on a change of day;
-- generate_cleaning_tasks as 20260927120000 but for the insert (the hand of a
-- cancelled cleaning) and for the reschedule and the refresh (the times of a
-- marked cleaning). An unmarked cleaning is compared and written exactly as
-- before, and every cleaning is unmarked when this file is applied: the
-- migration changes no cleaning's time (read of the cloud, 2026-10-29,
-- docs/manual-cleaning-time.md §6).
--
-- LOCKS. Two nullable columns and two checks on tasks: ACCESS EXCLUSIVE for
-- the moment of the ALTER (the checks read the table once, every row null);
-- two triggers: SHARE ROW EXCLUSIVE. The webhook job holds row locks on tasks
-- every two minutes; lock_timeout fails the push instead of queueing every
-- read of tasks behind it. If it fires, nothing of this file is applied and
-- the push is repeated as it is.
--
-- Tests: supabase/tests/manual_cleaning_time.sql. Rollback:
-- docs/one-off-writes/manual-cleaning-time-rollback.sql.

set local lock_timeout = '5s';

-- ---------- the marks ----------

alter table public.tasks
  add column manual_time_on date,
  add column manual_time_lost_on date,
  add constraint tasks_manual_time_booking_cleaning
    check (manual_time_on is null or (type = 'cleaning' and reservation_id is not null)),
  add constraint tasks_manual_time_one_mark
    check (manual_time_on is null or manual_time_lost_on is null);

comment on column public.tasks.manual_time_on is
  'The day a manager set this booking''s cleaning''s time_from and time_to by hand for '
  '(set_cleaning_time, 20261027120000). While the cleaning stands on that day, no run of '
  'the generator and no save_task rewrites the two times. Null: the times follow the booking.';
comment on column public.tasks.manual_time_lost_on is
  'The day of a manager''s time that a change of the cleaning''s day undid (20261027120000): '
  'the times follow the booking again, and the panel says so until the manager sets a time '
  'again or clears the mark (clear_cleaning_time). Null otherwise.';

-- ---------- the journal's words for it ----------

-- Used by journal_cleaning_time only, which runs after this file commits.
alter type public.task_event_kind add value if not exists 'time_set';      -- a manager's hours (params: date, from, to; carried)
alter type public.task_event_kind add value if not exists 'time_auto';     -- back to the booking's (params: date, from, to)
alter type public.task_event_kind add value if not exists 'time_dropped';  -- a change of day undid them (params: date, from_date, manual_on, from, to; cause)

comment on type public.task_event_kind is
  'What happened to a task that is not the repair of a problem (task_events, 20261015100000; '
  'the hours of a booking''s cleaning, 20261027120000).';


/**
 * What an executor may not change on her own task.
 *
 * Unchanged from 20261003130000 apart from manual_time_on and
 * manual_time_lost_on, which join the fields only the office writes: a
 * manager's time is her word on the hours, and the hours are already the
 * executor's only to read.
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

  -- Who asked for the job, and when, is a record, not a field: nobody
  -- rewrites it.
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  -- The head technician dispatching a repair writes as the office does: who
  -- does it, the day and the hours (assign_problem, unassign_problem;
  -- 20261003130000). His own writes stay an executor's.
  if not (public.is_manager() or public.head_tech_dispatching()) then
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
    -- The instructions are the office's word (save_task writes them).
    new.notes                 := old.notes;
    -- Which problem a task repairs is the manager's to say (20260923130000).
    new.problem_id            := old.problem_id;
    -- So is a manager's move of a booking's cleaning (20260926160000).
    new.pinned_arrival        := old.pinned_arrival;
    new.pinned_departure      := old.pinned_departure;
    new.pinned_rooms          := old.pinned_rooms;
    -- And a manager's time of a booking's cleaning (20261027120000).
    new.manual_time_on        := old.manual_time_on;
    new.manual_time_lost_on   := old.manual_time_lost_on;
  end if;

  return new;
end;
$$;


/**
 * Write a task, or change one: the body of 20261003110000 plus the drop of a
 * manager's time when a save puts the cleaning on another day (20261027120000).
 * Same signature, same grants.
 */
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
  v_manual_on        date;
  v_manual_lost      date;
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
    -- the spot (docs/tech-plan.md, 2.2). The table refuses it too
    -- (tasks_no_cleaning_for_tech); asked here of the kind the task ends up
    -- with, on every save that names him, so the answer comes before the
    -- questions about duplicates below.
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

  -- A manager's time of a booking's cleaning holds on the day it was set for
  -- (20261027120000). A save that puts the cleaning on another day drops it:
  -- the window of the new day is the booking's (a move writes it above), and
  -- manual_time_lost_on keeps the day the time was for, so the panel can say
  -- so. A save that keeps the day keeps the time, as it keeps every booking's
  -- window.
  v_manual_on   := v_task.manual_time_on;
  v_manual_lost := v_task.manual_time_lost_on;
  if v_task.manual_time_on is not null
     and p_scheduled_date is distinct from v_task.scheduled_date then
    v_manual_on   := null;
    v_manual_lost := v_task.manual_time_on;
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
        pinned_rooms     = v_pinned_rooms,
        manual_time_on      = v_manual_on,
        manual_time_lost_on = v_manual_lost
    where t.id = p_id
    returning * into v_task;
  end if;

  return v_task;
end;
$$;


/**
 * The generator: the body of 20260927120000 but for the insert, which carries
 * the manager's time of a cancelled cleaning to the new one of a booking live
 * again, and the reschedule and refresh passes, which leave the times of a
 * cleaning a manager set them on alone while it keeps that day
 * (20261027120000). An unmarked cleaning is compared and written exactly as
 * before.
 */
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
  v_refreshed   integer;
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
    -- With the departure, what a manager's move is checked against.
    r.arrival_date   as arrival_date,
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
  -- The bookings leaving in the window, and every booking with a cleaning
  -- nobody has started on a day of the window, wherever it now leaves: that
  -- is how a cleaning follows a booking whose departure moved out of the
  -- window (20260926160000). Two lists joined by union, so each is read on
  -- its own; an `or` here would read every booking.
  where r.id in (select r1.id
                 from public.reservations r1
                 where r1.departure_date between from_date and to_date
                   and not r1.is_block
                 union
                 select t1.reservation_id
                 from public.tasks t1
                 where t1.type = 'cleaning'
                   and t1.reservation_id is not null
                   and t1.status in ('unassigned', 'assigned', 'accepted')
                   and t1.scheduled_date between from_date and to_date)
    and r.status in ('new', 'modified')
    and not r.is_block
    -- A service booking is a block by another name (20260926102000).
    and not public.is_service_booking(r.guest_name)
    and p.status = 'active';


  -- Take a cleaning to the room its booking's guest is now in.
  --
  -- A booking can learn its room after its cleaning exists — Hostaway assigns
  -- the unit later, or a listing grows rooms it did not have — and it can be
  -- moved from one room to another, or lose its rooms and be cleaned as the
  -- listing: the owner's rule is that the cleaning follows, and a room change
  -- is common (20260926160000). The row where the guest was and the row owed
  -- where the guest is are the same cleaning under two names, and moving it
  -- keeps its id and with it the cleaner's name, her photos, her steps and the
  -- problems filed against it.
  --
  -- Without this pass the cancel pass takes the old row away and the insert
  -- writes a stranger with no cleaner on it. Measured against a copy of
  -- production for the listing-to-room case alone, that pair cancelled 192
  -- cleanings and created none, 96 of them with a cleaner's name on them.
  --
  -- Within one listing only: its own row and its rooms. A booking moved to
  -- another listing is served there by that listing's rule. Work somebody has
  -- started stays where it was started. A booking's rows that stand where it
  -- owes nothing are paired — those somebody holds first, then in property
  -- order — with the places it owes and has no live cleaning on, the lowest
  -- room first, as the one-off backfill chose; what is left unpaired on
  -- either side is the cancel pass's and the
  -- insert's. A new room is a changed booking, and undoes a manager's move —
  -- here for the cleaning that moves, in the reschedule pass for every other
  -- cleaning of the booking (20260927120000).
  with stray as (
    select t.id, t.reservation_id,
           -- A cleaning somebody holds is paired first: when the cleanings
           -- left behind outnumber the places newly needed — rooms folded
           -- into the listing, two rooms moved into one new room — the one
           -- left over is cancelled, and it should not be the cleaner's
           -- (20260927120000). Among cleanings all held, room order decides.
           -- A room the booking keeps is not a place newly needed: its own
           -- cleaning stays there, whoever holds it.
           row_number() over (partition by t.reservation_id
                              order by (t.assignee_id is null), t.property_id, t.id) as rank
    from public.tasks t
    join (select distinct reservation_id, listing_id from _wanted) b
      on b.reservation_id = t.reservation_id
    join public.properties tp on tp.id = t.property_id
    where t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned', 'accepted')
      and (t.property_id = b.listing_id
           or (tp.parent_id = b.listing_id and tp.hostaway_unit_id is not null))
      and not exists (select 1 from _wanted w
                      where w.reservation_id = t.reservation_id
                        and w.property_id = t.property_id)
  ),
  open_place as (
    select w.reservation_id, w.property_id,
           -- A place the booking has just taken comes before one that holds
           -- only its expired cleaning: a swapped guest went to the new room,
           -- and the cleaner goes after her (20260927120000). By property
           -- order within each.
           row_number() over (partition by w.reservation_id
                              order by exists (select 1 from public.tasks e
                                               where e.reservation_id = w.reservation_id
                                                 and e.property_id = w.property_id
                                                 and e.type = 'cleaning'
                                                 and e.status = 'expired'),
                                       w.property_id) as rank
    from _wanted w
    -- The pair names one cleaning (tasks_one_cleaning_per_reservation): a
    -- place already holding this booking's live cleaning is served.
    where not exists (select 1 from public.tasks x
                      where x.reservation_id = w.reservation_id
                        and x.property_id = w.property_id
                        and x.type = 'cleaning'
                        and x.status not in ('cancelled', 'expired'))
  ),
  relocated as (
    update public.tasks t
    set property_id      = o.property_id,
        pinned_arrival   = null,
        pinned_departure = null,
        pinned_rooms     = null
    from stray s
    join open_place o on o.reservation_id = s.reservation_id and o.rank = s.rank
    where t.id = s.id
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
  -- A moved cleaning is live work of its booking whatever day it stands on,
  -- so its booking is never owed a second one (20260926160000). Once it
  -- expires, the day that was tried is the moved one: an expired row answers
  -- for the departure it was moved away from, while the booking keeps the
  -- dates and the rooms it had at the move (the rooms since 20260927120000),
  -- as well as for its own day; or a
  -- cleaning moved before the departure and never closed would come back on
  -- the departure — the incident of 2026-09-26 by another road.
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
             or (t.status = 'expired'
                 and (t.scheduled_date = w.scheduled_date
                      or (t.pinned_departure = w.scheduled_date
                          and t.pinned_arrival = w.arrival_date
                          -- Last: read only for an expired moved row.
                          and t.pinned_rooms = public.reservation_rooms(w.reservation_id)))))
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
      scheduled_date, time_from, time_to, guests_count, due_at, assignee_id,
      manual_time_on, manual_time_lost_on
    )
    select
      o.property_id, o.reservation_id, 'cleaning',
      (case when o.auto_cleaner_id is not null then 'assigned' else 'unassigned' end)
        ::public.task_status,
      o.priority, o.scheduled_date,
      case when k.manual_time_on = o.scheduled_date then k.time_from else o.time_from end,
      case when k.manual_time_on = o.scheduled_date then k.time_to else o.time_to end,
      o.guests_count, o.due_at, o.auto_cleaner_id,
      case when k.manual_time_on = o.scheduled_date then k.manual_time_on end,
      case when k.manual_time_on <> o.scheduled_date then k.manual_time_on end
    from owed o
    -- A booking cancelled and live again gets its cleaning written anew; the
    -- manager's time of the cancelled one comes with it while the day is the
    -- same, and on another day the panel is told it was dropped
    -- (20261027120000). The latest cancelled cleaning of the same booking and
    -- place that carried one; read for the few rows written, nothing else.
    left join lateral (
      select c.manual_time_on, c.time_from, c.time_to
      from public.tasks c
      where c.reservation_id = o.reservation_id
        and c.property_id = o.property_id
        and c.type = 'cleaning'
        and c.status = 'cancelled'
        and c.manual_time_on is not null
      order by c.updated_at desc, c.id
      limit 1
    ) k on true
    where not o.is_past
    returning 1
  )
  select (select count(*) from inserted),
         (select count(*) from owed where is_past)
    into v_created, v_past_bound;

  -- Bring each cleaning up to its booking: a new departure, a new window, a
  -- new guest count, a new next guest.
  --
  -- Work nobody has started: unassigned, assigned and — since 20260926160000
  -- — accepted. An accepted cleaning that moves to another day goes back to
  -- «assigned», still hers. Work under way is left for a human.
  --
  -- A manager's move holds while the booking keeps the dates and the rooms
  -- it had at the move: such a row is left to the refresh below. Once the
  -- booking's dates differ, or any of its rooms — one taken, given up or
  -- swapped, whichever cleaning it concerns (the owner's word of 2026-09-27,
  -- 20260927120000) — the move is undone here and the row follows the booking
  -- like any other; the cleaning that changed room was undone already, in the
  -- relocate pass. Onto a day
  -- already past grace too: the sweep then closes it, as task_generation.sql
  -- has it (the tried day stays closed to a second attempt).
  with moved as (
    update public.tasks t
    set scheduled_date   = w.scheduled_date,
        priority         = w.priority,
        -- A manager's time holds while the cleaning stays on the day it was
        -- set for; a run that takes it to another day drops the time and
        -- leaves the panel the day it was for (20261027120000).
        time_from        = case when t.manual_time_on = w.scheduled_date
                                then t.time_from else w.time_from end,
        time_to          = case when t.manual_time_on = w.scheduled_date
                                then t.time_to else w.time_to end,
        guests_count     = w.guests_count,
        due_at           = w.due_at,
        status           = case
                             when t.status = 'accepted'
                              and t.scheduled_date is distinct from w.scheduled_date
                             then 'assigned'::public.task_status
                             else t.status
                           end,
        pinned_arrival   = null,
        pinned_departure = null,
        pinned_rooms     = null,
        manual_time_on   = case when t.manual_time_on = w.scheduled_date
                                then t.manual_time_on end,
        manual_time_lost_on = case when t.manual_time_on <> w.scheduled_date
                                   then t.manual_time_on
                                   else t.manual_time_lost_on end
    from _wanted w
    where t.reservation_id = w.reservation_id
      and t.property_id = w.property_id
      and t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned', 'accepted')
      and ((t.pinned_departure is not null
            and (t.pinned_departure is distinct from w.scheduled_date
                 or t.pinned_arrival is distinct from w.arrival_date
                 -- Last, so it is read for a moved row alone: a handful.
                 or t.pinned_rooms is distinct from public.reservation_rooms(t.reservation_id)))
           or (t.pinned_departure is null
               and (t.scheduled_date is distinct from w.scheduled_date
                    or t.priority is distinct from w.priority
                    -- The times of a cleaning a manager set them on, on
                    -- that day, are not the booking's to compare.
                    or (t.manual_time_on is distinct from w.scheduled_date
                        and (t.time_from is distinct from w.time_from
                             or t.time_to is distinct from w.time_to))
                    or t.guests_count is distinct from w.guests_count
                    or t.due_at is distinct from w.due_at)))
    returning 1
  )
  select count(*) into v_rescheduled from moved;

  -- A moved cleaning keeps its day, and what the phone says about the next
  -- check-in — its window with it — stays true of that day (option B): the
  -- listing's hours may change, and a guest may
  -- book into it, or cancel, long after the move, and neither is a change of
  -- this cleaning's own booking. Every moved cleaning nobody has started, on
  -- every run — they are a handful, and a booking into the moved day is not
  -- in the window of the run it causes. Counted as rescheduled.
  with refreshed as (
    update public.tasks t
    set priority     = f.priority,
        due_at       = f.due_at,
        guests_count = f.guests_count,
        -- A manager's time on the moved day holds (20261027120000).
        time_from    = case when m.manual_time_on is null then f.window_from
                            else t.time_from end,
        time_to      = case when m.manual_time_on is null then f.window_to
                            else t.time_to end
    from public.tasks m
    cross join lateral public.cleaning_turnover_on(m.reservation_id, m.property_id,
                                                   m.scheduled_date) f
    where t.id = m.id
      and m.pinned_departure is not null
      and m.type = 'cleaning'
      and m.status in ('unassigned', 'assigned', 'accepted')
      and m.reservation_id is not null
      and (t.priority is distinct from f.priority
           or t.due_at is distinct from f.due_at
           or t.guests_count is distinct from f.guests_count
           or (m.manual_time_on is null
               and (t.time_from is distinct from f.window_from
                    or t.time_to is distinct from f.window_to)))
    returning 1
  )
  select count(*) into v_refreshed from refreshed;

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

  -- Cancel tasks whose booking no longer owes them: cancelled, turned into an
  -- inquiry, became a block or a service booking, moved to another listing,
  -- gave up the room — or whose listing has since gone into maintenance or
  -- been archived.
  --
  -- `_wanted` holds every booking that could still owe a cleaning reached
  -- here — each one leaving in the window, and each one with an unstarted
  -- cleaning in the window — so a cleaning reached here whose pair is not in
  -- it is owed by nobody (20260926160000). Before, a booking whose departure
  -- moved out of the window was missing from `_wanted` and its cleaning was
  -- cancelled for it; now the reschedule above has taken the cleaning along.
  --
  -- Reached by its day in the window, or by its booking's departure in it: a
  -- webhook's run spans only the departures of its batch, and a moved
  -- cleaning stands on another day — reached by its day alone, it would
  -- outlive its cancelled booking until a sync's wider run came by.
  --
  -- Work under way or done is never touched, and neither is work that
  -- expired: those are answers about what happened, not open questions.
  with dropped as (
    update public.tasks t
    set status = 'cancelled'
    where t.type = 'cleaning'
      and t.reservation_id is not null
      and t.status in ('unassigned', 'assigned', 'accepted')
      and (t.scheduled_date between from_date and to_date
           or t.reservation_id in (select r0.id from public.reservations r0
                                   where r0.departure_date between from_date and to_date))
      and not exists (
        select 1 from _wanted w
        where w.reservation_id = t.reservation_id
          and w.property_id = t.property_id
      )
    returning 1
  )
  select count(*) into v_cancelled from dropped;

  drop table _wanted;

  v_answer := jsonb_build_object(
    'window_from', from_date,
    'window_to', to_date,
    'relocated', v_relocated,
    'created', v_created,
    'rescheduled', v_rescheduled + v_refreshed,
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


-- ---------- setting and clearing ----------

/**
 * The booking's cleaning a manager is about to set or clear the hours of,
 * locked, or the refusal that says why not — the questions both RPCs ask, in
 * one place (20261027120000).
 *
 * p_expected_date is the day the panel showed: the question save_task asks
 * (serverErrors.taskMovedMeanwhile). A booking that moved the cleaning while
 * the form was open would otherwise put the hours on a day nobody chose them
 * for. Null asks nothing.
 */
create or replace function public.lock_cleaning_for_time(
  p_task_id       uuid,
  p_expected_date date
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select t.* into v_task
  from public.tasks t
  where t.id = p_task_id and t.host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Task % is not in this company', p_task_id
      using errcode = 'check_violation', hint = 'serverErrors.taskNotFound';
  end if;

  -- A cleaning written by hand keeps whatever hours save_task gives it, and
  -- nothing rewrites them: there is nothing to hold against.
  if v_task.reservation_id is null or v_task.type <> 'cleaning' then
    raise exception 'Task % is not the cleaning of a booking', p_task_id
      using errcode = 'check_violation', hint = 'serverErrors.cleaningTimeNotFromBooking';
  end if;
  if v_task.status in ('done', 'cancelled', 'expired') then
    raise exception 'Task is % and can no longer be edited', v_task.status
      using errcode = 'check_violation',
            hint = 'serverErrors.taskClosed',
            detail = jsonb_build_object('status', v_task.status)::text;
  end if;
  -- Work under way keeps the hours it started with; no run rewrites them.
  if v_task.status not in ('unassigned', 'assigned', 'accepted') then
    raise exception 'Cleaning % is already under way (%)', p_task_id, v_task.status
      using errcode = 'check_violation',
            hint = 'serverErrors.cleaningTimeStarted',
            detail = jsonb_build_object('status', v_task.status)::text;
  end if;
  if p_expected_date is not null and p_expected_date is distinct from v_task.scheduled_date then
    raise exception 'Task % was moved to % while the form was open', p_task_id, v_task.scheduled_date
      using errcode = 'check_violation',
            hint = 'serverErrors.taskMovedMeanwhile',
            detail = jsonb_build_object('date', v_task.scheduled_date)::text;
  end if;

  return v_task;
end;
$$;

comment on function public.lock_cleaning_for_time(uuid, date) is
  'The checks of set_cleaning_time and clear_cleaning_time (20261027120000): a manager, a '
  'booking''s cleaning of her company not yet under way, on the day the panel showed. Locks it.';

/**
 * A manager sets the window of one booking's cleaning by hand
 * (20261027120000): from p_time_from to p_time_to on the day it stands on.
 * The hours hold against every run of the generator and every save while the
 * cleaning keeps that day; a change of day gives the cleaning back to its
 * booking and leaves the panel a mark.
 *
 * Both hours, the start before the end: the window is what the phone's start
 * gate opens at and what the cleaner reads as the time to be done by.
 *
 * The same hours again change nothing and journal nothing: the replay of a
 * save whose answer was lost.
 */
create or replace function public.set_cleaning_time(
  p_task_id       uuid,
  p_time_from     time,
  p_time_to       time,
  p_expected_date date default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task  public.tasks;
  v_saved public.tasks;
begin
  v_task := public.lock_cleaning_for_time(p_task_id, p_expected_date);

  if p_time_from is null or p_time_to is null or p_time_from >= p_time_to then
    raise exception 'A cleaning''s hours need a start before their end (% - %)', p_time_from, p_time_to
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.cleaningTimeInvalid';
  end if;

  update public.tasks t
  set time_from           = p_time_from,
      time_to             = p_time_to,
      manual_time_on      = t.scheduled_date,
      manual_time_lost_on = null
  where t.id = v_task.id
    and (t.time_from is distinct from p_time_from
         or t.time_to is distinct from p_time_to
         or t.manual_time_on is distinct from t.scheduled_date
         or t.manual_time_lost_on is not null)
  returning * into v_saved;

  if found then
    return v_saved;
  end if;
  return v_task;
end;
$$;

comment on function public.set_cleaning_time(uuid, time, time, date) is
  'A manager''s hours for one booking''s cleaning, held against the generator and save_task '
  'while it keeps its day (20261027120000). Errors: serverErrors.managerOnly, taskNotFound, '
  'cleaningTimeNotFromBooking, taskClosed, cleaningTimeStarted, taskMovedMeanwhile, '
  'cleaningTimeInvalid.';

/**
 * Give a booking's cleaning back to its booking (20261027120000): the window
 * of the day it stands on as the generator writes it — cleaning_turnover_on,
 * the rule save_task applies to a move, which on the departure answers as
 * reservation_cleaning_window does (pinned_cleaning.sql, 0) — and both marks
 * off. On a cleaning that carries only the mark of a lost time, its hours are
 * already the booking's: the mark goes, nothing else changes. A booking no
 * longer in the table leaves the hours as they are.
 */
create or replace function public.clear_cleaning_time(
  p_task_id       uuid,
  p_expected_date date default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task  public.tasks;
  v_saved public.tasks;
  v_from  time;
  v_to    time;
begin
  v_task := public.lock_cleaning_for_time(p_task_id, p_expected_date);

  v_from := v_task.time_from;
  v_to   := v_task.time_to;
  if v_task.manual_time_on is not null then
    select f.window_from, f.window_to into v_from, v_to
    from public.cleaning_turnover_on(v_task.reservation_id, v_task.property_id,
                                     v_task.scheduled_date) f;
    if not found then
      v_from := v_task.time_from;
      v_to   := v_task.time_to;
    end if;
  end if;

  update public.tasks t
  set time_from           = v_from,
      time_to             = v_to,
      manual_time_on      = null,
      manual_time_lost_on = null
  where t.id = v_task.id
    and (t.manual_time_on is not null
         or t.manual_time_lost_on is not null
         or t.time_from is distinct from v_from
         or t.time_to is distinct from v_to)
  returning * into v_saved;

  if found then
    return v_saved;
  end if;
  return v_task;
end;
$$;

comment on function public.clear_cleaning_time(uuid, date) is
  'A booking''s cleaning back to its booking''s hours, both marks off (20261027120000). '
  'Errors as set_cleaning_time, but for cleaningTimeInvalid.';

-- ---------- the journal ----------

/**
 * Writes the changes of a manager's hours into task_events (20261027120000),
 * beside journal_task_change, which writes the person, the day, the place and
 * the status. Three kinds:
 *   time_set     — a manager's hours, set or set again; on insert, the hours a
 *                  booking live again carried from its cancelled cleaning
 *                  (params.carried);
 *   time_auto    — back to the booking's (clear_cleaning_time);
 *   time_dropped — a change of day undid them (cause: who moved it, or
 *                  booking_changed for the generator); on insert, the mark a
 *                  booking live again on another day carried.
 * params: date — the day after; from_date — the day before, when it changed;
 * manual_on — the day the lost hours were for; from, to — the window before
 * and after. Ids, days and hours; never text (20261015100000).
 * The clearing of a lost mark alone changes no hours and writes nothing.
 */
create or replace function public.journal_cleaning_time()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  -- A cause a server function named for this transaction (20261015100000).
  v_named    text := nullif(current_setting('str_ops.task_cause', true), '');
  v_by_actor text;
  v_kind     public.task_event_kind;
  v_cause    text;
begin
  -- A name the journal does not know is ignored, as journal_task_change does.
  if v_named not in ('manager', 'head_tech', 'staff', 'staff_inactive', 'booking_cancelled',
                     'property_unavailable', 'booking_changed', 'system') then
    v_named := null;
  end if;

  if v_actor is not null then
    select case p.role
             when 'manager' then 'manager'
             when 'admin' then 'manager'
             when 'head_tech' then 'head_tech'
             else 'staff'
           end
      into v_by_actor
    from public.profiles p
    where p.id = v_actor;
  end if;

  if tg_op = 'INSERT' then
    if new.manual_time_on is not null then
      v_kind := 'time_set';
    else
      v_kind := 'time_dropped';
      v_cause := coalesce(v_named, v_by_actor, 'booking_changed');
    end if;
    insert into public.task_events (host_id, task_id, kind, actor_id, cause, params)
    values (new.host_id, new.id, v_kind, v_actor, v_cause,
            jsonb_strip_nulls(jsonb_build_object(
              'date', new.scheduled_date,
              'manual_on', new.manual_time_lost_on,
              'to', jsonb_build_object('time_from', new.time_from, 'time_to', new.time_to),
              'carried', true)));
    return null;
  end if;

  if new.manual_time_on is not null then
    v_kind := 'time_set';
  elsif old.manual_time_on is null then
    return null;
  elsif new.manual_time_lost_on is not null then
    v_kind := 'time_dropped';
    v_cause := coalesce(v_named, v_by_actor, 'booking_changed');
  else
    v_kind := 'time_auto';
  end if;

  insert into public.task_events (host_id, task_id, kind, actor_id, cause, params)
  values (new.host_id, new.id, v_kind, v_actor, v_cause,
          jsonb_strip_nulls(jsonb_build_object(
            'date', new.scheduled_date,
            'from_date', case when new.scheduled_date is distinct from old.scheduled_date
                              then old.scheduled_date end,
            'manual_on', case when v_kind = 'time_dropped' then old.manual_time_on end,
            'from', jsonb_build_object('time_from', old.time_from, 'time_to', old.time_to),
            'to', jsonb_build_object('time_from', new.time_from, 'time_to', new.time_to))));
  return null;
end;
$$;

comment on function public.journal_cleaning_time() is
  'Trigger on tasks: writes each change of a manager''s hours of a booking''s cleaning into '
  'task_events — time_set, time_auto, time_dropped (20261027120000).';

-- Named after journal_task_change's triggers so that they fire after them: the
-- day's move is written before the hours it dropped.
create trigger tasks_journal_cleaning_insert_time
  after insert on public.tasks
  for each row
  when (new.manual_time_on is not null or new.manual_time_lost_on is not null)
  execute function public.journal_cleaning_time();

create trigger tasks_journal_cleaning_update_time
  after update of time_from, time_to, manual_time_on, manual_time_lost_on on public.tasks
  for each row
  when (old.manual_time_on is distinct from new.manual_time_on
        or (new.manual_time_on is not null
            and (old.time_from is distinct from new.time_from
                 or old.time_to is distinct from new.time_to)))
  execute function public.journal_cleaning_time();

-- ---------- who may call what ----------

revoke all on function public.lock_cleaning_for_time(uuid, date) from public, anon, authenticated;
revoke all on function public.journal_cleaning_time() from public, anon, authenticated;

revoke all on function public.set_cleaning_time(uuid, time, time, date) from public, anon;
grant execute on function public.set_cleaning_time(uuid, time, time, date)
  to authenticated, service_role;

revoke all on function public.clear_cleaning_time(uuid, date) from public, anon;
grant execute on function public.clear_cleaning_time(uuid, date)
  to authenticated, service_role;
