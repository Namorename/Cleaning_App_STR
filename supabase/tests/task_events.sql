-- The journal of cleanings (docs/dashboard-metrics.md, section 3, item 1;
-- owner's decision of 2026-10-14). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: task_events is the history of every task that is
-- not a repair of a reported problem (those have problem_events). Triggers
-- write it, one row per event: its kind, who did it (auth.uid(), null for the
-- system), when, why (for a cancellation, a removal of the person and a move)
-- and the parameters, never text. Nobody writes it by hand, only the manager
-- of the company reads it, a write that changes nothing writes nothing, and
-- the maid's own flow is not refused or altered by it.
--
-- One transaction means one now(): events share their `at`, and their order
-- is the order of id.
--
-- Fixture ids live in the 9000440xx range and under b44….
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('b4400000-0000-4000-8000-00000000000a', 'Host H'),
  ('b4400000-0000-4000-8000-00000000000b', 'Host O');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b4400001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.journal@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b4400002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.journal@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b4400003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','petra.journal@test.local','x',now(),now(),
   '{"full_name":"Petra"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b4400004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','hector.journal@test.local','x',now(),now(),
   '{"full_name":"Hector"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('b4400009-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','oleg.journal@test.local','x',now(),now(),
   '{"full_name":"Oleg"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'b4400000-0000-4000-8000-00000000000a'
where id in ('b4400001-0000-4000-8000-000000000001', 'b4400002-0000-4000-8000-000000000002',
             'b4400003-0000-4000-8000-000000000003', 'b4400004-0000-4000-8000-000000000004');
update public.profiles set host_id = 'b4400000-0000-4000-8000-00000000000b'
where id = 'b4400009-0000-4000-8000-000000000009';

insert into public.properties (id, host_id, name, timezone) values
  (900044001, 'b4400000-0000-4000-8000-00000000000a', 'Flat one', 'Europe/Prague'),
  (900044002, 'b4400000-0000-4000-8000-00000000000a', 'Flat two', 'Europe/Prague'),
  (900044009, 'b4400000-0000-4000-8000-00000000000b', 'Their flat', 'Europe/Prague');

insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('b4400000-0000-4000-8000-00000000000a', 900044001, 'b4400002-0000-4000-8000-000000000002', 'claim'),
  ('b4400000-0000-4000-8000-00000000000a', 900044002, 'b4400002-0000-4000-8000-000000000002', 'claim'),
  ('b4400000-0000-4000-8000-00000000000a', 900044001, 'b4400003-0000-4000-8000-000000000003', 'claim'),
  ('b4400000-0000-4000-8000-00000000000a', 900044002, 'b4400003-0000-4000-8000-000000000003', 'claim');

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
  select pg_temp.as_user('b4400001-0000-4000-8000-000000000001') $fn$;
create or replace function pg_temp.as_anna()   returns void language sql as $fn$
  select pg_temp.as_user('b4400002-0000-4000-8000-000000000002') $fn$;
create or replace function pg_temp.as_hector() returns void language sql as $fn$
  select pg_temp.as_user('b4400004-0000-4000-8000-000000000004') $fn$;
create or replace function pg_temp.as_oleg()   returns void language sql as $fn$
  select pg_temp.as_user('b4400009-0000-4000-8000-000000000009') $fn$;
-- The system: a write with no user, as the generator and the nightly sweep make.
create or replace function pg_temp.as_system() returns void language sql as $fn$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '{}', true)
$fn$;

create or replace function pg_temp.anna() returns uuid language sql immutable as $fn$
  select 'b4400002-0000-4000-8000-000000000002'::uuid $fn$;
create or replace function pg_temp.petra() returns uuid language sql immutable as $fn$
  select 'b4400003-0000-4000-8000-000000000003'::uuid $fn$;
