-- Post-push check for window 3 (docs/window3-plan.md, «Порядок выката»). Read-only, one
-- statement, counts and catalog only. Run right after db push №1 (М1, Б1, Б2, В, Г) and again
-- right after db push №2 (М2):
--
--   npx supabase db query --linked -f docs/rollout/postpush_window3.sql > postpush_window3.json
--
-- Not before push №1: it names public.property_internal_notes, which М1 creates. The baseline
-- before the window is docs/rollout/window3_probe.sql. After push №1 also run
-- docs/rollout/window3_rule_check.sql — this file checks the catalog, that one the deployed rule
-- against live rows.
--
-- Expected, label by label:
--   head             after №1: 20260924170000; after №2: 20260924180000. Anything between
--                    20260924120000 and 20260924170000 means push №1 stopped part-way: each file
--                    is its own transaction, the later ones are simply absent. Repeat with
--                    HEAD_WANT = that version and LIST_WANT = the rest (plan, step 1).
--   functions        one row per name, overloads = 1, owner postgres, config {search_path=""},
--                    md5 prefix / length / definer / ACL exactly (local stack after db:reset,
--                    2026-09-24 — recompute if a body changes before the push):
--                      open_cleanings_by_listing   86fe197e  286 f {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                      property_open_cleanings     14dde466  698 t {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                      set_property_status         ff912a09 3513 t {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                      staff_property_ids          aa974876  958 t {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                    The cloud may add service_role on its own (hosting default privileges) —
--                    that is the only accepted difference.
--   function_privs   anon -> false on all four; authenticated -> true on all four.
--   properties_policies  two permissive policies, in DESCENDING name order (the order Postgres
--                    OR-s them in): "managers write properties" (ALL) first, then
--                    "field staff read their properties" (SELECT) with
--                    `id = ANY (ARRAY(SELECT staff_property_ids()))` in its qual.
--                    "active staff read properties" must be gone.
--   notes_table      exists, rls on, one policy "managers keep internal notes" (ALL);
--                    grants: authenticated DELETE,INSERT,SELECT,UPDATE; anon nothing.
--   notes_rows       the number of notes carried over (the cloud had 0 on 2026-09-24).
--   m2_gate          after №1 and before №2: column_exists true, not_carried 0, differs 0 — the
--                    two things М2 refuses on. After №2: column_exists false, both 0.
--   cron_jobs        seven, purge-webhook-events at "50 3 * * *", active, run as postgres.
--   indexes          tasks_assignee_property_idx and webhook_events_settled_received_idx, both
--                    partial, as in the migrations.
--   public_grants    every table in public with its authenticated / anon privileges: compare with
--                    the matrix of supabase/tests/table_grants.sql; any anon row is a stop.
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
                   'owner', p.proowner::regrole::text, 'definer', p.prosecdef,
                   'config', p.proconfig, 'acl', p.proacl::text) order by f.name)
          from unnest(array['open_cleanings_by_listing', 'property_open_cleanings',
                            'set_property_status', 'staff_property_ids']) as f(name)
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
            and p.proname in ('open_cleanings_by_listing', 'property_open_cleanings',
                              'set_property_status', 'staff_property_ids'))

  union all
  select 4, 'properties_policies',
         (select jsonb_agg(jsonb_build_object('name', po.policyname, 'cmd', po.cmd,
                                              'roles', po.roles::text, 'permissive', po.permissive,
                                              'qual', po.qual)
                           order by po.policyname desc)
          from pg_policies po
          where po.schemaname = 'public' and po.tablename = 'properties')

  union all
  select 5, 'notes_table',
         jsonb_build_object(
           'exists', to_regclass('public.property_internal_notes') is not null,
           'rls', (select c.relrowsecurity from pg_class c
                   where c.oid = 'public.property_internal_notes'::regclass),
           'policies', (select jsonb_agg(jsonb_build_object('name', po.policyname, 'cmd', po.cmd)
                                         order by po.policyname)
                        from pg_policies po
                        where po.schemaname = 'public' and po.tablename = 'property_internal_notes'),
           'grants', (select coalesce(jsonb_object_agg(t.grantee, t.privileges), '{}'::jsonb)
                      from (select g.grantee,
                                   string_agg(g.privilege_type, ',' order by g.privilege_type) as privileges
                            from information_schema.role_table_grants g
                            where g.table_schema = 'public' and g.table_name = 'property_internal_notes'
                              and g.grantee in ('anon', 'authenticated')
                            group by g.grantee) t))

  union all
  select 6, 'notes_rows',
         to_jsonb((select count(*) from public.property_internal_notes))

  union all
  -- The column through to_jsonb, so this runs on both sides of М2.
  select 7, 'm2_gate',
         jsonb_build_object(
           'column_exists', exists (select 1 from information_schema.columns
                                    where table_schema = 'public' and table_name = 'properties'
                                      and column_name = 'internal_notes'),
           'not_carried', (select count(*) from public.properties p
                           where nullif(btrim(to_jsonb(p) ->> 'internal_notes'), '') is not null
                             and not exists (select 1 from public.property_internal_notes n
                                             where n.property_id = p.id)),
           'differs', (select count(*) from public.properties p
                       join public.property_internal_notes n on n.property_id = p.id
                       where nullif(btrim(to_jsonb(p) ->> 'internal_notes'), '') is not null
                         and n.notes <> btrim(to_jsonb(p) ->> 'internal_notes')))

  union all
  select 8, 'cron_jobs',
         jsonb_build_object(
           'count', (select count(*) from cron.job),
           'jobs', (select jsonb_agg(jsonb_build_object('name', j.jobname, 'schedule', j.schedule,
                                                        'active', j.active, 'username', j.username)
                                     order by j.jobname)
                    from cron.job j))

  union all
  select 9, 'indexes',
         jsonb_build_object(
           'tasks_assignee_property_idx',
             (select pg_get_indexdef(i.indexrelid) from pg_index i
              where i.indexrelid = to_regclass('public.tasks_assignee_property_idx')),
           'webhook_events_settled_received_idx',
             (select pg_get_indexdef(i.indexrelid) from pg_index i
              where i.indexrelid = to_regclass('raw.webhook_events_settled_received_idx')))

  union all
  select 10, 'public_grants',
         (select jsonb_agg(jsonb_build_object('table', t.table_name, 'grantee', t.grantee,
                                              'privileges', t.privileges)
                           order by t.table_name, t.grantee)
          from (select g.table_name, g.grantee,
                       string_agg(g.privilege_type, ',' order by g.privilege_type) as privileges
                from information_schema.role_table_grants g
                where g.table_schema = 'public' and g.grantee in ('anon', 'authenticated')
                group by g.table_name, g.grantee) t)
) checks
order by ord;

-- ROLLBACK OF THE NARROWING, if push №1 shows a maid's screens losing names (plan, step 5).
-- A forward migration through the same guard, never a hand edit in Studio. It must DROP the new
-- policy as well: permissive policies are OR-ed, the new one comes first, and a failing
-- staff_property_ids() would fail every read even with the broad policy back beside it. Number:
-- between 20260924170000 and М2 while М2 is not in the cloud (park М2 again for that push), after
-- М2 once it is. Revert the window-3 cases of supabase/tests/rls_smoke.sql in the same change, or
-- test:rls will not pass.
--
--   set local lock_timeout = '3s';
--   drop policy "field staff read their properties" on public.properties;
--   create policy "active staff read properties"
--     on public.properties for select
--     to authenticated
--     using (public.is_active_user() and host_id = public.current_host_id());
