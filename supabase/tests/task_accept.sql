-- The accept step. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected (docs/f11-plan.md, §2):
-- - a cleaner says "I am taking it" with one tap, and a replay of that tap
--   after a lost connection is not an error;
-- - accepting is a signal, not a lock: an accepted cleaning starts under the
--   same window as an assigned one, and an assigned one still starts without
--   being accepted;
-- - "accepted" means accepted by THIS person for THIS day and flat. When the
--   office hands the job to someone else, or moves it, the new state has not
--   been accepted by anybody, and the status says so;
-- - a free cleaning taken from the queue counts as accepted: she chose it;
-- - only a cleaning can be taken from the queue: a free inspection or
--   maintenance on her listing is the office's to hand out, as in the phone's
--   queue (FREE_TASK_TYPES) and the push about free work.
--
-- Fixture ids live in the a8f120xx range.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('a8f12000-0000-4000-8000-00000000000a', 'Host Accept');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('a8f12001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.accept@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('a8f12002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.accept@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a8f12003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bara.accept@test.local','x',now(),now(),
   '{"full_name":"Bara"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a8f12004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tomas.accept@test.local','x',now(),now(),
   '{"full_name":"Tomas"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('a8f12005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','petr.accept@test.local','x',now(),now(),
   '{"full_name":"Petr"}'::jsonb, '{"role":"tech"}'::jsonb);

update public.profiles set host_id = 'a8f12000-0000-4000-8000-00000000000a'
where id::text like 'a8f1200_-0000-4000-8000-00000000000_';

-- UTC, so "today from midnight" is the window the start guard reads.
insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900012001, 'a8f12000-0000-4000-8000-00000000000a', 'Accept flat', 'UTC', '15:00', '10:00'),
  (900012002, 'a8f12000-0000-4000-8000-00000000000a', 'Other flat',  'UTC', '15:00', '10:00');

-- Anna may take free work on the first flat.
insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('a8f12000-0000-4000-8000-00000000000a', 900012001,
   'a8f12002-0000-4000-8000-000000000002', 'claim');

insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id, notes)
values
  -- Hers, today: she accepts, replays, starts.
  ('a8f12101-0000-4000-8000-000000000001', 'a8f12000-0000-4000-8000-00000000000a',
   900012001, 'cleaning', 'assigned', current_date, 'a8f12002-0000-4000-8000-000000000002', 'accept me'),
  -- Hers, today: she starts without accepting.
  ('a8f12101-0000-4000-8000-000000000002', 'a8f12000-0000-4000-8000-00000000000a',
   900012001, 'cleaning', 'assigned', current_date, 'a8f12002-0000-4000-8000-000000000002', 'just start'),
  -- Hers, tomorrow: accepted today, but the window is tomorrow's.
  ('a8f12101-0000-4000-8000-000000000003', 'a8f12000-0000-4000-8000-00000000000a',
   900012001, 'cleaning', 'assigned', current_date + 1, 'a8f12002-0000-4000-8000-000000000002', 'tomorrow'),
  -- Free on her listing: taken the new way (accepted) and the old way (assigned).
  ('a8f12101-0000-4000-8000-000000000004', 'a8f12000-0000-4000-8000-00000000000a',
   900012001, 'cleaning', 'unassigned', current_date, null, 'free new app'),
  ('a8f12101-0000-4000-8000-000000000005', 'a8f12000-0000-4000-8000-00000000000a',
   900012001, 'cleaning', 'unassigned', current_date, null, 'free old app'),
  ('a8f12101-0000-4000-8000-000000000006', 'a8f12000-0000-4000-8000-00000000000a',
   900012001, 'cleaning', 'unassigned', current_date, null, 'free, grabbed wrong'),
  -- Free on her listing but not all of it hers to take: a mid-stay cleaning
  -- is, an inspection and a maintenance are the office's.
  ('a8f12101-0000-4000-8000-00000000000b', 'a8f12000-0000-4000-8000-00000000000a',
   900012001, 'midstay', 'unassigned', current_date, null, 'free midstay'),
  ('a8f12101-0000-4000-8000-00000000000c', 'a8f12000-0000-4000-8000-00000000000a',
   900012001, 'inspection', 'unassigned', current_date, null, 'free inspection'),
  ('a8f12101-0000-4000-8000-00000000000d', 'a8f12000-0000-4000-8000-00000000000a',
   900012001, 'maintenance', 'unassigned', current_date, null, 'free maintenance'),
  -- Free, and taken the wrong way: her name without a status.
  ('a8f12101-0000-4000-8000-00000000000e', 'a8f12000-0000-4000-8000-00000000000a',
   900012001, 'cleaning', 'unassigned', current_date, null, 'free, named without a status'),
  -- Accepted manual jobs the office then edits.
  ('a8f12101-0000-4000-8000-000000000007', 'a8f12000-0000-4000-8000-00000000000a',
   900012002, 'cleaning', 'accepted', current_date + 2, 'a8f12002-0000-4000-8000-000000000002', 'to Bara'),
  ('a8f12101-0000-4000-8000-000000000008', 'a8f12000-0000-4000-8000-00000000000a',
   900012002, 'cleaning', 'accepted', current_date + 3, 'a8f12002-0000-4000-8000-000000000002', 'new note'),
  ('a8f12101-0000-4000-8000-000000000009', 'a8f12000-0000-4000-8000-00000000000a',
   900012002, 'cleaning', 'accepted', current_date + 4, 'a8f12002-0000-4000-8000-000000000002', 'another day'),
  ('a8f12101-0000-4000-8000-00000000000a', 'a8f12000-0000-4000-8000-00000000000a',
   900012002, 'cleaning', 'accepted', current_date + 5, 'a8f12002-0000-4000-8000-000000000002', 'another flat');

