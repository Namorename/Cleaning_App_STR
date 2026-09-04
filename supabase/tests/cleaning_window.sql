-- The cleaning window comes from the booking. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- The case under test: a cleaning window is not the listing's standard hours.
-- It is the gap between the guest who leaves and the guest who arrives, and
-- both ends are carried by the booking itself.
--
-- Established on live data (1704 reservations, 2026-09-04): every Hostaway
-- reservation carries `checkInTime` and `checkOutTime` as whole hours, and
-- they do differ from the listing default — 22 reservations on check-in, 2 on
-- check-out. Reservation 65157641 left at 12:00 where the listing says 10:00.
--
-- A cleaner sent at 10:00 to a flat whose guest paid to stay until 12:00
-- stands in front of an occupied door. That is what this suite protects.
--
-- Hostaway sends 0 when the channel supplied no time (seen once, an Airbnb
-- booking on listing 412432 whose listing check-in is 15:00). Midnight is not
-- a check-in hour in this business, so 00:00 means "not given" and the
-- listing's standard hour is used instead.
--
-- Fixture ids live in the 9000009xx / 90000100x range for the same reason as
-- in the other suites: real Hostaway ids would collide.
begin;

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900000901, 'Standard 10 to 15', 'UTC', '15:00', '10:00'),
  (900000902, 'Standard 10 to 17', 'UTC', '17:00', '10:00');

insert into public.reservations
  (id, property_id, arrival_date, departure_date, status, guest_name,
   guests_count, check_in_time, check_out_time)
values
  -- Late check-out bought: the guest leaves at 12:00, not at 10:00.
  -- Nobody arrives that day, so the window ends at the listing's own check-in.
  (900001001, 900000901, current_date - 2, current_date + 1, 'new', 'Late leaver',
   2, '15:00', '12:00'),

  -- The booking carries no check-out of its own: the window starts at the
  -- listing's standard hour. The next guest arrives the same day at 16:00,
  -- which is earlier than this listing's usual 17:00.
  (900001002, 900000902, current_date - 1, current_date + 2, 'new', 'Ordinary leaver',
   3, '17:00', null),
  (900001003, 900000902, current_date + 2, current_date + 5, 'new', 'Early arriver',
   4, '16:00', '10:00'),

  -- Hostaway sent 0 at both ends: the channel gave no time.
  (900001004, 900000901, current_date + 2, current_date + 4, 'new', 'Unknown hours',
   2, '15:00', '00:00'),
  (900001005, 900000901, current_date + 4, current_date + 6, 'new', 'Unknown arrival',
   5, '00:00', '10:00');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.task(res_id bigint)
returns public.tasks language sql as $$
  select t.* from public.tasks t
  where t.reservation_id = res_id and t.type = 'cleaning'
    and t.status not in ('cancelled', 'expired')
$$;

select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

-- ---------- the window comes from the booking ----------
select pg_temp.check('a bought late check-out moves the start of the window',
  (pg_temp.task(900001001)).time_from, '12:00'::time);
select pg_temp.check('with nobody arriving, the window ends at the listing hour',
  (pg_temp.task(900001001)).time_to, '15:00'::time);
select pg_temp.check('nobody arriving means no deadline',
  (pg_temp.task(900001001)).due_at, null::timestamptz);
select pg_temp.check('nobody arriving means no guest count',
  (pg_temp.task(900001001)).guests_count, null::smallint);
select pg_temp.check('an ordinary cleaning still gets a window',
  ((pg_temp.task(900001001)).time_from is not null
   and (pg_temp.task(900001001)).time_to is not null), true);

select pg_temp.check('a booking with no check-out of its own starts at the listing hour',
  (pg_temp.task(900001002)).time_from, '10:00'::time);
select pg_temp.check('the window ends at the arriving guest hour, not the listing one',
  (pg_temp.task(900001002)).time_to, '16:00'::time);
select pg_temp.check('the deadline follows the arriving guest',
  (pg_temp.task(900001002)).due_at,
  ((current_date + 2) + time '16:00') at time zone 'UTC');
select pg_temp.check('a same-day turnover is still marked urgent',
  (pg_temp.task(900001002)).priority::int, 1);

-- The count is of the guest arriving, not the one leaving: the cleaning
-- prepares the flat for whoever comes next.
select pg_temp.check('the guest count is the arriving booking, not the departing one',
  (pg_temp.task(900001002)).guests_count, 4::smallint);

-- ---------- 00:00 means the channel gave no time ----------
select pg_temp.check('a zero check-out falls back to the listing hour',
  (pg_temp.task(900001004)).time_from, '10:00'::time);
select pg_temp.check('a zero check-in falls back to the listing hour',
  (pg_temp.task(900001004)).time_to, '15:00'::time);
select pg_temp.check('a zero check-in still counts as a guest arriving',
  (pg_temp.task(900001004)).priority::int, 1);
select pg_temp.check('the fallback deadline is the listing check-in',
  (pg_temp.task(900001004)).due_at,
  ((current_date + 4) + time '15:00') at time zone 'UTC');

-- ---------- the late check-out is bought after the task exists ----------
-- The same class of defect as the stale due_at fixed on 2026-09-01: state
-- computed once at creation and never revisited. A late check-out is very
-- often bought after the booking was made, and that is confirmed on live
-- data — reservation 63364516 went from 10 to 11 in the webhook journal.
update public.reservations set check_out_time = '14:00' where id = 900001001;

select pg_temp.check('the rerun reports the moved window',
  (select (public.generate_cleaning_tasks(current_date - 1, current_date + 7)
             ->> 'rescheduled')::int > 0), true);

select pg_temp.check('the window follows a late check-out bought later',
  (pg_temp.task(900001001)).time_from, '14:00'::time);

-- ---------- and the arriving guest can change too ----------
update public.reservations set check_in_time = '13:00', guests_count = 6
where id = 900001003;

select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

select pg_temp.check('the window end follows a changed arrival hour',
  (pg_temp.task(900001002)).time_to, '13:00'::time);
select pg_temp.check('the deadline follows it as well',
  (pg_temp.task(900001002)).due_at,
  ((current_date + 2) + time '13:00') at time zone 'UTC');
select pg_temp.check('the guest count follows the arriving booking',
  (pg_temp.task(900001002)).guests_count, 6::smallint);

-- ---------- nothing left to change ----------
select pg_temp.check('a further run reports no changes',
  (select public.generate_cleaning_tasks(current_date - 1, current_date + 7)
     - 'window_from' - 'window_to'),
  '{"created": 0, "rescheduled": 0, "assigned": 0, "cancelled": 0}'::jsonb);

-- ---------- additive columns of F15 ----------
-- No behaviour of their own yet; they are checked so that a migration which
-- forgets one fails here rather than in the panel that first needs it.
select pg_temp.check('a task records who actually finished it',
  (pg_temp.task(900001001)).completed_by, null::uuid);

select pg_temp.check('a listing carries notes for the cleaner and notes for the office',
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'properties'
     and column_name in ('cleaner_notes', 'internal_notes')), 2);

select pg_temp.check('a link carries the order in which cleaners are offered work',
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'property_cleaners'
     and column_name = 'priority'), 1);

select pg_temp.check('a mid-stay cleaning is a type the system knows',
  (select count(*)::int from pg_enum e join pg_type t on t.oid = e.enumtypid
   where t.typname = 'task_type' and e.enumlabel = 'midstay'), 1);

rollback;
