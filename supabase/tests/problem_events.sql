-- The history of a task (docs/tech-plan.md, 3.1; owner's decision 3 of
-- 2026-10-01). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: problem_events is the task's history from the day
-- of rollout. Triggers write it — on problems and on the repairs that answer
-- them — one row per event: its kind, who did it (auth.uid(), null for the
-- system), when, and the parameters, never text. Nobody writes it by hand,
-- and only the manager and the head technician read it. A cleaning, of any
-- kind, writes nothing and does not even call the trigger's function: the
-- generator's statements must not pay for it.
--
-- One transaction means one now(): the events of this suite share their
-- created_at, and their order is the order of id.
--
-- Fixture ids live in the 9000330xx range and under b33….
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('b3300000-0000-4000-8000-00000000000a', 'Host H'),
  ('b3300000-0000-4000-8000-00000000000b', 'Host O');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b3300001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.events@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b3300002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','hector.events@test.local','x',now(),now(),
   '{"full_name":"Hector"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('b3300003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tomas.events@test.local','x',now(),now(),
   '{"full_name":"Tomas"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('b3300004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','petr.events@test.local','x',now(),now(),
   '{"full_name":"Petr"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('b3300005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.events@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b3300009-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','olga.events@test.local','x',now(),now(),
   '{"full_name":"Olga"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('b330000a-0000-4000-8000-00000000000a','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','oleg.events@test.local','x',now(),now(),
   '{"full_name":"Oleg"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'b3300000-0000-4000-8000-00000000000a'
where id::text like 'b330000_-0000-4000-8000-00000000000_'
  and id not in ('b3300009-0000-4000-8000-000000000009', 'b330000a-0000-4000-8000-00000000000a');
update public.profiles set host_id = 'b3300000-0000-4000-8000-00000000000b'
where id in ('b3300009-0000-4000-8000-000000000009', 'b330000a-0000-4000-8000-00000000000a');

insert into public.properties (id, host_id, name, timezone) values
  (900033001, 'b3300000-0000-4000-8000-00000000000a', 'Leak flat', 'UTC'),
  (900033002, 'b3300000-0000-4000-8000-00000000000a', 'Quiet flat', 'UTC'),
  (900033009, 'b3300000-0000-4000-8000-00000000000b', 'Their flat', 'UTC');

-- Anna cleans the leak flat, so she may report from it.
insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('b3300000-0000-4000-8000-00000000000a', 900033001, 'b3300005-0000-4000-8000-000000000005', 'claim');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

/** The SQLSTATE a statement fails with, or 'no error'. */
create or replace function pg_temp.failure(stmt text) returns text
language plpgsql as $fn$
begin
  execute stmt;
  return 'no error';
exception when others then
  return sqlstate;
end $fn$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $fn$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$fn$;
create or replace function pg_temp.as_boss()   returns void language sql as $fn$
  select pg_temp.as_user('b3300001-0000-4000-8000-000000000001') $fn$;
create or replace function pg_temp.as_hector() returns void language sql as $fn$
  select pg_temp.as_user('b3300002-0000-4000-8000-000000000002') $fn$;
create or replace function pg_temp.as_tomas()  returns void language sql as $fn$
  select pg_temp.as_user('b3300003-0000-4000-8000-000000000003') $fn$;
create or replace function pg_temp.as_petr()   returns void language sql as $fn$
  select pg_temp.as_user('b3300004-0000-4000-8000-000000000004') $fn$;
create or replace function pg_temp.as_anna()   returns void language sql as $fn$
  select pg_temp.as_user('b3300005-0000-4000-8000-000000000005') $fn$;
create or replace function pg_temp.as_olga()   returns void language sql as $fn$
  select pg_temp.as_user('b3300009-0000-4000-8000-000000000009') $fn$;
create or replace function pg_temp.as_oleg()   returns void language sql as $fn$
  select pg_temp.as_user('b330000a-0000-4000-8000-00000000000a') $fn$;

create or replace function pg_temp.tomas() returns uuid language sql immutable as $fn$
  select 'b3300003-0000-4000-8000-000000000003'::uuid $fn$;
