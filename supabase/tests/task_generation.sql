-- Cleaning task generator. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- Fixture ids live in the 9000002xx / 9000003xx range for the same reason as
-- in rls_smoke.sql: real Hostaway ids are present in the database after F2 and
-- would collide on the primary key.
--
-- The case under test: a task's deadline must follow the property's check-in
-- time. Found in production on 2026-09-01 — six same-day tasks were created in
-- the minutes when check_in_time was still null, and no later run ever filled
-- their due_at, because the generator only rewrote tasks whose scheduled_date
-- or priority had changed.
begin;

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900000201, 'Deadline follows check-in', 'Europe/Prague', '15:00', '10:00'),
  (900000202, 'Check-in unknown at first', 'Europe/Prague', null,    '10:00'),
  (900000203, 'Work already finished',     'Europe/Prague', '15:00', '10:00');

-- Each pair is a same-day turnover: one guest leaves, the next arrives the
-- same day, so the cleaning gets priority 1 and a hard deadline.
insert into public.reservations (id, property_id, arrival_date, departure_date, status, guest_name) values
  (900000301, 900000201, '2026-10-07', '2026-10-10', 'new', 'Departing A'),
  (900000302, 900000201, '2026-10-10', '2026-10-12', 'new', 'Arriving A'),
  (900000303, 900000202, '2026-10-12', '2026-10-15', 'new', 'Departing B'),
  (900000304, 900000202, '2026-10-15', '2026-10-18', 'new', 'Arriving B'),
  (900000305, 900000203, '2026-10-17', '2026-10-20', 'new', 'Departing C'),
  (900000306, 900000203, '2026-10-20', '2026-10-22', 'new', 'Arriving C');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.due_at(res_id bigint)
returns timestamptz language sql as $$
  select due_at from public.tasks
  where reservation_id = res_id and type = 'cleaning' and status <> 'cancelled'
$$;

-- ---------- first run: deadlines come from the property ----------
select public.generate_cleaning_tasks('2026-10-01', '2026-10-31');

select pg_temp.check('same-day turnover gets priority 1',
  (select priority::int from public.tasks where reservation_id = 900000301), 1);

-- Prague is on CEST (UTC+2) on this date, so 15:00 local is 13:00 UTC.
select pg_temp.check('deadline is the next guest check-in, in property timezone',
  pg_temp.due_at(900000301), '2026-10-10 13:00+00'::timestamptz);

select pg_temp.check('no check-in time means no deadline yet',
  pg_temp.due_at(900000303), null::timestamptz);

-- ---------- the defect: check-in time changes afterwards ----------
update public.properties set check_in_time = '17:00' where id = 900000201;
update public.properties set check_in_time = '15:00' where id = 900000202;

-- Mark one task finished. A rerun must not touch work that is already done,
-- even though its deadline is now stale.
update public.tasks set status = 'done'
where reservation_id = 900000305 and type = 'cleaning';

select public.generate_cleaning_tasks('2026-10-01', '2026-10-31');

select pg_temp.check('deadline follows a changed check-in time',
  pg_temp.due_at(900000301), '2026-10-10 15:00+00'::timestamptz);

select pg_temp.check('deadline is filled in once check-in time becomes known',
  pg_temp.due_at(900000303), '2026-10-15 13:00+00'::timestamptz);

select pg_temp.check('finished work keeps its status',
  (select status::text from public.tasks where reservation_id = 900000305), 'done');

select pg_temp.check('finished work keeps its original deadline',
  pg_temp.due_at(900000305), '2026-10-20 13:00+00'::timestamptz);

-- ---------- nothing left to change ----------
select pg_temp.check('a third run reports no changes',
  (select public.generate_cleaning_tasks('2026-10-01', '2026-10-31')
     - 'window_from' - 'window_to'),
  '{"created": 0, "rescheduled": 0, "assigned": 0, "cancelled": 0, "relocated": 0,
    "past_bound": 0}'::jsonb);

