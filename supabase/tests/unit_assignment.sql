-- Who cleans a room inside a listing.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: a cleaner is linked to a listing and never to a
-- room, so a room takes its staff from the listing it is in. Two different
-- inheritances have to hold at once and must not be confused with each other:
--
--   seeing and taking the work is a UNION — the listing's cleaners plus the
--   room's own, if the manager named any. Naming somebody for one room adds a
--   person; it must never quietly remove the listing's cleaner, who is the one
--   covering when a colleague falls ill.
--
--   being handed the work is a PRECEDENCE — the room's own regular cleaner
--   when it has one, otherwise the listing's.
--
-- And a part of a combined listing inherits nothing: `parent_id` also joins two
-- real listings that block each other, and those keep their own staff.
--
-- Inheritance widens who reaches a room. It must widen nothing else: the
-- horizon, the grace period, the tenant and the active flag all still decide
-- what a cleaner is shown, and the second half of this set is about that.
--
-- Fixture ids live in the 9000022xx range, rooms at 10000000660xx.
begin;

insert into public.hosts (id, name) values
  ('b9000000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('e9000001-0000-4000-8000-0000000000e1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.assign@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('e9000002-0000-4000-8000-0000000000e2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.assign@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('e9000003-0000-4000-8000-0000000000e3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','klara.assign@test.local','x',now(),now(),
   '{"full_name":"Klara"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('e9000004-0000-4000-8000-0000000000e4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.assign@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('e9000009-0000-4000-8000-0000000000e9','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bara.assign@test.local','x',now(),now(),
   '{"full_name":"Bara"}'::jsonb, '{"role":"cleaner"}'::jsonb);

update public.profiles set host_id = 'b9000000-0000-4000-8000-00000000000b'
where id = 'e9000009-0000-4000-8000-0000000000e9';

-- 01 is the multi-unit listing everything hangs off. 02 is an ordinary flat
-- with a shared queue. 03 and 04 are the two halves of a combined listing:
-- 04 carries parent_id and is still a listing of its own.
insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900002201, 'Nadrazni rooms',  'Europe/Prague', '15:00', '10:00'),
  (900002202, 'Brehova flat',    'Europe/Prague', '15:00', '10:00'),
  (900002203, 'Combined whole',  'Europe/Prague', '15:00', '10:00');

insert into public.properties (id, parent_id, name, timezone, check_in_time, check_out_time)
values (900002204, 900002203, 'Combined half', 'Europe/Prague', '15:00', '10:00');

-- Rooms, written the way the listing sync writes them: id derived from the
-- Hostaway unit number, parent_id pointing at the listing.
insert into public.properties (id, hostaway_unit_id, parent_id, name,
                               timezone, check_in_time, check_out_time)
values
  (public.property_id_for_unit(66001), 66001, 900002201, 'Unit 1',
   'Europe/Prague', '15:00', '10:00'),
  (public.property_id_for_unit(66002), 66002, 900002201, 'Unit 2',
   'Europe/Prague', '15:00', '10:00'),
  (public.property_id_for_unit(66003), 66003, 900002201, 'Unit 3',
   'Europe/Prague', '15:00', '10:00'),
  (public.property_id_for_unit(66004), 66004, 900002202, 'Brehova back room',
   'Europe/Prague', '15:00', '10:00');

-- Host B's own multi-unit listing, so "another company's room" is a real row
-- rather than a missing one.
insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time)
values (900002205, 'b9000000-0000-4000-8000-00000000000b', 'Vinohrady rooms',
        'Europe/Prague', '15:00', '10:00');

insert into public.properties (id, host_id, hostaway_unit_id, parent_id, name,
                               timezone, check_in_time, check_out_time)
values (public.property_id_for_unit(66009), 'b9000000-0000-4000-8000-00000000000b',
        66009, 900002205, 'Unit 9', 'Europe/Prague', '15:00', '10:00');

