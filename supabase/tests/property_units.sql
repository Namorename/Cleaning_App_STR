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

-- The same question asked for the whole company at once. The registry prints
-- this number beside every listing and the confirmation prints the one above;
-- a manager reads them side by side, so they have to be the same rule.
select pg_temp.check('the company-wide tally folds rooms into their listing',
  (select c.cleanings from public.open_cleanings_by_listing() c
    where c.property_id = 900001901), 2);

select pg_temp.check('and leaves an ordinary flat counting only its own',
  (select c.cleanings from public.open_cleanings_by_listing() c
    where c.property_id = 900001902), 1);

-- A room never gets a line of its own: the registry has no row to put it on,
-- and a number with nowhere to go is a number that silently goes missing.
select pg_temp.check('a room has no line of its own in the tally',
  (select count(*)::int from public.open_cleanings_by_listing() c
    where c.property_id = 1000000064266), 0);

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
--  A room does not outlive its listing
-- ---------------------------------------------------------------------------
--
-- parent_id is `on delete set null`, which is right for a combined listing's
-- parts and wrong for a room: an orphaned room keeps its unit number, its
-- status and its bookings, and would show up in the registry as a flat of its
-- own. Before the trigger this DELETE failed outright on
-- properties_unit_has_parent, naming a constraint the statement never mentions.
reset role;

insert into public.properties (id, name, timezone) values (900001904, 'Doomed listing', 'UTC');
insert into public.properties (id, hostaway_unit_id, parent_id, name, timezone) values
  (1000000064290, 64290, 900001904, 'Doomed room A', 'UTC'),
  (1000000064291, 64291, 900001904, 'Doomed room B', 'UTC');

select pg_temp.check('deleting a listing with rooms is not refused',
  pg_temp.refusal_state($stmt$
    delete from public.properties where id = 900001904
  $stmt$), 'no refusal');

select pg_temp.check('and its rooms went with it',
  (select count(*)::int from public.properties where parent_id = 900001904), 0);

select pg_temp.check('no orphan room was left behind',
  (select count(*)::int from public.properties
   where hostaway_unit_id in (64290, 64291)), 0);

select pg_temp.as_boss();

-- ---------------------------------------------------------------------------
--  A part of a combined listing is not a room
-- ---------------------------------------------------------------------------
--
-- parent_id carries two relationships. 900001902 below is an ordinary listing
-- made a part of 900001901 — it has its own Hostaway id, its own calendar and
-- its own guests. Archiving the parent must not touch it, or a manager loses
-- an independent listing's cleanings for something she did elsewhere.
reset role;
update public.properties set parent_id = 900001901 where id = 900001902;

-- One cleaning on a real room of the listing, one on the combined-listing
-- child. The count must see the first and not the second.
insert into public.tasks (id, property_id, type, status, scheduled_date) values
  ('a6000001-0000-4000-8000-000000000010', 1000000064267, 'cleaning', 'unassigned', current_date),
  ('a6000001-0000-4000-8000-000000000011', 900001902, 'cleaning', 'unassigned', current_date);

select pg_temp.as_boss();

select pg_temp.check('the count for a listing sees its rooms',
  public.property_open_cleanings(900001901), 1);

-- ---------- what the listing's card can see ----------
-- A report filed from a cleaning stands on the ROOM, and a repair can be
-- booked on one, so a card that asks only about its own id shows a house none
-- of its own breakages. The same fold as the count above, and the same line:
-- the combined-listing part keeps its rows to itself, because it has a card.
reset role; reset request.jwt.claims;
insert into public.problems (id, property_id, reported_by, title) values
  ('b6000001-0000-4000-8000-000000000001', 900001901,
   'd6000001-0000-4000-8000-0000000000d1', 'On the house itself'),
  ('b6000001-0000-4000-8000-000000000002', 1000000064266,
   'd6000001-0000-4000-8000-0000000000d1', 'In a room'),
  ('b6000001-0000-4000-8000-000000000003', 900001902,
   'd6000001-0000-4000-8000-0000000000d1', 'In the combined part');

insert into public.tasks (id, property_id, type, status, scheduled_date) values
  ('a6000001-0000-4000-8000-000000000020', 1000000064266, 'maintenance', 'unassigned', current_date);

select pg_temp.as_boss();

select pg_temp.check('the card sees the reports of the house and of its rooms',
  (select count(*)::int from public.property_problems(900001901, 60)), 2);

