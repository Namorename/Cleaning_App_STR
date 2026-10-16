-- The owner's analytics, step 2: the series by day and by week, and the tasks
-- by urgency (docs/dashboard-metrics.md; owner's decisions of 2026-10-14).
-- Run: npm run test:rls. The fixtures are analytics.sql's.
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: the figures of the analytics page are counted by
-- the server, for the manager of the company alone, on the local day of each
-- listing:
--   - a cleaning is planned on its day and done on the day it was finished,
--     in its listing's zone — two different figures;
--   - a checkout belongs to the day the guest leaves (departure_date, a
--     listing-local date), whenever the booking was made or the guest came;
--     cancelled bookings, owner's blocks and the office's '#' bookings are not
--     checkouts; rooms of a multi-room listing are counted apart;
--   - occupancy splits nights by period (a September night is September's);
--   - the demo listings (ids 900000000000–999999999999) stay out unless asked;
--   - tables come a page at a time with the total beside them.
--
-- Dates are built from the previous month (M = its first day), so every
-- figure is in the past and the suite does not age.
--
-- Fixture ids live in the 9000550xx range and under b55….
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('b5500000-0000-4000-8000-00000000000a', 'Host H'),
  ('b5500000-0000-4000-8000-00000000000b', 'Host O');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b5500001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.stats@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b5500002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.stats@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b5500003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','petra.stats@test.local','x',now(),now(),
   '{"full_name":"Petra"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b5500004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tomas.stats@test.local','x',now(),now(),
   '{"full_name":"Tomas"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('b5500009-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','oleg.stats@test.local','x',now(),now(),
   '{"full_name":"Oleg"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'b5500000-0000-4000-8000-00000000000a'
where id in ('b5500001-0000-4000-8000-000000000001', 'b5500002-0000-4000-8000-000000000002',
             'b5500003-0000-4000-8000-000000000003', 'b5500004-0000-4000-8000-000000000004');
update public.profiles set host_id = 'b5500000-0000-4000-8000-00000000000b'
where id = 'b5500009-0000-4000-8000-000000000009';

-- A flat in Prague, a flat in Almaty (UTC+5), a house of two rooms, a demo
-- listing, and another company's flat.
insert into public.properties (id, host_id, name, timezone) values
  (900055001, 'b5500000-0000-4000-8000-00000000000a', 'Prague flat', 'Europe/Prague'),
  (900055002, 'b5500000-0000-4000-8000-00000000000a', 'Almaty flat', 'Asia/Almaty'),
  (900055010, 'b5500000-0000-4000-8000-00000000000a', 'House', 'Europe/Prague'),
  (900000000777, 'b5500000-0000-4000-8000-00000000000a', 'Demo', 'Europe/Prague'),
  (900055009, 'b5500000-0000-4000-8000-00000000000b', 'Their flat', 'Europe/Prague');
insert into public.properties (id, host_id, name, timezone, parent_id, hostaway_unit_id) values
  (public.property_id_for_unit(550011), 'b5500000-0000-4000-8000-00000000000a', 'House room 1',
   'Europe/Prague', 900055010, 550011),
  (public.property_id_for_unit(550012), 'b5500000-0000-4000-8000-00000000000a', 'House room 2',
   'Europe/Prague', 900055010, 550012);

insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('b5500000-0000-4000-8000-00000000000a', 900055001, 'b5500002-0000-4000-8000-000000000002', 'claim'),
  ('b5500000-0000-4000-8000-00000000000a', 900055010, 'b5500002-0000-4000-8000-000000000002', 'claim'),
  ('b5500000-0000-4000-8000-00000000000a', 900000000777, 'b5500002-0000-4000-8000-000000000002', 'claim'),
  ('b5500000-0000-4000-8000-00000000000a', 900055002, 'b5500003-0000-4000-8000-000000000003', 'claim');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

/** The hint a statement fails with, or 'no error'. */
create or replace function pg_temp.refusal_hint(stmt text) returns text
language plpgsql as $fn$
declare
  v_hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), sqlstate);
end $fn$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $fn$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$fn$;
create or replace function pg_temp.as_boss() returns void language sql as $fn$
  select pg_temp.as_user('b5500001-0000-4000-8000-000000000001') $fn$;
create or replace function pg_temp.as_anna() returns void language sql as $fn$
  select pg_temp.as_user('b5500002-0000-4000-8000-000000000002') $fn$;
create or replace function pg_temp.as_oleg() returns void language sql as $fn$
  select pg_temp.as_user('b5500009-0000-4000-8000-000000000009') $fn$;

create or replace function pg_temp.anna() returns uuid language sql immutable as $fn$
  select 'b5500002-0000-4000-8000-000000000002'::uuid $fn$;
