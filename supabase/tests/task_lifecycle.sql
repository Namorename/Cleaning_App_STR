-- The life of a task in the cleaner's hands. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- Three moves belong to the cleaner: take (claim, covered in
-- task_assignment.sql), start, finish. The database stamps the clock at each
-- of them; the client may say what it likes about the time and is ignored,
-- because the measurement is what the hours report is built on.
--
-- Parallel work is the normal case, not the exception: a cleaner on a floor
-- starts one flat, steps out, starts the next. Several tasks may be in
-- progress at once, and the measurements of tasks that overlapped are marked
-- so that F12 does not add three overlapping hours up to nine. The host may
-- switch parallel starts off; by default they are on.
--
-- The original measurement is never rewritten — not by the cleaner, not by the
-- manager. A manual correction goes into its own column and the original stays
-- next to it (§13.3 of the spec).
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d1000000-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.life@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d2000000-0000-4000-8000-0000000000d2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.life@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d3000000-0000-4000-8000-0000000000d3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.life@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb);

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900001201, 'Flat one',   'UTC', '15:00', '10:00'),
  (900001202, 'Flat two',   'UTC', '15:00', '10:00'),
  (900001203, 'Flat three', 'UTC', '15:00', '10:00');

insert into public.tasks (property_id, type, status, assignee_id, scheduled_date, notes) values
  (900001201, 'cleaning', 'assigned', 'd1000000-0000-4000-8000-0000000000d1', current_date, 'first'),
  (900001202, 'cleaning', 'assigned', 'd1000000-0000-4000-8000-0000000000d1', current_date, 'second'),
  (900001203, 'cleaning', 'assigned', 'd1000000-0000-4000-8000-0000000000d1', current_date, 'third'),
  (900001201, 'cleaning', 'assigned', 'd2000000-0000-4000-8000-0000000000d2', current_date, 'annas');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.task(label text)
returns public.tasks language sql as $$
  select t.* from public.tasks t where t.notes = label
$$;

create or replace function pg_temp.as_maria() returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"d1000000-0000-4000-8000-0000000000d1","role":"authenticated"}', true)
$$;

create or replace function pg_temp.as_boss() returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"d3000000-0000-4000-8000-0000000000d3","role":"authenticated"}', true)
$$;

-- ---------- the host setting ----------
select pg_temp.check('parallel starts are allowed by default',
  (select parallel_start_allowed from public.hosts limit 1), true);

-- ---------- start ----------
select pg_temp.as_maria();

-- The client sends a time of its own; it is ignored.
update public.tasks set status = 'in_progress', started_at = '2000-01-01 00:00+00'
where notes = 'first';

reset role; reset request.jwt.claims;
select pg_temp.check('starting moves the task to in_progress',
  (pg_temp.task('first')).status::text, 'in_progress');
select pg_temp.check('the server stamps the start, not the client',
  (pg_temp.task('first')).started_at, now());
select pg_temp.check('a single running task is not parallel',
  (pg_temp.task('first')).is_parallel, false);

-- ---------- no skipping ----------
do $$
begin
  perform pg_temp.as_maria();
  update public.tasks set status = 'done' where notes = 'second';
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a task was finished without being started';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a task cannot be finished without being started';
end $$;

-- ---------- someone else's task ----------
select pg_temp.as_maria();
update public.tasks set status = 'in_progress' where notes = 'annas';
reset role; reset request.jwt.claims;
select pg_temp.check('a cleaner cannot start a colleague task',
  (pg_temp.task('annas')).status::text, 'assigned');

-- ---------- parallel start ----------
select pg_temp.as_maria();
update public.tasks set status = 'in_progress' where notes = 'second';
reset role; reset request.jwt.claims;
select pg_temp.check('a second task can run alongside the first',
  (pg_temp.task('second')).status::text, 'in_progress');
select pg_temp.check('the newly started task is marked parallel',
  (pg_temp.task('second')).is_parallel, true);
select pg_temp.check('the task it overlaps is marked parallel too',
  (pg_temp.task('first')).is_parallel, true);

-- ---------- finish ----------
select pg_temp.as_maria();
update public.tasks set status = 'done', completed_at = '2000-01-01 00:00+00'
where notes = 'first';
reset role; reset request.jwt.claims;
select pg_temp.check('finishing moves the task to done',
  (pg_temp.task('first')).status::text, 'done');
select pg_temp.check('the server stamps the finish',
  (pg_temp.task('first')).completed_at, now());
select pg_temp.check('the finish records who did it',
  (pg_temp.task('first')).completed_by, 'd1000000-0000-4000-8000-0000000000d1'::uuid);

-- Inside one transaction now() does not move, so the measurement is zero
-- minutes: the shortest possible cleaning, and exactly what §13.3 flags.
select pg_temp.check('a cleaning shorter than five minutes is flagged',
  (pg_temp.task('first')).is_short_measurement, true);

