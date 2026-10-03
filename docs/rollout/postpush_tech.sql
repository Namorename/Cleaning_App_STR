-- Post-push check for the stage «Техник и главный техник» + «Видео» (docs/tech-plan.md,
-- «Выкат серверной части»). Read-only, one statement, catalog only. Run right after the db
-- push of the eight files 20261003100000 … 20261003170000:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_tech.sql
--
-- Every label reads the same under supabase_read_only_user (it has bypassrls). Grants come
-- from pg_class.relacl and pg_proc.proacl through aclexplode — information_schema shows that
-- role nothing and a check built on it passes without checking (CLAUDE.md). A function with no
-- ACL of its own reads its built-in default (acldefault). It names objects the push creates,
-- so it fails outright on a push that stopped part-way — then read the head alone
-- (remote_head.sql) and see «Если выкат встал посередине» in the plan.
--
-- Expected, label by label (local stack after db:reset on tech-server, 2026-10-03):
--   head           20261003170000.
--   functions      25 rows, one per name, overloads = 1, config {search_path=""}; md5 prefix /
--                  length / definer exactly (computed from the migration files: the text between
--                  the dollar quotes of the last create of each name, read with newline='' so a
--                  CRLF would change it, md5 of its UTF-8 bytes; the same as md5(prosrc) and
--                  length(prosrc) on the local stack):
--                    add_task_media                 e22633c9  6950 t
--                    assign_problem                 9b868b96  3332 t
--                    chat_participates              47e5fe4b  4182 t
--                    chat_participates_as           1b1df35b  3891 t
--                    chat_unread_threads            ae74cb67  2902 t
--                    claim_push_batch               4863450e  9769 t
--                    enqueue_daily_digest           0f06eaa6  4347 t
--                    guard_link_role                5c1b47cf   383 t
--                    guard_task_fields              086fd1ec  2589 t
--                    guard_task_transitions         bba9946e  4571 t
--                    guard_tech_role_change         c830142e  1095 t
--                    head_tech_dispatching          f5691f4e   118 t
--                    head_tech_property_ids         3ecbfa7a   397 t
--                    is_head_tech                   539684f4    60 t
--                    journal_problem_change         b73cf164  1378 t
--                    journal_repair_change          96589394  3842 t
--                    problem_for_dispatch           fe38809b   585 f
--                    push_on_chat_message           f930d340  2686 t
--                    push_on_problem_reported       ef9de429  1074 t
--                    push_on_task_change            c420d547 13438 t
--                    save_task                      b377fcd9 11753 t
--                    staff_directory                5b9b99d2   231 t
--                    task_media_video_tolerance_sec 6276b5a1    19 f
--                    unassign_problem               1e2392ca  1740 t
--                    update_host_settings           2a2f6665  2078 t
--                  The md5 must match exactly; a different one is a file saved with CRLF or a body
--                  edited after this list — recompute before the push, never after.
--   function_privs per function, who of anon / authenticated / PUBLIC holds EXECUTE:
--                  anon and PUBLIC — nowhere. ["authenticated"] — the client calls and the
--                  policy helpers: add_task_media, assign_problem, chat_participates,
--                  chat_unread_threads, head_tech_property_ids, is_head_tech, save_task,
--                  staff_directory, task_media_video_tolerance_sec, unassign_problem,
--                  update_host_settings (11). [] — the other 14: chat_participates_as,
--                  claim_push_batch, enqueue_daily_digest, guard_link_role, guard_task_fields,
--                  guard_task_transitions, guard_tech_role_change, head_tech_dispatching,
--                  journal_problem_change, journal_repair_change, problem_for_dispatch,
--                  push_on_chat_message, push_on_problem_reported, push_on_task_change.
--                  guard_task_fields and guard_task_transitions may read ["authenticated"] in
--                  the cloud — its own ACL from before F11 (postpush_f11.sql), kept by create or
--                  replace — and that is harmless: a trigger function cannot be called.
--   problem_events rls on; authenticated SELECT only, nothing for anon or PUBLIC; policies
--                  "head tech reads problem events" and "managers read problem events" (SELECT);
--                  indexes problem_events_pkey, problem_events_problem_idx (problem_id,
--                  created_at, id), problem_events_task_idx (task_id) where task_id is not null;
--                  rows 0 — the journal starts on the day of the push.
--   triggers       six, all enabled ('O'), "row": true; "when" true for problems_journal_update
--                  and tasks_journal_repair only; columns:
--                    problems_journal_insert   problems          []
--                    problems_journal_update   problems          [archived_at, status]
--                    problems_push_reported    problems          []
--                    profiles_guard_tech_role  profiles          [role]
--                    property_cleaners_no_tech property_cleaners [cleaner_id]
--                    tasks_journal_repair      tasks             [assignee_id, scheduled_date,
--                                                                 status, time_from, time_to]
--   enums          app_role {cleaner,tech,head_tech,manager,admin}; push_kind ends
--                  {…,booking_cancelled_live,problem_new,chat_message,daily_digest}; problem_event_kind
--                  {reported,assigned,reassigned,unassigned,rescheduled,accepted,started,
--                  completed,attempt_cancelled,taken_off,status_changed,resolved,cancelled,
--                  reopened,archived,unarchived}.
--   policies       the head technician's, all SELECT to authenticated: "head tech reads every
--                  problem" (problems), "head tech reads repairs of problems" (tasks), "head
--                  tech reads steps of repairs" (task_steps), "head tech reads media of
--                  repairs" (task_media), "head tech reads places with problems" (properties),
--                  "head tech reads problem events" (problem_events); and "managers read
--                  problem events".
--   hosts_video    video_max_sec 120, video_bitrate_kbps 2000, video_max_mb 45 — not null, with
--                  their defaults; constraints hosts_video_max_sec_range (10..600),
--                  hosts_video_bitrate_kbps_range (500..20000), hosts_video_max_mb_range (5..150);
--                  values: every company 120 / 2000 / 45.
--   public_grants  every table in public with its authenticated / anon / PUBLIC privileges:
--                  compare with the matrix of supabase/tests/table_grants.sql (problem_events
--                  SELECT is new); any anon or PUBLIC row is a stop.
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
          from unnest(array['add_task_media', 'assign_problem', 'chat_participates',
                            'chat_participates_as', 'chat_unread_threads', 'claim_push_batch',
                            'enqueue_daily_digest', 'guard_link_role', 'guard_task_fields',
                            'guard_task_transitions', 'guard_tech_role_change',
                            'head_tech_dispatching', 'head_tech_property_ids', 'is_head_tech',
                            'journal_problem_change', 'journal_repair_change',
                            'problem_for_dispatch', 'push_on_chat_message',
                            'push_on_problem_reported', 'push_on_task_change', 'save_task',
                            'staff_directory', 'task_media_video_tolerance_sec',
                            'unassign_problem', 'update_host_settings']) as f(name)
          left join pg_proc p
            on p.pronamespace = 'public'::regnamespace and p.proname = f.name)

  union all
  select 3, 'function_privs',
         (select jsonb_agg(jsonb_build_object(
                   'name', p.proname,
                   'execute', (select coalesce(jsonb_agg(distinct
                                        case when a.grantee = 0 then 'PUBLIC'
                                             else a.grantee::regrole::text end), '[]'::jsonb)
                               from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                               where a.privilege_type = 'EXECUTE'
                                 and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)))
                   order by p.proname)
          from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('add_task_media', 'assign_problem', 'chat_participates',
                              'chat_participates_as', 'chat_unread_threads', 'claim_push_batch',
                              'enqueue_daily_digest', 'guard_link_role', 'guard_task_fields',
                              'guard_task_transitions', 'guard_tech_role_change',
                              'head_tech_dispatching', 'head_tech_property_ids', 'is_head_tech',
                              'journal_problem_change', 'journal_repair_change',
                              'problem_for_dispatch', 'push_on_chat_message',
                              'push_on_problem_reported', 'push_on_task_change', 'save_task',
                              'staff_directory', 'task_media_video_tolerance_sec',
                              'unassign_problem', 'update_host_settings'))

  union all
  select 4, 'problem_events',
         (select jsonb_build_object(
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
                                where po.schemaname = 'public' and po.tablename = 'problem_events'),
                   'indexes', (select jsonb_agg(pg_get_indexdef(i.indexrelid) order by i.indexrelid::regclass::text)
                               from pg_index i where i.indrelid = c.oid),
                   'rows', (select count(*) from public.problem_events))
          from pg_class c
          where c.oid = 'public.problem_events'::regclass)

  union all
  select 5, 'triggers',
         (select jsonb_agg(jsonb_build_object('table', t.tgrelid::regclass::text, 'name', t.tgname,
                                              'enabled', t.tgenabled,
                                              'row', (t.tgtype & 1) = 1,
                                              'when', t.tgqual is not null,
                                              'columns', (select coalesce(jsonb_agg(a.attname order by a.attname),
                                                                          '[]'::jsonb)
                                                          from pg_attribute a
                                                          where a.attrelid = t.tgrelid
                                                            and a.attnum = any (t.tgattr::int2[])))
                           order by t.tgname)
          from pg_trigger t
          where not t.tgisinternal
            and t.tgname in ('problems_journal_insert', 'problems_journal_update',
                             'problems_push_reported', 'profiles_guard_tech_role',
                             'property_cleaners_no_tech', 'tasks_journal_repair'))

  union all
  select 6, 'enums',
         jsonb_build_object(
           'app_role', to_jsonb(enum_range(null::public.app_role)::text[]),
           'push_kind', to_jsonb(enum_range(null::public.push_kind)::text[]),
           'problem_event_kind', to_jsonb(enum_range(null::public.problem_event_kind)::text[]))

  union all
  select 7, 'policies',
         (select jsonb_agg(jsonb_build_object('table', po.tablename, 'name', po.policyname,
                                              'cmd', po.cmd, 'roles', po.roles)
                           order by po.tablename, po.policyname)
          from pg_policies po
          where po.schemaname = 'public'
            and (po.policyname like 'head tech %' or po.policyname = 'managers read problem events'))

  union all
  select 8, 'hosts_video',
         jsonb_build_object(
           'columns', (select jsonb_agg(jsonb_build_object(
                                'name', a.attname, 'not_null', a.attnotnull,
                                'default', pg_get_expr(d.adbin, d.adrelid)) order by a.attname)
                       from pg_attribute a
                       left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
                       where a.attrelid = 'public.hosts'::regclass and a.attname like 'video\_%'
                         and not a.attisdropped),
           'constraints', (select jsonb_agg(jsonb_build_object('name', co.conname,
                                                               'def', pg_get_constraintdef(co.oid))
                                            order by co.conname)
                           from pg_constraint co
                           where co.conrelid = 'public.hosts'::regclass and co.conname like 'hosts\_video\_%'),
           'values', (select jsonb_agg(distinct jsonb_build_array(h.video_max_sec, h.video_bitrate_kbps,
                                                                  h.video_max_mb))
                      from public.hosts h))

  union all
  select 9, 'public_grants',
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

-- ROLLBACK. Each of the eight files is its own transaction; a revert is a forward migration
-- through the same dry-run gate (docs/units-plan.md, «Эксплуатация выката»), never a hand edit in
-- Studio. What may go back alone, and what may not — docs/tech-plan.md, «Выкат серверной части».
