-- Who did a task's work and who closed it (20261106125000).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- Every path that closes a task stamps it: the worker finishing on the phone, a manager closing
-- for a person named or alone, a caller from before that choice, cancelling, archiving, the
-- system. Opening it again wipes the stamp. Closing for someone sends no push, and analytics keeps
-- such a repair out of the worker's times.
--
-- Fixture ids live in the 900097xxx / f97... ranges.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values ('f9700000-0000-4000-8000-00000000000b', 'Other company');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('f9700001-0000-4000-8000-0000000000e1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rep.closing@test.local','x',now(),now(),
   '{"full_name":"Reporter"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('f9700002-0000-4000-8000-0000000000e2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tech1.closing@test.local','x',now(),now(),
   '{"full_name":"Tech One"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('f9700003-0000-4000-8000-0000000000e3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tech2.closing@test.local','x',now(),now(),
   '{"full_name":"Tech Two"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('f9700004-0000-4000-8000-0000000000e4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.closing@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('f9700005-0000-4000-8000-0000000000e5','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gone.closing@test.local','x',now(),now(),
   '{"full_name":"Gone Tech"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('f9700006-0000-4000-8000-0000000000e6','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','far.closing@test.local','x',now(),now(),
   '{"full_name":"Far Tech"}'::jsonb, '{"role":"tech"}'::jsonb);

update public.profiles set host_id = 'f9700000-0000-4000-8000-00000000000b'
where id = 'f9700006-0000-4000-8000-0000000000e6';
update public.profiles set is_active = false where id = 'f9700005-0000-4000-8000-0000000000e5';

-- UTC listings, so that current_date is the listing's own date at any hour.
insert into public.properties (id, name, timezone, check_in_time, check_out_time)
select 900097000 + n, 'Closing flat ' || n, 'UTC', '15:00', '10:00'
from generate_series(1, 12) n;

insert into public.property_cleaners (property_id, cleaner_id, mode)
select 900097000 + n, 'f9700001-0000-4000-8000-0000000000e1', 'claim'
from generate_series(1, 12) n;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create function pg_temp.as_user(sub uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;
create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true)
$$;
create function pg_temp.rep()   returns uuid language sql immutable as $$ select 'f9700001-0000-4000-8000-0000000000e1'::uuid $$;
create function pg_temp.tech1() returns uuid language sql immutable as $$ select 'f9700002-0000-4000-8000-0000000000e2'::uuid $$;
create function pg_temp.tech2() returns uuid language sql immutable as $$ select 'f9700003-0000-4000-8000-0000000000e3'::uuid $$;
create function pg_temp.boss()  returns uuid language sql immutable as $$ select 'f9700004-0000-4000-8000-0000000000e4'::uuid $$;
create function pg_temp.gone()  returns uuid language sql immutable as $$ select 'f9700005-0000-4000-8000-0000000000e5'::uuid $$;
create function pg_temp.far()   returns uuid language sql immutable as $$ select 'f9700006-0000-4000-8000-0000000000e6'::uuid $$;

create function pg_temp.pid(n integer) returns uuid language sql immutable as $$
  select ('f9710000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

create function pg_temp.who(person uuid) returns text language sql immutable as $$
  select case person
    when pg_temp.tech1() then 'tech1' when pg_temp.tech2() then 'tech2'
    when pg_temp.boss() then 'boss' when pg_temp.gone() then 'gone'
    when null then '-' else coalesce(person::text, '-') end $$;

-- "how completed_by closed_by" of task n.
create function pg_temp.closing(n integer) returns text language sql as $$
  select coalesce(p.closed_how, '-') || ' ' || pg_temp.who(p.completed_by) || ' '
         || pg_temp.who(p.closed_by) || ' ' || (p.closed_at is not null)::text
  from public.problems p where p.id = pg_temp.pid(n) $$;

create function pg_temp.try(statement text) returns text language plpgsql as $$
declare
  v_hint text;
begin
  execute statement;
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(v_hint, sqlerrm);
end $$;

create function pg_temp.report(n integer) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(pg_temp.rep());
  perform public.report_problem(pg_temp.pid(n), 'Closing ' || n, 'desc ' || n, 'normal',
                                900097000 + n);
  perform pg_temp.as_postgres();
end $$;

create function pg_temp.assign(n integer, tech uuid) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(pg_temp.boss());
  perform public.assign_problem(pg_temp.pid(n), tech, current_date);
  perform pg_temp.as_postgres();
end $$;

create function pg_temp.pushes(person uuid) returns integer language sql as $$
  select count(*)::integer from raw.push_outbox o where o.recipient_id = person $$;

-- ---------------------------------------------------------------------------
--  The worker finishes on the phone
-- ---------------------------------------------------------------------------

select pg_temp.report(1);
select pg_temp.assign(1, pg_temp.tech1());
select pg_temp.as_user(pg_temp.tech1());
update public.tasks set status = 'in_progress' where problem_id = pg_temp.pid(1);
-- The steps are copied at the start; the test does them for her.
select pg_temp.as_postgres();
update public.task_steps s set completed_at = now()
from public.tasks t where t.id = s.task_id and t.problem_id = pg_temp.pid(1);
select pg_temp.as_user(pg_temp.tech1());
update public.tasks set status = 'done' where problem_id = pg_temp.pid(1);
select pg_temp.as_postgres();

select pg_temp.check('a worker finishing her repair closes the task as hers',
  pg_temp.closing(1), 'worker tech1 tech1 true');
select pg_temp.as_user(pg_temp.tech1());
select pg_temp.check('and she reads her own name on it',
  (select public.closing_people(p) #>> '{completed_by,name}' from public.problems p
   where p.id = pg_temp.pid(1)),
  'Tech One');
select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
--  A manager closes for a person named
-- ---------------------------------------------------------------------------

select pg_temp.report(2);
select pg_temp.assign(2, pg_temp.tech1());
select pg_temp.pushes(pg_temp.tech1()) as pushes_before \gset
select pg_temp.as_user(pg_temp.boss());
select public.resolve_problem(pg_temp.pid(2), p_completed_by => pg_temp.tech2());
select pg_temp.as_postgres();

select pg_temp.check('closed for a person named: she did it, the manager closed it',
  pg_temp.closing(2), 'manager_for tech2 boss true');
select pg_temp.check('the attempt is finished in her name',
  (select t.status::text || ' ' || pg_temp.who(t.completed_by) from public.tasks t
   where t.problem_id = pg_temp.pid(2)),
  'done tech2');
select pg_temp.check('nobody holding the attempt hears of it',
  pg_temp.pushes(pg_temp.tech1()), :pushes_before);
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('the names come with the task',
  (select (public.closing_people(p) #>> '{completed_by,name}') || ' / '
          || (public.closing_people(p) #>> '{closed_by,name}') || ' '
          || (public.closing_people(p) #>> '{closed_by,role}')
   from public.problems p where p.id = pg_temp.pid(2)),
  'Tech Two / Boss manager');
select pg_temp.as_postgres();

-- With no attempt at all, the person is still named.
select pg_temp.report(5);
select pg_temp.as_user(pg_temp.boss());
select public.resolve_problem(pg_temp.pid(5), p_completed_by => pg_temp.tech1());
select pg_temp.as_postgres();
select pg_temp.check('a task never handed out can be closed for a person',
  pg_temp.closing(5), 'manager_for tech1 boss true');

-- A person who has left can be named.
select pg_temp.report(7);
select pg_temp.as_user(pg_temp.boss());
select public.resolve_problem(pg_temp.pid(7), p_completed_by => pg_temp.gone());
select pg_temp.as_postgres();
select pg_temp.check('a worker switched off can be named',
  pg_temp.closing(7), 'manager_for gone boss true');

-- ---------------------------------------------------------------------------
--  Refusals
-- ---------------------------------------------------------------------------

select pg_temp.report(6);
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('a person and «alone» at once are refused',
  pg_temp.try(format('select public.resolve_problem(%L, %L, true)', pg_temp.pid(6), pg_temp.tech1())),
  'serverErrors.problemCompleterInvalid');
select pg_temp.check('a person of another company is refused',
  pg_temp.try(format('select public.resolve_problem(%L, %L)', pg_temp.pid(6), pg_temp.far())),
  'serverErrors.problemCompleterInvalid');
select pg_temp.check('a manager is not a worker to name',
  pg_temp.try(format('select public.resolve_problem(%L, %L)', pg_temp.pid(6), pg_temp.boss())),
  'serverErrors.problemCompleterInvalid');
select pg_temp.check('an id of nobody is refused',
  pg_temp.try(format('select public.resolve_problem(%L, %L)', pg_temp.pid(6), pg_temp.pid(99))),
  'serverErrors.problemCompleterInvalid');
select pg_temp.as_postgres();
select pg_temp.check('a refusal leaves the task open',
  (select status::text || ' ' || coalesce(closed_how, '-') from public.problems where id = pg_temp.pid(6)),
  'open -');

select pg_temp.as_user(pg_temp.tech1());
select pg_temp.check('a technician cannot close for anyone',
  pg_temp.try(format('select public.resolve_problem(%L, %L)', pg_temp.pid(6), pg_temp.tech1())),
  'serverErrors.managerOnly');
select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
--  Alone, and the caller from before the choice
-- ---------------------------------------------------------------------------

select pg_temp.report(3);
select pg_temp.assign(3, pg_temp.tech1());
select pg_temp.as_user(pg_temp.boss());
select public.resolve_problem(pg_temp.pid(3), p_alone => true);
select pg_temp.as_postgres();
select pg_temp.check('closed alone: nobody did it, the manager closed it',
  pg_temp.closing(3), 'manager_self - boss true');
select pg_temp.check('no push for that either',
  pg_temp.pushes(pg_temp.tech1()), :pushes_before);

select pg_temp.report(4);
select pg_temp.assign(4, pg_temp.tech1());
select pg_temp.as_user(pg_temp.boss());
select public.resolve_problem(pg_temp.pid(4));
select pg_temp.as_postgres();
select pg_temp.check('the panel of yesterday closes with the worker not stated',
  pg_temp.closing(4), 'manager - boss true');
select pg_temp.check('and finishes the attempt as it always did',
  (select pg_temp.who(t.completed_by) from public.tasks t where t.problem_id = pg_temp.pid(4)),
  'boss');
select pg_temp.check('the choice does not outlive its call',
  current_setting('str_ops.problem_closing', true), '');

-- ---------------------------------------------------------------------------
--  Cancelling, archiving, opening again
-- ---------------------------------------------------------------------------

select pg_temp.report(8);
select pg_temp.assign(8, pg_temp.tech1());
select pg_temp.as_user(pg_temp.boss());
select public.cancel_problem(pg_temp.pid(8), 'not needed');
select pg_temp.as_postgres();
select pg_temp.check('a cancelled task says who cancelled it, and no worker',
  pg_temp.closing(8), 'manager - boss true');

select pg_temp.report(9);
select pg_temp.as_user(pg_temp.boss());
select public.archive_problem(pg_temp.pid(9));
select pg_temp.as_postgres();
select pg_temp.check('an open task put in the archive is closed by whoever put it there',
  pg_temp.closing(9), 'manager - boss true');
select pg_temp.as_user(pg_temp.boss());
select public.unarchive_problem(pg_temp.pid(9));
select pg_temp.as_postgres();
select pg_temp.check('taken out of the archive, it is open and says nothing',
  pg_temp.closing(9), '- - - false');

select pg_temp.as_user(pg_temp.boss());
select public.archive_problem(pg_temp.pid(1));
select pg_temp.as_postgres();
select pg_temp.check('a resolved task in the archive keeps who resolved it',
  pg_temp.closing(1), 'worker tech1 tech1 true');

select pg_temp.as_user(pg_temp.boss());
select public.reopen_problem(pg_temp.pid(3));
select pg_temp.as_postgres();
select pg_temp.check('reopened, the stamp goes',
  pg_temp.closing(3), '- - - false');

-- ---------------------------------------------------------------------------
--  The system
-- ---------------------------------------------------------------------------

select pg_temp.report(10);
select pg_temp.assign(10, pg_temp.tech1());
select set_config('str_ops.closing_cause', 'night_pass', true);
update public.tasks set status = 'done', completed_at = now() where problem_id = pg_temp.pid(10);
select set_config('str_ops.closing_cause', '', true);
select pg_temp.check('a write with no user closes it automatically',
  pg_temp.closing(10), 'auto - - true');
select pg_temp.check('with the cause the path gave',
  (select closed_cause from public.problems where id = pg_temp.pid(10)), 'night_pass');

-- ---------------------------------------------------------------------------
--  A round before a reopening names nobody
-- ---------------------------------------------------------------------------

select pg_temp.report(12);
select pg_temp.assign(12, pg_temp.tech1());
select pg_temp.as_user(pg_temp.tech1());
update public.tasks set status = 'in_progress' where problem_id = pg_temp.pid(12);
select pg_temp.as_postgres();
update public.task_steps s set completed_at = now()
from public.tasks t where t.id = s.task_id and t.problem_id = pg_temp.pid(12);
select pg_temp.as_user(pg_temp.tech1());
update public.tasks set status = 'done' where problem_id = pg_temp.pid(12);
-- The suite is one transaction with one now(): her round is moved an hour back.
select pg_temp.as_postgres();
update public.tasks set completed_at = now() - interval '1 hour' where problem_id = pg_temp.pid(12);
select pg_temp.as_user(pg_temp.boss());
select public.reopen_problem(pg_temp.pid(12));
select public.resolve_problem(pg_temp.pid(12));
select pg_temp.as_postgres();
select pg_temp.check('closed again with nothing done, her earlier round is not this closing',
  pg_temp.closing(12), 'manager - boss true');

-- ---------------------------------------------------------------------------
--  The names, called with somebody else's task
-- ---------------------------------------------------------------------------

-- Tech Two holds none of task 2 and reported none of it: the names are not hers to read, even
-- through a direct call (the role postgres stands in for PostgREST handing her the row).
select set_config('request.jwt.claims',
  '{"sub":"' || pg_temp.tech2() || '","role":"authenticated"}', true);
select pg_temp.check('a direct call with a task not hers gives no names',
  (select public.closing_people(p) from public.problems p where p.id = pg_temp.pid(2)), null::jsonb);
select set_config('request.jwt.claims',
  '{"sub":"' || pg_temp.tech1() || '","role":"authenticated"}', true);
select pg_temp.check('the one who held it reads them',
  (select public.closing_people(p) #>> '{closed_by,name}' from public.problems p
   where p.id = pg_temp.pid(2)), 'Boss');
select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
--  Analytics: the worker's times are not the manager's click
-- ---------------------------------------------------------------------------

-- measured_minutes is generated from the start and the finish.
update public.tasks set started_at = now() - interval '40 minutes'
where problem_id in (pg_temp.pid(1), pg_temp.pid(2));

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('a repair closed for her counts as hers, without its times',
  (select repairs_done::text || ' ' || coalesce(work_minutes_avg::text, 'null') || ' '
          || coalesce(hours_to_resolve_avg::text, 'null')
   from public.analytics_problems_by_technician(current_date, current_date,
                                                p_include_test => true)
   where person_id = pg_temp.tech2()),
  '1 null null');
-- Hers: the finish of 1, her round of 12 before it was reopened, and 10 that the system
-- finished while she held it (as before).
select pg_temp.check('her own finish keeps its times',
  (select repairs_done::text || ' ' || (work_minutes_avg is not null)::text || ' '
          || (hours_to_resolve_avg is not null)::text
   from public.analytics_problems_by_technician(current_date, current_date,
                                                p_include_test => true)
   where person_id = pg_temp.tech1()),
  '3 true true');
create function pg_temp.done_by(person uuid) returns integer language sql as $$
  select coalesce((select repairs_done from public.analytics_problems_by_technician(
                     current_date, current_date, p_include_test => true)
                   where person_id = person), 0) $$;
select pg_temp.done_by(pg_temp.boss()) as boss_before \gset
select pg_temp.done_by(pg_temp.tech1()) as tech1_before \gset
select pg_temp.as_postgres();
select pg_temp.report(11);
select pg_temp.assign(11, pg_temp.tech1());
select pg_temp.as_user(pg_temp.boss());
select public.resolve_problem(pg_temp.pid(11), p_alone => true);
select pg_temp.check('a repair closed alone is nobody''s: not the manager''s',
  pg_temp.done_by(pg_temp.boss()), :boss_before);
select pg_temp.check('nor the one who held it',
  pg_temp.done_by(pg_temp.tech1()), :tech1_before);
select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
--  The public API's task
-- ---------------------------------------------------------------------------

select pg_temp.check('the API names the people only with staff:read_names',
  (select (j -> 'completed_by' ->> 'role') || ' ' || (j -> 'completed_by' ? 'full_name')::text
          || ' ' || (j ->> 'closed_how')
   from public.problems p
   cross join lateral (select public.api_task_json(p) as j) x
   where p.id = pg_temp.pid(2))
  || ' / ' ||
  (select (j #>> '{completed_by,full_name}') || ' ' || (j #>> '{closed_by,role}')
   from public.problems p
   cross join lateral (select public.api_task_json(p, '{staff:read_names}') as j) x
   where p.id = pg_temp.pid(2)),
  'tech false manager_for / Tech Two manager');
select pg_temp.check('an open task has no people and no closing',
  (select (j -> 'completed_by')::text || ' ' || (j -> 'closed_by')::text || ' '
          || (j -> 'closed_how')::text || ' ' || (j -> 'closed_at')::text
   from public.problems p
   cross join lateral (select public.api_task_json(p, '{staff:read_names}') as j) x
   where p.id = pg_temp.pid(6)),
  'null null null null');
select pg_temp.check('the helpers stay the operations''',
  (select count(*)::integer from pg_proc p
   where p.proname in ('api_task_person_json', 'api_task_json')
     and p.pronamespace = 'public'::regnamespace
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute')
          or has_function_privilege('service_role', p.oid, 'execute'))),
  0);
select pg_temp.check('the names are not anon''s',
  has_function_privilege('anon', 'public.closing_people(public.problems)', 'execute'), false);

rollback;
