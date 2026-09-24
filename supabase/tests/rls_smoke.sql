-- RLS smoke test. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- Fixture ids live in the 9000000xx range, rooms at 10000000900xx: the real
-- Hostaway ids (98352, 571441 and others) have been in the database since F2,
-- and the old fixtures collided with them on the primary key. For the same
-- reason every count is limited to these ranges — the tables are not empty.
begin;

-- ---------- fixtures ----------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cleaner1@test.local','x',now(),now(),
   '{"full_name":"Cleaner One"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cleaner2@test.local','x',now(),now(),
   '{"full_name":"Cleaner Two"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','manager@test.local','x',now(),now(),
   '{"full_name":"Manager"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bogus@test.local','x',now(),now(),
   '{"full_name":"Bogus Role"}'::jsonb, '{"role":"superuser"}'::jsonb),
  -- The key case: a role slipped in through user_metadata, which the client
  -- fills in itself at signup. It has to be ignored.
  ('55555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','attacker@test.local','x',now(),now(),
   '{"full_name":"Impostor","role":"admin"}'::jsonb, '{}'::jsonb);

insert into public.properties (id, name, timezone) values
  (900000001,'Test property','Europe/Prague'),
  (900000002,'Unit A','Europe/Prague'),
  (900000003,'Unit B','Europe/Prague'),
  (900000004,'Combined','Europe/Prague');

insert into public.reservations (id, property_id, arrival_date, departure_date, status, guest_name)
values (900000101, 900000001, '2026-09-01','2026-09-05','new','Guest Guestson');

insert into public.tasks (property_id, reservation_id, type, status, assignee_id, scheduled_date)
values (900000001, 900000101, 'cleaning','assigned','11111111-1111-1111-1111-111111111111','2026-09-05');

insert into public.tasks (property_id, type, status, assignee_id, scheduled_date)
values (900000001, 'cleaning','assigned','22222222-2222-2222-2222-222222222222','2026-09-05');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