create or replace function pg_temp.petr() returns uuid language sql immutable as $fn$
  select 'b3300004-0000-4000-8000-000000000004'::uuid $fn$;
create or replace function pg_temp.pid(n integer) returns uuid language sql immutable as $fn$
  select ('b3303001-0000-4000-8000-00000000000' || n::text)::uuid $fn$;
create or replace function pg_temp.live_fix(n integer) returns uuid language sql as $fn$
  select t.id from public.tasks t
  where t.problem_id = pg_temp.pid(n) and t.status not in ('done', 'cancelled', 'expired') $fn$;

-- The events of one task, as "kind Actor" in order, read as postgres.
create or replace function pg_temp.history(n integer) returns text[] language sql as $fn$
  select coalesce(array_agg(e.kind::text || ' ' || coalesce(pr.full_name, '(system)')
                            order by e.created_at, e.id), '{}')
  from public.problem_events e
  left join public.profiles pr on pr.id = e.actor_id
  where e.problem_id = pg_temp.pid(n) $fn$;
-- The last event of a task, whole.
create or replace function pg_temp.last_event(n integer) returns public.problem_events
language sql as $fn$
  select e.* from public.problem_events e
  where e.problem_id = pg_temp.pid(n) order by e.created_at desc, e.id desc limit 1 $fn$;
create or replace function pg_temp.event_count() returns integer language sql as $fn$
  select count(*)::int from public.problem_events $fn$;

-- ---------------------------------------------------------------------------
--  The table: append-only, read by two roles, written by nobody
-- ---------------------------------------------------------------------------

select pg_temp.check('a client may only read the history',
  array[has_table_privilege('authenticated', 'public.problem_events', 'SELECT'),
        has_table_privilege('authenticated', 'public.problem_events', 'INSERT'),
        has_table_privilege('authenticated', 'public.problem_events', 'UPDATE'),
        has_table_privilege('authenticated', 'public.problem_events', 'DELETE'),
        has_table_privilege('authenticated', 'public.problem_events', 'TRUNCATE'),
        has_table_privilege('anon', 'public.problem_events', 'SELECT')],
  array[true, false, false, false, false, false]);
select pg_temp.check('row security is on',
  (select relrowsecurity from pg_class where oid = 'public.problem_events'::regclass), true);
select pg_temp.check('the events of one task are read in order from one index',
  (select count(*)::int from pg_indexes
   where schemaname = 'public' and tablename = 'problem_events'
     and indexdef like '%(problem_id, created_at, id)%'), 1);
select pg_temp.check('the trigger on tasks wakes only for a repair of a task, row by row',
  (select pg_get_triggerdef(oid) ~ 'FOR EACH ROW WHEN \(.*new\.problem_id IS NOT NULL.*new\.type = ''maintenance''::'
   from pg_trigger where tgname = 'tasks_journal_repair'), true);
select pg_temp.check('the writers are no client''s to call',
  (select coalesce(string_agg(r || ' ' || f, ', ' order by r, f), '')
   from unnest(array['anon', 'authenticated']) r
   cross join unnest(array['public.journal_problem_change()', 'public.journal_repair_change()']) f
   where has_function_privilege(r, f, 'EXECUTE')),
  '');

-- ---------------------------------------------------------------------------
--  Reported
-- ---------------------------------------------------------------------------

-- Written by the system, with nobody signed in.
insert into public.problems (id, host_id, property_id, reported_by, title) values
  (pg_temp.pid(9), 'b3300000-0000-4000-8000-00000000000b', 900033009,
   'b3300009-0000-4000-8000-000000000009', 'Their roof');
select pg_temp.check('a task written by the system is reported by nobody',
  pg_temp.history(9), array['reported (system)']);

