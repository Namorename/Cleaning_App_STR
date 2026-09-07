-- The checklist tables, with only the privilege they actually need.
--
-- 20260907120000 revoked insert, update and delete from `authenticated` and
-- thought that was the end of it. It was not: the cloud grants new tables the
-- full set through default privileges, and the ones nobody names in a revoke
-- stay behind. A check right after the push found REFERENCES, TRIGGER and
-- TRUNCATE still sitting there — and TRUNCATE ignores row level security
-- entirely, so a policy would not have saved these tables from being emptied.
--
-- `revoke all` first, then grant back the one privilege that is wanted. This
-- is what 20260825030000 does for anon and 20260905110600 for the F16 tables,
-- and it is the only form that survives whatever the platform decides to hand
-- out by default.
--
-- Local Postgres does not add these grants at all, so this migration is a
-- no-op there. Verify on the cloud after every push that creates a table:
--   select privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and grantee = 'authenticated' ...

revoke all on public.checklist_modules, public.checklist_items
  from anon, authenticated;

grant select on public.checklist_modules, public.checklist_items to authenticated;
