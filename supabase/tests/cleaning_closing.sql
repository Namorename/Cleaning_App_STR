-- Who did a cleaning and who closed it, and a worker named afterwards (20261106125500).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- Every path that closes a cleaning stamps task_closings: her own finish, a manager closing for
-- somebody or alone, a manager cancelling, the system cancelling or letting it lapse. Reopening
-- takes the stamp away. Closing for somebody and naming a worker afterwards send no push and
-- move no status, no date and no finisher analytics counts. Analytics keeps a cleaning a manager
-- closed out of the minutes and the photo share.
--
-- Fixture ids live in the 900098xxx / f98... ranges.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('f9800000-0000-4000-8000-00000000000a', 'Closing co'),
  ('f9800000-0000-4000-8000-00000000000b', 'Other co');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('f9800001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated',
   'authenticated','anna.cc@test.local','x',now(),now(),'{"full_name":"Anna"}','{"role":"cleaner"}'),
  ('f9800002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated',
   'authenticated','bella.cc@test.local','x',now(),now(),'{"full_name":"Bella"}','{"role":"cleaner"}'),
  ('f9800003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated',
   'authenticated','boss.cc@test.local','x',now(),now(),'{"full_name":"Boss"}','{"role":"manager"}'),
  ('f9800004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated',
   'authenticated','gone.cc@test.local','x',now(),now(),'{"full_name":"Gone"}','{"role":"cleaner"}'),
  ('f9800005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated',
   'authenticated','far.cc@test.local','x',now(),now(),'{"full_name":"Far"}','{"role":"cleaner"}'),
  ('f9800006-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated',
   'authenticated','tech.cc@test.local','x',now(),now(),'{"full_name":"Tech"}','{"role":"tech"}');

update public.profiles set host_id = 'f9800000-0000-4000-8000-00000000000a'
where id::text like 'f980000_-0000-4000-8000-00000000000_' and id <> 'f9800005-0000-4000-8000-000000000005';
update public.profiles set host_id = 'f9800000-0000-4000-8000-00000000000b'
where id = 'f9800005-0000-4000-8000-000000000005';
update public.profiles set is_active = false where id = 'f9800004-0000-4000-8000-000000000004';

-- UTC listings, so that current_date is the listing's own date at any hour.
insert into public.properties (id, host_id, name, timezone)
select 900098000 + n, 'f9800000-0000-4000-8000-00000000000a', 'Closing flat ' || n, 'UTC'
from generate_series(1, 12) n;

insert into public.property_cleaners (host_id, property_id, cleaner_id, mode)
select 'f9800000-0000-4000-8000-00000000000a', 900098000 + n, c.id, 'claim'
from generate_series(1, 12) n
cross join (values ('f9800001-0000-4000-8000-000000000001'::uuid),
                   ('f9800002-0000-4000-8000-000000000002'::uuid)) c(id);

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
         set_config('request.jwt.claims', '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;
create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true)
$$;
create function pg_temp.anna()  returns uuid language sql immutable as $$ select 'f9800001-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.bella() returns uuid language sql immutable as $$ select 'f9800002-0000-4000-8000-000000000002'::uuid $$;
create function pg_temp.boss()  returns uuid language sql immutable as $$ select 'f9800003-0000-4000-8000-000000000003'::uuid $$;
create function pg_temp.gone()  returns uuid language sql immutable as $$ select 'f9800004-0000-4000-8000-000000000004'::uuid $$;
create function pg_temp.far()   returns uuid language sql immutable as $$ select 'f9800005-0000-4000-8000-000000000005'::uuid $$;
create function pg_temp.tech()  returns uuid language sql immutable as $$ select 'f9800006-0000-4000-8000-000000000006'::uuid $$;

