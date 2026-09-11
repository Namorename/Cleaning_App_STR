-- Rooms inside one listing.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: a room is a properties row under its listing, with
-- an id shifted clear of the Hostaway listing id space and derived in exactly
-- one place. The listing sync creates and refreshes rooms without ever
-- touching a status a manager set. Taking a listing out of service takes its
-- rooms and their unstarted cleanings with it, putting it back brings them
-- back, and one room may go under repair on its own — but a room is never
-- left more alive than the listing it is in.
--
-- Fixture ids live in the 900001 9xx range, rooms at 1000000642xx.
begin;

insert into public.hosts (id, name) values
  ('b6000000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d6000003-0000-4000-8000-0000000000d3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.units@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('d6000001-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.units@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d6000009-0000-4000-8000-0000000000d9','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.b.units@test.local','x',now(),now(),
   '{"full_name":"Boss B"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'b6000000-0000-4000-8000-00000000000b'
where id = 'd6000009-0000-4000-8000-0000000000d9';

insert into public.properties (id, name, address, city, country_code, timezone,
                               check_in_time, check_out_time, max_guests) values
  (900001901, 'Nadrazni rooms', 'Nadrazni 893/46', 'Praha 5', 'CZ', 'Europe/Prague',
   '15:00', '10:00', 14),
  (900001902, 'Ordinary flat',  'Brehova 208',     'Praha 1', 'CZ', 'Europe/Prague',
   '15:00', '10:00', 8);

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
  select pg_temp.as_user('d6000003-0000-4000-8000-0000000000d3')
$fn$;
create or replace function pg_temp.as_maria() returns void language sql as $fn$
  select pg_temp.as_user('d6000001-0000-4000-8000-0000000000d1')
$fn$;
create or replace function pg_temp.as_boss_b() returns void language sql as $fn$
  select pg_temp.as_user('d6000009-0000-4000-8000-0000000000d9')
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
  return coalesce(v_hint, '(no hint)');
end $fn$;

create or replace function pg_temp.refusal_state(stmt text) returns text
language plpgsql as $fn$
begin
  execute stmt;
  return 'no refusal';
exception when others then
  return SQLSTATE;
end $fn$;

create or replace function pg_temp.status_of(p bigint) returns text language sql as $fn$
  select status::text from public.properties where id = p
$fn$;

-- ---------------------------------------------------------------------------
--  The shifted id
-- ---------------------------------------------------------------------------

select pg_temp.check('unit id is shifted clear of the listing id space',
  public.property_id_for_unit(64266), 1000000064266::bigint);

-- Hostaway unit ids run 18007..64305 in this account and listing ids
-- 98352..412520. They do not collide today; the shift is what makes that a
-- guarantee rather than an observation.
select pg_temp.check('the shift lands above every Hostaway listing id',
  public.property_id_for_unit(18007) > 412520, true);

-- ---------------------------------------------------------------------------
--  What a room row must look like
-- ---------------------------------------------------------------------------

select pg_temp.check('a room without a parent is refused',
  pg_temp.refusal_state($stmt$
    insert into public.properties (id, hostaway_unit_id, name, timezone)
    values (1000000064299, 64299, 'Orphan room', 'UTC')
  $stmt$), '23514');

select pg_temp.check('a room whose id is not the derived one is refused',
  pg_temp.refusal_state($stmt$
    insert into public.properties (id, hostaway_unit_id, parent_id, name, timezone)
    values (777, 64299, 900001901, 'Wrong id', 'UTC')
  $stmt$), '23514');

-- A combined listing's children are listings in their own right and carry
-- parent_id without being rooms. `parent_id is not null` must never come to
-- mean "is a room".
select pg_temp.check('a child listing with no unit number is still allowed',
  pg_temp.refusal_state($stmt$
    insert into public.properties (id, parent_id, name, timezone)
    values (900001903, 900001901, 'Child listing', 'UTC')
  $stmt$), 'no refusal');

delete from public.properties where id = 900001903;

-- ---------------------------------------------------------------------------
--  The listing sync creates rooms
-- ---------------------------------------------------------------------------

select public.sync_hostaway_listings('[]'::jsonb, '[]'::jsonb, $json$[
  {"hostaway_unit_id": 64266, "parent_id": 900001901, "name": "Unit 6",
   "address": "Nadrazni 893/46", "city": "Praha 5", "country_code": "CZ",
   "timezone": "Europe/Prague", "check_in_time": "15:00", "check_out_time": "10:00",
   "synced_at": "2026-09-12T00:00:00Z"},
  {"hostaway_unit_id": 64267, "parent_id": 900001901, "name": "Unit 8",
   "address": "Nadrazni 893/46", "city": "Praha 5", "country_code": "CZ",
   "timezone": "Europe/Prague", "check_in_time": "15:00", "check_out_time": "10:00",
   "synced_at": "2026-09-12T00:00:00Z"}
]$json$::jsonb);

select pg_temp.check('the sync computed the row id itself',
  (select count(*)::int from public.properties
   where id in (1000000064266, 1000000064267)), 2);

select pg_temp.check('a room hangs under its listing',
  (select parent_id from public.properties where id = 1000000064266), 900001901::bigint);

select pg_temp.check('a room inherits the timezone the deadline is computed in',
  (select timezone from public.properties where id = 1000000064266), 'Europe/Prague');

-- Hostaway reports capacity per listing: fourteen guests across the rooms
-- says nothing true about any one of them.
select pg_temp.check('a room carries no capacity',
  (select max_guests from public.properties where id = 1000000064266), null::smallint);

select pg_temp.check('a room starts in service',
  pg_temp.status_of(1000000064266), 'active');

-- A second run is the nightly one. It must refresh, not duplicate.
select public.sync_hostaway_listings('[]'::jsonb, '[]'::jsonb, $json$[
  {"hostaway_unit_id": 64266, "parent_id": 900001901, "name": "Unit 6 renamed",
   "timezone": "Europe/Prague", "synced_at": "2026-09-13T00:00:00Z"}
]$json$::jsonb);

select pg_temp.check('running the sync again does not duplicate the room',
  (select count(*)::int from public.properties where hostaway_unit_id = 64266), 1);

select pg_temp.check('and it does carry a rename through',
  (select name from public.properties where id = 1000000064266), 'Unit 6 renamed');

-- Hostaway has no such field, and the nightly run must not undo a manager
-- taking one room out of service — the rule is_active has followed since F2.
update public.properties set status = 'maintenance' where id = 1000000064266;

select public.sync_hostaway_listings('[]'::jsonb, '[]'::jsonb, $json$[
  {"hostaway_unit_id": 64266, "parent_id": 900001901, "name": "Unit 6 renamed",
   "timezone": "Europe/Prague", "synced_at": "2026-09-14T00:00:00Z"}
]$json$::jsonb);

select pg_temp.check('the sync never writes a room status',
  pg_temp.status_of(1000000064266), 'maintenance');

update public.properties set status = 'active' where id = 1000000064266;

-- ---------------------------------------------------------------------------
--  Two levels only
-- ---------------------------------------------------------------------------

select pg_temp.check('a room cannot itself hold rooms',
  pg_temp.refusal_hint($stmt$
    insert into public.properties (id, hostaway_unit_id, parent_id, name, timezone)
    values (1000000064298, 64298, 1000000064266, 'Room in a room', 'UTC')
  $stmt$), 'serverErrors.propertyIsUnit');

-- ---------------------------------------------------------------------------
--  Taking a listing out of service takes its rooms
-- ---------------------------------------------------------------------------

insert into public.tasks (id, property_id, type, status, scheduled_date, assignee_id) values
  -- One cleaning in each room, plus one on the ordinary flat that must not move.
  ('a6000001-0000-4000-8000-000000000001', 1000000064266, 'cleaning', 'unassigned', current_date, null),
  ('a6000001-0000-4000-8000-000000000002', 1000000064267, 'cleaning', 'assigned', current_date,
   'd6000001-0000-4000-8000-0000000000d1'),
  ('a6000001-0000-4000-8000-000000000003', 900001902, 'cleaning', 'unassigned', current_date, null),
  -- Somebody is standing in this room: never swept.
  ('a6000001-0000-4000-8000-000000000004', 1000000064266, 'cleaning', 'in_progress', current_date,
   'd6000001-0000-4000-8000-0000000000d1');

select pg_temp.as_boss();

-- The figure the confirmation shows has to include the rooms, or the manager
-- is asked about nothing and three cleanings vanish.
select pg_temp.check('open cleanings on a listing count its rooms',
  public.property_open_cleanings(900001901), 2);

select pg_temp.check('and on a room, only that room',
  public.property_open_cleanings(1000000064266), 1);

select pg_temp.check('archiving a listing full of rooms needs the second yes',
  pg_temp.refusal_hint($stmt$
    select public.set_property_status(900001901, 'archived')
  $stmt$), 'serverErrors.propertyHasOpenTasks');

select pg_temp.check('and nothing moved while it was refused',
  pg_temp.status_of(1000000064266), 'active');

select public.set_property_status(900001901, 'archived', true);

select pg_temp.check('the listing is archived', pg_temp.status_of(900001901), 'archived');
select pg_temp.check('and so is its first room',  pg_temp.status_of(1000000064266), 'archived');
select pg_temp.check('and so is its second room', pg_temp.status_of(1000000064267), 'archived');

select pg_temp.check('the neighbouring listing is untouched',
  pg_temp.status_of(900001902), 'active');

select pg_temp.check('the rooms lost their unstarted cleanings',
  (select count(*)::int from public.tasks
   where property_id in (1000000064266, 1000000064267) and status = 'cancelled'), 2);

-- Work under way belongs to whoever is standing in the flat.
select pg_temp.check('the cleaning under way in a room was not swept',
  (select status::text from public.tasks
   where id = 'a6000001-0000-4000-8000-000000000004'), 'in_progress');

select pg_temp.check('the neighbouring listing kept its cleaning',
  (select status::text from public.tasks
   where id = 'a6000001-0000-4000-8000-000000000003'), 'unassigned');

-- ---------------------------------------------------------------------------
--  And putting it back brings them back
-- ---------------------------------------------------------------------------

-- One press, not eight. A manager who has just said the building is working
-- again should not have to say it once per room.
select pg_temp.check('a room cannot come back on its own while the listing is archived',
  pg_temp.refusal_hint($stmt$
    select public.set_property_status(1000000064266, 'active')
  $stmt$), 'serverErrors.unitParentNotActive');

select public.set_property_status(900001901, 'active');

select pg_temp.check('the listing is back',      pg_temp.status_of(900001901), 'active');
select pg_temp.check('and so is its first room',  pg_temp.status_of(1000000064266), 'active');
select pg_temp.check('and so is its second room', pg_temp.status_of(1000000064267), 'active');

-- ---------------------------------------------------------------------------
--  One room under repair, on its own
-- ---------------------------------------------------------------------------

select public.set_property_status(1000000064266, 'maintenance', true);

select pg_temp.check('the room is under repair',
  pg_temp.status_of(1000000064266), 'maintenance');
select pg_temp.check('its neighbour keeps letting',
  pg_temp.status_of(1000000064267), 'active');
select pg_temp.check('and the listing itself keeps working',
  pg_temp.status_of(900001901), 'active');

select pg_temp.check('a room may come back alone when its listing is active',
  pg_temp.refusal_hint($stmt$
    select public.set_property_status(1000000064266, 'active')
  $stmt$), 'no refusal');

-- ---------------------------------------------------------------------------
--  Who may do it
-- ---------------------------------------------------------------------------

-- The derived-id constraint calls property_id_for_unit(), and the panel's info
-- form writes parent_id on a property — so a manager editing a room re-checks
-- the constraint under the `authenticated` role and needs EXECUTE on it.
select pg_temp.check('a manager may edit a room without tripping the derived-id check',
  pg_temp.refusal_hint($stmt$
    update public.properties set cleaner_notes = 'Key is in the lockbox'
    where id = 1000000064266
  $stmt$), 'no refusal');

select pg_temp.check('and the note is on the room',
  (select cleaner_notes from public.properties where id = 1000000064266),
  'Key is in the lockbox');

select pg_temp.as_maria();

select pg_temp.check('a cleaner may not archive a room',
  pg_temp.refusal_hint($stmt$
    select public.set_property_status(1000000064266, 'archived', true)
  $stmt$), 'serverErrors.managerOnly');

select pg_temp.as_boss_b();

select pg_temp.check('a manager of another company does not see the room at all',
  pg_temp.refusal_hint($stmt$
    select public.set_property_status(1000000064266, 'archived', true)
  $stmt$), 'serverErrors.propertyNotFound');

select pg_temp.as_boss();
select pg_temp.check('and the room is still where it was',
  pg_temp.status_of(1000000064266), 'active');

rollback;
