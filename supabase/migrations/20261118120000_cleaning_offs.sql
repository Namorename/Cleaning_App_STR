-- Cleanings taken off (owner, 2026-11-18, CORE): the office cancels any cleaning in any status and
-- returns it; a cleaner declines a cleaning she has not started, or interrupts one she has. The
-- design and the places that count cleanings: docs/rollout/cleaning-offs-1118.md.
--
-- No new status (old phones parse the status strictly): a cancel is «cancelled», as before; a
-- cleaning handed back is «unassigned» with nobody on it, which an old phone reads as free work,
-- and is. What tells them apart is new optional columns, written by the four RPCs below alone:
--
-- - an office cancel: cancelled_at / cancelled_by / cancelled_from (the status before, for the
--   return), cancel_departure (the booking's departure at the cancel: the generator writes no new
--   cleaning for the booking while it keeps that departure) and cancelled_closing (who did and
--   who closed a done or expired cleaning, given back with it);
-- - a hand-back: released_at / released_by / release_kind ('declined' or 'interrupted'), cleared
--   when somebody is put on the job.
--
-- The words of the person — the manager's optional reason, the cleaner's reason (optional for a
-- decline, required for an interrupt) — live in the journal alone (task_events.reason), which only
-- the office reads: a cleaner reads the rows of her listings, and a colleague's reason is not
-- hers to read. task_offs(tasks), a computed field, gives the office the marks with the names and
-- the words.
--
-- Pushes: the cleaner hears «Уборка отменена» as before (a live cleaning of hers); a cleaning
-- returned to her is «Вам назначена уборка»; a hand-back tells every manager and admin of the
-- company (cleaning_declined, cleaning_interrupted). The generator leaves work somebody started
-- and handed back to a human, and gives no cleaning handed back to the listing's regular cleaner.
--
-- Two values of push_kind first: nothing in this file runs a statement that uses them (the
-- trigger reads them at run time, after the commit). Short locks: lock_timeout.

set local lock_timeout = '3s';

-- ---------- the kinds ----------

-- Before booking_cancelled_live: the settings screen lists the kinds in this order.
alter type public.push_kind add value if not exists 'cleaning_declined' before 'booking_cancelled_live';
alter type public.push_kind add value if not exists 'cleaning_interrupted' before 'booking_cancelled_live';

-- ---------- the marks ----------

alter table public.tasks
  add column cancelled_at      timestamptz,
  add column cancelled_by      uuid references public.profiles (id) on delete set null,
  add column cancelled_from    public.task_status,
  add column cancel_departure  date,
  add column cancelled_closing jsonb,
  add column released_at       timestamptz,
  add column released_by       uuid references public.profiles (id) on delete set null,
  add column release_kind      text,
  add constraint tasks_office_cancel_is_cancelled
    check (cancelled_at is null or status = 'cancelled'),
  add constraint tasks_release_kind_known
    check (release_kind in ('declined', 'interrupted')),
  add constraint tasks_release_mark_whole
    check ((released_at is null) = (release_kind is null));

comment on column public.tasks.cancelled_at is
  'The office cancelled this cleaning (cancel_cleaning, 20261118120000); null for a cancel by a booking or before then.';
comment on column public.tasks.cancelled_from is
  'The status before the office cancel: restore_cleaning returns the cleaning to it.';
comment on column public.tasks.cancel_departure is
  'The booking''s departure at the office cancel: while the booking keeps it, the generator writes no new cleaning.';
comment on column public.tasks.cancelled_closing is
  'The task_closings row of a done or expired cleaning before the office cancel, given back by restore_cleaning.';
comment on column public.tasks.released_at is
  'A cleaner handed the cleaning back (decline_cleaning, interrupt_cleaning, 20261118120000); cleared when somebody is put on it.';
comment on column public.tasks.release_kind is
  'declined: before starting it; interrupted: after starting it, the steps and photos kept.';

-- ---------- the journal ----------

alter table public.task_events
  add column reason text
    constraint task_events_reason_length check (char_length(reason) <= 500);

comment on column public.task_events.reason is
  'The person''s own words for a cancel or a hand-back, as typed (20261118120000); never a text of the server.';

alter table public.task_events
  drop constraint task_events_cause_known,
  add constraint task_events_cause_known check (cause in (
    'manager', 'head_tech', 'staff', 'staff_inactive',
    'booking_cancelled', 'property_unavailable', 'booking_changed', 'system',
    'declined', 'interrupted'));

-- ---------- what changes in the functions that are there ----------
-- Each body is the live one (md5 checked against the cloud) with the lines marked 20261118120000.

CREATE OR REPLACE FUNCTION public.guard_task_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- The marks of an office cancel and of a cleaner handing her cleaning back
  -- (20261118120000) are written by cancel_cleaning, decline_cleaning and
  -- interrupt_cleaning alone, each naming its row in str_ops.cleaning_off: no
  -- client writes them by hand, the office included.
  if (select auth.uid()) is not null
     and coalesce(current_setting('str_ops.cleaning_off', true), '') <> old.id::text then
    new.cancelled_at      := old.cancelled_at;
    new.cancelled_by      := old.cancelled_by;
    new.cancelled_from    := old.cancelled_from;
    new.cancel_departure  := old.cancel_departure;
    new.cancelled_closing := old.cancelled_closing;
    new.released_at       := old.released_at;
    new.released_by       := old.released_by;
    new.release_kind      := old.release_kind;
  end if;
  -- Somebody new on the job: who handed it back last is history (task_events).
  if new.assignee_id is not null and new.assignee_id is distinct from old.assignee_id then
    new.released_at  := null;
    new.released_by  := null;
    new.release_kind := null;
  end if;
  -- Out of «cancelled» by whatever road: the office's cancel is over.
  if old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    new.cancelled_at      := null;
    new.cancelled_by      := null;
    new.cancelled_from    := null;
    new.cancel_departure  := null;
    new.cancelled_closing := null;
  end if;

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
$function$
;

