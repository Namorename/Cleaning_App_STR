-- Дымовой тест RLS. Запуск: см. scripts/test-rls.sh
-- Работает в транзакции и откатывается — базу не пачкает.
begin;

-- ---------- фикстуры ----------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cleaner1@test.local','x',now(),now(),
   '{"full_name":"Клинер Один","role":"cleaner"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cleaner2@test.local','x',now(),now(),
   '{"full_name":"Клинер Два","role":"cleaner"}'::jsonb),
  ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','manager@test.local','x',now(),now(),
   '{"full_name":"Менеджер","role":"manager"}'::jsonb),
  ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bogus@test.local','x',now(),now(),
   '{"full_name":"Кривая роль","role":"superuser"}'::jsonb);

insert into public.properties (id, name, timezone) values (98352,'Тестовый объект','Europe/Prague');

insert into public.reservations (id, property_id, arrival_date, departure_date, status, guest_name)
values (700001, 98352, '2026-09-01','2026-09-05','new','Гость Гостевич');

insert into public.tasks (property_id, reservation_id, type, status, assignee_id, scheduled_date)
values (98352, 700001, 'cleaning','assigned','11111111-1111-1111-1111-111111111111','2026-09-05');

insert into public.tasks (property_id, type, status, assignee_id, scheduled_date)
values (98352, 'cleaning','assigned','22222222-2222-2222-2222-222222222222','2026-09-05');

-- ---------- проверки ----------
create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — получено %, ожидалось %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

-- триггер создал профили, кривая роль откатилась на cleaner
select pg_temp.check('профили созданы триггером',
  (select count(*)::int from public.profiles), 4);
select pg_temp.check('неизвестная роль -> cleaner',
  (select role::text from public.profiles where id='44444444-4444-4444-4444-444444444444'),
  'cleaner');
select pg_temp.check('роль из метаданных применена',
  (select role::text from public.profiles where id='33333333-3333-3333-3333-333333333333'),
  'manager');

-- ===== КЛИНЕР 1 =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select pg_temp.check('клинер видит только свою задачу',
  (select count(*)::int from public.tasks), 1);
select pg_temp.check('клинер НЕ видит брони (PII гостя)',
  (select count(*)::int from public.reservations), 0);
select pg_temp.check('клинер видит свой профиль',
  (select count(*)::int from public.profiles), 1);
select pg_temp.check('клинер видит объекты (нужен адрес)',
  (select count(*)::int from public.properties), 1);

-- эскалация привилегий должна быть невозможна
update public.profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
select pg_temp.check('клинер НЕ может повысить себе роль',
  (select role::text from public.profiles where id='11111111-1111-1111-1111-111111111111'),
  'cleaner');

update public.profiles set full_name='Новое Имя' where id='11111111-1111-1111-1111-111111111111';
select pg_temp.check('клинер МОЖЕТ менять своё имя',
  (select full_name from public.profiles where id='11111111-1111-1111-1111-111111111111'),
  'Новое Имя');

-- переназначение чужой задачи себе
update public.tasks set assignee_id='11111111-1111-1111-1111-111111111111'
  where assignee_id='22222222-2222-2222-2222-222222222222';
reset role;
select pg_temp.check('клинер НЕ может забрать чужую задачу',
  (select count(*)::int from public.tasks where assignee_id='11111111-1111-1111-1111-111111111111'), 1);

-- ===== МЕНЕДЖЕР =====
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select pg_temp.check('менеджер видит все задачи',
  (select count(*)::int from public.tasks), 2);
select pg_temp.check('менеджер видит брони',
  (select count(*)::int from public.reservations), 1);
select pg_temp.check('менеджер видит все профили',
  (select count(*)::int from public.profiles), 4);

reset role;

-- ===== идемпотентность генератора задач =====
do $$
begin
  insert into public.tasks (property_id, reservation_id, type, status, assignee_id, scheduled_date)
  values (98352, 700001, 'cleaning','assigned','22222222-2222-2222-2222-222222222222','2026-09-05');
  raise exception 'FAIL дубль уборки на одну бронь прошёл';
exception when unique_violation then
  raise notice 'ok  дубль уборки на бронь отклонён';
end $$;

-- ===== отменённая задача может остаться без исполнителя =====
do $$
begin
  insert into public.tasks (property_id, type, status, scheduled_date)
  values (98352, 'inspection','cancelled','2026-09-05');
  raise notice 'ok  отменённая задача без исполнителя допускается';
exception when check_violation then
  raise exception 'FAIL отменённая задача без исполнителя отклонена';
end $$;

rollback;