-- ---------- a booking is cancelled ----------
-- The task is never deleted: it is a record that a cleaning was planned. A
-- task nobody has touched is marked cancelled. A task somebody is working on,
-- or has finished, is left exactly as it is — the hours were real whatever
-- happened to the booking. A cancelled booking that comes back gets a fresh
-- task next to the cancelled one, so the history reads as it happened.
insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900000204, 'Cancellations', 'Europe/Prague', '15:00', '10:00');

insert into public.reservations (id, property_id, arrival_date, departure_date, status, guest_name) values
  (900000307, 900000204, '2026-11-01', '2026-11-03', 'new', 'Cancels while untouched'),
  (900000308, 900000204, '2026-11-05', '2026-11-07', 'new', 'Cancels while in progress'),
  (900000309, 900000204, '2026-11-09', '2026-11-11', 'new', 'Cancels after the cleaning');

create or replace function pg_temp.task_statuses(res_id bigint)
returns text language sql as $$
  select string_agg(status::text, ',' order by created_at)
  from public.tasks where reservation_id = res_id and type = 'cleaning'
$$;

select pg_temp.check('three November tasks are created',
  (select (public.generate_cleaning_tasks('2026-11-01', '2026-11-30') ->> 'created')::int), 3);

-- The cleaner has started one and finished another before the guests cancel.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values ('d7000000-0000-4000-8000-0000000000d7','00000000-0000-0000-0000-000000000000',
        'authenticated','authenticated','maria.gen@test.local','x',now(),now(),
        '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb);

update public.tasks
set status = 'in_progress', assignee_id = 'd7000000-0000-4000-8000-0000000000d7',
    started_at = now() - interval '1 hour'
where reservation_id = 900000308;
update public.tasks set status = 'done', started_at = now() - interval '3 hours',
                        completed_at = now() - interval '1 hour'
where reservation_id = 900000309;

update public.reservations set status = 'cancelled'
where id in (900000307, 900000308, 900000309);

select pg_temp.check('the run reports one cancellation, the untouched task',
  (select (public.generate_cleaning_tasks('2026-11-01', '2026-11-30') ->> 'cancelled')::int), 1);

select pg_temp.check('an untouched task is marked cancelled, not deleted',
  pg_temp.task_statuses(900000307), 'cancelled');
select pg_temp.check('a task under way keeps running',
  pg_temp.task_statuses(900000308), 'in_progress');
select pg_temp.check('a task under way keeps its start stamp',
  (select started_at is not null from public.tasks where reservation_id = 900000308), true);
select pg_temp.check('a finished task stays done',
  pg_temp.task_statuses(900000309), 'done');

-- ---------- the booking comes back ----------
update public.reservations set status = 'modified' where id in (900000307, 900000308);

select pg_temp.check('a reinstated booking gets a task again',
  (select (public.generate_cleaning_tasks('2026-11-01', '2026-11-30') ->> 'created')::int), 1);
select pg_temp.check('the cancelled task stays as history next to the new one',
  pg_temp.task_statuses(900000307), 'cancelled,unassigned');
select pg_temp.check('a booking whose cleaning is under way does not get a second task',
  pg_temp.task_statuses(900000308), 'in_progress');

-- ---------- a listing that is not taking guests ----------
--
-- Both states stop the schedule, and that is the whole point of the pair:
-- `maintenance` is a flat under repair and `archived` one that has left the
-- company. Neither earns a cleaning; only one of them is expected back.
insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900000205, 'Goes under repair', 'Europe/Prague', '15:00', '10:00');

insert into public.reservations (id, property_id, arrival_date, departure_date, status, guest_name) values
  (900000310, 900000205, '2026-12-01', '2026-12-04', 'new', 'Leaves mid-renovation');

update public.properties set status = 'maintenance' where id = 900000205;

select pg_temp.check('a listing under maintenance earns no cleaning',
  (select (public.generate_cleaning_tasks('2026-12-01', '2026-12-31') ->> 'created')::int), 0);

update public.properties set status = 'archived' where id = 900000205;

select pg_temp.check('and neither does an archived one',
  (select (public.generate_cleaning_tasks('2026-12-01', '2026-12-31') ->> 'created')::int), 0);

