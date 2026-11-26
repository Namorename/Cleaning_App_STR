-- The probe of the boards' stage 4 and of a task's planned day (20261126120000, 20261126130000;
-- docs/rollout/boards-dates-chats-1126.md): one read-only SELECT, before and after each push and
-- after a rollback. Run: node scripts/cloud-read.mjs <this file>.
-- No names, no texts: versions, md5 of function bodies and policies, privileges, columns, counts.
select
  (select max(version) from supabase_migrations.schema_migrations) as head,
  (select string_agg(p.proname || '(' || p.pronargs || ') ' || md5(p.prosrc), '; '
                     order by p.proname, p.pronargs)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('manager_board_for_cards', 'manager_board_for_edit', 'manager_card_for_edit',
                       'save_manager_board', 'save_manager_card', 'move_manager_card',
                       'push_board_card_titles', 'transfer_manager_board', 'push_on_board_transferred',
                       'push_board_titles', 'save_manager_board_column', 'order_manager_board_columns',
                       'set_manager_board_column_done', 'delete_manager_board_column',
                       'manager_column_for_edit', 'manager_board_cards_column', 'manager_board_relabel',
                       'manager_board_column_for', 'manager_boards_first_columns',
                       'manager_board_visible', 'manager_card_readable',
                       'manager_board_columns_readable', 'report_problem', 'set_problem_due_date',
                       'problem_due_check', 'duplicate_manager_card', 'set_manager_card_assignee')) as functions,
  (select string_agg(p.proname || '(' || p.pronargs || '):'
                     || has_function_privilege('anon', p.oid, 'execute') || '/'
                     || has_function_privilege('authenticated', p.oid, 'execute'), ', '
                     order by p.proname, p.pronargs)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('save_manager_board', 'save_manager_card', 'move_manager_card',
                       'transfer_manager_board', 'push_board_titles', 'save_manager_board_column',
                       'order_manager_board_columns', 'set_manager_board_column_done',
                       'delete_manager_board_column', 'manager_column_for_edit',
                       'manager_board_cards_column', 'manager_board_relabel', 'manager_board_column_for',
                       'manager_boards_first_columns', 'manager_board_visible', 'manager_card_readable',
                       'manager_board_columns_readable', 'push_on_board_transferred',
                       'report_problem', 'set_problem_due_date', 'problem_due_check')) as client_execute,
  (select string_agg(c.relname || '.' || po.polname || ' '
                     || md5(coalesce(pg_get_expr(po.polqual, po.polrelid), '')), '; '
                     order by c.relname, po.polname)
   from pg_policy po
   join pg_class c on c.oid = po.polrelid
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('manager_boards', 'manager_board_cards', 'manager_board_steps',
                       'manager_board_entries', 'manager_board_columns',
                       'manager_board_transfers')) as policies,
  (select string_agg(c.relname || '.' || a.attname || ' ' || format_type(a.atttypid, a.atttypmod)
                     || case when a.attnotnull then ' not null' else '' end, ', '
                     order by c.relname, a.attname)
   from pg_attribute a
   join pg_class c on c.oid = a.attrelid
   where c.relnamespace = 'public'::regnamespace
     and ((c.relname = 'manager_boards' and a.attname = 'shared')
          or (c.relname = 'manager_board_cards' and a.attname = 'column_id')
          or (c.relname = 'problems' and a.attname = 'due_on'))
     and a.attnum > 0 and not a.attisdropped) as new_columns,
  (select string_agg(c.relname || ' ' || coalesce(g.grantee::regrole::text, 'PUBLIC') || ':' || g.privilege_type, ','
                     order by c.relname, g.grantee, g.privilege_type)
   from pg_class c, aclexplode(c.relacl) g
   where c.oid in (to_regclass('public.manager_board_columns'), to_regclass('public.manager_board_transfers'))
     and (g.grantee = 0 or g.grantee in ('anon'::regrole, 'authenticated'::regrole))) as new_table_grants,
  (select string_agg(t.tgrelid::regclass::text || '.' || t.tgname, ',' order by t.tgrelid::regclass::text, t.tgname)
   from pg_trigger t
   where t.tgrelid in ('public.manager_boards'::regclass, 'public.manager_board_cards'::regclass,
                       'public.manager_board_entries'::regclass)
     and not t.tgisinternal) as board_triggers,
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
   from pg_enum e where e.enumtypid = 'public.push_kind'::regtype) as push_kinds,
  (select count(*) from public.manager_boards) as boards,
  (select count(*) from public.manager_board_cards) as cards,
  (select json_object_agg(k, n) from (
     select column_key as k, count(*) as n from public.manager_board_cards group by 1) c) as cards_by_key,
  (select count(*) from public.problems where status in ('open', 'assigned', 'in_progress')) as open_tasks