-- ---------- signup and roles ----------
select pg_temp.check('profiles are created by the trigger',
  (select count(*)::int from public.profiles where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333','44444444-4444-4444-4444-444444444444','55555555-5555-5555-5555-555555555555')), 5);
select pg_temp.check('the role from app_metadata is applied',
  (select role::text from public.profiles where id='33333333-3333-3333-3333-333333333333'),
  'manager');
select pg_temp.check('an unknown role becomes cleaner',
  (select role::text from public.profiles where id='44444444-4444-4444-4444-444444444444'),
  'cleaner');
select pg_temp.check('a role from user_metadata is IGNORED (escalation at signup)',
  (select role::text from public.profiles where id='55555555-5555-5555-5555-555555555555'),
  'cleaner');

-- ---------- service_role privileges (the Edge Functions run on it) ----------
select pg_temp.check('service_role has DML on every operational table',
  (select count(distinct table_name)::int from information_schema.role_table_grants
   where grantee='service_role' and table_schema='public'
     and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
     and table_name in ('profiles','properties','property_cleaners','reservations','tasks')), 5);

-- ---------- cleaner ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select pg_temp.check('a cleaner sees only her own task',
  (select count(*)::int from public.tasks where property_id between 900000001 and 900000999), 1);
select pg_temp.check('a cleaner does NOT see reservations (guest PII)',
  (select count(*)::int from public.reservations where id between 900000001 and 900000999), 0);
-- Window 3: no longer every property of the company, only the one her task
-- stands on (docs/window3-plan.md, «Б»; the cases are below).
select pg_temp.check('a cleaner sees only the property her task stands on',
  (select count(*)::int from public.properties where id between 900000001 and 900000999), 1);

update public.profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
select pg_temp.check('a cleaner can NOT raise her own role',
  (select role::text from public.profiles where id='11111111-1111-1111-1111-111111111111'),
  'cleaner');

update public.profiles set full_name='New Name' where id='11111111-1111-1111-1111-111111111111';
select pg_temp.check('a cleaner CAN change her own name',
  (select full_name from public.profiles where id='11111111-1111-1111-1111-111111111111'),
  'New Name');

-- Handing HER OWN task to somebody else. The row passes USING, so it is WITH
-- CHECK that refuses — the old version of this test hit someone else's row
-- and passed idle even without WITH CHECK.
do $$
begin
  update public.tasks set assignee_id='22222222-2222-2222-2222-222222222222'
    where assignee_id='11111111-1111-1111-1111-111111111111';
  raise exception 'FAIL a cleaner managed to hand her task to someone else';
exception when insufficient_privilege then
  raise notice 'ok  a cleaner can NOT hand her task to someone else (WITH CHECK)';
end $$;

-- Tampering with how the task was set: moving the day would take the task
-- out of the day's queue.
update public.tasks set scheduled_date='2026-12-31', priority=99
  where assignee_id='11111111-1111-1111-1111-111111111111';
reset role; reset request.jwt.claims;
select pg_temp.check('a cleaner can NOT move the day of a task',
  (select scheduled_date::text from public.tasks
   where assignee_id='11111111-1111-1111-1111-111111111111'), '2026-09-05');
select pg_temp.check('a cleaner can NOT raise the priority',
  (select priority::int from public.tasks
   where assignee_id='11111111-1111-1111-1111-111111111111'), 0);

-- ---------- manager ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select pg_temp.check('a manager sees every task',
  (select count(*)::int from public.tasks where property_id between 900000001 and 900000999), 2);
select pg_temp.check('a manager sees reservations',
  (select count(*)::int from public.reservations where id between 900000001 and 900000999), 1);
reset role; reset request.jwt.claims;
-- ---------- data integrity ----------
do $$
begin
  insert into public.tasks (property_id, reservation_id, type, status, assignee_id, scheduled_date)
  values (900000001, 900000101, 'cleaning','assigned','22222222-2222-2222-2222-222222222222','2026-09-05');
  raise exception 'FAIL a second cleaning for one reservation went through';
exception when unique_violation then
  raise notice 'ok  a second cleaning for one reservation is refused';
end $$;

-- The property hierarchy: units hang under a parent, exactly two levels.
update public.properties set parent_id = 900000004 where id in (900000002, 900000003);

do $$
begin
  update public.properties set parent_id = 900000002 where id = 900000004;
  raise exception 'FAIL a cycle in the property hierarchy went through';
exception when check_violation then
  raise notice 'ok  a cycle in the property hierarchy is refused';
end $$;

-- A third level: 900000002 is a unit itself, so it cannot be a parent.
do $$
begin
  update public.properties set parent_id = 900000002 where id = 900000001;
  raise exception 'FAIL a third hierarchy level went through';
exception when check_violation then
  raise notice 'ok  a third hierarchy level is refused';
end $$;

do $$
begin
  update public.properties set parent_id = 900000004 where id = 900000004;
  raise exception 'FAIL a property became a unit of itself';
exception when check_violation then
  raise notice 'ok  a property cannot be a unit of itself';
end $$;

-- A zero-length stay: Hostaway sends that for some blocks.
insert into public.reservations (id, property_id, arrival_date, departure_date, status)
values (900000102, 900000001, '2026-09-10','2026-09-10','new');
select pg_temp.check('a zero-length reservation is accepted',
  (select count(*)::int from public.reservations where id=900000102), 1);

-- Deleting a member of staff who has a finished task.
update public.tasks set status='done', completed_at=now()
  where assignee_id='22222222-2222-2222-2222-222222222222';
do $$
begin
  delete from auth.users where id='22222222-2222-2222-2222-222222222222';
  raise notice 'ok  a member of staff with a finished task can be deleted';
exception when check_violation then
  raise exception 'FAIL deleting a member of staff is blocked by a CHECK constraint';
end $$;

-- ---------- deactivation closes access ----------
update public.profiles set is_active=false where id='11111111-1111-1111-1111-111111111111';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select pg_temp.check('a deactivated user does NOT see her tasks',
  (select count(*)::int from public.tasks where property_id between 900000001 and 900000999), 0);
select pg_temp.check('a deactivated user does NOT see properties',
  (select count(*)::int from public.properties where id between 900000001 and 900000999), 0);

-- She can still sign in: deactivation does not ban the login. For her
-- is_manager() used to be NULL, not false, and the privilege guard's
-- `if not is_manager()` skipped on NULL — one PATCH of her own profile made
-- her an active manager again (preflight of window 3, 2026-09-25).
update public.profiles set is_active = true, role = 'manager'
  where id = '11111111-1111-1111-1111-111111111111';
reset role; reset request.jwt.claims;
select pg_temp.check('a deactivated user can NOT switch herself back on',
  (select is_active from public.profiles where id = '11111111-1111-1111-1111-111111111111'), false);
select pg_temp.check('nor make herself a manager',
  (select role::text from public.profiles where id = '11111111-1111-1111-1111-111111111111'),
  'cleaner');
update public.profiles set is_active=false where id='33333333-3333-3333-3333-333333333333';
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select pg_temp.check('a deactivated manager loses her rights',
  (select count(*)::int from public.reservations where id between 900000001 and 900000999), 0);
reset role; reset request.jwt.claims;
-- ---------- anon is stopped by privileges, not only by RLS ----------
-- On Supabase hosting anon used to get grants automatically, and the policies
-- were the only barrier left. What is checked is the privilege itself: the
-- refusal has to come before RLS, or a forgotten `to authenticated` would open
-- the table.
set local role anon;
do $$
begin
  perform 1 from public.properties limit 1;
  raise exception 'FAIL anon reached properties';
exception when insufficient_privilege then
  raise notice 'ok  anon has NO privileges on properties';
end $$;

do $$
begin
  perform 1 from public.tasks limit 1;
  raise exception 'FAIL anon reached tasks';
exception when insufficient_privilege then
  raise notice 'ok  anon has NO privileges on tasks';
end $$;

do $$
begin
  perform 1 from public.profiles limit 1;
  raise exception 'FAIL anon reached profiles';
exception when insufficient_privilege then
  raise notice 'ok  anon has NO privileges on profiles';
end $$;

do $$
begin
  perform 1 from public.property_cleaners limit 1;
  raise exception 'FAIL anon reached property_cleaners';
exception when insufficient_privilege then
  raise notice 'ok  anon has NO privileges on property_cleaners';
end $$;

do $$
begin
  perform public.staff_property_ids();
  raise exception 'FAIL anon called staff_property_ids';
exception when insufficient_privilege then
  raise notice 'ok  anon may NOT call staff_property_ids';
end $$;
reset role; reset request.jwt.claims;

-- ---------- which properties a non-manager reads (window 3) ----------
-- docs/window3-plan.md, «Б». A cleaner or a technician reads a property row
-- only when she is tied to it or to a room right under it — linked to it,
-- assignee of a task on it in any status, author of a problem or a supply
-- request on it — plus the rooms under a listing she is linked to. The listing
-- above any row she reads comes along: the phone embeds parent:parent_id(name)
-- in all three feeds and reads the key-box note through the parent, and a
-- missing parent turns into a bare room number and a blank note at the door.
--
-- Nothing here makes a list empty: task, problem and supply visibility go
-- through definer helpers and do not read properties under the caller. What a
-- wrong rule breaks is the embed, which PostgREST returns as null. So the
-- cases list property rows by name, and the embed cases read them the way the
-- phone does.
insert into public.hosts (id, name) values
  ('e3000000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('e3000001-0000-4000-8000-0000000000e1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','none.w3@test.local','x',now(),now(),
   '{"full_name":"Tied to nothing"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('e3000002-0000-4000-8000-0000000000e2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','link.w3@test.local','x',now(),now(),
   '{"full_name":"Linked to a listing"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('e3000003-0000-4000-8000-0000000000e3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','room.w3@test.local','x',now(),now(),
   '{"full_name":"Linked to a room"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('e3000004-0000-4000-8000-0000000000e4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','assignee.w3@test.local','x',now(),now(),
   '{"full_name":"Assignee only"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('e3000005-0000-4000-8000-0000000000e5','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','reporter.w3@test.local','x',now(),now(),
   '{"full_name":"Problem author"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('e3000006-0000-4000-8000-0000000000e6','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','requester.w3@test.local','x',now(),now(),
   '{"full_name":"Supply author"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('e3000007-0000-4000-8000-0000000000e7','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tech.w3@test.local','x',now(),now(),
   '{"full_name":"Technician"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('e3000008-0000-4000-8000-0000000000e8','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','idle.tech.w3@test.local','x',now(),now(),
   '{"full_name":"Technician without repairs"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('e3000009-0000-4000-8000-0000000000e9','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.w3@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('e300000a-0000-4000-8000-0000000000ea','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','listing.tech.w3@test.local','x',now(),now(),
   '{"full_name":"Repair on a listing"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('e300000b-0000-4000-8000-0000000000eb','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','combined.w3@test.local','x',now(),now(),
   '{"full_name":"Linked to a combined listing"}'::jsonb, '{"role":"cleaner"}'::jsonb);

-- Four listings with two rooms each. The ids of rooms are the derived ones
-- (property_id_for_unit), which the schema checks.
insert into public.properties (id, name, timezone, cleaner_notes) values
  (900000011, 'Linked listing',     'Europe/Prague', null),
  (900000012, 'Room-linked listing','Europe/Prague', null),
  (900000013, 'Assigned listing',   'Europe/Prague', 'key in box 4325'),
  (900000014, 'Reported listing',   'Europe/Prague', null),
  (900000015, 'Combined listing',   'Europe/Prague', null);

-- A part of a combined listing: a listing of its own with parent_id set and no
-- unit number. It is not a room, and a link to the combined listing does not
-- open it.
insert into public.properties (id, parent_id, name, timezone) values
  (900000016, 900000015, 'Part of combined', 'Europe/Prague');

insert into public.properties (id, hostaway_unit_id, parent_id, name, timezone) values
  (1000000090011, 90011, 900000011, 'Room 11', 'Europe/Prague'),
  (1000000090012, 90012, 900000011, 'Room 12', 'Europe/Prague'),
  (1000000090021, 90021, 900000012, 'Room 21', 'Europe/Prague'),
  (1000000090022, 90022, 900000012, 'Room 22', 'Europe/Prague'),
  (1000000090031, 90031, 900000013, 'Room 31', 'Europe/Prague'),
  (1000000090032, 90032, 900000013, 'Room 32', 'Europe/Prague'),
  (1000000090041, 90041, 900000014, 'Room 41', 'Europe/Prague'),
  (1000000090042, 90042, 900000014, 'Room 42', 'Europe/Prague');

-- Another company: a listing of its own, and a room of it hanging under our
-- linked listing. The schema accepts the second (the parent key names one
-- column), so the tenant predicate of the policy is what has to stop it.
insert into public.properties (id, host_id, name, timezone) values
  (900000019, 'e3000000-0000-4000-8000-00000000000b', 'Other company listing', 'UTC');
insert into public.properties (id, host_id, hostaway_unit_id, parent_id, name, timezone) values
  (1000000090013, 'e3000000-0000-4000-8000-00000000000b', 90013, 900000011, 'Stray room', 'UTC');

insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900000011, 'e3000002-0000-4000-8000-0000000000e2', 'claim'),
  (1000000090021, 'e3000003-0000-4000-8000-0000000000e3', 'claim'),
  (900000015, 'e300000b-0000-4000-8000-0000000000eb', 'claim');
-- Deliberately wrong, as in tenant_isolation.sql: a link into another company.
insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('e3000000-0000-4000-8000-00000000000b', 900000019,
   'e3000002-0000-4000-8000-0000000000e2', 'claim');

-- A manual task in a room of a listing she is not linked to: the manager
-- handed it to her directly (a stand-in shift).
insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date, title) values
  ('e3000031-0000-4000-8000-000000000031', 1000000090031, 'midstay', 'assigned',
   'e3000004-0000-4000-8000-0000000000e4', current_date, 'Stand-in');

-- Free cleanings for the two claims below, one in each linked place.
insert into public.tasks (id, property_id, type, status, scheduled_date) values
  ('e3000011-0000-4000-8000-000000000011', 1000000090011, 'cleaning', 'unassigned', current_date),
  ('e3000021-0000-4000-8000-000000000021', 1000000090021, 'cleaning', 'unassigned', current_date);

insert into public.problems (id, property_id, reported_by, title) values
  ('e3000041-0000-4000-8000-000000000041', 1000000090041,
   'e3000005-0000-4000-8000-0000000000e5', 'Leak in room 41');

insert into public.supply_requests (id, property_id, requested_by) values
  ('e3000042-0000-4000-8000-000000000042', 1000000090042,
   'e3000006-0000-4000-8000-0000000000e6');

-- The repair of that leak, handed to a technician linked to nothing.
insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date, problem_id) values
  ('e3000043-0000-4000-8000-000000000043', 1000000090041, 'maintenance', 'assigned',
   'e3000007-0000-4000-8000-0000000000e7', current_date,
   'e3000041-0000-4000-8000-000000000041');