insert into public.problems (id, host_id, property_id, reported_by, title) values
  ('a8f12201-0000-4000-8000-000000000001', 'a8f12000-0000-4000-8000-00000000000a',
   900012001, 'a8f12002-0000-4000-8000-000000000002', 'Tap leaks'),
  ('a8f12201-0000-4000-8000-000000000002', 'a8f12000-0000-4000-8000-00000000000a',
   900012001, 'a8f12002-0000-4000-8000-000000000002', 'Door squeaks');

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
create or replace function pg_temp.as_boss() returns void language sql as $fn$
  select pg_temp.as_user('a8f12001-0000-4000-8000-000000000001')
$fn$;
create or replace function pg_temp.as_anna() returns void language sql as $fn$
  select pg_temp.as_user('a8f12002-0000-4000-8000-000000000002')
$fn$;

create or replace function pg_temp.refusal_hint(stmt text) returns text
language plpgsql as $fn$
declare v_hint text;
begin
  execute stmt;
  return 'no refusal';
exception when others then
  get stacked diagnostics v_hint = PG_EXCEPTION_HINT;
  return coalesce(nullif(v_hint, ''), '(no hint)');
end $fn$;

create or replace function pg_temp.status_of(n int) returns text language sql as $fn$
  select t.status::text from public.tasks t
  where t.id = ('a8f12101-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid
$fn$;
create or replace function pg_temp.tid(n int) returns uuid language sql as $fn$
  select ('a8f12101-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid
$fn$;

-- The phone's own write (apps/mobile/src/features/tasks/api.ts): the status
-- filter takes 'accepted' too, so a replay finds its row.
create or replace function pg_temp.accept(n int) returns int language sql as $fn$
  with u as (
    update public.tasks t set status = 'accepted'
    where t.id = pg_temp.tid(n) and t.status in ('assigned', 'accepted')
    returning 1
  )
  select count(*)::int from u
$fn$;

-- ---------- she accepts ----------
select pg_temp.as_anna();
select pg_temp.check('she accepts her cleaning with one write', pg_temp.accept(1), 1);
select pg_temp.check('a replay of that tap finds its row and is not an error', pg_temp.accept(1), 1);
reset role; reset request.jwt.claims;
select pg_temp.check('the cleaning is accepted', pg_temp.status_of(1), 'accepted');

-- ---------- accepting is a signal, not a lock ----------
select pg_temp.as_anna();
update public.tasks set status = 'in_progress' where id = pg_temp.tid(1) and status in ('assigned', 'accepted');
update public.tasks set status = 'in_progress' where id = pg_temp.tid(2) and status in ('assigned', 'accepted');
reset role; reset request.jwt.claims;
select pg_temp.check('an accepted cleaning starts', pg_temp.status_of(1), 'in_progress');
select pg_temp.check('with its start stamped',
  (select started_at is not null from public.tasks where id = pg_temp.tid(1)), true);
select pg_temp.check('and one never accepted starts too', pg_temp.status_of(2), 'in_progress');

select pg_temp.as_anna();
select pg_temp.check('accepting tomorrow''s cleaning today is fine', pg_temp.accept(3), 1);
select pg_temp.check('but it still waits for its window',
  pg_temp.refusal_hint($q$update public.tasks set status = 'in_progress'
                          where id = pg_temp.tid(3)$q$),
  'serverErrors.startTooEarly');
select pg_temp.check('an accepted cleaning cannot be finished without being started',
  pg_temp.refusal_hint($q$update public.tasks set status = 'done' where id = pg_temp.tid(3)$q$),
  'serverErrors.transitionNotAllowed');
select pg_temp.check('nor handed back by the cleaner herself',
  pg_temp.refusal_hint($q$update public.tasks set status = 'assigned' where id = pg_temp.tid(3)$q$),
  'serverErrors.transitionNotAllowed');
reset role; reset request.jwt.claims;

-- ---------- a free cleaning taken from the queue ----------
select pg_temp.as_anna();
update public.tasks set assignee_id = 'a8f12002-0000-4000-8000-000000000002', status = 'accepted'
where id = pg_temp.tid(4) and status = 'unassigned';
update public.tasks set assignee_id = 'a8f12002-0000-4000-8000-000000000002', status = 'assigned'
where id = pg_temp.tid(5) and status = 'unassigned';
select pg_temp.check('taking free work straight into progress is refused',
  pg_temp.refusal_hint($q$update public.tasks
                          set assignee_id = 'a8f12002-0000-4000-8000-000000000002', status = 'in_progress'
                          where id = pg_temp.tid(6)$q$),
  'serverErrors.transitionNotAllowed');
reset role; reset request.jwt.claims;
select pg_temp.check('taken from the queue by the new app, it is accepted at once',
  pg_temp.status_of(4), 'accepted');
select pg_temp.check('taken by an app from before the accept step, it is assigned as ever',
  pg_temp.status_of(5), 'assigned');
select pg_temp.check('and the one grabbed the wrong way is still free', pg_temp.status_of(6), 'unassigned');

-- Taking free work the way the phone does: one write, 0 rows when refused.
create or replace function pg_temp.take(n int) returns int language sql as $fn$
  with u as (
    update public.tasks t
    set assignee_id = 'a8f12002-0000-4000-8000-000000000002', status = 'accepted'
    where t.id = pg_temp.tid(n) and t.status = 'unassigned'
    returning 1
  )
  select count(*)::int from u
$fn$;

select pg_temp.as_anna();
select pg_temp.check('a free mid-stay cleaning can be taken', pg_temp.take(11), 1);
select pg_temp.check('a free inspection on her listing cannot', pg_temp.take(12), 0);
select pg_temp.check('nor a free maintenance', pg_temp.take(13), 0);
reset role; reset request.jwt.claims;
select pg_temp.check('the inspection is still free', pg_temp.status_of(12), 'unassigned');
select pg_temp.check('and so is the maintenance', pg_temp.status_of(13), 'unassigned');

-- A take says so: her name on free work without a status would leave a row
-- neither free (gone from the queue) nor hers (nothing says she took it).
select pg_temp.as_anna();
select pg_temp.check('putting her name on free work without taking it is refused',
  pg_temp.refusal_hint($q$update public.tasks set assignee_id = 'a8f12002-0000-4000-8000-000000000002'
                          where id = pg_temp.tid(14) and status = 'unassigned'$q$),
  'serverErrors.transitionNotAllowed');
reset role; reset request.jwt.claims;
select pg_temp.check('and the cleaning stays free',
  (select t.assignee_id is null and t.status = 'unassigned' from public.tasks t where t.id = pg_temp.tid(14)),
  true);

-- ---------- the office changes what she accepted ----------
select pg_temp.as_boss();

select public.save_task(
  p_id => pg_temp.tid(7), p_property_id => 900012002, p_type => 'cleaning',
  p_scheduled_date => current_date + 2, p_notes => 'to Bara',
  p_assignee_id => 'a8f12003-0000-4000-8000-000000000003');

select public.save_task(
  p_id => pg_temp.tid(8), p_property_id => 900012002, p_type => 'cleaning',
  p_scheduled_date => current_date + 3, p_notes => 'bring the ladder',
  p_assignee_id => 'a8f12002-0000-4000-8000-000000000002');

select public.save_task(
  p_id => pg_temp.tid(9), p_property_id => 900012002, p_type => 'cleaning',
  p_scheduled_date => current_date + 6, p_notes => 'another day',
  p_assignee_id => 'a8f12002-0000-4000-8000-000000000002',
  p_expected_date => current_date + 4);

select public.save_task(
  p_id => pg_temp.tid(10), p_property_id => 900012001, p_type => 'cleaning',
  p_scheduled_date => current_date + 5, p_notes => 'another flat',
  p_assignee_id => 'a8f12002-0000-4000-8000-000000000002');

reset role; reset request.jwt.claims;

select pg_temp.check('handed to someone else, it waits for her to accept',
  (select array[t.status::text, t.assignee_id::text] from public.tasks t where t.id = pg_temp.tid(7)),
  array['assigned', 'a8f12003-0000-4000-8000-000000000003']);
select pg_temp.check('a new note on the same job keeps it accepted', pg_temp.status_of(8), 'accepted');
select pg_temp.check('moved to another day, it has to be accepted again', pg_temp.status_of(9), 'assigned');
select pg_temp.check('moved to another flat, the same', pg_temp.status_of(10), 'assigned');

-- ---------- a repair ----------
select pg_temp.as_boss();
select public.assign_problem('a8f12201-0000-4000-8000-000000000001',
                             'a8f12004-0000-4000-8000-000000000004', current_date + 1);
select public.assign_problem('a8f12201-0000-4000-8000-000000000002',
                             'a8f12004-0000-4000-8000-000000000004', current_date + 1);
reset role; reset request.jwt.claims;

-- The technician accepts both.
select pg_temp.as_user('a8f12004-0000-4000-8000-000000000004');
update public.tasks set status = 'accepted'
where problem_id in ('a8f12201-0000-4000-8000-000000000001', 'a8f12201-0000-4000-8000-000000000002')
  and status in ('assigned', 'accepted');
reset role; reset request.jwt.claims;
select pg_temp.check('a technician accepts his work too',
  (select array_agg(t.status::text order by t.problem_id) from public.tasks t
   where t.problem_id in ('a8f12201-0000-4000-8000-000000000001', 'a8f12201-0000-4000-8000-000000000002')),
  array['accepted', 'accepted']);

select pg_temp.as_boss();
select public.assign_problem('a8f12201-0000-4000-8000-000000000001',
                             'a8f12005-0000-4000-8000-000000000005', current_date + 1);
select public.assign_problem('a8f12201-0000-4000-8000-000000000002',
                             'a8f12004-0000-4000-8000-000000000004', current_date + 1);
reset role; reset request.jwt.claims;
select pg_temp.check('a repair handed to another technician waits for him to accept',
  (select array[t.status::text, t.assignee_id::text] from public.tasks t
   where t.problem_id = 'a8f12201-0000-4000-8000-000000000001'),
  array['assigned', 'a8f12005-0000-4000-8000-000000000005']);
select pg_temp.check('the same technician on the same day keeps it accepted',
  (select t.status::text from public.tasks t
   where t.problem_id = 'a8f12201-0000-4000-8000-000000000002'),
  'accepted');

select pg_temp.as_boss();
select public.assign_problem('a8f12201-0000-4000-8000-000000000002',
                             'a8f12004-0000-4000-8000-000000000004', current_date + 3);
reset role; reset request.jwt.claims;
select pg_temp.check('a repair moved to another day has to be accepted again',
  (select t.status::text from public.tasks t
   where t.problem_id = 'a8f12201-0000-4000-8000-000000000002'),
  'assigned');

rollback;
