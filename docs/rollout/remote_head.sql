-- The newest migration version applied in the cloud. Read-only.
-- Used by the push guard in docs/units-plan.md ("Эксплуатация выката"):
--   npx supabase db query --linked -f docs/rollout/remote_head.sql
select max(version) as head from supabase_migrations.schema_migrations;