-- Back in service, and the booking that waited through the repair is served.
update public.properties set status = 'active' where id = 900000205;

select pg_temp.check('back in service, the booking finally gets its cleaning',
  (select (public.generate_cleaning_tasks('2026-12-01', '2026-12-31') ->> 'created')::int), 1);

-- A listing pulled out of service after the task exists: the same pass that
-- cancels a withdrawn booking takes this one down too.
update public.properties set status = 'maintenance' where id = 900000205;

select pg_temp.check('a listing pulled out of service cancels the task it had',
  (select (public.generate_cleaning_tasks('2026-12-01', '2026-12-31') ->> 'cancelled')::int), 1);
select pg_temp.check('cancelled, not deleted — it stays as history',
  pg_temp.task_statuses(900000310), 'cancelled');

-- ---------------------------------------------------------------------------
--  The night after the sweep: one row, not one per night (20260918171000)
-- ---------------------------------------------------------------------------
--
-- The nightly window reaches seven days back, so a departure of last week is
-- reconciled again every night. An `expired` cleaning did not count as one that
-- exists, so the generator wrote a fresh row each night and the sweep closed it
-- again: 4853 rows for 769 departures in production on 2026-09-19.
--
-- Dates here are relative to today, because staleness is: a fixed date would
-- stop being stale the day after the fixture was written.

-- The listing sits in UTC so that current_date and its local date agree at any
-- hour: the first night below is exactly on the grace boundary.
insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900000206, 'Departure five days ago', 'UTC', '15:00', '10:00');
-- The cleaning is born while its day is still within grace -- the generator
-- does not write one for a day already stale (20260923120000) -- and the days
-- then pass underneath it.
insert into public.reservations (id, property_id, arrival_date, departure_date, status, guest_name)
values (900000311, 900000206, current_date - 4, current_date - 1, 'new', 'Left five days ago');

-- The window a night uses, cut short at the top so the October and November
-- fixtures above stay out of reach and the counts below are about this booking.
create or replace function pg_temp.nightly() returns int language sql as $$
  select (public.generate_cleaning_tasks(current_date - 7, current_date + 5) ->> 'created')::int
$$;

create or replace function pg_temp.rows_of(res_id bigint) returns int language sql as $$
  select count(*)::int from public.tasks where reservation_id = res_id and type = 'cleaning'
$$;

select pg_temp.check('night one writes the cleaning for yesterday, still within grace',
  pg_temp.nightly(), 1);

-- Four days go by with nobody taking it. Moving the booking and its row back
-- together is how a fixture says "time passed" without touching the clock.
update public.reservations
set arrival_date = current_date - 8, departure_date = current_date - 5
where id = 900000311;
update public.tasks set scheduled_date = current_date - 5 where reservation_id = 900000311;

select public.expire_stale_tasks();
select pg_temp.check('and the sweep closes it, nobody having done it',
  pg_temp.task_statuses(900000311), 'expired');

select pg_temp.check('night two writes nothing: that day was already tried',
  pg_temp.nightly(), 0);
select public.expire_stale_tasks();
select pg_temp.check('night three likewise', pg_temp.nightly(), 0);
select public.expire_stale_tasks();

select pg_temp.check('three nights leave one row, not three', pg_temp.rows_of(900000311), 1);

-- The departure moves into the future. That is a different day and real work:
-- the expired row answers for the day nobody cleaned, not for this one. Without
-- this the departure would be lost -- which is why the guard is keyed on the
-- day and not on the booking.
update public.reservations set departure_date = current_date + 3, status = 'modified'
where id = 900000311;

select pg_temp.check('a departure that moved gets a cleaning for the new day',
  pg_temp.nightly(), 1);
select pg_temp.check('the record of the day nobody cleaned is kept',
  (select count(*)::int from public.tasks
    where reservation_id = 900000311 and status = 'expired'), 1);
select pg_temp.check('and the new day is live, on its own date',
  (select count(*)::int from public.tasks
    where reservation_id = 900000311 and status = 'unassigned'
      and scheduled_date = current_date + 3), 1);