-- A repair on the listing itself, not on one of its rooms.
insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date) values
  ('e3000044-0000-4000-8000-000000000044', 900000011, 'maintenance', 'assigned',
   'e300000a-0000-4000-8000-0000000000ea', current_date);

create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;

-- The fixture property rows the caller can read, as a sorted list: a wrong
-- row shows up by name, not as a count that is off by one.
create or replace function pg_temp.visible_places() returns text language sql as $$
  select coalesce(string_agg(name, ', ' order by name), '(none)')
  from public.properties
  where id between 900000011 and 900000019
     or id between 1000000090000 and 1000000090099
$$;

select pg_temp.as_user('e3000001-0000-4000-8000-0000000000e1');
select pg_temp.check('tied to nothing: no property at all',
  pg_temp.visible_places(), '(none)');

select pg_temp.as_user('e3000002-0000-4000-8000-0000000000e2');
select pg_temp.check('linked to a listing: the listing and its rooms, nothing of another company',
  pg_temp.visible_places(), 'Linked listing, Room 11, Room 12');

select pg_temp.as_user('e3000003-0000-4000-8000-0000000000e3');
select pg_temp.check('linked to a room: the room and the listing above it, not the next room',
  pg_temp.visible_places(), 'Room 21, Room-linked listing');
