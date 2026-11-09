-- Who did a cleaning and who closed it, and a worker named afterwards (owner's request of
-- 2026-11-09, after the same for tasks in 20261106125000).
--
-- «Уборки» showed the person a cleaning was given to, never who finished it, who cancelled it or
-- why it did not happen. Now each closed cleaning has a row in task_closings:
--
-- - completed_by, worker_source: who did the work, and how that is known —
--     recorded  the person's own finish, stamped by the app;
--     derived   the steps and photos of one person, when someone else closed it;
--     assigned  only the assignment says it;
--     manager   a manager named her, closing it or afterwards.
--   Null is «not stated».
-- - closed_by, closed_how, closed_cause, closer_source, closed_at: who closed it and how —
--   worker | manager | manager_for | manager_self | auto, with the cause of an automatic closing
--   (night_pass, booking_cancelled, booking_changed, property_unavailable, system), recorded by
--   the journal or derived where only one path can have closed it.
--
-- A side table, not columns of tasks: the backfill inserts and moves no row of tasks — not its
-- updated_at (expired_tasks_review reads it as the day a cleaning lapsed), not its seventeen
-- triggers, no push. A trigger after the journal's keeps it: it reads the cause the journal has
-- just written in the same transaction. Reopening a cleaning deletes its row.
--
-- complete_cleaning: a manager closes a live cleaning, naming who did it or nobody («alone»);
-- the cleaning is finished in her name, and no push goes out (a finish has none).
-- name_cleaning_worker, name_problem_worker: a manager names the worker of a closed one that says
-- «not stated». Only the worker and its source change — never a status, a date or the finisher
-- analytics counts (tasks.completed_by) — and closing_marks keeps who named whom, when.
--
-- Analytics for cleaners: a cleaning a manager closed for somebody counts as hers but leaves
-- the minutes and the photo share; closed alone, it is nobody's. Only closings made from now on
-- carry those marks; the past keeps its numbers.
--
-- Tasks (problems) learn completed_by_source too, so both say how the worker is known.
--
-- Dated before the parts of stage 4 that wait in their branches (20261106130000 on).
set local lock_timeout = '5s';

-- The two tables this migration changes, locked at once, in the order a repair's write takes them
-- (a cleaning, then its task): no cleaning closes between the backfill and the trigger, and no
-- lock is raised midway. Inside a block: the CLI takes LOCK there alone, and the lock holds to the
-- migration's commit.
do $lock$
begin
  lock table public.tasks in share row exclusive mode;
  lock table public.problems in access exclusive mode;
end
$lock$;

-- ---------- a cleaning's closing ----------

create table public.task_closings (
  task_id        uuid primary key references public.tasks (id) on delete cascade,
  host_id        uuid not null references public.hosts (id) on delete cascade,
  completed_by   uuid,
  worker_source  text,
  closed_by      uuid,
  closed_how     text,
  closed_cause   text,
  closer_source  text,
  closed_at      timestamptz,
  marked_by      uuid,
  marked_at      timestamptz,
  constraint task_closings_worker_source_known
    check (worker_source in ('recorded', 'derived', 'assigned', 'manager')),
  constraint task_closings_worker_has_source
    check ((completed_by is null) = (worker_source is null)),
  constraint task_closings_closed_how_known
    check (closed_how in ('worker', 'manager', 'manager_for', 'manager_self', 'auto')),
  constraint task_closings_closer_source_known
    check (closer_source in ('recorded', 'derived')),
  constraint task_closings_closed_cause_code
    check (closed_cause ~ '^[a-z_]{1,40}$')
);

comment on table public.task_closings is
  'Who did a closed cleaning and who closed it, with how each is known (20261106125500). '
  'No foreign keys to profiles: the names come through task_closing(tasks).';

create index task_closings_host_idx on public.task_closings (host_id);

alter table public.task_closings enable row level security;
revoke all on public.task_closings from public, anon, authenticated, service_role;
grant select on public.task_closings to authenticated, service_role;

-- The screens read it through task_closing(tasks); the office reads the table too.
create policy "managers read task closings"
  on public.task_closings for select to authenticated
  using ((select public.is_manager()) and host_id = (select public.current_host_id()));

-- ---------- the journal of workers named afterwards ----------

create table public.closing_marks (
  id          bigint generated always as identity primary key,
  host_id     uuid not null references public.hosts (id) on delete cascade,
  task_id     uuid references public.tasks (id) on delete cascade,
  problem_id  uuid references public.problems (id) on delete cascade,
  person_id   uuid not null,
  marked_by   uuid not null,
  marked_at   timestamptz not null default now(),
  constraint closing_marks_one_subject check ((task_id is null) <> (problem_id is null))
);

comment on table public.closing_marks is
  'A worker a manager named afterwards for a closed cleaning or task, and who named her '
  '(20261106125500). Written by name_cleaning_worker and name_problem_worker alone.';

create index closing_marks_host_idx on public.closing_marks (host_id, marked_at);
create index closing_marks_task_idx on public.closing_marks (task_id) where task_id is not null;
create index closing_marks_problem_idx on public.closing_marks (problem_id) where problem_id is not null;

alter table public.closing_marks enable row level security;
revoke all on public.closing_marks from public, anon, authenticated, service_role;
grant select on public.closing_marks to authenticated, service_role;

