-- Any change of a booking's rooms undoes the move of every cleaning of it;
-- the window of a booking's cleaning is the server's, whatever a save sends.
--
-- The owner's word of 2026-09-27, given after 20260926160000 was written: a
-- booking of several rooms that takes a room, gives one up or swaps one has
-- changed, and every cleaning of it follows the booking again — not only the
-- cleaning whose room changed. 20260926160000 undid the move of that one
-- alone ("a multi-room booking whose other room changed keeps the move of this
-- one", its header); this migration replaces that sentence.
--
-- A move now records the booking's rooms as well as its dates:
-- tasks.pinned_rooms, the booking's reservation_units in property order ('{}'
-- for a booking that named none), set with pinned_arrival and pinned_departure
-- and cleared with them; the constraint tasks_pinned_rooms_whole holds it to
-- them. The generator compares the booking's rooms as they now are with the
-- move's, as it already compares the dates: in the reschedule pass, where a
-- difference undoes the move and the cleaning follows the booking, and in the
-- insert's stopper, where an expired moved cleaning stops a second attempt on
-- the departure only while the booking keeps both its dates and its rooms.
--
-- Why a record of the rooms and not what the run did. A run could undo every
-- move of a booking whose cleaning it relocated, inserted or cancelled. But a
-- place stands open for reasons that are not a change of the booking — a
-- room's cleaning that expired on the departure stays unanswered for as long
-- as the booking comes into runs, and so does one written off past grace —
-- and every such run would undo a move whose booking never changed. The
-- record says what the owner said: the booking changed since the move, or it
-- did not. A change undone before the next run is no change, and neither is
-- the sync writing the same rooms again.
--
-- The rooms are read by public.reservation_rooms(reservation): one range of
-- reservation_units' primary key. It is no security definer — its callers,
-- save_task and the generator, are, and it runs as they do. The generator asks
-- it of a moved row alone: it is the last term of the conditions it stands in,
-- and a row that is not moved never reaches it.
--
-- The window. The window of a booking's cleaning is the server's, moved or not
-- (20260926160000): the generator writes it on every unmoved cleaning, a move
-- writes it for the new day. Yet save_task wrote whatever times a save sent
-- when the day stayed — the panel's form sends back every field it shows, and
-- a form opened before a guest booked into that day sent the old window back,
-- to stand until the next run that reached the cleaning. Now a save that keeps
-- a booking's cleaning on its day keeps its window, whatever its status — one
-- in progress too, whose window no run rewrites any more; a task written by
-- hand keeps the times the manager gives it. The panel shows those times
-- read-only, for every status.
--
-- After the stay the rule is the same (the owner's word of 2026-09-27, after
-- a rule of its own for a booking that had left was tried at the preflight
-- and withdrawn): a departure corrected after the fact takes the cleaning to
-- the new day, yesterday included — yesterday's cleaning is still to be seen
-- and done today, and the sweep closes it a day later — and any change of the
-- booking undoes every move of it.
--
-- Fewer places than cleanings. When a booking keeps fewer places than it has
-- cleanings — its rooms folded into the listing, two rooms made one — the
-- relocate pass pairs one of them with the place left and the cancel pass
-- takes the rest. It paired the lowest room's, so a cleaner's cleaning could
-- be cancelled and one nobody held kept. A cleaning somebody holds is now
-- paired first.
--
-- A swap next to an expired cleaning. The relocate pass pairs a booking's
-- cleaning left in a room it gave up with a room it now needs, the lowest room
-- first; a room whose cleaning expired counted as needed too, so a guest moved
-- from B to C could send B's cleaner to A, where a moved cleaning had expired.
-- Rooms the booking has just taken now come first.
--
-- A replayed save. The panel's form keeps the day it was opened with, and a
-- move whose answer was lost, saved again, came back as «moved while the form
-- was open» — the manager's own move, blamed on somebody else. A save that
-- lands on the day the task already stands on is not refused now: nothing
-- moved it away from what the form is asking for.
--
-- Moves already recorded: none in the cloud — only a panel that sends
-- p_expected_date records one, and it ships after this migration; the probe
-- before the push counts them. Any found get the booking's rooms as they are
-- now, so the constraint holds.
--
-- Bodies: guard_task_fields, save_task and generate_cleaning_tasks are those
-- of 20260926160000 but for the lines that name pinned_rooms, save_task's
-- window and its replayed save, the order in which the relocate pass pairs
-- the cleanings left behind with the places open, and the comments beside
-- them. save_task keeps its signature, and create or
-- replace keeps its grants.
--
-- Tests: supabase/tests/pinned_cleaning.sql, sections 12 to 16.
--
-- Measured by calling the generator (local stack, rolled back, after ANALYZE)
-- on 9000 synthetic bookings all inside the window — 300 listings, 30 of them
-- with rooms — and 60 cleanings moved by hand, 20 of them on rooms; three runs
-- each, three sessions, alternating with the body of 20260926160000 (this one
-- first in each pair), on an idle machine: a 97-day run 0.71-1.04 s, mean
-- 0.83, against 0.72-0.89 s, mean 0.78; a one-day run 49-76 ms against
-- 47-71 ms — within the noise of the machine, the 97-day mean some 6% above.
-- The 60 moves held through every run.
--
-- LOCKS. As in 20260926160000: adding a nullable column without a default and
-- a check that reads six thousand rows, under one ACCESS EXCLUSIVE lock on
-- public.tasks that every read of tasks queues behind. lock_timeout makes a
-- busy table fail the push instead: 5 s, under the 8 s statement_timeout of
-- authenticated; if it fires, nothing of this file is applied, and the push is
-- repeated as it is.
--
-- ROLLBACK. There is no down migration, and the bodies of 20260926160000 cannot
-- come back on their own: they never name pinned_rooms, so with
-- tasks_pinned_rooms_whole in place the old save_task fails whenever it sets
-- or clears the dates of a move — a cleaning's first move and every move back
-- onto the departure (23514; a further move of one already moved keeps its
-- rooms and passes) — and the old generator, clearing the dates and leaving
-- the rooms, aborts every run that undoes a move. The rollback is one forward
-- migration that, in one file, drops tasks_pinned_rooms_whole, sets
-- pinned_rooms to null, and restores the three bodies; reservation_rooms and
-- the column may go with it or later — the column only once no deployed panel
-- selects it (the panel that ships with this migration does not). A move then
-- holds through a change of another room, as it did before.

