-- A phone let go of after a sign-out it could not confirm (owner's word of
-- 2026-10-11, 00:40). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- The phone signs out without signal: the session is gone, the server still
-- sends her pushes to it. The phone keeps the token as "to be let go of" and
-- sends release_push_token(token, since) when it can — with no session, so as
-- anon. What is being protected:
-- - the release undoes only the binding the sign-out left: a token bound again
--   after `since` (someone signed in on the phone, or she did) stays bound;
-- - the call says nothing: no row, no error, the same for a token that is
--   there and one that is not;
-- - anon gets this one function and nothing else in public, and still no
--   right on push_tokens itself.
--
-- Fixture ids live in the a8f120xx range.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values ('a8f12000-0000-4000-8000-00000000000a', 'Host Release');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('a8f12001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.release@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a8f12002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bara.release@test.local','x',now(),now(),
   '{"full_name":"Bara"}'::jsonb, '{"role":"cleaner"}'::jsonb);

update public.profiles set host_id = 'a8f12000-0000-4000-8000-00000000000a'
where id in ('a8f12001-0000-4000-8000-000000000001', 'a8f12002-0000-4000-8000-000000000002');

-- Anna's phone, registered an hour ago; Bara's, registered just now.
insert into public.push_tokens (token, profile_id, host_id, platform, updated_at) values
  ('ExponentPushToken[release-anna]', 'a8f12001-0000-4000-8000-000000000001',
   'a8f12000-0000-4000-8000-00000000000a', 'ios', now() - interval '1 hour'),
  ('ExponentPushToken[release-bara]', 'a8f12002-0000-4000-8000-000000000002',
   'a8f12000-0000-4000-8000-00000000000a', 'android', now());

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

create or replace function pg_temp.bound(p_token text)
returns boolean language sql as $fn$
  select exists (select 1 from public.push_tokens t where t.token = p_token)
$fn$;

-- ---------- what anon may do ----------

select pg_temp.check('anon may let a phone go',
  has_function_privilege('anon', 'public.release_push_token(text, timestamptz)', 'EXECUTE'), true);
select pg_temp.check('a signed-in phone may too',
  has_function_privilege('authenticated', 'public.release_push_token(text, timestamptz)', 'EXECUTE'),
  true);
select pg_temp.check('anon may call nothing else in public',
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by 1), '')
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'release_push_token(text,timestamp with time zone)');
select pg_temp.check('anon still has no right on push_tokens',
  has_table_privilege('anon', 'public.push_tokens', 'SELECT,INSERT,UPDATE,DELETE'), false);

-- ---------- the release, as the phone sends it: no session ----------

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

-- Bound again after the sign-out (Bara signed in just now): stays.
select public.release_push_token('ExponentPushToken[release-bara]', now() - interval '30 minutes');
-- Bound before the sign-out: goes.
select public.release_push_token('ExponentPushToken[release-anna]', now() - interval '30 minutes');

reset role;
set local request.jwt.claims = '{}';

select pg_temp.check('a token bound before the sign-out is let go',
  pg_temp.bound('ExponentPushToken[release-anna]'), false);
select pg_temp.check('a token bound again after it stays',
  pg_temp.bound('ExponentPushToken[release-bara]'), true);

-- ---------- it says nothing ----------

-- What anon hears, kept to be checked once the role is back.
create temp table answers (label text primary key, said text, kind text);
grant insert on answers to anon;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into answers
select 'replay', public.release_push_token('ExponentPushToken[release-anna]', now())::text,
       pg_typeof(public.release_push_token('ExponentPushToken[release-anna]', now()))::text;
insert into answers
select 'unknown', public.release_push_token('ExponentPushToken[never-was]', now())::text,
       pg_typeof(public.release_push_token('ExponentPushToken[never-was]', now()))::text;
insert into answers
select 'nothing said', public.release_push_token(null, null)::text,
       pg_typeof(public.release_push_token(null, null))::text;

reset role;
set local request.jwt.claims = '{}';

select pg_temp.check('a replay, a token nobody has and a call with nothing all answer alike',
  (select string_agg(label || ':' || coalesce(said, 'null') || ':' || kind, ', ' order by label)
   from answers),
  'nothing said:null:void, replay:null:void, unknown:null:void');
select pg_temp.check('a call that said nothing left Bara bound',
  pg_temp.bound('ExponentPushToken[release-bara]'), true);

-- ---------- anon cannot read what it let go of ----------

set local role anon;
do $$
begin
  perform 1 from public.push_tokens;
  raise exception 'FAIL anon read push_tokens';
exception when insufficient_privilege then
  raise notice 'ok  anon reads no push_tokens';
end $$;
reset role;

rollback;