create policy "managers read closing marks"
  on public.closing_marks for select to authenticated
  using ((select public.is_manager()) and host_id = (select public.current_host_id()));

-- ---------- the stamp ----------

create or replace function public.stamp_task_closing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was    boolean := old.status in ('done', 'cancelled', 'expired');
  v_actor  uuid := (select auth.uid());
  v_choice jsonb := nullif(current_setting('str_ops.task_closing', true), '')::jsonb;
  v_role   public.app_role;
  v_how    text;
  v_by     uuid;
  v_cause  text;
  v_worker uuid;
  v_source text;
begin
  if new.status not in ('done', 'cancelled', 'expired') then
    if v_was then
      delete from public.task_closings c where c.task_id = new.id;
    end if;
    return null;
  end if;

  select pr.role into v_role from public.profiles pr where pr.id = v_actor;

  if v_choice is not null and v_choice ->> 'task' = new.id::text then
    -- complete_cleaning: the manager's word.
    v_how    := v_choice ->> 'how';
    v_by     := v_actor;
    v_worker := nullif(v_choice ->> 'completed_by', '')::uuid;
    v_source := case when v_worker is not null then 'manager' end;
  elsif v_actor is null then
    v_how := 'auto';
    -- The journal's row of this very write says why (its trigger sorts before this one).
    v_cause := case new.status
      when 'expired' then 'night_pass'
      when 'cancelled' then (select e.cause from public.task_events e
                             where e.task_id = new.id and e.kind::text = 'cancelled'
                               and e.at >= now()
                             order by e.id desc limit 1)
    end;
    if new.status = 'done' and new.completed_by is not null then
      v_worker := new.completed_by;
      v_source := 'recorded';
    end if;
  elsif v_role in ('manager', 'admin') then
    v_how := 'manager';
    v_by  := v_actor;
    -- The guard writes the manager as the finisher when nobody is named: that names nobody.
    if new.status = 'done' and new.completed_by is distinct from v_actor and new.completed_by is not null then
      v_worker := new.completed_by;
      v_source := 'manager';
    end if;
  else
    v_how := 'worker';
    v_by  := v_actor;
    if new.status = 'done' and new.completed_by is not null then
      v_worker := new.completed_by;
      v_source := 'recorded';
    end if;
  end if;

  insert into public.task_closings as c
    (task_id, host_id, completed_by, worker_source, closed_by, closed_how, closed_cause,
     closer_source, closed_at)
  values (new.id, new.host_id, v_worker, v_source, v_by, v_how, v_cause, 'recorded', now())
  on conflict (task_id) do update
  set completed_by  = excluded.completed_by,
      worker_source = excluded.worker_source,
      closed_by     = excluded.closed_by,
      closed_how    = excluded.closed_how,
      closed_cause  = excluded.closed_cause,
      closer_source = excluded.closer_source,
      closed_at     = excluded.closed_at,
      marked_by     = null,
      marked_at     = null;
  return null;
end;
$$;

comment on function public.stamp_task_closing() is
  'Trigger on tasks: who did a cleaning and who closed it, on every path that closes one; a '
  'reopening deletes it (20261106125500).';

revoke all on function public.stamp_task_closing() from public, anon, authenticated, service_role;

-- ---------- the past ----------
-- Before the trigger exists. Only the new table is written.

with closed as (
  select t.id, t.host_id, t.status, t.assignee_id, t.completed_by, t.completed_at,
         case t.status when 'done' then 'completed' else t.status::text end as kind
  from public.tasks t
  where t.problem_id is null
    and t.status in ('done', 'cancelled', 'expired')
),
facts as (
  select c.*,
         e.id is not null as has_event,
         e.actor_id,
         e.at as event_at,
         e.cause,
         er.role as actor_role,
         cr.role as finisher_role,
         ar.role as assignee_role,
         w.people as evidence
  from closed c
  left join lateral (select ev.id, ev.actor_id, ev.at, ev.cause from public.task_events ev
                     where ev.task_id = c.id and ev.kind::text = c.kind
                     order by ev.at desc, ev.id desc
                     limit 1) e on true
  left join public.profiles er on er.id = e.actor_id
  left join public.profiles cr on cr.id = c.completed_by
  left join public.profiles ar on ar.id = c.assignee_id
  -- The work's own traces: who completed its steps and who uploaded its files.
  left join lateral (select array_agg(distinct p.person) as people
                     from (select s.completed_by as person from public.task_steps s
                           where s.task_id = c.id and s.completed_by is not null
                           union
                           select m.created_by from public.task_media m
                           where m.task_id = c.id and m.uploaded_at is not null) p
                     join public.profiles pp on pp.id = p.person
                     where pp.role not in ('manager', 'admin')) w on c.status = 'done'
),
said as (
  select f.id, f.host_id,
         -- The worker of a finished cleaning.
         case
           when f.status <> 'done' then null
           when f.finisher_role is not null and f.finisher_role not in ('manager', 'admin')
                and (not f.has_event or f.actor_id is not distinct from f.completed_by)
             then f.completed_by
           when cardinality(f.evidence) = 1 then f.evidence[1]
           when coalesce(cardinality(f.evidence), 0) = 0
                and f.assignee_role is not null and f.assignee_role not in ('manager', 'admin')
             then f.assignee_id
         end as completed_by,
         case
           when f.status <> 'done' then null
           when f.finisher_role is not null and f.finisher_role not in ('manager', 'admin')
                and (not f.has_event or f.actor_id is not distinct from f.completed_by)
             then 'recorded'
           when cardinality(f.evidence) = 1 then 'derived'
           when coalesce(cardinality(f.evidence), 0) = 0
                and f.assignee_role is not null and f.assignee_role not in ('manager', 'admin')
             then 'assigned'
         end as worker_source,
         -- Who closed it.
         case
           when f.has_event and f.actor_role in ('manager', 'admin') then 'manager'
           when f.has_event and f.actor_role is not null then 'worker'
           when f.has_event and f.actor_id is null then 'auto'
           -- No journal row (before 16.10): the finisher's stamp; a lapse has one path, the night.
           when not f.has_event and f.status = 'done'
                and f.finisher_role is not null and f.finisher_role not in ('manager', 'admin')
             then 'worker'
           when not f.has_event and f.status = 'expired' then 'auto'
         end as closed_how,
         case
           when f.has_event and f.actor_role is not null then f.actor_id
           when not f.has_event and f.status = 'done'
                and f.finisher_role is not null and f.finisher_role not in ('manager', 'admin')
             then f.completed_by
         end as closed_by,
         case
           when f.status = 'expired' and (not f.has_event or f.actor_id is null) then 'night_pass'
           when f.status = 'cancelled' and f.has_event and f.actor_id is null then f.cause
         end as closed_cause,
         case
           when f.has_event then 'recorded'
           when f.status = 'done'
                and f.finisher_role is not null and f.finisher_role not in ('manager', 'admin')
             then 'recorded'
           when f.status = 'expired' then 'derived'
         end as closer_source,
         case when f.has_event then f.event_at
              when f.status = 'done' then f.completed_at end as closed_at
  from facts f
)
insert into public.task_closings
  (task_id, host_id, completed_by, worker_source, closed_by, closed_how, closed_cause,
   closer_source, closed_at)