create or replace function pg_temp.petra() returns uuid language sql immutable as $fn$
  select 'b5500003-0000-4000-8000-000000000003'::uuid $fn$;
create or replace function pg_temp.tomas() returns uuid language sql immutable as $fn$
  select 'b5500004-0000-4000-8000-000000000004'::uuid $fn$;

-- M: the first day of the previous month; E: its last day.
create or replace function pg_temp.m() returns date language sql stable as $fn$
  select (date_trunc('month', (now() at time zone 'Europe/Prague')::date) - interval '1 month')::date $fn$;
create or replace function pg_temp.e() returns date language sql stable as $fn$
  select (pg_temp.m() + interval '1 month')::date - 1 $fn$;
-- A local moment of a listing's zone.
create or replace function pg_temp.at(d date, t time, zone text) returns timestamptz
language sql immutable as $fn$ select (d + t) at time zone zone $fn$;

-- The month of M, and the month before it.
create or replace function pg_temp.summary(p_from date, p_to date) returns jsonb language sql as $fn$
  select public.analytics_summary(p_from, p_to) $fn$;
create or replace function pg_temp.cur() returns jsonb language sql as $fn$
  select pg_temp.summary(pg_temp.m(), pg_temp.e()) $fn$;
create or replace function pg_temp.prev() returns jsonb language sql as $fn$
  select pg_temp.summary((pg_temp.m() - interval '1 month')::date, pg_temp.m() - 1) $fn$;

-- ---------------------------------------------------------------------------
--  Bookings
-- ---------------------------------------------------------------------------

insert into public.reservations
  (id, host_id, property_id, arrival_date, departure_date, status, is_block, guest_name, check_out_time)
values
  -- Came in the month before, leaves in M's month: M's checkout.
  (900055101, 'b5500000-0000-4000-8000-00000000000a', 900055001,
   pg_temp.m() - 5, pg_temp.m() + 2, 'new', false, 'Guest', '10:00'),
  -- Leaves on the last day of the month before.
  (900055102, 'b5500000-0000-4000-8000-00000000000a', 900055010,
   pg_temp.m() - 4, pg_temp.m() - 1, 'modified', false, 'Guest', '23:00'),
  -- Almaty, leaves at 01:00 local on M: still the evening before in Prague
  -- and in UTC, yet M's checkout by its own calendar.
  (900055103, 'b5500000-0000-4000-8000-00000000000a', 900055002,
   pg_temp.m() - 2, pg_temp.m(), 'new', false, 'Guest', '01:00'),
  -- Not checkouts: cancelled, the office's own, the owner's block.
  (900055104, 'b5500000-0000-4000-8000-00000000000a', 900055001,
   pg_temp.m() + 2, pg_temp.m() + 3, 'cancelled', false, 'Guest', '10:00'),
  (900055105, 'b5500000-0000-4000-8000-00000000000a', 900055001,
   pg_temp.m() + 3, pg_temp.m() + 4, 'new', false, '  #Office', '10:00'),
  (900055106, 'b5500000-0000-4000-8000-00000000000a', 900055002,
   pg_temp.m() + 3, pg_temp.m() + 5, 'ownerStay', true, null, '10:00'),
  -- Two rooms of the house.
  (900055107, 'b5500000-0000-4000-8000-00000000000a', 900055010,
   pg_temp.m() + 1, pg_temp.m() + 3, 'new', false, 'Guest', '10:00'),
  -- The demo listing.
  (900055108, 'b5500000-0000-4000-8000-00000000000a', 900000000777,
   pg_temp.m() + 1, pg_temp.m() + 2, 'new', false, 'Guest', '10:00'),
  -- Another company.
  (900055109, 'b5500000-0000-4000-8000-00000000000b', 900055009,
   pg_temp.m() + 1, pg_temp.m() + 2, 'new', false, 'Guest', '10:00');
insert into public.reservation_units (host_id, reservation_id, property_id) values
  ('b5500000-0000-4000-8000-00000000000a', 900055107, public.property_id_for_unit(550011)),
  ('b5500000-0000-4000-8000-00000000000a', 900055107, public.property_id_for_unit(550012));

-- ---------------------------------------------------------------------------
--  Cleanings, written as the system with their times
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{}', true);
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id,
                          started_at, completed_at, completed_by)
