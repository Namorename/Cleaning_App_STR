-- Who receives a push, and which ones she wants. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected (docs/f11-plan.md, §3.1 and §4 M1):
-- - a device token belongs to exactly one person at a time. On a shared phone
--   it moves to whoever signed in last, so a push never lands on the screen of
--   the person who used the phone before;
-- - nobody reads or writes tokens directly. They are the addresses of other
--   people's phones, and a client reaches them only through the RPCs;
-- - which events a person wants is hers alone to say. It is kept on the server,
--   where the sender checks it, so the phone never hides anything on its own. A
--   replay after a lost connection lands in the same place, because the call
--   carries the wanted value and not a toggle.
--
-- Fixture ids live in the a8f110xx range.
begin;

-- The pg_temp helpers below are created by postgres, whose new functions no
-- longer go to PUBLIC (20260926100000), and they are called as authenticated
-- too. Hand them to that role for the length of this transaction.
alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('a8f11000-0000-4000-8000-00000000000a', 'Host Push A'),
  ('a8f11000-0000-4000-8000-00000000000b', 'Host Push B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('a8f11001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.push@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a8f11002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bara.push@test.local','x',now(),now(),
   '{"full_name":"Bara"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a8f11003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gone.push@test.local','x',now(),now(),
   '{"full_name":"Gone"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a8f11004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','dana.push@test.local','x',now(),now(),
   '{"full_name":"Dana"}'::jsonb, '{"role":"cleaner"}'::jsonb);

update public.profiles set host_id = 'a8f11000-0000-4000-8000-00000000000a'
where id in ('a8f11001-0000-4000-8000-000000000001',
             'a8f11002-0000-4000-8000-000000000002',
             'a8f11003-0000-4000-8000-000000000003');
update public.profiles set host_id = 'a8f11000-0000-4000-8000-00000000000b'
where id = 'a8f11004-0000-4000-8000-000000000004';
update public.profiles set is_active = false
where id = 'a8f11003-0000-4000-8000-000000000003';

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $fn$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$fn$;

create or replace function pg_temp.as_anna() returns void language sql as $fn$
  select pg_temp.as_user('a8f11001-0000-4000-8000-000000000001')
$fn$;
create or replace function pg_temp.as_bara() returns void language sql as $fn$
  select pg_temp.as_user('a8f11002-0000-4000-8000-000000000002')
$fn$;
create or replace function pg_temp.as_gone() returns void language sql as $fn$
  select pg_temp.as_user('a8f11003-0000-4000-8000-000000000003')
$fn$;
create or replace function pg_temp.as_dana() returns void language sql as $fn$
  select pg_temp.as_user('a8f11004-0000-4000-8000-000000000004')
$fn$;

-- The i18n key a refusal carries, or 'no refusal' when the statement went through.
create or replace function pg_temp.refusal_hint(stmt text) returns text
language plpgsql as $fn$
declare v_hint text;
begin
  execute stmt;
  return 'no refusal';
exception when others then
  get stacked diagnostics v_hint = PG_EXCEPTION_HINT;
  return coalesce(nullif(v_hint, ''), '(no hint)');
end $fn$;

-- The SQLSTATE, for the refusals that come from a grant or a constraint.
create or replace function pg_temp.refusal_code(stmt text) returns text
language plpgsql as $fn$
declare v_code text;
begin
  execute stmt;
  return 'no refusal';
exception when others then
  get stacked diagnostics v_code = RETURNED_SQLSTATE;
  return v_code;
end $fn$;

-- Read as postgres: the tables are closed to the client roles on purpose.
create or replace function pg_temp.owner_of(tok text) returns uuid language sql as $fn$
  select t.profile_id from public.push_tokens t where t.token = tok
$fn$;
create or replace function pg_temp.tokens_of(who uuid) returns int language sql as $fn$
  select count(*)::int from public.push_tokens t where t.profile_id = who
$fn$;
create or replace function pg_temp.muted_of(who uuid) returns text language sql as $fn$
  select p.muted::text from public.push_preferences p where p.profile_id = who
$fn$;

