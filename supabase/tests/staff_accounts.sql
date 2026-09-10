-- Staff accounts: the mirrored login and the listing links. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is checked: that profiles.email tells the truth about auth.users and
-- that nobody signed in can rewrite it, and that save_property_cleaner keeps
-- "one automatic cleaner per listing" as an answer a person can read.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('e1000001-0000-4000-8000-0000000000a1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.staff@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('e1000002-0000-4000-8000-0000000000a2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.staff@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('e1000003-0000-4000-8000-0000000000a3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.staff@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  -- No name at all: the refusal has to fall back to something printable.
  ('e1000004-0000-4000-8000-0000000000a4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','nameless.staff@test.local','x',now(),now(),
   '{}'::jsonb, '{"role":"cleaner"}'::jsonb);

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900002901, 'Staff Flat One', 'UTC', '15:00', '10:00'),
  (900002902, 'Staff Flat Two', 'UTC', '15:00', '10:00');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

-- unique_violation joins the caught codes: "this listing already has an
-- automatic cleaner" is raised with it, and an uncaught one would abort the set.
create or replace function pg_temp.refusal(statement text)
returns text language plpgsql as $$
declare
  v_hint   text;
  v_detail text;
begin
  execute statement;
  return 'no refusal';
exception when check_violation or insufficient_privilege
             or invalid_parameter_value or unique_violation then
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return v_hint || coalesce(' ' || nullif(v_detail, ''), '');
end $$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;
create or replace function pg_temp.as_maria() returns void language sql as $$
  select pg_temp.as_user('e1000001-0000-4000-8000-0000000000a1') $$;
create or replace function pg_temp.as_boss() returns void language sql as $$
  select pg_temp.as_user('e1000003-0000-4000-8000-0000000000a3') $$;

create or replace function pg_temp.email_of(user_id uuid) returns text language sql as $$
  select p.email from public.profiles p where p.id = user_id $$;
create or replace function pg_temp.touched_at(user_id uuid) returns timestamptz language sql as $$
  select p.updated_at from public.profiles p where p.id = user_id $$;
create or replace function pg_temp.link(prop bigint, cleaner uuid)
returns public.property_cleaners language sql as $$
  select pc.* from public.property_cleaners pc
  where pc.property_id = prop and pc.cleaner_id = cleaner $$;

-- ---------- the login, mirrored ----------

select pg_temp.check('a new account brings its address into the profile',
  pg_temp.email_of('e1000001-0000-4000-8000-0000000000a1'), 'maria.staff@test.local');

update auth.users set email = 'maria.new@test.local'
where id = 'e1000001-0000-4000-8000-0000000000a1';

select pg_temp.check('changing the address in auth moves the mirror with it',
  pg_temp.email_of('e1000001-0000-4000-8000-0000000000a1'), 'maria.new@test.local');

-- Every sign-in rewrites auth.users. If that reached profiles, the whole
-- company would look freshly edited every morning.
do $$
declare
  v_before timestamptz := pg_temp.touched_at('e1000002-0000-4000-8000-0000000000a2');
begin
  perform pg_sleep(0.01);
  update auth.users set last_sign_in_at = now()
  where id = 'e1000002-0000-4000-8000-0000000000a2';
  perform pg_temp.check('signing in does not touch the profile',
    pg_temp.touched_at('e1000002-0000-4000-8000-0000000000a2'), v_before);
end $$;

-- ---------- and nobody signed in may rewrite it ----------

select pg_temp.as_maria();
update public.profiles set email = 'maria.self@test.local', full_name = 'Maria S.'
where id = 'e1000001-0000-4000-8000-0000000000a1';
reset role; reset request.jwt.claims;

select pg_temp.check('a cleaner cannot rewrite her own login',
  pg_temp.email_of('e1000001-0000-4000-8000-0000000000a1'), 'maria.new@test.local');
select pg_temp.check('but the rest of her own profile is still hers',
  (select full_name from public.profiles where id = 'e1000001-0000-4000-8000-0000000000a1'),
  'Maria S.');

select pg_temp.as_boss();
update public.profiles set email = 'maria.boss@test.local'
where id = 'e1000001-0000-4000-8000-0000000000a1';
reset role; reset request.jwt.claims;

select pg_temp.check('a manager cannot rewrite it either — the address belongs to auth',
  pg_temp.email_of('e1000001-0000-4000-8000-0000000000a1'), 'maria.new@test.local');

-- ---------- who cleans a listing ----------

select pg_temp.as_boss();
select public.save_property_cleaner(900002901, 'e1000001-0000-4000-8000-0000000000a1',
                                    'claim', 2);

select pg_temp.check('a manager links a cleaner to a listing',
  (pg_temp.link(900002901, 'e1000001-0000-4000-8000-0000000000a1')).mode,
  'claim'::public.assignment_mode);
select pg_temp.check('with the position she was given',
  (pg_temp.link(900002901, 'e1000001-0000-4000-8000-0000000000a1')).priority, 2::smallint);

-- The panel sends the whole state of the row it is editing; a second send is
-- the same link on new terms, not a second link.
select public.save_property_cleaner(900002901, 'e1000001-0000-4000-8000-0000000000a1',
                                    'auto', 1);
select pg_temp.check('sending it again changes the terms, it does not add a row',
  (select count(*) from public.property_cleaners where property_id = 900002901), 1::bigint);
select pg_temp.check('and the new terms are the ones that stuck',
  (pg_temp.link(900002901, 'e1000001-0000-4000-8000-0000000000a1')).mode,
  'auto'::public.assignment_mode);

-- Confirming the arrangement that already holds must not read as a clash
-- with itself.
select public.save_property_cleaner(900002901, 'e1000001-0000-4000-8000-0000000000a1',
                                    'auto', 1);
select pg_temp.check('the automatic cleaner may be saved again as she is',
  (pg_temp.link(900002901, 'e1000001-0000-4000-8000-0000000000a1')).mode,
  'auto'::public.assignment_mode);

select pg_temp.check('a second automatic cleaner is refused, and the refusal names the first',
  pg_temp.refusal($$select public.save_property_cleaner(
    900002901, 'e1000002-0000-4000-8000-0000000000a2', 'auto', 1)$$),
  'serverErrors.cleanerAutoTaken {"name": "Maria S."}');

-- Someone with no name still has to be identifiable in the refusal.
select public.save_property_cleaner(900002902, 'e1000004-0000-4000-8000-0000000000a4',
                                    'auto', 1);
select pg_temp.check('a nameless holder is named by the address he signs in with',
  pg_temp.refusal($$select public.save_property_cleaner(
    900002902, 'e1000002-0000-4000-8000-0000000000a2', 'auto', 1)$$),
  'serverErrors.cleanerAutoTaken {"name": "nameless.staff@test.local"}');

-- The queue has room for everybody.
select public.save_property_cleaner(900002901, 'e1000002-0000-4000-8000-0000000000a2',
                                    'claim', 3);
select pg_temp.check('a shared listing takes as many claim cleaners as it needs',
  (select count(*) from public.property_cleaners where property_id = 900002901), 2::bigint);

select pg_temp.check('a position below the first is refused',
  pg_temp.refusal($$select public.save_property_cleaner(
    900002901, 'e1000002-0000-4000-8000-0000000000a2', 'claim', 0)$$),
  'serverErrors.cleanerPriorityInvalid');
select pg_temp.check('and so is one past the end of a short list',
  pg_temp.refusal($$select public.save_property_cleaner(
    900002901, 'e1000002-0000-4000-8000-0000000000a2', 'claim', 100)$$),
  'serverErrors.cleanerPriorityInvalid');

select pg_temp.check('a listing that is not this company is refused',
  pg_temp.refusal($$select public.save_property_cleaner(
    900009999, 'e1000001-0000-4000-8000-0000000000a1', 'claim', 1)$$),
  'serverErrors.propertyNotFound');
select pg_temp.check('a person who is not this company is refused',
  pg_temp.refusal($$select public.save_property_cleaner(
    900002901, 'e1000009-0000-4000-8000-0000000000a9', 'claim', 1)$$),
  'serverErrors.staffNotFound');

-- Row security would stop the write anyway; the function says why.
select pg_temp.as_maria();
select pg_temp.check('a cleaner cannot hand listings out',
  pg_temp.refusal($$select public.save_property_cleaner(
    900002902, 'e1000001-0000-4000-8000-0000000000a1', 'claim', 1)$$),
  'serverErrors.managerOnly');

-- Taking a link away needs no explanation, so it stays a plain delete under
-- row security: the manager may, the cleaner may not.
delete from public.property_cleaners where property_id = 900002901;
reset role; reset request.jwt.claims;
select pg_temp.check('a cleaner cannot unlink anybody',
  (select count(*) from public.property_cleaners where property_id = 900002901), 2::bigint);

select pg_temp.as_boss();
delete from public.property_cleaners
where property_id = 900002901 and cleaner_id = 'e1000002-0000-4000-8000-0000000000a2';
reset role; reset request.jwt.claims;
select pg_temp.check('a manager unlinks with a plain delete',
  (select count(*) from public.property_cleaners where property_id = 900002901), 1::bigint);

rollback;