select pg_temp.as_anna();
select public.report_problem(pg_temp.pid(1), 'Tap leaks', 'Under the sink', 'high', 900033001);
select public.report_problem(pg_temp.pid(2), 'Door squeaks', null, 'low', 900033001);
-- A replay of the report is the same report, not a second one.
select public.report_problem(pg_temp.pid(1), 'Tap leaks', 'Under the sink', 'high', 900033001);
reset role; reset request.jwt.claims;
select pg_temp.check('a report is reported by its reporter, once',
  pg_temp.history(1), array['reported Anna']);
select pg_temp.check('with its priority and its place, and no text',
  (select (e).params from (select pg_temp.last_event(1) as e) x),
  jsonb_build_object('priority', 'high', 'property', 900033001));
select pg_temp.check('the event is about the task, not an attempt',
  (select (e).task_id is null and (e).host_id = 'b3300000-0000-4000-8000-00000000000a'
   from (select pg_temp.last_event(1) as e) x), true);

-- ---------------------------------------------------------------------------
--  The attempt: assigned, reassigned, rescheduled, accepted, started, completed
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();
select public.assign_problem(pg_temp.pid(1), pg_temp.tomas());
reset role; reset request.jwt.claims;
select pg_temp.check('the first person of an attempt is an assignment, by whoever handed it out',
  pg_temp.history(1), array['reported Anna', 'assigned Boss']);
select pg_temp.check('which names the person and the day, and the attempt',
  (select array[(e).params, to_jsonb((e).task_id = pg_temp.live_fix(1))]
   from (select pg_temp.last_event(1) as e) x),
  array[jsonb_build_object('to', pg_temp.tomas(), 'date', current_date), 'true'::jsonb]);

-- The head technician gives it to another technician on another day.
select pg_temp.as_hector();
select public.assign_problem(pg_temp.pid(1), pg_temp.petr(), current_date + 2, '10:00', '12:00');
reset role; reset request.jwt.claims;
select pg_temp.check('another person inside the attempt is a reassignment, by him',
  (select array[(e).kind::text, (e).actor_id::text] from (select pg_temp.last_event(1) as e) x),
  array['reassigned', 'b3300002-0000-4000-8000-000000000002']);
select pg_temp.check('from whom to whom, from which day to which, and the hours',
  (select (e).params from (select pg_temp.last_event(1) as e) x),
  jsonb_build_object('from', pg_temp.tomas(), 'to', pg_temp.petr(),
                     'from_date', current_date, 'date', current_date + 2,
                     'time_from', '10:00:00', 'time_to', '12:00:00'));

-- The same person, back to today, no hours.
select pg_temp.as_hector();
select public.assign_problem(pg_temp.pid(1), pg_temp.petr(), current_date);
reset role; reset request.jwt.claims;
select pg_temp.check('another day for the same person is a move',
  (select array[(e).kind::text, (e).params::text] from (select pg_temp.last_event(1) as e) x),
  array['rescheduled', jsonb_build_object('from_date', current_date + 2, 'date', current_date)::text]);

-- The same again changes nothing and says nothing.
select pg_temp.as_hector();
select public.assign_problem(pg_temp.pid(1), pg_temp.petr(), current_date);
reset role; reset request.jwt.claims;
select pg_temp.check('a dispatch that changes nothing writes nothing',
  array_length(pg_temp.history(1), 1), 4);

select pg_temp.as_petr();
update public.tasks set status = 'accepted' where id = pg_temp.live_fix(1);
update public.tasks set status = 'in_progress' where id = pg_temp.live_fix(1);
reset role; reset request.jwt.claims;
select pg_temp.check('the technician accepts and starts, each once, as himself',
  (pg_temp.history(1))[5:6], array['accepted Petr', 'started Petr']);

-- Whatever the process of a repair asks is out of the way: what is tested is
-- the finish.
update public.task_steps set waived_at = now(), waived_by = 'b3300001-0000-4000-8000-000000000001'
where task_id = pg_temp.live_fix(1);
select pg_temp.as_petr();
update public.tasks set status = 'done' where id = pg_temp.live_fix(1);
reset role; reset request.jwt.claims;
select pg_temp.check('he finishes the attempt, and with it the task is resolved — in that order',
  (pg_temp.history(1))[7:8], array['completed Petr', 'resolved Petr']);

