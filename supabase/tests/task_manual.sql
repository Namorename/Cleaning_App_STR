-- Tasks a manager writes by hand. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is checked: the title and its translations, who is recorded as the
-- author, and the rule that the same kind of job cannot be put on the same
-- flat on the same day twice — while a booking and a problem fix, which are
-- not written by hand, stay exempt from it.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d9000001-0000-4000-8000-0000000000e1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.manual@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d9000002-0000-4000-8000-0000000000e2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.manual@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d9000004-0000-4000-8000-0000000000e4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.manual@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set is_active = false
where id = 'd9000002-0000-4000-8000-0000000000e2';

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900001901, 'Flat One', 'UTC', '15:00', '10:00'),
  (900001902, 'Flat Two', 'UTC', '15:00', '10:00');

insert into public.reservations (id, property_id, arrival_date, departure_date, status, guest_name)
values (900001911, 900001901, current_date - 3, current_date, 'new', 'Guest Manual');

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
  v_hint   text;
  v_detail text;
begin
  execute statement;
  return 'no refusal';
exception when check_violation or insufficient_privilege or invalid_parameter_value then
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return v_hint || coalesce(' ' || nullif(v_detail, ''), '');
end $$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;
create or replace function pg_temp.as_maria() returns void language sql as $$
  select pg_temp.as_user('d9000001-0000-4000-8000-0000000000e1') $$;
create or replace function pg_temp.as_boss() returns void language sql as $$
  select pg_temp.as_user('d9000004-0000-4000-8000-0000000000e4') $$;

create or replace function pg_temp.tid(n integer) returns uuid language sql immutable as $$
  select ('c9000001-0000-4000-8000-00000000000' || n::text)::uuid $$;
create or replace function pg_temp.task(n integer) returns public.tasks language sql as $$
  select t.* from public.tasks t where t.id = pg_temp.tid(n) $$;

-- ---------- a manager writes one ----------

select pg_temp.as_boss();
select public.save_task(pg_temp.tid(1), 900001901, 'cleaning', current_date + 1,
  '  Генеральная уборка  ', '{"en":"Deep clean","cs":"Hloubkový úklid"}'::jsonb);
-- The same save, sent twice: one job, not two.
select public.save_task(pg_temp.tid(1), 900001901, 'cleaning', current_date + 1,
  'Генеральная уборка', '{"en":"Deep clean","cs":"Hloubkový úklid"}'::jsonb);
reset role; reset request.jwt.claims;

select pg_temp.check('the title is stored trimmed',
  (pg_temp.task(1)).title, 'Генеральная уборка');
select pg_temp.check('the translations ride along',
  (pg_temp.task(1)).title_i18n ->> 'cs', 'Hloubkový úklid');
select pg_temp.check('a replayed save writes one task',
  (select count(*)::int from public.tasks where property_id = 900001901
     and scheduled_date = current_date + 1), 1);
select pg_temp.check('the manager is recorded as the author',
  (pg_temp.task(1)).created_by, 'd9000004-0000-4000-8000-0000000000e4'::uuid);
select pg_temp.check('with nobody to do it, it waits in the queue',
  (pg_temp.task(1)).status::text, 'unassigned');

-- ---------- the same job twice on the same day ----------

select pg_temp.as_boss();
select pg_temp.check('a second cleaning that day on that flat is refused',
  pg_temp.refusal($sql$select public.save_task(
    'c9000009-0000-4000-8000-000000000009'::uuid, 900001901, 'cleaning',
    current_date + 1, 'Ещё одна уборка')$sql$),
  'serverErrors.taskDuplicate {"date": "' || (current_date + 1)::text || '", "type": "cleaning"}');

-- The refusal is a question, not a wall: a busy flat can want two cleanings.
select public.save_task(pg_temp.tid(9), 900001901, 'cleaning', current_date + 1,
  'Ещё одна уборка', '{}'::jsonb, null, null, null, null, null, true);
select pg_temp.check('a manager who confirms gets the second one',
  (pg_temp.task(9)).title, 'Ещё одна уборка');
update public.tasks set status = 'cancelled' where id = pg_temp.tid(9);

select public.save_task(pg_temp.tid(2), 900001901, 'inspection', current_date + 1, 'Осмотр');
select public.save_task(pg_temp.tid(3), 900001901, 'cleaning', current_date + 2, 'Уборка назавтра');
select public.save_task(pg_temp.tid(4), 900001902, 'cleaning', current_date + 1, 'Уборка в другой квартире');
reset role; reset request.jwt.claims;

select pg_temp.check('another kind of job that day is fine',
  (pg_temp.task(2)).type::text, 'inspection');
select pg_temp.check('the same job on the next day is fine',
  (pg_temp.task(3)).scheduled_date, current_date + 2);
select pg_temp.check('the same job in another flat is fine',
  (pg_temp.task(4)).property_id, 900001902::bigint);

-- A cleaning that came from a booking is not a hand written job and does not
-- take the slot: a flat can turn over on a day it is also deep cleaned.
insert into public.tasks (id, property_id, reservation_id, type, status, scheduled_date)
values ('c9000008-0000-4000-8000-000000000008', 900001901, 900001911, 'cleaning',
        'unassigned', current_date + 1);
