-- The level above high, «Критическая», in the cloud (20261115090000), read-only:
--   node scripts/cloud-read.mjs docs/rollout/probe_problem_critical.sql
-- Reads the system catalogue and counts only, so it answers before the migration as
-- well as after (docs/rollout/wagner-problem-catalog-1114.md has both answers). The
-- md5 of every function the migration replaces is the guard that the cloud runs the
-- bodies the migration was generated from (and that its rollback brings back).
select
  (select max(version) from supabase_migrations.schema_migrations) as head,
  (select count(*) from supabase_migrations.schema_migrations) as applied,
  (select string_agg(p.proname || '(' || p.pronargs || ') ' || md5(p.prosrc), '; '
                     order by p.proname, p.pronargs)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname in ('report_problem', 'update_problem', 'api_v1_list_tasks', 'api_v1_create_task',
                        'problems_critical_follows_priority')
          or p.proname like 'analytics\_problem\_rows'
          or p.proname in ('analytics_summary', 'analytics_series', 'analytics_cleanings_by_property',
                           'analytics_cleanings_by_cleaner', 'analytics_checkouts_by_property',
                           'analytics_problems_by_property', 'analytics_problems_by_technician')
          or (p.proname = 'api_task_json' and p.pronargs = 2))) as functions,
  -- Who may call the writers and the analytics: the roles of the clients and PUBLIC (grantee 0).
  (select string_agg(distinct p.proname || ':' || coalesce(r.rolname, 'PUBLIC'), ', ')
   from pg_proc p
   cross join lateral aclexplode(p.proacl) a
   left join pg_roles r on r.oid = a.grantee
   where p.pronamespace = 'public'::regnamespace
     and (p.proname in ('report_problem', 'update_problem', 'problems_critical_follows_priority')
          or p.proname like 'analytics\_%')
     and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))) as client_execute,
  (select count(*) from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'analytics\_%'
     and 'p_levels' = any (p.proargnames)) as analytics_with_levels,
  (select string_agg(a.attrelid::regclass::text || '.' || a.attname, ', '
                     order by a.attrelid::regclass::text, a.attname)
   from pg_attribute a
   where a.attrelid in ('public.problems'::regclass)
     and a.attname = 'critical' and not a.attisdropped) as columns,
  (select string_agg(c.conname, ', ') from pg_constraint c
   where c.conrelid = 'public.problems'::regclass and c.conname = 'problems_critical_is_high')
    as constraints,
  (select string_agg(t.tgname, ', ') from pg_trigger t
   where t.tgrelid = 'public.problems'::regclass and t.tgname = 'problems_critical_follows_priority')
    as triggers,
  -- What an older phone parses: still exactly three values.
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e
   where e.enumtypid = 'public.problem_priority'::regtype) as priority_values,
  (select count(*) from public.problems) as problems,
  (select count(*) from public.problems where priority = 'high') as problems_high;