select s.id, s.host_id, s.completed_by, s.worker_source, s.closed_by, s.closed_how,
       s.closed_cause, s.closer_source, s.closed_at
from said s;

create trigger tasks_stamp_closing
  after update of status on public.tasks
  for each row
  when (new.problem_id is null and old.status is distinct from new.status)
  execute function public.stamp_task_closing();

-- ---------- tasks: how the worker is known ----------

alter table public.problems
  add column completed_by_source text,
  add constraint problems_completed_by_source_known
    check (completed_by_source in ('recorded', 'derived', 'assigned', 'manager'));

comment on column public.problems.completed_by_source is
  'How completed_by is known: recorded | derived | assigned | manager (20261106125500).';

alter table public.problems disable trigger problems_touch;

-- The workers the past was given (20261106125000) are the attempts' own finishes; a worker a
-- manager named in the dialog since then is his word.
update public.problems p
set completed_by_source = case when p.closed_how = 'manager_for' then 'manager' else 'recorded' end
where p.completed_by is not null;

alter table public.problems enable trigger problems_touch;

-- ---------- closing a cleaning by hand ----------

/**
 * A manager closes a live cleaning as done: p_completed_by did the work, or nobody but the
 * manager (null). The cleaning is finished in her name; no push goes out.
 */
create or replace function public.complete_cleaning(p_id uuid, p_completed_by uuid default null)
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
  where t.id = p_id and t.host_id = public.current_host_id() and t.problem_id is null
  for update;
  if not found then
    raise exception 'Cleaning not found'
      using errcode = 'check_violation', hint = 'serverErrors.taskNotFound';
  end if;
  if v_task.status in ('done', 'cancelled', 'expired') then
    raise exception 'Cleaning is % and cannot be closed again', v_task.status
      using errcode = 'check_violation', hint = 'serverErrors.taskClosed',
            detail = jsonb_build_object('status', v_task.status)::text;
  end if;
  if p_completed_by is not null and not exists (
       select 1 from public.profiles pr
       where pr.id = p_completed_by and pr.host_id = v_task.host_id
         and pr.role in ('cleaner', 'tech', 'head_tech')) then
    raise exception 'The worker named is not of this company''s staff'
      using errcode = 'check_violation', hint = 'serverErrors.cleaningWorkerInvalid';
  end if;

  perform set_config('str_ops.task_closing',
                     jsonb_build_object('task', p_id,
                                        'how', case when p_completed_by is null then 'manager_self'
                                                    else 'manager_for' end,
                                        'completed_by', p_completed_by)::text,
                     true);

  update public.tasks t
  set status       = 'done',
      completed_by = coalesce(p_completed_by, t.completed_by)
  where t.id = p_id
  returning t.* into v_task;

  perform set_config('str_ops.task_closing', '', true);
  return v_task;
end;
$$;

revoke all on function public.complete_cleaning(uuid, uuid) from public, anon;
grant execute on function public.complete_cleaning(uuid, uuid) to authenticated, service_role;

-- ---------- naming the worker afterwards ----------