select pg_temp.check('a cleaning from a booking shares the day with a manual one',
  (select count(*)::int from public.tasks
   where property_id = 900001901 and type = 'cleaning'
     and scheduled_date = current_date + 1 and status <> 'cancelled'), 2);
select pg_temp.check('and the server, not a person, is its author',
  (select created_by from public.tasks
   where id = 'c9000008-0000-4000-8000-000000000008'), null::uuid);

-- ---------- cancelling frees the day ----------

select pg_temp.as_boss();
update public.tasks set status = 'cancelled' where id = pg_temp.tid(2);
select public.save_task(pg_temp.tid(5), 900001901, 'inspection', current_date + 1, 'Осмотр заново');
select pg_temp.check('a cancelled job no longer holds the slot',
  (pg_temp.task(5)).title, 'Осмотр заново');
select pg_temp.check('but it can no longer be edited',
  pg_temp.refusal($sql$select public.save_task(
    'c9000001-0000-4000-8000-000000000002'::uuid, 900001901, 'inspection',
    current_date + 1, 'Осмотр')$sql$),
  'serverErrors.taskClosed {"status": "cancelled"}');
reset role; reset request.jwt.claims;

-- ---------- handing it out and taking it back ----------

select pg_temp.as_boss();
select public.save_task(pg_temp.tid(1), 900001901, 'cleaning', current_date + 1,
  'Генеральная уборка', '{}'::jsonb, 'd9000001-0000-4000-8000-0000000000e1');
select pg_temp.check('an executor moves it out of the queue',
  (pg_temp.task(1)).status::text, 'assigned');
select public.save_task(pg_temp.tid(1), 900001901, 'cleaning', current_date + 1,
  'Генеральная уборка');
select pg_temp.check('taking the executor away puts it back',
  (pg_temp.task(1)).status::text, 'unassigned');
select pg_temp.check('an executor outside the company is refused',
  pg_temp.refusal($sql$select public.save_task(
    'c9000001-0000-4000-8000-000000000001'::uuid, 900001901, 'cleaning', current_date + 1,
    'Генеральная уборка', '{}'::jsonb,
    'd9000002-0000-4000-8000-0000000000e2'::uuid)$sql$),
  'serverErrors.taskAssigneeInvalid');
reset role; reset request.jwt.claims;

-- ---------- what a bad brief is refused with ----------

select pg_temp.as_boss();
select pg_temp.check('a job needs a name',
  pg_temp.refusal($sql$select public.save_task(
    'c9000007-0000-4000-8000-000000000007'::uuid, 900001901, 'maintenance',
    current_date + 1, '   ')$sql$),
  'serverErrors.taskTitleRequired');
select pg_temp.check('a name longer than the limit is refused',
  pg_temp.refusal($sql$select public.save_task(
    'c9000007-0000-4000-8000-000000000007'::uuid, 900001901, 'maintenance',
    current_date + 1, repeat('я', 121))$sql$),
  'serverErrors.taskTitleTooLong {"limit": 120}');
select pg_temp.check('a translation in a language the app does not have is refused',
  pg_temp.refusal($sql$select public.save_task(
    'c9000007-0000-4000-8000-000000000007'::uuid, 900001901, 'maintenance',
    current_date + 1, 'Починить', '{"de":"Reparieren"}'::jsonb)$sql$),
  'serverErrors.translationsInvalid');
select pg_temp.check('a flat outside the company is refused',
  pg_temp.refusal($sql$select public.save_task(
    'c9000007-0000-4000-8000-000000000007'::uuid, 900009999, 'maintenance',
    current_date + 1, 'Починить')$sql$),
  'serverErrors.propertyNotFound');
select pg_temp.check('a job without a day is refused',
  pg_temp.refusal($sql$select public.save_task(
    'c9000007-0000-4000-8000-000000000007'::uuid, 900001901, 'maintenance',
    null, 'Починить')$sql$),
  'serverErrors.taskDateRequired');
reset role; reset request.jwt.claims;

-- ---------- the cleaner carries it out, she does not rewrite it ----------

select pg_temp.as_boss();
select public.save_task(pg_temp.tid(6), 900001901, 'maintenance', current_date + 1,
  'Заменить лампочку', '{}'::jsonb, 'd9000001-0000-4000-8000-0000000000e1');
reset role; reset request.jwt.claims;

select pg_temp.as_maria();
select pg_temp.check('a cleaner may not write a task herself',
  pg_temp.refusal($sql$select public.save_task(
    'c9000007-0000-4000-8000-000000000007'::uuid, 900001901, 'inspection',
    current_date + 3, 'Мой осмотр')$sql$),
  'serverErrors.managerOnly');

update public.tasks
set title = 'Ничего не делал', title_i18n = '{"en":"Nothing"}'::jsonb,
    created_by = 'd9000001-0000-4000-8000-0000000000e1'
where id = pg_temp.tid(6);
reset role; reset request.jwt.claims;

select pg_temp.check('the title she was given stands',
  (pg_temp.task(6)).title, 'Заменить лампочку');
select pg_temp.check('and so do its translations',
  (pg_temp.task(6)).title_i18n, '{}'::jsonb);
select pg_temp.check('and the author stays the manager who asked',
  (pg_temp.task(6)).created_by, 'd9000004-0000-4000-8000-0000000000e4'::uuid);

rollback;
