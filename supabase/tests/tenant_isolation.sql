-- Изоляция тенантов. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- Phase A of multi-tenancy: every operational row carries the host it belongs
-- to, and every policy filters by it. The machinery of a SaaS — per-tenant PMS
-- credentials, tenant onboarding, the platform admin panel — is phase B and
-- waits for the decision to sell.
--
-- What is being protected: a cleaner, a manager and every query they make must
-- stop at the edge of their own company. The check lives in the database, so a
-- second client written later cannot forget it.
--
-- Fixture ids live in the 90000110x range; hosts use fixed uuids so the checks
-- can name them.
begin;

insert into public.hosts (id, name) values
  ('a0000000-0000-4000-8000-00000000000a', 'Host A'),
  ('b0000000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('aa000000-0000-4000-8000-00000000aaaa','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cleaner.a@test.local','x',now(),now(),
   '{"full_name":"Cleaner A"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('bb000000-0000-4000-8000-00000000bbbb','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cleaner.b@test.local','x',now(),now(),
   '{"full_name":"Cleaner B"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('cc000000-0000-4000-8000-00000000cccc','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.a@test.local','x',now(),now(),
   '{"full_name":"Boss A"}'::jsonb, '{"role":"manager"}'::jsonb);

-- The profile trigger puts a new person in the default host; a real tenant is
-- assigned afterwards, which is what a manager panel will do in F10.
update public.profiles set host_id = 'a0000000-0000-4000-8000-00000000000a'
where id in ('aa000000-0000-4000-8000-00000000aaaa', 'cc000000-0000-4000-8000-00000000cccc');
update public.profiles set host_id = 'b0000000-0000-4000-8000-00000000000b'
where id = 'bb000000-0000-4000-8000-00000000bbbb';

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900001101, 'a0000000-0000-4000-8000-00000000000a', 'A flat', 'UTC', '15:00', '10:00'),
  (900001102, 'b0000000-0000-4000-8000-00000000000b', 'B flat', 'UTC', '15:00', '10:00');

insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('a0000000-0000-4000-8000-00000000000a', 900001101,
   'aa000000-0000-4000-8000-00000000aaaa', 'claim'),
  -- Deliberately wrong: cleaner A linked to a listing of host B. Such a row
  -- should never exist, and if it ever does, the tenant predicate — not the
  -- link — is what has to stop her.
  ('b0000000-0000-4000-8000-00000000000b', 900001102,
   'aa000000-0000-4000-8000-00000000aaaa', 'claim');

insert into public.tasks (host_id, property_id, type, status, scheduled_date, notes) values
  ('a0000000-0000-4000-8000-00000000000a', 900001101, 'cleaning', 'unassigned',
   current_date + 1, 'work of host A'),
  ('b0000000-0000-4000-8000-00000000000b', 900001102, 'cleaning', 'unassigned',
   current_date + 1, 'work of host B');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.visible(label text)
returns boolean language sql as $$
  select exists (select 1 from public.tasks t where t.notes = label)
$$;

-- ---------- каждая операционная таблица знает свой тенант ----------
select pg_temp.check('операционные таблицы несут host_id',
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and column_name = 'host_id'
     and table_name in ('profiles','properties','reservations','tasks','property_cleaners')), 5);

-- ---------- клинер видит только свою компанию ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa000000-0000-4000-8000-00000000aaaa","role":"authenticated"}';

select pg_temp.check('клинер знает свой тенант',
  public.current_host_id(), 'a0000000-0000-4000-8000-00000000000a'::uuid);
select pg_temp.check('клинер видит объект своей компании',
  (select count(*)::int from public.properties where id = 900001101), 1);
select pg_temp.check('клинер не видит объект чужой компании',
  (select count(*)::int from public.properties where id = 900001102), 0);
select pg_temp.check('клинер видит задачу своей компании',
  pg_temp.visible('work of host A'), true);
select pg_temp.check('привязка к чужому объекту не открывает чужую задачу',
  pg_temp.visible('work of host B'), false);
select pg_temp.check('клинер не видит сотрудников чужой компании',
  (select count(*)::int from public.profiles
   where id = 'bb000000-0000-4000-8000-00000000bbbb'), 0);

-- Захват чужой задачи: строка не проходит USING, обновление не трогает ничего.
update public.tasks
set assignee_id = 'aa000000-0000-4000-8000-00000000aaaa', status = 'assigned'
where notes = 'work of host B';

reset role;
select pg_temp.check('клинер не может взять задачу чужой компании',
  (select assignee_id from public.tasks where notes = 'work of host B'), null::uuid);

-- ---------- менеджер тоже упирается в границу тенанта ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc000000-0000-4000-8000-00000000cccc","role":"authenticated"}';

select pg_temp.check('менеджер видит все задачи своей компании',
  pg_temp.visible('work of host A'), true);
select pg_temp.check('менеджер не видит задачи чужой компании',
  pg_temp.visible('work of host B'), false);
select pg_temp.check('менеджер не видит чужие объекты',
  (select count(*)::int from public.properties where id = 900001102), 0);

-- Запись в чужой тенант отклоняется WITH CHECK, а не молча уезжает.
do $$
begin
  insert into public.properties (id, host_id, name, timezone)
  values (900001103, 'b0000000-0000-4000-8000-00000000000b', 'Smuggled', 'UTC');
  raise exception 'FAIL менеджер завёл объект в чужом тенанте';
exception when insufficient_privilege then
  raise notice 'ok  менеджер не может завести объект в чужом тенанте';
end $$;

reset role;

-- ---------- новые строки попадают в тенант сами ----------
insert into public.properties (id, name, timezone) values (900001104, 'Defaulted', 'UTC');

select pg_temp.check('объект без явного тенанта попадает в тенант по умолчанию',
  (select host_id from public.properties where id = 900001104),
  public.default_host_id());

rollback;