create or replace function public.closing_worker_check(p_person uuid, p_host uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_person is null or not exists (
       select 1 from public.profiles pr
       where pr.id = p_person and pr.host_id = p_host
         and pr.role in ('cleaner', 'tech', 'head_tech')) then
    raise exception 'The worker named is not of this company''s staff'
      using errcode = 'check_violation', hint = 'serverErrors.cleaningWorkerInvalid';
  end if;
end;
$$;

revoke all on function public.closing_worker_check(uuid, uuid) from public, anon, authenticated, service_role;

/** A finished cleaning that says «not stated»: the manager names who did it. */
create or replace function public.name_cleaning_worker(p_id uuid, p_completed_by uuid)
returns public.task_closings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task  public.tasks;
  v_close public.task_closings;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  select t.* into v_task
  from public.tasks t
  where t.id = p_id and t.host_id = public.current_host_id() and t.problem_id is null;
  if not found then
    raise exception 'Cleaning not found'
      using errcode = 'check_violation', hint = 'serverErrors.taskNotFound';
  end if;
  if v_task.status <> 'done' then
    raise exception 'Only a finished cleaning has a worker to name'
      using errcode = 'check_violation', hint = 'serverErrors.workerNotNameable';
  end if;
  perform public.closing_worker_check(p_completed_by, v_task.host_id);

  select c.* into v_close from public.task_closings c where c.task_id = p_id for update;
  if found and v_close.completed_by is not null then
    raise exception 'The worker is already stated'
      using errcode = 'check_violation', hint = 'serverErrors.workerAlreadyNamed';
  end if;
  -- The manager said nobody else did it: that is a worker stated, not «not stated».
  if found and v_close.closed_how = 'manager_self' then
    raise exception 'Closed alone: nobody else did it'
      using errcode = 'check_violation', hint = 'serverErrors.workerNotNameable';
  end if;

  insert into public.task_closings as c
    (task_id, host_id, completed_by, worker_source, marked_by, marked_at)
  values (p_id, v_task.host_id, p_completed_by, 'manager', (select auth.uid()), now())
  on conflict (task_id) do update
  set completed_by  = excluded.completed_by,
      worker_source = excluded.worker_source,
      marked_by     = excluded.marked_by,
      marked_at     = excluded.marked_at
  returning c.* into v_close;

  insert into public.closing_marks (host_id, task_id, person_id, marked_by)
  values (v_task.host_id, p_id, p_completed_by, (select auth.uid()));
  return v_close;
end;
$$;

revoke all on function public.name_cleaning_worker(uuid, uuid) from public, anon;
grant execute on function public.name_cleaning_worker(uuid, uuid) to authenticated, service_role;

/** A resolved task that says «not stated»: the manager names who did it. */
create or replace function public.name_problem_worker(p_id uuid, p_completed_by uuid)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
begin
  v_problem := public.problem_for_manager(p_id);
  if v_problem.status <> 'resolved' then
    raise exception 'Only a resolved task has a worker to name'
      using errcode = 'check_violation', hint = 'serverErrors.workerNotNameable';
  end if;
  if v_problem.completed_by is not null then
    raise exception 'The worker is already stated'
      using errcode = 'check_violation', hint = 'serverErrors.workerAlreadyNamed';
  end if;
  if v_problem.closed_how = 'manager_self' then
    raise exception 'Closed alone: nobody else did it'
      using errcode = 'check_violation', hint = 'serverErrors.workerNotNameable';
  end if;
  perform public.closing_worker_check(p_completed_by, v_problem.host_id);

  update public.problems p
  set completed_by = p_completed_by,
      completed_by_source = 'manager'
  where p.id = p_id
  returning p.* into v_problem;

  insert into public.closing_marks (host_id, problem_id, person_id, marked_by)
  values (v_problem.host_id, p_id, p_completed_by, (select auth.uid()));
  return v_problem;
end;
$$;

revoke all on function public.name_problem_worker(uuid, uuid) from public, anon;
grant execute on function public.name_problem_worker(uuid, uuid) to authenticated, service_role;

-- ---------- the closing, for the screens ----------

/**
 * A cleaning's closing with the names (a computed field: `closing:task_closing`). A cleaner reads
 * no colleague's profile, yet her cleaning says who cancelled it. Names only of the people the
 * row stores, and only to whom the cleaning is her business: the office, the one it was given
 * to, the one who finished it or did it. Null while it is open.
 */
create or replace function public.task_closing(t public.tasks)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'completed_by', case when c.completed_by is null then null else
             jsonb_build_object('id', c.completed_by, 'name', w.full_name, 'role', w.role) end,
           'worker_source', c.worker_source,
           'closed_by', case when c.closed_by is null then null else
             jsonb_build_object('id', c.closed_by, 'name', b.full_name, 'role', b.role) end,
           'closed_how', c.closed_how,
           'closed_cause', c.closed_cause,
           'closer_source', c.closer_source,
           'closed_at', c.closed_at)
  from public.task_closings c
  join public.tasks x on x.id = c.task_id
  left join public.profiles w on w.id = c.completed_by and w.host_id = c.host_id
  left join public.profiles b on b.id = c.closed_by and b.host_id = c.host_id
  where c.task_id = t.id
    and c.host_id = (select public.current_host_id())
    and ((select public.is_manager())
         or x.assignee_id = (select auth.uid())
         or x.completed_by = (select auth.uid())
         or c.completed_by = (select auth.uid()))
$$;

comment on function public.task_closing(public.tasks) is
  'Computed field: who did a closed cleaning and who closed it, with the names (20261106125500).';

revoke all on function public.task_closing(public.tasks) from public, anon;
grant execute on function public.task_closing(public.tasks) to authenticated;

-- ---------- the public API ----------

