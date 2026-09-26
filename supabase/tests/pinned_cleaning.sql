-- A cleaning's day, moved by hand, stays where the manager put it.
-- Run: npm run test:rls. Runs inside a transaction and rolls back.
--
-- The owner's decisions of 2026-09-26, after a cleaning moved in the panel
-- came back to the departure day on the next generator run (twice, 20:04 and
-- 20:42 UTC) and a cleaning written by hand on a departure day went in
-- without a word:
--   * a manager may move a cleaning from a booking; the move pins it: the
--     generator neither moves it back nor rewrites it, and never writes a
--     second one for the booking;
--   * moving it back onto the departure day unpins it, and so does the
--     booking's own departure arriving on the pinned day;
--   * a cancelled booking cancels its cleaning while nobody has started it —
--     unassigned, assigned and accepted, pinned or not (the owner's decision
--     of 2026-09-25); in_progress and paused are left alone;
--   * a booking that moves to another day takes an accepted cleaning with it,
--     back to «assigned» for the same cleaner to confirm the new day;
--   * a cleaning written by hand on a day that has a booking's cleaning on
--     the same listing asks first, like two hand-made ones do.
--
-- Every property has its own case; ids 9000025xx. Days are counted from
-- today so the cases never fall behind the generator's past bound.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d9002501-0000-4000-8000-0000000025e1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.pinned@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d9002502-0000-4000-8000-0000000025e2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.pinned@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb);

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900002501, 'Pin and return',        'UTC', '15:00', '10:00'),
  (900002502, 'Cancelled while taken', 'UTC', '15:00', '10:00'),
  (900002503, 'Started stays',         'UTC', '15:00', '10:00'),
  (900002504, 'Accepted follows',      'UTC', '15:00', '10:00'),
  (900002505, 'Pinned stays put',      'UTC', '15:00', '10:00'),
  (900002506, 'Booking meets pin',     'UTC', '15:00', '10:00'),
  (900002507, 'Duplicate question',    'UTC', '15:00', '10:00');

insert into public.reservations (id, property_id, arrival_date, departure_date, status, guest_name)
values
  (900002511, 900002501, current_date + 5,  current_date + 10, 'new', 'Guest 1'),
  (900002512, 900002502, current_date + 5,  current_date + 10, 'new', 'Guest 2'),
  (900002513, 900002502, current_date + 12, current_date + 14, 'new', 'Guest 3'),
  (900002514, 900002503, current_date + 5,  current_date + 10, 'new', 'Guest 4'),
  (900002515, 900002503, current_date + 12, current_date + 14, 'new', 'Guest 5'),
  (900002516, 900002504, current_date + 5,  current_date + 10, 'new', 'Guest 6'),
  (900002517, 900002505, current_date + 5,  current_date + 10, 'new', 'Guest 7'),
  (900002518, 900002506, current_date + 5,  current_date + 10, 'new', 'Guest 8'),
  (900002519, 900002507, current_date + 5,  current_date + 10, 'new', 'Guest 9');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.refusal(statement text)
returns text language plpgsql as $$
declare
  v_hint text;
begin
  execute statement;
  return 'no refusal';
exception when check_violation or insufficient_privilege or invalid_parameter_value then
  get stacked diagnostics v_hint = pg_exception_hint;
  return v_hint;
end $$;

create or replace function pg_temp.as_boss() returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"d9002502-0000-4000-8000-0000000025e2","role":"authenticated"}', true)
$$;

-- The one cleaning of a booking: the newest row, whatever its status.
create or replace function pg_temp.cleaning(res_id bigint) returns public.tasks
language sql as $$
  select t.* from public.tasks t
  where t.reservation_id = res_id and t.type = 'cleaning'
  order by t.created_at desc, t.id
  limit 1
$$;

create or replace function pg_temp.live_cleanings(res_id bigint) returns integer
language sql as $$
  select count(*)::int from public.tasks t
  where t.reservation_id = res_id and t.type = 'cleaning'
    and t.status not in ('cancelled', 'expired')
$$;

