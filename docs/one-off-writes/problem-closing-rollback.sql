-- Takes «who did it, who closed it» away (20261106125000). A WRITE to the cloud: only on the
-- owner's word, never in 03:00–04:40 UTC.
--
-- First the readers, or they lose their columns: the phone's preview back to the OTA before
-- (republish), the panel back to main before the change (revert, Vercel). Then:
--
--   npx supabase db query --linked -f docs/one-off-writes/problem-closing-rollback.sql
--   npx supabase migration repair --status reverted 20261106125000 --linked
--
-- One statement: db query takes one. The functions go back to their bodies before the
-- migration, copied from 20260908130000, 20261028100000 and 20261015110000. The stamps and the
-- backfill go with the columns: what managers chose in the dialog is lost. The attempts keep the
-- worker a manager named (tasks.completed_by), as any finish keeps its finisher.
do $rollback$
begin
  drop trigger if exists problems_stamp_closing on public.problems;
  drop function if exists public.stamp_problem_closing();

  drop function if exists public.resolve_problem(uuid, uuid, boolean);
create or replace function public.resolve_problem(p_id uuid)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
begin
  v_problem := public.problem_for_manager(p_id);

  if v_problem.status = 'resolved' then
    return v_problem;
  end if;
  if v_problem.status = 'cancelled' then
    raise exception 'Problem is cancelled and cannot be resolved'
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;

  -- The task is finished first: the mirror stamps the problem. Without a
  -- task the stamp is written here.
  update public.tasks t
  set status = 'done'
  where t.problem_id = p_id and t.status not in ('done', 'cancelled', 'expired');

  update public.problems p
  set status      = 'resolved',
      resolved_at = coalesce(p.resolved_at, now())
  where p.id = p_id
  returning * into v_problem;

  return v_problem;
end;
$$;
  revoke all on function public.resolve_problem(uuid) from public, anon;
  grant execute on function public.resolve_problem(uuid) to authenticated, service_role;

create or replace function public.api_task_json(p public.problems)
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
    'archived_at', public.api_ts(p.archived_at))
$$;

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
    select coalesce(jsonb_agg(public.api_task_json(p) || jsonb_build_object('_sort', p.created_at)
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
  return public.api_task_json(v_row);
end;
$$;

  drop function if exists public.api_task_json(public.problems, text[]);
  drop function if exists public.api_task_person_json(uuid, uuid, text[]);
  drop function if exists public.closing_people(public.problems);

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
    select coalesce(t.completed_by, t.assignee_id) as person_id,
           t.status,
           t.problem_id,
           pr.status as problem_status,
           pr.hours_to_resolve,
           (t.completed_at at time zone p.timezone)::date as done_day,
           -- The manager's correction, else a measurement worth trusting:
           -- a repair left open for days is not days of work.
           case
             when t.status <> 'done' then null
             when t.duration_override_min is not null then t.duration_override_min::numeric
             when t.measured_minutes between 5 and 720 then t.measured_minutes::numeric
           end as work_minutes
    from public.tasks t
    join pr on pr.problem_id = t.problem_id
    join public.properties p on p.id = t.property_id
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

  alter table public.problems
    drop constraint if exists problems_closed_how_known,
    drop constraint if exists problems_closed_cause_code,
    drop column if exists completed_by,
    drop column if exists closed_by,
    drop column if exists closed_how,
    drop column if exists closed_cause,
    drop column if exists closed_at;
end;
$rollback$;