-- Maria is the regular cleaner of the multi-unit listing and of the combined
-- whole. Klara shares the queue on the ordinary flat. Anna is linked to
-- nothing yet — she arrives later, on one room.
insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900002201, 'e9000001-0000-4000-8000-0000000000e1', 'auto'),
  (900002203, 'e9000001-0000-4000-8000-0000000000e1', 'auto'),
  (900002202, 'e9000003-0000-4000-8000-0000000000e3', 'claim');

insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('b9000000-0000-4000-8000-00000000000b', 900002205,
   'e9000009-0000-4000-8000-0000000000e9', 'auto');

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
  select pg_temp.as_user('e9000001-0000-4000-8000-0000000000e1')
$fn$;
create or replace function pg_temp.as_anna() returns void language sql as $fn$
  select pg_temp.as_user('e9000002-0000-4000-8000-0000000000e2')
$fn$;
create or replace function pg_temp.as_klara() returns void language sql as $fn$
  select pg_temp.as_user('e9000003-0000-4000-8000-0000000000e3')
$fn$;
create or replace function pg_temp.as_boss() returns void language sql as $fn$
  select pg_temp.as_user('e9000004-0000-4000-8000-0000000000e4')
$fn$;

create or replace function pg_temp.as_postgres() returns void language sql as $fn$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '', true)
$fn$;

-- The i18n key a refusal carries, or 'no refusal' when the statement went
-- through. The key is what the app shows; the message is for the log.
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

create or replace function pg_temp.assignee(res_id bigint)
returns uuid language sql as $fn$
  select t.assignee_id from public.tasks t
  where t.reservation_id = res_id and t.type = 'cleaning' and t.status <> 'cancelled'
$fn$;

create or replace function pg_temp.task_status(res_id bigint)
returns text language sql as $fn$
  select t.status::text from public.tasks t
  where t.reservation_id = res_id and t.type = 'cleaning' and t.status <> 'cancelled'
$fn$;

create or replace function pg_temp.visible(task_id uuid)
returns integer language sql as $fn$
  select count(*)::int from public.tasks t where t.id = task_id
$fn$;

-- ---------------------------------------------------------------------------
--  Reaching a room
-- ---------------------------------------------------------------------------

select pg_temp.as_maria();

select pg_temp.check('the listing cleaner reaches the listing itself',
  public.cleans_property(900002201), true);
select pg_temp.check('the listing cleaner reaches a room inside it',
  public.cleans_property(public.property_id_for_unit(66001)), true);
select pg_temp.check('and reaches every room, not only the first',
  public.cleans_property(public.property_id_for_unit(66003)), true);
select pg_temp.check('a listing she does not work stays out of reach',
  public.cleans_property(900002202), false);
select pg_temp.check('and so do its rooms',
  public.cleans_property(public.property_id_for_unit(66004)), false);

-- `parent_id` carries two relationships, and only one of them is a room. The
-- other half of a combined listing is a listing in its own right, with its own
-- calendar and its own guests: inheriting staff across that link would hand one
-- listing's schedule to another listing's people.
select pg_temp.check('a part of a combined listing inherits nothing',
  public.cleans_property(900002204), false);

select pg_temp.as_klara();
select pg_temp.check('the cleaner of another listing does not reach the room',
  public.cleans_property(public.property_id_for_unit(66001)), false);
select pg_temp.check('but she does reach the room of her own listing',
  public.cleans_property(public.property_id_for_unit(66004)), true);

select pg_temp.as_anna();
select pg_temp.check('a cleaner linked to nothing reaches nothing',
  public.cleans_property(public.property_id_for_unit(66001)), false);

-- A room may be given a cleaner of its own. No panel screen does it and none
-- will — the cleaner picker leaves rooms out permanently, not pending a later
-- screen — but PostgREST accepts the row, and the rule has to hold whichever
-- way it arrives.
select pg_temp.as_postgres();
insert into public.property_cleaners (property_id, cleaner_id, mode)
values (public.property_id_for_unit(66002), 'e9000002-0000-4000-8000-0000000000e2', 'claim');

select pg_temp.as_anna();
select pg_temp.check('a room cleaner reaches her room',
  public.cleans_property(public.property_id_for_unit(66002)), true);
