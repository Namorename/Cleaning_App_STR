-- The level above high, «Критическая» (20261115090000). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: a critical task reads priority 'high' to anyone who
-- knows three levels — a phone of an older build, the old panel, an API client,
-- the head technician's push — so none of them meets a value it cannot read;
-- the new readers see it apart (critical), rank it above high and count it on
-- its own; a caller that says nothing of it (p_critical null) files and edits a
-- task exactly as before.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('f1160000-0000-4000-8000-00000000000a', 'Critical company');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('f1160001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cleo.critical@test.local','x',now(),now(),
   '{"full_name":"Cleo"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('f1160002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','hugo.critical@test.local','x',now(),now(),
   '{"full_name":"Hugo"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('f1160003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','mila.critical@test.local','x',now(),now(),
   '{"full_name":"Mila"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('f1160004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','ada.critical@test.local','x',now(),now(),
   '{"full_name":"Ada"}'::jsonb, '{"role":"admin"}'::jsonb);

update public.profiles set host_id = 'f1160000-0000-4000-8000-00000000000a'
where id::text like 'f116000_-0000-4000-8000-00000000000_';

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900002201, 'f1160000-0000-4000-8000-00000000000a', 'Flooded flat', 'UTC', '15:00', '10:00');
insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900002201, 'f1160001-0000-4000-8000-000000000001', 'claim');

-- The head technician has a phone: a new task reaches him as problem_new.
insert into public.push_tokens (token, profile_id, host_id, platform)
values ('ExponentPushToken[critical-hugo]', 'f1160002-0000-4000-8000-000000000002',
        'f1160000-0000-4000-8000-00000000000a', 'android');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

