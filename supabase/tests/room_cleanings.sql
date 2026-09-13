-- A cleaning per room, not per booking.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: a booking that took three rooms owes three
-- cleanings, a booking on an ordinary flat still owes one, and the two answers
-- come out of the same query. Everything downstream of that turns on one pair
-- of columns: a cleaning used to be named by its booking, and is now named by
-- its booking and the property it stands on. The unique index and all four
-- clauses of the generator have to agree about that, and each of them is asked
-- here — the insert that would skip a room, the reschedule and the hand-over
-- that would write one room's answer onto its neighbour, and the cancel that
-- would spare a room because a different one matched.
--
-- And urgency, which is what a cleaner actually feels: asked of the listing,
-- one room turning over marks every room urgent.
--
-- Fixture ids live in the 9000023xx range, rooms at 10000000670xx.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('c9000001-0000-4000-8000-0000000000c1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.rooms@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb);

-- 01 holds three rooms. 02 is an ordinary flat. 03 holds rooms too, and is
-- where a booking that names none of them is tested.
insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900002301, 'Rooms house',   'Europe/Prague', '15:00', '10:00'),
  (900002302, 'Ordinary flat', 'Europe/Prague', '15:00', '10:00'),
  (900002303, 'Quiet house',   'Europe/Prague', '15:00', '10:00');

insert into public.properties (id, hostaway_unit_id, parent_id, name,
                               timezone, check_in_time, check_out_time) values
  (public.property_id_for_unit(67001), 67001, 900002301, 'Room A',
   'Europe/Prague', '15:00', '10:00'),
  (public.property_id_for_unit(67002), 67002, 900002301, 'Room B',
   'Europe/Prague', '15:00', '10:00'),
  (public.property_id_for_unit(67003), 67003, 900002301, 'Room C',
   'Europe/Prague', '15:00', '10:00'),
  (public.property_id_for_unit(67004), 67004, 900002303, 'Quiet room',
   'Europe/Prague', '15:00', '10:00');

insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900002301, 'c9000001-0000-4000-8000-0000000000c1', 'auto');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

create or replace function pg_temp.cleanings(res_id bigint)
returns integer language sql as $fn$
  select count(*)::int from public.tasks
  where reservation_id = res_id and type = 'cleaning' and status <> 'cancelled'
$fn$;

create or replace function pg_temp.priority_of(res_id bigint, unit integer)
returns integer language sql as $fn$
  select priority::int from public.tasks
  where reservation_id = res_id and type = 'cleaning'
    and property_id = public.property_id_for_unit(unit) and status <> 'cancelled'
$fn$;

create or replace function pg_temp.status_of(res_id bigint, unit integer)
returns text language sql as $fn$
  select status::text from public.tasks
  where reservation_id = res_id and type = 'cleaning'
    and property_id = public.property_id_for_unit(unit)
  order by (status = 'cancelled') limit 1
$fn$;

create or replace function pg_temp.assignee_of(res_id bigint, unit integer)
returns uuid language sql as $fn$
  select assignee_id from public.tasks
  where reservation_id = res_id and type = 'cleaning'
    and property_id = public.property_id_for_unit(unit) and status <> 'cancelled'
$fn$;

-- ---------------------------------------------------------------------------
--  Fan-out
-- ---------------------------------------------------------------------------
--
-- 51 took rooms A and B of the house. 52 is the ordinary flat. 53 is on a
-- house with rooms but names none of them — Hostaway can say that, and the
-- listing itself is then what gets cleaned.

insert into public.reservations (id, property_id, arrival_date, departure_date,
                                 status, guest_name) values
  (900002351, 900002301, current_date, current_date + 2, 'new', 'Guest 51'),
  (900002352, 900002302, current_date, current_date + 2, 'new', 'Guest 52'),
  (900002353, 900002303, current_date, current_date + 2, 'new', 'Guest 53');

insert into public.reservation_units (reservation_id, property_id) values
  (900002351, public.property_id_for_unit(67001)),
  (900002351, public.property_id_for_unit(67002));

select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

select pg_temp.check('a booking that took two rooms owes two cleanings',
  pg_temp.cleanings(900002351), 2);
select pg_temp.check('one of them stands on the first room',
  pg_temp.status_of(900002351, 67001), 'assigned');
select pg_temp.check('and one on the second',
  pg_temp.status_of(900002351, 67002), 'assigned');
select pg_temp.check('the room it did not take gets nothing',
  pg_temp.status_of(900002351, 67003), null::text);
