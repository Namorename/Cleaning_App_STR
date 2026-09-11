-- Taking a listing out of service, and putting it back.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: only a manager of the listing's own company may
-- change its state; a state that stops guests sweeps the cleanings nobody has
-- started yet, but only after the manager has been told how many and said so
-- again; work under way and work already finished are never touched; and the
-- same press twice changes nothing the second time.
--
-- Fixture ids live in the 9000017xx range.
begin;

insert into public.hosts (id, name) values
  ('b7000000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d7000003-0000-4000-8000-0000000000d3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.status@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('d7000001-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.status@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d7000009-0000-4000-8000-0000000000d9','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.b.status@test.local','x',now(),now(),
   '{"full_name":"Boss B"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'b7000000-0000-4000-8000-00000000000b'
where id = 'd7000009-0000-4000-8000-0000000000d9';

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900001701, 'Quiet flat',        'UTC', '15:00', '10:00'),
  (900001702, 'Flat with work on', 'UTC', '15:00', '10:00'),
  (900001703, 'Flat mid-clean',    'UTC', '15:00', '10:00'),
  (900001704, 'Flat with history', 'UTC', '15:00', '10:00');

insert into public.tasks (id, property_id, type, status, scheduled_date, assignee_id) values
  -- Two nobody has started: these are the ones a sweep takes.
  ('a7000001-0000-4000-8000-000000000001', 900001702, 'cleaning', 'unassigned', current_date, null),
  ('a7000001-0000-4000-8000-000000000002', 900001702, 'cleaning', 'assigned', current_date,
   'd7000001-0000-4000-8000-0000000000d1'),
  -- A maintenance job on the same flat: not a cleaning, not swept.
  ('a7000001-0000-4000-8000-000000000003', 900001702, 'maintenance', 'unassigned', current_date, null),
  -- Somebody is standing in this one.
  ('a7000001-0000-4000-8000-000000000004', 900001703, 'cleaning', 'in_progress', current_date,
   'd7000001-0000-4000-8000-0000000000d1');

-- measured_minutes is computed by the database from the two stamps, so the
-- ninety-five minutes are stated the way a real cleaning states them.
insert into public.tasks (id, property_id, type, status, scheduled_date, assignee_id,
                          started_at, completed_at) values
  ('a7000001-0000-4000-8000-000000000005', 900001704, 'cleaning', 'done', current_date - 3,
   'd7000001-0000-4000-8000-0000000000d1',
   now() - interval '3 days',
   now() - interval '3 days' + interval '95 minutes');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;

create or replace function pg_temp.as_boss() returns void language sql as $$
  select pg_temp.as_user('d7000003-0000-4000-8000-0000000000d3')
$$;
create or replace function pg_temp.as_maria() returns void language sql as $$
  select pg_temp.as_user('d7000001-0000-4000-8000-0000000000d1')
$$;
create or replace function pg_temp.as_boss_b() returns void language sql as $$
  select pg_temp.as_user('d7000009-0000-4000-8000-0000000000d9')
$$;

-- The i18n key a refusal carries, or 'no refusal' when the statement went through.
create or replace function pg_temp.refusal_hint(stmt text) returns text
language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  return 'no refusal';
exception when others then
  get stacked diagnostics v_hint = PG_EXCEPTION_HINT;
  return coalesce(v_hint, '(no hint)');
end $$;

-- The parameters that go with it — the number the confirmation shows.
create or replace function pg_temp.refusal_total(stmt text) returns integer
language plpgsql as $$
declare v_detail text;
begin
  execute stmt;
  return -1;
exception when others then
  get stacked diagnostics v_detail = PG_EXCEPTION_DETAIL;
  return (v_detail::jsonb ->> 'total')::integer;
end $$;

create or replace function pg_temp.status_of(p bigint) returns text language sql as $$
  select status::text from public.properties where id = p
$$;

create or replace function pg_temp.task_status(t uuid) returns text language sql as $$
  select status::text from public.tasks where id = t
