-- Tenant isolation. Run: npm run test:rls
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

-- The pg_temp helpers below are created by postgres, whose new functions no
-- longer go to PUBLIC (20260926100000), and they are called as authenticated
-- too. Hand them to that role for the length of this transaction.
alter default privileges for role postgres grant execute on functions to authenticated;

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

-- ---------- every operational table knows its tenant ----------
select pg_temp.check('operational tables carry host_id',
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and column_name = 'host_id'
     and table_name in ('profiles','properties','reservations','tasks','property_cleaners')), 5);

-- ---------- an owner-privileged function is not handed to the client ----------
-- reservation_cleaning_window is security definer and filters by no host_id:
-- it answers about any booking by its id, another company's included. No
-- client reaches it -- its only caller, generate_cleaning_tasks, is security
-- definer itself and gets there with the owner's privileges -- so the client
-- role holds no grant on it and must not.
select pg_temp.check('the cleaning window is not callable by a client role',
  has_function_privilege('authenticated',
    'public.reservation_cleaning_window(bigint, bigint)', 'execute'), false);
select pg_temp.check('the cleaning window stays with service_role',
  has_function_privilege('service_role',
    'public.reservation_cleaning_window(bigint, bigint)', 'execute'), true);

-- Its caller neither: generate_cleaning_tasks runs over every company at once
-- and writes tasks with the owner's rights. Only the Edge Functions call it
-- (sync-reservations and process-webhook-events), as service_role.
select pg_temp.check('the generator is not callable by authenticated',
  has_function_privilege('authenticated',
    'public.generate_cleaning_tasks(date, date)', 'execute'), false);
select pg_temp.check('nor by anon',
  has_function_privilege('anon',
    'public.generate_cleaning_tasks(date, date)', 'execute'), false);
select pg_temp.check('the generator stays with service_role',
  has_function_privilege('service_role',
    'public.generate_cleaning_tasks(date, date)', 'execute'), true);

-- ---------- a cleaner sees their own company only ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"aa000000-0000-4000-8000-00000000aaaa","role":"authenticated"}';

select pg_temp.check('a cleaner knows their tenant',
  public.current_host_id(), 'a0000000-0000-4000-8000-00000000000a'::uuid);
select pg_temp.check('a cleaner sees a listing of their own company',
  (select count(*)::int from public.properties where id = 900001101), 1);
select pg_temp.check('a cleaner does not see a listing of another company',
  (select count(*)::int from public.properties where id = 900001102), 0);
select pg_temp.check('a cleaner sees a task of their own company',
  pg_temp.visible('work of host A'), true);
select pg_temp.check('a link to a listing of another company does not open its task',
  pg_temp.visible('work of host B'), false);
select pg_temp.check('a cleaner does not see the staff of another company',
  (select count(*)::int from public.profiles
   where id = 'bb000000-0000-4000-8000-00000000bbbb'), 0);

-- Taking another company's task: the row fails USING, the update touches nothing.
update public.tasks
set assignee_id = 'aa000000-0000-4000-8000-00000000aaaa', status = 'assigned'
where notes = 'work of host B';

reset role; reset request.jwt.claims;
select pg_temp.check('a cleaner cannot take a task of another company',
  (select assignee_id from public.tasks where notes = 'work of host B'), null::uuid);

-- ---------- a manager meets the tenant boundary too ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"cc000000-0000-4000-8000-00000000cccc","role":"authenticated"}';

select pg_temp.check('a manager sees every task of their own company',
  pg_temp.visible('work of host A'), true);
select pg_temp.check('a manager does not see the tasks of another company',
  pg_temp.visible('work of host B'), false);
select pg_temp.check('a manager does not see the listings of another company',
  (select count(*)::int from public.properties where id = 900001102), 0);

-- A write into another tenant is refused by WITH CHECK, not carried off silently.
do $$
begin
  insert into public.properties (id, host_id, name, timezone)
  values (900001103, 'b0000000-0000-4000-8000-00000000000b', 'Smuggled', 'UTC');
  raise exception 'FAIL a manager created a listing in another tenant';
exception when insufficient_privilege then
  raise notice 'ok  a manager cannot create a listing in another tenant';
end $$;

reset role; reset request.jwt.claims;
-- ---------- new rows land in their tenant by themselves ----------
insert into public.properties (id, name, timezone) values (900001104, 'Defaulted', 'UTC');

select pg_temp.check('a listing with no explicit tenant lands in the default one',
  (select host_id from public.properties where id = 900001104),
  public.default_host_id());

rollback;
