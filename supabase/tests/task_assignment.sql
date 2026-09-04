-- Assigning cleaning tasks to cleaners. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- The model: a cleaner is linked to the listings she works on, and each link
-- carries its own mode. 'auto' hands her the task the moment it is generated;
-- 'claim' leaves it in the queue for whoever takes it first. A listing may
-- have at most one 'auto' link — with two, "assign immediately" would have no
-- defined answer.
--
-- Visibility follows the link, not the assignment: a cleaner sees the whole
-- schedule of her listings, including work a colleague has taken.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb);

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900000401, 'Maria works here alone', 'Europe/Prague', '15:00', '10:00'),
  (900000402, 'Shared queue',           'Europe/Prague', '15:00', '10:00'),
  (900000403, 'Nobody linked',          'Europe/Prague', '15:00', '10:00'),
  (900000404, 'Switches to auto later', 'Europe/Prague', '15:00', '10:00'),
  (900000405, 'Manager overrode it',    'Europe/Prague', '15:00', '10:00');

insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900000401, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'auto'),
  (900000402, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'claim'),
  (900000402, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'claim'),
  (900000404, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'claim'),
  (900000405, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'auto');

-- Departures sit inside the cleaner's seven-day horizon, and the dates are
-- relative so they stay there: beyond it a task is invisible to her by policy,
-- and every visibility check below would be answering a different question.
insert into public.reservations (id, property_id, arrival_date, departure_date, status, guest_name) values
  (900000501, 900000401, current_date, current_date + 2, 'new', 'Guest A'),
  (900000502, 900000402, current_date, current_date + 3, 'new', 'Guest B'),
  (900000503, 900000403, current_date, current_date + 4, 'new', 'Guest C'),
  (900000504, 900000404, current_date, current_date + 5, 'new', 'Guest D'),
  (900000505, 900000405, current_date, current_date + 6, 'new', 'Guest E');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.assignee(res_id bigint)
returns uuid language sql as $$
  select t.assignee_id from public.tasks t
  where t.reservation_id = res_id and t.type = 'cleaning' and t.status <> 'cancelled'
$$;

create or replace function pg_temp.status(res_id bigint)
returns text language sql as $$
  select t.status::text from public.tasks t
  where t.reservation_id = res_id and t.type = 'cleaning' and t.status <> 'cancelled'
$$;

-- A task the manager already handed to Maria, on a listing whose auto link
-- points at Anna. The generator must leave it alone.
insert into public.tasks (property_id, reservation_id, type, status, assignee_id, scheduled_date)
values (900000405, 900000505, 'cleaning', 'assigned',
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', current_date + 6);

-- ---------- generation ----------
select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

select pg_temp.check('auto link assigns the task on creation',
  pg_temp.assignee(900000501), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
select pg_temp.check('auto-assigned task is not left unassigned',
  pg_temp.status(900000501), 'assigned');
select pg_temp.check('claim link leaves the task in the queue',
  pg_temp.status(900000502), 'unassigned');
select pg_temp.check('listing with no cleaners still gets a task',
  pg_temp.status(900000503), 'unassigned');
select pg_temp.check('manager assignment survives the generator',
  pg_temp.assignee(900000505), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

-- ---------- one auto per listing ----------
do $$
begin
  insert into public.property_cleaners (property_id, cleaner_id, mode)
  values (900000401, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'auto');
  raise exception 'FAIL a listing accepted a second auto cleaner';
exception when unique_violation then
  raise notice 'ok  a listing accepts at most one auto cleaner';
end $$;

-- ---------- what a cleaner sees ----------
set local role authenticated;
set local request.jwt.claims = '{"sub":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa","role":"authenticated"}';

select pg_temp.check('cleaner sees the whole schedule of her listings',
  (select count(*)::int from public.tasks
   where property_id in (900000401, 900000402, 900000404, 900000405)), 4);
select pg_temp.check('cleaner does not see listings she is not linked to',
  (select count(*)::int from public.tasks where property_id = 900000403), 0);

-- ---------- claiming ----------
update public.tasks set assignee_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                        status = 'assigned'
where reservation_id = 900000502 and status = 'unassigned';

reset role;
select pg_temp.check('cleaner claims a free task on her listing',
  pg_temp.assignee(900000502), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

-- Anna must not be able to take what Maria already holds. The row fails USING
-- on every update policy, so RLS filters it out and nothing changes.
set local role authenticated;
set local request.jwt.claims = '{"sub":"bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb","role":"authenticated"}';
update public.tasks set assignee_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
where reservation_id = 900000502;

-- A listing she has no link to is invisible, so this touches nothing either.
update public.tasks set assignee_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
                        status = 'assigned'
where reservation_id = 900000503;

reset role;
select pg_temp.check('a colleague cannot take work already claimed',
  pg_temp.assignee(900000502), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
select pg_temp.check('a cleaner cannot claim on a listing she is not linked to',
  pg_temp.status(900000503), 'unassigned');

-- ---------- switching a link to auto afterwards ----------
-- The same class of bug as the stale due_at: a mode changed after the task
-- already existed must still take effect on the next run.
update public.property_cleaners set mode = 'auto'
where property_id = 900000404 and cleaner_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

select pg_temp.check('switching a link to auto assigns the waiting task',
  pg_temp.assignee(900000504), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
select pg_temp.check('auto assignment does not disturb claimed work',
  pg_temp.assignee(900000502), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);

rollback;
