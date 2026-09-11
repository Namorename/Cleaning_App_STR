-- Which room a booking took.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: a booking on a multi-unit listing belongs to the
-- listing and names its rooms separately, one row per room. The sync REPLACES
-- that set every time it writes the booking — a guest moved to another room
-- must leave no trace of the old one, or the generator keeps producing a
-- cleaning for a room nobody is in. Nobody but the sync writes the table, and
-- only a manager of the booking's own company may read it.
--
-- Fixture ids live in the 900002 0xx range, rooms at 10000000650xx.
begin;

insert into public.hosts (id, name) values
  ('b5000000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d5000003-0000-4000-8000-0000000000d3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.resunits@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('d5000001-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.resunits@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d5000009-0000-4000-8000-0000000000d9','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.b.resunits@test.local','x',now(),now(),
   '{"full_name":"Boss B"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'b5000000-0000-4000-8000-00000000000b'
where id = 'd5000009-0000-4000-8000-0000000000d9';

-- 900002001 holds three rooms; 900002002 is an ordinary listing.
insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900002001, 'Rooms listing',  'UTC', '15:00', '10:00'),
  (900002002, 'Ordinary flat',  'UTC', '15:00', '10:00');

insert into public.properties (id, hostaway_unit_id, parent_id, name, timezone,
                               check_in_time, check_out_time) values
  (1000000065001, 65001, 900002001, 'Room 1', 'UTC', '15:00', '10:00'),
  (1000000065002, 65002, 900002001, 'Room 2', 'UTC', '15:00', '10:00'),
  (1000000065003, 65003, 900002001, 'Room 3', 'UTC', '15:00', '10:00');

-- A listing and a room belonging to the other company, for the tenant checks.
insert into public.properties (id, name, timezone, host_id) values
  (900002009, 'Other company listing', 'UTC', 'b5000000-0000-4000-8000-00000000000b');
insert into public.properties (id, hostaway_unit_id, parent_id, name, timezone, host_id) values
  (1000000065009, 65009, 900002009, 'Other company room', 'UTC',
   'b5000000-0000-4000-8000-00000000000b');

insert into public.reservations (id, property_id, arrival_date, departure_date, status) values
  (900002101, 900002001, current_date - 2, current_date, 'modified'),
  (900002102, 900002001, current_date - 1, current_date, 'new'),
  (900002103, 900002002, current_date - 1, current_date, 'new');
insert into public.reservations (id, property_id, arrival_date, departure_date, status, host_id) values
  (900002109, 900002009, current_date - 1, current_date, 'new',
   'b5000000-0000-4000-8000-00000000000b');

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

create or replace function pg_temp.as_boss() returns void language sql as $fn$
  select pg_temp.as_user('d5000003-0000-4000-8000-0000000000d3')
$fn$;
create or replace function pg_temp.as_maria() returns void language sql as $fn$
  select pg_temp.as_user('d5000001-0000-4000-8000-0000000000d1')
$fn$;
create or replace function pg_temp.as_boss_b() returns void language sql as $fn$
  select pg_temp.as_user('d5000009-0000-4000-8000-0000000000d9')
$fn$;

create or replace function pg_temp.refusal_state(stmt text) returns text
language plpgsql as $fn$
begin
  execute stmt;
  return 'no refusal';
exception when others then
  return SQLSTATE;
end $fn$;

/** The rooms a booking is linked to, in order, as a plain array. */
create or replace function pg_temp.rooms_of(p_reservation bigint) returns bigint[]
language sql as $fn$
  select coalesce(array_agg(property_id order by property_id), '{}')
  from public.reservation_units where reservation_id = p_reservation
$fn$;

/** Call the sync with only the pieces these tests care about. */
create or replace function pg_temp.sync(reservation_rows jsonb, unit_rows jsonb) returns jsonb
language sql as $fn$
  select public.sync_hostaway_reservations('[]'::jsonb, reservation_rows, unit_rows)
$fn$;

-- The booking columns the RPC insists on, restated for each call.
create or replace function pg_temp.booking(p_id bigint, p_property bigint) returns jsonb
language sql as $fn$
  select jsonb_build_object(
    'id', p_id, 'property_id', p_property,
    'arrival_date', (current_date - 1)::text, 'departure_date', current_date::text,
    'status', 'new', 'is_block', false, 'synced_at', now()::text)
$fn$;

-- ---------------------------------------------------------------------------
--  The sync writes the rooms
-- ---------------------------------------------------------------------------

select pg_temp.sync(
  jsonb_build_array(pg_temp.booking(900002101, 900002001)),
  '[{"reservation_id": 900002101, "hostaway_unit_id": 65001}]'::jsonb);

select pg_temp.check('a booking on one room gets one link',
  pg_temp.rooms_of(900002101), array[1000000065001]::bigint[]);

select pg_temp.check('the link carries the company of the booking',
  (select host_id from public.reservation_units where reservation_id = 900002101),
  public.default_host_id());

-- Eight bookings in the live account take more than one room, one of them
-- three. One link would schedule one cleaning where three are needed.
select pg_temp.sync(
  jsonb_build_array(pg_temp.booking(900002102, 900002001)),
  $json$[{"reservation_id": 900002102, "hostaway_unit_id": 65001},
         {"reservation_id": 900002102, "hostaway_unit_id": 65002},
         {"reservation_id": 900002102, "hostaway_unit_id": 65003}]$json$::jsonb);

