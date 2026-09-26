-- What the phone may offer as the place a problem happened.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: the picker must offer exactly what the writer will
-- accept. `report_problem` refuses a listing the reporter has nothing to do
-- with, so a view that offered more would produce a choice that fails on
-- submit; a view that offered less would hide a room she is responsible for.
-- The view therefore carries the same predicate as the refusal, and this suite
-- is what keeps the two together.
--
-- The case worth naming is the part of a combined listing: it has a parent_id
-- like a room does, but it is a listing in its own right, with its own
-- calendar and its own staff. Inheritance is by `hostaway_unit_id`, never by
-- the parent link alone.
--
-- Fixture ids live in the 9000023xx range, rooms at 10000000662xx.
begin;

-- The pg_temp helpers below are created by postgres, whose new functions no
-- longer go to PUBLIC (20260926100000), and they are called as authenticated
-- too. Hand them to that role for the length of this transaction.
alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('ba000000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('ea000001-0000-4000-8000-0000000000e1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.report@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('ea000004-0000-4000-8000-0000000000e4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.report@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('ea000009-0000-4000-8000-0000000000e9','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bara.report@test.local','x',now(),now(),
   '{"full_name":"Bara"}'::jsonb, '{"role":"cleaner"}'::jsonb);

update public.profiles set host_id = 'ba000000-0000-4000-8000-00000000000b'
where id = 'ea000009-0000-4000-8000-0000000000e9';

-- 01 is the multi-unit listing Maria cleans. 02 is a flat she does not.
-- 03 and 04 are the two halves of a combined listing: 04 carries parent_id
-- and is still a listing of its own. 05 is closed down. 06 belongs to Host B.
insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900002301, 'Report rooms',    'Europe/Prague', '15:00', '10:00'),
  (900002302, 'Not her listing', 'Europe/Prague', '15:00', '10:00'),
  (900002303, 'Combined whole',  'Europe/Prague', '15:00', '10:00');

insert into public.properties (id, parent_id, name, timezone, check_in_time, check_out_time)
values (900002304, 900002303, 'Combined half', 'Europe/Prague', '15:00', '10:00');

insert into public.properties (id, name, status, timezone, check_in_time, check_out_time)
values (900002305, 'Closed down', 'archived', 'Europe/Prague', '15:00', '10:00');

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time)
values (900002306, 'ba000000-0000-4000-8000-00000000000b', 'Vinohrady',
        'Europe/Prague', '15:00', '10:00');

insert into public.properties (id, hostaway_unit_id, parent_id, name,
                               timezone, check_in_time, check_out_time)
values
  (public.property_id_for_unit(66201), 66201, 900002301, 'Unit 1',
   'Europe/Prague', '15:00', '10:00'),
  (public.property_id_for_unit(66202), 66202, 900002301, 'Unit 2',
   'Europe/Prague', '15:00', '10:00'),
  (public.property_id_for_unit(66203), 66203, 900002302, 'Not her room',
   'Europe/Prague', '15:00', '10:00');

insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900002301, 'ea000001-0000-4000-8000-0000000000e1', 'auto'),
  (900002303, 'ea000001-0000-4000-8000-0000000000e1', 'auto');

insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('ba000000-0000-4000-8000-00000000000b', 900002306,
   'ea000009-0000-4000-8000-0000000000e9', 'auto');

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

create or replace function pg_temp.as_maria() returns void language sql as $fn$
  select pg_temp.as_user('ea000001-0000-4000-8000-0000000000e1')
$fn$;
create or replace function pg_temp.as_boss() returns void language sql as $fn$
  select pg_temp.as_user('ea000004-0000-4000-8000-0000000000e4')
$fn$;
create or replace function pg_temp.as_bara() returns void language sql as $fn$
  select pg_temp.as_user('ea000009-0000-4000-8000-0000000000e9')
$fn$;
create or replace function pg_temp.as_postgres() returns void language sql as $fn$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true)
$fn$;

-- Is this place offered to whoever is asking?
create or replace function pg_temp.offered(target bigint) returns boolean
language sql stable as $fn$
  select exists (select 1 from public.report_properties where id = target)
$fn$;

-- ---------------------------------------------------------------------------
--  A cleaner is offered her own listings and the rooms inside them
-- ---------------------------------------------------------------------------

select pg_temp.as_maria();

select pg_temp.check('the listing she cleans is offered',
  pg_temp.offered(900002301), true);

select pg_temp.check('and so is a room inside it, which she is never linked to directly',
  pg_temp.offered(public.property_id_for_unit(66201)), true);

select pg_temp.check('and the second room as well',
  pg_temp.offered(public.property_id_for_unit(66202)), true);

select pg_temp.check('a part of a combined listing is not, though it has a parent',
  pg_temp.offered(900002304), false);

select pg_temp.check('a listing she does not clean is not offered',
  pg_temp.offered(900002302), false);

select pg_temp.check('nor a room inside that listing',
  pg_temp.offered(public.property_id_for_unit(66203)), false);

select pg_temp.check('a listing of another company is out of reach',
  pg_temp.offered(900002306), false);

select pg_temp.check('a closed listing is not offered to report about',
  pg_temp.offered(900002305), false);

-- The label the phone shows is composed from the view, so the parent's name
-- has to come with the room. Without it a report reads "Unit 1" and names no
-- house.
select pg_temp.check('a room carries the name of the house it is in',
  (select parent_name from public.report_properties
   where id = public.property_id_for_unit(66201)), 'Report rooms');

select pg_temp.check('a listing carries no parent name',
  (select parent_name from public.report_properties where id = 900002301), null);

-- ---------------------------------------------------------------------------
--  A manager reports about anything in her company, and nothing outside it
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();

select pg_temp.check('a manager is offered a listing nobody cleans',
  pg_temp.offered(900002302), true);

select pg_temp.check('a manager is offered a part of a combined listing',
  pg_temp.offered(900002304), true);

select pg_temp.check('a manager is still held inside her own company',
  pg_temp.offered(900002306), false);

-- ---------------------------------------------------------------------------
--  Another company, and somebody who has left
-- ---------------------------------------------------------------------------

select pg_temp.as_bara();

select pg_temp.check('the other company sees its own listing',
  pg_temp.offered(900002306), true);

select pg_temp.check('and none of ours',
  pg_temp.offered(900002301), false);

select pg_temp.as_postgres();
update public.profiles set is_active = false
where id = 'ea000001-0000-4000-8000-0000000000e1';

select pg_temp.as_maria();
select pg_temp.check('a deactivated cleaner is offered nothing at all',
  (select count(*)::integer from public.report_properties), 0);

rollback;
