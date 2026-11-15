-- The catalogue of task categories in the cloud (20261115100000), read-only:
--   node scripts/cloud-read.mjs docs/rollout/probe_problem_categories.sql
-- Reads the system catalogue only, so it answers before the migration as well as after
-- (docs/rollout/wagner-problem-catalog-1114.md has both answers).
select
  (select max(version) from supabase_migrations.schema_migrations) as head,
  (select count(*) from supabase_migrations.schema_migrations) as applied,
  (select string_agg(p.oid::regprocedure::text || ' ' || md5(p.prosrc), '; ' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('report_problem', 'update_problem', 'problem_category_for_report')) as functions,
  -- Who may call the three: the roles of the clients and PUBLIC (grantee 0).
  (select string_agg(p.proname || ':' || coalesce(r.rolname, 'PUBLIC'), ', '
                     order by p.proname, coalesce(r.rolname, 'PUBLIC'))
   from pg_proc p
   cross join lateral aclexplode(p.proacl) a
   left join pg_roles r on r.oid = a.grantee
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('report_problem', 'update_problem', 'problem_category_for_report')
     and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))) as client_execute,
  (select string_agg(a.attrelid::regclass::text || '.' || a.attname, ', '
                     order by a.attrelid::regclass::text, a.attname)
   from pg_attribute a
   where a.attrelid in ('public.hosts'::regclass, 'public.problems'::regclass)
     and a.attname in ('problem_report_mode', 'category_id') and not a.attisdropped) as columns,
  to_regclass('public.problem_categories') is not null as catalogue_table,
  -- Privileges of the client roles on the catalogue (pg_class.relacl, as
  -- docs/rollout/postpush_window3.sql): authenticated SELECT only, anon and PUBLIC none.
  (select string_agg(coalesce(r.rolname, 'PUBLIC') || ':' || a.privilege_type, ', '
                     order by coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
   from pg_class c
   cross join lateral aclexplode(c.relacl) a
   left join pg_roles r on r.oid = a.grantee
   where c.oid = to_regclass('public.problem_categories')
     and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))) as catalogue_client_grants,
  (select c.relrowsecurity from pg_class c
   where c.oid = to_regclass('public.problem_categories')) as catalogue_rls,
  (select string_agg(pol.polname, ', ') from pg_policy pol
   where pol.polrelid = to_regclass('public.problem_categories')) as catalogue_policies;