select pg_temp.check('a booking across three rooms gets three links',
  pg_temp.rooms_of(900002102),
  array[1000000065001, 1000000065002, 1000000065003]::bigint[]);

select pg_temp.check('and the first booking is untouched by it',
  pg_temp.rooms_of(900002101), array[1000000065001]::bigint[]);

-- ---------------------------------------------------------------------------
--  And replaces them, never adds to them
-- ---------------------------------------------------------------------------

-- A guest moved from room 1 to room 2. The old link has to go, or the
-- generator keeps a cleaning on a room nobody is in.
select pg_temp.check('a moved guest leaves no trace of the old room',
  (select (pg_temp.sync(
     jsonb_build_array(pg_temp.booking(900002101, 900002001)),
     '[{"reservation_id": 900002101, "hostaway_unit_id": 65002}]'::jsonb
   ) ->> 'units_freed')::int), 1);

select pg_temp.check('and is now in the new room only',
  pg_temp.rooms_of(900002101), array[1000000065002]::bigint[]);

-- A booking cut from three rooms to two.
select pg_temp.sync(
  jsonb_build_array(pg_temp.booking(900002102, 900002001)),
  $json$[{"reservation_id": 900002102, "hostaway_unit_id": 65001},
         {"reservation_id": 900002102, "hostaway_unit_id": 65003}]$json$::jsonb);

select pg_temp.check('a booking cut to two rooms keeps two',
  pg_temp.rooms_of(900002102),
  array[1000000065001, 1000000065003]::bigint[]);

-- The booking left the multi-unit listing altogether, or the rooms were
-- dropped. Sending none must clear what is there.
select pg_temp.sync(
  jsonb_build_array(pg_temp.booking(900002102, 900002001)), '[]'::jsonb);

select pg_temp.check('a booking that now names no room keeps none',
  pg_temp.rooms_of(900002102), '{}'::bigint[]);

select pg_temp.check('and a booking outside this batch is left alone',
  pg_temp.rooms_of(900002101), array[1000000065002]::bigint[]);

-- An ordinary listing has no rooms and that is the ordinary case.
select pg_temp.sync(
  jsonb_build_array(pg_temp.booking(900002103, 900002002)), '[]'::jsonb);

select pg_temp.check('an ordinary listing gets no links',
  pg_temp.rooms_of(900002103), '{}'::bigint[]);

-- ---------------------------------------------------------------------------
--  A room we do not have yet
-- ---------------------------------------------------------------------------
--
-- A room added in Hostaway before our next listing run. Losing thirteen
-- hundred bookings over one of them would be the wrong trade, so it is
-- reported and passed over.
select pg_temp.check('an unknown room is reported rather than fatal',
  (select (pg_temp.sync(
     jsonb_build_array(pg_temp.booking(900002103, 900002002)),
     '[{"reservation_id": 900002103, "hostaway_unit_id": 79999}]'::jsonb
   ) -> 'skipped_unit_ids')::text), '[79999]');

select pg_temp.check('and the booking still has no link to a room we lack',
  pg_temp.rooms_of(900002103), '{}'::bigint[]);

-- ---------------------------------------------------------------------------
--  Tenants
-- ---------------------------------------------------------------------------

-- The room belongs to the other company. Linking across would let one
-- company's booking schedule work in another company's flat.
select pg_temp.sync(
  jsonb_build_array(pg_temp.booking(900002103, 900002002)),
  '[{"reservation_id": 900002103, "hostaway_unit_id": 65009}]'::jsonb);

select pg_temp.check('a room of another company is never linked',
  pg_temp.rooms_of(900002103), '{}'::bigint[]);

-- ---------------------------------------------------------------------------
--  Who may read and write it
-- ---------------------------------------------------------------------------

-- Give the other company a link of its own, so "sees nothing" is a real
-- filter rather than an empty table.
insert into public.reservation_units (host_id, reservation_id, property_id)
values ('b5000000-0000-4000-8000-00000000000b', 900002109, 1000000065009);

select pg_temp.as_boss();

select pg_temp.check('a manager reads the links of her own company',
  (select count(*)::int from public.reservation_units), 1);

select pg_temp.check('and the one she reads is hers',
  (select reservation_id from public.reservation_units), 900002101::bigint);

-- The rows copy what Hostaway said; a hand-edit would be overwritten in the
-- night, so the table is read-only to everyone but the sync.
select pg_temp.check('a manager cannot write a link by hand',
  pg_temp.refusal_state($stmt$
    insert into public.reservation_units (reservation_id, property_id)
    values (900002103, 1000000065001)
  $stmt$), '42501');

select pg_temp.check('nor delete one',
  pg_temp.refusal_state($stmt$
    delete from public.reservation_units where reservation_id = 900002101
  $stmt$), '42501');

select pg_temp.as_maria();

-- A cleaner never needs it: her task already points at the room.
select pg_temp.check('a cleaner sees no links at all',
  (select count(*)::int from public.reservation_units), 0);

select pg_temp.as_boss_b();

select pg_temp.check('the other company sees only its own link',
  (select count(*)::int from public.reservation_units), 1);

select pg_temp.check('and it is the one that belongs to it',
  (select reservation_id from public.reservation_units), 900002109::bigint);

-- ---------------------------------------------------------------------------
--  What happens when the booking goes
-- ---------------------------------------------------------------------------

reset role;

delete from public.reservations where id = 900002101;

select pg_temp.check('a link does not outlive its booking',
  (select count(*)::int from public.reservation_units where reservation_id = 900002101), 0);

rollback;
