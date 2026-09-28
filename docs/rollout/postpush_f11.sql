-- Post-push check for F11 (docs/f11-plan.md, «9. Выкат по шагам», step 6). Read-only, one
-- statement, catalog and counts only. Run right after the db push of the five F11 files:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_f11.sql
--
-- Every label reads the same under supabase_read_only_user (it has bypassrls). Table grants come
-- from pg_class.relacl: information_schema.role_table_grants shows that role nothing and a check
-- built on it passes without checking (CLAUDE.md). It names objects the push creates, so it fails
-- outright on a push that stopped part-way — then read the head alone (remote_head.sql).
--
-- Expected, label by label (local stack after db:reset, 2026-09-28; the cloud baseline before
-- the push was read the same day with scripts/cloud-read.mjs):
--   head           20260928140000.
--   functions      one row per name, overloads = 1, config {search_path=""}, md5 prefix / length /
--                  definer exactly:
--                    assign_problem            3746831d  2627 t
--                    chat_participates_as      dcc8b012  3589 t
--                    claim_push_batch          96633725  6870 t
--                    claim_push_receipts       d049d571   334 t
--                    cleans_property_as        787fd4ef   400 t
--                    enqueue_daily_digest      54b53d4a  1741 t
--                    forget_push_token         1738dff3    96 t
--                    guard_task_transitions    c96824e9  3665 t
--                    open_cleanings_by_listing 90e5c6ec   298 f
--                    property_open_cleanings   415b0631   710 t
--                    purge_push_history        faa86814   405 t
--                    push_digest_hour          2bdfd84e    10 f
--                    push_history_kept         c5f2c3f1    26 f
--                    push_lease                f0eb38aa    29 f
--                    push_lifetime             b492e431    30 f
--                    push_on_booking_status    4217d556   989 t
--                    push_on_chat_message      9e7e1734  2289 t
--                    push_on_task_change       f6b04fa8  9793 t
--                    push_quiet_end            2bdfd84e    10 f
--                    push_quiet_start          923b4778    11 f
--                    push_receipt_delay        88539d53    30 f
--                    push_send_after           8b3e34c7   606 f
--                    push_settle               49478dcf    30 f
--                    push_timezone             23215d02    24 f
--                    push_tokens_per_person    016cec6c    12 f
--                    record_push_receipts      46a4cdd4   666 t
--                    record_push_results       10cdb50b  1474 t
--                    register_push_token       acf65339  1180 t
--                    save_task                 a90159bf 10937 t
--                    set_property_status       5b613443  3611 t
--                    set_push_preference       edb2d8ef  1277 t
--                    unregister_push_token     1cb0457f   105 t
--                  The md5 must match exactly; a different one is a file saved with CRLF or a body
--                  edited after this list — recompute before the push, never after.
--   function_privs anon -> false everywhere. authenticated -> true on the client calls
--                  (register_push_token, unregister_push_token, set_push_preference,
--                  push_tokens_per_person), on the ten constants (push_timezone, push_quiet_start,
--                  push_quiet_end, push_digest_hour, push_settle, push_lifetime, push_send_after,
--                  push_lease, push_receipt_delay, push_history_kept) and on the replaced save_task,
--                  assign_problem, set_property_status, property_open_cleanings,
--                  open_cleanings_by_listing. FALSE on the triggers (push_on_*), the sender's calls
--                  (claim_*, record_*, forget_push_token, purge_push_history, enqueue_daily_digest)
--                  and the participation cores (cleans_property_as, chat_participates_as).
--                  guard_task_transitions -> true is the cloud's own ACL before F11 (create or
--                  replace keeps it) and harmless: a trigger function cannot be called directly.
--   tables         push_tokens: rls on, no grant to anon, authenticated or PUBLIC, no policy.
--                  push_preferences: rls on, authenticated SELECT only, one policy
--                  "person reads own push preferences" (SELECT). raw.push_outbox and
--                  raw.push_tickets: no grant to anon, authenticated or PUBLIC (raw's default
--                  privileges give service_role only).
--   triggers       tasks_push_insert, tasks_push_update, chat_messages_push,
--                  reservations_push_status — all enabled ('O').
--   cron_jobs      ten, all active, run as postgres; new: send-push '* * * * *',
--                  push-daily-digest '5 * * * *', push-history-purge '40 2 * * *'.
--   queue          right after the push: outbox 0, tickets 0, tokens 0 — nothing is written until
--                  a phone registers a token, and tokens come only with build 1.1.0.
--   public_grants  every table in public with its authenticated / anon / PUBLIC privileges:
--                  compare with the matrix of supabase/tests/table_grants.sql; any anon or PUBLIC
--                  row is a stop.
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload

  union all
  select 2, 'functions',
         (select jsonb_agg(jsonb_build_object(
                   'name', f.name,
                   'overloads', (select count(*) from pg_proc p2
                                 where p2.pronamespace = 'public'::regnamespace and p2.proname = f.name),
                   'md5', left(md5(p.prosrc), 8), 'len', length(p.prosrc),
                   'definer', p.prosecdef, 'config', p.proconfig) order by f.name)
          from unnest(array['assign_problem', 'chat_participates_as', 'claim_push_batch',
                            'claim_push_receipts', 'cleans_property_as', 'enqueue_daily_digest',
                            'forget_push_token', 'guard_task_transitions',
                            'open_cleanings_by_listing', 'property_open_cleanings',
                            'purge_push_history', 'push_digest_hour', 'push_history_kept',
                            'push_lease', 'push_lifetime', 'push_on_booking_status',
                            'push_on_chat_message', 'push_on_task_change', 'push_quiet_end',
                            'push_quiet_start', 'push_receipt_delay', 'push_send_after',
                            'push_settle', 'push_timezone', 'push_tokens_per_person',
                            'record_push_receipts', 'record_push_results', 'register_push_token',
                            'save_task', 'set_property_status', 'set_push_preference',
                            'unregister_push_token']) as f(name)
          left join pg_proc p
            on p.pronamespace = 'public'::regnamespace and p.proname = f.name)

  union all
  select 3, 'function_privs',
         (select jsonb_agg(jsonb_build_object(
                   'name', p.proname,
                   'authenticated', has_function_privilege('authenticated', p.oid, 'execute'),
                   'anon', has_function_privilege('anon', p.oid, 'execute')) order by p.proname)
          from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and (p.proname like 'push\_%' or p.proname in (
                   'assign_problem', 'chat_participates_as', 'claim_push_batch',
                   'claim_push_receipts', 'cleans_property_as', 'enqueue_daily_digest',
                   'forget_push_token', 'guard_task_transitions', 'open_cleanings_by_listing',
                   'property_open_cleanings', 'purge_push_history', 'record_push_receipts',
                   'record_push_results', 'register_push_token', 'save_task',
                   'set_property_status', 'set_push_preference', 'unregister_push_token')))

  union all
  select 4, 'tables',
         (select jsonb_agg(jsonb_build_object(
                   'table', c.oid::regclass::text,
                   'rls', c.relrowsecurity,
                   'client_grants', (select coalesce(jsonb_object_agg(g.grantee, g.privileges), '{}'::jsonb)
                                     from (select case when a.grantee = 0 then 'PUBLIC'
                                                       else a.grantee::regrole::text end as grantee,
                                                  string_agg(a.privilege_type, ',' order by a.privilege_type) as privileges
                                           from aclexplode(c.relacl) a
                                           where a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)
                                           group by 1) g),
                   'policies', (select jsonb_agg(jsonb_build_object('name', po.policyname, 'cmd', po.cmd)
                                                 order by po.policyname)
                                from pg_policies po
                                where po.schemaname = c.relnamespace::regnamespace::text
                                  and po.tablename = c.relname)) order by c.oid::regclass::text)
          from pg_class c
          where c.oid in ('public.push_tokens'::regclass, 'public.push_preferences'::regclass,
                          'raw.push_outbox'::regclass, 'raw.push_tickets'::regclass))

  union all
  select 5, 'triggers',
         (select jsonb_agg(jsonb_build_object('table', t.tgrelid::regclass::text, 'name', t.tgname,
                                              'enabled', t.tgenabled) order by t.tgname)
          from pg_trigger t
          where not t.tgisinternal
            and t.tgname in ('tasks_push_insert', 'tasks_push_update', 'chat_messages_push',
                             'reservations_push_status'))

  union all
  select 6, 'cron_jobs',
         (select jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule,
                                              'active', j.active, 'user', j.username)
                           order by j.jobname)
          from cron.job j)

  union all
  select 7, 'queue',
         jsonb_build_object(
           'outbox', (select count(*) from raw.push_outbox),
           'tickets', (select count(*) from raw.push_tickets),
           'tokens', (select count(*) from public.push_tokens),
           'preferences', (select count(*) from public.push_preferences))

  union all
  select 8, 'public_grants',
         (select jsonb_agg(jsonb_build_object('table', t.relname, 'grants', t.grants) order by t.relname)
          from (select c.relname,
                       (select coalesce(jsonb_object_agg(g.grantee, g.privileges), '{}'::jsonb)
                        from (select case when a.grantee = 0 then 'PUBLIC'
                                          else a.grantee::regrole::text end as grantee,
                                     string_agg(a.privilege_type, ',' order by a.privilege_type) as privileges
                              from aclexplode(c.relacl) a
                              where a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)
                              group by 1) g) as grants
                from pg_class c
                where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')) t)
) checks
order by ord;
