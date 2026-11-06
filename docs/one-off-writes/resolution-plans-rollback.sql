-- Takes the plans of resolution away (20261106160000). A WRITE to the cloud: only on the owner's
-- word, never in 03:00–04:40 UTC, and after the panel that reads them has been reverted.
--
--   npx supabase db query --linked -f docs/one-off-writes/resolution-plans-rollback.sql
--   npx supabase migration repair --status reverted 20261106160000 --linked
--
-- What a launch made stays, because it is ordinary work: tasks, inspections, requests. Tasks of
-- source 'plan' keep that value: an enum value cannot be dropped, and every reader takes it for
-- the staff's. Refuses if a plan was ever launched and the office has not said so: set
-- str_ops.drop_launched_plans to on in the same session to go on.
do $rollback$
begin
  if exists (select 1 from public.resolution_plans where status <> 'draft')
     and coalesce(current_setting('str_ops.drop_launched_plans', true), '') <> 'on' then
    raise exception 'Launched plans exist: their history would go';
  end if;
end;
$rollback$;

drop function if exists public.cancel_resolution_plan(uuid, integer);
drop function if exists public.set_resolution_step_decided(uuid, boolean);
drop function if exists public.launch_resolution_plan(uuid, integer);
drop function if exists public.resolution_plan_baseline(uuid, bigint, text[]);
drop function if exists public.delete_resolution_plan(uuid, integer);
drop function if exists public.save_resolution_plan(uuid, bigint, text, jsonb, integer);
drop function if exists public.resolution_plan_place_work(bigint);
drop function if exists public.property_resolution_plans(bigint);
drop function if exists public.resolution_plan(uuid);
drop function if exists public.resolution_step_states(uuid);

drop table public.resolution_plan_steps;
drop table public.resolution_plans;
drop type public.plan_step_kind;
drop type public.plan_status;
