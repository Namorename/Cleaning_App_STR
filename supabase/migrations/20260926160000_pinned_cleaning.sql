-- A booking's cleaning follows its booking; a manager's move holds until the
-- booking changes.
--
-- Found 2026-09-26 on a listing of the owner's: a cleaning from a booking,
-- moved in the panel, came back to the departure day on the next generator
-- run — twice, at 20:04 and 20:42 UTC, each run reporting one "rescheduled".
-- The reschedule pass moved every unassigned or assigned cleaning back to its
-- booking's departure, whoever had set its day. In the same minutes a
-- cleaning written by hand on that departure day went in without a word:
-- save_task's check for "the same job twice" looked at hand-made tasks only.
--
-- The owner's rule of 2026-09-27, which replaces the pin of 2026-09-26 before
-- it was ever rolled out:
--   * The cleaning always follows its booking. A booking moved, lengthened or
--     shortened, or moved to another room of a multi-unit listing, takes its
--     cleaning to the new departure and the new room — the same row, so the
--     same cleaner, her photos and her steps. A room change is common, not a
--     corner case.
--   * A manager may put the cleaning on another day, and it stays there while
--     the booking does not change. save_task records the booking's dates at
--     the move (tasks.pinned_arrival, tasks.pinned_departure); any change of
--     the booking's dates or room undoes the move, and the cleaning follows
--     the booking again. Moving it back onto the departure undoes it too.
--   * in_progress and paused are never moved, nor cancelled.
--   * A booking that no longer owes a cleaning — cancelled, an inquiry, a
--     block or a "#" service booking, or its listing out of service — cancels
--     it while nobody has started it: unassigned, assigned and, by the
--     owner's decision of 2026-09-25 that step 1 did not carry, accepted.
--   * What the phone says about the next check-in (priority, due_at,
--     guests_count) is true of the day the cleaning stands on, moved or not
--     (option B): save_task writes it for the new day, and every run brings
--     every moved cleaning's up to date — a guest may book into that day, or
--     cancel, after the move.
--   * A cleaning written by hand on a listing and day that already have a
--     booking's cleaning asks first, with the same question — serverErrors.
--     taskDuplicate — as two hand-made ones. Both questions are asked when a
--     task lands on that day: created, moved there, or turned into another
--     kind of job — not on every later edit of a pair the manager has already
--     confirmed (the question about two hand-made ones was asked on every
--     save until now).
--   * A moved cleaning that expires counts as the booking's tried day, as an
--     unmoved one does on its own day: the generator does not write the
--     booking's cleaning again on the departure it was moved away from.
--
-- Following the booking needs the run to see the booking. A run's window is a
-- range of departures — a webhook's is the departures of its batch, the
-- night's is 7 days back to 90 ahead — and a booking whose departure moved
-- outside it used to drop out of the run while its cleaning stayed in it: the
-- cancel pass then took the cleaning away, with its cleaner, and a later run
-- wrote a stranger. So `_wanted` also takes every booking that has an
-- unstarted cleaning on a day of the window.
--
-- A booking moved to another listing is not followed across: the old flat's
-- cleaning is cancelled and the new flat gets its own, by its own regular
-- cleaner if it has one. Rooms are followed within their listing.
--
-- Proposed with this migration and dormant today: an accepted cleaning that
-- moves to another day goes back to «assigned», the same cleaner. Nothing
-- writes 'accepted' yet (the phone has no accept step; the cloud holds none).
-- The pushes that tell a cleaner — cancelled, moved, moved by the manager —
-- are F11.
--
-- The panel reads the columns once this migration is in the cloud: «бронь
-- изменилась» on a moved cleaning means its booking has gone or changed since
-- the move — not merely that the day differs from the departure.
--
-- An executor may not move or undo a move: guard_task_fields reverts the two
-- columns for anyone but a manager, as it does the day itself.
--
-- The check-in rule — who arrives into this room on this day — is the lateral
-- inside reservation_cleaning_window, asked of the departure. save_task and
-- the refresh of moved cleanings ask it of any day, through
-- cleaning_turnover_on, which carries a copy of that lateral. One function
-- reading the other would cost the generator a nested security definer call
-- on every row it reads — measured at about four times the whole run — so the
-- rule is written twice and a test holds the two to one answer.
--
-- The generator's body is that of 20260926102000 but for `_wanted`, the
-- relocate, reschedule and cancel passes, the refresh of moved cleanings and
-- the insert's expired-day stopper; save_task's is that of 20260910150000 but
-- for the move and the duplicate questions; guard_task_fields's is that of
-- 20260923130000 plus two lines.
--
-- Measured by calling the generator on 9000 synthetic cleanings (local stack,
-- rolled back, three runs each, alternating with the body of 20260926102000):
-- a 100-day run 0.40-0.68 s against 0.37-1.30 s, a webhook's one-day run
-- 34-62 ms against 25-50 ms — the same, within the noise of the machine.
--
-- Tests: supabase/tests/pinned_cleaning.sql.
--
-- LOCKS. Adding nullable columns without a default touches the catalog only,
-- and the check constraint reads the table once (six thousand rows, all null)
-- — but the one ALTER takes ACCESS EXCLUSIVE on public.tasks, and every read
-- of tasks — the phone's list, the panel's calendar — queues behind a waiting
-- request for it. The webhook job runs the generator every two minutes and
-- holds row locks on tasks while it does. lock_timeout makes a busy table fail
-- the push instead: one lock, 5 s, under the 8 s statement_timeout of
-- authenticated. If it fires, nothing of this file is applied and the push is
-- repeated as it is.