create or replace function pg_temp.tid(n integer) returns uuid language sql immutable as $fn$
  select ('b4404001-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $fn$;
create or replace function pg_temp.today() returns date language sql stable as $fn$
  select (now() at time zone 'Europe/Prague')::date $fn$;

-- The events of one task, as "kind Actor" in order, read as postgres.
create or replace function pg_temp.history(n integer) returns text[] language sql as $fn$
  select coalesce(array_agg(e.kind::text || ' ' || coalesce(pr.full_name, '(system)')
                            order by e.at, e.id), '{}')
  from public.task_events e
  left join public.profiles pr on pr.id = e.actor_id
  where e.task_id = pg_temp.tid(n) $fn$;
create or replace function pg_temp.last_event(n integer) returns public.task_events
language sql as $fn$
  select e.* from public.task_events e
  where e.task_id = pg_temp.tid(n) order by e.at desc, e.id desc limit 1 $fn$;
-- The events of this suite's company: the same number whoever counts (RLS),
-- whatever else the stand holds.
create or replace function pg_temp.event_count() returns integer language sql as $fn$
  select count(*)::int from public.task_events
  where host_id = 'b4400000-0000-4000-8000-00000000000a' $fn$;

-- ---------------------------------------------------------------------------
--  The table: append-only, read by the manager, written by nobody
-- ---------------------------------------------------------------------------

select pg_temp.check('a client may only read the journal',
  array[has_table_privilege('authenticated', 'public.task_events', 'SELECT'),
        has_table_privilege('authenticated', 'public.task_events', 'INSERT'),
        has_table_privilege('authenticated', 'public.task_events', 'UPDATE'),
        has_table_privilege('authenticated', 'public.task_events', 'DELETE'),
        has_table_privilege('authenticated', 'public.task_events', 'TRUNCATE'),
        has_table_privilege('anon', 'public.task_events', 'SELECT')],
  array[true, false, false, false, false, false]);

select pg_temp.check('the history of a task reads by (task_id, at)',
  (select count(*)::int from pg_indexes
   where schemaname = 'public' and tablename = 'task_events'
     and indexdef like '%(task_id, at%'),
  1);

select pg_temp.check('row level security is on',
  (select relrowsecurity from pg_class where oid = 'public.task_events'::regclass), true);

-- ---------------------------------------------------------------------------
--  The maid's flow: created, claimed, accepted, started, completed
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date)
values (pg_temp.tid(1), 'b4400000-0000-4000-8000-00000000000a', 900044001,
        'cleaning', 'unassigned', pg_temp.today());
reset role;
select pg_temp.check('a cleaning the manager makes: created',
  pg_temp.history(1), array['created Boss']);
select pg_temp.check('created says where it came from, its day and status',
  (select params from pg_temp.last_event(1)),
  jsonb_build_object('source', 'manual', 'date', pg_temp.today(), 'status', 'unassigned'));

-- Anna takes it from the queue, as the phone does: herself and accepted, at once.
select pg_temp.as_anna();
update public.tasks set assignee_id = pg_temp.anna(), status = 'accepted'
where id = pg_temp.tid(1) and status = 'unassigned';
reset role;
select pg_temp.check('taken from the queue: assigned, then accepted, both hers',
  pg_temp.history(1), array['created Boss', 'assigned Anna', 'accepted Anna']);
select pg_temp.check('the assignment names the person',
  (select params from public.task_events where task_id = pg_temp.tid(1) and kind = 'assigned'),
  jsonb_build_object('to', pg_temp.anna()));

select pg_temp.as_anna();
update public.tasks set status = 'in_progress' where id = pg_temp.tid(1);
update public.tasks set status = 'done' where id = pg_temp.tid(1);
reset role;
select pg_temp.check('started and completed by her',
  pg_temp.history(1),
  array['created Boss', 'assigned Anna', 'accepted Anna', 'started Anna', 'completed Anna']);
select pg_temp.check('the flow itself is not altered: done, with its times',
  (select array[status::text, (started_at is not null)::text, (completed_at is not null)::text,
                (completed_by = pg_temp.anna())::text]
   from public.tasks where id = pg_temp.tid(1)),
  array['done', 'true', 'true', 'true']);