create function pg_temp.tid(n integer) returns uuid language sql immutable as $$
  select ('f9810000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

create function pg_temp.who(person uuid) returns text language sql immutable as $$
  select case person
    when pg_temp.anna() then 'anna' when pg_temp.bella() then 'bella'
    when pg_temp.boss() then 'boss' when pg_temp.gone() then 'gone' when pg_temp.tech() then 'tech'
    else coalesce(person::text, '-') end $$;

-- "how worker source closer cause closer_source" of cleaning n; '-' for no row.
create function pg_temp.closing(n integer) returns text language sql as $$
  select coalesce((select coalesce(c.closed_how, '-') || ' ' || pg_temp.who(c.completed_by) || ' '
                          || coalesce(c.worker_source, '-') || ' ' || pg_temp.who(c.closed_by) || ' '
                          || coalesce(c.closed_cause, '-') || ' ' || coalesce(c.closer_source, '-')
                   from public.task_closings c where c.task_id = pg_temp.tid(n)), 'none') $$;

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

create function pg_temp.pushes(person uuid) returns integer language sql as $$
  select count(*)::integer from raw.push_outbox o where o.recipient_id = person $$;

-- Cleaning n on flat n, today, given to a cleaner (or nobody).
create function pg_temp.cleaning(n integer, person uuid) returns void language sql as $$
  insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id)
  values (pg_temp.tid(n), 'f9800000-0000-4000-8000-00000000000a', 900098000 + n, 'cleaning',
          case when person is null then 'unassigned' else 'assigned' end::public.task_status,
          current_date, person) $$;

-- ---------------------------------------------------------------------------
--  Her own finish
-- ---------------------------------------------------------------------------

select pg_temp.cleaning(1, pg_temp.anna());
select pg_temp.as_user(pg_temp.anna());
update public.tasks set status = 'in_progress' where id = pg_temp.tid(1);
update public.tasks set status = 'done' where id = pg_temp.tid(1);
select pg_temp.as_postgres();
select pg_temp.check('her own finish: hers, recorded, closed by her',
  pg_temp.closing(1), 'worker anna recorded anna - recorded');