select pg_temp.check('a room cleaner does not thereby reach the whole listing',
  public.cleans_property(900002201), false);
select pg_temp.check('nor the other rooms of it',
  public.cleans_property(public.property_id_for_unit(66001)), false);

-- The union, and the reason for it: the listing's cleaner is who covers when a
-- colleague falls ill, and she cannot cover work she cannot see.
select pg_temp.as_maria();
select pg_temp.check('naming a room cleaner does not take the room from the listing cleaner',
  public.cleans_property(public.property_id_for_unit(66002)), true);

-- ---------------------------------------------------------------------------
--  Seeing and taking a room's work
-- ---------------------------------------------------------------------------
--
-- Tasks are written straight onto the rooms here. The generator does not put
-- them there yet — it still reads reservations.property_id, which is always the
-- listing — and that is the point of this stage landing first: the right to see
-- the work exists before the work does.

select pg_temp.as_postgres();
insert into public.tasks (id, property_id, type, status, scheduled_date, title)
values
  ('79000001-0000-4000-8000-000000000071', public.property_id_for_unit(66001),
   'cleaning', 'unassigned', current_date + 2, 'Room task'),
  ('79000002-0000-4000-8000-000000000072', public.property_id_for_unit(66004),
   'cleaning', 'unassigned', current_date + 2, 'Other listing room task'),
  -- A second free task on the same room, kept free on purpose: the refusal
  -- below has to be about who Klara is, and a task already taken would refuse
  -- her for a reason that has nothing to do with rooms.
  ('79000006-0000-4000-8000-000000000076', public.property_id_for_unit(66001),
   'cleaning', 'unassigned', current_date + 2, 'Still free room task');

select pg_temp.as_maria();
select pg_temp.check('the listing cleaner sees work standing on a room',
  pg_temp.visible('79000001-0000-4000-8000-000000000071'), 1);
select pg_temp.check('and not work standing on a room of a listing she does not work',
  pg_temp.visible('79000002-0000-4000-8000-000000000072'), 0);

update public.tasks
set assignee_id = 'e9000001-0000-4000-8000-0000000000e1', status = 'assigned'
where id = '79000001-0000-4000-8000-000000000071';

select pg_temp.as_postgres();
select pg_temp.check('the listing cleaner takes a free task on a room',
  (select assignee_id from public.tasks
   where id = '79000001-0000-4000-8000-000000000071'),
  'e9000001-0000-4000-8000-0000000000e1'::uuid);

-- Row security answers by filtering, not by refusing: both statements below
-- succeed, one having matched a row and one having matched nothing, so the
-- proof is the rows afterwards.
select pg_temp.as_klara();
update public.tasks
set assignee_id = 'e9000003-0000-4000-8000-0000000000e3', status = 'assigned'
where id = '79000006-0000-4000-8000-000000000076';

-- The control for it: the same statement, on a room of the listing she does
-- work, has to go through. Without this pair the refusal above could come from
-- anywhere — a wrong status, a stale date, a policy nobody meant to trip.
update public.tasks
set assignee_id = 'e9000003-0000-4000-8000-0000000000e3', status = 'assigned'
where id = '79000002-0000-4000-8000-000000000072';

select pg_temp.as_postgres();
select pg_temp.check('a cleaner of another listing cannot take a free room task',
  (select assignee_id from public.tasks
   where id = '79000006-0000-4000-8000-000000000076'), null::uuid);
select pg_temp.check('while the room of her own listing is hers to take',
  (select assignee_id from public.tasks
   where id = '79000002-0000-4000-8000-000000000072'),
  'e9000003-0000-4000-8000-0000000000e3'::uuid);

select pg_temp.as_boss();
select pg_temp.check('the manager sees a room task like any other',
  pg_temp.visible('79000001-0000-4000-8000-000000000071'), 1);

-- ---------------------------------------------------------------------------
--  What inheritance must NOT widen
-- ---------------------------------------------------------------------------
--
-- The task policies are a conjunction: reaching the listing is one term of it,
-- and the others were there before rooms existed. A room must not become a way
-- round them.