-- ---------------------------------------------------------------------------
--  A write that changes nothing writes nothing
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();
create temp table counted as select pg_temp.event_count() as n;
update public.tasks set status = 'done' where id = pg_temp.tid(1);
update public.tasks set assignee_id = assignee_id, scheduled_date = scheduled_date
where id = pg_temp.tid(1);
update public.tasks set notes = 'a note' where id = pg_temp.tid(1);
reset role;
select pg_temp.check('a repeated or unrelated write adds no event',
  pg_temp.event_count(), (select n from counted));

-- ---------------------------------------------------------------------------
--  The office: given, changed, moved, taken away, cancelled, back
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id)
values (pg_temp.tid(2), 'b4400000-0000-4000-8000-00000000000a', 900044001,
        'cleaning', 'assigned', pg_temp.today(), pg_temp.petra());
update public.tasks set assignee_id = pg_temp.anna() where id = pg_temp.tid(2);
reset role;
select pg_temp.check('made with a person: created and assigned; then reassigned',
  pg_temp.history(2), array['created Boss', 'assigned Boss', 'reassigned Boss']);
select pg_temp.check('the reassignment says from whom to whom',
  (select params from pg_temp.last_event(2)),
  jsonb_build_object('from', pg_temp.petra(), 'to', pg_temp.anna()));

select pg_temp.as_boss();
update public.tasks set scheduled_date = pg_temp.today() + 1 where id = pg_temp.tid(2);
reset role;
select pg_temp.check('another day: moved, by the manager',
  (select array[kind::text, cause] from pg_temp.last_event(2)), array['moved', 'manager']);
select pg_temp.check('the move says from which day to which',
  (select params from pg_temp.last_event(2)),
  jsonb_build_object('from_date', pg_temp.today(), 'to_date', pg_temp.today() + 1));

select pg_temp.as_boss();
update public.tasks set property_id = 900044002 where id = pg_temp.tid(2);
reset role;
select pg_temp.check('another place: moved too, from which to which',
  (select params from pg_temp.last_event(2)),
  jsonb_build_object('from_property', 900044001, 'to_property', 900044002));

select pg_temp.as_boss();
update public.tasks set assignee_id = null, status = 'unassigned' where id = pg_temp.tid(2);
reset role;
select pg_temp.check('the person taken away by the manager: unassigned, cause manager',
  (select array[kind::text, cause, params->>'from'] from pg_temp.last_event(2)),
  array['unassigned', 'manager', pg_temp.anna()::text]);

-- The panel cancels a live task with a plain update (lib/cancel-live-task.ts).
select pg_temp.as_boss();
update public.tasks set status = 'cancelled' where id = pg_temp.tid(2);
reset role;
select pg_temp.check('cancelled from the panel: cause manager',
  (select array[kind::text, cause, params->>'from'] from pg_temp.last_event(2)),
  array['cancelled', 'manager', 'unassigned']);

select pg_temp.as_boss();
update public.tasks set status = 'unassigned' where id = pg_temp.tid(2);
reset role;
select pg_temp.check('back on the board: reopened, from cancelled',
  (select array[kind::text, params->>'from'] from pg_temp.last_event(2)),
  array['reopened', 'cancelled']);

-- ---------------------------------------------------------------------------
--  The system: the generator and the nightly sweep
-- ---------------------------------------------------------------------------

insert into public.reservations (id, host_id, property_id, arrival_date, departure_date, status)
values
  (900044101, 'b4400000-0000-4000-8000-00000000000a', 900044001,
   pg_temp.today() - 2, pg_temp.today() + 1, 'new'),
  (900044102, 'b4400000-0000-4000-8000-00000000000a', 900044002,
   pg_temp.today() - 2, pg_temp.today() + 1, 'modified');

select pg_temp.as_system();
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, reservation_id)
values
  (pg_temp.tid(3), 'b4400000-0000-4000-8000-00000000000a', 900044001,
   'cleaning', 'unassigned', pg_temp.today() + 1, 900044101),
  (pg_temp.tid(4), 'b4400000-0000-4000-8000-00000000000a', 900044002,
   'cleaning', 'unassigned', pg_temp.today() + 1, 900044102);