comment on function public.guard_task_fields() is 'What an executor may not change on her own task, and the marks of a cancel or a hand-back nobody writes by hand (20261118120000).';

CREATE OR REPLACE FUNCTION public.guard_task_transitions()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_running   integer;
  v_allowed   boolean;
  v_remaining integer;
  v_opens_at  timestamptz;
  v_timezone  text;
  v_office    boolean;
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  -- The office: a manager, or the head technician dispatching a repair
  -- through assign_problem or unassign_problem (20261003130000). Asked once.
  v_office := public.is_manager() or public.head_tech_dispatching();

  -- A cleaner handing her cleaning back through decline_cleaning or
  -- interrupt_cleaning (20261118120000), which ask whose it is and in which
  -- status themselves: the one road back to «unassigned» an executor has.
  if coalesce(current_setting('str_ops.cleaning_off', true), '') = new.id::text
     and new.status = 'unassigned' and new.assignee_id is null then
    return new;
  end if;

  -- A take says so: an executor who puts her name on free work moves it out
  -- of 'unassigned'. Her name on a row left 'unassigned' would make it neither
  -- free (gone from the queue) nor hers (nothing says she took it) — night
  -- review 2026-09-29. The trigger wakes for assignee_id too, for this.
  if new.status = 'unassigned'
     and new.assignee_id is distinct from old.assignee_id
     and not v_office then
    raise exception 'An executor takes free work by moving it out of unassigned'
      using errcode = 'check_violation',
            hint = 'serverErrors.transitionNotAllowed',
            detail = jsonb_build_object('from', old.status, 'to', new.status)::text;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not v_office
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
    if not v_office then
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
    if not v_office then
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
$function$
;


CREATE OR REPLACE FUNCTION public.journal_task_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor    uuid := (select auth.uid());
  -- A cause a server function named for this transaction.
  v_named    text := nullif(current_setting('str_ops.task_cause', true), '');
  -- What the writer's role says, when the change itself says nothing more.
  v_by_actor text;
  v_person   boolean;
  v_moved    boolean;
  v_kind     public.task_event_kind;
  v_params   jsonb;
  v_cause    text;
  -- Her or the manager's own words for a cancel or a hand-back (20261118120000).
  v_reason   text := nullif(btrim(coalesce(current_setting('str_ops.task_reason', true), '')), '');
