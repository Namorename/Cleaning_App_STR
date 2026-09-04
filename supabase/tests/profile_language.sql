-- The language a person wants to be spoken to in. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- The app picks its own language from the device; this column is for the
-- server side, where there is no device to ask — the push notifications of
-- F11 have to choose a language before the phone is involved.
--
-- Null means "never chosen": the sender falls back to the default rather than
-- guessing. Storing a guess would be indistinguishable from a real choice.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('a1b2c3d4-1111-4111-8111-a1b2c3d40001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','lang.owner@test.local','x',now(),now(),
   '{"full_name":"Owner"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a1b2c3d4-2222-4222-8222-a1b2c3d40002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','lang.other@test.local','x',now(),now(),
   '{"full_name":"Other"}'::jsonb, '{"role":"cleaner"}'::jsonb);

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.language(user_id uuid)
returns text language sql as $$
  select p.preferred_language::text from public.profiles p where p.id = user_id
$$;

select pg_temp.check('the three languages the app ships with are the ones on offer',
  (select array_agg(e.enumlabel::text order by e.enumlabel)
   from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'app_language'),
  array['cs', 'en', 'ru']);

select pg_temp.check('a fresh profile has made no choice',
  pg_temp.language('a1b2c3d4-1111-4111-8111-a1b2c3d40001'), null::text);

-- ---------- a person chooses for herself ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a1b2c3d4-1111-4111-8111-a1b2c3d40001","role":"authenticated"}';

update public.profiles set preferred_language = 'cs'
where id = 'a1b2c3d4-1111-4111-8111-a1b2c3d40001';

-- Someone else's profile is not hers to set, however friendly the intent.
update public.profiles set preferred_language = 'ru'
where id = 'a1b2c3d4-2222-4222-8222-a1b2c3d40002';

reset role;

select pg_temp.check('a person sets her own language',
  pg_temp.language('a1b2c3d4-1111-4111-8111-a1b2c3d40001'), 'cs');
select pg_temp.check('a person cannot set the language of someone else',
  pg_temp.language('a1b2c3d4-2222-4222-8222-a1b2c3d40002'), null::text);

-- ---------- a language the app does not speak ----------
do $$
begin
  update public.profiles set preferred_language = 'de'
  where id = 'a1b2c3d4-1111-4111-8111-a1b2c3d40001';
  raise exception 'FAIL a profile accepted a language with no translation file';
exception when invalid_text_representation then
  raise notice 'ok  a language the app does not ship is refused';
end $$;

rollback;