set local lock_timeout = '5s';


/** The rooms a booking took, in property order; '{}' when it named none. */
create or replace function public.reservation_rooms(target_reservation_id bigint)
returns bigint[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(ru.property_id order by ru.property_id), '{}'::bigint[])
  from public.reservation_units ru
  where ru.reservation_id = target_reservation_id
$$;

revoke all on function public.reservation_rooms(bigint) from public, anon, authenticated;


alter table public.tasks add column pinned_rooms bigint[];

comment on column public.tasks.pinned_rooms is
  'Set with pinned_departure when a manager moved a booking''s cleaning off its '
  'departure day: the booking''s rooms at that moment (public.reservation_rooms), '
  '''{}'' for a booking that named none. Any change of them undoes the move of '
  'every cleaning of the booking. Null for every other task.';

update public.tasks t
set pinned_rooms = public.reservation_rooms(t.reservation_id)
where t.pinned_departure is not null;

alter table public.tasks
  add constraint tasks_pinned_rooms_whole
    check ((pinned_rooms is null) = (pinned_departure is null));


/**
 * What an executor may not change on her own task.
 *
 * Unchanged from 20260926160000 apart from pinned_rooms, which joins the two
 * dates of a move: a move is the manager's word on a day.
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
    new.pinned_rooms          := old.pinned_rooms;
  end if;

  return new;
end;
$$;


/**
 * Write a task, or rewrite one (the panel's form).
 *
 * That of 20260926160000 with three changes: a move records the booking's
 * rooms (pinned_rooms) beside its dates; a save that keeps a booking's
 * cleaning on its day keeps the server's window, whatever times it sends; and
 * a save that lands on the day the task already stands on is not refused as
 * moved meanwhile.
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
           -- A cleaning somebody holds is paired first: when the booking keeps
           -- fewer places than it has cleanings — its rooms folded into the
           -- listing, two rooms made one — the one left over is cancelled,
           -- and it should not be the cleaner's (20260927120000).
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
        pinned_departure = null,
        pinned_rooms     = null
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
                    or t.time_from is distinct from w.time_from
                    or t.time_to is distinct from w.time_to
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
        time_from    = f.window_from,
        time_to      = f.window_to
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
           or t.time_from is distinct from f.window_from
           or t.time_to is distinct from f.window_to)
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