-- ---------- the events a person can switch off ----------
--
-- One per event the owner approved (docs/f11-plan.md, «Решения владельца»),
-- in the order the settings screen lists them. A new kind is a new migration
-- and a new switch; a person who never touched the screen gets it switched on.
-- problem_new, the head technician's new task, since 20261003150000.
select pg_temp.check('the kinds of push are the events of the plan',
  (select array_agg(e.enumlabel::text order by e.enumsortorder)
   from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'push_kind' and t.typnamespace = 'public'::regnamespace),
  array['cleaning_new', 'cleaning_assigned', 'cleaning_unassigned',
        'cleaning_cancelled', 'cleaning_moved', 'cleaning_window',
        'cleaning_free', 'booking_cancelled_live', 'problem_new', 'chat_message',
        'daily_digest']);

-- ---------- a phone registers its token ----------
select pg_temp.as_anna();
select public.register_push_token('ExponentPushToken[anna-phone-1]', 'ios', 'cs', '1.1.0');
reset role; reset request.jwt.claims;

select pg_temp.check('the token is hers',
  pg_temp.owner_of('ExponentPushToken[anna-phone-1]'), 'a8f11001-0000-4000-8000-000000000001'::uuid);
select pg_temp.check('with her company, platform, device language and app version',
  (select array[t.host_id::text, t.platform, t.language::text, t.app_version]
   from public.push_tokens t where t.token = 'ExponentPushToken[anna-phone-1]'),
  array['a8f11000-0000-4000-8000-00000000000a', 'ios', 'cs', '1.1.0']);

-- The same call again: the phone registers on every sign-in and whenever the
-- token rolls, and a lost answer is replayed from the offline queue.
select pg_temp.as_anna();
select public.register_push_token('ExponentPushToken[anna-phone-1]', 'ios', 'cs', '1.1.0');
reset role; reset request.jwt.claims;
select pg_temp.check('a replay keeps one row',
  pg_temp.tokens_of('a8f11001-0000-4000-8000-000000000001'), 1);

-- A new app version on the same phone updates the row in place.
select pg_temp.as_anna();
select public.register_push_token('ExponentPushToken[anna-phone-1]', 'ios', 'ru', '1.2.0');
reset role; reset request.jwt.claims;
select pg_temp.check('an update of the app rewrites the row, not a second one',
  (select array[t.language::text, t.app_version]
   from public.push_tokens t where t.token = 'ExponentPushToken[anna-phone-1]'),
  array['ru', '1.2.0']);

-- The device language and the app version may be missing: the sender takes the
-- profile's language first anyway, and then the company's.
select pg_temp.as_anna();
select public.register_push_token('ExponentPushToken[anna-phone-2]', 'android', null, null);
reset role; reset request.jwt.claims;
select pg_temp.check('a phone that does not say its language is still registered',
  pg_temp.owner_of('ExponentPushToken[anna-phone-2]'), 'a8f11001-0000-4000-8000-000000000001'::uuid);

-- ---------- a shared phone ----------
--
-- Bara signs in on the phone Anna used. The token is the phone's, not the
-- person's, so it moves: Anna's next push must not light up Bara's screen.
select pg_temp.as_bara();
select public.register_push_token('ExponentPushToken[anna-phone-1]', 'ios', 'cs', '1.2.0');
reset role; reset request.jwt.claims;
select pg_temp.check('a token moves to whoever signed in last',
  pg_temp.owner_of('ExponentPushToken[anna-phone-1]'), 'a8f11002-0000-4000-8000-000000000002'::uuid);
select pg_temp.check('and the one who used the phone before no longer holds it',
  pg_temp.tokens_of('a8f11001-0000-4000-8000-000000000001'), 1);

-- It moves across companies too: a phone is not a tenant's property.
select pg_temp.as_dana();
select public.register_push_token('ExponentPushToken[anna-phone-2]', 'android', 'en', '1.1.0');
reset role; reset request.jwt.claims;
select pg_temp.check('a token moves to a person of another company with her company',
  (select array[t.profile_id::text, t.host_id::text]
   from public.push_tokens t where t.token = 'ExponentPushToken[anna-phone-2]'),
  array['a8f11004-0000-4000-8000-000000000004', 'a8f11000-0000-4000-8000-00000000000b']);

-- ---------- signing out ----------
select pg_temp.as_anna();
select public.unregister_push_token('ExponentPushToken[anna-phone-1]');
reset role; reset request.jwt.claims;
select pg_temp.check('a person cannot unregister a token that is not hers',
  pg_temp.owner_of('ExponentPushToken[anna-phone-1]'), 'a8f11002-0000-4000-8000-000000000002'::uuid);