select pg_temp.check('and the problem form offers the room with its house',
  (select parent_name from public.report_properties where id = 1000000090021),
  'Room-linked listing');

select pg_temp.as_user('e3000004-0000-4000-8000-0000000000e4');
select pg_temp.check('assignee of a manual task: its room and the listing above, not the next room',
  pg_temp.visible_places(), 'Assigned listing, Room 31');

-- The phone's task select, as PostgREST runs it: the property, the listing
-- above, and the note read through the parent — with no link and no problem
-- to lean on, only the task.
select pg_temp.check('the task embed names the room',
  (select p.name from public.tasks t
   left join public.properties p on p.id = t.property_id
   where t.id = 'e3000031-0000-4000-8000-000000000031'), 'Room 31');
select pg_temp.check('and the house above it',
  (select parent.name from public.tasks t
   left join public.properties p on p.id = t.property_id
   left join public.properties parent on parent.id = p.parent_id
   where t.id = 'e3000031-0000-4000-8000-000000000031'), 'Assigned listing');
select pg_temp.check('and the key-box note of the house reaches the door',
  (select public.effective_cleaner_notes(p) from public.tasks t
   join public.properties p on p.id = t.property_id
   where t.id = 'e3000031-0000-4000-8000-000000000031'), 'key in box 4325');