select pg_temp.check('an ordinary flat still owes exactly one',
  pg_temp.cleanings(900002352), 1);
select pg_temp.check('a booking that names no rooms is cleaned as the listing',
  (select count(*)::int from public.tasks
   where reservation_id = 900002353 and property_id = 900002303
     and status <> 'cancelled'), 1);

-- Both rooms are under a listing whose regular cleaner is Maria, and stage 4
-- is what carries her down to them.
select pg_temp.check('each room task goes to the listing regular cleaner',
  pg_temp.assignee_of(900002351, 67002),
  'c9000001-0000-4000-8000-0000000000c1'::uuid);

-- The run is idempotent room by room, not merely booking by booking: a second
-- pass must find both rooms already served.
select pg_temp.check('a second run creates nothing',
  (public.generate_cleaning_tasks(current_date - 1, current_date + 7) ->> 'created')::int, 0);

-- ---------------------------------------------------------------------------
--  Urgency belongs to the room that turns over
-- ---------------------------------------------------------------------------
--
-- 54 arrives into room A on the day 51 leaves it. Room B has nobody coming.
-- Asked of the listing — the question this migration replaced — both rooms
-- would be urgent and a cleaner would run for a changeover that is not hers.

insert into public.reservations (id, property_id, arrival_date, departure_date,
                                 status, guest_name) values
  (900002354, 900002301, current_date + 2, current_date + 5, 'new', 'Guest 54');
insert into public.reservation_units (reservation_id, property_id) values
  (900002354, public.property_id_for_unit(67001));

select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

select pg_temp.check('the room the next guest walks into is urgent',
  pg_temp.priority_of(900002351, 67001), 1);
select pg_temp.check('the room nobody is coming to is not',
  pg_temp.priority_of(900002351, 67002), 0);

-- The deadline follows urgency: it is the hour the next guest may arrive, and
-- only the room expecting one has it.
select pg_temp.check('only the turning room carries a deadline',
  (select count(*)::int from public.tasks
   where reservation_id = 900002351 and due_at is not null and status <> 'cancelled'), 1);

-- ---------------------------------------------------------------------------
--  One room's answer is not written onto its neighbour
-- ---------------------------------------------------------------------------
--
-- The reschedule clause used to find a task by its booking alone. With two
-- tasks to choose from it would have updated whichever came first.

update public.reservations set departure_date = current_date + 3 where id = 900002351;
select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

select pg_temp.check('the move reached the first room',
  (select scheduled_date from public.tasks
   where reservation_id = 900002351 and property_id = public.property_id_for_unit(67001)
     and status <> 'cancelled'), current_date + 3);
select pg_temp.check('and the second room as well, not one or the other',
  (select scheduled_date from public.tasks
   where reservation_id = 900002351 and property_id = public.property_id_for_unit(67002)
     and status <> 'cancelled'), current_date + 3);

-- The hand-over clause, same shape. Room C joins the booking after its
-- neighbours already have their cleanings, and must get one of its own.
update public.reservations set departure_date = current_date + 2 where id = 900002351;
insert into public.reservation_units (reservation_id, property_id)
values (900002351, public.property_id_for_unit(67003));
select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

select pg_temp.check('a room added to the booking is given its own cleaning',
  pg_temp.cleanings(900002351), 3);

-- ---------------------------------------------------------------------------
--  Cancelling reaches one room only
-- ---------------------------------------------------------------------------

delete from public.reservation_units
where reservation_id = 900002351 and property_id = public.property_id_for_unit(67003);

select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

select pg_temp.check('the room the booking gave up loses its cleaning',
  pg_temp.status_of(900002351, 67003), 'cancelled');
select pg_temp.check('the rooms it kept do not',
  pg_temp.cleanings(900002351), 2);
select pg_temp.check('and the ordinary flat is untouched by any of it',
  pg_temp.cleanings(900002352), 1);

-- ---------------------------------------------------------------------------
--  Work already finished is not ordered again
-- ---------------------------------------------------------------------------
--
-- Every cleaning finished before this migration stands on the listing, because
-- that is where cleanings stood. Read room by room the booking looks unserved,
-- and the generator would order the work a second time — on this account ten
-- of them, three already assigned to the cleaner who did them. History is not
-- moved onto a room; it is read where it lies.

insert into public.reservations (id, property_id, arrival_date, departure_date,
                                 status, guest_name) values
  (900002355, 900002301, current_date - 3, current_date, 'new', 'Guest 55');