select pg_temp.as_bara();
select public.unregister_push_token('ExponentPushToken[anna-phone-1]');
select public.unregister_push_token('ExponentPushToken[anna-phone-1]');
reset role; reset request.jwt.claims;
select pg_temp.check('she unregisters her own, and a replay is not an error',
  pg_temp.owner_of('ExponentPushToken[anna-phone-1]'), null::uuid);

-- A dismissed person still signs out cleanly: she is the one who should stop
-- getting pushes, and her unregister must not bounce.
update public.profiles set is_active = true where id = 'a8f11003-0000-4000-8000-000000000003';
select pg_temp.as_gone();
select public.register_push_token('ExponentPushToken[gone-phone]', 'ios', null, null);
reset role; reset request.jwt.claims;
update public.profiles set is_active = false where id = 'a8f11003-0000-4000-8000-000000000003';
select pg_temp.as_gone();
select public.unregister_push_token('ExponentPushToken[gone-phone]');
reset role; reset request.jwt.claims;
select pg_temp.check('a dismissed person can still unregister her phone',
  pg_temp.owner_of('ExponentPushToken[gone-phone]'), null::uuid);

-- ---------- what is refused ----------
select pg_temp.as_gone();
select pg_temp.check('a dismissed person cannot register a phone',
  pg_temp.refusal_hint($q$select public.register_push_token('ExponentPushToken[gone-2]', 'ios', null, null)$q$),
  'serverErrors.notSignedIn');
reset role; reset request.jwt.claims;

select pg_temp.as_anna();
select pg_temp.check('something that is not an Expo token is refused',
  pg_temp.refusal_code($q$select public.register_push_token('not-a-token', 'ios', null, null)$q$),
  '23514');
select pg_temp.check('an unknown platform is refused',
  pg_temp.refusal_code($q$select public.register_push_token('ExponentPushToken[x-1]', 'web', null, null)$q$),
  '23514');
select pg_temp.check('an overlong app version is refused',
  pg_temp.refusal_code(format($q$select public.register_push_token('ExponentPushToken[x-2]', 'ios', null, %L)$q$,
                              repeat('9', 33))),
  '23514');
reset role; reset request.jwt.claims;

-- ---------- at most five phones a person ----------
--
-- A person reinstalls, changes phones, borrows one. Old tokens die on their own
-- (the sender drops them on DeviceNotRegistered), but a cap keeps a forgotten
-- pile from growing: the phone used longest ago goes first. The clock inside a
-- test transaction stands still, so the ages are set by hand.
select pg_temp.check('her other phones have moved on by now',
  pg_temp.tokens_of('a8f11001-0000-4000-8000-000000000001'), 0);

select pg_temp.as_anna();
select public.register_push_token('ExponentPushToken[anna-3]', 'ios', null, null);
select public.register_push_token('ExponentPushToken[anna-4]', 'ios', null, null);
select public.register_push_token('ExponentPushToken[anna-5]', 'ios', null, null);
select public.register_push_token('ExponentPushToken[anna-6]', 'ios', null, null);
select public.register_push_token('ExponentPushToken[anna-7]', 'ios', null, null);
reset role; reset request.jwt.claims;
update public.push_tokens set updated_at = now() - interval '5 days' where token = 'ExponentPushToken[anna-3]';
update public.push_tokens set updated_at = now() - interval '4 days' where token = 'ExponentPushToken[anna-4]';
update public.push_tokens set updated_at = now() - interval '3 days' where token = 'ExponentPushToken[anna-5]';
update public.push_tokens set updated_at = now() - interval '2 days' where token = 'ExponentPushToken[anna-6]';
update public.push_tokens set updated_at = now() - interval '1 day'  where token = 'ExponentPushToken[anna-7]';
select pg_temp.check('five phones are all kept',
  pg_temp.tokens_of('a8f11001-0000-4000-8000-000000000001'), 5);

select pg_temp.as_anna();
select public.register_push_token('ExponentPushToken[anna-8]', 'ios', null, null);
reset role; reset request.jwt.claims;
select pg_temp.check('a sixth phone keeps five',
  pg_temp.tokens_of('a8f11001-0000-4000-8000-000000000001'), 5);
