-- Manager boards (20261118200000) in the cloud, read-only:
--   node scripts/cloud-read.mjs docs/rollout/probe_manager_boards.sql
-- Answers before the migration as well as after (docs/rollout/manager-boards-1118.md has both).
-- The migration only adds: four tables, their policies, sixteen functions. The rest of the work
-- — the statuses old phones parse, the counts of cleanings, tasks and their journals — must read
-- the same before and after.
select
  (select max(version) from supabase_migrations.schema_migrations) as head,
  (select count(*) from supabase_migrations.schema_migrations) as applied,
  (select string_agg(c.relname || ':rls=' || c.relrowsecurity::text, ', ' order by c.relname)
   from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and c.relname in ('manager_boards', 'manager_board_cards', 'manager_board_steps',
                       'manager_board_entries')) as tables,
  -- What the clients and PUBLIC (grantee 0) hold on them: SELECT for authenticated, nothing else.
  (select string_agg(c.relname || ':' || coalesce(r.rolname, 'PUBLIC') || ':' || a.privilege_type, ', '
                     order by c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
   from pg_class c
   cross join lateral aclexplode(c.relacl) a
   left join pg_roles r on r.oid = a.grantee
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and c.relname in ('manager_boards', 'manager_board_cards', 'manager_board_steps',
                       'manager_board_entries')
     and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))) as client_grants,
  (select string_agg(c.relname || ':' || p.polname, '; ' order by c.relname, p.polname)
   from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('manager_boards', 'manager_board_cards', 'manager_board_steps',
                       'manager_board_entries')) as policies,
  (select string_agg(p.proname || '(' || p.pronargs || ') ' || md5(p.prosrc), '; '
                     order by p.proname, p.pronargs)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like '%manager_board%' or p.proname like '%manager_card%'
          or p.proname like '%manager_step%' or p.proname like '%manager_comment%')) as functions,
  (select string_agg(p.proname || ':' || coalesce(r.rolname, 'PUBLIC'), ', '
                     order by p.proname, coalesce(r.rolname, 'PUBLIC'))
   from pg_proc p
   cross join lateral aclexplode(p.proacl) a
   left join pg_roles r on r.oid = a.grantee
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like '%manager_board%' or p.proname like '%manager_card%'
          or p.proname like '%manager_step%' or p.proname like '%manager_comment%')
     and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))) as client_execute,
  -- Old phones parse these strictly: unchanged.
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e
   where e.enumtypid = 'public.task_status'::regtype) as task_statuses,
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e
   where e.enumtypid = 'public.problem_status'::regtype) as problem_statuses,
  (select count(*) from public.tasks) as tasks,
  (select count(*) from public.problems) as problems;