select pg_temp.as_postgres();
insert into public.tasks (id, property_id, type, status, scheduled_date, title)
values
  ('79000003-0000-4000-8000-000000000073', public.property_id_for_unit(66001),
   'cleaning', 'unassigned', current_date + 9, 'Beyond the horizon'),
  ('79000004-0000-4000-8000-000000000074', public.property_id_for_unit(66001),
   'cleaning', 'unassigned', current_date - 5, 'Past the grace period');

select pg_temp.as_maria();
select pg_temp.check('a room task past the horizon is not shown to the listing cleaner',
  pg_temp.visible('79000003-0000-4000-8000-000000000073'), 0);

update public.tasks
set assignee_id = 'e9000001-0000-4000-8000-0000000000e1', status = 'assigned'
where id = '79000004-0000-4000-8000-000000000074';

select pg_temp.as_postgres();
select pg_temp.check('a room task past its grace period cannot be taken either',
  (select assignee_id from public.tasks
   where id = '79000004-0000-4000-8000-000000000074'), null::uuid);

-- A room of one company hanging under another company's listing. The schema
-- accepts it — properties_parent_id_fkey names one column and not the tenant —
-- so the barrier is the caller's own `host_id = current_host_id()`, exactly as
-- supabase/tests/tenant_isolation.sql proves for a cross-company link. That
-- barrier has to keep holding now that the parent is a second way in.
insert into public.properties (id, host_id, hostaway_unit_id, parent_id, name,
                               timezone, check_in_time, check_out_time)
values (public.property_id_for_unit(66008), 'b9000000-0000-4000-8000-00000000000b',
        66008, 900002201, 'Stray room', 'Europe/Prague', '15:00', '10:00');

insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, title)
values ('79000005-0000-4000-8000-000000000075',
        'b9000000-0000-4000-8000-00000000000b', public.property_id_for_unit(66008),
        'cleaning', 'unassigned', current_date + 2, 'Stray room task');

select pg_temp.as_maria();
select pg_temp.check('work in another company stays invisible however it is parented',
  pg_temp.visible('79000005-0000-4000-8000-000000000075'), 0);

select pg_temp.as_postgres();
delete from public.tasks where id = '79000005-0000-4000-8000-000000000075';
delete from public.properties where id = public.property_id_for_unit(66008);

-- ---------------------------------------------------------------------------
--  Filing a problem against a room
-- ---------------------------------------------------------------------------
--
-- report_problem resolves the listing through the same question, so the right
-- to report follows the right to clean without a second rule to keep in step.

select pg_temp.as_maria();
select public.report_problem(
  p_id          := '79000011-0000-4000-8000-000000000081',
  p_title       := 'Broken tap',
  p_property_id := public.property_id_for_unit(66001));

select pg_temp.as_postgres();
select pg_temp.check('the listing cleaner may report a problem on a room',
  (select property_id from public.problems
   where id = '79000011-0000-4000-8000-000000000081'),
  public.property_id_for_unit(66001));

select pg_temp.as_klara();
select pg_temp.check('a cleaner of another listing may not report on that room',
  pg_temp.refusal_hint($stmt$
    select public.report_problem(
      p_id          := '79000012-0000-4000-8000-000000000082',
      p_title       := 'Not hers to report',
      p_property_id := public.property_id_for_unit(66001))
  $stmt$), 'serverErrors.propertyNotFound');

-- ---------------------------------------------------------------------------
--  Being handed a room's work
-- ---------------------------------------------------------------------------
--
-- Bookings stand on rooms here, which is NOT the shape production will take:
-- 20260912130000 settled that a booking keeps standing on the listing and names
-- its rooms through public.reservation_units, because eight bookings in the
-- account take more than one room at once. This fixture forecasts nothing. It
-- is the only way to reach the inherited arm of the pick through the generator
-- as it stands today, and reaching it is the point — the expression has to be
-- right before the fan-out is written on top of it.
--
-- Room 66002 is the one Anna already has a 'claim' link on.

