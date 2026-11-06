-- The API's scope registry in the cloud, after the push of 20261028100000 (and again after the
-- knowledge base and the reviews, which add two rows each). Read-only, one statement:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_api_scopes_1028.sql
--
-- Expected: 41 rows after the API (31 scopes and 10 forbidden), 43 after the knowledge base,
-- 45 after the reviews; exposed 12 throughout; no key yet.
select json_build_object(
  'scopes', (select count(*) from public.api_scopes),
  'by_status', (select json_object_agg(status, n) from (
      select status, count(*) as n from public.api_scopes group by status) s),
  'keys', (select count(*) from public.api_keys)
) as api_scopes_1028;
