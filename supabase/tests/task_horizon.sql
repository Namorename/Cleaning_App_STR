-- How far ahead a cleaner sees and takes work. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- The rule: a cleaner works a rolling window of the next seven days. Beyond it
-- the schedule is still being reshuffled by arrivals and cancellations, and a
-- task taken a month early is a promise nobody can keep.
--
-- The horizon is an upper bound only. Work that has already happened stays
-- visible — the history of a listing is not something to hide from the person
-- who cleaned it.
--
-- Like the grace period, the horizon is enforced by the database, not by the
-- client: it sits in the row policies, so a task beyond it is not returned at
-- all and cannot be claimed even by id.
--
-- Fixture ids live in the 9000008xx range for the same reason as in the other
-- suites: real Hostaway ids are present after F2 and would collide.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('ffffffff-ffff-ffff-ffff-ffffffffffff','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.horizon@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('99999999-9999-9999-9999-999999999999','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.horizon@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb);

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900000801, 'Shared queue',    'UTC',                '15:00', '10:00'),
  (900000802, 'Hers by default', 'UTC',                '15:00', '10:00'),
  -- UTC+14: its local date is today or tomorrow, never yesterday.
  (900000803, 'Furthest east',   'Pacific/Kiritimati', '15:00', '10:00'),
  -- UTC-11: its local date is today or yesterday, never tomorrow.
  (900000804, 'Furthest west',   'Pacific/Niue',       '15:00', '10:00');

insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900000801, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'claim'),
  (900000802, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'auto'),
  (900000803, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'claim'),
  (900000804, 'ffffffff-ffff-ffff-ffff-ffffffffffff', 'claim');

insert into public.tasks (property_id, type, status, assignee_id, scheduled_date, notes) values
  (900000801, 'cleaning', 'unassigned', null, current_date + 3,  'in three days'),
  (900000801, 'cleaning', 'unassigned', null, current_date + 7,  'on the last day of the horizon'),
  (900000801, 'cleaning', 'unassigned', null, current_date + 8,  'one day past the horizon'),
  (900000801, 'cleaning', 'unassigned', null, current_date + 30, 'a month out'),
  (900000802, 'cleaning', 'assigned', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
   current_date + 30, 'hers, a month out'),
  (900000802, 'cleaning', 'assigned', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
   current_date + 1,  'hers, tomorrow'),
  (900000801, 'cleaning', 'done', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
   current_date - 30, 'last month, finished'),
  (900000803, 'cleaning', 'unassigned', null, current_date + 9, 'nine days out, far east'),
  (900000804, 'cleaning', 'unassigned', null, current_date + 6, 'six days out, far west');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.status(label text)
returns text language sql as $$
  select t.status::text from public.tasks t where t.notes = label
$$;

/** Can the caller see this task at all? Run under the role being tested. */
create or replace function pg_temp.visible(label text)
returns boolean language sql as $$
  select exists (select 1 from public.tasks t where t.notes = label)
$$;

select pg_temp.check('the horizon is seven days',
  public.task_horizon_days(), 7);

-- ---------- what the cleaner sees ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"ffffffff-ffff-ffff-ffff-ffffffffffff","role":"authenticated"}';

select pg_temp.check('work three days out is in her queue',
  pg_temp.visible('in three days'), true);
select pg_temp.check('the last day of the horizon is still hers to see',
  pg_temp.visible('on the last day of the horizon'), true);
select pg_temp.check('one day past the horizon is not shown',
  pg_temp.visible('one day past the horizon'), false);
select pg_temp.check('a month out is not shown',
  pg_temp.visible('a month out'), false);

-- The horizon applies to her own work too, not only to the shared queue.
select pg_temp.check('her own task a month out is not shown either',
  pg_temp.visible('hers, a month out'), false);
select pg_temp.check('her own task tomorrow is shown',
  pg_temp.visible('hers, tomorrow'), true);

-- An upper bound only.
select pg_temp.check('work she finished last month is still hers to look back on',
  pg_temp.visible('last month, finished'), true);

-- Judged in the listing's own timezone, not in UTC.
select pg_temp.check('nine days out is past the horizon even fourteen hours ahead of UTC',
  pg_temp.visible('nine days out, far east'), false);
select pg_temp.check('six days out is inside the horizon even eleven hours behind UTC',
  pg_temp.visible('six days out, far west'), true);

-- ---------- what the cleaner can take ----------

-- Beyond the horizon: invisible to the policy, so the update matches no row.
update public.tasks
set assignee_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff', status = 'assigned'
where notes in ('one day past the horizon', 'a month out', 'nine days out, far east');

-- On the boundary: an ordinary claim.
update public.tasks
set assignee_id = 'ffffffff-ffff-ffff-ffff-ffffffffffff', status = 'assigned'
where notes = 'on the last day of the horizon';

reset role;

select pg_temp.check('a task one day past the horizon cannot be claimed',
  pg_temp.status('one day past the horizon'), 'unassigned');
select pg_temp.check('a task a month out cannot be claimed',
  pg_temp.status('a month out'), 'unassigned');
select pg_temp.check('the far-east task past the horizon cannot be claimed',
  pg_temp.status('nine days out, far east'), 'unassigned');
select pg_temp.check('the last day of the horizon can be claimed',
  pg_temp.status('on the last day of the horizon'), 'assigned');

-- ---------- the manager is not on a horizon ----------
set local role authenticated;
set local request.jwt.claims =
  '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';

select pg_temp.check('the manager sees the whole schedule, near and far',
  (select count(*)::int from public.tasks
   where property_id between 900000801 and 900000804), 9);

reset role;

rollback;
