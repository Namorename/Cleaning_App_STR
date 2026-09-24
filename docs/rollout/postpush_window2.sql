-- Post-push check for window 2 (20260924100000 chat_media, 20260924110000 chat_rpc_race,
-- 20260924120000 chat_media_expiry): did all three files land, with the objects, bodies and
-- privileges intended? Read-only, one result set, no personal columns. Run it once BEFORE the push
-- (the baseline: the ACLs of the four functions window 2 replaces must not change) and right after:
--
--   npx supabase db query --linked -f docs/rollout/postpush_window2.sql > postpush_window2.json
--
-- Next to it, docs/rollout/postpush_package.sql: the five package bodies must print exactly the
-- md5 / length / ACL of its header. Its head row will now print 20260924120000; the header's
-- "anything but 20260923130000 is a stopped push" was written for the package push, not this one.
--
-- Expected after the push, label by label:
--   head              20260924120000. 20260924100000 or 20260924110000 means the push stopped
--                     part-way: each file is its own transaction, so the later files are simply
--                     absent. Repeat the push with the same guard and the new head in HEAD_WANT.
--   functions         one row per name, overloads = 1, owner postgres, config {search_path=""},
--                     md5 prefix / length / definer / ACL exactly (local stack after db:reset,
--                     2026-09-24; the four replaced functions keep the ACL they have in the cloud):
--                       add_message_media             83bfc857 4053 t {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                       chat_media_upload_window      55f626c4   28 f {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                       chat_media_written_meanwhile  64284aed  451 t {postgres=X/postgres}
--                       confirm_task_media            79e81e91 1139 t {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                       remove_task_media             a0bc246c 1549 t {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                       send_message                  66d820ec 3022 t {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                       task_media_to_purge           2cda1590 1443 t {postgres=X/postgres,service_role=X/postgres}
--                     Before the push the cloud prints the old bodies of the four replaced ones:
--                     confirm_task_media 35cf9f90/892, remove_task_media ef65ad5b/1281,
--                     send_message 35b81d52/2328, task_media_to_purge da557f6f/686.
--   function_privs    authenticated: add_message_media, chat_media_upload_window, confirm_task_media,
--                     remove_task_media, send_message -> true; chat_media_written_meanwhile,
--                     task_media_to_purge -> false. anon -> false everywhere.
--   task_media_grants authenticated: SELECT only. anon: nothing.
--   task_media_shape  message_id uuid null; the FK to chat_messages on delete cascade; the
--                     three-owner task_media_one_owner; the partial index task_media_message_idx.
--   task_media_policies  four permissive SELECT policies to authenticated, listed in DESCENDING name
--                     order, which is the order Postgres OR-s them in: "problem media is read by
--                     whoever reads the problem", "managers read all task media", "chat message
--                     media is read by whoever reads the message", "assignee reads media of own
--                     tasks". The managers' is_manager() branch must come before the chat one
--                     (docs/chat-plan.md, "Выигрыш от порядка политик").
--   public_grants     every table in public with its authenticated / anon privileges: compare with
--                     the matrix of supabase/tests/table_grants.sql; any anon row is a stop.
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
          from unnest(array['add_message_media', 'chat_media_upload_window',
                            'chat_media_written_meanwhile', 'confirm_task_media',
                            'remove_task_media', 'send_message', 'task_media_to_purge']) as f(name)
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
            and p.proname in ('add_message_media', 'chat_media_upload_window',
                              'chat_media_written_meanwhile', 'confirm_task_media',
                              'remove_task_media', 'send_message', 'task_media_to_purge'))

  union all
  select 4, 'task_media_grants',
         (select coalesce(jsonb_agg(jsonb_build_object('grantee', g.grantee, 'privilege', g.privilege_type)
                                    order by g.grantee, g.privilege_type), '[]'::jsonb)
          from information_schema.role_table_grants g
          where g.table_schema = 'public' and g.table_name = 'task_media'
            and g.grantee in ('anon', 'authenticated'))

  union all
  select 5, 'task_media_shape',
         jsonb_build_object(
           'message_id', (select jsonb_build_object('type', format_type(a.atttypid, a.atttypmod),
                                                    'not_null', a.attnotnull)
                          from pg_attribute a
                          where a.attrelid = 'public.task_media'::regclass
                            and a.attname = 'message_id' and not a.attisdropped),
           'constraints', (select jsonb_agg(jsonb_build_object('name', c.conname,
                                                               'def', pg_get_constraintdef(c.oid))
                                            order by c.conname)
                           from pg_constraint c
                           where c.conrelid = 'public.task_media'::regclass
                             and (c.conname = 'task_media_one_owner'
                                  or (c.contype = 'f'
                                      and c.confrelid = 'public.chat_messages'::regclass))),
           'message_index', (select pg_get_indexdef(i.indexrelid)
                             from pg_index i
                             where i.indexrelid = to_regclass('public.task_media_message_idx')))

  union all
  select 6, 'task_media_policies',
         (select jsonb_agg(jsonb_build_object('name', po.policyname, 'cmd', po.cmd,
                                              'roles', po.roles::text, 'permissive', po.permissive)
                           order by po.policyname desc)
          from pg_policies po
          where po.schemaname = 'public' and po.tablename = 'task_media')

  union all
  select 7, 'public_grants',
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