select pg_temp.check('and not the one filed on a combined listing part',
  (select count(*)::int from public.property_problems(900001901, 60) c
    where c.title = 'In the combined part'), 0);

-- Which door. Null on the house's own row, the room's name on the folded one:
-- the card's heading is already the house, so repeating it would say nothing.
select pg_temp.check('a report on the house names no unit',
  (select c.unit_name from public.property_problems(900001901, 60) c
    where c.title = 'On the house itself'), null::text);

select pg_temp.check('a folded report names the room it was filed in',
  (select c.unit_name from public.property_problems(900001901, 60) c
    where c.title = 'In a room'),
  (select p.name from public.properties p where p.id = 1000000064266));

-- Asked about the room directly the answer is null again: the heading is then
-- the room itself. The test is identity, not roomness.
select pg_temp.check('asked about the room itself, no unit is named',
  (select c.unit_name from public.property_problems(1000000064266, 60) c
    where c.title = 'In a room'), null::text);

select pg_temp.check('the maintenance tab sees a repair booked in a room',
  (select count(*)::int from public.property_maintenance_tasks(900001901, 60)), 1);

select pg_temp.check('and names the room it stands in',
  (select c.unit_name from public.property_maintenance_tasks(900001901, 60) c),
  (select p.name from public.properties p where p.id = 1000000064266));

-- The limit is the caller's and has no default here, so an absurd one still
-- returns a row rather than an error.
select pg_temp.check('a limit below one still returns something',
  (select count(*)::int from public.property_problems(900001901, 0)), 1);

select public.set_property_status(900001901, 'archived', true);

select pg_temp.check('the room was archived with its listing',
  pg_temp.status_of(1000000064267), 'archived');
select pg_temp.check('and the room lost its cleaning',
  (select status::text from public.tasks
   where id = 'a6000001-0000-4000-8000-000000000010'), 'cancelled');
select pg_temp.check('but the combined-listing child was not',
  pg_temp.status_of(900001902), 'active');
select pg_temp.check('and it kept its cleaning',
  (select status::text from public.tasks
   where id = 'a6000001-0000-4000-8000-000000000011'), 'unassigned');

select public.set_property_status(900001901, 'active');
reset role;
update public.properties set parent_id = null where id = 900001902;
select pg_temp.as_boss();

-- ---------------------------------------------------------------------------
--  A repeat press must not undo a room put under repair
-- ---------------------------------------------------------------------------

select public.set_property_status(1000000064266, 'maintenance', true);
select pg_temp.check('the room is under repair', pg_temp.status_of(1000000064266), 'maintenance');

-- A second manager, or one stale panel retrying, presses "in service" on a
-- listing that is already in service.
select public.set_property_status(900001901, 'active');

select pg_temp.check('the listing is untouched', pg_temp.status_of(900001901), 'active');
select pg_temp.check('and the burst pipe is still a burst pipe',
  pg_temp.status_of(1000000064266), 'maintenance');

select public.set_property_status(1000000064266, 'active');

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