reset role;
select pg_temp.check('a cleaning the generator makes: created by the system, from a booking',
  (select array[kind::text, coalesce(actor_id::text, '(system)'), params->>'source']
   from pg_temp.last_event(3)),
  array['created', '(system)', 'booking']);

update public.reservations set status = 'cancelled' where id = 900044101;
select pg_temp.as_system();
update public.tasks set status = 'cancelled' where id = pg_temp.tid(3);
update public.tasks set status = 'cancelled' where id = pg_temp.tid(4);
reset role;
select pg_temp.check('the generator cancels for a cancelled booking',
  (select array[kind::text, cause] from pg_temp.last_event(3)),
  array['cancelled', 'booking_cancelled']);
select pg_temp.check('and for a booking that changed under a live one',
  (select array[kind::text, cause] from pg_temp.last_event(4)),
  array['cancelled', 'booking_changed']);

-- A server function may name the cause itself.
select pg_temp.as_system();
select set_config('str_ops.task_cause', 'system', true);
update public.tasks set status = 'unassigned' where id = pg_temp.tid(4);
update public.tasks set status = 'cancelled' where id = pg_temp.tid(4);
select set_config('str_ops.task_cause', '', true);
reset role;
select pg_temp.check('a cause the server names wins',
  (select array[kind::text, cause] from pg_temp.last_event(4)), array['cancelled', 'system']);

-- The nightly sweep.
select pg_temp.as_boss();
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id)
values (pg_temp.tid(5), 'b4400000-0000-4000-8000-00000000000a', 900044001,
        'cleaning', 'assigned', pg_temp.today() - 3, pg_temp.anna());
reset role;
select pg_temp.as_system();
select public.expire_stale_tasks();
reset role;
select pg_temp.check('expired by the sweep, by the system, with the person it had',
  (select array[kind::text, coalesce(actor_id::text, '(system)'), params->>'assignee']
   from pg_temp.last_event(5)),
  array['expired', '(system)', pg_temp.anna()::text]);

-- ---------------------------------------------------------------------------
--  A person switched off: her waiting work is freed, and the journal says why
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id)
values (pg_temp.tid(6), 'b4400000-0000-4000-8000-00000000000a', 900044002,
        'cleaning', 'assigned', pg_temp.today(), pg_temp.petra());
update public.profiles set is_active = false where id = pg_temp.petra();
reset role;
select pg_temp.check('freed when she was switched off: unassigned, cause staff_inactive',
  (select array[kind::text, cause, params->>'from'] from pg_temp.last_event(6)),
  array['unassigned', 'staff_inactive', pg_temp.petra()::text]);

-- ---------------------------------------------------------------------------
--  Other kinds, and what stays out
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id)
values (pg_temp.tid(7), 'b4400000-0000-4000-8000-00000000000a', 900044001,
        'midstay', 'assigned', pg_temp.today(), pg_temp.anna());
reset role;
select pg_temp.check('a mid-stay cleaning is journaled too',
  pg_temp.history(7), array['created Boss', 'assigned Boss']);

-- A repair answers a reported problem: problem_events keeps its history.
insert into public.problems (id, host_id, reported_by, title, property_id)
values ('b4405001-0000-4000-8000-000000000001', 'b4400000-0000-4000-8000-00000000000a',
        pg_temp.anna(), 'Leak', 900044001);
select pg_temp.as_system();
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, problem_id)
values (pg_temp.tid(8), 'b4400000-0000-4000-8000-00000000000a', 900044001,
        'maintenance', 'unassigned', pg_temp.today(), 'b4405001-0000-4000-8000-000000000001');
update public.tasks set status = 'cancelled' where id = pg_temp.tid(8);
reset role;
select pg_temp.check('a repair of a problem writes nothing here',
  pg_temp.history(8), '{}'::text[]);

-- ---------------------------------------------------------------------------
--  A move undoes an acceptance; other moves of the status; causes
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id)
values (pg_temp.tid(9), 'b4400000-0000-4000-8000-00000000000a', 900044001,
        'cleaning', 'assigned', pg_temp.today(), pg_temp.anna());
