-- Nothing in public is anon's to call, and the next sequence or function
-- starts with no client grant it was not meant to have.
--
-- SEQUENCES. 20260825030000 took the sequence defaults away from anon and
-- 20260907150000 the table defaults away from authenticated, but nobody took
-- the sequence defaults away from authenticated: the local stack hands it
-- UPDATE on every new sequence in public, and hosted Supabase gives more
-- through the same mechanism (docs/rollout/postpush_step1.sql reads what the
-- cloud has). There is no sequence in public today; the first identity column
-- would bring one, and with it `setval` for any signed-in account.
--
-- FUNCTIONS. anon holds USAGE on public (20260825030000 kept it on purpose), so
-- every function PUBLIC may execute is an /rpc/<name> endpoint for anyone who
-- has the publishable key -- and that key ships in both apps. On the local
-- stack sixteen of ours were: the RLS helpers is_manager, auth_role and
-- is_active_user (security definer, they read profiles),
-- short_cleaning_threshold, and twelve trigger functions. The helpers answer
-- nothing but "no" to a caller without a session, but the rule of
-- this schema is that a client holds only what a migration granted it, and
-- the default had quietly granted these to the world.
--
-- Who loses what:
--   * anon and PUBLIC lose EXECUTE. Nobody in the application calls anything
--     as anon, and PUBLIC stood for every role that exists.
--   * authenticated and service_role keep every function they could call: for
--     each non-trigger function that PUBLIC could execute they get an explicit
--     grant in the same breath. That matters for the RLS helpers -- a policy
--     runs its functions as the caller -- and for short_cleaning_threshold,
--     which the generated column tasks.is_short_measurement evaluates as
--     whoever writes the task row.
--   * Trigger functions get no grant at all. EXECUTE on a trigger function is
--     checked once, when CREATE TRIGGER names it; firing it checks nothing, so
--     supabase_auth_admin keeps firing handle_new_user and sync_profile_email
--     on auth.users exactly as before.
--   * supabase_read_only_user (scripts/cloud-read.mjs) loses is_manager,
--     auth_role and is_active_user, which it could call through PUBLIC. It has
--     bypassrls, so no policy it passes calls them, and no file in
--     docs/rollout calls them outright.
-- Functions that are members of an extension are the extension's and are not
-- touched; there are none in public on the local stack.
--
-- DEFAULTS. A per-schema default privilege can only ADD to the global one,
-- and the global one hands EXECUTE on every new function to PUBLIC unless an
-- entry with no schema says otherwise ("you cannot revoke privileges
-- per-schema if they are granted globally", ALTER DEFAULT PRIVILEGES). So the
-- PUBLIC revoke is global -- for functions postgres creates anywhere, which in
-- this project is public and raw, and raw is closed to clients already -- and
-- the grant to authenticated and service_role is for public only. A new
-- function in public is then callable by those two, as it was, and by
-- nobody else. A function postgres creates in any other schema -- pg_temp
-- included -- is callable by its owner alone until someone grants it: the
-- test suites, whose pg_temp helpers run as authenticated, grant them so for
-- the length of their own transaction, and an Auth hook, should one ever be
-- written, needs its grant to supabase_auth_admin spelled out (as Supabase
-- asks anyway).
--
-- Checked by supabase/tests/table_grants.sql; in the cloud by
-- docs/rollout/postpush_step1.sql.

-- ---------- sequences ----------
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;

-- ---------- functions that exist ----------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as routine,
           p.prorettype in ('pg_catalog.trigger'::pg_catalog.regtype,
                            'pg_catalog.event_trigger'::pg_catalog.regtype) as is_trigger,
           exists (select 1
                   from pg_catalog.aclexplode(
                          coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                   where a.grantee = 0) as public_may,
           exists (select 1
                   from pg_catalog.aclexplode(
                          coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                   where a.grantee = 'anon'::pg_catalog.regrole) as anon_may
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::pg_catalog.regnamespace
      and not exists (select 1 from pg_catalog.pg_depend d
                      where d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                        and d.objid = p.oid
                        and d.deptype = 'e')
  loop
    if r.anon_may then
      execute format('revoke execute on routine %s from anon', r.routine);
    end if;
    if r.public_may then
      -- What authenticated and service_role had through PUBLIC they now hold
      -- in their own name; a trigger function needs no grant to fire.
      if not r.is_trigger then
        execute format('grant execute on routine %s to authenticated, service_role', r.routine);
      end if;
      execute format('revoke execute on routine %s from public', r.routine);
    end if;
  end loop;
end $$;

-- ---------- functions to come ----------
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon;
alter default privileges for role postgres in schema public
  grant execute on functions to authenticated, service_role;