-- ---------------------------------------------------------------------------
--  A stay-over cleaning goes with its listing too
-- ---------------------------------------------------------------------------
--
-- A midstay is a cleaning while the guests stay, and the phone offers a free
-- one in «Свободные». Archiving the house has to take the unstarted ones with
-- it, in its rooms as well, and the three counts the manager reads before
-- saying yes have to see them (owner's word 2026-09-24). An inspection or a
-- repair is not a cleaning: an inspection after a repair is exactly what a
-- flat under maintenance is for.
reset role; reset request.jwt.claims;
insert into public.properties (id, name, timezone) values
  (900001905, 'Stay-over house', 'Europe/Prague');
insert into public.properties (id, hostaway_unit_id, parent_id, name, timezone) values
  (1000000064280, 64280, 900001905, 'Stay-over room A', 'Europe/Prague'),
  (1000000064281, 64281, 900001905, 'Stay-over room B', 'Europe/Prague');

insert into public.tasks (id, property_id, type, status, scheduled_date, assignee_id) values
  ('a6000005-0000-4000-8000-000000000051', 900001905, 'midstay', 'unassigned',
   current_date, null),
  ('a6000005-0000-4000-8000-000000000052', 1000000064280, 'midstay', 'assigned',
   current_date, 'd6000001-0000-4000-8000-0000000000d1'),
  -- She has said she is taking it: started, never swept.
  ('a6000005-0000-4000-8000-000000000053', 1000000064281, 'midstay', 'accepted',
   current_date, 'd6000001-0000-4000-8000-0000000000d1'),
  ('a6000005-0000-4000-8000-000000000054', 1000000064281, 'inspection', 'unassigned',
   current_date, null),
  ('a6000005-0000-4000-8000-000000000055', 1000000064280, 'maintenance', 'unassigned',
   current_date, null);

select pg_temp.as_boss();

select pg_temp.check('the confirmation counts the stay-over cleanings, rooms included',
  public.property_open_cleanings(900001905), 2);

select pg_temp.check('and the registry beside it says the same',
  (select c.cleanings from public.open_cleanings_by_listing() c
    where c.property_id = 900001905), 2);

select pg_temp.check('archiving asks first',
  pg_temp.refusal_hint($stmt$
    select public.set_property_status(900001905, 'archived')
  $stmt$), 'serverErrors.propertyHasOpenTasks');

select public.set_property_status(900001905, 'archived', true);

select pg_temp.check('the unstarted stay-over on the house is cancelled',
  (select status::text from public.tasks
   where id = 'a6000005-0000-4000-8000-000000000051'), 'cancelled');
select pg_temp.check('and the one handed out in a room',
  (select status::text from public.tasks
   where id = 'a6000005-0000-4000-8000-000000000052'), 'cancelled');
select pg_temp.check('the one she has taken stays hers',
  (select status::text from public.tasks
   where id = 'a6000005-0000-4000-8000-000000000053'), 'accepted');
select pg_temp.check('an inspection is not a cleaning and stays',
  (select status::text from public.tasks
   where id = 'a6000005-0000-4000-8000-000000000054'), 'unassigned');
select pg_temp.check('nor is a repair',
  (select status::text from public.tasks
   where id = 'a6000005-0000-4000-8000-000000000055'), 'unassigned');

-- ---------- the note at the door ----------
-- "The key is in box 4325" is written on the listing, and the cleaning stands
-- on the room. Without inheritance the note never reaches the person holding
-- the phone in the doorway.
reset role; reset request.jwt.claims;
update public.properties set cleaner_notes = 'key in box 4325' where id = 900001901;
update public.properties set cleaner_notes = 'this room has its own lock'
  where id = 1000000064267;
-- A cleared textarea leaves this behind; it must not shadow the listing.
update public.properties set cleaner_notes = '   ' where id = 1000000064266;
update public.properties set cleaner_notes = 'ordinary flat note' where id = 900001902;

select pg_temp.as_boss();

select pg_temp.check('a room with nothing of its own reads the listing note',
  (select public.effective_cleaner_notes(p) from public.properties p
    where p.id = 1000000064266), 'key in box 4325');

select pg_temp.check('a room that has its own note keeps it',
  (select public.effective_cleaner_notes(p) from public.properties p
    where p.id = 1000000064267), 'this room has its own lock');

select pg_temp.check('an ordinary flat reads its own and looks no higher',
  (select public.effective_cleaner_notes(p) from public.properties p
    where p.id = 900001902), 'ordinary flat note');

select pg_temp.check('the listing itself reads the note it carries',
  (select public.effective_cleaner_notes(p) from public.properties p
    where p.id = 900001901), 'key in box 4325');

-- Invoker, so the parent row is read under the caller's own policies. Since
-- window 3 a cleaner reads only the places she is tied to and the listing
-- above them (docs/window3-plan.md, «Б»); Maria has a task in this room, so
-- the house above it is hers to read and the note arrives. If the rule ever
-- loses the listing above, this is the check that goes red rather than the
-- note quietly going blank at the door.
select pg_temp.as_maria();
select pg_temp.check('and the cleaner at the door gets the same note',
  (select public.effective_cleaner_notes(p) from public.properties p
    where p.id = 1000000064266), 'key in box 4325');

-- Clearing the listing's note clears it in the rooms too: an inherited note is
-- read through, never copied, so there is no stale copy to go on showing.
reset role; reset request.jwt.claims;
update public.properties set cleaner_notes = null where id = 900001901;

select pg_temp.as_boss();
select pg_temp.check('a cleared listing note leaves the room with nothing',
  (select public.effective_cleaner_notes(p) from public.properties p
    where p.id = 1000000064266), null::text);

rollback;