-- History: the reason a narrower rule was turned down on 11.09. A task that
-- is over keeps its place's name for the one who did it.
reset role; reset request.jwt.claims;
update public.tasks set status = 'in_progress', started_at = now() - interval '2 hours'
  where id = 'e3000031-0000-4000-8000-000000000031';
update public.tasks set status = 'done', completed_at = now()
  where id = 'e3000031-0000-4000-8000-000000000031';
select pg_temp.as_user('e3000004-0000-4000-8000-0000000000e4');
select pg_temp.check('a finished task keeps its place',
  pg_temp.visible_places(), 'Assigned listing, Room 31');

reset role; reset request.jwt.claims;
update public.tasks set status = 'cancelled', completed_at = null, started_at = null
  where id = 'e3000031-0000-4000-8000-000000000031';
select pg_temp.as_user('e3000004-0000-4000-8000-0000000000e4');
select pg_temp.check('so does a cancelled one',
  pg_temp.visible_places(), 'Assigned listing, Room 31');

reset role; reset request.jwt.claims;
update public.tasks set status = 'expired'
  where id = 'e3000031-0000-4000-8000-000000000031';
select pg_temp.as_user('e3000004-0000-4000-8000-0000000000e4');
select pg_temp.check('and an expired one',
  pg_temp.visible_places(), 'Assigned listing, Room 31');

select pg_temp.as_user('e3000005-0000-4000-8000-0000000000e5');
select pg_temp.check('problem author: the room of the report and its house',
  pg_temp.visible_places(), 'Reported listing, Room 41');

