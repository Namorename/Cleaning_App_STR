-- The day a task is to be done (20261126130000).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected (owner, 2026-11-26):
-- - the office (manager, admin, reception) plans a task's day when it makes the task, and changes
--   or clears it later, on any task of its company;
-- - a report from the field naming a day is refused; without one it is made as before — an older
--   phone's call (no day said) and API v1's call keep working;
-- - the day is from yesterday to a year ahead;
-- - the change writes nothing in the task's journal and sends nothing.
--
-- Fixture ids live under b0a3d…. Dates are from current_date.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

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
  return 'allowed';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return case when v_hint like 'serverErrors.%' then v_hint else sqlstate end;
end $$;

create or replace function pg_temp.host() returns uuid language sql immutable as $$
  select 'b0a3d000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.other_host() returns uuid language sql immutable as $$
  select 'b0a3d000-0000-4000-8000-00000000000b'::uuid $$;
create or replace function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('b0a3d0' || lpad(n::text, 2, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.boss()   returns uuid language sql immutable as $$ select pg_temp.uid(1) $$;
create or replace function pg_temp.ada()    returns uuid language sql immutable as $$ select pg_temp.uid(2) $$;
create or replace function pg_temp.rita()   returns uuid language sql immutable as $$ select pg_temp.uid(3) $$;
create or replace function pg_temp.anna()   returns uuid language sql immutable as $$ select pg_temp.uid(4) $$;
create or replace function pg_temp.tom()    returns uuid language sql immutable as $$ select pg_temp.uid(5) $$;
create or replace function pg_temp.hector() returns uuid language sql immutable as $$ select pg_temp.uid(6) $$;
create or replace function pg_temp.olga()   returns uuid language sql immutable as $$ select pg_temp.uid(7) $$;
create or replace function pg_temp.pid(n integer) returns uuid language sql immutable as $$
  select ('b0a3d100-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.as_user(person uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', '{"sub":"' || person || '","role":"authenticated"}', true) $$;
create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;

/** A report as a phone sends it, the day named or not, by the person given. */
create or replace function pg_temp.report(person uuid, n integer, due date) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_user(person);
  v := pg_temp.refusal(format(
    'select public.report_problem(p_id => %L, p_title => %L, p_description => null, p_priority => ''normal'', '
    'p_property_id => null, p_task_id => null, p_critical => false, p_category_id => null, p_due_on => %L)',
    pg_temp.pid(n), 'Task ' || n, due));
  perform pg_temp.as_server();
  return v;
end $$;

/** A change of the day by the person given. */
create or replace function pg_temp.plan(person uuid, n integer, due date) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_user(person);
  v := pg_temp.refusal(format('select public.set_problem_due_date(%L, %L)', pg_temp.pid(n), due));
  perform pg_temp.as_server();
  return v;
end $$;

create or replace function pg_temp.due(n integer) returns text language sql as $$
  select coalesce((p.due_on - current_date)::text, '-') from public.problems p where p.id = pg_temp.pid(n) $$;

-- ---------- fixtures ----------

insert into public.hosts (id, name) values
  (pg_temp.host(), 'Due company'), (pg_temp.other_host(), 'Due elsewhere');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
select pg_temp.uid(u.n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       lower(u.name) || '.due1126@test.local', 'x', now(), now(),
       jsonb_build_object('full_name', u.name), jsonb_build_object('role', u.role)
from (values (1, 'Boss', 'manager'), (2, 'Ada', 'admin'), (3, 'Rita', 'reception'),
             (4, 'Anna', 'cleaner'), (5, 'Tom', 'tech'), (6, 'Hector', 'head_tech'),
             (7, 'Olga', 'manager')) u(n, name, role);
update public.profiles
set host_id = case when id = pg_temp.olga() then pg_temp.other_host() else pg_temp.host() end
where id in (select pg_temp.uid(n) from generate_series(1, 7) n);

-- ===========================================================================
-- 1. The day at the making of a task
-- ===========================================================================

select pg_temp.check('1.1 a manager makes a task planned a week ahead',
  pg_temp.report(pg_temp.boss(), 1, current_date + 7) || ' ' || pg_temp.due(1), 'allowed 7');

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('1.2 an older phone''s call says no day: the task is made, not planned',
  (select coalesce(p.due_on::text, '-') from public.report_problem(
     p_id => pg_temp.pid(2), p_title => 'Old phone', p_description => null, p_priority => 'normal',
     p_property_id => null, p_task_id => null, p_critical => false, p_category_id => null) p),
  '-');
select pg_temp.check('1.3 a repeat answers the task as it stands, whatever day it names',
  (select p.due_on from public.report_problem(p_id => pg_temp.pid(1), p_title => 'Task 1',
                                               p_due_on => current_date + 20) p),
  current_date + 7);
select pg_temp.as_server();

select pg_temp.check('1.4 the day is from yesterday to a year ahead',
  array[pg_temp.report(pg_temp.boss(), 3, current_date - 2), pg_temp.report(pg_temp.boss(), 3, current_date + 367),
        pg_temp.report(pg_temp.boss(), 4, current_date - 1), pg_temp.report(pg_temp.boss(), 5, current_date + 366)],
  array['serverErrors.problemDueInvalid', 'serverErrors.problemDueInvalid', 'allowed', 'allowed']);
select pg_temp.check('1.5 reception plans one too, and an admin',
  array[pg_temp.report(pg_temp.rita(), 6, current_date + 1), pg_temp.report(pg_temp.ada(), 7, current_date)],
  array['allowed', 'allowed']);
select pg_temp.check('1.6 a cleaner''s report naming a day is refused, without one it is made',
  array[pg_temp.report(pg_temp.anna(), 8, current_date + 1), pg_temp.report(pg_temp.anna(), 8, null)],
  array['serverErrors.problemDueOfficeOnly', 'allowed']);
select pg_temp.check('1.7 a technician''s and a head technician''s too',
  array[pg_temp.report(pg_temp.tom(), 9, current_date + 1), pg_temp.report(pg_temp.hector(), 10, current_date + 1)],
  array['serverErrors.problemDueOfficeOnly', 'serverErrors.problemDueOfficeOnly']);
select pg_temp.check('1.8 the days as made',
  (select string_agg(right(p.id::text, 2) || ':' || coalesce((p.due_on - current_date)::text, '-'), ',' order by p.id)
   from public.problems p where p.host_id = pg_temp.host()),
  '01:7,02:-,04:-1,05:366,06:1,07:0,08:-');

-- ===========================================================================
-- 2. Changing it on a task
-- ===========================================================================

select pg_temp.check('2.1 a manager plans a cleaner''s report',
  pg_temp.plan(pg_temp.boss(), 8, current_date + 3) || ' ' || pg_temp.due(8), 'allowed 3');
create temp table touched as select updated_at from public.problems where id = pg_temp.pid(8);
select pg_temp.check('2.2 the same day again changes nothing',
  pg_temp.plan(pg_temp.boss(), 8, current_date + 3) || ' ' ||
  ((select updated_at from public.problems where id = pg_temp.pid(8)) = (select updated_at from touched))::text,
  'allowed true');
select pg_temp.check('2.3 clears it',
  pg_temp.plan(pg_temp.boss(), 1, null) || ' ' || pg_temp.due(1), 'allowed -');
select pg_temp.check('2.4 the day is checked',
  pg_temp.plan(pg_temp.boss(), 1, current_date + 400), 'serverErrors.problemDueInvalid');
select pg_temp.check('2.5 reception and an admin change it',
  pg_temp.plan(pg_temp.rita(), 1, current_date + 2) || ' ' || pg_temp.plan(pg_temp.ada(), 2, current_date + 4)
  || ' ' || pg_temp.due(1) || ' ' || pg_temp.due(2),
  'allowed allowed 2 4');
select pg_temp.check('2.6 the field and another company change nothing',
  array[pg_temp.plan(pg_temp.anna(), 8, null), pg_temp.plan(pg_temp.tom(), 8, null),
        pg_temp.plan(pg_temp.hector(), 8, null), pg_temp.plan(pg_temp.olga(), 8, null), pg_temp.due(8)],
  array['serverErrors.managerOnly', 'serverErrors.managerOnly', 'serverErrors.managerOnly',
        'serverErrors.problemNotFound', '3']);
select pg_temp.check('2.7 the change writes nothing in the journal and sends nothing',
  (select count(*) from public.problem_events e where e.problem_id = pg_temp.pid(8))::text || ' ' ||
  (select count(*) from raw.push_outbox o where o.host_id = pg_temp.host() and o.params ? 'due_on')::text,
  '1 0');

-- ===========================================================================
-- 3. One function, the rights
-- ===========================================================================

select pg_temp.check('3.1 one report_problem: an older caller''s named call and API v1''s positional one resolve',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'report_problem'),
  1::bigint);
select pg_temp.check('3.2 anon calls neither, the check is nobody''s',
  array[has_function_privilege('anon', 'public.set_problem_due_date(uuid, date)', 'execute'),
        has_function_privilege('anon', 'public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean, uuid, date)', 'execute'),
        has_function_privilege('authenticated', 'public.problem_due_check(date)', 'execute'),
        has_function_privilege('authenticated', 'public.set_problem_due_date(uuid, date)', 'execute')],
  array[false, false, false, true]);

rollback;