begin
  -- A name the journal does not know is ignored: the write it describes must
  -- not fail on the check of task_events.cause.
  if v_named not in ('manager', 'head_tech', 'staff', 'staff_inactive', 'booking_cancelled',
                     'property_unavailable', 'booking_changed', 'system',
                     'declined', 'interrupted') then
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
    insert into public.task_events (host_id, task_id, kind, actor_id, params)
    values (new.host_id, new.id, 'created', v_actor,
            jsonb_build_object(
              'source', case when new.reservation_id is null then 'manual' else 'booking' end,
              'date', new.scheduled_date,
              'status', new.status));
    if new.assignee_id is not null then
      insert into public.task_events (host_id, task_id, kind, actor_id, params)
      values (new.host_id, new.id, 'assigned', v_actor,
              jsonb_build_object('to', new.assignee_id));
    end if;
    return null;
  end if;

  v_person := new.assignee_id is distinct from old.assignee_id;
  v_moved  := new.scheduled_date is distinct from old.scheduled_date
              or new.property_id is distinct from old.property_id;

  -- The person.
  if v_person then
    if old.assignee_id is null then
      v_kind := 'assigned';
      v_params := jsonb_build_object('to', new.assignee_id);
      v_cause := null;
    elsif new.assignee_id is null then
      v_kind := 'unassigned';
      v_params := jsonb_build_object('from', old.assignee_id);
      v_cause := coalesce(
        v_named,
        case when exists (select 1 from public.profiles p
                          where p.id = old.assignee_id and not p.is_active)
             then 'staff_inactive' end,
        v_by_actor,
        'system');
    else
      v_kind := 'reassigned';
      v_params := jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id);
      v_cause := null;
    end if;
    insert into public.task_events (host_id, task_id, kind, actor_id, cause, params, reason)
    values (new.host_id, new.id, v_kind, v_actor, v_cause, v_params,
            case when v_kind = 'unassigned' then v_reason end);
  end if;

  -- The day or the place.
  if v_moved then
    insert into public.task_events (host_id, task_id, kind, actor_id, cause, params)
    values (new.host_id, new.id, 'moved', v_actor,
            coalesce(v_named, v_by_actor,
                     case when new.reservation_id is null then 'system' else 'booking_changed' end),
            jsonb_strip_nulls(jsonb_build_object(
              'from_date', case when new.scheduled_date is distinct from old.scheduled_date
                                then old.scheduled_date end,
              'to_date', case when new.scheduled_date is distinct from old.scheduled_date
                              then new.scheduled_date end,
              'from_property', case when new.property_id is distinct from old.property_id
                                    then old.property_id end,
              'to_property', case when new.property_id is distinct from old.property_id
                                  then new.property_id end)));
  end if;

  if new.status is not distinct from old.status then
    return null;
  end if;

  -- The status.
  v_kind := case
    when new.status = 'cancelled' then 'cancelled'
    when new.status = 'expired' then 'expired'
    when new.status = 'done' then 'completed'
    when old.status in ('done', 'cancelled', 'expired') then 'reopened'
    when new.status = 'in_progress' and old.status in ('unassigned', 'assigned', 'accepted')
      then 'started'
    when new.status = 'accepted' and old.status in ('unassigned', 'assigned')
      then 'accepted'
    -- What a change of person does to the status (waiting again, or accepted
    -- by nobody yet) is said by that change. A move is not: an accepted
    -- cleaning moved to another day is assigned again, and says so.
    when v_person and new.status in ('unassigned', 'assigned') then null
    else 'status_changed'
  end;

  if v_kind is null then
    return null;
  end if;

  v_params := case v_kind
    when 'cancelled' then jsonb_strip_nulls(jsonb_build_object(
                            'from', old.status, 'assignee', old.assignee_id))
    when 'expired' then jsonb_strip_nulls(jsonb_build_object('assignee', old.assignee_id))
    when 'reopened' then jsonb_build_object('from', old.status)
    when 'status_changed' then jsonb_build_object('from', old.status, 'to', new.status)
    else '{}'::jsonb
  end;

  v_cause := null;
  if v_kind = 'cancelled' then
    v_cause := coalesce(
      v_named,
      v_by_actor,
      case
        -- The generator's rule of a live booking (20260926102000).
        when new.reservation_id is not null
             and not exists (select 1 from public.reservations r
                             where r.id = new.reservation_id
                               and r.status in ('new', 'modified')
                               and not r.is_block
                               and not public.is_service_booking(r.guest_name))
          then 'booking_cancelled'
        -- The generator wants active places only: the room, or its listing.
        when exists (select 1
                     from public.properties p
                     left join public.properties l
                       on l.id = p.parent_id and p.hostaway_unit_id is not null
                     where p.id = new.property_id
                       and (p.status <> 'active' or l.status <> 'active'))
          then 'property_unavailable'
        when new.reservation_id is null then 'system'
        else 'booking_changed'
      end);
  end if;

  insert into public.task_events (host_id, task_id, kind, actor_id, cause, params, reason)
  values (new.host_id, new.id, v_kind, v_actor, v_cause, v_params,
          case when v_kind = 'cancelled' then v_reason end);
  return null;
end;
$function$
;

comment on function public.journal_task_change() is 'Trigger on tasks that are not the repair of a problem: writes each change of person, day, place and status into task_events (20261015100000); a cancel or a hand-back with its reason (20261118120000).';

CREATE OR REPLACE FUNCTION public.generate_cleaning_tasks(from_date date, to_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- Work somebody started and handed back is a human's to place (20261118120000).
      and t.started_at is null
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
                        and (x.status not in ('cancelled', 'expired')
                             -- ...or the office cancelled it for this departure (20261118120000).
                             or (x.status = 'cancelled' and x.cancelled_at is not null
                                 and x.cancel_departure = w.scheduled_date)))
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
             -- The office cancelled it, and the booking still leaves that day: the
             -- cancel holds (owner, 2026-11-18). A new departure is another
             -- cleaning, owed again (20261118120000).
             or (t.status = 'cancelled'
                 and t.cancelled_at is not null
                 and t.cancel_departure = w.scheduled_date)
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
      -- Started and handed back: a human's to move (20261118120000).
      and t.started_at is null
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
      -- Not a cleaning a cleaner handed back: it would go straight back to her
      -- (20261118120000). The manager decides.
      and t.released_at is null
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
      -- Work under way handed back is work under way (20261118120000).
      and t.started_at is null
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
$function$
;


CREATE OR REPLACE FUNCTION public.push_on_task_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor  uuid := (select auth.uid());
  -- The office: a manager, or the head technician dispatching a repair through
  -- assign_problem or unassign_problem (20261003130000). His move reads as
  -- the office's, not as a booking's (20261003160000).
  v_office boolean := v_actor is not null
                      and (coalesce(public.is_manager(), false) or public.head_tech_dispatching());
  -- unassign_problem cancels the attempt under the dispatch setting, and
  -- nothing else cancels under it: for the technician the work is taken from
  -- him, not cancelled (20261003160000).
  v_taken_off boolean := coalesce(current_setting('str_ops.head_tech_dispatch', true), '') = 'on';
  -- Asked once a statement, not once a row: a SQL function with its own
  -- search_path is never inlined, and a dozen such calls a row cost 0.3-0.5 ms
  -- a row with an event (measured 2026-09-28, 660 rows, rolled back).
  v_grace      integer := public.task_grace_days();
  v_horizon    integer := public.task_horizon_days();
  v_lifetime   interval := public.push_lifetime();
  v_now_after  timestamptz := public.push_send_after(true);
  v_calm_after timestamptz := public.push_send_after(false);
