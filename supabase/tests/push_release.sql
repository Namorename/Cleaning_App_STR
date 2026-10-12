-- A phone let go of after a sign-out it could not confirm (owner's words of
-- 2026-10-11, 00:40 and 2026-10-12, 18:20). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- The phone signs out without signal: the session is gone, the server still
-- sends her pushes to it. The phone keeps the token, and whose it was, as "to
-- be let go of" and sends release_push_token(token, profile_id) when it can —
-- with no session, so as anon. What is being protected:
-- - the release undoes only her binding: a token bound to anyone else (the
--   next person who signed in on the phone) stays bound — no clock decides;
-- - the call says nothing: no row, no error, the same for her token, someone
--   else's and one that is not there;
-- - anon gets this one function, EXECUTE and nothing more, nothing else in
--   public, and still no right on push_tokens itself.
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

-- Anna's phone and her tablet, and the phone Bara signed in on after Anna
-- left it.
insert into public.push_tokens (token, profile_id, host_id, platform) values
  ('ExponentPushToken[release-anna]', 'a8f12001-0000-4000-8000-000000000001',
   'a8f12000-0000-4000-8000-00000000000a', 'ios'),
  ('ExponentPushToken[release-anna-b]', 'a8f12001-0000-4000-8000-000000000001',
   'a8f12000-0000-4000-8000-00000000000a', 'android'),
  ('ExponentPushToken[release-bara]', 'a8f12002-0000-4000-8000-000000000002',
   'a8f12000-0000-4000-8000-00000000000a', 'android');

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
  has_function_privilege('anon', 'public.release_push_token(text, uuid)', 'EXECUTE'), true);
select pg_temp.check('a signed-in phone may too',
  has_function_privilege('authenticated', 'public.release_push_token(text, uuid)', 'EXECUTE'),
  true);
select pg_temp.check('the function written in the ACL: EXECUTE for anon, and nothing for PUBLIC',
  (select string_agg(
            case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
              || ':' || a.privilege_type,
            ', ' order by 1)
   from pg_proc p, aclexplode(p.proacl) a
   where p.oid = 'public.release_push_token(text, uuid)'::regprocedure
     and (a.grantee = 0 or a.grantee = 'anon'::regrole)),
  'anon:EXECUTE');
select pg_temp.check('anon may call nothing else in public',
  (select coalesce(string_agg(p.oid::regprocedure::text, ', ' order by 1), '')
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and has_function_privilege('anon', p.oid, 'EXECUTE')),
  'release_push_token(text,uuid)');
-- Callable by anyone with the publishable key: it runs as its owner, so it
-- must not read a caller's search_path (review of 0ed1980).
select pg_temp.check('it runs as its owner, with an empty search_path',
  (select p.prosecdef::text || ' ' || coalesce(array_to_string(p.proconfig, ','), '')
   from pg_proc p where p.oid = 'public.release_push_token(text, uuid)'::regprocedure),
  'true search_path=""');
select pg_temp.check('no release by the clock is left behind',
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname = 'release_push_token'),
  1);
select pg_temp.check('anon still has no right on push_tokens',
  has_table_privilege('anon', 'public.push_tokens', 'SELECT,INSERT,UPDATE,DELETE'), false);

-- ---------- the release, as the phone sends it: no session ----------

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

-- Bara's phone, let go of in Anna's name: Bara's binding stays.
select public.release_push_token('ExponentPushToken[release-bara]',
                                 'a8f12001-0000-4000-8000-000000000001');
-- Anna's phone, in her own name: it goes.
select public.release_push_token('ExponentPushToken[release-anna]',
                                 'a8f12001-0000-4000-8000-000000000001');

reset role;
set local request.jwt.claims = '{}';

select pg_temp.check('her own token, in her name, is let go',
  pg_temp.bound('ExponentPushToken[release-anna]'), false);
-- The token is the key: a name alone lets go of nothing (review of 0ed1980 —
-- a release by profile alone would clear every phone she has).
select pg_temp.check('her other phone, not named, stays bound',
  pg_temp.bound('ExponentPushToken[release-anna-b]'), true);
select pg_temp.check('a token bound to someone else stays',
  pg_temp.bound('ExponentPushToken[release-bara]'), true);

-- ---------- a phone signed in as someone else lets go the same way ----------

-- Bara signed in on Anna's old phone before its release went out: the
-- client then calls as Bara. Anna's binding goes all the same.
insert into public.push_tokens (token, profile_id, host_id, platform) values
  ('ExponentPushToken[release-anna-2]', 'a8f12001-0000-4000-8000-000000000001',
   'a8f12000-0000-4000-8000-00000000000a', 'ios');

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a8f12002-0000-4000-8000-000000000002","role":"authenticated"}';
select public.release_push_token('ExponentPushToken[release-anna-2]',
                                 'a8f12001-0000-4000-8000-000000000001');
reset role;
set local request.jwt.claims = '{}';

select pg_temp.check('signed in as Bara, the phone lets go of Anna''s token in her name',
  pg_temp.bound('ExponentPushToken[release-anna-2]'), false);

-- ---------- it says nothing ----------

-- What anon hears, kept to be checked once the role is back.
create temp table answers (label text primary key, said text, kind text);
grant insert on answers to anon;

set local role anon;
set local request.jwt.claims = '{"role":"anon"}';

insert into answers
select 'own, again',
       public.release_push_token('ExponentPushToken[release-anna]',
                                 'a8f12001-0000-4000-8000-000000000001')::text,
       pg_typeof(public.release_push_token('ExponentPushToken[release-anna]',
                                           'a8f12001-0000-4000-8000-000000000001'))::text;
insert into answers
select 'someone else''s',
       public.release_push_token('ExponentPushToken[release-bara]',
                                 'a8f12001-0000-4000-8000-000000000001')::text,
       pg_typeof(public.release_push_token('ExponentPushToken[release-bara]',
                                           'a8f12001-0000-4000-8000-000000000001'))::text;
insert into answers
select 'unknown',
       public.release_push_token('ExponentPushToken[never-was]',
                                 'a8f12001-0000-4000-8000-000000000001')::text,
       pg_typeof(public.release_push_token('ExponentPushToken[never-was]',
                                           'a8f12001-0000-4000-8000-000000000001'))::text;
insert into answers
select 'nothing said', public.release_push_token(null, null)::text,
       pg_typeof(public.release_push_token(null, null))::text;
insert into answers
select 'no name', public.release_push_token('ExponentPushToken[release-bara]', null)::text,
       pg_typeof(public.release_push_token('ExponentPushToken[release-bara]', null))::text;
insert into answers
select 'no token',
       public.release_push_token(null, 'a8f12002-0000-4000-8000-000000000002')::text,
       pg_typeof(public.release_push_token(null, 'a8f12002-0000-4000-8000-000000000002'))::text;

reset role;
set local request.jwt.claims = '{}';

select pg_temp.check('her token again, someone else''s, an unknown one and an empty call answer alike',
  (select string_agg(label || ':' || coalesce(said, 'null') || ':' || kind, ', ' order by label)
   from answers),
  'no name:null:void, no token:null:void, nothing said:null:void, own, again:null:void, '
  || 'someone else''s:null:void, unknown:null:void');
select pg_temp.check('nothing said, no name, no token or the wrong name left Bara bound',
  pg_temp.bound('ExponentPushToken[release-bara]'), true);
select pg_temp.check('and Anna''s other phone too',
  pg_temp.bound('ExponentPushToken[release-anna-b]'), true);

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