create or replace function pg_temp.run() returns jsonb language sql as $$
  select public.generate_cleaning_tasks(current_date, current_date + 60)
$$;

-- The run a webhook makes: its window is the departures of the batch, here
-- the one booking's — not the day its cleaning was moved to.
create or replace function pg_temp.run_for(res_id bigint) returns jsonb language sql as $$
  select public.generate_cleaning_tasks(r.departure_date, r.departure_date)
  from public.reservations r where r.id = res_id
$$;

-- A manager moves a booking's cleaning in the panel. The form sends back
-- every field it shows, so everything but the day goes as it was.
create or replace function pg_temp.move(res_id bigint, day date) returns void
language plpgsql as $$
declare
  v_task public.tasks := pg_temp.cleaning(res_id);
begin
  perform pg_temp.as_boss();
  perform public.save_task(v_task.id, v_task.property_id, 'cleaning', day,
    v_task.title, null, v_task.assignee_id, v_task.time_from, v_task.time_to,
    v_task.notes, v_task.priority);
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

select pg_temp.run();

-- ---------- 1. a move pins; moving back unpins ----------

select pg_temp.move(900002511, current_date + 11);
select pg_temp.check('a moved cleaning remembers the departure it was moved from',
  (pg_temp.cleaning(900002511)).pinned_departure, current_date + 10);
select pg_temp.run();
select pg_temp.check('the generator leaves a pinned cleaning on its day',
  (pg_temp.cleaning(900002511)).scheduled_date, current_date + 11);
select pg_temp.check('and writes no second cleaning for its booking',
  pg_temp.live_cleanings(900002511), 1);

select pg_temp.move(900002511, current_date + 10);
select pg_temp.check('back on the departure day, it is the generator''s again',
  (pg_temp.cleaning(900002511)).pinned_departure, null::date);
select pg_temp.run();
select pg_temp.check('and the generator keeps it there',
  (pg_temp.cleaning(900002511)).scheduled_date, current_date + 10);

-- ---------- 2. a cancelled booking cancels work nobody has started ----------

update public.tasks set status = 'accepted', assignee_id = 'd9002501-0000-4000-8000-0000000025e1'
where id = (pg_temp.cleaning(900002512)).id;
select pg_temp.move(900002513, current_date + 13);
update public.tasks set status = 'accepted', assignee_id = 'd9002501-0000-4000-8000-0000000025e1'
where id = (pg_temp.cleaning(900002513)).id;
update public.reservations set status = 'cancelled' where id in (900002512, 900002513);
select pg_temp.run_for(900002512);
select pg_temp.run_for(900002513);
select pg_temp.check('an accepted cleaning of a cancelled booking is cancelled',
  (pg_temp.cleaning(900002512)).status::text, 'cancelled');
select pg_temp.check('so is a pinned one, by the run of its booking''s departure',
  (pg_temp.cleaning(900002513)).status::text, 'cancelled');

-- ---------- 3. work under way is not the generator's ----------

update public.tasks set status = 'in_progress', assignee_id = 'd9002501-0000-4000-8000-0000000025e1',
                        started_at = now()
where id = (pg_temp.cleaning(900002514)).id;
update public.tasks set status = 'paused', assignee_id = 'd9002501-0000-4000-8000-0000000025e1',
                        started_at = now()
where id = (pg_temp.cleaning(900002515)).id;
update public.reservations set status = 'cancelled' where id in (900002514, 900002515);
select pg_temp.run();
select pg_temp.check('a cleaning in progress outlives its cancelled booking',
  (pg_temp.cleaning(900002514)).status::text, 'in_progress');
select pg_temp.check('and so does a paused one',
  (pg_temp.cleaning(900002515)).status::text, 'paused');

-- ---------- 4. an accepted cleaning follows its booking ----------

update public.tasks set status = 'accepted', assignee_id = 'd9002501-0000-4000-8000-0000000025e1'
where id = (pg_temp.cleaning(900002516)).id;
update public.reservations set departure_date = current_date + 11 where id = 900002516;
select pg_temp.run_for(900002516);
select pg_temp.check('an accepted cleaning moves with its booking',
  (pg_temp.cleaning(900002516)).scheduled_date, current_date + 11);