-- A cleaning's closing for the API: the people as on a task (api_task_person_json).
create or replace function public.api_cleaning_closing_json(t public.tasks, p_scopes text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'worker', public.api_task_person_json(c.completed_by, t.host_id, p_scopes),
    'worker_source', c.worker_source,
    'closed_by', public.api_task_person_json(c.closed_by, t.host_id, p_scopes),
    'closed_how', c.closed_how,
    'closed_cause', c.closed_cause,
    'closed_at', public.api_ts(c.closed_at))
  from (select 1) one
  left join public.task_closings c on c.task_id = t.id
$$;

-- The cleaning with who did it and who closed it; names by the key's scopes.
create or replace function public.api_cleaning_json(t public.tasks, p_scopes text[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'type', t.type,
    'status', t.status,
    'property_id', t.property_id,
    'booking_id', t.reservation_id,
    'task_id', t.problem_id,
    'scheduled_date', t.scheduled_date,
    'time_from', public.api_hm(t.time_from),
    'time_to', public.api_hm(t.time_to),
    'due_at', public.api_ts(t.due_at),
    'priority', t.priority,
    'assignee_id', t.assignee_id,
    'title', public.api_mask_codes(t.title),
    'text_masked', public.api_mask_codes(t.title) is distinct from t.title,
    'guests_count', t.guests_count,
    'is_parallel', t.is_parallel,
    'started_at', public.api_ts(t.started_at),
    'completed_at', public.api_ts(t.completed_at),
    'completed_by', t.completed_by,
    'created_at', public.api_ts(t.created_at),
    'updated_at', public.api_ts(t.updated_at))
    || public.api_cleaning_closing_json(t, p_scopes)
$$;

-- Without the key's scopes (a cleaning just handed out): the people without names.
create or replace function public.api_cleaning_json(t public.tasks)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select public.api_cleaning_json(t, '{}'::text[])
$$;

-- The two readers pass the key's scopes (copies of 20261028100000; the call alone changes).
create or replace function public.api_v1_list_cleanings(
  p_digest        text,
  p_date_from     date default null,
  p_date_to       date default null,
  p_property_id   bigint default null,
  p_assignee_id   uuid default null,
  p_status        text[] default null,
  p_type          text[] default null,
  p_updated_since timestamptz default null,
  p_after_date    date default null,
  p_after_id      uuid default null,
  p_limit         integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
            and (p_status is null or tk.status::text = any(p_status))
            and (p_type is null or tk.type::text = any(p_type))
            and (p_updated_since is null or tk.updated_at >= p_updated_since)
            and (p_after_id is null or (tk.scheduled_date, tk.id) > (p_after_date, p_after_id))
          order by tk.scheduled_date, tk.id
          limit least(greatest(p_limit, 1), 200) + 1) t);
end;
$$;

create or replace function public.api_v1_get_cleaning(p_digest text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'cleanings:read');
  v_row public.tasks;
begin
  select tk.* into v_row from public.tasks tk
  where tk.id = p_id and tk.host_id = v_ctx.host_id and public.api_allows_property(v_ctx, tk.property_id);
  if not found then
    perform public.api_not_found('Cleaning');
  end if;
  return public.api_cleaning_json(v_row, v_ctx.scopes);
end;
$$;

-- A task says how its worker is known (a copy of 20261106125000 with the field added).
create or replace function public.api_task_json(p public.problems, p_scopes text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'title', public.api_mask_codes(p.title),
    'description', public.api_mask_codes(p.description),
    'text_masked', public.api_mask_codes(p.title) is distinct from p.title
                   or public.api_mask_codes(p.description) is distinct from p.description
                   or public.api_mask_codes(p.cancel_reason) is distinct from p.cancel_reason,
    'priority', p.priority,
    'status', p.status,
    'property_id', p.property_id,
    'cleaning_id', p.task_id,
    'reported_by', p.reported_by,
    'archived', p.archived_at is not null,
    'cancel_reason', public.api_mask_codes(p.cancel_reason),
    'work', (select jsonb_build_object(
                      'cleaning_id', w.id,
                      'status', w.status,
                      'assignee_id', w.assignee_id,
                      'scheduled_date', w.scheduled_date,
                      'time_from', public.api_hm(w.time_from),
                      'time_to', public.api_hm(w.time_to))
             from public.tasks w
             where w.problem_id = p.id and w.host_id = p.host_id and w.type = 'maintenance'
             order by w.created_at desc, w.id desc
             limit 1),
    'created_at', public.api_ts(p.created_at),
    'updated_at', public.api_ts(p.updated_at),
    'resolved_at', public.api_ts(p.resolved_at),
    'cancelled_at', public.api_ts(p.cancelled_at),
    'archived_at', public.api_ts(p.archived_at),
    'completed_by', public.api_task_person_json(p.completed_by, p.host_id, p_scopes),
    'completed_by_source', p.completed_by_source,
    'closed_by', public.api_task_person_json(p.closed_by, p.host_id, p_scopes),
    'closed_how', p.closed_how,
    'closed_cause', p.closed_cause,
    'closed_at', public.api_ts(p.closed_at))
$$;