-- The SQLSTATE a statement fails with, or 'ok'.
create or replace function pg_temp.sqlstate_of(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return 'ok';
exception when others then
  return sqlstate;
end $$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;
create or replace function pg_temp.as_cleo() returns void language sql as $$
  select pg_temp.as_user('f1160001-0000-4000-8000-000000000001') $$;
create or replace function pg_temp.as_mila() returns void language sql as $$
  select pg_temp.as_user('f1160003-0000-4000-8000-000000000003') $$;
create or replace function pg_temp.as_office() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;

create or replace function pg_temp.pid(n integer) returns uuid language sql immutable as $$
  select ('f1160301-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.problem(n integer) returns public.problems language sql as $$
  select p.* from public.problems p where p.id = pg_temp.pid(n) $$;
-- What a reader that knows three levels gets, and what a new one adds.
create or replace function pg_temp.urgency(n integer) returns text language sql as $$
  select p.priority::text || case when p.critical then '+critical' else '' end
  from public.problems p where p.id = pg_temp.pid(n) $$;
-- The push the head technician gets for a task: its kind, and whether it may wake him.
create or replace function pg_temp.push_of(n integer) returns text language sql as $$
  select string_agg(o.kind || ':' || o.urgent::text, ',' order by o.kind)
  from raw.push_outbox o where o.params ->> 'problem_id' = pg_temp.pid(n)::text $$;

-- The digest the Edge Function would send for a key (as in api_v1.sql).
create or replace function pg_temp.d(t text) returns text language sql as $$
  select encode(sha256(convert_to(t, 'UTF8')), 'hex') $$;

-- ---------- 1. the scale an older reader knows is unchanged ----------

select pg_temp.check('problem_priority still has exactly the three values an older phone parses',
  enum_range(null::public.problem_priority)::text[], array['low', 'normal', 'high']);
select pg_temp.check('critical is a boolean that is never null',
  (select (data_type, is_nullable, column_default) from information_schema.columns
   where table_schema = 'public' and table_name = 'problems' and column_name = 'critical'),
  ('boolean'::information_schema.character_data, 'NO'::information_schema.yes_or_no,
   'false'::information_schema.character_data));

-- ---------- 2. the cleaner files a critical task ----------

select pg_temp.as_cleo();
select public.report_problem(pg_temp.pid(1), 'Затопило ванную', 'Вода из-под ванны', 'low',
                             900002201, null, p_critical => true);
select public.report_problem(pg_temp.pid(2), 'Нет Wi-Fi', null, 'high', 900002201);
select public.report_problem(pg_temp.pid(3), 'Скрипит дверь', null, 'normal', 900002201);
select pg_temp.as_office();

select pg_temp.check('p_critical files the level above high, whatever p_priority said',
  pg_temp.urgency(1), 'high+critical');
select pg_temp.check('so an older reader of priority sees high',
  (pg_temp.problem(1)).priority::text, 'high');
select pg_temp.check('a high task without the flag is high alone',
  pg_temp.urgency(2), 'high');
select pg_temp.check('the head technician hears of the critical one as urgent, as of a high one',
  pg_temp.push_of(1), pg_temp.push_of(2));
select pg_temp.check('and that is the urgent new-task push',
  pg_temp.push_of(1), 'problem_new:true');
select pg_temp.check('a normal one waits, as before',
  pg_temp.push_of(3), 'problem_new:false');

select pg_temp.as_cleo();
select public.report_problem(pg_temp.pid(1), 'x', 'replayed', 'low', null, null, p_critical => false);
select pg_temp.as_office();
select pg_temp.check('a replay returns the row as it was filed, flag and all',
  (pg_temp.urgency(1), (pg_temp.problem(1)).description),
  ('high+critical'::text, 'Вода из-под ванны'::text));

-- ---------- 3. an older caller says nothing of the level ----------

select pg_temp.as_cleo();
-- The old phone's call: named arguments, no p_critical.
select public.report_problem(p_id => pg_temp.pid(4), p_title => 'Течёт кран',
                             p_priority => 'high', p_property_id => 900002201);
-- The old API's call: five arguments by position.
select public.report_problem(pg_temp.pid(5), 'Лампа', null, 'low', 900002201);
select pg_temp.as_office();
select pg_temp.check('an older phone files high as high, not critical',
  pg_temp.urgency(4), 'high');
select pg_temp.check('the positional call of the old API files as before',
  pg_temp.urgency(5), 'low');

-- An older phone edits the critical task: it shows it as high and sends high back.
select pg_temp.as_cleo();
select public.update_problem(pg_temp.pid(1), 'Затопило ванную', 'Вода уже на кухне', 'high');
select pg_temp.as_office();
select pg_temp.check('an older phone sending high back keeps the task critical',
  (pg_temp.urgency(1), (pg_temp.problem(1)).description),
  ('high+critical'::text, 'Вода уже на кухне'::text));

select pg_temp.as_cleo();
select public.update_problem(pg_temp.pid(1), 'Затопило ванную', null, 'normal');
select pg_temp.as_office();
select pg_temp.check('an older phone lowering it to normal makes it normal — no check trips',
  pg_temp.urgency(1), 'normal');

select pg_temp.as_cleo();
select public.update_problem(pg_temp.pid(1), 'Затопило ванную', null, 'low', p_critical => true);
select pg_temp.as_office();
select pg_temp.check('a new phone raising it to critical makes it high with the flag',
  pg_temp.urgency(1), 'high+critical');

select pg_temp.as_cleo();
select public.update_problem(pg_temp.pid(1), 'Затопило ванную', null, 'high', p_critical => false);
select pg_temp.as_office();
select pg_temp.check('and taking the flag off leaves it high',
  pg_temp.urgency(1), 'high');

select pg_temp.as_cleo();
select public.update_problem(pg_temp.pid(1), 'Затопило ванную', null, 'high', p_critical => true);
select pg_temp.as_office();

-- ---------- 4. the database holds the rule, whoever writes ----------

select pg_temp.check('a writer that asks for critical below high is not refused',
  pg_temp.sqlstate_of($q$insert into public.problems (id, host_id, reported_by, title, priority, critical)
                        values (pg_temp.pid(9), 'f1160000-0000-4000-8000-00000000000a',
                                'f1160001-0000-4000-8000-000000000001', 'x', 'normal', true)$q$),
  'ok');
select pg_temp.check('the trigger files it below high as not critical, not as a broken row',
  pg_temp.urgency(9), 'normal');
alter table public.problems disable trigger problems_critical_follows_priority;
select pg_temp.check('and with the trigger out of the way the check refuses it',
  pg_temp.sqlstate_of($q$update public.problems set priority = 'low' where id = pg_temp.pid(1)$q$),
  '23514');
alter table public.problems enable trigger problems_critical_follows_priority;
select pg_temp.check('any writer that lowers a critical task takes the flag off with it',
  pg_temp.sqlstate_of($q$update public.problems set priority = 'normal' where id = pg_temp.pid(1)$q$),
  'ok');
select pg_temp.check('the lowered task reads normal',
  pg_temp.urgency(1), 'normal');
update public.problems set priority = 'high', critical = true where id = pg_temp.pid(1);
select pg_temp.check('every critical task reads high to an older reader',
  (select bool_and(priority = 'high') from public.problems where critical), true);

-- ---------- 5. the analytics: its own count, ranked above high, its own filter ----------

select pg_temp.as_mila();
create temp table summary_all on commit drop as
  select public.analytics_summary(current_date - 1, current_date + 1) as s;
select pg_temp.check('the tasks by urgency count critical apart, and high alone',
  (select s -> 'problems_by_priority' from summary_all),
  jsonb_build_object('low', 1, 'normal', 2, 'high', 2, 'critical', 1));
select pg_temp.check('the mean urgency ranks critical 4: (1 + 2 + 2 + 3 + 3 + 4) / 6',
  (select (s ->> 'urgency_avg')::numeric from summary_all), 2.50);
select pg_temp.check('p_levels critical finds the critical task alone',
  (public.analytics_summary(current_date - 1, current_date + 1,
                            p_levels => array['critical']) ->> 'problems_created')::int,
  1);
select pg_temp.check('p_levels high finds high alone, not critical',
  (public.analytics_summary(current_date - 1, current_date + 1,
                            p_levels => array['high']) -> 'problems_by_priority'),
  jsonb_build_object('low', 0, 'normal', 0, 'high', 2, 'critical', 0));
select pg_temp.check('the old filter p_priorities high still finds what reads high, critical among it',
  (public.analytics_summary(current_date - 1, current_date + 1,
                            p_priorities => array['high'::public.problem_priority])
     ->> 'problems_created')::int,
  3);
select pg_temp.check('the series take the level filter too',
  (select sum(b.problems_created)::int
   from public.analytics_series(current_date - 1, current_date + 1,
                                p_levels => array['critical']) b),
  1);
select pg_temp.check('the tasks by listing take it, and rank the critical one 4',
  (select r.urgency_avg
   from public.analytics_problems_by_property(current_date - 1, current_date + 1,
                                              p_levels => array['critical']) r
   where r.listing_id = 900002201),
  4.00);
reset role;
select pg_temp.as_office();
select pg_temp.check('ranked by urgency, the critical task comes before the high ones',
  (select (array_agg(r.problem_id order by r.urgency desc, r.problem_id))[1]
   from public.analytics_problem_rows('f1160000-0000-4000-8000-00000000000a', current_date - 1,
                                      current_date + 1, null, null, null, null, true, false, false) r),
  pg_temp.pid(1));

-- ---------- 6. the API: critical beside priority; 'critical' to create and filter by ----------

select (public.create_api_key('f1160004-0000-4000-8000-000000000004', 'Critical key', 'woom_critAAA',
          pg_temp.d('key-critical'), 'full', '{}', null, null, 'Critical key')) ->> 'id' as k_critical \gset

select pg_temp.check('a task answers critical beside priority',
  (select (t ->> 'priority', t ->> 'critical')
   from jsonb_array_elements(public.api_v1_list_tasks(pg_temp.d('key-critical'), p_limit => 200)) t
   where (t ->> 'id')::uuid = pg_temp.pid(1)),
  ('high'::text, 'true'::text));
select pg_temp.check('priority=critical finds the critical alone',
  (select array_agg((t ->> 'id')::uuid)
   from jsonb_array_elements(public.api_v1_list_tasks(pg_temp.d('key-critical'),
                                                      p_priority => array['critical'])) t),
  array[pg_temp.pid(1)]);
select pg_temp.check('priority=high finds every task that reads high, the critical one among them',
  (select count(*)::int
   from jsonb_array_elements(public.api_v1_list_tasks(pg_temp.d('key-critical'),
                                                      p_priority => array['high'])) t),
  3);
select pg_temp.check('POST priority critical files a critical task',
  (select (t -> 'body' ->> 'priority', t -> 'body' ->> 'critical')
   from public.api_v1_create_task(pg_temp.d('key-critical'), 'crit-1', pg_temp.d('body-crit-1'),
                                  'Burst pipe', null, 'critical', 900002201) t),
  ('high'::text, 'true'::text));
select pg_temp.check('POST priority high files high alone, as before',
  (select (t -> 'body' ->> 'priority', t -> 'body' ->> 'critical')
   from public.api_v1_create_task(pg_temp.d('key-critical'), 'crit-2', pg_temp.d('body-crit-2'),
                                  'Weak Wi-Fi', null, 'high', 900002201) t),
  ('high'::text, 'false'::text));
select pg_temp.check('the critical task the API filed woke the head technician as a high one does',
  (select string_agg(o.kind || ':' || o.urgent::text, ',')
   from raw.push_outbox o
   join public.problems p on p.id = (o.params ->> 'problem_id')::uuid
   where p.title = 'Burst pipe'),
  'problem_new:true');

rollback;
