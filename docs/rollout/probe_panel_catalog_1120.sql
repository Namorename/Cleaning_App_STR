-- Probe of the panel's catalogue form (docs/panel-catalog-1120.md): read-only, through
-- node scripts/cloud-read.mjs docs/rollout/probe_panel_catalog_1120.sql, and the same query on the
-- local stack. One row: what the panel's «Новое задание» counts on in the database — nothing of it
-- is changed by this step, so the cloud must answer as the local stack the tests ran on.
with fns(name) as (
  values ('report_problem'), ('problem_category_for_report'), ('resolve_report_property'),
         ('validate_problem_text'), ('problem_theme'), ('refresh_category_themes'),
         ('set_problem_theme'), ('current_host_id'), ('is_active_user')
)
select
  (select max(version) from supabase_migrations.schema_migrations) as head,
  (select string_agg(p.proname || '(' || p.pronargs || ') ' || md5(p.prosrc), '; ' order by p.proname, p.pronargs)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in (select name from fns)) as functions,
  (select string_agg(pl.tablename || '.' || pl.policyname || ' ' || pl.cmd || ' '
                     || md5(coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, '')),
                     '; ' order by pl.tablename, pl.policyname)
   from pg_policies pl
   where pl.schemaname = 'public' and pl.tablename in ('problem_categories', 'hosts')) as policies,
  (select has_table_privilege('authenticated', 'public.problem_categories', 'SELECT')::text || '/'
          || has_column_privilege('authenticated', 'public.hosts', 'problem_report_mode', 'SELECT')::text || '/'
          || has_function_privilege('authenticated',
               'public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean, uuid)',
               'EXECUTE')::text || '/'
          || has_function_privilege('anon',
               'public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean, uuid)',
               'EXECUTE')::text) as client_rights,
  (select string_agg(problem_report_mode || ':' || n, ', ' order by problem_report_mode)
   from (select problem_report_mode, count(*) as n from public.hosts group by 1) m) as modes,
  (select string_agg(level || ':' || n, ', ' order by level)
   from (select case when critical then 'critical' else priority::text end as level, count(*) as n
         from public.problem_categories where archived_at is null group by 1) c) as live_categories,
  -- After the rollout: tasks the office filed under a category (the panel's form at work).
  (select count(*) from public.problems p join public.profiles pr on pr.id = p.reported_by
   where p.category_id is not null and pr.role::text in ('manager', 'admin', 'reception'))
    as office_filed_by_category;
