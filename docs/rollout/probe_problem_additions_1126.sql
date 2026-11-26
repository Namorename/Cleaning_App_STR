-- The probe of the office's additions (20261126100000; docs/problem-additions-1126.md): one read-only
-- SELECT, before and after the push and after a rollback. Run: node scripts/cloud-read.mjs <this file>.
-- No names, no texts: versions, md5 of function bodies and definitions, privileges, counts.
select
  (select max(version) from supabase_migrations.schema_migrations) as head,
  (select string_agg(p.proname || '(' || p.pronargs || ') ' || md5(p.prosrc), '; '
                     order by p.proname, p.pronargs)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('resolve_problem', 'remove_task_media', 'task_media_to_purge',
                       'mark_signal_false_positive', 'add_office_media', 'publish_office_media',
                       'publish_problem_addition', 'problem_closing_addition',
                       'journal_office_comment', 'problem_addition_max_files',
                       'send_message', 'confirm_task_media', 'can_read_task_media',
                       'can_upload_task_media')) as functions,
  (select string_agg(p.proname || '(' || p.pronargs || '):'
                     || has_function_privilege('anon', p.oid, 'execute') || '/'
                     || has_function_privilege('authenticated', p.oid, 'execute'), ', '
                     order by p.proname, p.pronargs)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('resolve_problem', 'add_office_media', 'publish_office_media',
                       'publish_problem_addition', 'problem_closing_addition',
                       'journal_office_comment', 'problem_addition_max_files')) as client_execute,
  (select string_agg(c.relname || '.' || po.polname || ' '
                     || md5(coalesce(pg_get_expr(po.polqual, po.polrelid), '')), '; '
                     order by c.relname, po.polname)
   from pg_policy po
   join pg_class c on c.oid = po.polrelid
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('task_media', 'problem_additions')) as policies,
  (select md5(pg_get_constraintdef(co.oid))
   from pg_constraint co
   where co.conrelid = 'public.task_media'::regclass and co.conname = 'task_media_one_owner') as owner_check,
  (select string_agg(a.attname, ',' order by a.attname)
   from pg_attribute a
   where a.attrelid = 'public.task_media'::regclass and a.attname = 'addition_id'
     and not a.attisdropped) as addition_column,
  (select string_agg(coalesce(g.grantee::regrole::text, 'PUBLIC') || ':' || g.privilege_type, ','
                     order by g.grantee, g.privilege_type)
   from pg_class c, aclexplode(c.relacl) g
   where c.oid = to_regclass('public.problem_additions')
     and (g.grantee = 0 or g.grantee in ('anon'::regrole, 'authenticated'::regrole))) as additions_grants,
  (select string_agg(t.tgname, ',' order by t.tgname)
   from pg_trigger t
   where t.tgrelid = 'public.chat_messages'::regclass and not t.tgisinternal) as chat_triggers,
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
   from pg_enum e
   where e.enumtypid = 'public.problem_event_kind'::regtype) as event_kinds,
  (select s.n_live_tup from pg_stat_user_tables s
   where s.relid = to_regclass('public.problem_additions')) as additions_rows,
  (select count(*) from public.problem_events e
   where e.kind::text in ('media_added', 'comment_added')) as new_kind_events,
  (select count(*) from public.problems p where p.status in ('open', 'assigned', 'in_progress')) as open_tasks