-- ---------- a sequential task is not parallel ----------
select pg_temp.as_maria();
update public.tasks set status = 'done' where notes = 'second';
update public.tasks set status = 'in_progress' where notes = 'third';
reset role; reset request.jwt.claims;
select pg_temp.check('a task started after the others finished is not parallel',
  (pg_temp.task('third')).is_parallel, false);

-- A long measurement, set up from the server side where the clock is free.
update public.tasks set started_at = now() - interval '2 hours' where notes = 'third';
select pg_temp.as_maria();
update public.tasks set status = 'done' where notes = 'third';
reset role; reset request.jwt.claims;
select pg_temp.check('a two-hour cleaning is not flagged',
  (pg_temp.task('third')).is_short_measurement, false);
select pg_temp.check('the measured minutes are recorded',
  (pg_temp.task('third')).measured_minutes, 120);

-- ---------- the original measurement is kept ----------
select pg_temp.as_boss();
update public.tasks
set started_at = now() - interval '5 hours', duration_override_min = 90
where notes = 'third';
reset role; reset request.jwt.claims;
select pg_temp.check('a manager cannot rewrite the original start',
  (pg_temp.task('third')).started_at, now() - interval '2 hours');
select pg_temp.check('a manager corrects the duration in its own column',
  (pg_temp.task('third')).duration_override_min, 90);
select pg_temp.check('the measured minutes survive the correction',
  (pg_temp.task('third')).measured_minutes, 120);

-- ---------- the host switches parallel starts off ----------
update public.hosts set parallel_start_allowed = false;

insert into public.tasks (property_id, type, status, assignee_id, scheduled_date, notes) values
  (900001201, 'cleaning', 'assigned', 'd1000000-0000-4000-8000-0000000000d1', current_date, 'fourth'),
  (900001202, 'cleaning', 'assigned', 'd1000000-0000-4000-8000-0000000000d1', current_date, 'fifth');

select pg_temp.as_maria();
update public.tasks set status = 'in_progress' where notes = 'fourth';
reset role; reset request.jwt.claims;
do $$
begin
  perform pg_temp.as_maria();
  update public.tasks set status = 'in_progress' where notes = 'fifth';
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a second task was started with parallel starts off';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  with parallel starts off, a second start is refused';
end $$;

-- ---------- not before the window ----------
-- Found on 2026-09-08: a cleaner could start tomorrow's cleaning today. The
-- start is held until the window opens — the scheduled date at the window's
-- start time, or midnight of that date when the start is unknown — judged in
-- the listing's own timezone. The refusal carries the date and time it is
-- waiting for. A manager is not held: releasing work early is their call.
--
-- Parallel starts go back on: this section is about the window, not about
-- what else Maria has running.
update public.hosts set parallel_start_allowed = true;

insert into public.tasks (property_id, type, status, assignee_id, scheduled_date, time_from, notes) values
  (900001201, 'cleaning', 'assigned', 'd1000000-0000-4000-8000-0000000000d1', current_date + 1, null,       'tomorrow'),
  (900001201, 'cleaning', 'assigned', 'd1000000-0000-4000-8000-0000000000d1', current_date,     '23:59:59', 'late today'),
  (900001201, 'cleaning', 'assigned', 'd1000000-0000-4000-8000-0000000000d1', current_date,     '00:00',    'from midnight'),
  (900001201, 'cleaning', 'assigned', 'd1000000-0000-4000-8000-0000000000d1', current_date - 1, '10:00',    'yesterday');

create or replace function pg_temp.refusal(statement text)
returns text language plpgsql as $$
declare
  v_hint   text;
  v_detail text;
begin
  execute statement;
  return 'no refusal';
exception when check_violation then
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return v_hint || coalesce(' ' || nullif(v_detail, ''), '');
end $$;

select pg_temp.as_maria();
select pg_temp.check('tomorrow''s cleaning cannot be started today',
  pg_temp.refusal($q$update public.tasks set status = 'in_progress' where notes = 'tomorrow'$q$),
  'serverErrors.startTooEarly {"date": "' || (current_date + 1)::text || '", "time": "00:00"}');
select pg_temp.check('a window that has not opened yet holds the start',
  pg_temp.refusal($q$update public.tasks set status = 'in_progress' where notes = 'late today'$q$),
  'serverErrors.startTooEarly {"date": "' || current_date::text || '", "time": "23:59"}');
update public.tasks set status = 'in_progress' where notes = 'from midnight';
update public.tasks set status = 'in_progress' where notes = 'yesterday';
reset role; reset request.jwt.claims;

select pg_temp.check('the held task is still waiting',
  (pg_temp.task('tomorrow')).status::text, 'assigned');
select pg_temp.check('a window that has opened lets the start through',
  (pg_temp.task('from midnight')).status::text, 'in_progress');
select pg_temp.check('a task from yesterday can still be started',
  (pg_temp.task('yesterday')).status::text, 'in_progress');

select pg_temp.as_boss();
update public.tasks set status = 'in_progress' where notes = 'tomorrow';
reset role; reset request.jwt.claims;
select pg_temp.check('a manager may start a cleaning before its window',
  (pg_temp.task('tomorrow')).status::text, 'in_progress');

rollback;
