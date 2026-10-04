-- The history of a task (docs/tech-plan.md, 3.1; owner's decision 3 of
-- 2026-10-01).
--
-- The head technician sees every task of his company "with its history": who
-- reported it, who handed it out, who accepted, moved, did, took off, closed,
-- archived it. The rows of problems and of their repairs keep only the latest
-- state — a reassignment overwrites the person, an acceptance is a status that
-- the start overwrites, reopen_problem wipes the closing — so the history is a
-- journal of its own, problem_events, written from the day of rollout. The
-- past is not reconstructed.
--
-- - One row per event: the kind, who did it (auth.uid() of the write that
--   caused it; null for the system — a write with no user), when, and the
--   parameters as jsonb: ids, days, hours, statuses. Never text (CLAUDE.md):
--   the reason a manager typed when cancelling stays on the task.
--
-- - Written by triggers alone. On problems: reported, resolved, cancelled,
--   reopened, archived, unarchived — the task's own moves; the statuses its
--   repair drives through the mirror (assigned, in progress, back to open) are
--   the repair's events, not the task's. On the repairs of a task — a
--   maintenance task with a problem_id — every attempt: the person given
--   (assigned), changed (reassigned) or taken away with the attempt left
--   waiting (unassigned), another day or hours (rescheduled), accepted,
--   started, completed, cancelled — as "taken off" when unassign_problem did
--   it, which it does under the dispatch setting of 20261003130000 (nothing
--   else cancels under it) — and any other move of the status the office
--   makes by hand (status_changed, from and to).
--
-- - The trigger on tasks is a row trigger whose WHEN asks for a repair of a
--   task. The generator writes cleanings by the thousand in one statement;
--   for those rows the condition is false, no event is queued and the function
--   is never called (supabase/tests/problem_events.sql counts its calls). It
--   is named to sort before tasks_mirror_problem, so a finished attempt is
--   written before the task it resolves.
--
-- - Read by the manager and the head technician of the company, through RLS;
--   no client writes at all: revoke all, then SELECT alone. The identity
--   sequence is the triggers' (they run as the owner).
--
-- New type, table and functions, three new triggers. Creating a trigger takes
-- a SHARE ROW EXCLUSIVE lock on tasks and problems for a moment; hence the
-- lock timeout.

set local lock_timeout = '3s';

-- ---------- the kinds ----------

