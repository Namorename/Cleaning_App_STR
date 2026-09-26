-- Window 3: the DEPLOYED rule against the rows the phone reads (counts only).
--
-- docs/rollout/window3_probe.sql retells the rule in its own SQL, so a typo in
-- the function that actually went to the cloud would still show zero holes.
-- This file calls public.staff_property_ids() itself, under the claims of each
-- active cleaner and technician in turn, and counts the property rows her
-- screens read today — the row of every task, problem and supply request she
-- sees, the rooms of the listings she is linked to, and the listing above each
-- — that the function did not return. Every count must be 0.
--
-- Runs after db push №1 (the function exists from then on). One statement,
-- because `supabase db query` takes one. Nothing is written: set_config with
-- is_local = true lives until the end of this statement's transaction.
--
-- How the claims reach the function. For each staff row, `cfg` sets them, and
-- `r` calls the function in a subquery whose WHERE refers to cfg.c: that makes
-- it a correlated SubPlan, re-run per row and only after cfg. Without such a
-- reference it becomes an InitPlan, run once before any claims are set — an
-- unused cfg.c in the subquery's select list is not enough, the planner drops
-- it (seen locally 2026-09-24: every set came back empty). Checked on the
-- window-3 fixtures of rls_smoke.sql: 0 holes with the rule as written, holes
-- with the listing-above arm removed. ids_per_staff counts what the function
-- returns before the policy's company filter, so a stray link into another
-- company still shows up there; holes are counted within her own company.
--
-- Run ONLY with: npx supabase db query --linked -f docs/rollout/window3_rule_check.sql
-- (the owner's word). Not through scripts/cloud-read.mjs: staff_property_ids() is executable by
-- authenticated and service_role only, so as supabase_read_only_user this fails with "permission
-- denied for function staff_property_ids". That error says nothing about the deployed ACL.
with staff as (
  select pr.id as uid, pr.host_id, pr.role
  from public.profiles pr
  where pr.is_active and pr.role in ('cleaner', 'tech')
),
-- cleans_property(id) as it stands (20260912140000_unit_assignment.sql).
cleans as (
  select s.uid, p.id as pid
  from staff s
  join public.properties p on p.host_id = s.host_id
  where exists (select 1 from public.property_cleaners pc
                where pc.cleaner_id = s.uid and pc.property_id = p.id)
     or (p.hostaway_unit_id is not null
         and exists (select 1 from public.property_cleaners pc
                     where pc.cleaner_id = s.uid and pc.property_id = p.parent_id))
),
needed_base as (
  select s.uid, t.property_id as pid, 'task_assignee' as reader
  from staff s join public.tasks t on t.assignee_id = s.uid and t.host_id = s.host_id
  union all
  select c.uid, t.property_id, 'task_on_linked'
  from cleans c join public.tasks t on t.property_id = c.pid
  union all
  select s.uid, p.property_id, 'problem_reporter'
  from staff s join public.problems p on p.reported_by = s.uid and p.host_id = s.host_id
  where p.property_id is not null
  union all
  select s.uid, p.property_id, 'problem_fixer'
  from staff s
  join public.tasks t on t.assignee_id = s.uid and t.problem_id is not null
                     and t.status not in ('cancelled', 'expired')
  join public.problems p on p.id = t.problem_id
  where p.property_id is not null
  union all
  select s.uid, r.property_id, 'supply_requester'
  from staff s join public.supply_requests r on r.requested_by = s.uid and r.host_id = s.host_id
  where r.property_id is not null
  union all
  select c.uid, c.pid, 'report_picker'
  from cleans c join public.properties p on p.id = c.pid and p.status <> 'archived'
),
needed as (
  select n.uid, n.pid, n.reader, 'row' as part from needed_base n
  union all
  select n.uid, p.parent_id, n.reader, 'parent'
  from needed_base n join public.properties p on p.id = n.pid
  where p.parent_id is not null
),
deployed as (
  select s.uid, s.role, r.ids
  from staff s
  cross join lateral (
    select set_config('request.jwt.claims',
             json_build_object('sub', s.uid, 'role', 'authenticated')::text, true) as c
  ) cfg
  cross join lateral (
    select array(select public.staff_property_ids() where cfg.c is not null) as ids
  ) r
),
holes as (
  select n.* from needed n
  join deployed d on d.uid = n.uid
  where n.pid <> all (d.ids)
)
select jsonb_build_object(
  'staff', (select count(*) from deployed),
  'ids_per_staff', (select jsonb_agg(jsonb_build_object('role', role,
                                                         'ids', cardinality(ids))
                                      order by role, cardinality(ids))
                     from deployed),
  'holes_total', (select count(*) from holes),
  'holes_by_reader', (select coalesce(jsonb_object_agg(reader || '/' || part, n), '{}'::jsonb)
                      from (select reader, part, count(*) as n from holes group by reader, part) x)
) as rule_check;