-- Helpers of the operations alone (20261028100000, «who may call what»).
revoke all on function public.api_cleaning_json(public.tasks, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.api_cleaning_closing_json(public.tasks, text[])
  from public, anon, authenticated, service_role;

-- ---------- the stamp of a task learns the source ----------
-- A copy of 20261106125000; the source of the worker is set beside it.
create or replace function public.stamp_problem_closing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was    boolean := old.status in ('resolved', 'cancelled') or old.archived_at is not null;
  v_is     boolean := new.status in ('resolved', 'cancelled') or new.archived_at is not null;
  v_actor  uuid := (select auth.uid());
  v_choice jsonb := nullif(current_setting('str_ops.problem_closing', true), '')::jsonb;
  v_role   public.app_role;
  v_worker uuid;
begin
  if not v_is then
    new.completed_by := null;
    new.completed_by_source := null;
    new.closed_by    := null;
    new.closed_how   := null;
    new.closed_cause := null;
    new.closed_at    := null;
    return new;
  end if;
  -- Still closed the same way: a resolved task put in the archive keeps who resolved it.
  if v_was and new.status = old.status then
    return new;
  end if;

  new.closed_at    := now();
  new.closed_cause := null;

  -- A fix closes with its attempt: the mirror resolves the task in the same write, and the
  -- attempt already says who finished it. Only an attempt finished in this transaction: a task
  -- reopened and closed again keeps the attempt of the round before, which did not close it.
  if new.status = 'resolved' then
    select t.completed_by into v_worker
    from public.tasks t
    where t.problem_id = new.id and t.status = 'done' and t.completed_at = now()
    order by t.id desc
    limit 1;
  end if;

  -- resolve_problem with the manager's choice (written for this task, in this transaction).
  if v_choice is not null and v_choice ->> 'problem' = new.id::text then
    new.closed_by    := v_actor;
    new.closed_how   := v_choice ->> 'how';
    new.completed_by := nullif(v_choice ->> 'completed_by', '')::uuid;
    new.completed_by_source := case when new.completed_by is not null then 'manager' end;
    return new;
  end if;

  if v_actor is null then
    new.closed_by    := null;
    new.closed_how   := 'auto';
    new.closed_cause := nullif(current_setting('str_ops.closing_cause', true), '');
    new.completed_by := v_worker;
    new.completed_by_source := case when v_worker is not null then 'recorded' end;
    return new;
  end if;

  select pr.role into v_role from public.profiles pr where pr.id = v_actor;
  new.closed_by := v_actor;
  if v_role in ('manager', 'admin') then
    new.closed_how := 'manager';
    -- The guard writes the manager as the finisher when nobody is named: that names nobody.
    new.completed_by := case when v_worker is distinct from v_actor then v_worker end;
  else
    new.closed_how   := 'worker';
    new.completed_by := v_worker;
  end if;
  new.completed_by_source := case when new.completed_by is not null then 'recorded' end;
  return new;
end;
$$;

-- ---------- analytics ----------
-- Copies of 20261015110000 and 20261015120000; the marked lines alone change.
create or replace function public.analytics_cleaning_rows(
  p_host           uuid,
  p_from           date,
  p_to             date,
  p_property_ids   bigint[],
  p_assignee_ids   uuid[],
  p_task_statuses  public.task_status[],
  p_include_test   boolean,
  p_hide_archived  boolean
)
returns table (
  task_id        uuid,
  listing_id     bigint,
  type           public.task_type,
  status         public.task_status,
  scheduled_date date,
  done_day       date,
  assignee_id    uuid,
  completed_by   uuid,
  minutes        numeric,
  has_photo      boolean
)
language sql
stable
set search_path = ''
as $$
  select t.id,
         l.id,
         t.type,
         t.status,
         t.scheduled_date,
         case when t.status = 'done' then (t.completed_at at time zone p.timezone)::date end,
         t.assignee_id,
         -- Closed «alone», a cleaning is nobody's (20261106125500).
         case when tc.closed_how = 'manager_self' then null else t.completed_by end,
         case
           when t.status <> 'done' or m.by_office then null
           when t.duration_override_min is not null then t.duration_override_min::numeric
           when t.measured_minutes between 5 and 360 then t.measured_minutes::numeric
         end,
         -- A cleaning a manager closed in the panel: its minutes are the click's, and its
         -- photos are no measure of the cleaner (20261106125500). Null keeps it out of both.
         case when m.by_office then null else
         exists (select 1 from public.task_media m
                 where m.task_id = t.id
                   and m.kind = 'photo'
                   and m.uploaded_at is not null
                   and m.deleted_at is null) end
  from public.tasks t
  left join public.task_closings tc on tc.task_id = t.id
  cross join lateral (select coalesce(tc.closed_how in ('manager_for', 'manager_self'), false)
                               and t.status = 'done' as by_office) m
  join public.properties p on p.id = t.property_id
  join public.properties l
    on l.id = case when p.hostaway_unit_id is not null then p.parent_id else p.id end
  where t.host_id = p_host
    and t.type in ('cleaning', 'midstay')
    and t.problem_id is null
    and (t.scheduled_date between p_from and p_to
         -- Any zone is within a day of UTC: a margin of a day each side
         -- keeps every cleaning finished on a local day of the period.
         or (t.status = 'done'
             and t.completed_at >= (p_from - 1)::timestamp at time zone 'UTC'
             and t.completed_at < (p_to + 2)::timestamp at time zone 'UTC'))
    and (p_include_test or not public.analytics_is_test_listing(l.id))
    and (not coalesce(p_hide_archived, false) or l.status <> 'archived')
    and (p_property_ids is null or l.id = any (p_property_ids))
    and (p_task_statuses is null or t.status = any (p_task_statuses))
    and (p_assignee_ids is null or coalesce(t.completed_by, t.assignee_id) = any (p_assignee_ids))
$$;

create or replace function public.analytics_summary(
  p_from              date,
  p_to                date,
  p_property_ids      bigint[] default null,
  p_assignee_ids      uuid[] default null,
  p_task_statuses     public.task_status[] default null,
  p_problem_statuses  public.problem_status[] default null,
  p_priorities        public.problem_priority[] default null,
  p_include_test      boolean default false,
  p_hide_archived     boolean default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host       uuid := public.analytics_guard(p_from, p_to);
  v_cleanings  record;
  v_checkouts  record;
  v_occupancy  record;
  v_problems   record;
  v_cancelled  bigint;
begin
  select
    count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to) as done,
    count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to
                       and c.type = 'midstay') as done_midstay,
    count(*) filter (where c.scheduled_date between p_from and p_to
                       and (p_task_statuses is not null or c.status <> 'cancelled')) as planned,
    count(*) filter (where c.scheduled_date between p_from and p_to
                       and (p_task_statuses is not null or c.status <> 'cancelled')
                       and c.type = 'midstay') as planned_midstay,
    count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to
                       and c.has_photo) as with_photo,
    -- The cleanings whose photos count: not those a manager closed (20261106125500).
    count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to
                       and c.has_photo is not null) as done_photo,
    percentile_cont(0.5) within group (order by c.minutes)
      filter (where c.status = 'done' and c.done_day between p_from and p_to) as minutes_median,
    avg(c.minutes) filter (where c.status = 'done' and c.done_day between p_from and p_to)
      as minutes_avg
  into v_cleanings
  from public.analytics_cleaning_rows(v_host, p_from, p_to, p_property_ids, p_assignee_ids,
                                      p_task_statuses, p_include_test, p_hide_archived) c;

  select count(*) as checkouts, coalesce(sum(k.rooms), 0) as rooms
  into v_checkouts
  from public.analytics_checkout_rows(v_host, p_from, p_to, p_property_ids, p_include_test, p_hide_archived) k;

  select coalesce(sum(o.occupied_nights), 0) as occupied,
         coalesce(sum(o.available_nights), 0) as available
  into v_occupancy
  from public.analytics_occupancy_rows(v_host, p_from, p_to, p_property_ids, p_include_test) o;

  select
    count(*) filter (where pr.created_day between p_from and p_to) as created,
    count(*) filter (where pr.status = 'resolved' and pr.resolved_day between p_from and p_to)
      as resolved,
    count(*) filter (where pr.created_day <= p_to
                       and not coalesce(pr.resolved_day <= p_to, false)
                       and not coalesce(pr.cancelled_day <= p_to, false)
                       and not coalesce(pr.archived_day <= p_to, false)) as open_end,
    avg(pr.urgency) filter (where pr.created_day between p_from and p_to) as urgency_avg,
    count(*) filter (where pr.created_day between p_from and p_to and pr.urgency = 1) as created_low,
    count(*) filter (where pr.created_day between p_from and p_to and pr.urgency = 2) as created_normal,
    count(*) filter (where pr.created_day between p_from and p_to and pr.urgency = 3) as created_high
  into v_problems
  from public.analytics_problem_rows(v_host, p_from, p_to, p_property_ids, p_assignee_ids,
                                     p_problem_statuses, p_priorities, p_include_test, p_hide_archived,
                                     false) pr;

  select count(*) filter (where pr.cancelled_day between p_from and p_to)
  into v_cancelled
  from public.analytics_problem_rows(v_host, p_from, p_to, p_property_ids, p_assignee_ids,
                                     p_problem_statuses, p_priorities, p_include_test, p_hide_archived,
                                     true) pr;

  return jsonb_build_object(
    'cleanings_done', v_cleanings.done,
    'cleanings_done_midstay', v_cleanings.done_midstay,
    'cleanings_planned', v_cleanings.planned,
    'cleanings_planned_midstay', v_cleanings.planned_midstay,
    'cleaning_minutes_median', round(v_cleanings.minutes_median::numeric, 1),
    'cleaning_minutes_avg', round(v_cleanings.minutes_avg, 1),
    'cleanings_with_photo', v_cleanings.with_photo,
    'photo_share', round(v_cleanings.with_photo::numeric / nullif(v_cleanings.done_photo, 0), 4),
    'checkouts', v_checkouts.checkouts,
    'rooms_released', v_checkouts.rooms,
    'occupied_nights', v_occupancy.occupied,
    'available_nights', v_occupancy.available,
    'occupancy', round(v_occupancy.occupied::numeric / nullif(v_occupancy.available, 0), 4),
    'problems_created', v_problems.created,
    'problems_resolved', v_problems.resolved,
    'problems_open', v_problems.open_end,
    'problems_cancelled', v_cancelled,
    'urgency_avg', round(v_problems.urgency_avg, 2),
    'problems_by_priority', jsonb_build_object(
      'low', v_problems.created_low,
      'normal', v_problems.created_normal,
      'high', v_problems.created_high)
  );
