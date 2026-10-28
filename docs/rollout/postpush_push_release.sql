-- Post-push check for 20261011100000_push_release (release_push_token, the
-- one function anon may call). Read-only, one statement:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_push_release.sql
--
-- Run it before the push as well: the same labels give the picture to compare.
--
-- Expected after the push, label by label:
--   head       20261011100000 (before: 20261010100000).
--   function   exactly one row:
--                signature  release_push_token(text,uuid)
--                result     void
--                md5 / len  257e45a1 / 98 (the body in the migration file)
--                owner      postgres, volatility v, security_definer true,
--                config     ["search_path=\"\""]
--                acl        EXECUTE for postgres, anon, authenticated and
--                           service_role, and no entry for PUBLIC («=X/…»).
--              No row before the push. Two rows mean the clock draft
--              (text, timestamptz) is there as well — a stop.
--   anon       every function in public that anon may execute, with its ACL:
--              exactly release_push_token(text,uuid). Before the push: none.
--              Any other function is a stop.
--   public     false: PUBLIC holds no EXECUTE on release_push_token.
--   schema     USAGE of anon on schema public — the same before and after
--              (the migration grants nothing on the schema).
--   tokens     counts only, no rows: push_tokens and the profiles holding
--              them. The migration deletes nothing — the same before and
--              after, give or take sign-ins in between.
--   counts     functions in public and those authenticated may execute: the
--              empty anon list before the push was read from a full catalog.
--
-- A live call as anon belongs next to this check (POST
-- /rest/v1/rpc/release_push_token with the publishable key and no session,
-- a token that is not there): 204 and an empty body.
--
-- Pushed 2026-10-14, 17:02 UTC (owner's word of 19:05 Prague). Before: head
-- 20261010100000, no function, anon list [], schema usage true, tokens 2 of
-- one profile, functions 156 / authenticated 110. After: every label as
-- expected — acl {postgres=X/postgres,authenticated=X/postgres,
-- service_role=X/postgres,anon=X/postgres}, tokens 2 / 1, functions 157 /
-- 111. Calls as anon: a token that is not there and a random profile id —
-- 204, empty body; a real token with a profile id it is not bound to — 204,
-- empty body, and the row still bound to its profile.
--
-- ROLLBACK. There is no down migration. A forward migration with
-- `drop function public.release_push_token(text, uuid)` — and only once no
-- phone build or OTA calls it: until then a phone that signed out without
-- signal keeps its token pending and retries, and the server keeps sending
-- the former owner pushes.
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload
  union all
  select 2, 'function',
         (select jsonb_agg(jsonb_build_object(
                   'signature', p.oid::regprocedure::text,
                   'result', pg_get_function_result(p.oid),
                   'md5', left(md5(p.prosrc), 8), 'len', length(p.prosrc),
                   'owner', p.proowner::regrole::text, 'volatility', p.provolatile::text,
                   'security_definer', p.prosecdef,
                   'config', p.proconfig, 'acl', p.proacl::text)
                   order by p.oid::regprocedure::text)
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'release_push_token')
  union all
  select 3, 'anon',
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'signature', p.oid::regprocedure::text,
                   'acl', coalesce(p.proacl::text, 'NULL: the default, PUBLIC executes'))
                   order by p.oid::regprocedure::text), '[]'::jsonb)
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and has_function_privilege('anon', p.oid, 'execute'))
  union all
  select 4, 'public',
         (select jsonb_object_agg(p.oid::regprocedure::text,
                                  exists (select 1
                                            from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                           where a.grantee = 0))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname = 'release_push_token')
  union all
  select 5, 'schema',
         jsonb_build_object('anon_usage', has_schema_privilege('anon', 'public', 'usage'))
  union all
  select 6, 'tokens',
         (select jsonb_build_object('tokens', count(*), 'profiles', count(distinct t.profile_id))
            from public.push_tokens t)
  union all
  select 7, 'counts',
         (select jsonb_build_object(
                   'functions', count(*),
                   'authenticated_executes',
                   count(*) filter (where has_function_privilege('authenticated', p.oid, 'execute')))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace)
) t order by ord
