-- Who did a task's work and who closed it (owner's request of 2026-11-09).
--
-- A task (problems) closed and said nothing of the people. The fix's attempt kept completed_by,
-- but resolve_problem finished that attempt in the manager's name: the panel showed nobody, and
-- analytics credited the repair to the manager who clicked. Now the task itself keeps it:
--
-- - completed_by: whoever did the work, when that is known. Null is «not stated».
-- - closed_by, closed_at: who closed it and when; null closed_by with closed_how 'auto' is the
--   system (a write with no user).
-- - closed_how:
--     worker       — the person doing the work finished it, on the phone;
--     manager      — a manager closed it some other way: cancelled, archived, a caller from
--                    before the choice below, or the past where the worker is not known;
--     manager_for  — a manager closed it and named who did the work;
--     manager_self — a manager closed it and said nobody else did it;
--     auto         — the system, with closed_cause when the path names one.
--
-- One trigger stamps it on every path that closes a task (status resolved or cancelled, or
-- archived) and wipes it on every path that opens one again, so no closing function needs to
-- remember. resolve_problem learns two arguments: the person who did the work, or «alone».
-- Neither is the panel of yesterday (CLAUDE.md, a new argument): it closes as it always did,
-- with the person not stated. Finishing the attempt sends no push, as before.
--
-- No foreign keys to profiles: problems already has one (reported_by), and a second and third
-- would make every embed of profiles from problems without a hint ambiguous (PGRST201) for the
-- phones in the field. resolve_problem checks the person; nobody else writes these columns
-- (authenticated reads problems and writes nothing).
--
-- Analytics: a repair a manager closed in the panel is not a measurement of the worker's time.
-- The by-technician table keeps it in the counts of the person named, but not in the work time
-- or the time to close; a repair closed «alone» is nobody's. Only closings made from now on
-- carry those two marks; the past keeps its numbers.
--
-- The past: filled from the journal (problem_events, kept since the cloud's start) and the
-- attempts, only where they say it. A worker is named when the attempt was finished, in the
-- very write that closed the task, by a person who is not a manager (only an attempt's own
-- executor can finish it: guard_task_fields keeps completed_by and the policy keeps the attempt
-- hers); a manager's finish, a round before a reopening and an event with no person name
-- nobody.
-- Dates, statuses and updated_at do not move: the touch trigger is off for the backfill alone.
--
-- Dated before the parts of stage 4 that wait in their branches (20261106130000 on), so they
-- still apply after it.
set local lock_timeout = '5s';

-- ---------- the columns ----------

alter table public.problems
  add column completed_by uuid,
  add column closed_by    uuid,
  add column closed_how   text,
  add column closed_cause text,
  add column closed_at    timestamptz;

alter table public.problems
  add constraint problems_closed_how_known
    check (closed_how in ('worker', 'manager', 'manager_for', 'manager_self', 'auto')),
  add constraint problems_closed_cause_code
    check (closed_cause ~ '^[a-z_]{1,40}$');

comment on column public.problems.completed_by is
  'Who did the work, when known; null is not stated (20261106125000). No foreign key: see the migration.';
comment on column public.problems.closed_by is
  'Who closed the task; null with closed_how auto is the system (20261106125000).';
comment on column public.problems.closed_how is
  'worker | manager | manager_for | manager_self | auto (20261106125000).';
comment on column public.problems.closed_cause is
  'Why the system closed it, as a code, when the path names one (20261106125000).';
comment on column public.problems.closed_at is
  'When the task was last closed: resolved, cancelled or archived (20261106125000).';

-- ---------- the stamp ----------

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
    return new;
  end if;

  if v_actor is null then
    new.closed_by    := null;
    new.closed_how   := 'auto';
    new.closed_cause := nullif(current_setting('str_ops.closing_cause', true), '');
    new.completed_by := v_worker;
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
  return new;
end;
$$;

comment on function public.stamp_problem_closing() is
  'Trigger on problems: who did the work and who closed the task, on every path that closes it '
  '(20261106125000).';

revoke all on function public.stamp_problem_closing() from public, anon, authenticated;

-- ---------- the past ----------
-- Before the trigger exists, with the touch trigger off: updated_at keeps its value.

alter table public.problems disable trigger problems_touch;

with closed as (
  select p.id, p.resolved_at, p.cancelled_at, p.archived_at,
         case when p.status in ('resolved', 'cancelled') then p.status::text else 'archived' end
           as state
  from public.problems p
  where p.status in ('resolved', 'cancelled') or p.archived_at is not null
),
facts as (
  select c.id,
         e.actor_id,
         e.id is not null as has_event,
         e.created_at as event_at,
         er.role as actor_role,
         coalesce(e.created_at,
                  case c.state when 'resolved' then c.resolved_at
                               when 'cancelled' then c.cancelled_at
                               else c.archived_at end) as closed_at,
         w.completed_by as worker,
         w.completed_at as worker_at,
         -- A worker only from an attempt its own person finished, never a manager's finish.
         wr.role is not null and wr.role not in ('manager', 'admin') as worker_known
  from closed c
  left join lateral (select ev.id, ev.actor_id, ev.created_at from public.problem_events ev
                     where ev.problem_id = c.id and ev.kind::text = c.state
                     order by ev.created_at desc, ev.id desc
                     limit 1) e on true
  left join public.profiles er on er.id = e.actor_id
  left join lateral (select t.completed_by, t.completed_at from public.tasks t
                     where t.problem_id = c.id and t.status = 'done' and c.state = 'resolved'
                     order by t.completed_at desc nulls last, t.id desc
                     limit 1) w on true
  left join public.profiles wr on wr.id = w.completed_by
),
said as (
  select f.id,
         f.closed_at,
         case when f.worker_known and r.same_round then f.worker end as completed_by,
         -- An event with no person is the system or a profile deleted since: not known.
         case
           when f.has_event and f.actor_role in ('manager', 'admin') then 'manager'
           when f.has_event and f.actor_role is not null then 'worker'
           -- No journal row: the mirror's stamp says a worker's finish closed it.
           when not f.has_event and f.worker_known and r.same_round then 'worker'
         end as closed_how,
         case
           when f.has_event and f.actor_role is not null then f.actor_id
           when not f.has_event and f.worker_known and r.same_round then f.worker
         end as closed_by
  from facts f
  -- The attempt finished in the write that closed the task (the journal's row and the
  -- mirror's stamp take that write's now()), not in a round before a reopening.
  cross join lateral (select coalesce(f.worker_at = coalesce(f.event_at, f.closed_at), false)
                        as same_round) r
)
update public.problems p
set completed_by = s.completed_by,
    closed_by    = s.closed_by,
    closed_how   = s.closed_how,
    closed_at    = s.closed_at
from said s
where p.id = s.id;

alter table public.problems enable trigger problems_touch;

create trigger problems_stamp_closing
  before update of status, archived_at on public.problems
  for each row
  execute function public.stamp_problem_closing();

-- ---------- closing by hand ----------

drop function public.resolve_problem(uuid);

/**
 * Close the task as fixed by hand; a live attempt is finished with it, and no push goes out.
 *
 * p_completed_by: who did the work — any of the company's staff who work on tasks, switched
 * off or not (a person who left can still be named). p_alone: nobody else did it. Neither: a
 * caller from before the choice, closing with the person not stated.
 */
create function public.resolve_problem(
  p_id           uuid,
  p_completed_by uuid default null,
  p_alone        boolean default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
  v_how     text;
begin
  v_problem := public.problem_for_manager(p_id);

  if v_problem.status = 'resolved' then
    return v_problem;
  end if;
  if v_problem.status = 'cancelled' then
    raise exception 'Problem is cancelled and cannot be resolved'
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;

  if p_completed_by is not null and coalesce(p_alone, false) then
    raise exception 'Name the worker or close alone, not both'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.problemCompleterInvalid';
  end if;
  if p_completed_by is not null then
    if not exists (select 1 from public.profiles pr
                   where pr.id = p_completed_by
                     and pr.host_id = v_problem.host_id
                     and pr.role in ('tech', 'head_tech', 'cleaner')) then
      raise exception 'The worker named is not of this company''s staff'
        using errcode = 'check_violation', hint = 'serverErrors.problemCompleterInvalid';
    end if;
    v_how := 'manager_for';
  elsif coalesce(p_alone, false) then
    v_how := 'manager_self';
  end if;

  if v_how is not null then
    perform set_config('str_ops.problem_closing',
                       jsonb_build_object('problem', p_id, 'how', v_how,
                                          'completed_by', p_completed_by)::text,
                       true);
  end if;

  -- The attempt is finished first: the mirror resolves the task. The worker named is its
  -- finisher; otherwise the guard writes the manager, as it always has.
  update public.tasks t
  set status       = 'done',
      completed_by = case when v_how = 'manager_for' then p_completed_by else t.completed_by end
  where t.problem_id = p_id and t.status not in ('done', 'cancelled', 'expired');

  update public.problems p
  set status      = 'resolved',
      resolved_at = coalesce(p.resolved_at, now())
  where p.id = p_id
  returning * into v_problem;

  perform set_config('str_ops.problem_closing', '', true);
  return v_problem;
end;
$$;

revoke all on function public.resolve_problem(uuid, uuid, boolean) from public, anon;
grant execute on function public.resolve_problem(uuid, uuid, boolean) to authenticated, service_role;

-- ---------- the names, for the screens ----------

/**
 * The names behind completed_by and closed_by, read through a task the caller sees (a computed
 * field: `closing:closing_people`). A technician reads no colleague's profile, yet his task
 * says who closed it. Names only of the people the task stores, in the caller's company, and
 * only to whom the task is his business: the office, the head technician, who reported it, who
 * was given it (a superset of the rows RLS shows, so a screen always gets them; called as an
 * RPC with somebody else's id, it gives nothing).
 */
create or replace function public.closing_people(p public.problems)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'completed_by', (select jsonb_build_object('name', pr.full_name, 'role', pr.role)
                            from public.profiles pr
                            where pr.id = x.completed_by and pr.host_id = x.host_id),
           'closed_by', (select jsonb_build_object('name', pr.full_name, 'role', pr.role)
                         from public.profiles pr
                         where pr.id = x.closed_by and pr.host_id = x.host_id))
  from public.problems x
  where x.id = p.id
    and x.host_id = (select public.current_host_id())
    and ((select public.is_manager())
         or (select public.is_head_tech())
         or x.reported_by = (select auth.uid())
         or exists (select 1 from public.tasks t
                    where t.problem_id = x.id and t.assignee_id = (select auth.uid())))
$$;

comment on function public.closing_people(public.problems) is
  'Computed field: the names of who did the work and who closed the task (20261106125000).';

revoke all on function public.closing_people(public.problems) from public, anon;
grant execute on function public.closing_people(public.problems) to authenticated;

-- ---------- the public API ----------

-- A person on a task: the id and the role; the name only with staff:read_names.
create or replace function public.api_task_person_json(p_person uuid, p_host uuid, p_scopes text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_person is null then null else
           jsonb_build_object('id', p_person, 'role', pr.role)
           || case when 'staff:read_names' = any(coalesce(p_scopes, '{}')) and pr.full_name is not null
                   then jsonb_build_object('full_name', pr.full_name) else '{}'::jsonb end
         end
  from (select 1) one
  left join public.profiles pr on pr.id = p_person and pr.host_id = p_host
$$;

-- The task with who did the work and who closed it; names by the key's scopes.
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
    'closed_by', public.api_task_person_json(p.closed_by, p.host_id, p_scopes),
    'closed_how', p.closed_how,
    'closed_cause', p.closed_cause,
    'closed_at', public.api_ts(p.closed_at))
$$;

-- Without the key's scopes (a task just created or handed out): the people without names.
create or replace function public.api_task_json(p public.problems)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.api_task_json(p, '{}'::text[])
$$;

-- The two readers pass the key's scopes (copies of 20261028100000; the call alone changes).
create or replace function public.api_v1_list_tasks(
  p_digest           text,
  p_status           text[] default null,
  p_priority         text[] default null,
  p_property_id      bigint default null,
  p_assignee_id      uuid default null,
  p_created_from     timestamptz default null,
  p_created_to       timestamptz default null,
  p_include_archived boolean default false,
  p_updated_since    timestamptz default null,
  p_after_created    timestamptz default null,
  p_after_id         uuid default null,
  p_limit            integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'tasks:read');
begin
  return (
    -- _sort: created_at at full precision, for the cursor; the function strips it.
    select coalesce(jsonb_agg(public.api_task_json(p, v_ctx.scopes) || jsonb_build_object('_sort', p.created_at)
                              order by p.created_at, p.id), '[]'::jsonb)
    from (select pb.* from public.problems pb
          where pb.host_id = v_ctx.host_id
            and (v_ctx.allowed is null or public.api_allows_property(v_ctx, pb.property_id))
            and (p_status is null or pb.status::text = any(p_status))
            and (p_priority is null or pb.priority::text = any(p_priority))
            and (p_property_id is null or pb.property_id = p_property_id)
            and (coalesce(p_include_archived, false) or pb.archived_at is null)
            and (p_created_from is null or pb.created_at >= p_created_from)
            and (p_created_to is null or pb.created_at < p_created_to)
            and (p_updated_since is null or pb.updated_at >= p_updated_since)
            and (p_assignee_id is null or p_assignee_id = (
                   select w.assignee_id from public.tasks w
                   where w.problem_id = pb.id and w.type = 'maintenance'
                   order by w.created_at desc, w.id desc limit 1))
            and (p_after_id is null or (pb.created_at, pb.id) > (p_after_created, p_after_id))
          order by pb.created_at, pb.id
          limit least(greatest(p_limit, 1), 200) + 1) p);
end;
$$;

create or replace function public.api_v1_get_task(p_digest text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'tasks:read');
  v_row public.problems;
begin
  select pb.* into v_row from public.problems pb
  where pb.id = p_id and pb.host_id = v_ctx.host_id
    and (v_ctx.allowed is null or public.api_allows_property(v_ctx, pb.property_id));
  if not found then
    perform public.api_not_found('Task');
  end if;
  return public.api_task_json(v_row, v_ctx.scopes);
end;
$$;

-- Helpers of the operations alone (20261028100000, «who may call what»).
revoke all on function public.api_task_person_json(uuid, uuid, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.api_task_json(public.problems, text[])
  from public, anon, authenticated, service_role;

-- ---------- analytics ----------
-- A copy of 20261015110000; the attempts' rows alone change (see the header).
create or replace function public.analytics_problems_by_technician(
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
  person_id             uuid,
  full_name             text,
  repairs_done          integer,
  repairs_open          integer,
  problems_resolved     integer,
  work_minutes_avg      numeric,
  hours_to_resolve_avg  numeric,
  total_count           bigint
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
  -- The tasks up to today, not to the end of the period: repairs_open is the
  -- work open now (owner, 2026-10-15), and a task reported after the period
  -- may hold some. The other figures count repairs done in the period, which
  -- only a task made by then can have.
  with pr as (
    select * from public.analytics_problem_rows(v_host, p_from, greatest(p_to, current_date),
                                                p_property_ids, p_assignee_ids, p_problem_statuses,
                                                p_priorities, p_include_test, p_hide_archived, false)
  ),
  rep as (
    -- A repair a manager closed in the panel (20261106125000): the person named keeps it in
    -- the counts, but its times are the click's, not the work's; closed «alone», it is nobody's.
    select case when m.by_office and pb.closed_how = 'manager_self' then null
                else coalesce(t.completed_by, t.assignee_id) end as person_id,
           t.status,
           t.problem_id,
           pr.status as problem_status,
           case when m.by_office then null else pr.hours_to_resolve end as hours_to_resolve,
           (t.completed_at at time zone p.timezone)::date as done_day,
           -- The manager's correction, else a measurement worth trusting:
           -- a repair left open for days is not days of work.
           case
             when t.status <> 'done' or m.by_office then null
             when t.duration_override_min is not null then t.duration_override_min::numeric
             when t.measured_minutes between 5 and 720 then t.measured_minutes::numeric
           end as work_minutes
    from public.tasks t
    join pr on pr.problem_id = t.problem_id
    join public.properties p on p.id = t.property_id
    join public.problems pb on pb.id = t.problem_id
    cross join lateral (select t.status = 'done'
                               and pb.closed_how in ('manager_for', 'manager_self')
                               and t.completed_at >= pb.closed_at as by_office) m
    where t.host_id = v_host
      and t.type = 'maintenance'
      and (p_assignee_ids is null or coalesce(t.completed_by, t.assignee_id) = any (p_assignee_ids))
  ),
  g as (
    select rep.person_id,
           count(*) filter (where rep.status = 'done'
                              and rep.done_day between p_from and p_to)::integer as repairs_done,
           count(*) filter (where rep.status not in ('done', 'cancelled', 'expired'))::integer
             as repairs_open,
           count(distinct rep.problem_id) filter (where rep.status = 'done'
                                                    and rep.done_day between p_from and p_to
                                                    and rep.problem_status = 'resolved')::integer
             as problems_resolved,
           avg(rep.work_minutes) filter (where rep.status = 'done'
                                           and rep.done_day between p_from and p_to) as w_avg,
           avg(rep.hours_to_resolve) filter (where rep.status = 'done'
                                               and rep.done_day between p_from and p_to
                                               and rep.problem_status = 'resolved') as h_avg
    from rep
    where rep.person_id is not null
    group by rep.person_id
  )
  select g.person_id,
         pf.full_name,
         g.repairs_done,
         g.repairs_open,
         g.problems_resolved,
         round(g.w_avg, 1),
         round(g.h_avg, 1),
         count(*) over ()
  from g
  join public.profiles pf on pf.id = g.person_id
  where g.repairs_done > 0 or g.repairs_open > 0
  order by g.repairs_done desc, g.repairs_open desc, pf.full_name, g.person_id
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;