end;
$$;

create or replace function public.analytics_cleanings_by_property(
  p_from              date,
  p_to                date,
  p_property_ids      bigint[] default null,
  p_assignee_ids      uuid[] default null,
  p_task_statuses     public.task_status[] default null,
  p_problem_statuses  public.problem_status[] default null,
  p_priorities        public.problem_priority[] default null,
  p_include_test      boolean default false,
  p_limit             integer default 50,
  p_offset            integer default 0,
  p_hide_archived     boolean default null
)
returns table (
  listing_id      bigint,
  listing_name    text,
  planned         integer,
  done            integer,
  done_midstay    integer,
  expired         integer,
  cancelled       integer,
  minutes_median  numeric,
  minutes_avg     numeric,
  photo_share     numeric,
  total_count     bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_host uuid := public.analytics_guard(p_from, p_to);
begin
  return query
  with g as (
    select c.listing_id,
           count(*) filter (where c.scheduled_date between p_from and p_to
                              and (p_task_statuses is not null or c.status <> 'cancelled'))::integer
             as planned,
           count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to)::integer
             as done,
           count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to
                              and c.type = 'midstay')::integer as done_midstay,
           count(*) filter (where c.status = 'expired'
                              and c.scheduled_date between p_from and p_to)::integer as expired,
           count(*) filter (where c.status = 'cancelled'
                              and c.scheduled_date between p_from and p_to)::integer as cancelled,
           percentile_cont(0.5) within group (order by c.minutes)
             filter (where c.status = 'done' and c.done_day between p_from and p_to) as m_median,
           avg(c.minutes) filter (where c.status = 'done' and c.done_day between p_from and p_to)
             as m_avg,
           count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to
                              and c.has_photo) as with_photo,
           -- The cleanings whose photos count: not those a manager closed (20261106125500).
           count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to
                              and c.has_photo is not null) as done_photo
    from public.analytics_cleaning_rows(v_host, p_from, p_to, p_property_ids, p_assignee_ids,
                                        p_task_statuses, p_include_test, p_hide_archived) c
    group by c.listing_id
  )
  select g.listing_id,
         l.name,
         g.planned,
         g.done,
         g.done_midstay,
         g.expired,
         g.cancelled,
         round(g.m_median::numeric, 1),
         round(g.m_avg, 1),
         round(g.with_photo::numeric / nullif(g.done_photo, 0), 4),
         count(*) over ()
  from g
  join public.properties l on l.id = g.listing_id
  where g.planned > 0 or g.done > 0 or g.expired > 0 or g.cancelled > 0
  order by g.done desc, g.planned desc, l.name, g.listing_id
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.analytics_cleanings_by_cleaner(
  p_from              date,
  p_to                date,
  p_property_ids      bigint[] default null,
  p_assignee_ids      uuid[] default null,
  p_task_statuses     public.task_status[] default null,
  p_problem_statuses  public.problem_status[] default null,
  p_priorities        public.problem_priority[] default null,
  p_include_test      boolean default false,
  p_limit             integer default 50,
  p_offset            integer default 0,
  p_hide_archived     boolean default null
)
returns table (
  person_id       uuid,
  full_name       text,
  done            integer,
  done_midstay    integer,
  planned         integer,
  minutes_median  numeric,
  minutes_avg     numeric,
  photo_share     numeric,
  listings        integer,
  total_count     bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_host uuid := public.analytics_guard(p_from, p_to);
begin
  return query
  with c as (
    select * from public.analytics_cleaning_rows(v_host, p_from, p_to, p_property_ids,
                                                 p_assignee_ids, p_task_statuses, p_include_test, p_hide_archived)
  ),
  -- A done cleaning counts for who finished it; a planned one for who holds it.
  x as (
    select c.completed_by as person_id, 1 as is_done, 0 as is_planned, c.type, c.minutes,
           c.has_photo, c.listing_id
    from c
    where c.status = 'done' and c.done_day between p_from and p_to and c.completed_by is not null
    union all
    select c.assignee_id, 0, 1, c.type, null, false, c.listing_id
    from c
    where c.scheduled_date between p_from and p_to
      and (p_task_statuses is not null or c.status <> 'cancelled')
      and c.assignee_id is not null
  ),
  g as (
    select x.person_id,
           sum(x.is_done)::integer as done,
           sum(x.is_done) filter (where x.type = 'midstay') as done_midstay,
           sum(x.is_planned)::integer as planned,
           percentile_cont(0.5) within group (order by x.minutes) filter (where x.is_done = 1)
             as m_median,
           avg(x.minutes) filter (where x.is_done = 1) as m_avg,
           count(*) filter (where x.is_done = 1 and x.has_photo) as with_photo,
           -- The cleanings whose photos count: not those a manager closed (20261106125500).
           count(*) filter (where x.is_done = 1 and x.has_photo is not null) as done_photo,
           count(distinct x.listing_id) filter (where x.is_done = 1)::integer as listings
    from x
    group by x.person_id
  )
  select g.person_id,
         pr.full_name,
         g.done,
         coalesce(g.done_midstay, 0)::integer,
         g.planned,
         round(g.m_median::numeric, 1),
         round(g.m_avg, 1),
         round(g.with_photo::numeric / nullif(g.done_photo, 0), 4),
         g.listings,
         count(*) over ()
  from g
  join public.profiles pr on pr.id = g.person_id
  -- Filtered to people, the table shows those people: a cleaning one of them
  -- finished must not bring in the person who held it before.
  where p_assignee_ids is null or g.person_id = any (p_assignee_ids)
  order by g.done desc, g.planned desc, pr.full_name, g.person_id
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
