-- The office cancel and a cleaner's hand-back (20261118120000) in the cloud, read-only:
--   node scripts/cloud-read.mjs docs/rollout/probe_cleaning_offs.sql
-- Answers before the migration as well as after (docs/rollout/cleaning-offs-1118.md has both):
-- the md5 of every function it replaces is the guard that the cloud runs the bodies they were
-- generated from, and that the rollback brings back.
select
  (select max(version) from supabase_migrations.schema_migrations) as head,
  (select count(*) from supabase_migrations.schema_migrations) as applied,
  (select string_agg(p.proname || '(' || p.pronargs || ') ' || md5(p.prosrc), '; '
                     order by p.proname, p.pronargs)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('api_v1_list_cleanings', 'generate_cleaning_tasks', 'guard_task_fields',
                       'guard_task_transitions', 'journal_task_change', 'push_on_task_change',
                       'cancel_cleaning', 'restore_cleaning', 'hand_back_cleaning',
                       'decline_cleaning', 'interrupt_cleaning', 'task_offs')) as functions,
  -- Who may call them: the roles of the clients and PUBLIC (grantee 0).
  (select string_agg(distinct p.proname || ':' || coalesce(r.rolname, 'PUBLIC'), ', ')
   from pg_proc p
   cross join lateral aclexplode(p.proacl) a
   left join pg_roles r on r.oid = a.grantee
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('cancel_cleaning', 'restore_cleaning', 'hand_back_cleaning',
                       'decline_cleaning', 'interrupt_cleaning', 'task_offs')
     and (a.grantee = 0 or r.rolname in ('anon', 'authenticated'))) as client_execute,
  (select string_agg(a.attrelid::regclass::text || '.' || a.attname, ', '
                     order by a.attrelid::regclass::text, a.attname)
   from pg_attribute a
   where a.attrelid in ('public.tasks'::regclass, 'public.task_events'::regclass)
     and a.attname in ('cancelled_at', 'cancelled_by', 'cancelled_from', 'cancel_departure',
                       'cancelled_closing', 'released_at', 'released_by', 'release_kind', 'reason')
     and not a.attisdropped) as columns,
  (select pg_get_constraintdef(c.oid) from pg_constraint c
   where c.conrelid = 'public.task_events'::regclass and c.conname = 'task_events_cause_known')
    as causes,
  -- Old phones parse these strictly: nine, as before.
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e
   where e.enumtypid = 'public.task_status'::regtype) as task_statuses,
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e
   where e.enumtypid = 'public.push_kind'::regtype) as push_kinds,
  (select count(*) from public.tasks) as tasks,
  (select count(*) from public.tasks where status = 'cancelled') as cancelled,
  (select count(*) from public.task_events) as task_events,
  (select count(*) from raw.push_outbox) as pushes;