values
  -- Planned on the last day of the month before, finished at 00:30 on M in Prague.
  ('b5504001-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-00000000000a', 900055001,
   'cleaning', 'done', pg_temp.m() - 1, pg_temp.anna(),
   pg_temp.at(pg_temp.m(), '00:30', 'Europe/Prague') - interval '60 minutes',
   pg_temp.at(pg_temp.m(), '00:30', 'Europe/Prague'), pg_temp.anna()),
  -- Almaty, finished at 01:30 local on M: the day before in UTC.
  ('b5504001-0000-4000-8000-000000000002', 'b5500000-0000-4000-8000-00000000000a', 900055002,
   'cleaning', 'done', pg_temp.m(), pg_temp.petra(),
   pg_temp.at(pg_temp.m(), '01:30', 'Asia/Almaty') - interval '90 minutes',
   pg_temp.at(pg_temp.m(), '01:30', 'Asia/Almaty'), pg_temp.petra()),
  -- A cleaning during the stay.
  ('b5504001-0000-4000-8000-000000000003', 'b5500000-0000-4000-8000-00000000000a', 900055001,
   'midstay', 'done', pg_temp.m() + 1, pg_temp.anna(),
   pg_temp.at(pg_temp.m() + 1, '10:00', 'Europe/Prague') - interval '30 minutes',
   pg_temp.at(pg_temp.m() + 1, '10:00', 'Europe/Prague'), pg_temp.anna()),
  -- Waiting, cancelled, expired.
  ('b5504001-0000-4000-8000-000000000004', 'b5500000-0000-4000-8000-00000000000a', 900055001,
   'cleaning', 'unassigned', pg_temp.m() + 2, null, null, null, null),
  ('b5504001-0000-4000-8000-000000000005', 'b5500000-0000-4000-8000-00000000000a', 900055001,
   'cleaning', 'cancelled', pg_temp.m() + 3, null, null, null, null),
  ('b5504001-0000-4000-8000-000000000006', 'b5500000-0000-4000-8000-00000000000a', 900055001,
   'cleaning', 'expired', pg_temp.m() + 4, pg_temp.anna(), null, null, null),
  -- Done in three minutes: counted, but not a duration to trust.
  ('b5504001-0000-4000-8000-000000000007', 'b5500000-0000-4000-8000-00000000000a', 900055001,
   'cleaning', 'done', pg_temp.m() + 5, pg_temp.anna(),
   pg_temp.at(pg_temp.m() + 5, '12:00', 'Europe/Prague') - interval '3 minutes',
   pg_temp.at(pg_temp.m() + 5, '12:00', 'Europe/Prague'), pg_temp.anna()),
  -- The demo listing.
  ('b5504001-0000-4000-8000-000000000008', 'b5500000-0000-4000-8000-00000000000a', 900000000777,
   'cleaning', 'done', pg_temp.m() + 1, pg_temp.anna(),
   pg_temp.at(pg_temp.m() + 1, '12:00', 'Europe/Prague') - interval '45 minutes',
   pg_temp.at(pg_temp.m() + 1, '12:00', 'Europe/Prague'), pg_temp.anna()),
  -- A room of the house: counted under the house.
  ('b5504001-0000-4000-8000-000000000009', 'b5500000-0000-4000-8000-00000000000a',
   public.property_id_for_unit(550011),
   'cleaning', 'done', pg_temp.m() + 3, pg_temp.anna(),
   pg_temp.at(pg_temp.m() + 3, '12:00', 'Europe/Prague') - interval '120 minutes',
   pg_temp.at(pg_temp.m() + 3, '12:00', 'Europe/Prague'), pg_temp.anna());

-- The first cleaning has a photo.
insert into public.task_steps (id, host_id, task_id, type, sort_order, required)
values ('b5506001-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-00000000000a',
        'b5504001-0000-4000-8000-000000000001', 'photos_after', 1, false);
insert into public.task_media (host_id, task_id, step_id, kind, storage_path, mime_type, byte_size,
                               uploaded_at)
values ('b5500000-0000-4000-8000-00000000000a', 'b5504001-0000-4000-8000-000000000001',
        'b5506001-0000-4000-8000-000000000001', 'photo', 'stats/one.jpg', 'image/jpeg', 100, now());

-- ---------------------------------------------------------------------------
--  Tasks (problems) and their repairs
-- ---------------------------------------------------------------------------

insert into public.problems (id, host_id, reported_by, title, property_id, priority, status,
                             created_at, resolved_at, cancelled_at)
