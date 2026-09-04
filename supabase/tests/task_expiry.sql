-- Cleaning tasks that were never done. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- The case under test: a task whose day has passed stayed in the queue for
-- ever. A cleaner opening "Свободные" was offered work from the previous week
-- and could take it, because nothing in the database said the date had any
-- meaning after it went by.
--
-- The rule: past its grace period, an open task moves to the terminal status
-- 'expired'. The row is kept — the history of what was not done is the point —
-- but it leaves the queue, and taking it is refused by row level security
-- rather than merely hidden by the app.
--
-- Grace is one whole day after the scheduled date: a cleaning finished at
-- 01:00 or caught up the next morning is normal work, a cleaning still open on
-- the day after that is not going to happen.
--
-- Dates are relative to the current date, so the suite does not rot. Fixture
-- listings sit in UTC so that "current_date" and the listing's own local date
-- are the same thing; the two listings that do test timezones are chosen at
-- the far ends of the world, where the assertion holds at any hour of the day.
--
-- Fixture ids live in the 9000006xx / 9000007xx range for the same reason as
-- in the other suites: real Hostaway ids are present after F2 and would
-- collide on the primary key.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.expiry@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.expiry@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb);

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900000601, 'Reservation moves forward later', 'UTC',                '15:00', '10:00'),
  (900000602, 'Ordinary listing',                'UTC',                '15:00', '10:00'),
  -- UTC+14: its local date is today or tomorrow, never yesterday.
  (900000603, 'Furthest east',                   'Pacific/Kiritimati', '15:00', '10:00'),
  -- UTC-11: its local date is today or yesterday, never tomorrow.
  (900000604, 'Furthest west',                   'Pacific/Niue',       '15:00', '10:00');

insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900000601, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'claim'),
  (900000602, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'claim'),
  (900000603, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'claim'),
  (900000604, 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'claim');

-- A departure a week ago: the generator makes a task for it, and nobody ever
-- picked it up.
insert into public.reservations (id, property_id, arrival_date, departure_date, status, guest_name)
values (900000701, 900000601, current_date - 10, current_date - 7, 'new', 'Guest Forgotten');

-- Tasks are labelled through `notes` so the checks below read as sentences.
insert into public.tasks (property_id, type, status, assignee_id, scheduled_date, notes) values
  (900000602, 'cleaning', 'unassigned', null,
   current_date - 7, 'last week, nobody took it'),
  (900000602, 'cleaning', 'assigned', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   current_date - 7, 'last week, taken and never finished'),
  (900000602, 'cleaning', 'unassigned', null,
   current_date - 1, 'yesterday, still within grace'),
  (900000602, 'cleaning', 'unassigned', null,
   current_date,     'today'),
  (900000602, 'cleaning', 'done', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
   current_date - 7, 'last week, finished'),
  (900000602, 'cleaning', 'cancelled', null,
   current_date - 7, 'last week, booking cancelled'),
  (900000603, 'cleaning', 'unassigned', null,
   current_date - 2, 'two days ago on the far side of the date line'),
  (900000604, 'cleaning', 'unassigned', null,
   current_date,     'today, eleven hours behind UTC');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.status(label text)
returns text language sql as $$
  select t.status::text from public.tasks t where t.notes = label
$$;

create or replace function pg_temp.assignee(label text)
returns uuid language sql as $$
  select t.assignee_id from public.tasks t where t.notes = label
$$;

create or replace function pg_temp.id(label text)
returns uuid language sql as $$
  select t.id from public.tasks t where t.notes = label
$$;

-- The task the generator owes us for the forgotten departure.
select public.generate_cleaning_tasks(current_date - 10, current_date + 10);

select pg_temp.check('the forgotten departure did produce a task',
  (select status::text from public.tasks
   where reservation_id = 900000701 and status <> 'cancelled'), 'unassigned');

-- ---------- before the sweep has run ----------
-- The nightly job is a sweeper, not the guarantee. Between midnight and the
-- job, a task past its grace is still 'unassigned', and taking it must already
-- be impossible.
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

update public.tasks
set assignee_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd', status = 'assigned'
where id = pg_temp.id('last week, nobody took it');

reset role; reset request.jwt.claims;
select pg_temp.check('a stale task cannot be claimed before the sweep runs',
  pg_temp.status('last week, nobody took it'), 'unassigned');
