-- Post-push check for 20261008100000_maintenance_problem_id
-- (docs/rollout/maintenance-problem-id.md). Read-only, one statement:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_maintenance_problem_id.sql
--
-- Expected, label by label (local stack after `migration up`, 2026-10-08):
--   head       20261008100000.
--   function   exactly one row:
--                signature  property_maintenance_tasks(bigint,integer)
--                result     ends in «unit_name text, problem_id uuid»
--                md5 / len  b733a39b / 661   (before the push: dae6c32a / 638)
--                owner      postgres, volatility s, security_definer false,
--                config     ["search_path=\"\""]
--                acl        {postgres=X/postgres,authenticated=X/postgres,
--                            service_role=X/postgres} — the same as before.
--              Two rows mean an overload survived (the drop did not run);
--              a different md5 means another body went out. Either is a stop.
--   anon       false. Any true is a stop.
--   public     false: PUBLIC holds no EXECUTE on functions of ours.
--   repairs    counts only, no rows: on 2026-10-08 the cloud had 9 repairs,
--              all 9 booked from a report — the new column has values to
--              carry from the first call.
--
-- ROLLBACK. There is no down migration. A forward migration that drops and
-- creates the function again with the old eight columns and the same grants
-- (body from 20260917160000) — and only once no deployed panel build reads
-- problem_id from it.
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload
  union all
  select 2, 'function',
         (select jsonb_agg(jsonb_build_object(
                   'signature', p.oid::regprocedure::text,
                   'result', pg_get_function_result(p.oid),
                   'md5', left(md5(p.prosrc), 8), 'len', length(p.prosrc),
                   'owner', p.proowner::regrole::text, 'volatility', p.provolatile::text,
                   'security_definer', p.prosecdef,
                   'config', p.proconfig, 'acl', p.proacl::text)
                   order by p.oid::regprocedure::text)
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'property_maintenance_tasks')
  union all
  select 3, 'anon',
         (select jsonb_object_agg(p.oid::regprocedure::text,
                                  has_function_privilege('anon', p.oid, 'execute'))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'property_maintenance_tasks')
  union all
  select 4, 'public',
         (select jsonb_object_agg(p.oid::regprocedure::text,
                                  exists (select 1
                                            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                           where a.grantee = 0))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'property_maintenance_tasks')
  union all
  select 5, 'repairs',
         (select jsonb_build_object(
                   'repairs', count(*),
                   'with_report', count(*) filter (where t.problem_id is not null))
            from public.tasks t
           where t.type = 'maintenance')
) t order by ord
