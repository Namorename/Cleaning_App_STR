-- The manager's four levels (20261115140000) and the themes of categories (20261115150000)
-- in the cloud, read-only:
--   node scripts/cloud-read.mjs docs/rollout/probe_category_themes.sql
-- Answers before the migrations as well as after (docs/rollout/category-themes-1115.md has
-- both): the md5 of every function they replace is the guard that the cloud runs the bodies
-- they were generated from, and that their rollbacks bring back.
select
  (select max(version) from supabase_migrations.schema_migrations) as head,
  (select count(*) from supabase_migrations.schema_migrations) as applied,
  (select string_agg(p.proname || '(' || p.pronargs || ') ' || md5(p.prosrc), '; '
                     order by p.proname, p.pronargs)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('approve_signal_finding', 'add_signal_finding', 'save_resolution_plan',
                       'resolution_plan', 'launch_resolution_plan', 'refresh_property_quality',
                       'problem_theme', 'refresh_category_themes')) as functions,
  -- Who may call them: the roles of the clients and PUBLIC (grantee 0).
  (select string_agg(distinct p.proname || ':' || coalesce(r.rolname, 'PUBLIC'), ', ')
   from pg_proc p
   cross join lateral aclexplode(p.proacl) a
   left join pg_roles r on r.oid = a.grantee
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('approve_signal_finding', 'add_signal_finding', 'save_resolution_plan',
                       'resolution_plan', 'launch_resolution_plan', 'refresh_property_quality',
                       'problem_theme', 'refresh_category_themes')
     and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))) as client_execute,
  (select string_agg(a.attrelid::regclass::text || '.' || a.attname, ', '
                     order by a.attrelid::regclass::text, a.attname)
   from pg_attribute a
   where a.attrelid in ('public.resolution_plan_steps'::regclass, 'public.problem_categories'::regclass)
     and a.attname in ('critical', 'theme', 'not_quality') and not a.attisdropped) as columns,
  (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conrelid = 'public.problem_themes'::regclass and c.conname = 'problem_themes_source_check')
    as theme_sources,
  (select count(*) from public.problem_themes t where t.source = 'category') as themes_by_category,
  (select count(*) from public.problems p where p.category_id is not null) as tasks_with_category,
  (select count(*) from public.resolution_plan_steps) as plan_steps;