$$;

-- ---------- who may do it at all ----------

select pg_temp.as_maria();

select pg_temp.check('a cleaner cannot take a listing out of service',
  pg_temp.refusal_hint($$select public.set_property_status(900001701, 'archived')$$),
  'serverErrors.managerOnly');

select pg_temp.as_boss_b();

select pg_temp.check('another company''s listing is simply not there',
  pg_temp.refusal_hint($$select public.set_property_status(900001701, 'archived')$$),
  'serverErrors.propertyNotFound');

-- ---------- a listing with nothing on its books ----------

select pg_temp.as_boss();

select pg_temp.check('a quiet listing is archived without a question',
  (select (public.set_property_status(900001701, 'archived')).status::text), 'archived');

select pg_temp.check('and comes back to work the same way',
  (select (public.set_property_status(900001701, 'active')).status::text), 'active');

-- ---------- a listing with cleanings on its books ----------

select pg_temp.check('the panel can ask how many cleanings are at stake',
  public.property_open_cleanings(900001702), 2);

select pg_temp.check('archiving is refused until the manager has been told',
  pg_temp.refusal_hint($$select public.set_property_status(900001702, 'archived')$$),
  'serverErrors.propertyHasOpenTasks');

select pg_temp.check('and the refusal carries the number she has to agree to',
  pg_temp.refusal_total($$select public.set_property_status(900001702, 'archived')$$), 2);

select pg_temp.check('the refusal changed nothing',
  pg_temp.status_of(900001702), 'active');
select pg_temp.check('least of all the cleanings',
  pg_temp.task_status('a7000001-0000-4000-8000-000000000001'), 'unassigned');

select pg_temp.check('with the answer given, the listing goes',
  (select (public.set_property_status(900001702, 'archived', true)).status::text), 'archived');

select pg_temp.check('the cleaning nobody had started is cancelled',
  pg_temp.task_status('a7000001-0000-4000-8000-000000000001'), 'cancelled');
select pg_temp.check('and so is the one that was handed to somebody',
  pg_temp.task_status('a7000001-0000-4000-8000-000000000002'), 'cancelled');
select pg_temp.check('a technician''s job is not a cleaning and stays',
  pg_temp.task_status('a7000001-0000-4000-8000-000000000003'), 'unassigned');
select pg_temp.check('nothing is left to sweep afterwards',
  public.property_open_cleanings(900001702), 0);

-- ---------- what is never touched ----------

select pg_temp.check('a cleaning under way belongs to whoever is in the flat',
  pg_temp.refusal_hint($$select public.set_property_status(900001703, 'maintenance')$$),
  'no refusal');
select pg_temp.check('it keeps running while the listing goes under repair',
  pg_temp.task_status('a7000001-0000-4000-8000-000000000004'), 'in_progress');

select pg_temp.check('archiving a listing does not rewrite what already happened',
  pg_temp.refusal_hint($$select public.set_property_status(900001704, 'archived', true)$$),
  'no refusal');
select pg_temp.check('the finished cleaning stays finished',
  pg_temp.task_status('a7000001-0000-4000-8000-000000000005'), 'done');
select pg_temp.check('and keeps the minutes that were measured',
  (select measured_minutes from public.tasks
   where id = 'a7000001-0000-4000-8000-000000000005'), 95);

-- ---------- the same press twice ----------

select pg_temp.check('saying it again is not a change',
  (select (public.set_property_status(900001702, 'archived')).status::text), 'archived');

-- ---------- back in service ----------
--
-- The cancelled cleanings are not resurrected: the bookings they came from are
-- still there, and the generator writes fresh ones on its next run.
select pg_temp.check('a listing returns to work',
  (select (public.set_property_status(900001702, 'active')).status::text), 'active');
select pg_temp.check('the cancelled cleaning stays cancelled, as history',
  pg_temp.task_status('a7000001-0000-4000-8000-000000000001'), 'cancelled');

rollback;