reset role;
select pg_temp.as_anna();
update public.tasks set status = 'accepted' where id = pg_temp.tid(9);
reset role;
-- The generator follows the booking to another day: the acceptance is gone.
select pg_temp.as_system();
update public.tasks set scheduled_date = pg_temp.today() + 2, status = 'assigned'
where id = pg_temp.tid(9);
reset role;
select pg_temp.check('moved by the system, and the acceptance the move undid',
  (select array_agg(kind::text || coalesce(' ' || cause, '') || coalesce(' ' || (params->>'from'), '')
                    order by id)
   from public.task_events where task_id = pg_temp.tid(9) and kind in ('moved', 'status_changed')),
  array['moved system', 'status_changed accepted']);

select pg_temp.as_system();
update public.tasks set status = 'in_progress' where id = pg_temp.tid(9);
update public.tasks set status = 'paused' where id = pg_temp.tid(9);
reset role;
select pg_temp.check('any other move of the status: status_changed, from and to',
  (select params from pg_temp.last_event(9)),
  jsonb_build_object('from', 'in_progress', 'to', 'paused'));

insert into public.reservations (id, host_id, property_id, arrival_date, departure_date, status)
values (900044103, 'b4400000-0000-4000-8000-00000000000a', 900044002,
        pg_temp.today() + 1, pg_temp.today() + 3, 'new');
select pg_temp.as_system();
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, reservation_id)
values (pg_temp.tid(10), 'b4400000-0000-4000-8000-00000000000a', 900044002,
        'cleaning', 'unassigned', pg_temp.today() + 3, 900044103);
select set_config('str_ops.task_cause', 'account_disabled', true);
update public.tasks set status = 'cancelled' where id = pg_temp.tid(10);
select set_config('str_ops.task_cause', '', true);
reset role;
select pg_temp.check('a cause the journal does not know is ignored, and the write goes through',
  (select array[kind::text, cause] from pg_temp.last_event(10)),
  array['cancelled', 'booking_changed']);

update public.properties set status = 'maintenance' where id = 900044002;
select pg_temp.as_system();
update public.tasks set status = 'unassigned' where id = pg_temp.tid(10);
update public.tasks set status = 'cancelled' where id = pg_temp.tid(10);
reset role;
update public.properties set status = 'active' where id = 900044002;
select pg_temp.check('dropped by the system for a place that is not active',
  (select array[kind::text, cause] from pg_temp.last_event(10)),
  array['cancelled', 'property_unavailable']);

-- Another company's own journal.
select pg_temp.as_oleg();
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date)
values (pg_temp.tid(11), 'b4400000-0000-4000-8000-00000000000b', 900044009,
        'cleaning', 'unassigned', pg_temp.today());
reset role;
select pg_temp.check('another company has events of its own',
  (select count(*)::int from public.task_events
   where host_id = 'b4400000-0000-4000-8000-00000000000b'), 1);

-- ---------------------------------------------------------------------------
--  Who reads it
-- ---------------------------------------------------------------------------

create temp table all_h as
  select count(*)::int as n from public.task_events
  where host_id = 'b4400000-0000-4000-8000-00000000000a';
grant select on all_h to authenticated;

select pg_temp.as_boss();
select pg_temp.check('the manager reads every event of his company',
  (select count(*)::int from public.task_events), (select n from all_h));
select pg_temp.check('and nobody may write one by hand, not even he',
  pg_temp.failure($q$insert into public.task_events (host_id, task_id, kind)
                     values ('b4400000-0000-4000-8000-00000000000a', 'b4404001-0000-4000-8000-000000000001', 'created')$q$),
  '42501');
reset role;

select pg_temp.as_oleg();
select pg_temp.check('another company''s manager reads his own alone',
  (select array_agg(distinct host_id::text) from public.task_events),
  array['b4400000-0000-4000-8000-00000000000b']);
reset role;

select pg_temp.as_anna();
select pg_temp.check('the maid reads none of it',
  (select count(*)::int from public.task_events), 0);
reset role;

select pg_temp.as_hector();
select pg_temp.check('the head technician reads none of it',
  (select count(*)::int from public.task_events), 0);
reset role;

rollback;
