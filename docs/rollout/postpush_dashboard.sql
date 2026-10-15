-- Post-push check for the owner's dashboard: 20261015100000_task_events,
-- 20261015110000_analytics, 20261015120000_analytics_series
-- (docs/rollout/dashboard-rollout.md, «После push»). Read-only, one statement,
-- catalog and counts only — no names, no ids of people. Run right after the db push:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_dashboard.sql
--
-- Grants come from pg_proc.proacl and pg_class.relacl through aclexplode (a function with no
-- ACL of its own reads its built-in default, acldefault) — information_schema shows the
-- read-only role nothing, and a check built on it passes without checking (CLAUDE.md).
--
-- Expected, label by label:
--   head            20261015120000.
--   functions       14 rows, one per name, overloads = 1 each, config {search_path=""}:
--                     definer true  — journal_task_change, analytics_guard and the seven public
--                                     ones (analytics_summary, analytics_series and the five
--                                     analytics_*_by_* tables);
--                     definer false — analytics_is_test_listing and the four analytics_*_rows.
--                   md5 prefix and length of prosrc (2026-10-15, local stack, the three files
--                   applied in a rolled-back transaction; files by sha256 prefix
--                   20261015100000 e989ca81, 20261015110000 dc610c17, 20261015120000 c3517375):
--                     analytics_checkout_rows           c77b8dc5   783
--                     analytics_checkouts_by_property   b0d460e2  1343
--                     analytics_cleaning_rows           e6d5e1e1  1753
--                     analytics_cleanings_by_cleaner    dbde8fa2  2257
--                     analytics_cleanings_by_property   c4cde6f0  2207
--                     analytics_guard                   6fe837e2   645
--                     analytics_is_test_listing         fb178b7a    53
--                     analytics_occupancy_rows          cd895d61  1250
--                     analytics_problem_rows            19f6edbe  1709
--                     analytics_problems_by_property    1604d2e4  1706
--                     analytics_problems_by_technician  18a0dba4  3269
--                     analytics_series                  17591522  2490
--                     analytics_summary                 ee04e104  4091
--                     journal_task_change               c4f65f2d  6460
--                   Files with another sha256 — recompute before the push
--                   (dashboard-rollout.md, «Перед push», step 3), never after.
--   function_privs  who of anon / authenticated / PUBLIC holds EXECUTE: ["authenticated"] for the
--                   seven public ones; [] for the other seven (rows, guard, test band, trigger).
--   journal_table   rls true; grants {"authenticated": "SELECT"} — nothing for anon or PUBLIC;
--                   one policy "managers read task events", cmd SELECT.
--   triggers        tasks_journal_cleaning_insert (after insert) and
--                   tasks_journal_cleaning_update (after update of four columns), both on
--                   public.tasks, enabled 'O', row true, when true.
--   kinds           the twelve labels of task_event_kind in order: created, assigned,
--                   reassigned, unassigned, accepted, started, completed, cancelled, expired,
--                   moved, reopened, status_changed.
--   journal         events written since the push hour, by kind (the generator's created,
--                   the office's assigned …): any, and growing on a second run.
--   demo_flow       on the demo listing 900000000001 today: cleanings by status and the kinds of
--                   their events — after the owner's accept, start, finish on the phone it holds
--                   "done" and the events accepted, started, completed (step 4 of «После push»).
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
          from unnest(array['journal_task_change', 'analytics_is_test_listing', 'analytics_guard',
                            'analytics_cleaning_rows', 'analytics_checkout_rows',
                            'analytics_occupancy_rows', 'analytics_problem_rows',
                            'analytics_summary', 'analytics_series',
                            'analytics_cleanings_by_property', 'analytics_cleanings_by_cleaner',
                            'analytics_checkouts_by_property', 'analytics_problems_by_property',
                            'analytics_problems_by_technician']) as f(name)
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
            and (p.proname like 'analytics\_%' or p.proname = 'journal_task_change'))

  union all
  select 4, 'journal_table',
         jsonb_build_object(
           'exists', to_regclass('public.task_events') is not null,
           'rls', (select c.relrowsecurity from pg_class c
                   where c.oid = to_regclass('public.task_events')),
           'policies', (select jsonb_agg(jsonb_build_object('name', po.policyname, 'cmd', po.cmd)
                                         order by po.policyname)
                        from pg_policies po
                        where po.schemaname = 'public' and po.tablename = 'task_events'),
           'grants', (select coalesce(jsonb_object_agg(t.grantee, t.privileges), '{}'::jsonb)
                      from (select case when a.grantee = 0 then 'PUBLIC'
                                        else a.grantee::regrole::text end as grantee,
                                   string_agg(a.privilege_type, ',' order by a.privilege_type) as privileges
                            from pg_class c
                            cross join lateral aclexplode(c.relacl) a
                            where c.oid = to_regclass('public.task_events')
                              and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)
                            group by 1) t))

  union all
  select 5, 'triggers',
         (select jsonb_agg(jsonb_build_object('table', t.tgrelid::regclass::text, 'name', t.tgname,
                                              'enabled', t.tgenabled,
                                              'row', (t.tgtype & 1) = 1,
                                              'when', t.tgqual is not null)
                           order by t.tgname)
          from pg_trigger t
          where not t.tgisinternal
            and t.tgname in ('tasks_journal_cleaning_insert', 'tasks_journal_cleaning_update'))

  union all
  select 6, 'kinds',
         (select jsonb_agg(e.enumlabel order by e.enumsortorder)
          from pg_enum e
          where e.enumtypid = to_regtype('public.task_event_kind'))

  union all
  -- to_regclass inside: the probe runs before the push too, and then says null.
  select 7, 'journal',
         case when to_regclass('public.task_events') is null then null
              else (select coalesce(jsonb_object_agg(x.kind, x.n), '{}'::jsonb)
                    from (select e.kind::text as kind, count(*) as n
                          from public.task_events e
                          where e.at >= date_trunc('hour', now())
                          group by 1) x)
         end

  union all
  select 8, 'demo_flow',
         jsonb_build_object(
           'cleanings', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
                         from (select t.status::text as status, count(*) as n
                               from public.tasks t
                               where t.property_id = 900000000001
                                 and t.scheduled_date = (now() at time zone 'Europe/Prague')::date
                               group by 1) x),
           'events', case when to_regclass('public.task_events') is null then null
                          else (select coalesce(jsonb_object_agg(x.kind, x.n), '{}'::jsonb)
                                from (select e.kind::text as kind, count(*) as n
                                      from public.task_events e
                                      join public.tasks t on t.id = e.task_id
                                      where t.property_id = 900000000001
                                        and t.scheduled_date = (now() at time zone 'Europe/Prague')::date
                                      group by 1) x)
                     end)
) checks
order by ord;
