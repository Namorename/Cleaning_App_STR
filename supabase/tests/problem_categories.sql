-- The catalogue of task categories (20261115100000). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: with a category the server, not the phone, names
-- the task and sets its urgency; without one — an older phone, the panel, the
-- API — report_problem and update_problem behave exactly as before; the
-- catalogue is read by the staff of its own company only and written by none
-- of them; the switch is off for every company until somebody turns it on.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('f1150000-0000-4000-8000-00000000000b', 'Other company');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('f1150001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.categories@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('f1150002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','olga.categories@test.local','x',now(),now(),
   '{"full_name":"Olga"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('f1150003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','ghost.categories@test.local','x',now(),now(),
   '{"full_name":"Ghost"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('f1150004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','hector.categories@test.local','x',now(),now(),
   '{"full_name":"Hector"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('f1150005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.categories@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'f1150000-0000-4000-8000-00000000000b'
where id = 'f1150002-0000-4000-8000-000000000002';
update public.profiles set is_active = false
where id = 'f1150003-0000-4000-8000-000000000003';

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900002101, 'Flat with no hot water', 'UTC', '15:00', '10:00');
insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900002101, 'f1150001-0000-4000-8000-000000000001', 'claim');
insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date) values
  ('f1150101-0000-4000-8000-000000000001', 900002101, 'cleaning', 'in_progress',
   'f1150001-0000-4000-8000-000000000001', current_date);

-- The head technician has a phone: a new task reaches him as problem_new.
insert into public.push_tokens (token, profile_id, host_id, platform)
select 'ExponentPushToken[categories-hector]', p.id, p.host_id, 'android'
from public.profiles p where p.id = 'f1150004-0000-4000-8000-000000000004';

-- The catalogue: two live categories and an archived one in her company, one
-- in the other company.
insert into public.problem_categories (id, name, name_i18n, synonyms, priority, sort_order, archived_at)
values
  ('f1150201-0000-4000-8000-000000000001', 'Горячая вода',
   '{"en": "Hot water", "cs": "Teplá voda"}', '{бойлер}', 'high', 1, null),
  ('f1150202-0000-4000-8000-000000000002', 'Смесители',
   '{"en": "Taps", "cs": "Vodovodní baterie"}', '{кран,смеситель}', 'normal', 2, null),
  ('f1150203-0000-4000-8000-000000000003', 'Декор', '{}', '{}', 'low', 3, now());
-- The level above high (20261115090000): a category of it is high with the flag.
insert into public.problem_categories (id, name, name_i18n, priority, critical, sort_order)
values ('f1150204-0000-4000-8000-000000000004', 'Затопление',
        '{"en": "Flooding", "cs": "Zaplavení"}', 'high', true, 4);
insert into public.problem_categories (id, host_id, name, priority)
values ('f1150209-0000-4000-8000-000000000009', 'f1150000-0000-4000-8000-00000000000b',
        'Чужая категория', 'high');

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
exception when check_violation or insufficient_privilege then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), sqlstate);
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
create or replace function pg_temp.as_maria() returns void language sql as $$
  select pg_temp.as_user('f1150001-0000-4000-8000-000000000001') $$;
create or replace function pg_temp.as_olga() returns void language sql as $$
  select pg_temp.as_user('f1150002-0000-4000-8000-000000000002') $$;
create or replace function pg_temp.as_ghost() returns void language sql as $$
  select pg_temp.as_user('f1150003-0000-4000-8000-000000000003') $$;
create or replace function pg_temp.as_office() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;

