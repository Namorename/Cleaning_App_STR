-- Probe of the panel's edits and the reception (docs/panel-edits-reception-1119.md): read-only,
-- through node scripts/cloud-read.mjs docs/rollout/probe_panel_edits_reception.sql, and the same
-- query on the local rehearsal. One row; the rehearsal keeps «before» (the cloud) and «after».
with fns(name) as (
  values ('is_manager'), ('is_full_manager'), ('edit_problem_text'), ('set_guest_chats'),
         ('reset_guest_chat_reading'), ('update_host_settings'), ('manager_board_for_cards'),
         ('manager_board_for_edit'), ('manager_card_for_edit'), ('manager_step_card'),
         ('save_manager_board'), ('save_manager_card'), ('save_manager_comment'),
         ('save_manager_step'), ('delete_manager_comment'), ('delete_manager_step'),
         ('set_manager_board_archived'), ('update_signal_settings'), ('guard_profile_privileges'),
         ('chat_participates'), ('chat_participates_as'), ('chat_unread_threads'),
         ('push_on_task_change'), ('stamp_problem_closing'), ('stamp_task_closing'),
         ('guest_message_target'), ('journal_task_change'), ('journal_cleaning_time')
)
select
  (select max(version) from supabase_migrations.schema_migrations) as head,
  (select string_agg(p.proname || '(' || p.pronargs || ') ' || md5(p.prosrc), '; ' order by p.proname, p.pronargs)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in (select name from fns)) as functions,
  (select string_agg(pl.tablename || '.' || pl.policyname || ' ' || md5(coalesce(pl.qual, '') || '|' || coalesce(pl.with_check, '')),
                     '; ' order by pl.tablename, pl.policyname)
   from pg_policies pl
   where pl.schemaname = 'public'
     and pl.tablename in ('manager_boards', 'manager_board_cards', 'manager_board_steps',
                          'manager_board_entries', 'profiles')) as policies,
  (select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'EXECUTE')::text || '/'
                     || has_function_privilege('authenticated', p.oid, 'EXECUTE')::text || '/'
                     || has_function_privilege('service_role', p.oid, 'EXECUTE')::text, ', ' order by p.proname)
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('is_full_manager', 'edit_problem_text', 'set_guest_chats', 'reset_guest_chat_reading'))
    as client_execute,
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
   from pg_enum e where e.enumtypid = 'public.app_role'::regtype) as roles,
  (select count(*) from public.profiles where role::text = 'reception') as reception_people;
