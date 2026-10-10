-- «Выполненные» on the phone's «Мои» (owner, 2026-10-10). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- The phone reads her own finished jobs of the last 30 days by assignee
-- (apps/mobile/src/features/tasks/api.ts, fetchMyDoneTasks): assignee_id = her,
-- status done, completed_at from the start of the window, newest first. No new
-- right is needed: "assignee reads own tasks" has no lower bound in time
-- (task_horizon.sql). This suite pins what the list relies on — her finished
-- job on a listing she no longer cleans, its steps, a technician's finished
-- repair — and what it must not be given: a colleague's finished cleaning on a
-- listing she has left, or anybody's after an account is switched off.
--
-- Fixture ids live in the 9000009xx range, as in the other suites.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('a0000000-0000-4000-8000-000000000901','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.done@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a0000000-0000-4000-8000-000000000902','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','olga.done@test.local','x',now(),now(),
   '{"full_name":"Olga"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a0000000-0000-4000-8000-000000000903','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','ivan.done@test.local','x',now(),now(),
   '{"full_name":"Ivan"}'::jsonb, '{"role":"tech"}'::jsonb);

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900000901, 'Left behind', 'UTC', '15:00', '10:00'),
  (900000902, 'Still hers',  'UTC', '15:00', '10:00');

-- Maria cleans only the second listing now; Olga cleaned the first and
-- cleans the second beside her.
insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900000902, 'a0000000-0000-4000-8000-000000000901', 'claim'),
  (900000901, 'a0000000-0000-4000-8000-000000000902', 'claim'),
  (900000902, 'a0000000-0000-4000-8000-000000000902', 'claim');

insert into public.tasks (property_id, type, status, assignee_id, scheduled_date,
                          started_at, completed_at, notes) values
  (900000901, 'cleaning', 'done', 'a0000000-0000-4000-8000-000000000901',
   current_date - 20, now() - interval '20 days 2 hours', now() - interval '20 days',
   'hers, on a listing she left'),
  (900000902, 'cleaning', 'done', 'a0000000-0000-4000-8000-000000000901',
   current_date - 2, now() - interval '2 days 2 hours', now() - interval '2 days',
   'hers, two days ago'),
  (900000902, 'cleaning', 'done', 'a0000000-0000-4000-8000-000000000901',
   current_date - 45, now() - interval '45 days 2 hours', now() - interval '45 days',
   'hers, before the window'),
  (900000901, 'cleaning', 'done', 'a0000000-0000-4000-8000-000000000902',
   current_date - 5, now() - interval '5 days 2 hours', now() - interval '5 days',
   'a colleague''s, on the listing she left'),
  (900000902, 'cleaning', 'done', 'a0000000-0000-4000-8000-000000000902',
   current_date - 1, now() - interval '1 day 2 hours', now() - interval '1 day',
   'a colleague''s, on her listing'),
  (900000901, 'maintenance', 'done', 'a0000000-0000-4000-8000-000000000903',
   current_date - 3, now() - interval '3 days 2 hours', now() - interval '3 days',
   'his repair');

insert into public.task_steps (task_id, sort_order, type, required, title, completed_at)
select t.id, 1, 'confirmation', true, 'Final check', t.completed_at
from public.tasks t
where t.notes in ('hers, on a listing she left', 'his repair');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

/** What the phone's «Выполненные» read returns for the caller, newest first. */
create or replace function pg_temp.done_list(who uuid)
returns text language sql as $$
  select coalesce(string_agg(t.notes, ' | ' order by t.completed_at desc, t.id desc), '')
  from public.tasks t
  where t.assignee_id = who
    and t.status = 'done'
    and t.completed_at >= date_trunc('day', now()) - interval '30 days'
$$;

create or replace function pg_temp.visible(label text)
returns boolean language sql as $$
  select exists (select 1 from public.tasks t where t.notes = label)
$$;

create or replace function pg_temp.steps_of(label text)
returns bigint language sql as $$
  select count(*) from public.task_steps s
  join public.tasks t on t.id = s.task_id
  where t.notes = label
$$;

-- ---------- the cleaner ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a0000000-0000-4000-8000-000000000901","role":"authenticated"}';

select pg_temp.check('her finished jobs of the window, newest first, and only hers',
  pg_temp.done_list('a0000000-0000-4000-8000-000000000901'),
  'hers, two days ago | hers, on a listing she left');
select pg_temp.check('her finished job stays hers after she stopped cleaning its listing',
  pg_temp.visible('hers, on a listing she left'), true);
select pg_temp.check('its steps come with it, for the screen that opens it',
  pg_temp.steps_of('hers, on a listing she left'), 1::bigint);
select pg_temp.check('older than the window: still hers by right, left out by the read only',
  pg_temp.visible('hers, before the window'), true);
select pg_temp.check('a colleague''s finished cleaning on a listing she left is not shown',
  pg_temp.visible('a colleague''s, on the listing she left'), false);
-- Why the phone reads by assignee: on a listing she cleans, the row policies
-- show her a colleague's finished cleaning too, and that is not her history.
select pg_temp.check('a colleague''s finished cleaning on her listing is visible to her',
  pg_temp.visible('a colleague''s, on her listing'), true);
select pg_temp.check('and is not in her «Выполненные», which the read takes by assignee',
  position('a colleague''s' in pg_temp.done_list('a0000000-0000-4000-8000-000000000901')), 0);

-- ---------- the technician ----------
reset role;
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a0000000-0000-4000-8000-000000000903","role":"authenticated"}';

select pg_temp.check('his finished repair is in his «Выполненные»',
  pg_temp.done_list('a0000000-0000-4000-8000-000000000903'), 'his repair');
select pg_temp.check('with its steps',
  pg_temp.steps_of('his repair'), 1::bigint);
select pg_temp.check('a cleaner''s finished job is not his to see',
  pg_temp.visible('hers, two days ago'), false);

-- ---------- an account switched off ----------
-- As the office's own write, not hers: with her claims still set, the guard on
-- her profile would keep the flag as it was.
reset role;
set local request.jwt.claims = '{}';
update public.profiles set is_active = false
where id = 'a0000000-0000-4000-8000-000000000901';
select pg_temp.check('the switch took',
  (select is_active from public.profiles
   where id = 'a0000000-0000-4000-8000-000000000901'), false);

set local role authenticated;
set local request.jwt.claims =
  '{"sub":"a0000000-0000-4000-8000-000000000901","role":"authenticated"}';

select pg_temp.check('switched off, she reads no history at all',
  pg_temp.done_list('a0000000-0000-4000-8000-000000000901'), '');

reset role;
rollback;