values
  ('b5505001-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-00000000000a', pg_temp.anna(),
   'Leak', 900055001, 'high', 'resolved',
   pg_temp.at(pg_temp.m() + 1, '09:00', 'Europe/Prague'),
   pg_temp.at(pg_temp.m() + 2, '09:00', 'Europe/Prague'), null),
  ('b5505001-0000-4000-8000-000000000002', 'b5500000-0000-4000-8000-00000000000a', pg_temp.anna(),
   'Lamp', 900055001, 'normal', 'open',
   pg_temp.at(pg_temp.m() - 2, '09:00', 'Europe/Prague'), null, null),
  ('b5505001-0000-4000-8000-000000000003', 'b5500000-0000-4000-8000-00000000000a', pg_temp.petra(),
   'Door', 900055002, 'low', 'open',
   pg_temp.at(pg_temp.m() + 3, '09:00', 'Asia/Almaty'), null, null),
  ('b5505001-0000-4000-8000-000000000004', 'b5500000-0000-4000-8000-00000000000a', pg_temp.anna(),
   'Chair', 900055010, 'normal', 'cancelled',
   pg_temp.at(pg_temp.m() + 1, '10:00', 'Europe/Prague'), null,
   pg_temp.at(pg_temp.m() + 1, '11:00', 'Europe/Prague')),
  ('b5505001-0000-4000-8000-000000000005', 'b5500000-0000-4000-8000-00000000000a', pg_temp.anna(),
   'Keys', null, 'normal', 'resolved',
   pg_temp.at(pg_temp.m() - 10, '09:00', 'Europe/Prague'),
   pg_temp.at(pg_temp.m() + 1, '09:00', 'Europe/Prague'), null),
  ('b5505001-0000-4000-8000-000000000006', 'b5500000-0000-4000-8000-00000000000a', pg_temp.anna(),
   'Demo', 900000000777, 'high', 'open',
   pg_temp.at(pg_temp.m() + 1, '09:00', 'Europe/Prague'), null, null);

insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id,
                          started_at, completed_at, completed_by, problem_id)
values
  ('b5504002-0000-4000-8000-000000000001', 'b5500000-0000-4000-8000-00000000000a', 900055001,
   'maintenance', 'done', pg_temp.m() + 2, pg_temp.tomas(),
   pg_temp.at(pg_temp.m() + 2, '08:00', 'Europe/Prague'),
   pg_temp.at(pg_temp.m() + 2, '09:00', 'Europe/Prague'), pg_temp.tomas(),
   'b5505001-0000-4000-8000-000000000001'),
  ('b5504002-0000-4000-8000-000000000005', 'b5500000-0000-4000-8000-00000000000a', 900055001,
   'maintenance', 'done', pg_temp.m() + 1, pg_temp.tomas(),
   pg_temp.at(pg_temp.m() + 1, '08:30', 'Europe/Prague'),
   pg_temp.at(pg_temp.m() + 1, '09:00', 'Europe/Prague'), pg_temp.tomas(),
   'b5505001-0000-4000-8000-000000000005');

-- ---------------------------------------------------------------------------
--  Step 2: the series by day and by week, and urgency apart
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();
select pg_temp.check('a day series has every day of the period, the empty ones too',
  (select count(*)::int from public.analytics_series(pg_temp.m(), pg_temp.m() + 9)), 10);
select pg_temp.check('M: the Almaty checkout, and the two cleanings finished after midnight there',
  (select array[checkouts, cleanings_done, cleanings_planned]
   from public.analytics_series(pg_temp.m(), pg_temp.m() + 9) where bucket = pg_temp.m()),
  array[1, 2, 1]);
select pg_temp.check('the series adds up to the summary: no cancelled task among the created',
  (select array[sum(cleanings_done)::int, sum(checkouts)::int, sum(problems_created)::int,
                sum(problems_resolved)::int]
   from public.analytics_series(pg_temp.m(), pg_temp.e())),
  array[5, 3, 2, 2]);
select pg_temp.check('a week series starts its buckets on Mondays',
  (select bool_and(extract(isodow from bucket) = 1)
   from public.analytics_series(pg_temp.m(), pg_temp.e(), p_bucket => 'week')),
  true);
select pg_temp.check('and adds up the same',
  (select sum(cleanings_done)::int
   from public.analytics_series(pg_temp.m(), pg_temp.e(), p_bucket => 'week')),
  5);
select pg_temp.check('the series takes the filters too',
  (select sum(checkouts)::int
   from public.analytics_series(pg_temp.m(), pg_temp.e(), p_property_ids => array[900055010::bigint])),
  1);
select pg_temp.check('a bucket it does not know is refused',
  pg_temp.refusal_hint($q$select * from public.analytics_series(current_date - 7, current_date, p_bucket => 'year')$q$),
  'serverErrors.analyticsPeriodInvalid');
select pg_temp.check('tasks created in the period by urgency: not the cancelled normal one',
  (pg_temp.cur()->'problems_by_priority'),
  jsonb_build_object('low', 1, 'normal', 0, 'high', 1));
reset role;

select pg_temp.as_anna();
select pg_temp.check('a maid may not ask for a series',
  pg_temp.refusal_hint($q$select * from public.analytics_series(current_date - 7, current_date)$q$),
  'serverErrors.managerOnly');
reset role;

rollback;