set local lock_timeout = '5s';

alter table public.tasks
  add column pinned_arrival date,
  add column pinned_departure date,
  add constraint tasks_pinned_whole
    check ((pinned_arrival is null) = (pinned_departure is null));

comment on column public.tasks.pinned_arrival is
  'Set with pinned_departure when a manager moved a booking''s cleaning off its '
  'departure day: the booking''s arrival at that moment. Null otherwise.';
comment on column public.tasks.pinned_departure is
  'Set when a manager moved a booking''s cleaning off its departure day: the '
  'booking''s departure at that moment. While the booking keeps these dates and '
  'its room, the generator leaves the day and window alone; any change undoes '
  'the move. Null for every other task.';


/**
 * What a booking's cleaning on `target_day` knows about the next check-in:
 * urgent (priority 1) when a guest arrives into the same room that day, with
 * that guest's hour as the deadline — in the cleaned property's own timezone —
 * and that guest's party. The generator's rule for the departure day, asked
 * of any day: save_task asks it of the day a manager moves the cleaning to,
 * and the generator of every moved cleaning on each run (20260926160000).
 */
create or replace function public.cleaning_turnover_on(
  target_reservation_id bigint,
  target_property_id    bigint,
  target_day            date
)
returns table (priority smallint, due_at timestamptz, guests_count smallint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (case when nxt.id is not null then 1 else 0 end)::smallint,
    case
      when nxt.id is not null
      then (target_day + coalesce(nullif(nxt.check_in_time, time '00:00'), l.check_in_time))
           at time zone c.timezone
    end,
    nxt.guests_count
  from public.reservations r
  join public.properties l on l.id = r.property_id
  join public.properties c on c.id = target_property_id
  -- The guest who arrives on that day into the room being cleaned: the
  -- lateral of reservation_cleaning_window (20260926102000) with the day in
  -- place of the departure. Keep the two in step; pinned_cleaning.sql, 0,
  -- holds them to one answer.
  left join lateral (
    select n.id, n.check_in_time, n.guests_count
    from public.reservations n
    where n.property_id = r.property_id
      and n.arrival_date = target_day
      and n.id <> r.id
      and n.status in ('new', 'modified')
      and not n.is_block
      and not public.is_service_booking(n.guest_name)
      and (target_property_id = r.property_id
           or exists (select 1
                      from public.reservation_units nu
                      where nu.reservation_id = n.id
                        and nu.property_id = target_property_id))
    order by n.id
    limit 1
  ) nxt on true
  where r.id = target_reservation_id
$$;

revoke all on function public.cleaning_turnover_on(bigint, bigint, date)
  from public, anon, authenticated;


/**
 * What an executor may not change on her own task.
 *
 * Unchanged from 20260923130000 apart from pinned_arrival and
 * pinned_departure, which join the pinned fields: a move is the manager's
 * word on a day, and the day is already the executor's only to read.
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
    -- So is a manager's move of a booking's cleaning (20260926160000).
    new.pinned_arrival        := old.pinned_arrival;
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
  v_arrival          date;
  v_departure        date;
  v_pinned_arrival   date;
  v_pinned_departure date;
  v_moves            boolean := false;
  v_priority         smallint;
  v_due_at           timestamptz;
  v_guests           smallint;
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
  -- booking keeps the dates it had at the move; moved back onto the
  -- departure, it follows the booking again. An edit that says nothing new
  -- about the day keeps what was. A move brings what the phone says about
  -- the next check-in to the new day (option B, 20260926160000).
  v_pinned_arrival   := v_task.pinned_arrival;
  v_pinned_departure := v_task.pinned_departure;
  if v_task.reservation_id is not null and v_task.type = 'cleaning' then
    select r.arrival_date, r.departure_date into v_arrival, v_departure
    from public.reservations r
    where r.id = v_task.reservation_id;

    v_moves := p_scheduled_date is distinct from v_task.scheduled_date;
    if p_scheduled_date = v_departure then
      v_pinned_arrival   := null;
      v_pinned_departure := null;
    elsif v_moves then
      v_pinned_arrival   := v_arrival;
      v_pinned_departure := v_departure;
    end if;

    if v_moves then
      select f.priority, f.due_at, f.guests_count into v_priority, v_due_at, v_guests
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
        time_from        = p_time_from,
        time_to          = p_time_to,
        notes            = nullif(btrim(coalesce(p_notes, '')), ''),
        title            = v_title,
        -- Nothing sent means nothing said about the translations.
        title_i18n       = coalesce(p_title_i18n, t.title_i18n),
        due_at           = case when v_moves then v_due_at else t.due_at end,
        guests_count     = case when v_moves then v_guests else t.guests_count end,
        pinned_arrival   = v_pinned_arrival,
        pinned_departure = v_pinned_departure
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
  -- owes nothing are paired, in property order, with the places it owes and
  -- has no live cleaning on — the lowest room first, as the one-off backfill
  -- chose; what is left unpaired on either side is the cancel pass's and the
  -- insert's. A new room is a changed booking, and undoes a manager's move.
  with stray as (
    select t.id, t.reservation_id,
           row_number() over (partition by t.reservation_id
                              order by t.property_id, t.id) as rank
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
           row_number() over (partition by w.reservation_id
                              order by w.property_id) as rank
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
        pinned_departure = null
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
  -- for the departure it was moved away from as well as for its own day, or a
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
                 and w.scheduled_date in (t.scheduled_date, t.pinned_departure)))
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

  -- Bring each cleaning up to its booking: a new departure, a new window, a
  -- new guest count, a new next guest.
  --
  -- Work nobody has started: unassigned, assigned and — since 20260926160000
  -- — accepted. An accepted cleaning that moves to another day goes back to
  -- «assigned», still hers. Work under way is left for a human.
  --
  -- A manager's move holds while the booking keeps the dates it had at the
  -- move: such a row is left to the refresh below. Once the booking's dates
  -- differ, the move is undone here and the row follows the booking like any
  -- other; a new room undid it already, in the relocate pass. Onto a day
  -- already past grace too: the sweep then closes it, as task_generation.sql
  -- has it (the tried day stays closed to a second attempt).
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
        pinned_arrival   = null,
        pinned_departure = null
    from _wanted w
    where t.reservation_id = w.reservation_id
      and t.property_id = w.property_id
      and t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned', 'accepted')
      and ((t.pinned_departure is not null
            and (t.pinned_departure is distinct from w.scheduled_date
                 or t.pinned_arrival is distinct from w.arrival_date))
           or (t.pinned_departure is null
               and (t.scheduled_date is distinct from w.scheduled_date
                    or t.priority is distinct from w.priority
                    or t.time_from is distinct from w.time_from
                    or t.time_to is distinct from w.time_to
                    or t.guests_count is distinct from w.guests_count
                    or t.due_at is distinct from w.due_at)))
    returning 1
  )
  select count(*) into v_rescheduled from moved;

  -- A moved cleaning keeps its day and its window, and what the phone says
  -- about the next check-in stays true of that day (option B): a guest may
  -- book into it, or cancel, long after the move, and neither is a change of
  -- this cleaning's own booking. Every moved cleaning nobody has started, on
  -- every run — they are a handful, and a booking into the moved day is not
  -- in the window of the run it causes. Counted as rescheduled.
  with refreshed as (
    update public.tasks t
    set priority     = f.priority,
        due_at       = f.due_at,
        guests_count = f.guests_count
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
           or t.guests_count is distinct from f.guests_count)
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
