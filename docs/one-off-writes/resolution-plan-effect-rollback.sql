-- Takes the reading of what followed a plan away (20261110230000). A WRITE to the cloud: only on
-- the owner's word, never in 03:00–04:40 UTC, after the panel:
--
--   npx supabase db query --linked -f docs/one-off-writes/resolution-plan-effect-rollback.sql
--   npx supabase migration repair --status reverted 20261110230000 --linked
--
-- The numbers kept at each launch stay in resolution_plans.baseline.
drop function if exists public.resolution_plan_effect(uuid);