insert into public.reservation_units (reservation_id, property_id) values
  (900002355, public.property_id_for_unit(67001));
insert into public.tasks (property_id, reservation_id, type, status, scheduled_date,
                          completed_at)
values (900002301, 900002355, 'cleaning', 'done', current_date, now());

select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

select pg_temp.check('a cleaning finished on the listing is not ordered again on the room',
  (select count(*)::int from public.tasks
   where reservation_id = 900002355 and status not in ('cancelled', 'expired')), 1);
select pg_temp.check('and it is still the finished one, where it was',
  (select property_id from public.tasks
   where reservation_id = 900002355 and status = 'done'), 900002301::bigint);

-- A cancelled one is different and always has been: the slot is free, because
-- a booking whose cleaning was called off is still owed one.
insert into public.reservations (id, property_id, arrival_date, departure_date,
                                 status, guest_name) values
  (900002356, 900002301, current_date - 3, current_date + 1, 'new', 'Guest 56');
insert into public.reservation_units (reservation_id, property_id) values
  (900002356, public.property_id_for_unit(67002));
insert into public.tasks (property_id, reservation_id, type, status, scheduled_date)
values (900002301, 900002356, 'cleaning', 'cancelled', current_date + 1);

select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

select pg_temp.check('a cancelled cleaning does not stop the room being served',
  (select count(*)::int from public.tasks
   where reservation_id = 900002356 and property_id = public.property_id_for_unit(67002)
     and status <> 'cancelled'), 1);

-- ---------------------------------------------------------------------------
--  What names one cleaning
-- ---------------------------------------------------------------------------

do $$
begin
  insert into public.tasks (property_id, reservation_id, type, status, scheduled_date)
  values (public.property_id_for_unit(67001), 900002351, 'cleaning', 'unassigned',
          current_date + 2);
  raise exception 'FAIL a room accepted a second live cleaning for one booking';
exception when unique_violation then
  raise notice 'ok  a room accepts one live cleaning per booking';
end $$;

select pg_temp.check('while a sibling room is a different cleaning, not a duplicate',
  (select count(distinct property_id)::int from public.tasks
   where reservation_id = 900002351 and status <> 'cancelled'), 2);

-- ---------------------------------------------------------------------------
--  A booking that learns its room late
-- ---------------------------------------------------------------------------
--
-- 53 sits on a listing that has rooms but named none of them, so its cleaning
-- stands on the listing and Maria has been handed it by hand. Hostaway then
-- says which room the guest took.
--
-- It is the same cleaning either way: what has changed is where it is, not
-- whether it is owed. Left to the insert and the cancel passes alone the
-- booking comes out of the run with nothing — the insert reads the listing row
-- as "already served" and the cancel pass, which judges by the pair, takes that
-- very row away. Measured against a copy of production, that pair cancelled 192
-- cleanings and created none, 96 of them with a cleaner's name on them.

create temporary table _late_task as
  select id from public.tasks
  where reservation_id = 900002353 and type = 'cleaning' and status <> 'cancelled';

update public.tasks
set assignee_id = 'c9000001-0000-4000-8000-0000000000c1', status = 'assigned'
where reservation_id = 900002353 and type = 'cleaning' and status <> 'cancelled';

insert into public.reservation_units (reservation_id, property_id)
values (900002353, public.property_id_for_unit(67004));

select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

select pg_temp.check('a booking that learns its room late still owes one cleaning',
  pg_temp.cleanings(900002353), 1);
select pg_temp.check('and that cleaning now stands on the room',
  pg_temp.status_of(900002353, 67004), 'assigned');
select pg_temp.check('nothing is left standing on the listing',
  (select count(*)::int from public.tasks
   where reservation_id = 900002353 and property_id = 900002303
     and type = 'cleaning' and status <> 'cancelled'), 0);
select pg_temp.check('the cleaner keeps the job she was handed',
  pg_temp.assignee_of(900002353, 67004),
  'c9000001-0000-4000-8000-0000000000c1'::uuid);
select pg_temp.check('it is the same row, so her photos and steps come with it',
  (select count(*)::int from public.tasks t join _late_task l on l.id = t.id
   where t.property_id = public.property_id_for_unit(67004) and t.status <> 'cancelled'), 1);
select pg_temp.check('and a second run leaves it alone',
  (public.generate_cleaning_tasks(current_date - 1, current_date + 7) ->> 'created')::int, 0);

rollback;