create type public.problem_event_kind as enum (
  'reported',           -- the task was reported
  'assigned',           -- an attempt got its person: created with one, or given one while waiting
  'reassigned',         -- another person inside the same attempt
  'unassigned',         -- the person taken away, the attempt left waiting (the office's edit)
  'rescheduled',        -- the same person, another day or other hours
  'accepted',           -- the person accepted the attempt
  'started',            -- the work began
  'completed',          -- the attempt was done
  'attempt_cancelled',  -- the attempt was cancelled: with the task, on archiving, by hand
  'taken_off',          -- the person was taken off through unassign_problem
  'status_changed',     -- any other move of the attempt's status (params: from, to)
  'resolved',           -- the task closed as fixed
  'cancelled',          -- the task closed without a fix
  'reopened',           -- a closed task back on the board (params: from)
  'archived',
  'unarchived'
);

comment on type public.problem_event_kind is
  'What happened to a task or to an attempt to repair it (problem_events, 20261003140000).';

-- ---------- the journal ----------

create table public.problem_events (
  id          bigint generated always as identity primary key,
  host_id     uuid not null references public.hosts (id) on delete restrict,
  problem_id  uuid not null references public.problems (id) on delete cascade,
  -- The attempt an event of the work is about; null for the task's own events.
  task_id     uuid references public.tasks (id) on delete set null,
  kind        public.problem_event_kind not null,
  -- Who did it: auth.uid() of the write; null for the system.
  actor_id    uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- Ids, days, hours, statuses. Never text.
  params      jsonb not null default '{}'::jsonb
              constraint problem_events_params_object check (jsonb_typeof(params) = 'object')
);

comment on table public.problem_events is
  'The history of a task from the day of rollout (20261003140000): one row per '
  'event, written by triggers on problems and on their repairs. Read by the '
  'manager and the head technician; written by no client.';

-- The history of one task, in order.
create index problem_events_problem_idx on public.problem_events (problem_id, created_at, id);
-- A deleted task sets its events' task_id to null; without this the deletion
-- of every task would read the whole journal.
create index problem_events_task_idx on public.problem_events (task_id) where task_id is not null;

alter table public.problem_events enable row level security;
revoke all on public.problem_events from public, anon, authenticated, service_role;
grant select on public.problem_events to authenticated, service_role;

-- Named after the managers' policies and the head technician's of
-- 20261003120000; each asks the role once a query and keeps the company.
create policy "managers read problem events"
  on public.problem_events for select
  to authenticated
  using ((select public.is_manager())
         and host_id = public.current_host_id());

create policy "head tech reads problem events"
  on public.problem_events for select
  to authenticated
  using ((select public.is_head_tech())
         and host_id = public.current_host_id());

-- ---------- the task's own events ----------

create or replace function public.journal_problem_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if tg_op = 'INSERT' then
    insert into public.problem_events (host_id, problem_id, kind, actor_id, params)
    values (new.host_id, new.id, 'reported', v_actor,
            jsonb_strip_nulls(jsonb_build_object('priority', new.priority,
                                                 'property', new.property_id)));
    return null;
  end if;

  -- Closing and reopening. The statuses in between follow the repair and are
  -- its events.
  if new.status is distinct from old.status then
    if new.status in ('resolved', 'cancelled') then
      insert into public.problem_events (host_id, problem_id, kind, actor_id)
      values (new.host_id, new.id, new.status::text::public.problem_event_kind, v_actor);
    elsif old.status in ('resolved', 'cancelled') then
      insert into public.problem_events (host_id, problem_id, kind, actor_id, params)
      values (new.host_id, new.id, 'reopened', v_actor, jsonb_build_object('from', old.status));
    end if;
  end if;

  if new.archived_at is distinct from old.archived_at then
    insert into public.problem_events (host_id, problem_id, kind, actor_id)
    values (new.host_id, new.id,
            case when new.archived_at is null then 'unarchived'
                 else 'archived' end::public.problem_event_kind,
            v_actor);
  end if;

  return null;
end;
$$;

comment on function public.journal_problem_change() is
  'Trigger on problems: writes reported, resolved, cancelled, reopened, archived '
  'and unarchived into problem_events (20261003140000).';

create trigger problems_journal_insert
  after insert on public.problems
  for each row
  execute function public.journal_problem_change();

create trigger problems_journal_update
  after update of status, archived_at on public.problems
  for each row
  when (old.status is distinct from new.status
        or old.archived_at is distinct from new.archived_at)
  execute function public.journal_problem_change();

-- ---------- the attempts ----------

create or replace function public.journal_repair_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_kind   public.problem_event_kind;
  v_params jsonb;
  v_moved  boolean;
  v_person boolean;
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null then
      insert into public.problem_events (host_id, problem_id, task_id, kind, actor_id, params)
      values (new.host_id, new.problem_id, new.id, 'assigned', v_actor,
              jsonb_strip_nulls(jsonb_build_object(
                'to', new.assignee_id, 'date', new.scheduled_date,
                'time_from', new.time_from, 'time_to', new.time_to)));
    end if;
    return null;
  end if;

  -- An attempt moved to another task is the mirror's business; the journal
  -- follows an attempt of one task.
  if new.problem_id is distinct from old.problem_id then
    return null;
  end if;

  v_person := new.assignee_id is distinct from old.assignee_id;
  v_moved  := new.scheduled_date is distinct from old.scheduled_date
              or new.time_from is distinct from old.time_from
              or new.time_to is distinct from old.time_to;

  -- The person, and with a new person the day and hours the attempt now has.
  if v_person then
    v_kind := case when old.assignee_id is null then 'assigned'
                   when new.assignee_id is null then 'unassigned'
                   else 'reassigned' end;
    v_params := case v_kind
      when 'unassigned' then jsonb_build_object('from', old.assignee_id)
      else jsonb_strip_nulls(jsonb_build_object(
             'from', old.assignee_id, 'to', new.assignee_id,
             'from_date', case when new.scheduled_date is distinct from old.scheduled_date
                               then old.scheduled_date end,
             'date', new.scheduled_date,
             'time_from', new.time_from, 'time_to', new.time_to))
    end;
    insert into public.problem_events (host_id, problem_id, task_id, kind, actor_id, params)
    values (new.host_id, new.problem_id, new.id, v_kind, v_actor, v_params);
  elsif v_moved then
    insert into public.problem_events (host_id, problem_id, task_id, kind, actor_id, params)
    values (new.host_id, new.problem_id, new.id, 'rescheduled', v_actor,
            jsonb_strip_nulls(jsonb_build_object(
              'from_date', old.scheduled_date, 'date', new.scheduled_date,
              'time_from', new.time_from, 'time_to', new.time_to)));
  end if;

  if new.status is not distinct from old.status then
    return null;
  end if;

  v_params := '{}'::jsonb;
  v_kind := case
    -- unassign_problem cancels under the dispatch setting (20261003130000);
    -- nothing else cancels an attempt under it.
    when new.status = 'cancelled'
         and coalesce(current_setting('str_ops.head_tech_dispatch', true), '') = 'on'
      then 'taken_off'
    when new.status = 'cancelled' then 'attempt_cancelled'
    when new.status = 'done' then 'completed'
    when new.status = 'in_progress' and old.status in ('unassigned', 'assigned', 'accepted')
      then 'started'
    when new.status = 'accepted' and old.status in ('unassigned', 'assigned')
      then 'accepted'
    -- What a change of person or day does to the status (waiting again, or
    -- accepted by nobody yet) is said by that change.
    when (v_person or v_moved) and new.status in ('unassigned', 'assigned') then null
    else 'status_changed'
  end;

  if v_kind is null then
    return null;
  end if;
  if v_kind in ('taken_off', 'attempt_cancelled') then
    v_params := jsonb_strip_nulls(jsonb_build_object('assignee', old.assignee_id));
  elsif v_kind = 'status_changed' then
    v_params := jsonb_build_object('from', old.status, 'to', new.status);
  end if;

  insert into public.problem_events (host_id, problem_id, task_id, kind, actor_id, params)
  values (new.host_id, new.problem_id, new.id, v_kind, v_actor, v_params);
  return null;
end;
$$;

comment on function public.journal_repair_change() is
  'Trigger on the repairs of tasks: writes each attempt''s events into '
  'problem_events (20261003140000). Never called for a cleaning.';

-- Sorts before tasks_mirror_problem: the attempt's event, then the task's.
create trigger tasks_journal_repair
  after insert or update of status, assignee_id, scheduled_date, time_from, time_to
  on public.tasks
  for each row
  when (new.problem_id is not null and new.type = 'maintenance')
  execute function public.journal_repair_change();

revoke all on function public.journal_problem_change() from public, anon, authenticated;
revoke all on function public.journal_repair_change() from public, anon, authenticated;
