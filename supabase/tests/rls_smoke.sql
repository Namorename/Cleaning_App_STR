-- Дымовой тест RLS. Запуск: npm run test:rls
-- Работает в транзакции и откатывается — базу не пачкает.
begin;

-- ---------- фикстуры ----------
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cleaner1@test.local','x',now(),now(),
   '{"full_name":"Клинер Один"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cleaner2@test.local','x',now(),now(),
   '{"full_name":"Клинер Два"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','manager@test.local','x',now(),now(),
   '{"full_name":"Менеджер"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bogus@test.local','x',now(),now(),
   '{"full_name":"Кривая роль"}'::jsonb, '{"role":"superuser"}'::jsonb),
  -- Ключевой случай: роль подсунута через user_metadata, которое клиент
  -- заполняет сам при signup. Она обязана быть проигнорирована.
  ('55555555-5555-5555-5555-555555555555','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','attacker@test.local','x',now(),now(),
   '{"full_name":"Самозванец","role":"admin"}'::jsonb, '{}'::jsonb);

insert into public.properties (id, name, timezone) values
  (98352,'Тестовый объект','Europe/Prague'),
  (566761,'Юнит A','Europe/Prague'),
  (566769,'Юнит B','Europe/Prague'),
  (571441,'Объединённый','Europe/Prague');

insert into public.reservations (id, property_id, arrival_date, departure_date, status, guest_name)
values (700001, 98352, '2026-09-01','2026-09-05','new','Гость Гостевич');

insert into public.tasks (property_id, reservation_id, type, status, assignee_id, scheduled_date)
values (98352, 700001, 'cleaning','assigned','11111111-1111-1111-1111-111111111111','2026-09-05');

insert into public.tasks (property_id, type, status, assignee_id, scheduled_date)
values (98352, 'cleaning','assigned','22222222-2222-2222-2222-222222222222','2026-09-05');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — получено %, ожидалось %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

-- ---------- регистрация и роли ----------
select pg_temp.check('профили созданы триггером',
  (select count(*)::int from public.profiles), 5);
select pg_temp.check('роль из app_metadata применена',
  (select role::text from public.profiles where id='33333333-3333-3333-3333-333333333333'),
  'manager');
select pg_temp.check('неизвестная роль -> cleaner',
  (select role::text from public.profiles where id='44444444-4444-4444-4444-444444444444'),
  'cleaner');
select pg_temp.check('роль из user_metadata ИГНОРИРУЕТСЯ (эскалация при signup)',
  (select role::text from public.profiles where id='55555555-5555-5555-5555-555555555555'),
  'cleaner');

-- ---------- привилегии service_role (на нём работают Edge Functions) ----------
select pg_temp.check('service_role имеет DML на всех операционных таблицах',
  (select count(distinct table_name)::int from information_schema.role_table_grants
   where grantee='service_role' and table_schema='public'
     and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
     and table_name in ('profiles','properties','property_links','reservations','tasks')), 5);

-- ---------- клинер ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select pg_temp.check('клинер видит только свою задачу',
  (select count(*)::int from public.tasks), 1);
select pg_temp.check('клинер НЕ видит брони (PII гостя)',
  (select count(*)::int from public.reservations), 0);
select pg_temp.check('клинер видит объекты (нужен адрес)',
  (select count(*)::int from public.properties), 4);

update public.profiles set role='admin' where id='11111111-1111-1111-1111-111111111111';
select pg_temp.check('клинер НЕ может повысить себе роль',
  (select role::text from public.profiles where id='11111111-1111-1111-1111-111111111111'),
  'cleaner');

update public.profiles set full_name='Новое Имя' where id='11111111-1111-1111-1111-111111111111';
select pg_temp.check('клинер МОЖЕТ менять своё имя',
  (select full_name from public.profiles where id='11111111-1111-1111-1111-111111111111'),
  'Новое Имя');

-- Передача СВОЕЙ задачи другому. Строка проходит USING, поэтому отказ даёт
-- именно WITH CHECK — прежняя версия теста била по чужой строке и проходила
-- вхолостую даже без WITH CHECK.
do $$
begin
  update public.tasks set assignee_id='22222222-2222-2222-2222-222222222222'
    where assignee_id='11111111-1111-1111-1111-111111111111';
  raise exception 'FAIL клинер сумел передать свою задачу другому';
exception when insufficient_privilege then
  raise notice 'ok  клинер НЕ может передать свою задачу (WITH CHECK)';
end $$;

-- Подмена постановки задачи: сдвиг даты убрал бы задачу из дневной очереди.
update public.tasks set scheduled_date='2026-12-31', priority=99
  where assignee_id='11111111-1111-1111-1111-111111111111';
reset role;
select pg_temp.check('клинер НЕ может сдвинуть дату задачи',
  (select scheduled_date::text from public.tasks
   where assignee_id='11111111-1111-1111-1111-111111111111'), '2026-09-05');
select pg_temp.check('клинер НЕ может поднять приоритет',
  (select priority::int from public.tasks
   where assignee_id='11111111-1111-1111-1111-111111111111'), 0);

-- ---------- менеджер ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select pg_temp.check('менеджер видит все задачи',
  (select count(*)::int from public.tasks), 2);
select pg_temp.check('менеджер видит брони',
  (select count(*)::int from public.reservations), 1);
reset role;

-- ---------- целостность данных ----------
do $$
begin
  insert into public.tasks (property_id, reservation_id, type, status, assignee_id, scheduled_date)
  values (98352, 700001, 'cleaning','assigned','22222222-2222-2222-2222-222222222222','2026-09-05');
  raise exception 'FAIL дубль уборки на одну бронь прошёл';
exception when unique_violation then
  raise notice 'ok  дубль уборки на бронь отклонён';
end $$;

insert into public.property_links (parent_id, child_id) values (571441, 566761), (571441, 566769);
do $$
begin
  insert into public.property_links (parent_id, child_id) values (566761, 571441);
  raise exception 'FAIL цикл в связях объектов прошёл';
exception when raise_exception then
  raise notice 'ok  цикл в связях объектов отклонён';
end $$;

-- Нулевой интервал: Hostaway отдаёт такое для части блоков.
insert into public.reservations (id, property_id, arrival_date, departure_date, status)
values (700002, 98352, '2026-09-10','2026-09-10','new');
select pg_temp.check('нулевой интервал брони принимается',
  (select count(*)::int from public.reservations where id=700002), 1);

-- Удаление сотрудника с выполненной задачей.
update public.tasks set status='done', completed_at=now()
  where assignee_id='22222222-2222-2222-2222-222222222222';
do $$
begin
  delete from auth.users where id='22222222-2222-2222-2222-222222222222';
  raise notice 'ok  сотрудник с выполненной задачей удаляется';
exception when check_violation then
  raise exception 'FAIL удаление сотрудника заблокировано CHECK-констрейнтом';
end $$;

-- ---------- деактивация закрывает доступ ----------
update public.profiles set is_active=false where id='11111111-1111-1111-1111-111111111111';
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';
select pg_temp.check('деактивированный НЕ видит свои задачи',
  (select count(*)::int from public.tasks), 0);
select pg_temp.check('деактивированный НЕ видит объекты',
  (select count(*)::int from public.properties), 0);
reset role;

update public.profiles set is_active=false where id='33333333-3333-3333-3333-333333333333';
set local role authenticated;
set local request.jwt.claims = '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';
select pg_temp.check('деактивированный менеджер теряет права',
  (select count(*)::int from public.reservations), 0);
reset role;

rollback;