reset role; reset request.jwt.claims;
update public.problems set archived_at = now()
  where id = 'e3000041-0000-4000-8000-000000000041';
select pg_temp.as_user('e3000005-0000-4000-8000-0000000000e5');
select pg_temp.check('and still after the report is archived',
  pg_temp.visible_places(), 'Reported listing, Room 41');

select pg_temp.as_user('e3000006-0000-4000-8000-0000000000e6');
select pg_temp.check('supply author: the room of the request and its house',
  pg_temp.visible_places(), 'Reported listing, Room 42');

select pg_temp.as_user('e3000007-0000-4000-8000-0000000000e7');
select pg_temp.check('technician: the room of his repair and its house',
  pg_temp.visible_places(), 'Reported listing, Room 41');

reset role; reset request.jwt.claims;
update public.tasks set status = 'in_progress', started_at = now() - interval '1 hour'
  where id = 'e3000043-0000-4000-8000-000000000043';
update public.tasks set status = 'done', completed_at = now()
  where id = 'e3000043-0000-4000-8000-000000000043';
select pg_temp.as_user('e3000007-0000-4000-8000-0000000000e7');
select pg_temp.check('and after the repair is done',
  pg_temp.visible_places(), 'Reported listing, Room 41');

select pg_temp.as_user('e3000008-0000-4000-8000-0000000000e8');
select pg_temp.check('a technician without repairs sees nothing',
  pg_temp.visible_places(), '(none)');

-- Only a LINK to a listing opens the rooms under it. A task on the listing
-- itself shows the listing and nothing under it.
select pg_temp.as_user('e300000a-0000-4000-8000-0000000000ea');
select pg_temp.check('a repair on a listing shows the listing, not its rooms',
  pg_temp.visible_places(), 'Linked listing');

-- And only real rooms: the part of a combined listing has a calendar of its
-- own and is not opened by a link to the combined one.
select pg_temp.as_user('e300000b-0000-4000-8000-0000000000eb');
select pg_temp.check('a link to a combined listing does not open its parts',
  pg_temp.visible_places(), 'Combined listing');

-- Her own company is not hers to change: current_host_id() follows the
-- profile, and every company-scoped policy with it.
select pg_temp.as_user('e3000001-0000-4000-8000-0000000000e1');
update public.profiles set host_id = 'e3000000-0000-4000-8000-00000000000b'
  where id = 'e3000001-0000-4000-8000-0000000000e1';
select pg_temp.as_user('e3000009-0000-4000-8000-0000000000e9');
update public.profiles set host_id = 'e3000000-0000-4000-8000-00000000000b'
  where id = 'e3000009-0000-4000-8000-0000000000e9';
reset role; reset request.jwt.claims;
select pg_temp.check('a member of staff can NOT move herself to another company',
  (select count(*)::int from public.profiles
   where id in ('e3000001-0000-4000-8000-0000000000e1', 'e3000009-0000-4000-8000-0000000000e9')
     and host_id = 'e3000000-0000-4000-8000-00000000000b'), 0);

-- «Взять» is ONE statement: PostgREST updates and embeds in the same query,
-- and the rule sees the tasks table as it was before the update, so the new
-- assignee cannot be what opens the row. It is the link that has to. A test
-- in two statements would pass through the assignee arm and hide a broken
-- link arm.
select pg_temp.as_user('e3000002-0000-4000-8000-0000000000e2');
with claimed as (
  update public.tasks
  set assignee_id = 'e3000002-0000-4000-8000-0000000000e2', status = 'assigned'
  where id = 'e3000011-0000-4000-8000-000000000011'
  returning property_id)
select pg_temp.check('a claim returns the room and its house in the same statement (linked listing)',
  (select p.name || ' / ' || parent.name
   from claimed
   left join lateral (select pp.name, pp.parent_id from public.properties pp
                      where pp.id = claimed.property_id) p on true
   left join lateral (select pa.name from public.properties pa
                      where pa.id = p.parent_id) parent on true),
  'Room 11 / Linked listing');

select pg_temp.as_user('e3000003-0000-4000-8000-0000000000e3');
with claimed as (
  update public.tasks
  set assignee_id = 'e3000003-0000-4000-8000-0000000000e3', status = 'assigned'
  where id = 'e3000021-0000-4000-8000-000000000021'
  returning property_id)
