-- Post-push check for step 1 of the pre-launch package: 20260926100000_grants_hygiene,
-- 20260926101000_media_rpc_one_owner, 20260926102000_generator_service_bookings. Read-only, one
-- statement, catalog only. Run right after the db push, with no question to the owner:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_step1.sql
--
-- Every label reads the same under supabase_read_only_user. Privileges come from has_*_privilege
-- and from proacl / relacl / pg_default_acl through aclexplode, never from information_schema:
-- that shows the read-only role only the grants it gave or holds, and the check would pass
-- without having checked anything. The read-only role may not execute is_service_booking or any
-- other function of ours (after this push PUBLIC holds none of them), so nothing here calls one.
--
-- Expected, label by label:
--   head               20260926102000. 20260926100000 or 20260926101000 means the push stopped
--                      part-way: each file is its own transaction, the later ones are simply
--                      absent -- push the rest before reading further.
--   functions          one row per name, overloads = 1, owner postgres, config {search_path=""},
--                      md5 prefix / length / definer / volatility / ACL exactly (local stack after
--                      db:reset, 2026-09-26 -- recompute if a body changes before the push):
--                        add_message_media            c9147cde  4121 t v {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                        add_problem_media            6d9e61bf  4577 t v {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                        add_task_media               88c707f6  5685 t v {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                        generate_cleaning_tasks      7730946a 13726 t v {postgres=X/postgres,service_role=X/postgres}
--                        is_service_booking           7e24094f    58 f i {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                        reservation_cleaning_window  3420c63a  1389 t s {postgres=X/postgres,service_role=X/postgres}
--                      The ACL of the five replaced ones is what the cloud already had (create or
--                      replace keeps it); a difference there is worth a look but is not this
--                      push's doing. The md5 must match exactly, and is_service_booking must exist.
--   anon_executable    [] -- no function of ours in public that anon may execute. Any row is a stop.
--   public_in_acl      [] -- no function of ours in public with PUBLIC in its ACL, written down or
--                      built in (a null proacl). Any row is a stop.
--   extension_members  the functions in public that belong to an extension, and whether anon may
--                      execute them. The migration leaves them alone on purpose; report them to
--                      the owner, do not fix them from here. The local stack has none.
--   helpers_kept       [] -- a row names a role that lost a helper PUBLIC used to give it: is_manager,
--                      auth_role, is_active_user (every RLS policy), short_cleaning_threshold (the
--                      generated column of tasks). A row is a stop: that role's reads or writes
--                      now fail.
--   generator_privs    anon false, authenticated false, service_role true.
--   default_acl        postgres's default privileges in public and globally (namespace 0), one row
--                      per object type and grantee, for the record.
--   default_acl_stops  [] -- a row is a stop: PUBLIC or anon under r, S or f; authenticated under S.
--   global_f           true: a global entry for functions exists and names no PUBLIC. false means
--                      the built-in PUBLIC execute still reaches every new function.
--   sequence_grants    [] -- no sequence in public held by anon, authenticated or PUBLIC.
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
                   'volatility', p.provolatile::text, 'config', p.proconfig,
                   'acl', p.proacl::text) order by f.name)
          from unnest(array['add_message_media', 'add_problem_media', 'add_task_media',
                            'generate_cleaning_tasks', 'is_service_booking',
                            'reservation_cleaning_window']) as f(name)
          left join pg_proc p
            on p.pronamespace = 'public'::regnamespace and p.proname = f.name)

  union all
  select 3, 'anon_executable',
         (select coalesce(jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text),
                          '[]'::jsonb)
          from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and not exists (select 1 from pg_depend d
                            where d.classid = 'pg_proc'::regclass and d.objid = p.oid
                              and d.deptype = 'e')
            and has_function_privilege('anon', p.oid, 'execute'))

  union all
  select 4, 'public_in_acl',
         (select coalesce(jsonb_agg(p.oid::regprocedure::text order by p.oid::regprocedure::text),
                          '[]'::jsonb)
          from pg_proc p
          cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
          where p.pronamespace = 'public'::regnamespace
            and not exists (select 1 from pg_depend d
                            where d.classid = 'pg_proc'::regclass and d.objid = p.oid
                              and d.deptype = 'e')
            and g.grantee = 0)

  union all
  select 5, 'extension_members',
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'function', p.oid::regprocedure::text,
                   'extension', e.extname,
                   'anon', has_function_privilege('anon', p.oid, 'execute'))
                   order by e.extname, p.oid::regprocedure::text), '[]'::jsonb)
          from pg_proc p
          join pg_depend d
            on d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e'
          join pg_extension e on e.oid = d.refobjid
          where p.pronamespace = 'public'::regnamespace)

  union all
  select 6, 'helpers_kept',
         (select coalesce(jsonb_agg(r || ' ' || f order by r, f), '[]'::jsonb)
          from unnest(array['authenticated', 'service_role']) r
          cross join unnest(array['public.is_manager()', 'public.auth_role()',
                                  'public.is_active_user()',
                                  'public.short_cleaning_threshold()']) f
          where not has_function_privilege(r, f, 'execute'))

  union all
  select 7, 'generator_privs',
         (select jsonb_object_agg(r, has_function_privilege(
                   r, 'public.generate_cleaning_tasks(date, date)', 'execute'))
          from unnest(array['anon', 'authenticated', 'service_role']) r)

  union all
  select 8, 'default_acl',
         (select jsonb_agg(jsonb_build_object('scope', t.scope, 'type', t.type,
                                              'grantee', t.grantee, 'privileges', t.privileges)
                           order by t.scope, t.type, t.grantee)
          from (select case when d.defaclnamespace = 0 then 'global'
                            else d.defaclnamespace::regnamespace::text end as scope,
                       d.defaclobjtype::text as type,
                       case when g.grantee = 0 then 'PUBLIC'
                            else g.grantee::regrole::text end as grantee,
                       string_agg(g.privilege_type, ',' order by g.privilege_type) as privileges
                from pg_default_acl d
                cross join lateral aclexplode(d.defaclacl) g
                where d.defaclrole = 'postgres'::regrole
                  and d.defaclnamespace in (0, 'public'::regnamespace)
                group by 1, 2, 3) t)

  union all
  select 9, 'default_acl_stops',
         (select coalesce(jsonb_agg(distinct
                   case when d.defaclnamespace = 0 then 'global' else 'public' end || ' '
                   || d.defaclobjtype::text || ' '
                   || case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end),
                   '[]'::jsonb)
          from pg_default_acl d
          cross join lateral aclexplode(d.defaclacl) g
          where d.defaclrole = 'postgres'::regrole
            and d.defaclnamespace in (0, 'public'::regnamespace)
            and ((d.defaclobjtype in ('r', 'S', 'f') and g.grantee in (0, 'anon'::regrole))
                 or (d.defaclobjtype = 'S' and g.grantee = 'authenticated'::regrole)))

  union all
  select 10, 'global_f',
         to_jsonb(exists (select 1 from pg_default_acl d
                          where d.defaclrole = 'postgres'::regrole
                            and d.defaclnamespace = 0
                            and d.defaclobjtype = 'f'
                            and not exists (select 1 from aclexplode(d.defaclacl) g
                                            where g.grantee = 0)))

  union all
  select 11, 'sequence_grants',
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'sequence', c.relname,
                   'grantee', case when g.grantee = 0 then 'PUBLIC'
                                   else g.grantee::regrole::text end,
                   'privilege', g.privilege_type) order by c.relname), '[]'::jsonb)
          from pg_class c
          cross join lateral aclexplode(c.relacl) g
          where c.relnamespace = 'public'::regnamespace
            and c.relkind = 'S'
            and g.grantee in (0, 'anon'::regrole, 'authenticated'::regrole))
) checks
order by ord;