-- ---------------------------------------------------------------------------
--  Reopened, taken off, attempt cancelled, archived, unarchived, cancelled
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();
select public.reopen_problem(pg_temp.pid(1));
reset role; reset request.jwt.claims;
select pg_temp.check('a closed task put back on the board is reopened, from where it was',
  (select array[(e).kind::text, coalesce(pr.full_name, '?'), (e).params::text]
   from (select pg_temp.last_event(1) as e) x
   left join public.profiles pr on pr.id = (x.e).actor_id),
  array['reopened', 'Boss', '{"from": "resolved"}']);

select pg_temp.as_hector();
select public.assign_problem(pg_temp.pid(1), pg_temp.tomas());
select public.unassign_problem(pg_temp.live_fix(1));
reset role; reset request.jwt.claims;
select pg_temp.check('a new attempt is a new assignment, and taking him off is said so',
  (pg_temp.history(1))[10:11], array['assigned Hector', 'taken_off Hector']);
select pg_temp.check('naming who was taken off',
  (select (e).params from (select pg_temp.last_event(1) as e) x),
  jsonb_build_object('assignee', pg_temp.tomas()));

select pg_temp.as_boss();
select public.assign_problem(pg_temp.pid(1), pg_temp.tomas());
select public.archive_problem(pg_temp.pid(1));
reset role; reset request.jwt.claims;
select pg_temp.check('archiving cancels the live attempt first, then puts the task away',
  (pg_temp.history(1))[12:14], array['assigned Boss', 'attempt_cancelled Boss', 'archived Boss']);
select pg_temp.check('the cancelled attempt names whose it was',
  (select e.params from public.problem_events e
   where e.problem_id = pg_temp.pid(1) and e.kind = 'attempt_cancelled'),
  jsonb_build_object('assignee', pg_temp.tomas()));

select pg_temp.as_boss();
select public.unarchive_problem(pg_temp.pid(1));
select public.cancel_problem(pg_temp.pid(1), 'Owner fixed it himself');
reset role; reset request.jwt.claims;
select pg_temp.check('brought back, then closed without a fix',
  (pg_temp.history(1))[15:16], array['unarchived Boss', 'cancelled Boss']);
select pg_temp.check('the reason stays on the task, not in its history',
  (select (e).params from (select pg_temp.last_event(1) as e) x), '{}'::jsonb);

-- ---------------------------------------------------------------------------
--  The office's edit: unassigned, and any other move of the status
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();
select public.assign_problem(pg_temp.pid(2), pg_temp.tomas());
select public.save_task(pg_temp.live_fix(2), 900033001, 'maintenance', current_date);
select public.save_task(pg_temp.live_fix(2), 900033001, 'maintenance', current_date,
                        p_assignee_id => pg_temp.petr());
update public.tasks set status = 'blocked' where id = pg_temp.live_fix(2);
reset role; reset request.jwt.claims;
select pg_temp.check('the office takes the person away and gives another, and blocks the work',
  pg_temp.history(2),
  array['reported Anna', 'assigned Boss', 'unassigned Boss', 'assigned Boss', 'status_changed Boss']);
select pg_temp.check('the person taken away is named',
  (select e.params from public.problem_events e
   where e.problem_id = pg_temp.pid(2) and e.kind = 'unassigned'),
  jsonb_build_object('from', pg_temp.tomas()));
select pg_temp.check('a status with no event of its own says from what to what',
  (select (e).params from (select pg_temp.last_event(2) as e) x),
  jsonb_build_object('from', 'assigned', 'to', 'blocked'));

-- ---------------------------------------------------------------------------
--  A cleaning writes nothing, and costs nothing
-- ---------------------------------------------------------------------------

set local track_functions = 'all';
create or replace function pg_temp.calls(fn text) returns integer language sql as $fn$
  select coalesce(sum(calls), 0)::int from pg_stat_xact_user_functions
  where schemaname = 'public' and funcname = fn $fn$;