select pg_temp.check('a claim returns the room and its house in the same statement (linked room)',
  (select p.name || ' / ' || parent.name
   from claimed
   left join lateral (select pp.name, pp.parent_id from public.properties pp
                      where pp.id = claimed.property_id) p on true
   left join lateral (select pa.name from public.properties pa
                      where pa.id = p.parent_id) parent on true),
  'Room 21 / Room-linked listing');

-- A manager reads everything, and never pays for the rule: her policy sorts
-- first (policies are OR-ed in descending name order) and the set is an
-- InitPlan, evaluated only when reached. Counted, not read off a plan.
reset role; reset request.jwt.claims;
set local track_functions = 'all';
create temp table w3_calls on commit drop as
  select coalesce(sum(calls), 0)::int as n from pg_stat_xact_user_functions
  where schemaname = 'public' and funcname = 'staff_property_ids';

select pg_temp.as_user('e3000009-0000-4000-8000-0000000000e9');
select pg_temp.check('a manager sees every property of her company',
  pg_temp.visible_places(),
  'Assigned listing, Combined listing, Linked listing, Part of combined, Reported listing, '
  || 'Room 11, Room 12, Room 21, Room 22, Room 31, Room 32, Room 41, Room 42, '
  || 'Room-linked listing');

reset role; reset request.jwt.claims;
select pg_temp.check('and the rule was not evaluated for her',
  (select coalesce(sum(calls), 0)::int from pg_stat_xact_user_functions
   where schemaname = 'public' and funcname = 'staff_property_ids')
  - (select n from w3_calls), 0);

-- Deactivation takes everything away, links included.
update public.profiles set is_active = false where id = 'e3000002-0000-4000-8000-0000000000e2';
select pg_temp.as_user('e3000002-0000-4000-8000-0000000000e2');
select pg_temp.check('a deactivated cleaner sees none of her linked places',
  pg_temp.visible_places(), '(none)');
-- Called directly, as PostgREST would let her, the rule gives her nothing
-- either — not even the bare ids of the places she was tied to.
select pg_temp.check('and the rule itself answers her with nothing',
  (select count(*)::int from public.staff_property_ids()), 0);
do $$
begin
  perform public.property_open_cleanings(900000011);
  raise exception 'FAIL a deactivated user asked how many cleanings are open';
exception when insufficient_privilege then
  raise notice 'ok  a deactivated user is refused the manager''s count';
end $$;
reset role; reset request.jwt.claims;

-- ---------- webhook payload shapes ----------
-- Production traffic uses a different shape from the documented example:
-- the id lives at data.id, not at a flat objectId. Reading only objectId made
-- every real reservation event look uninteresting, so it was skipped and the
-- reservation was silently lost. Both shapes must keep working.
--
-- Each case runs in its own statement inside a DO block: a SELECT that calls
-- the inserting function in its own WHERE clause reads a snapshot taken
-- before the insert and would always see NULL.
create or replace function pg_temp.check_event_id(label text, payload jsonb, want bigint)
returns void language plpgsql as $$
declare
  v_event_id bigint;
  v_object_id bigint;
begin
  v_event_id := public.record_webhook_event(payload);
  select object_id into v_object_id from raw.webhook_events where id = v_event_id;

  if v_object_id is distinct from want then
    raise exception 'FAIL % — got %, expected %', label, v_object_id, want;
  end if;
  raise notice 'ok  %', label;
end $$;

select pg_temp.check_event_id(
  'documented shape: objectId is read',
  '{"object":"reservation","objectId":900000201,"event":"reservation.created"}'::jsonb,
  900000201);

select pg_temp.check_event_id(
  'live shape: data.id is read',
  '{"object":"reservation","event":"reservation.updated","accountId":37874,
    "data":{"id":900000202,"guestName":"Test"}}'::jsonb,
  900000202);

select pg_temp.check_event_id(
  'objectId wins when both are present',
  '{"object":"reservation","objectId":900000203,"data":{"id":900000204}}'::jsonb,
  900000203);

-- A malformed id must not reject the delivery: Hostaway does not retry after
-- a 4xx, so the notification has to be stored even if we cannot key it.
select pg_temp.check_event_id(
  'non-numeric id is stored as null, not rejected',
  '{"object":"reservation","data":{"id":"not-a-number"}}'::jsonb,
  null);

rollback;