select pg_temp.as_postgres();
insert into public.reservations (id, property_id, arrival_date, departure_date,
                                 status, guest_name) values
  (900002251, public.property_id_for_unit(66001), current_date, current_date + 3,
   'new', 'Guest A'),
  (900002252, public.property_id_for_unit(66002), current_date, current_date + 3,
   'new', 'Guest B'),
  (900002253, public.property_id_for_unit(66003), current_date, current_date + 4,
   'new', 'Guest C'),
  (900002254, public.property_id_for_unit(66004), current_date, current_date + 4,
   'new', 'Guest D'),
  (900002255, 900002204, current_date, current_date + 5, 'new', 'Guest E');

-- Anna is the regular cleaner of room 66003 — her own link on the room, under a
-- listing whose regular cleaner is Maria. Two 'auto' links are now reachable
-- from one room: property_cleaners_one_auto does not forbid that, it only
-- forbids two on the same row, so the pick itself has to settle it.
insert into public.property_cleaners (property_id, cleaner_id, mode)
values (public.property_id_for_unit(66003), 'e9000002-0000-4000-8000-0000000000e2', 'auto');

-- The count is the point as much as the assignments are: a pick written as one
-- widened lookup instead of a coalesce would return two rows for room 66003 and
-- abort the whole run with 21000, taking the other four cleanings with it.
select pg_temp.check('the run completes with a room that has two reachable regular cleaners',
  (public.generate_cleaning_tasks(current_date - 1, current_date + 7) ->> 'created')::int, 5);

select pg_temp.check('a cleaning on a room goes to the cleaner of its listing',
  pg_temp.assignee(900002251), 'e9000001-0000-4000-8000-0000000000e1'::uuid);

-- Naming somebody on the room is the manager overriding the listing for that
-- room, so it has to win.
select pg_temp.check('a room regular cleaner beats the listing regular cleaner',
  pg_temp.assignee(900002253), 'e9000002-0000-4000-8000-0000000000e2'::uuid);

-- A claim link puts a colleague in the queue; it has never emptied the queue
-- inside a single listing and it does not do so across one either.
select pg_temp.check('a room claim link does not stop the listing handing the work over',
  pg_temp.assignee(900002252), 'e9000001-0000-4000-8000-0000000000e1'::uuid);

select pg_temp.check('a listing with only a shared queue leaves the room task waiting',
  pg_temp.task_status(900002254), 'unassigned');

-- The other half of a combined listing has no cleaner of its own and must not
-- borrow the whole's, exactly as it could not see it.
select pg_temp.check('a part of a combined listing is not handed the whole listing cleaner',
  pg_temp.task_status(900002255), 'unassigned');

-- ---------------------------------------------------------------------------
--  A link made after the task already existed
-- ---------------------------------------------------------------------------
--
-- The same class as a stale deadline: state set once at creation and never
-- revisited. The listing's link changes, and the room's waiting task has to
-- follow on the next run.

update public.property_cleaners set mode = 'auto'
where property_id = 900002202 and cleaner_id = 'e9000003-0000-4000-8000-0000000000e3';

select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

select pg_temp.check('switching the listing link to auto hands over the waiting room task',
  pg_temp.assignee(900002254), 'e9000003-0000-4000-8000-0000000000e3'::uuid);

select pg_temp.check('and the rooms already handed over are left alone',
  pg_temp.assignee(900002253), 'e9000002-0000-4000-8000-0000000000e2'::uuid);

-- ---------------------------------------------------------------------------
--  Another company, and somebody who has left
-- ---------------------------------------------------------------------------

select pg_temp.as_maria();
select pg_temp.check('a room of another company is out of reach',
  public.cleans_property(public.property_id_for_unit(66009)), false);
select pg_temp.check('and so is the listing it is in',
  public.cleans_property(900002205), false);

-- Deactivation is the last thing checked because it takes Maria out of every
-- question above: a link that outlives the account must not keep the rooms open.
select pg_temp.as_postgres();
update public.profiles set is_active = false
where id = 'e9000001-0000-4000-8000-0000000000e1';

select pg_temp.as_maria();
select pg_temp.check('a deactivated cleaner is shown no room task',
  pg_temp.visible('79000001-0000-4000-8000-000000000071'), 0);

rollback;