select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('she reads her own name on it',
  (select public.task_closing(t) #>> '{completed_by,name}' from public.tasks t where t.id = pg_temp.tid(1)),
  'Anna');
select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
--  A manager closes it, for somebody or alone
-- ---------------------------------------------------------------------------

select pg_temp.cleaning(2, pg_temp.anna());
select pg_temp.pushes(pg_temp.anna()) as anna_before \gset
select pg_temp.as_user(pg_temp.boss());
select public.complete_cleaning(pg_temp.tid(2), pg_temp.bella());
select pg_temp.as_postgres();
select pg_temp.check('closed for Bella: hers by the manager''s word, closed by him',
  pg_temp.closing(2), 'manager_for bella manager boss - recorded');
select pg_temp.check('the cleaning is finished in her name',
  (select t.status::text || ' ' || pg_temp.who(t.completed_by) from public.tasks t where t.id = pg_temp.tid(2)),
  'done bella');
select pg_temp.check('nobody holding it hears of it',
  pg_temp.pushes(pg_temp.anna()), :anna_before);

select pg_temp.cleaning(3, pg_temp.anna());
select pg_temp.as_user(pg_temp.boss());
select public.complete_cleaning(pg_temp.tid(3));
select pg_temp.as_postgres();
select pg_temp.check('closed alone: nobody did it, the manager closed it',
  pg_temp.closing(3), 'manager_self - - boss - recorded');
select pg_temp.check('no push for that either', pg_temp.pushes(pg_temp.anna()), :anna_before);
select pg_temp.check('the choice does not outlive its call',
  current_setting('str_ops.task_closing', true), '');

select pg_temp.cleaning(4, null);
select pg_temp.as_user(pg_temp.boss());
select public.complete_cleaning(pg_temp.tid(4), pg_temp.gone());
select pg_temp.as_postgres();
select pg_temp.check('a cleaner switched off can be named',
  pg_temp.closing(4), 'manager_for gone manager boss - recorded');

-- ---------------------------------------------------------------------------
--  Refusals
-- ---------------------------------------------------------------------------

select pg_temp.cleaning(5, pg_temp.anna());
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('a person of another company is refused',
  pg_temp.try(format('select public.complete_cleaning(%L, %L)', pg_temp.tid(5), pg_temp.far())),
  'serverErrors.cleaningWorkerInvalid');
select pg_temp.check('a manager is not a worker to name',
  pg_temp.try(format('select public.complete_cleaning(%L, %L)', pg_temp.tid(5), pg_temp.boss())),
  'serverErrors.cleaningWorkerInvalid');
select pg_temp.check('a closed cleaning is not closed again',
  pg_temp.try(format('select public.complete_cleaning(%L)', pg_temp.tid(1))),
  'serverErrors.taskClosed');
select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('a cleaner closes nothing for anybody',
  pg_temp.try(format('select public.complete_cleaning(%L, %L)', pg_temp.tid(5), pg_temp.anna())),
  'serverErrors.managerOnly');
select pg_temp.as_postgres();
select pg_temp.check('a refusal leaves it live and unstamped',
  (select t.status::text from public.tasks t where t.id = pg_temp.tid(5)) || ' ' || pg_temp.closing(5),
  'assigned none');

-- ---------------------------------------------------------------------------
--  Cancelled, lapsed, reopened
-- ---------------------------------------------------------------------------

select pg_temp.cleaning(6, pg_temp.anna());
select pg_temp.as_user(pg_temp.boss());
update public.tasks set status = 'cancelled' where id = pg_temp.tid(6);
select pg_temp.as_postgres();
select pg_temp.check('a manager''s cancel says who, and no worker',
  pg_temp.closing(6), 'manager - - boss - recorded');

-- The system cancels one with no booking: the journal says why, in the same write.
select pg_temp.cleaning(7, null);
update public.tasks set status = 'cancelled' where id = pg_temp.tid(7);
select pg_temp.check('the system''s cancel takes the journal''s cause',
  pg_temp.closing(7), 'auto - - - system recorded');

select pg_temp.cleaning(8, pg_temp.anna());
update public.tasks set status = 'expired' where id = pg_temp.tid(8);
select pg_temp.check('a lapse is the night''s',
  pg_temp.closing(8), 'auto - - - night_pass recorded');

select pg_temp.as_user(pg_temp.boss());
update public.tasks set status = 'unassigned', assignee_id = null where id = pg_temp.tid(6);
select pg_temp.as_postgres();
select pg_temp.check('reopened, the stamp goes', pg_temp.closing(6), 'none');

-- ---------------------------------------------------------------------------
--  Naming the worker afterwards
-- ---------------------------------------------------------------------------

-- A manager marked it done some other way: the worker not stated.
select pg_temp.cleaning(9, pg_temp.anna());
select pg_temp.as_user(pg_temp.boss());
update public.tasks set status = 'done' where id = pg_temp.tid(9);
select pg_temp.as_postgres();
select pg_temp.check('a manager''s own write names nobody',
  pg_temp.closing(9), 'manager - - boss - recorded');
select (select updated_at from public.tasks where id = pg_temp.tid(9)) as t9_updated \gset
select pg_temp.as_user(pg_temp.boss());
select public.name_cleaning_worker(pg_temp.tid(9), pg_temp.anna());
select pg_temp.as_postgres();
select pg_temp.check('a worker named afterwards is the manager''s word',
  pg_temp.closing(9), 'manager anna manager boss - recorded');
select pg_temp.check('and the journal says who named her',
  (select pg_temp.who(m.person_id) || ' by ' || pg_temp.who(m.marked_by) from public.closing_marks m
   where m.task_id = pg_temp.tid(9)), 'anna by boss');
select pg_temp.check('the cleaning itself does not move: status, finisher, dates',
  (select t.status::text || ' ' || pg_temp.who(t.completed_by) || ' ' || (t.updated_at = :'t9_updated')::text
   from public.tasks t where t.id = pg_temp.tid(9)), 'done boss true');
select pg_temp.check('nobody hears of it', pg_temp.pushes(pg_temp.anna()), :anna_before);

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('a worker already stated is not renamed',
  pg_temp.try(format('select public.name_cleaning_worker(%L, %L)', pg_temp.tid(9), pg_temp.bella())),
  'serverErrors.workerAlreadyNamed');
select pg_temp.check('closed alone, nobody else is named afterwards',
  pg_temp.try(format('select public.name_cleaning_worker(%L, %L)', pg_temp.tid(3), pg_temp.anna())),
  'serverErrors.workerNotNameable');
select pg_temp.check('a cancelled cleaning has no worker to name',
  pg_temp.try(format('select public.name_cleaning_worker(%L, %L)', pg_temp.tid(7), pg_temp.anna())),
  'serverErrors.workerNotNameable');
select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('a cleaner names nobody',
  pg_temp.try(format('select public.name_cleaning_worker(%L, %L)', pg_temp.tid(9), pg_temp.anna())),
  'serverErrors.managerOnly');
select pg_temp.as_postgres();

-- A task the old panel closed: the worker not stated, then named.
insert into public.problems (id, host_id, property_id, reported_by, title, status)
values ('f9820000-0000-4000-8000-000000000001', 'f9800000-0000-4000-8000-00000000000a', 900098009,
        pg_temp.anna(), 'Tap', 'open');
select pg_temp.as_user(pg_temp.boss());
select public.resolve_problem('f9820000-0000-4000-8000-000000000001');
select public.name_problem_worker('f9820000-0000-4000-8000-000000000001', pg_temp.tech());
select pg_temp.as_postgres();
select pg_temp.check('a task''s worker named afterwards: the manager''s word, the closing kept',
  (select p.status::text || ' ' || pg_temp.who(p.completed_by) || ' ' || p.completed_by_source || ' '
          || p.closed_how || ' ' || pg_temp.who(p.closed_by)
   from public.problems p where p.id = 'f9820000-0000-4000-8000-000000000001'),
  'resolved tech manager manager boss');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('and is not renamed',
  pg_temp.try($q$select public.name_problem_worker('f9820000-0000-4000-8000-000000000001', 'f9800001-0000-4000-8000-000000000001')$q$),
  'serverErrors.workerAlreadyNamed');
select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
--  The names, to whom the cleaning is her business
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"' || pg_temp.bella() || '","role":"authenticated"}', true);
select pg_temp.check('a direct call with a cleaning not hers gives nothing',
  (select public.task_closing(t) from public.tasks t where t.id = pg_temp.tid(1)), null::jsonb);