create or replace function pg_temp.pid(n integer) returns uuid language sql immutable as $$
  select ('f1150301-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.problem(n integer) returns public.problems language sql as $$
  select p.* from public.problems p where p.id = pg_temp.pid(n) $$;
create or replace function pg_temp.hot_water() returns uuid language sql immutable as $$
  select 'f1150201-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.taps() returns uuid language sql immutable as $$
  select 'f1150202-0000-4000-8000-000000000002'::uuid $$;
create or replace function pg_temp.decor() returns uuid language sql immutable as $$
  select 'f1150203-0000-4000-8000-000000000003'::uuid $$;
create or replace function pg_temp.flood() returns uuid language sql immutable as $$
  select 'f1150204-0000-4000-8000-000000000004'::uuid $$;
create or replace function pg_temp.foreign_category() returns uuid language sql immutable as $$
  select 'f1150209-0000-4000-8000-000000000009'::uuid $$;

-- ---------- the switch ----------

select pg_temp.check('every company reports by free text until switched',
  (select count(*)::int from public.hosts where problem_report_mode <> 'free_text'), 0);
select pg_temp.check('a new company starts on free text',
  (select problem_report_mode from public.hosts where id = 'f1150000-0000-4000-8000-00000000000b'),
  'free_text');
select pg_temp.check('the switch takes only the two modes',
  pg_temp.sqlstate_of($q$update public.hosts set problem_report_mode = 'dropdown'
                        where id = 'f1150000-0000-4000-8000-00000000000b'$q$),
  '23514');

select pg_temp.as_maria();
select pg_temp.check('the staff read the switch with the company row',
  (select problem_report_mode from public.hosts limit 1), 'free_text');
select pg_temp.check('and cannot turn it',
  pg_temp.sqlstate_of($q$update public.hosts set problem_report_mode = 'catalog'$q$), '42501');
select pg_temp.as_office();

-- ---------- the catalogue: who reads, who writes ----------

select pg_temp.check('authenticated may only read the catalogue',
  (select string_agg(privilege_type, ',' order by privilege_type)
   from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'problem_categories' and grantee = 'authenticated'),
  'SELECT');
select pg_temp.check('anon holds nothing on it',
  has_table_privilege('anon', 'public.problem_categories', 'select'), false);

select pg_temp.as_maria();
select pg_temp.check('a cleaner reads the categories of her company, archived ones too',
  (select string_agg(name, ', ' order by sort_order) from public.problem_categories),
  'Горячая вода, Смесители, Декор, Затопление');
select pg_temp.check('a cleaner cannot add a category',
  pg_temp.sqlstate_of($q$insert into public.problem_categories (name, priority)
                        values ('Своя', 'high')$q$),
  '42501');
select pg_temp.check('nor change the urgency of one',
  pg_temp.sqlstate_of($q$update public.problem_categories set priority = 'low'$q$), '42501');
select pg_temp.as_olga();
select pg_temp.check('another company reads only its own',
  (select string_agg(name, ', ') from public.problem_categories), 'Чужая категория');
select pg_temp.as_ghost();
select pg_temp.check('a switched-off account reads none',
  (select count(*)::int from public.problem_categories), 0);
select pg_temp.as_office();

select pg_temp.check('one live name per company, whatever the case',
  pg_temp.sqlstate_of($q$insert into public.problem_categories (name, priority)
                        values ('  горячая ВОДА ', 'low')$q$),
  '23505');
select pg_temp.check('an archived name may be used again',
  pg_temp.sqlstate_of($q$insert into public.problem_categories (name, priority)
                        values ('Декор', 'low')$q$),
  'ok');
delete from public.problem_categories where name = 'Декор' and archived_at is null;
select pg_temp.check('a name is the title of a task: at most 200 characters',
  pg_temp.sqlstate_of($q$insert into public.problem_categories (name, priority)
                        values (repeat('x', 201), 'low')$q$),
  '23514');
select pg_temp.check('a synonym is never empty',
  pg_temp.sqlstate_of($q$insert into public.problem_categories (name, synonyms, priority)
                        values ('Пустой', '{""}', 'low')$q$),
  '23514');
select pg_temp.check('nor null',
  pg_temp.sqlstate_of($q$insert into public.problem_categories (name, synonyms, priority)
                        values ('Нулевой', array[null]::text[], 'low')$q$),
  '23514');

-- ---------- the functions ----------

select pg_temp.check('report_problem has one signature, the new one',
  (select string_agg(p.oid::regprocedure::text, '; ')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'report_problem'),
  'report_problem(uuid,text,text,problem_priority,bigint,uuid,boolean,uuid)');
select pg_temp.check('update_problem too',
  (select string_agg(p.oid::regprocedure::text, '; ')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'update_problem'),
  'update_problem(uuid,text,text,problem_priority,boolean,uuid)');
select pg_temp.check('the staff may call report_problem',
  has_function_privilege('authenticated',
    'public.report_problem(uuid,text,text,public.problem_priority,bigint,uuid,boolean,uuid)', 'execute'),
  true);
select pg_temp.check('anon may not',
  has_function_privilege('anon',
    'public.report_problem(uuid,text,text,public.problem_priority,bigint,uuid,boolean,uuid)', 'execute'),
  false);
select pg_temp.check('nor may PUBLIC call update_problem',
  (select bool_or(a.grantee = 0)
   from pg_proc p, aclexplode(p.proacl) a
   where p.oid = 'public.update_problem(uuid,text,text,public.problem_priority,boolean,uuid)'::regprocedure),
  false);
select pg_temp.check('the category lookup is the functions'' own, not a client''s',
  has_function_privilege('authenticated', 'public.problem_category_for_report(uuid)', 'execute'),
  false);

-- ---------- reporting under a category ----------

select pg_temp.as_maria();
-- The phone sends the shown name and the urgency it showed; both are ignored.
select public.report_problem(pg_temp.pid(1), 'Hot water', 'Нет горячей воды на кухне', 'low',
  null, 'f1150101-0000-4000-8000-000000000001', p_category_id => pg_temp.hot_water());
select pg_temp.as_office();

select pg_temp.check('the category names the task, in the company''s language',
  (pg_temp.problem(1)).title, 'Горячая вода');
select pg_temp.check('with its translations',
  (pg_temp.problem(1)).title_i18n, '{"en": "Hot water", "cs": "Teplá voda"}'::jsonb);
select pg_temp.check('the urgency is the category''s, not the phone''s',
  (pg_temp.problem(1)).priority::text, 'high');
select pg_temp.check('the category is kept for the statistics',
  (pg_temp.problem(1)).category_id, pg_temp.hot_water());
select pg_temp.check('the description is hers, as before',
  (pg_temp.problem(1)).description, 'Нет горячей воды на кухне');
select pg_temp.check('the listing still comes from the task',
  (pg_temp.problem(1)).property_id, 900002101::bigint);
select pg_temp.check('the head technician hears of it as urgent: the category''s urgency drives the push',
  (select bool_and(o.urgent) from raw.push_outbox o
   where o.kind = 'problem_new' and o.params ->> 'problem_id' = pg_temp.pid(1)::text),
  true);

select pg_temp.as_maria();
select public.report_problem(pg_temp.pid(1), 'x', 'replayed', 'normal', null, null, p_category_id => pg_temp.taps());
select pg_temp.as_office();
select pg_temp.check('a replay returns the row unchanged, category and all',
  ((pg_temp.problem(1)).category_id, (pg_temp.problem(1)).description),
  (pg_temp.hot_water(), 'Нет горячей воды на кухне'::text));

select pg_temp.as_maria();
select public.report_problem(pg_temp.pid(2), 'Taps', null, 'high', 900002101, null, p_category_id => pg_temp.taps());
select public.report_problem(pg_temp.pid(3), 'Декор', null, 'high', 900002101, null, p_category_id => pg_temp.decor());
select pg_temp.check('a category of another company is refused',
  pg_temp.refusal($q$select public.report_problem(pg_temp.pid(4), 'x', null, 'normal', 900002101,
                    null, p_category_id => pg_temp.foreign_category())$q$),
  'serverErrors.problemCategoryNotFound');
select pg_temp.check('and so is one that does not exist',
  pg_temp.refusal($q$select public.report_problem(pg_temp.pid(4), 'x', null, 'normal', 900002101,
                    null, p_category_id => 'f1150299-0000-4000-8000-000000000099')$q$),
  'serverErrors.problemCategoryNotFound');
select pg_temp.as_olga();
select pg_temp.check('nor may another company file under hers',
  pg_temp.refusal($q$select public.report_problem(pg_temp.pid(8), 'x', null, 'normal', null,
                    null, p_category_id => pg_temp.hot_water())$q$),
  'serverErrors.problemCategoryNotFound');
select pg_temp.as_office();

select pg_temp.check('a high urgency sent by the phone does not lift a normal category',
  (pg_temp.problem(2)).priority::text, 'normal');
select pg_temp.check('nor wakes the head technician at night',
  (select bool_or(o.urgent) from raw.push_outbox o
   where o.kind = 'problem_new' and o.params ->> 'problem_id' = pg_temp.pid(2)::text),
  false);
select pg_temp.check('an archived category still files a queued report',
  ((pg_temp.problem(3)).category_id, (pg_temp.problem(3)).priority::text),
  (pg_temp.decor(), 'low'::text));
select pg_temp.check('a category without translations leaves the title''s translations empty',
  (pg_temp.problem(3)).title_i18n, null::jsonb);
select pg_temp.check('a refused report leaves nothing behind',
  (select count(*)::int from public.problems where id = pg_temp.pid(4)), 0);

-- ---------- reporting as before: no category ----------

-- Exactly as the phone of build 1.2.0 and the panel call it through PostgREST:
-- by name, without p_category_id (lib: supabase.rpc('report_problem', {...})).
select pg_temp.as_maria();
select public.report_problem(p_id => pg_temp.pid(5), p_title => '  Кран течёт  ',
  p_description => 'Под раковиной лужа', p_priority => 'high',
  p_task_id => 'f1150101-0000-4000-8000-000000000001');
-- And as the API calls it (api_v1_create_task): five arguments by position.
select public.report_problem(pg_temp.pid(6), 'Скрипит дверь', null, 'low'::public.problem_priority,
  900002101::bigint);
select pg_temp.as_office();

select pg_temp.check('an old caller''s report keeps its own title',
  (pg_temp.problem(5)).title, 'Кран течёт');
select pg_temp.check('and its own urgency',
  ((pg_temp.problem(5)).priority::text, (pg_temp.problem(6)).priority::text), ('high'::text, 'low'::text));
select pg_temp.check('and has no category',
  ((pg_temp.problem(5)).category_id, (pg_temp.problem(6)).category_id), (null::uuid, null::uuid));
select pg_temp.check('nor translations of its title',
  (pg_temp.problem(5)).title_i18n, null::jsonb);
select pg_temp.as_maria();
select pg_temp.check('an old caller still needs a title',
  pg_temp.refusal($q$select public.report_problem(p_id => pg_temp.pid(7), p_title => '   ')$q$),
  'serverErrors.problemTitleRequired');
select pg_temp.as_office();

-- ---------- correcting a report ----------

select pg_temp.as_maria();
-- An old phone corrects a report filed under a category: its title and urgency are ignored.
select public.update_problem(p_id => pg_temp.pid(1), p_title => 'Другое',
  p_description => 'Нет горячей воды нигде', p_priority => 'low');
select pg_temp.as_office();
select pg_temp.check('a report under a category keeps the category''s title and urgency',
  ((pg_temp.problem(1)).title, (pg_temp.problem(1)).priority::text, (pg_temp.problem(1)).category_id),
  ('Горячая вода'::text, 'high'::text, pg_temp.hot_water()));
select pg_temp.check('and takes the new description',
  (pg_temp.problem(1)).description, 'Нет горячей воды нигде');

select pg_temp.as_maria();
select public.update_problem(pg_temp.pid(1), 'x', 'Это смеситель', 'high', p_category_id => pg_temp.taps());
select pg_temp.as_office();
select pg_temp.check('another category moves the report: title, translations and urgency follow',
  ((pg_temp.problem(1)).title, (pg_temp.problem(1)).title_i18n ->> 'en',
   (pg_temp.problem(1)).priority::text, (pg_temp.problem(1)).category_id),
  ('Смесители'::text, 'Taps'::text, 'normal'::text, pg_temp.taps()));

select pg_temp.as_maria();
select pg_temp.check('a category of another company is refused on a correction too',
  pg_temp.refusal($q$select public.update_problem(pg_temp.pid(2), 'x', null, 'normal',
                    p_category_id => pg_temp.foreign_category())$q$),
  'serverErrors.problemCategoryNotFound');
select pg_temp.as_office();
-- Whatever a typed title carries beside it stays as it was, as before.
update public.problems set title_i18n = '{"en": "Tap"}' where id = pg_temp.pid(5);
select pg_temp.as_maria();
-- A typed report corrected as before.
select public.update_problem(p_id => pg_temp.pid(5), p_title => 'Кран течёт сильно',
  p_description => null, p_priority => 'normal');
select pg_temp.as_office();
select pg_temp.check('a typed report is corrected as before',
  ((pg_temp.problem(5)).title, (pg_temp.problem(5)).priority::text, (pg_temp.problem(5)).category_id,
   (pg_temp.problem(5)).title_i18n),
  ('Кран течёт сильно'::text, 'normal'::text, null::uuid, '{"en": "Tap"}'::jsonb));

select pg_temp.as_maria();
select public.update_problem(pg_temp.pid(6), 'whatever', null, 'low', p_category_id => pg_temp.hot_water());
select pg_temp.as_office();
select pg_temp.check('a typed report given a category takes it',
  ((pg_temp.problem(6)).title, (pg_temp.problem(6)).priority::text, (pg_temp.problem(6)).category_id),
  ('Горячая вода'::text, 'high'::text, pg_temp.hot_water()));

-- ---------- a category leaves the list, its tasks keep it ----------

select pg_temp.as_maria();
select public.update_problem(pg_temp.pid(3), 'x', 'Картина упала', 'high');
select pg_temp.as_office();
select pg_temp.check('a report under an archived category is still corrected on it',
  ((pg_temp.problem(3)).title, (pg_temp.problem(3)).priority::text, (pg_temp.problem(3)).category_id,
   (pg_temp.problem(3)).description),
  ('Декор'::text, 'low'::text, pg_temp.decor(), 'Картина упала'::text));

-- ---------- a category of the level above high ----------

select pg_temp.check('a category is critical only over high',
  pg_temp.sqlstate_of($q$insert into public.problem_categories (name, priority, critical)
                        values ('Не та', 'normal', true)$q$),
  '23514');

select pg_temp.as_maria();
select public.report_problem(pg_temp.pid(10), 'x', null, 'low', 900002101, null,
                             p_category_id => pg_temp.flood());
select pg_temp.as_office();
select pg_temp.check('a task under a critical category is high with the flag, whatever the phone sent',
  ((pg_temp.problem(10)).title, (pg_temp.problem(10)).priority::text, (pg_temp.problem(10)).critical),
  ('Затопление'::text, 'high'::text, true));
select pg_temp.check('the head technician hears of it as urgent, as of a high one',
  (select bool_and(o.urgent) from raw.push_outbox o
   where o.kind = 'problem_new' and o.params ->> 'problem_id' = pg_temp.pid(10)::text),
  true);

select pg_temp.as_maria();
select public.report_problem(pg_temp.pid(11), 'x', null, 'high', 900002101, null,
                             p_critical => true, p_category_id => pg_temp.taps());
select pg_temp.as_office();
select pg_temp.check('the category, not p_critical, decides: a normal category files normal',
  ((pg_temp.problem(11)).priority::text, (pg_temp.problem(11)).critical),
  ('normal'::text, false));

select pg_temp.as_maria();
-- An older phone edits it: it shows high and sends a lower priority back.
select public.update_problem(pg_temp.pid(10), 'x', 'Вода на полу', 'low');
select pg_temp.as_office();
select pg_temp.check('an older phone cannot lower a task filed under a critical category',
  ((pg_temp.problem(10)).priority::text, (pg_temp.problem(10)).critical,
   (pg_temp.problem(10)).description),
  ('high'::text, true, 'Вода на полу'::text));

select pg_temp.as_maria();
select public.update_problem(pg_temp.pid(10), 'x', null, 'high', p_category_id => pg_temp.taps());
select pg_temp.as_office();
select pg_temp.check('moved to a normal category it is normal, the flag off',
  ((pg_temp.problem(10)).title, (pg_temp.problem(10)).priority::text, (pg_temp.problem(10)).critical),
  ('Смесители'::text, 'normal'::text, false));

select pg_temp.check('a category a task was filed under cannot be deleted, only archived',
  pg_temp.sqlstate_of($q$delete from public.problem_categories where id = pg_temp.decor()$q$),
  '23503');
select pg_temp.check('one no task points at can',
  pg_temp.sqlstate_of($q$delete from public.problem_categories
                        where id = 'f1150209-0000-4000-8000-000000000009'$q$),
  'ok');

select pg_temp.check('tasks filed before the catalogue have no category',
  (select count(*)::int from public.problems
   where category_id is not null
     and id not in (pg_temp.pid(1), pg_temp.pid(2), pg_temp.pid(3), pg_temp.pid(6),
                    pg_temp.pid(10), pg_temp.pid(11))),
  0);

rollback;
