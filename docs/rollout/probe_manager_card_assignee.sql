-- The assignee of a manager board card (20261118230000) in the cloud, read-only:
--   node scripts/cloud-read.mjs docs/rollout/probe_manager_card_assignee.sql
-- Answers before the migration as well as after (docs/rollout/manager-card-assignee-1118.md has
-- both). The migration only adds: a nullable column, a journal kind, a push kind, two functions;
-- three bodies change. Statuses old phones parse and the boards' tables' grants read the same.
select
  (select max(version) from supabase_migrations.schema_migrations) as head,
  (select count(*) from supabase_migrations.schema_migrations) as applied,
  (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':notnull=' || a.attnotnull::text, ', ')
   from pg_attribute a
   where a.attrelid = 'public.manager_board_cards'::regclass and a.attname = 'assignee_id'
     and not a.attisdropped) as assignee_column,
  (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conname = 'manager_board_entries_kind_known') as journal_kinds,
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e
   where e.enumtypid = 'public.push_kind'::regtype) as push_kinds,
  (select string_agg(p.proname || '(' || p.pronargs || ') ' || md5(p.prosrc), '; '
                     order by p.proname, p.pronargs)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like '%manager_board%' or p.proname like '%manager_card%'
          or p.proname like '%manager_step%' or p.proname like '%manager_comment%')) as functions,
  -- Who may call them: authenticated the RPCs, service_role the titles of a push, nobody else.
  (select string_agg(p.proname || ':' || coalesce(r.rolname, 'PUBLIC'), ', '
                     order by p.proname, coalesce(r.rolname, 'PUBLIC'))
   from pg_proc p
   cross join lateral aclexplode(p.proacl) a
   left join pg_roles r on r.oid = a.grantee
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like '%manager_board%' or p.proname like '%manager_card%'
          or p.proname like '%manager_step%' or p.proname like '%manager_comment%')
     and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))) as client_execute,
  -- The push of an assignment: the journal's trigger and the sender's reader of titles.
  (select string_agg(p.proname || ' ' || md5(p.prosrc), '; ' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('push_on_card_assigned', 'push_board_card_titles')) as push_functions,
  (select string_agg(t.tgname, ', ' order by t.tgname) from pg_trigger t
   where t.tgrelid = 'public.manager_board_entries'::regclass and not t.tgisinternal) as journal_triggers,
  (select string_agg(coalesce(r.rolname, 'PUBLIC'), ',' order by coalesce(r.rolname, 'PUBLIC'))
   from pg_proc p
   cross join lateral aclexplode(p.proacl) a
   left join pg_roles r on r.oid = a.grantee
   where p.oid = to_regprocedure('public.push_board_card_titles(uuid[])')
     and (a.grantee = 0 or r.rolname in ('anon', 'authenticated', 'service_role'))) as titles_execute,
  (select string_agg(c.relname || ':' || coalesce(r.rolname, 'PUBLIC') || ':' || a.privilege_type, ', '
                     order by c.relname, coalesce(r.rolname, 'PUBLIC'), a.privilege_type)
   from pg_class c
   cross join lateral aclexplode(c.relacl) a
   left join pg_roles r on r.oid = a.grantee
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
     and c.relname in ('manager_boards', 'manager_board_cards', 'manager_board_steps',
                       'manager_board_entries')
     and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))) as client_grants,
  -- Old phones parse these strictly: unchanged.
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e
   where e.enumtypid = 'public.task_status'::regtype) as task_statuses,
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e
   where e.enumtypid = 'public.problem_status'::regtype) as problem_statuses,
  (select count(*) from public.manager_board_cards) as cards;