select pg_temp.check('the one it was finished for reads it',
  (select public.task_closing(t) #>> '{closed_by,name}' from public.tasks t where t.id = pg_temp.tid(2)),
  'Boss');
select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
--  Analytics: the cleaner's minutes and photos are not the manager's click
-- ---------------------------------------------------------------------------

-- measured_minutes is generated from the start and the finish.
update public.tasks set started_at = completed_at - interval '40 minutes'
where id in (pg_temp.tid(1), pg_temp.tid(2));

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('closed for Bella: hers in the count, out of the minutes and the photos',
  (select done::text || ' ' || coalesce(minutes_avg::text, 'null') || ' ' || coalesce(photo_share::text, 'null')
   from public.analytics_cleanings_by_cleaner(current_date, current_date, p_include_test => true)
   where person_id = pg_temp.bella()),
  '1 null null');
select pg_temp.check('her own finish keeps them',
  (select done::text || ' ' || (minutes_avg is not null)::text || ' ' || photo_share::text
   from public.analytics_cleanings_by_cleaner(current_date, current_date, p_include_test => true)
   where person_id = pg_temp.anna()),
  '1 true 0.0000');
-- 3, closed alone, is nobody's; 9, the manager's own write with nobody named, stays his as it
-- always was (a worker named afterwards does not move the counts).
select pg_temp.check('closed alone, it is nobody''s',
  (select done
   from public.analytics_cleanings_by_cleaner(current_date, current_date, p_include_test => true)
   where person_id = pg_temp.boss()),
  1);
select pg_temp.as_postgres();

-- ---------------------------------------------------------------------------
--  The public API's cleaning
-- ---------------------------------------------------------------------------

select pg_temp.check('the API names the people only with staff:read_names',
  (select (j #>> '{worker,role}') || ' ' || (j -> 'worker' ? 'full_name')::text || ' '
          || (j ->> 'worker_source') || ' ' || (j ->> 'closed_how')
   from public.tasks t cross join lateral (select public.api_cleaning_json(t) as j) x
   where t.id = pg_temp.tid(2))
  || ' / ' ||
  (select (j #>> '{worker,full_name}') || ' ' || (j #>> '{closed_by,full_name}')
   from public.tasks t cross join lateral (select public.api_cleaning_json(t, '{staff:read_names}') as j) x
   where t.id = pg_temp.tid(2)),
  'cleaner false manager manager_for / Bella Boss');
select pg_temp.check('a live cleaning has no closing',
  (select (j -> 'worker')::text || ' ' || (j -> 'closed_how')::text
   from public.tasks t cross join lateral (select public.api_cleaning_json(t) as j) x
   where t.id = pg_temp.tid(5)),
  'null null');
select pg_temp.check('the helpers stay the operations''',
  (select count(*)::integer from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('api_cleaning_json', 'api_cleaning_closing_json', 'closing_worker_check',
                       'stamp_task_closing')
     and (has_function_privilege('authenticated', p.oid, 'execute')
          or has_function_privilege('anon', p.oid, 'execute'))),
  0);
select pg_temp.check('nothing here is anon''s',
  (select count(*)::integer from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('complete_cleaning', 'name_cleaning_worker', 'name_problem_worker', 'task_closing')
     and has_function_privilege('anon', p.oid, 'execute')),
  0);

rollback;