select pg_temp.check('and the one used longest ago is the one let go',
  pg_temp.owner_of('ExponentPushToken[anna-3]'), null::uuid);
select pg_temp.check('the newest is kept',
  pg_temp.owner_of('ExponentPushToken[anna-8]'), 'a8f11001-0000-4000-8000-000000000001'::uuid);

-- ---------- tokens are closed to clients ----------
select pg_temp.as_anna();
select pg_temp.check('a client cannot read tokens',
  pg_temp.refusal_code($q$select count(*) from public.push_tokens$q$), '42501');
select pg_temp.check('nor write one past the RPC',
  pg_temp.refusal_code($q$insert into public.push_tokens (token, profile_id, host_id, platform)
                          values ('ExponentPushToken[forged]', 'a8f11002-0000-4000-8000-000000000002',
                                  'a8f11000-0000-4000-8000-00000000000a', 'ios')$q$), '42501');
reset role; reset request.jwt.claims;

select pg_temp.check('anon cannot call the RPCs',
  (select bool_or(has_function_privilege('anon', p.oid, 'EXECUTE'))
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('register_push_token', 'unregister_push_token', 'set_push_preference')),
  false);

-- ---------- which pushes a person wants ----------
select pg_temp.check('a person who never opened the settings has no row: everything is on',
  pg_temp.muted_of('a8f11001-0000-4000-8000-000000000001'), null::text);

select pg_temp.as_anna();
select public.set_push_preference('chat_message', false);
reset role; reset request.jwt.claims;
select pg_temp.check('switching an event off records it',
  pg_temp.muted_of('a8f11001-0000-4000-8000-000000000001'), '{chat_message}');

select pg_temp.as_anna();
select public.set_push_preference('chat_message', false);
select public.set_push_preference('daily_digest', false);
select public.set_push_preference('cleaning_new', false);
reset role; reset request.jwt.claims;
select pg_temp.check('a replay changes nothing, and the list keeps the order of the kinds',
  pg_temp.muted_of('a8f11001-0000-4000-8000-000000000001'), '{cleaning_new,chat_message,daily_digest}');

select pg_temp.as_anna();
select public.set_push_preference('chat_message', true);
select public.set_push_preference('chat_message', true);
select public.set_push_preference('cleaning_moved', true);
reset role; reset request.jwt.claims;
select pg_temp.check('switching back on removes it, and switching on what is on is harmless',
  pg_temp.muted_of('a8f11001-0000-4000-8000-000000000001'), '{cleaning_new,daily_digest}');

select pg_temp.as_anna();
select pg_temp.check('the RPC answers with her row, so the phone can show what the server holds',
  (select p.muted::text from public.set_push_preference('daily_digest', true) p),
  '{cleaning_new}');
reset role; reset request.jwt.claims;

-- She reads her own choice; the screen needs it after a reinstall.
select pg_temp.as_bara();
select public.set_push_preference('cleaning_window', false);
reset role; reset request.jwt.claims;

select pg_temp.as_anna();
select pg_temp.check('a person reads her own choice',
  (select array_agg(p.muted::text) from public.push_preferences p), array['{cleaning_new}']);
select pg_temp.check('and nobody else''s',
  (select count(*)::int from public.push_preferences p
   where p.profile_id = 'a8f11002-0000-4000-8000-000000000002'), 0);
select pg_temp.check('the table is written only through the RPC',
  pg_temp.refusal_code($q$update public.push_preferences set muted = '{}'$q$), '42501');
select pg_temp.check('and a row cannot be planted for someone else',
  pg_temp.refusal_code($q$insert into public.push_preferences (profile_id, host_id)
                          values ('a8f11002-0000-4000-8000-000000000002',
                                  'a8f11000-0000-4000-8000-00000000000a')$q$), '42501');
select pg_temp.check('an event that does not exist is refused',
  pg_temp.refusal_code($q$select public.set_push_preference('lottery_won', false)$q$), '22P02');
reset role; reset request.jwt.claims;

select pg_temp.as_gone();
select pg_temp.check('a dismissed person cannot change what she gets',
  pg_temp.refusal_hint($q$select public.set_push_preference('chat_message', false)$q$),
  'serverErrors.notSignedIn');
select pg_temp.check('nor read it',
  (select count(*)::int from public.push_preferences), 0);
reset role; reset request.jwt.claims;

rollback;
