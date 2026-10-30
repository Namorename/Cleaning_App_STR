-- Per-function fingerprint of schemas public and raw, for finding which function differs when
-- rollout_1030_fingerprint.sql does (docs/rollout-plan-1028.md, steps 3-5). Catalog only, one
-- statement. Each value: md5 prefix of the body without carriage returns, security definer,
-- proconfig, md5 prefix of the result type.
--
--   node scripts/cloud-read.mjs <plan tree>/docs/rollout/rollout_1030_functions.sql > fn.json
--   node <plan tree>/docs/rollout/rollout-1030-compare.mjs <head|step3|step4|step5> fn.json
select json_object_agg(k, v order by k) as fns from (
  select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as k,
         left(md5(replace(p.prosrc, chr(13), '')), 8) || ' ' || p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '-')
         || ' ' || left(md5(pg_get_function_result(p.oid)), 6) as v
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname in ('public', 'raw')
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')) f;