create temp table before_cleanings on commit drop as
  select pg_temp.event_count() as events, pg_temp.calls('journal_repair_change') as calls;

-- The generator's way (no user) and the office's, every kind of job but a
-- repair of a task, through insert, update and cancellation.
insert into public.tasks (id, host_id, property_id, type, status, assignee_id, scheduled_date) values
  ('b3302001-0000-4000-8000-000000000001', 'b3300000-0000-4000-8000-00000000000a', 900033001,
   'cleaning', 'unassigned', null, current_date),
  ('b3302001-0000-4000-8000-000000000002', 'b3300000-0000-4000-8000-00000000000a', 900033001,
   'midstay', 'assigned', 'b3300005-0000-4000-8000-000000000005', current_date),
  ('b3302001-0000-4000-8000-000000000003', 'b3300000-0000-4000-8000-00000000000a', 900033001,
   'inspection', 'assigned', 'b3300005-0000-4000-8000-000000000005', current_date),
  -- A repair the office wrote by hand, with no task behind it.
  ('b3302001-0000-4000-8000-000000000004', 'b3300000-0000-4000-8000-00000000000a', 900033002,
   'maintenance', 'assigned', pg_temp.tomas(), current_date);
update public.tasks set scheduled_date = current_date + 1, assignee_id = 'b3300005-0000-4000-8000-000000000005',
                        status = 'assigned'
where id::text like 'b3302001-%';
select pg_temp.as_boss();
update public.tasks set status = 'cancelled' where id::text like 'b3302001-%';
reset role; reset request.jwt.claims;
select pg_temp.check('a cleaning, an inspection, a mid-stay cleaning or a manual repair writes no history',
  pg_temp.event_count() - (select events from before_cleanings), 0);
select pg_temp.check('and does not even call the history''s function',
  pg_temp.calls('journal_repair_change') - (select calls from before_cleanings), 0);

-- ---------------------------------------------------------------------------
--  Who reads it
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();
select pg_temp.check('the manager reads the history of every task of his company, and only those',
  (select string_agg(distinct right(problem_id::text, 1), ',' order by right(problem_id::text, 1)) from public.problem_events), '1,2');
select pg_temp.as_hector();
select pg_temp.check('so does the head technician',
  (select string_agg(distinct right(problem_id::text, 1), ',' order by right(problem_id::text, 1)) from public.problem_events), '1,2');
select pg_temp.as_olga();
select pg_temp.check('another company''s head technician reads only his own',
  (select string_agg(distinct right(problem_id::text, 1), ',' order by right(problem_id::text, 1)) from public.problem_events), '9');
select pg_temp.as_oleg();
select pg_temp.check('and its manager too',
  (select string_agg(distinct right(problem_id::text, 1), ',' order by right(problem_id::text, 1)) from public.problem_events), '9');
select pg_temp.as_anna();
select pg_temp.check('the reporter does not read the history of her own report',
  (select count(*)::int from public.problem_events), 0);
select pg_temp.as_tomas();
select pg_temp.check('nor does the technician of the repair',
  (select count(*)::int from public.problem_events), 0);

-- ---------------------------------------------------------------------------
--  Nobody writes it
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();
select pg_temp.check('the manager cannot add an event',
  pg_temp.failure($q$insert into public.problem_events (host_id, problem_id, kind)
    values ('b3300000-0000-4000-8000-00000000000a', pg_temp.pid(1), 'resolved')$q$),
  '42501');
select pg_temp.check('nor change one',
  pg_temp.failure($q$update public.problem_events set actor_id = null$q$),
  '42501');
select pg_temp.check('nor remove one',
  pg_temp.failure($q$delete from public.problem_events$q$),
  '42501');
select pg_temp.as_hector();
select pg_temp.check('nor can the head technician',
  pg_temp.failure($q$delete from public.problem_events$q$),
  '42501');
reset role; reset request.jwt.claims;
select pg_temp.check('and the history is whole',
  array[array_length(pg_temp.history(1), 1), array_length(pg_temp.history(2), 1)], array[16, 5]);

rollback;