select pg_temp.check('back to «assigned», for the cleaner to confirm the new day',
  (pg_temp.cleaning(900002516)).status::text, 'assigned');
select pg_temp.check('still hers',
  (pg_temp.cleaning(900002516)).assignee_id, 'd9002501-0000-4000-8000-0000000025e1'::uuid);

-- ---------- 5. a pinned cleaning stays, whatever its booking does ----------

select pg_temp.move(900002517, current_date + 9);
-- The window the generator would write moves to 11:00; the booking is still
-- in the run's window, so only the pin keeps the cleaning as it is.
update public.properties set check_out_time = '11:00' where id = 900002505;
select pg_temp.run();
select pg_temp.check('a pinned cleaning''s window is not rewritten under it',
  (pg_temp.cleaning(900002517)).time_from, '10:00'::time);
select pg_temp.check('nor its day',
  (pg_temp.cleaning(900002517)).scheduled_date, current_date + 9);

update public.reservations set departure_date = current_date + 90 where id = 900002517;
select pg_temp.run();
select pg_temp.check('a pinned cleaning outlives its booking leaving the window',
  (pg_temp.cleaning(900002517)).status::text, 'unassigned');
select pg_temp.check('on the day it was pinned to',
  (pg_temp.cleaning(900002517)).scheduled_date, current_date + 9);
select pg_temp.check('with the departure it was pinned against, for «booking changed»',
  (pg_temp.cleaning(900002517)).pinned_departure, current_date + 10);

-- ---------- 6. the booking's departure arrives on the pinned day ----------

select pg_temp.move(900002518, current_date + 11);
update public.reservations set departure_date = current_date + 11 where id = 900002518;
select pg_temp.run_for(900002518);
select pg_temp.check('a booking that moves onto the pinned day unpins its cleaning',
  (pg_temp.cleaning(900002518)).pinned_departure, null::date);
select pg_temp.check('which stays on that day',
  (pg_temp.cleaning(900002518)).scheduled_date, current_date + 11);

-- ---------- 7. a hand-made cleaning on a departure day asks first ----------

select pg_temp.as_boss();
select pg_temp.check('a cleaning by hand on the day of a booking''s cleaning is a question',
  pg_temp.refusal($sql$select public.save_task(
    'c9002507-0000-4000-8000-000000000001'::uuid, 900002507, 'cleaning',
    current_date + 10)$sql$),
  'serverErrors.taskDuplicate');
select public.save_task('c9002507-0000-4000-8000-000000000001'::uuid, 900002507, 'cleaning',
  current_date + 10, null, null, null, null, null, null, null, true);
select pg_temp.check('an edit that keeps its day asks nothing again',
  pg_temp.refusal($sql$select public.save_task(
    'c9002507-0000-4000-8000-000000000001'::uuid, 900002507, 'cleaning',
    current_date + 10, 'Deep clean')$sql$),
  'no refusal');
select public.save_task('c9002507-0000-4000-8000-000000000002'::uuid, 900002507, 'inspection',
  current_date + 10);
reset role; reset request.jwt.claims;
select pg_temp.check('another kind of job that day asks nothing',
  (select type::text from public.tasks where id = 'c9002507-0000-4000-8000-000000000002'),
  'inspection');
select pg_temp.check('a task written by hand is never pinned',
  (select pinned_departure from public.tasks where id = 'c9002507-0000-4000-8000-000000000001'),
  null::date);

-- ---------- an executor cannot pin or unpin ----------

-- As postgres, so row level security stays out of the way: what is tested is
-- the field guard, which reads the caller from the claims.
select set_config('request.jwt.claims',
  '{"sub":"d9002501-0000-4000-8000-0000000025e1","role":"authenticated"}', true);
update public.tasks set pinned_departure = current_date
where id = (pg_temp.cleaning(900002516)).id;
reset request.jwt.claims;
select pg_temp.check('the cleaner''s own change of the pin is undone',
  (pg_temp.cleaning(900002516)).pinned_departure, null::date);

rollback;
