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
  '{"created": 0, "rescheduled": 0, "assigned": 0, "cancelled": 0}'::jsonb);

rollback;