select pg_temp.check('two rows in all: one closed day, one open', pg_temp.rows_of(900000311), 2);
select pg_temp.check('the night after that adds nothing', pg_temp.nightly(), 0);

-- And the day that was tried stays closed to the generator even now: moving the
-- booking back onto it does not earn a second attempt.
update public.reservations set departure_date = current_date - 5 where id = 900000311;
select pg_temp.check('moved back onto the tried day, still no third row',
  pg_temp.nightly(), 0);
select pg_temp.check('and the live row followed the booking instead',
  (select count(*)::int from public.tasks
    where reservation_id = 900000311 and status = 'unassigned'
      and scheduled_date = current_date - 5), 1);

-- ---------------------------------------------------------------------------
--  No cleaning is born for a day already past its grace (20260923120000)
-- ---------------------------------------------------------------------------
--
-- The webhook path reconciles over the dates of the booking itself, so an edit
-- in Hostaway to a booking that left weeks ago reached the generator with a
-- window around that old day. Found in production on 2026-09-23: booking
-- 63925530, departure 08.08, edited 23.09, got a fresh unassigned cleaning for
-- 08.08 that sat in the manager's queue until the sweep closed it.
--
-- The boundary is task_is_stale(), the very function the sweep and the claim
-- policy ask: a day the sweep would close is a day the generator must not open.

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900000207, 'Past-bound listing', 'UTC', '15:00', '10:00');
insert into public.reservations (id, property_id, arrival_date, departure_date, status, guest_name)
values
  (900000312, 900000207, current_date - 50, current_date - 46, 'modified', 'Edited weeks later'),
  (900000313, 900000207, current_date - 5,  current_date - 2,  'new',      'Two days ago'),
  (900000314, 900000207, current_date - 4,  current_date - 1,  'new',      'Yesterday');

-- The webhook's call: the window is exactly the booking's own departure.
select pg_temp.check('an edit to a booking long gone creates no cleaning',
  (public.generate_cleaning_tasks(current_date - 46, current_date - 46) ->> 'created')::int, 0);
select pg_temp.check('and leaves no row behind', pg_temp.rows_of(900000312), 0);
select pg_temp.check('the answer is an ordinary result, not an error',
  (select array_agg(k order by k) from jsonb_object_keys(
     public.generate_cleaning_tasks(current_date - 46, current_date - 46)) k),
  array['assigned','cancelled','created','past_bound','relocated','rescheduled',
        'window_from','window_to']);
select pg_temp.check('the refused cleaning is counted as past_bound',
  (public.generate_cleaning_tasks(current_date - 46, current_date - 46) ->> 'past_bound')::int, 1);

select pg_temp.check('two days ago is past grace: no cleaning',
  (public.generate_cleaning_tasks(current_date - 2, current_date - 2) ->> 'created')::int, 0);
select pg_temp.check('yesterday is the boundary and still owed a cleaning',
  (public.generate_cleaning_tasks(current_date - 1, current_date - 1) ->> 'created')::int, 1);
select pg_temp.check('a day within grace is never counted as past_bound',
  (public.generate_cleaning_tasks(current_date - 1, current_date - 1) ->> 'past_bound')::int, 0);
select pg_temp.check('nor is a stale day that already has its cleaning',
  (public.generate_cleaning_tasks(current_date - 5, current_date - 5) ->> 'past_bound')::int, 0);

-- The bound is on birth only. A live cleaning that went stale since it was
-- written is the sweep's to close as `expired`; the generator must not read
-- "not wanted any more" into it and cancel it first -- it runs at 03:15, the
-- sweep at 03:30, so the night would turn every miss into a cancellation.
update public.reservations set departure_date = current_date - 2 where id = 900000314;
update public.tasks set scheduled_date = current_date - 2 where reservation_id = 900000314;
select public.generate_cleaning_tasks(current_date - 7, current_date);
select pg_temp.check('a stale live cleaning is left for the sweep, not cancelled',
  pg_temp.task_statuses(900000314), 'unassigned');

rollback;