select pg_temp.check('the refused claim left no assignee behind',
  pg_temp.assignee('last week, nobody took it'), null::uuid);

-- ---------- the sweep ----------
select public.expire_stale_tasks();

select pg_temp.check('unclaimed work from last week is closed as expired',
  pg_temp.status('last week, nobody took it'), 'expired');
select pg_temp.check('work someone held and never finished is closed as expired',
  pg_temp.status('last week, taken and never finished'), 'expired');
select pg_temp.check('the unfinished task keeps its assignee for the manager',
  pg_temp.assignee('last week, taken and never finished'),
  'dddddddd-dddd-dddd-dddd-dddddddddddd'::uuid);
select pg_temp.check('the generated task for the forgotten departure is expired too',
  (select status::text from public.tasks where reservation_id = 900000701), 'expired');

select pg_temp.check('yesterday is still within grace',
  pg_temp.status('yesterday, still within grace'), 'unassigned');
select pg_temp.check('today is untouched',
  pg_temp.status('today'), 'unassigned');
select pg_temp.check('finished work keeps its status',
  pg_temp.status('last week, finished'), 'done');
select pg_temp.check('a cancelled booking stays cancelled, not expired',
  pg_temp.status('last week, booking cancelled'), 'cancelled');

-- Staleness is judged in the listing's own timezone, not in UTC.
select pg_temp.check('two days ago is past grace even fourteen hours ahead of UTC',
  pg_temp.status('two days ago on the far side of the date line'), 'expired');
select pg_temp.check('today is never stale, even eleven hours behind UTC',
  pg_temp.status('today, eleven hours behind UTC'), 'unassigned');

select pg_temp.check('the sweep closed exactly the stale fixtures',
  (select count(*)::int from public.tasks
   where property_id between 900000601 and 900000604 and status = 'expired'), 4);

-- ---------- an expired task is out of reach ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

update public.tasks
set assignee_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd', status = 'assigned'
where id = pg_temp.id('last week, nobody took it');

reset role; reset request.jwt.claims;
select pg_temp.check('an expired task cannot be claimed',
  pg_temp.status('last week, nobody took it'), 'expired');

-- Nor can the cleaner who was holding it put it back into her own list: she
-- owns the row, so row level security lets the update through and the guard
-- has to refuse it.
do $$
begin
  set local role authenticated;
  set local request.jwt.claims =
    '{"sub":"dddddddd-dddd-dddd-dddd-dddddddddddd","role":"authenticated"}';

  update public.tasks set status = 'in_progress'
  where notes = 'last week, taken and never finished';

  reset role; reset request.jwt.claims;
  raise exception 'FAIL a cleaner reopened an expired task';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a cleaner cannot reopen an expired task';
end $$;

select pg_temp.check('the reopened task is still expired',
  pg_temp.status('last week, taken and never finished'), 'expired');

-- ---------- what the manager sees ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee","role":"authenticated"}';

select pg_temp.check('unfinished work does not disappear from the manager view',
  (select count(*)::int from public.expired_tasks_review
   where property_id between 900000601 and 900000604), 4);
select pg_temp.check('the manager sees who was holding the unfinished cleaning',
  (select assignee_name from public.expired_tasks_review
   where task_notes = 'last week, taken and never finished'), 'Maria');

reset role; reset request.jwt.claims;
-- ---------- running it again changes nothing ----------
select pg_temp.check('a second sweep finds nothing left to close',
  public.expire_stale_tasks(),
  '{"expired_unclaimed": 0, "expired_unfinished": 0}'::jsonb);

-- ---------- a reservation that moves forward gets a fresh task ----------
-- Expiring is not the same as deleting, and the expired row must not block the
-- listing for ever: if the booking is rescheduled into the future, the
-- generator owes a new task for it.
update public.reservations
set arrival_date = current_date + 1, departure_date = current_date + 3
where id = 900000701;

select public.generate_cleaning_tasks(current_date - 10, current_date + 10);

select pg_temp.check('a rescheduled booking gets a new task',
  (select status::text from public.tasks
   where reservation_id = 900000701 and status <> 'expired'), 'unassigned');
select pg_temp.check('the new task carries the new date',
  (select scheduled_date from public.tasks
   where reservation_id = 900000701 and status <> 'expired'), current_date + 3);
select pg_temp.check('the expired attempt is kept as history',
  (select count(*)::int from public.tasks
   where reservation_id = 900000701 and status = 'expired'), 1);

rollback;
