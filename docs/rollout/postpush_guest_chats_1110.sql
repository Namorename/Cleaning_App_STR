-- Guest chats behind their switch (20261110120000, docs/rollout/guest-chats-1110.md): the cloud
-- before the push, after it, and after a rollback. Catalog and counts only, one static statement
-- valid in every state (new columns are read through to_jsonb); no id, no text.
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_guest_chats_1110.sql
--
-- head        the newest migration applied;
-- raw         the three raw tables, if they exist;
-- raw_grants  what PUBLIC, anon and authenticated hold on them (nothing);
-- exec        who of PUBLIC, anon, authenticated, service_role may execute the chats' functions
--             (the job's: service_role; the helpers: nobody);
-- jobs        the chats' jobs and whether active (the two readings off, the purge on);
-- switch      the 'message' row's switch (null: no row — chats were never turned on);
-- facts       episodes by origin (no 'message' right after the push);
-- signals     guest signals by kind (no 'message');
-- settings_rows  signal_settings rows by kind (the reviews' row unchanged).
select json_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'raw', (select coalesce(json_agg(c.relname order by c.relname), '[]'::json)
          from pg_class c
          where c.relnamespace = 'raw'::regnamespace and c.relkind = 'r'
            and c.relname in ('signal_message_queue', 'signal_message_state', 'signal_message_runs')),
  'raw_grants', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select c.relname || ' ' || case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end
             || ' ' || g.privilege_type as x
      from pg_class c
      cross join lateral aclexplode(c.relacl) g
      where c.relnamespace = 'raw'::regnamespace
        and c.relname in ('signal_message_queue', 'signal_message_state', 'signal_message_runs')
        and (g.grantee = 0 or g.grantee::regrole::text in ('anon', 'authenticated'))) s),
  'exec', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select p.proname || ' ' ||
             coalesce(string_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end,
                                 ',' order by g.grantee::regrole::text), '-') as x
      from pg_proc p
      left join lateral aclexplode(p.proacl) g on g.privilege_type = 'EXECUTE'
        and (g.grantee = 0 or g.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('guest_message_state', 'collect_guest_message_events', 'queue_polled_conversations',
                          'claim_guest_conversations', 'guest_conversation_stay',
                          'reserve_guest_message_reading', 'fail_guest_message_reading',
                          'finish_guest_conversation', 'apply_guest_message_reading',
                          'purge_guest_message_links', 'message_theme_finding', 'guest_message_place',
                          'guest_message_failure_passes',
                          'guest_messages_shown', 'signal_message_month_start')
      group by p.oid, p.proname) s),
  'jobs', (select coalesce(json_object_agg(j.jobname, j.active), '{}'::json)
           from cron.job j
           where j.jobname in ('read-guest-messages', 'read-guest-messages-0440', 'purge-guest-message-links')),
  'switch', (select to_jsonb(s) ->> 'messages_enabled' from public.signal_settings s where s.kind = 'message'),
  'facts', (select coalesce(json_object_agg(o, n), '{}'::json) from (
      select f.origin as o, count(*) as n from public.issue_facts f group by f.origin) s),
  'signals', (select coalesce(json_object_agg(k, n), '{}'::json) from (
      select g.kind as k, count(*) as n from public.guest_signals g group by g.kind) s),
  'settings_rows', (select coalesce(json_object_agg(k, n), '{}'::json) from (
      select s.kind as k, count(*) as n from public.signal_settings s group by s.kind) s)
) as out;
