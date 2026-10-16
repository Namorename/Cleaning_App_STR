-- The journal of cleanings (docs/dashboard-metrics.md, section 3, item 1;
-- owner's decision of 2026-10-14: step 0 of the owner's dashboard).
--
-- A task row keeps only its latest state: who holds it now, which day, which
-- status. When it was handed out, accepted, cancelled and why, expired or
-- moved is written nowhere — the dashboard cannot say how long a cleaning
-- waited for a person, who held it on its day, or how often the plan moved.
-- task_events is that history, written from the day of rollout; the past is
-- not reconstructed.
--
-- - One row per event: the kind, who did it (auth.uid() of the write; null for
--   the system — the generator, the nightly sweep), when (`at`, the clock at
--   the write, not the start of its transaction: the generator's long run must
--   not date its events before a maid's accept that came in meanwhile), and
--   the parameters as jsonb: ids, days, statuses. Never text (CLAUDE.md). The
--   order of one task's events is the order of id.
--
-- - Every task that is not the repair of a reported problem: cleanings,
--   mid-stay cleanings, inspections, hand-made repairs. A repair of a problem
--   (problem_id set) keeps its history in problem_events (20261003140000).
--
-- - `cause` says why for the three events that need it — a cancellation, a
--   person taken away, a move:
--     manager / head_tech / staff — the role of the person who wrote it;
--     staff_inactive — her account was switched off (release_work_of_inactive);
--     booking_cancelled — the system dropped it, its booking is no longer live;
--     property_unavailable — the system dropped it, its room or listing is
--       not active (the generator wants active places only);
--     booking_changed — the system dropped or moved it under a live booking;
--     system — any other write with no user.
--   A server function that knows better names one of these through the
--   transaction-local setting str_ops.task_cause; the trigger takes it first,
--   and ignores a value that is not one of them rather than fail the write.
--
-- - Written by triggers alone; a write that changes none of the watched
--   columns calls nothing (the WHEN clause), so a replay writes no event. The
--   maid's flow is not touched: the triggers run after the row is written and
--   never refuse it.
--
-- - Read by the manager of the company through RLS; no client writes at all:
--   revoke all, then SELECT alone.
--
-- New type, table and function, two new triggers on tasks. Creating a trigger
-- takes a SHARE ROW EXCLUSIVE lock on tasks for a moment; hence the lock
-- timeout.

set local lock_timeout = '3s';

-- ---------- the kinds ----------

create type public.task_event_kind as enum (
  'created',         -- the task was made (params: source, date, status)
  'assigned',        -- a person given, or taken from the queue (params: to)
  'reassigned',      -- another person (params: from, to)
  'unassigned',      -- the person taken away (params: from; cause)
  'accepted',        -- the person said "I'm taking it"
  'started',         -- the work began
  'completed',       -- the work was done
  'cancelled',       -- cancelled (params: from, assignee; cause)
  'expired',         -- swept as not done in time (params: assignee)
  'moved',           -- another day or another place (params: from_date, to_date, from_property, to_property; cause)
  'reopened',        -- a closed task back on the board (params: from)
  'status_changed'   -- any other move of the status (params: from, to)
);

comment on type public.task_event_kind is
  'What happened to a task that is not the repair of a problem (task_events, 20261015100000).';

-- ---------- the journal ----------

create table public.task_events (
  id        bigint generated always as identity primary key,
  host_id   uuid not null references public.hosts (id) on delete restrict,
  task_id   uuid not null references public.tasks (id) on delete cascade,
  kind      public.task_event_kind not null,
  -- Who did it: auth.uid() of the write; null for the system.
  actor_id  uuid references public.profiles (id) on delete set null,
  at        timestamptz not null default clock_timestamp(),
  cause     text
            constraint task_events_cause_known check (cause in (
              'manager', 'head_tech', 'staff', 'staff_inactive',
              'booking_cancelled', 'property_unavailable', 'booking_changed', 'system')),
  -- Ids, days, statuses. Never text.
  params    jsonb not null default '{}'::jsonb
            constraint task_events_params_object check (jsonb_typeof(params) = 'object')
);

comment on table public.task_events is
  'The history of a task that is not the repair of a problem, from the day of '
  'rollout (20261015100000): one row per event, written by triggers on tasks. '
  'Read by the manager; written by no client.';

-- The history of one task, in order.
create index task_events_task_idx on public.task_events (task_id, at, id);
-- The dashboard reads a company's events over a period.
create index task_events_host_at_idx on public.task_events (host_id, at);

alter table public.task_events enable row level security;
revoke all on public.task_events from public, anon, authenticated, service_role;
grant select on public.task_events to authenticated, service_role;

create policy "managers read task events"
  on public.task_events for select
  to authenticated
  using ((select public.is_manager())
         and host_id = (select public.current_host_id()));

-- ---------- the trigger ----------

create or replace function public.journal_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
begin
  -- A name the journal does not know is ignored: the write it describes must
  -- not fail on the check of task_events.cause.
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
    insert into public.task_events (host_id, task_id, kind, actor_id, cause, params)
    values (new.host_id, new.id, v_kind, v_actor, v_cause, v_params);
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

  insert into public.task_events (host_id, task_id, kind, actor_id, cause, params)
  values (new.host_id, new.id, v_kind, v_actor, v_cause, v_params);
  return null;
end;
$$;

comment on function public.journal_task_change() is
  'Trigger on tasks that are not the repair of a problem: writes each change of '
  'person, day, place and status into task_events (20261015100000).';

create trigger tasks_journal_cleaning_insert
  after insert on public.tasks
  for each row
  when (new.problem_id is null)
  execute function public.journal_task_change();

create trigger tasks_journal_cleaning_update
  after update of status, assignee_id, scheduled_date, property_id on public.tasks
  for each row
  when (new.problem_id is null
        and (old.status is distinct from new.status
             or old.assignee_id is distinct from new.assignee_id
             or old.scheduled_date is distinct from new.scheduled_date
             or old.property_id is distinct from new.property_id))
  execute function public.journal_task_change();

revoke all on function public.journal_task_change() from public, anon, authenticated;