begin
  -- Everything below is about people with a phone. Without one registered in
  -- the company the statement has nobody to tell: the common case until the
  -- first phone arrives, and the whole cost of this trigger then.
  if not exists (select 1 from public.push_tokens) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    with ev as materialized (
      -- A new row with a name on it: new work from the generator, an
      -- assignment from the office.
      select n.host_id, n.assignee_id as recipient_id,
             (case when v_actor is null then 'cleaning_new' else 'cleaning_assigned' end)::public.push_kind as kind,
             n.id as task_id, n.property_id,
             n.scheduled_date as day_a, n.scheduled_date as day_b,
             jsonb_build_object('date', n.scheduled_date, 'type', n.type,
                                'property', n.property_id) as params
      from new_rows n
      where n.assignee_id is not null
        and n.status in ('assigned', 'accepted')
    ),
    free as materialized (
      -- Only what a cleaner may take from the queue (apps/mobile tasks/api.ts,
      -- FREE_TASK_TYPES): an inspection or maintenance is the office's.
      select n.host_id, n.id as task_id, n.property_id, n.scheduled_date, n.type
      from new_rows n
      where n.assignee_id is null
        and n.status = 'unassigned'
        and n.type in ('cleaning', 'midstay')
    )
    insert into raw.push_outbox (host_id, recipient_id, kind, task_id, collapse_key,
                                 params, urgent, send_after, expire_at)
    select e.host_id, e.recipient_id, e.kind, e.task_id, 'task:' || e.task_id,
           e.params, w.urgent,
           case when w.urgent then v_now_after else v_calm_after end,
           case when w.urgent then v_now_after else v_calm_after end + v_lifetime
    from (
      select * from ev
      union all
      -- Free work: everyone who may take it. The listing rule is the twin of
      -- the one in the policies, asked only after the week and the phones have
      -- cut the candidates down — and only of phones linked to the listing, or
      -- to the listing a room belongs to (owner's word 2026-09-29): nobody
      -- else may take it, and asking every phone of the company cost a call a
      -- phone a cleaning. A narrowing, not a second rule: the rule decides.
      select f.host_id, tk.profile_id, 'cleaning_free'::public.push_kind, f.task_id, f.property_id,
             f.scheduled_date, f.scheduled_date,
             jsonb_build_object('date', f.scheduled_date, 'type', f.type, 'property', f.property_id)
      from free f
      join public.properties p on p.id = f.property_id
      -- The candidates come from the listing's own people: a lateral join, so
      -- the rule below is asked of them alone. As a qual beside the rule the
      -- narrowing would be ordered by cost, and the rule, cheaper on paper
      -- than a subquery, went first for every phone.
      join lateral (
        select distinct pc.cleaner_id as profile_id
        from public.property_cleaners pc
        where pc.property_id in (f.property_id, p.parent_id)
          and exists (select 1 from public.push_tokens t where t.profile_id = pc.cleaner_id)
      ) tk on true
      join public.profiles pr on pr.id = tk.profile_id and pr.host_id = f.host_id
      where f.scheduled_date between (now() at time zone p.timezone)::date - v_grace
                                 and (now() at time zone p.timezone)::date + v_horizon
        and public.cleans_property_as(tk.profile_id, f.property_id)
    ) e
    join public.properties p on p.id = e.property_id
    join public.profiles pr on pr.id = e.recipient_id and pr.is_active
    cross join lateral (
      select (now() at time zone p.timezone)::date as today
    ) d
    cross join lateral (
      -- Urgent is what changes her day: taken off her, cancelled or moved,
      -- today or tomorrow (§1.4). New, handed-over and free work can wait out
      -- quiet hours: it goes at seven, before the day starts.
      select (e.kind in ('cleaning_cancelled', 'cleaning_moved', 'cleaning_unassigned')
              and (e.day_a in (d.today, d.today + 1) or e.day_b in (d.today, d.today + 1))) as urgent
    ) w
    where e.recipient_id is distinct from v_actor
      and (e.day_a between d.today - v_grace and d.today + v_horizon
           or e.day_b between d.today - v_grace and d.today + v_horizon)
      and exists (select 1 from public.push_tokens t where t.profile_id = e.recipient_id)
    order by e.task_id, e.recipient_id, e.kind;

    return null;
  end if;

  -- UPDATE
  with pair as materialized (
    select o.id, n.host_id, n.property_id, n.type,
           o.status as old_status, n.status as new_status,
           o.assignee_id as old_assignee, n.assignee_id as new_assignee,
           o.scheduled_date as old_day, n.scheduled_date as new_day,
           o.property_id as old_property,
           o.time_from as old_from, n.time_from as new_from,
           o.time_to as old_to, n.time_to as new_to,
           o.released_at as old_released, n.released_at as new_released,
           n.release_kind
    from old_rows o
    join new_rows n on n.id = o.id
    where o.status is distinct from n.status
       or o.assignee_id is distinct from n.assignee_id
       or o.scheduled_date is distinct from n.scheduled_date
       or o.property_id is distinct from n.property_id
       or o.time_from is distinct from n.time_from
       or o.time_to is distinct from n.time_to
  ),
  ev as (
    -- Handed to her — work already under way or paused included: she now
    -- holds what somebody else started.
    select x.host_id, x.new_assignee as recipient_id, 'cleaning_assigned'::public.push_kind as kind,
           x.id as task_id, x.property_id, x.new_day as day_a, x.new_day as day_b,
           jsonb_build_object('date', x.new_day, 'type', x.type, 'property', x.property_id) as params
    from pair x
    where x.new_assignee is not null
      -- ...or given back to her: the office returned a cancelled cleaning (20261118120000).
      and (x.new_assignee is distinct from x.old_assignee or x.old_status = 'cancelled')
      and x.new_status in ('assigned', 'accepted', 'in_progress', 'paused', 'blocked')
    union all
    -- Taken from her, and not by being cancelled or closed.
    select x.host_id, x.old_assignee, 'cleaning_unassigned', x.id, x.property_id,
           x.old_day, x.old_day,
           jsonb_build_object('date', x.old_day, 'type', x.type, 'property', x.old_property)
    from pair x
    where x.old_assignee is not null
      and x.new_assignee is distinct from x.old_assignee
      and x.old_status not in ('done', 'cancelled', 'expired')
      and x.new_status not in ('done', 'cancelled', 'expired')
    union all
    -- Cancelled while open, work under way included. Taken off through
    -- unassign_problem, it is taken from her rather than cancelled.
    select x.host_id, x.old_assignee,
           (case when v_taken_off then 'cleaning_unassigned'
                 else 'cleaning_cancelled' end)::public.push_kind,
           x.id, x.property_id,
           x.old_day, x.old_day,
           jsonb_build_object('date', x.old_day, 'type', x.type, 'property', x.old_property)
    from pair x
    where x.new_status = 'cancelled'
      and x.old_status not in ('done', 'cancelled', 'expired')
      and x.old_assignee is not null
    union all
    -- Moved to another day or room while hers and not started.
    select x.host_id, x.new_assignee, 'cleaning_moved', x.id, x.property_id,
           x.old_day, x.new_day,
           jsonb_build_object('from_date', x.old_day, 'to_date', x.new_day,
                              'from_property', x.old_property, 'to_property', x.property_id,
                              'property', x.property_id, 'type', x.type,
                              'by', case when v_office then 'office' else 'booking' end)
    from pair x
    where x.new_assignee is not null
      and x.new_assignee = x.old_assignee
      and x.old_status in ('assigned', 'accepted')
      and x.new_status in ('assigned', 'accepted')
      and (x.new_day is distinct from x.old_day or x.property_id is distinct from x.old_property)
    union all
    -- The hours changed on the same day and room. Only today's and
    -- tomorrow's: the filter below keeps those.
    select x.host_id, x.new_assignee, 'cleaning_window', x.id, x.property_id,
           x.new_day, x.new_day,
           jsonb_build_object('date', x.new_day, 'time_from', x.new_from, 'time_to', x.new_to,
                              'type', x.type, 'property', x.property_id)
    from pair x
    where x.new_assignee is not null
      and x.new_assignee = x.old_assignee
      and x.old_status in ('assigned', 'accepted')
      and x.new_status in ('assigned', 'accepted')
      and x.new_day = x.old_day
      and x.property_id = x.old_property
      and (x.new_from is distinct from x.old_from or x.new_to is distinct from x.old_to)
    union all
    -- A cleaner handed her cleaning back (20261118120000): declined it before
    -- starting, or interrupted it. Every manager and admin of the company hears
    -- who and which cleaning; her own words wait in the panel.
    select x.host_id, m.id,
           (case x.release_kind when 'declined' then 'cleaning_declined'
                                else 'cleaning_interrupted' end)::public.push_kind,
           x.id, x.property_id, x.new_day, x.new_day,
           jsonb_build_object('date', x.new_day, 'type', x.type, 'property', x.property_id,
                              'by', x.old_assignee, 'by_name', who.full_name)
    from pair x
    join public.profiles m
      on m.host_id = x.host_id and m.role in ('manager', 'admin') and m.is_active
    left join public.profiles who on who.id = x.old_assignee
    where x.release_kind is not null
      and x.new_released is distinct from x.old_released
  ),
  free as materialized (
    -- Free work newly in reach: it became free, or free work moved (the
    -- audience below keeps a move only when it came into the week). Only what
    -- a cleaner may take from the queue, as on INSERT.
    select x.host_id, x.id as task_id, x.property_id, x.new_day, x.old_day, x.type, x.old_assignee,
           (x.old_status is distinct from 'unassigned' or x.old_assignee is not null) as became_free
    from pair x
    where x.new_status = 'unassigned'
      and x.new_assignee is null
      and x.type in ('cleaning', 'midstay')
      and (x.old_status is distinct from 'unassigned' or x.old_assignee is not null
           or x.old_day is distinct from x.new_day)
  )
  insert into raw.push_outbox (host_id, recipient_id, kind, task_id, collapse_key,
                               params, urgent, send_after, expire_at)
  select e.host_id, e.recipient_id, e.kind, e.task_id, 'task:' || e.task_id,
         e.params, w.urgent,
         case when w.urgent then v_now_after else v_calm_after end,
         case when w.urgent then v_now_after else v_calm_after end + v_lifetime
  from (
    select * from ev
    union all
    select f.host_id, tk.profile_id, 'cleaning_free'::public.push_kind, f.task_id, f.property_id,
           f.new_day, f.new_day,
           jsonb_build_object('date', f.new_day, 'type', f.type, 'property', f.property_id)
    from free f
    join public.properties p on p.id = f.property_id
    -- Only phones linked to the listing or its house, as on INSERT.
    join lateral (
      select distinct pc.cleaner_id as profile_id
      from public.property_cleaners pc
      where pc.property_id in (f.property_id, p.parent_id)
        and exists (select 1 from public.push_tokens t where t.profile_id = pc.cleaner_id)
    ) tk on true
    join public.profiles pr on pr.id = tk.profile_id and pr.host_id = f.host_id
    where f.new_day between (now() at time zone p.timezone)::date - v_grace
                        and (now() at time zone p.timezone)::date + v_horizon
      and (f.became_free
           or f.old_day not between (now() at time zone p.timezone)::date - v_grace
                                and (now() at time zone p.timezone)::date + v_horizon)
      -- Not the one it was just taken from: she hears it was taken off her,
      -- and "free" would read as an offer of her own cleaning back.
      and tk.profile_id is distinct from f.old_assignee
      and public.cleans_property_as(tk.profile_id, f.property_id)
  ) e
  join public.properties p on p.id = e.property_id
  join public.profiles pr on pr.id = e.recipient_id and pr.is_active
  cross join lateral (
    select (now() at time zone p.timezone)::date as today
  ) d
  cross join lateral (
    -- Urgent: taken off her, cancelled or moved, today or tomorrow (as above).
    select (e.kind in ('cleaning_cancelled', 'cleaning_moved', 'cleaning_unassigned',
                       'cleaning_declined', 'cleaning_interrupted')
            and (e.day_a in (d.today, d.today + 1) or e.day_b in (d.today, d.today + 1))) as urgent
  ) w
  where e.recipient_id is distinct from v_actor
    and (e.day_a between d.today - v_grace and d.today + v_horizon
         or e.day_b between d.today - v_grace and d.today + v_horizon)
    -- The hours matter today and tomorrow only.
    and (e.kind <> 'cleaning_window' or e.day_b in (d.today, d.today + 1))
    and exists (select 1 from public.push_tokens t where t.profile_id = e.recipient_id)
  order by e.task_id, e.recipient_id, e.kind;

  return null;
end;
$function$
;

comment on function public.push_on_task_change() is 'Statement trigger on tasks: writes raw.push_outbox rows for the people a change of a cleaning or repair is about (docs/f11-plan.md, M3).';

CREATE OR REPLACE FUNCTION public.api_v1_list_cleanings(p_digest text, p_date_from date DEFAULT NULL::date, p_date_to date DEFAULT NULL::date, p_property_id bigint DEFAULT NULL::bigint, p_assignee_id uuid DEFAULT NULL::uuid, p_status text[] DEFAULT NULL::text[], p_type text[] DEFAULT NULL::text[], p_updated_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_date date DEFAULT NULL::date, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'cleanings:read');
begin
  return (
    select coalesce(jsonb_agg(public.api_cleaning_json(t, v_ctx.scopes) order by t.scheduled_date, t.id), '[]'::jsonb)
    from (select tk.* from public.tasks tk
          where tk.host_id = v_ctx.host_id
            and public.api_allows_property(v_ctx, tk.property_id)
            and (p_date_from is null or tk.scheduled_date >= p_date_from)
            and (p_date_to is null or tk.scheduled_date <= p_date_to)
            and (p_property_id is null or tk.property_id = p_property_id)
            and (p_assignee_id is null or tk.assignee_id = p_assignee_id)
            -- Unfiltered, the cancelled are left out, as on every screen; status=cancelled
            -- lists them (20261118120000).
            and (case when p_status is null then tk.status <> 'cancelled'
                      else tk.status::text = any(p_status) end)
            and (p_type is null or tk.type::text = any(p_type))
            and (p_updated_since is null or tk.updated_at >= p_updated_since)
            and (p_after_id is null or (tk.scheduled_date, tk.id) > (p_after_date, p_after_id))
          order by tk.scheduled_date, tk.id
          limit least(greatest(p_limit, 1), 200) + 1) t);
end;
$function$
;


-- ---------- the office: cancel and return ----------

/**
 * The office calls a cleaning off, whatever its status (owner, 2026-11-18). Nothing is deleted:
 * the steps, the photos and the tasks filed from it stay; the cleaning leaves every list, the
 * calendar, the counters and the cleaner's phone, as every cancelled one does. Who, when and the
 * status before are kept on the row; the reason, optional, in the journal. A booking's cleaning
 * stays cancelled while the booking keeps its departure (the generator, cancel_departure).
 *
 * The cleaner on it hears «Уборка отменена» if it was live (push_on_task_change). Cancelling a
 * cancelled one answers the row as it is: a second tap, or a replay.
 */
create or replace function public.cancel_cleaning(p_task_id uuid, p_reason text default null)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task      public.tasks;
  v_reason    text := nullif(btrim(coalesce(p_reason, '')), '');
  v_departure date;
  v_closing   jsonb;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'A reason is at most 500 characters'
      using errcode = 'check_violation', hint = 'serverErrors.reasonTooLong',
            detail = jsonb_build_object('max', 500)::text;
  end if;

  -- A repair of a problem is called off with its problem (cancel_problem).
  select t.* into v_task
  from public.tasks t
  where t.id = p_task_id
    and t.host_id = public.current_host_id()
    and t.problem_id is null
  for update;

  if not found then
    raise exception 'Cleaning % not found', p_task_id
      using errcode = 'no_data_found', hint = 'serverErrors.taskNotFound';
  end if;
  if v_task.status = 'cancelled' then
    return v_task;
  end if;

  if v_task.reservation_id is not null then
    select r.departure_date into v_departure
    from public.reservations r where r.id = v_task.reservation_id;
  end if;
  -- A closed cleaning's own closing, to give back with it (restore_cleaning).
  if v_task.status in ('done', 'expired') then
    select to_jsonb(c) into v_closing from public.task_closings c where c.task_id = v_task.id;
  end if;

  perform set_config('str_ops.cleaning_off', v_task.id::text, true);
  perform set_config('str_ops.task_reason', coalesce(v_reason, ''), true);

  update public.tasks t
  set status            = 'cancelled',
      cancelled_at      = now(),
      cancelled_by      = (select auth.uid()),
      cancelled_from    = v_task.status,
      cancel_departure  = v_departure,
      cancelled_closing = v_closing
  where t.id = v_task.id
  returning t.* into v_task;

  perform set_config('str_ops.cleaning_off', '', true);
  perform set_config('str_ops.task_reason', '', true);
  return v_task;
end;
$$;

comment on function public.cancel_cleaning(uuid, text) is
  'The office cancels a cleaning in any status, with an optional reason; a soft cancel (20261118120000).';

revoke all on function public.cancel_cleaning(uuid, text) from public, anon;
grant execute on function public.cancel_cleaning(uuid, text) to authenticated;

/**
 * «Вернуть»: a cleaning the office cancelled goes back to the status it had, with the person it
 * had — unless she is switched off since, or it was waiting for somebody: then it is free work.
 * A done or an expired one gets its own closing back. Refused when its booking has another
 * cleaning on that place meanwhile (a departure that moved): two would stand for one.
 *
 * A cancel by a booking is not the office's to undo here: the booking is gone, and the generator
 * would cancel it again. Returning a returned one answers the row as it is.
 */
create or replace function public.restore_cleaning(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task    public.tasks;
  v_to      public.task_status;
  v_who     uuid;
  v_closing jsonb;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select t.* into v_task
  from public.tasks t
  where t.id = p_task_id
    and t.host_id = public.current_host_id()
    and t.problem_id is null
  for update;

  if not found then
    raise exception 'Cleaning % not found', p_task_id
      using errcode = 'no_data_found', hint = 'serverErrors.taskNotFound';
  end if;
  if v_task.status <> 'cancelled' then
    return v_task;
  end if;
  if v_task.cancelled_at is null then
    raise exception 'Cleaning % was not cancelled by the office', p_task_id
      using errcode = 'check_violation', hint = 'serverErrors.taskChangedMeanwhile';
  end if;
  if v_task.type = 'cleaning'
     and v_task.reservation_id is not null
     and exists (select 1 from public.tasks x
                 where x.reservation_id = v_task.reservation_id
                   and x.property_id = v_task.property_id
                   and x.type = 'cleaning'
                   and x.id <> v_task.id
                   and x.status not in ('cancelled', 'expired')) then
    raise exception 'The booking has another cleaning of this place'
      using errcode = 'check_violation', hint = 'serverErrors.cleaningRestoreTaken';
  end if;

  v_to := coalesce(v_task.cancelled_from, 'unassigned');
  v_who := v_task.assignee_id;
  v_closing := v_task.cancelled_closing;
  if v_to in ('unassigned', 'assigned', 'accepted', 'in_progress', 'paused', 'blocked')
     and (v_to = 'unassigned'
          or v_who is null
          or not exists (select 1 from public.profiles p
                         where p.id = v_who and p.host_id = v_task.host_id and p.is_active)) then
    v_to := 'unassigned';
    v_who := null;
  end if;

  -- The marks of the cancel go with it (guard_task_fields).
  update public.tasks t
  set status      = v_to,
      assignee_id = v_who
  where t.id = v_task.id
  returning t.* into v_task;

  -- The stamp has just written the manager as the closer; the closing it had comes back.
  if v_to in ('done', 'expired') and v_closing is not null then
    update public.task_closings c
    set completed_by  = s.completed_by,
        worker_source = s.worker_source,
        closed_by     = s.closed_by,
        closed_how    = s.closed_how,
        closed_cause  = s.closed_cause,
        closer_source = s.closer_source,
        closed_at     = s.closed_at,
        marked_by     = s.marked_by,
        marked_at     = s.marked_at
    from jsonb_populate_record(null::public.task_closings, v_closing) s
    where c.task_id = v_task.id;
  end if;

  return v_task;
end;
$$;

comment on function public.restore_cleaning(uuid) is
  'The office returns a cleaning it cancelled to the status and the person it had (20261118120000).';

revoke all on function public.restore_cleaning(uuid) from public, anon;
grant execute on function public.restore_cleaning(uuid) to authenticated;

-- ---------- the cleaner: decline and interrupt ----------

/**
 * A cleaner hands her cleaning back: nobody is on it any more, it is «unassigned» — free work for
 * an old phone and a new one alike — and the office is told (push_on_task_change). Hers alone, in
 * the statuses the kind allows: a decline before she started, an interrupt after. Her steps and
 * photos stay with the cleaning: whoever is put on it next goes on from them (task_steps is the
 * cleaning's, not the person's). No limit of time (owner, 2026-11-18).
 *
 * A replay of the same hand-back answers the row as it is.
 */
create or replace function public.hand_back_cleaning(p_task_id uuid, p_kind text, p_reason text)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me     uuid := (select auth.uid());
  v_task   public.tasks;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_kind is null or p_kind not in ('declined', 'interrupted') then
    raise exception 'Unknown hand-back %', p_kind using errcode = 'invalid_parameter_value';
  end if;
  if v_me is null or not public.is_active_user() then
    raise exception 'Not signed in' using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;
  if p_kind = 'interrupted' and v_reason is null then
    raise exception 'An interrupt needs a reason'
      using errcode = 'check_violation', hint = 'serverErrors.reasonRequired';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'A reason is at most 500 characters'
      using errcode = 'check_violation', hint = 'serverErrors.reasonTooLong',
            detail = jsonb_build_object('max', 500)::text;
  end if;

  select t.* into v_task
  from public.tasks t
  where t.id = p_task_id
    and t.host_id = public.current_host_id()
    and t.problem_id is null
  for update;

  if not found then
    raise exception 'Cleaning % not found', p_task_id
      using errcode = 'no_data_found', hint = 'serverErrors.taskNotFound';
  end if;
  if v_task.assignee_id is null and v_task.released_by = v_me and v_task.release_kind = p_kind then
    return v_task;
  end if;
  if v_task.assignee_id is distinct from v_me
     or (p_kind = 'declined' and v_task.status not in ('assigned', 'accepted'))
     or (p_kind = 'interrupted' and v_task.status not in ('in_progress', 'paused', 'blocked')) then
    raise exception 'Cleaning % is not hers to hand back as %', p_task_id, p_kind
      using errcode = 'check_violation', hint = 'serverErrors.taskChangedMeanwhile',
            detail = jsonb_build_object('status', v_task.status)::text;
  end if;

  perform set_config('str_ops.cleaning_off', v_task.id::text, true);
  perform set_config('str_ops.task_cause', p_kind, true);
  perform set_config('str_ops.task_reason', coalesce(v_reason, ''), true);

  update public.tasks t
  set assignee_id  = null,
      status       = 'unassigned',
      released_at  = now(),
      released_by  = v_me,
      release_kind = p_kind
  where t.id = v_task.id
  returning t.* into v_task;

  perform set_config('str_ops.cleaning_off', '', true);
  perform set_config('str_ops.task_cause', '', true);
  perform set_config('str_ops.task_reason', '', true);
  return v_task;
end;
$$;

comment on function public.hand_back_cleaning(uuid, text, text) is
  'The body of decline_cleaning and interrupt_cleaning (20261118120000); called by no client.';

revoke all on function public.hand_back_cleaning(uuid, text, text) from public, anon, authenticated;

/** «Отказаться»: her cleaning, given or accepted, not started; the reason optional. */
create or replace function public.decline_cleaning(p_task_id uuid, p_reason text default null)
returns public.tasks
language sql
security definer
set search_path = ''
as $$
  select public.hand_back_cleaning(p_task_id, 'declined', p_reason);
$$;

comment on function public.decline_cleaning(uuid, text) is
  'A cleaner declines her cleaning before starting it (20261118120000).';

revoke all on function public.decline_cleaning(uuid, text) from public, anon;
grant execute on function public.decline_cleaning(uuid, text) to authenticated;

/** «Прервать»: her cleaning under way; the reason required; the steps and photos kept. */
create or replace function public.interrupt_cleaning(p_task_id uuid, p_reason text)
returns public.tasks
language sql
security definer
set search_path = ''
as $$
  select public.hand_back_cleaning(p_task_id, 'interrupted', p_reason);
$$;

comment on function public.interrupt_cleaning(uuid, text) is
  'A cleaner interrupts her cleaning under way, with a reason; somebody else finishes it (20261118120000).';

revoke all on function public.interrupt_cleaning(uuid, text) from public, anon;
grant execute on function public.interrupt_cleaning(uuid, text) to authenticated;

-- ---------- the marks, for the office ----------

/**
 * The office cancel and the hand-back of a cleaning, with the names and the words (a computed
 * field: `offs:task_offs`). The office's alone: a cleaner reads the rows of her listings, not a
 * colleague's reason. Null when there is neither, and for anybody else.
 */
create or replace function public.task_offs(t public.tasks)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cancelled jsonb;
  v_released  jsonb;
begin
  if t.cancelled_at is null and t.released_at is null then
    return null;
  end if;
  if t.host_id is distinct from public.current_host_id() or not coalesce(public.is_manager(), false) then
    return null;
  end if;

  if t.cancelled_at is not null then
    select jsonb_build_object(
             'at', t.cancelled_at,
             'from', t.cancelled_from,
             'by', case when p.id is null then null
                        else jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role) end,
             'reason', (select e.reason from public.task_events e
                        where e.task_id = t.id and e.kind = 'cancelled'
                        order by e.id desc limit 1))
      into v_cancelled
    from (select t.cancelled_by as id) b
    left join public.profiles p on p.id = b.id and p.host_id = t.host_id;
  end if;

  if t.released_at is not null then
    select jsonb_build_object(
             'kind', t.release_kind,
             'at', t.released_at,
             'by', case when p.id is null then null
                        else jsonb_build_object('id', p.id, 'name', p.full_name, 'role', p.role) end,
             'reason', (select e.reason from public.task_events e
                        where e.task_id = t.id and e.kind = 'unassigned'
                          and e.cause in ('declined', 'interrupted')
                        order by e.id desc limit 1))
      into v_released
    from (select t.released_by as id) b
    left join public.profiles p on p.id = b.id and p.host_id = t.host_id;
  end if;

  return jsonb_build_object('cancelled', v_cancelled, 'released', v_released);
end;
$$;

comment on function public.task_offs(public.tasks) is
  'Computed field: the office cancel and the hand-back of a cleaning, with names and reasons; the office''s alone (20261118120000).';

revoke all on function public.task_offs(public.tasks) from public, anon;
grant execute on function public.task_offs(public.tasks) to authenticated;
