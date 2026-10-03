-- The head technician (docs/tech-plan.md, §3; owner's decisions 1, 4, 5, 7, 8
-- of 2026-10-01). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: he sees every task of his company (problems) with
-- its history — archived ones too — the repairs that answer them, with their
-- steps, photos and conversation, and the places those tasks are about, door
-- codes included. He hands repairs to technicians, himself among them, and
-- takes a technician off one; cancelling, closing and archiving stay with the
-- manager. Everything else is as closed to him as to any technician: cleanings
-- of every kind and all that hangs off them, bookings, the free queue and the
-- take, colleagues' addresses and phones, places with no task, supply
-- requests, the office's notes. His colleagues' names come from a directory.
--
-- Fixture ids live in the 9000320xx range and under b32….
begin;

-- The pg_temp helpers below are created by postgres, whose new functions no
-- longer go to PUBLIC (20260926100000), and they are called as authenticated
-- too. Hand them to that role for the length of this transaction.
alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('b3200000-0000-4000-8000-00000000000a', 'Host H'),
  ('b3200000-0000-4000-8000-00000000000b', 'Host O');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b3200001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.headtech@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b3200002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','hector.headtech@test.local','x',now(),now(),
   '{"full_name":"Hector"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('b3200003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tomas.headtech@test.local','x',now(),now(),
   '{"full_name":"Tomas"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('b3200004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','petr.headtech@test.local','x',now(),now(),
   '{"full_name":"Petr"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('b3200005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.headtech@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b3200006-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gone.headtech@test.local','x',now(),now(),
   '{"full_name":"Gone"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('b3200007-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','idle.headtech@test.local','x',now(),now(),
   '{"full_name":"Idle"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('b3200009-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','olga.headtech@test.local','x',now(),now(),
   '{"full_name":"Olga"}'::jsonb, '{"role":"head_tech"}'::jsonb);

update public.profiles set host_id = 'b3200000-0000-4000-8000-00000000000a',
                           phone = '+420 000 000 ' || right(id::text, 3)
where id::text like 'b320000%' and id <> 'b3200009-0000-4000-8000-000000000009';
update public.profiles set host_id = 'b3200000-0000-4000-8000-00000000000b'
where id = 'b3200009-0000-4000-8000-000000000009';
update public.profiles set is_active = false where id = 'b3200006-0000-4000-8000-000000000006';
update public.profiles set is_active = false where id = 'b3200007-0000-4000-8000-000000000007';

-- Leak flat has tasks and a cleaner; Quiet flat has none, only cleanings and a
-- manual repair; the house has a task on a room; Old flat only an archived one.
insert into public.properties (id, host_id, name, address, timezone, cleaner_notes) values
  (900032001, 'b3200000-0000-4000-8000-00000000000a', 'Leak flat, door 4711', 'Main st 1', 'UTC', 'key box 1234'),
  (900032002, 'b3200000-0000-4000-8000-00000000000a', 'Quiet flat, door 0000', 'Side st 2', 'UTC', 'key under mat'),
  (900032003, 'b3200000-0000-4000-8000-00000000000a', 'House', 'Hill 3', 'UTC', null),
  (900032004, 'b3200000-0000-4000-8000-00000000000a', 'Old flat', 'Old st 4', 'UTC', null),
  (900032009, 'b3200000-0000-4000-8000-00000000000b', 'Their flat', 'Far 9', 'UTC', null);
insert into public.properties (id, host_id, hostaway_unit_id, parent_id, name, timezone) values
  (public.property_id_for_unit(93201), 'b3200000-0000-4000-8000-00000000000a', 93201,
   900032003, 'House room', 'UTC'),
  (public.property_id_for_unit(93202), 'b3200000-0000-4000-8000-00000000000a', 93202,
   900032003, 'House other room', 'UTC');

insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('b3200000-0000-4000-8000-00000000000a', 900032001, 'b3200005-0000-4000-8000-000000000005', 'claim');

insert into public.reservations (id, host_id, property_id, arrival_date, departure_date, status, guest_name)
values (900032101, 'b3200000-0000-4000-8000-00000000000a', 900032001,
        current_date - 2, current_date, 'new', 'Guest Guestson');

insert into public.problems (id, host_id, property_id, reported_by, title) values
  ('b3203001-0000-4000-8000-000000000001', 'b3200000-0000-4000-8000-00000000000a', 900032001,
   'b3200005-0000-4000-8000-000000000005', 'Tap leaks'),
  ('b3203001-0000-4000-8000-000000000002', 'b3200000-0000-4000-8000-00000000000a', 900032004,
   'b3200005-0000-4000-8000-000000000005', 'Old crack'),
  ('b3203001-0000-4000-8000-000000000003', 'b3200000-0000-4000-8000-00000000000a',
   public.property_id_for_unit(93201), 'b3200005-0000-4000-8000-000000000005', 'Room lamp'),
  ('b3203001-0000-4000-8000-000000000004', 'b3200000-0000-4000-8000-00000000000a', 900032001,
   'b3200005-0000-4000-8000-000000000005', 'Door squeaks'),
  ('b3203001-0000-4000-8000-000000000009', 'b3200000-0000-4000-8000-00000000000b', 900032009,
   'b3200009-0000-4000-8000-000000000009', 'Their roof');

insert into public.tasks (id, host_id, property_id, type, status, assignee_id, scheduled_date, problem_id)
values
  ('b3202001-0000-4000-8000-000000000001', 'b3200000-0000-4000-8000-00000000000a', 900032001,
   'cleaning', 'assigned', 'b3200005-0000-4000-8000-000000000005', current_date, null),
  ('b3202001-0000-4000-8000-000000000002', 'b3200000-0000-4000-8000-00000000000a', 900032001,
   'inspection', 'assigned', 'b3200005-0000-4000-8000-000000000005', current_date, null),
  ('b3202001-0000-4000-8000-000000000003', 'b3200000-0000-4000-8000-00000000000a', 900032001,
   'midstay', 'assigned', 'b3200005-0000-4000-8000-000000000005', current_date, null),
  ('b3202001-0000-4000-8000-000000000004', 'b3200000-0000-4000-8000-00000000000a', 900032001,
   'cleaning', 'unassigned', null, current_date, null),
  -- The repair of the leak, held by Tomas.
  ('b3202001-0000-4000-8000-000000000005', 'b3200000-0000-4000-8000-00000000000a', 900032001,
   'maintenance', 'assigned', 'b3200003-0000-4000-8000-000000000003', current_date,
   'b3203001-0000-4000-8000-000000000001'),
  -- A manual repair with no task behind it: the office's, not his.
  ('b3202001-0000-4000-8000-000000000006', 'b3200000-0000-4000-8000-00000000000a', 900032002,
   'maintenance', 'assigned', 'b3200003-0000-4000-8000-000000000003', current_date, null),
  -- A cleaning that never happened: the office's review lists it.
  ('b3202001-0000-4000-8000-000000000007', 'b3200000-0000-4000-8000-00000000000a', 900032002,
   'cleaning', 'expired', 'b3200005-0000-4000-8000-000000000005', current_date - 3, null),
  -- The finished repair of the old crack: history.
  ('b3202001-0000-4000-8000-000000000008', 'b3200000-0000-4000-8000-00000000000a', 900032004,
   'maintenance', 'done', 'b3200004-0000-4000-8000-000000000004', current_date - 20,
   'b3203001-0000-4000-8000-000000000002'),
  -- Another company's repair.
  ('b3202001-0000-4000-8000-000000000009', 'b3200000-0000-4000-8000-00000000000b', 900032009,
   'maintenance', 'assigned', 'b3200009-0000-4000-8000-000000000009', current_date,
   'b3203001-0000-4000-8000-000000000009');

update public.problems set status = 'resolved', resolved_at = now() - interval '19 days',
                           archived_at = now() - interval '10 days'
where id = 'b3203001-0000-4000-8000-000000000002';

-- A step and a photo on the repair, a step and a photo on the cleaning, and a
-- photo the reporter took of the leak.
insert into public.task_steps (id, task_id, host_id, sort_order, type, required) values
  ('b3204001-0000-4000-8000-000000000001', 'b3202001-0000-4000-8000-000000000005',
   'b3200000-0000-4000-8000-00000000000a', 1, 'photos_after', true),
  ('b3204001-0000-4000-8000-000000000002', 'b3202001-0000-4000-8000-000000000001',
   'b3200000-0000-4000-8000-00000000000a', 1, 'photos_before', true);
insert into public.task_media (id, host_id, task_id, step_id, problem_id, kind, storage_path,
                               mime_type, byte_size, created_by) values
  ('b3205001-0000-4000-8000-000000000001', 'b3200000-0000-4000-8000-00000000000a',
   'b3202001-0000-4000-8000-000000000005', 'b3204001-0000-4000-8000-000000000001', null, 'photo',
   'b3200000-0000-4000-8000-00000000000a/b3202001-0000-4000-8000-000000000005/b3205001-0000-4000-8000-000000000001.jpg',
   'image/jpeg', 400000, 'b3200003-0000-4000-8000-000000000003'),
  ('b3205001-0000-4000-8000-000000000002', 'b3200000-0000-4000-8000-00000000000a',
   'b3202001-0000-4000-8000-000000000001', 'b3204001-0000-4000-8000-000000000002', null, 'photo',
   'b3200000-0000-4000-8000-00000000000a/b3202001-0000-4000-8000-000000000001/b3205001-0000-4000-8000-000000000002.jpg',
   'image/jpeg', 400000, 'b3200005-0000-4000-8000-000000000005'),
  ('b3205001-0000-4000-8000-000000000003', 'b3200000-0000-4000-8000-00000000000a',
   null, null, 'b3203001-0000-4000-8000-000000000001', 'photo',
   'b3200000-0000-4000-8000-00000000000a/problems/b3203001-0000-4000-8000-000000000001/b3205001-0000-4000-8000-000000000003.jpg',
   'image/jpeg', 400000, 'b3200005-0000-4000-8000-000000000005');

insert into public.supply_requests (id, host_id, property_id, requested_by) values
  ('b3206001-0000-4000-8000-000000000001', 'b3200000-0000-4000-8000-00000000000a', 900032001,
   'b3200005-0000-4000-8000-000000000005');
insert into public.property_internal_notes (property_id, host_id, notes) values
  (900032001, 'b3200000-0000-4000-8000-00000000000a', 'Owner is difficult');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

/** The i18n key and parameters of a refusal, or 'no refusal' when it went through. */
create or replace function pg_temp.refusal(stmt text) returns text
language plpgsql as $fn$
declare
  v_hint   text;
  v_detail text;
begin
  execute stmt;
  return 'no refusal';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return coalesce(v_hint, '(no hint: ' || sqlerrm || ')') || coalesce(' ' || nullif(v_detail, ''), '');
end $fn$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $fn$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$fn$;
create or replace function pg_temp.as_boss()   returns void language sql as $fn$
  select pg_temp.as_user('b3200001-0000-4000-8000-000000000001') $fn$;
create or replace function pg_temp.as_hector() returns void language sql as $fn$
  select pg_temp.as_user('b3200002-0000-4000-8000-000000000002') $fn$;
create or replace function pg_temp.as_tomas()  returns void language sql as $fn$
  select pg_temp.as_user('b3200003-0000-4000-8000-000000000003') $fn$;
create or replace function pg_temp.as_petr()   returns void language sql as $fn$
  select pg_temp.as_user('b3200004-0000-4000-8000-000000000004') $fn$;
create or replace function pg_temp.as_anna()   returns void language sql as $fn$
  select pg_temp.as_user('b3200005-0000-4000-8000-000000000005') $fn$;
create or replace function pg_temp.as_gone()   returns void language sql as $fn$
  select pg_temp.as_user('b3200006-0000-4000-8000-000000000006') $fn$;
create or replace function pg_temp.as_olga()   returns void language sql as $fn$
  select pg_temp.as_user('b3200009-0000-4000-8000-000000000009') $fn$;

-- What the caller can read, by name, so a wrong row shows up as itself.
create or replace function pg_temp.problems_seen() returns text language sql as $fn$
  select coalesce(string_agg(title, ', ' order by title), '(none)') from public.problems
  where id::text like 'b3203001-%' $fn$;
create or replace function pg_temp.tasks_seen() returns text language sql as $fn$
  select coalesce(string_agg(right(id::text, 2) || ' ' || type::text, ', ' order by id), '(none)')
  from public.tasks where id::text like 'b3202001-%' $fn$;
create or replace function pg_temp.places_seen() returns text language sql as $fn$
  select coalesce(string_agg(name, ', ' order by name), '(none)') from public.properties
  where id between 900032001 and 900032099
     or id in (public.property_id_for_unit(93201), public.property_id_for_unit(93202)) $fn$;

create or replace function pg_temp.pid(n integer) returns uuid language sql immutable as $fn$
  select ('b3203001-0000-4000-8000-00000000000' || n::text)::uuid $fn$;
create or replace function pg_temp.live_fix(n integer) returns public.tasks language sql as $fn$
  select t.* from public.tasks t
  where t.problem_id = pg_temp.pid(n) and t.status not in ('done', 'cancelled', 'expired') $fn$;

-- The conversations, opened by the people who would open them.
select pg_temp.as_anna();
select public.send_message('b3207001-0000-4000-8000-000000000001', 'Капает под мойкой',
                           null, pg_temp.pid(1));
select public.send_message('b3207001-0000-4000-8000-000000000002', 'Заболела',
                           null, null, 'b3200005-0000-4000-8000-000000000005');
select pg_temp.as_boss();
select public.send_message('b3207001-0000-4000-8000-000000000003', 'Ключ в ящике',
                           'b3202001-0000-4000-8000-000000000001');
select public.send_message('b3207001-0000-4000-8000-000000000004', 'Трещину заделали',
                           null, pg_temp.pid(2));
reset role; reset request.jwt.claims;

-- ---------------------------------------------------------------------------
--  What he sees
-- ---------------------------------------------------------------------------

select pg_temp.as_hector();

select pg_temp.check('the head technician sees every task of his company, the archived one too',
  pg_temp.problems_seen(), 'Door squeaks, Old crack, Room lamp, Tap leaks');
select pg_temp.check('the repairs that answer them, the finished one too — and nothing else',
  pg_temp.tasks_seen(), '05 maintenance, 08 maintenance');
select pg_temp.check('the steps of a repair',
  (select count(*)::int from public.task_steps
   where id = 'b3204001-0000-4000-8000-000000000001'), 1);
select pg_temp.check('its photos and the photo of the task itself',
  (select string_agg(right(id::text, 1), ',' order by id) from public.task_media
   where id::text like 'b3205001-%'), '1,3');
select pg_temp.check('and their files',
  public.can_read_task_media(
    'b3200000-0000-4000-8000-00000000000a/b3202001-0000-4000-8000-000000000005/b3205001-0000-4000-8000-000000000001.jpg'),
  true);
select pg_temp.check('the places with tasks, the house of a room among them — and only those',
  pg_temp.places_seen(), 'House, House room, Leak flat, door 4711, Old flat');
select pg_temp.check('with the address and the key box',
  (select address || ' / ' || public.effective_cleaner_notes(p) from public.properties p
   where id = 900032001), 'Main st 1 / key box 1234');
select pg_temp.check('the conversation of every task, the archived one too',
  (select string_agg(right(id::text, 1), ',' order by id) from public.chat_messages
   where id::text like 'b3207001-%'), '1,4');
select pg_temp.check('a repair''s conversation is its task''s',
  (select (public.open_thread('b3202001-0000-4000-8000-000000000005')).problem_id), pg_temp.pid(1));

select pg_temp.check('what the reporter said is unread to him',
  (select count(*)::int from public.chat_unread_threads(null, array[pg_temp.pid(1)])), 1);

select pg_temp.check('he writes in it',
  pg_temp.refusal($q$select public.send_message('b3207002-0000-4000-8000-000000000001',
    'Буду в 14:00', null, pg_temp.pid(1))$q$), 'no refusal');
select pg_temp.check('in the conversation of a task nobody has taken',
  pg_temp.refusal($q$select public.send_message('b3207002-0000-4000-8000-000000000002',
    'Посмотрю завтра', null, pg_temp.pid(4))$q$), 'no refusal');
select pg_temp.check('and of an archived one',
  pg_temp.refusal($q$select public.send_message('b3207002-0000-4000-8000-000000000003',
    'Это было в мае', null, pg_temp.pid(2))$q$), 'no refusal');

-- Colleagues by name and role, from the directory; nothing else of theirs.
select pg_temp.check('the directory names his colleagues and their roles',
  (select string_agg(full_name || ':' || role::text || case when is_active then '' else ':off' end,
                     ', ' order by full_name)
   from public.staff_directory()),
  'Anna:cleaner, Boss:manager, Gone:head_tech:off, Hector:head_tech, Idle:tech:off, '
  || 'Petr:tech, Tomas:tech');
select pg_temp.check('and says no more than that',
  pg_get_function_result('public.staff_directory()'::regprocedure),
  'TABLE(id uuid, full_name text, role app_role, is_active boolean)');

-- ---------------------------------------------------------------------------
--  What he does not see
-- ---------------------------------------------------------------------------

select pg_temp.check('no cleaning, inspection or mid-stay cleaning, free or handed out',
  (select count(*)::int from public.tasks
   where id::text like 'b3202001-%' and type in ('cleaning', 'inspection', 'midstay')), 0);
select pg_temp.check('nor their steps',
  (select count(*)::int from public.task_steps
   where id = 'b3204001-0000-4000-8000-000000000002'), 0);
select pg_temp.check('nor their photos',
  public.can_read_task_media(
    'b3200000-0000-4000-8000-00000000000a/b3202001-0000-4000-8000-000000000001/b3205001-0000-4000-8000-000000000002.jpg'),
  false);
select pg_temp.check('nor their conversations',
  pg_temp.refusal($q$select public.open_thread('b3202001-0000-4000-8000-000000000001')$q$),
  'serverErrors.threadNotFound');
select pg_temp.check('nor write in one',
  pg_temp.refusal($q$select public.send_message('b3207002-0000-4000-8000-000000000004',
    'Подслушал', 'b3202001-0000-4000-8000-000000000001')$q$),
  'serverErrors.threadNotFound');
select pg_temp.check('nor a cleaner''s conversation with the office',
  (select count(*)::int from public.chat_threads
   where profile_id = 'b3200005-0000-4000-8000-000000000005'), 0);
select pg_temp.check('no bookings',
  (select count(*)::int from public.reservations where id = 900032101), 0);
with taken as (
  update public.tasks
  set assignee_id = 'b3200002-0000-4000-8000-000000000002', status = 'accepted'
  where id = 'b3202001-0000-4000-8000-000000000004'
  returning id)
select pg_temp.check('no free queue and no take', (select count(*)::int from taken), 0);
select pg_temp.check('no colleague''s profile: neither address nor phone',
  (select count(*)::int from public.profiles where id::text like 'b320000%'), 1);
select pg_temp.check('no place without a task',
  (select count(*)::int from public.properties where id in (900032002, 900032009)), 0);
select pg_temp.check('no supply request',
  (select count(*)::int from public.supply_requests where id::text like 'b3206001-%'), 0);
select pg_temp.check('no office note',
  (select count(*)::int from public.property_internal_notes where property_id = 900032001), 0);
select pg_temp.check('no missed cleanings',
  (select count(*)::int from public.expired_tasks_review where property_id between 900032001 and 900032099), 0);
select pg_temp.check('nor the office''s count of open cleanings',
  pg_temp.refusal($q$select public.property_open_cleanings(900032001)$q$),
  'serverErrors.managerOnly');
select pg_temp.check('another company''s task is nowhere',
  (select count(*)::int from public.problems where id = pg_temp.pid(9))
  + (select count(*)::int from public.tasks where id = 'b3202001-0000-4000-8000-000000000009'), 0);
reset role; reset request.jwt.claims;

-- Switched off, he is nobody.
select pg_temp.as_gone();
select pg_temp.check('a dismissed head technician sees no task',
  pg_temp.problems_seen(), '(none)');
select pg_temp.check('nor any place', pg_temp.places_seen(), '(none)');
select pg_temp.check('nor any colleague', (select count(*)::int from public.staff_directory()), 0);
reset role; reset request.jwt.claims;

-- The head technician of another company sees nothing of this one.
select pg_temp.as_olga();
select pg_temp.check('another company''s head technician sees only his own',
  pg_temp.problems_seen(), 'Their roof');
select pg_temp.check('and none of our people',
  (select count(*)::int from public.staff_directory() where id::text <> 'b3200009-0000-4000-8000-000000000009'), 0);
reset role; reset request.jwt.claims;

-- ---------------------------------------------------------------------------
--  Nothing changes beside him
-- ---------------------------------------------------------------------------

select pg_temp.as_tomas();
select pg_temp.check('a technician still sees only the task of his own repair',
  pg_temp.problems_seen(), 'Tap leaks');
select pg_temp.check('and his own work',
  pg_temp.tasks_seen(), '05 maintenance, 06 maintenance');
select pg_temp.check('and no directory',
  (select count(*)::int from public.staff_directory()), 0);

select pg_temp.as_anna();
select pg_temp.check('a cleaner sees what she reported and is not archived',
  pg_temp.problems_seen(), 'Door squeaks, Room lamp, Tap leaks');
select pg_temp.check('and her cleanings, the free one on her flat among them',
  pg_temp.tasks_seen(),
  '01 cleaning, 02 inspection, 03 midstay, 04 cleaning, 05 maintenance, 07 cleaning');

select pg_temp.as_boss();
select pg_temp.check('the manager sees every task',
  pg_temp.problems_seen(), 'Door squeaks, Old crack, Room lamp, Tap leaks');
select pg_temp.check('and all the work of the company',
  (select count(*)::int from public.tasks where id::text like 'b3202001-%'), 8);
reset role; reset request.jwt.claims;

-- The role check runs once a query, not once a row: the manager's policy sorts
-- before his and never reaches it; for anybody else it is an InitPlan.
set local track_functions = 'all';
create or replace function pg_temp.calls(fn text) returns integer language sql as $fn$
  select coalesce(sum(calls), 0)::int from pg_stat_xact_user_functions
  where schemaname = 'public' and funcname = fn $fn$;
create temp table ht_calls on commit drop as
  select pg_temp.calls('is_head_tech') as role_calls,
         pg_temp.calls('head_tech_property_ids') as place_calls;

select pg_temp.as_anna();
select count(*) from public.tasks where id::text like 'b3202001-%';
reset role; reset request.jwt.claims;
select pg_temp.check('a cleaner''s feed asks about the role once, whatever its length',
  pg_temp.calls('is_head_tech') - (select role_calls from ht_calls), 1);
select pg_temp.as_anna();
select count(*) from public.properties where id between 900032001 and 900032099;
reset role; reset request.jwt.claims;
select pg_temp.check('and her places once more, never his list of places',
  array[pg_temp.calls('is_head_tech') - (select role_calls from ht_calls),
        pg_temp.calls('head_tech_property_ids') - (select place_calls from ht_calls)],
  array[2, 0]);

truncate ht_calls;
insert into ht_calls select pg_temp.calls('is_head_tech'), pg_temp.calls('head_tech_property_ids');
select pg_temp.as_boss();
select count(*) from public.problems where id::text like 'b3203001-%';
select count(*) from public.tasks where id::text like 'b3202001-%';
select count(*) from public.properties where id between 900032001 and 900032099;
reset role; reset request.jwt.claims;
select pg_temp.check('the manager never pays for it',
  pg_temp.calls('is_head_tech') - (select role_calls from ht_calls), 0);
select pg_temp.check('nor anybody for his places but him',
  pg_temp.calls('head_tech_property_ids') - (select place_calls from ht_calls), 0);

-- ---------------------------------------------------------------------------
--  He hands repairs to technicians
-- ---------------------------------------------------------------------------

select pg_temp.as_hector();
select public.assign_problem(pg_temp.pid(4), 'b3200003-0000-4000-8000-000000000003');
reset role; reset request.jwt.claims;
select pg_temp.check('the head technician hands a task to a technician',
  (select (pg_temp.live_fix(4)).assignee_id), 'b3200003-0000-4000-8000-000000000003'::uuid);
select pg_temp.check('the task is assigned',
  (select status::text from public.problems where id = pg_temp.pid(4)), 'assigned');
select pg_temp.check('and the repair says who handed it out',
  (select (pg_temp.live_fix(4)).created_by), 'b3200002-0000-4000-8000-000000000002'::uuid);

-- Another technician, another day and hours: written, not quietly put back.
select pg_temp.as_hector();
select public.assign_problem(pg_temp.pid(4), 'b3200004-0000-4000-8000-000000000004',
                             current_date + 2, '10:00', '12:00');
reset role; reset request.jwt.claims;
select pg_temp.check('he hands it over to another technician on another day',
  (select array[(f).assignee_id::text, (f).scheduled_date::text, (f).time_from::text,
                (f).status::text]
   from (select pg_temp.live_fix(4) as f) x),
  array['b3200004-0000-4000-8000-000000000004', (current_date + 2)::text, '10:00:00', 'assigned']);
select pg_temp.check('the dispatch leaves nothing switched on behind it',
  coalesce(current_setting('str_ops.head_tech_dispatch', true), ''), '');

-- Petr accepts; a move by the head technician is accepted by nobody yet.
select pg_temp.as_petr();
update public.tasks set status = 'accepted' where id = (pg_temp.live_fix(4)).id;
select pg_temp.as_hector();
select public.assign_problem(pg_temp.pid(4), 'b3200004-0000-4000-8000-000000000004',
                             current_date + 1);
reset role; reset request.jwt.claims;
select pg_temp.check('an accepted repair he moves goes back to assigned',
  (select array[(f).status::text, (f).scheduled_date::text] from (select pg_temp.live_fix(4) as f) x),
  array['assigned', (current_date + 1)::text]);

-- He takes repairs himself (decision 8).
select pg_temp.as_hector();
select public.assign_problem(pg_temp.pid(4), 'b3200002-0000-4000-8000-000000000002');
select pg_temp.check('he hands a repair to himself, and it is his own work',
  (select count(*)::int from public.tasks
   where assignee_id = 'b3200002-0000-4000-8000-000000000002' and problem_id = pg_temp.pid(4)), 1);

-- His own repair, written directly, is an executor's write like any other:
-- the exception lives inside the dispatch, not in his role.
update public.tasks set scheduled_date = current_date + 5, status = 'assigned'
where id = (pg_temp.live_fix(4)).id;
reset role; reset request.jwt.claims;
select pg_temp.check('his direct write of his own repair is held like an executor''s',
  (select (pg_temp.live_fix(4)).scheduled_date), current_date);
select pg_temp.as_hector();
with moved as (
  update public.tasks set scheduled_date = current_date + 5
  where id = 'b3202001-0000-4000-8000-000000000005'
  returning id)
select pg_temp.check('and a colleague''s repair he does not write at all',
  (select count(*)::int from moved), 0);

-- To technicians only.
select pg_temp.check('not to a cleaner',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(3),
    'b3200005-0000-4000-8000-000000000005')$q$),
  'serverErrors.repairNeedsTech');
select pg_temp.check('nor to the manager',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(3),
    'b3200001-0000-4000-8000-000000000001')$q$),
  'serverErrors.repairNeedsTech');
select pg_temp.check('nor to a technician who left',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(3),
    'b3200007-0000-4000-8000-000000000007')$q$),
  'serverErrors.problemAssigneeInvalid');
select pg_temp.check('nor a task already closed',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(2),
    'b3200003-0000-4000-8000-000000000003')$q$),
  'serverErrors.problemNotOpen');
select pg_temp.check('nor another company''s',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(9),
    'b3200003-0000-4000-8000-000000000003')$q$),
  'serverErrors.problemNotFound');

-- Cancelling, closing and archiving stay with the manager (decision 1).
select pg_temp.check('he does not cancel a task',
  pg_temp.refusal($q$select public.cancel_problem(pg_temp.pid(3), 'no')$q$), 'serverErrors.managerOnly');
select pg_temp.check('nor close one',
  pg_temp.refusal($q$select public.resolve_problem(pg_temp.pid(3))$q$), 'serverErrors.managerOnly');
select pg_temp.check('nor archive one',
  pg_temp.refusal($q$select public.archive_problem(pg_temp.pid(3))$q$), 'serverErrors.managerOnly');
select pg_temp.check('nor bring one back',
  pg_temp.refusal($q$select public.unarchive_problem(pg_temp.pid(2))$q$), 'serverErrors.managerOnly');
select pg_temp.check('nor reopen one',
  pg_temp.refusal($q$select public.reopen_problem(pg_temp.pid(2))$q$), 'serverErrors.managerOnly');

-- ---------------------------------------------------------------------------
--  He takes a technician off a repair
-- ---------------------------------------------------------------------------

select public.assign_problem(pg_temp.pid(4), 'b3200003-0000-4000-8000-000000000003');
select public.unassign_problem((pg_temp.live_fix(4)).id);
reset role; reset request.jwt.claims;
select pg_temp.check('taken off, the attempt is cancelled',
  (select string_agg(status::text, ',') from public.tasks where problem_id = pg_temp.pid(4)),
  'cancelled');
select pg_temp.check('and the task waits again',
  (select status::text from public.problems where id = pg_temp.pid(4)), 'open');
select pg_temp.as_tomas();
select pg_temp.check('the technician taken off loses it',
  (select count(*)::int from public.problems where id = pg_temp.pid(4)), 0);

select pg_temp.as_hector();
select pg_temp.check('a second click on a stale screen is told it changed',
  pg_temp.refusal($q$select public.unassign_problem(
    (select t.id from public.tasks t where t.problem_id = pg_temp.pid(4)))$q$),
  'serverErrors.taskChangedMeanwhile');
select pg_temp.check('a cleaning is not his to take anybody off',
  pg_temp.refusal($q$select public.unassign_problem('b3202001-0000-4000-8000-000000000001')$q$),
  'serverErrors.taskNotFound');
select pg_temp.check('nor a manual repair with no task behind it',
  pg_temp.refusal($q$select public.unassign_problem('b3202001-0000-4000-8000-000000000006')$q$),
  'serverErrors.taskNotFound');
select pg_temp.check('nor another company''s repair',
  pg_temp.refusal($q$select public.unassign_problem('b3202001-0000-4000-8000-000000000009')$q$),
  'serverErrors.taskNotFound');

-- ---------------------------------------------------------------------------
--  Nobody else dispatches
-- ---------------------------------------------------------------------------

select pg_temp.as_tomas();
select pg_temp.check('a technician does not hand tasks out',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(1),
    'b3200004-0000-4000-8000-000000000004')$q$),
  'serverErrors.managerOrHeadTechOnly');
select pg_temp.check('nor take anybody off one',
  pg_temp.refusal($q$select public.unassign_problem('b3202001-0000-4000-8000-000000000005')$q$),
  'serverErrors.managerOrHeadTechOnly');
select pg_temp.as_anna();
select pg_temp.check('nor does a cleaner',
  pg_temp.refusal($q$select public.unassign_problem('b3202001-0000-4000-8000-000000000005')$q$),
  'serverErrors.managerOrHeadTechOnly');
select pg_temp.as_olga();
select pg_temp.check('another company''s head technician cannot reach ours',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(1),
    'b3200009-0000-4000-8000-000000000009')$q$),
  'serverErrors.problemNotFound');
select pg_temp.as_gone();
select pg_temp.check('nor can a dismissed one',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(1),
    'b3200003-0000-4000-8000-000000000003')$q$),
  'serverErrors.managerOrHeadTechOnly');

-- The manager keeps what she had: a repair to a cleaner on the spot, and the
-- new way to take somebody off.
select pg_temp.as_boss();
select pg_temp.check('the manager still hands a repair to a cleaner',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(3),
    'b3200005-0000-4000-8000-000000000005')$q$),
  'no refusal');
select pg_temp.check('and takes a technician off a repair',
  pg_temp.refusal($q$select public.unassign_problem('b3202001-0000-4000-8000-000000000005')$q$),
  'no refusal');
reset role; reset request.jwt.claims;
select pg_temp.check('the leak waits again',
  (select status::text from public.problems where id = pg_temp.pid(1)), 'open');

-- A cleaner's repair, handed to her by the office: he may take her off it
-- (owner, 2026-10-03: «Да может снять»), so he may move it too — the same
-- person on another day or hours hands nothing to anybody. Handing it to
-- anybody else is still for technicians only.
select pg_temp.as_hector();
select pg_temp.check('the head technician moves a cleaner''s repair to another day',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(3),
    'b3200005-0000-4000-8000-000000000005', current_date + 1, '09:00', '10:00')$q$),
  'no refusal');
reset role; reset request.jwt.claims;
select pg_temp.check('it is still hers, on the new day and hours',
  (select array[(f).assignee_id::text, (f).scheduled_date::text, (f).time_from::text]
   from (select pg_temp.live_fix(3) as f) x),
  array['b3200005-0000-4000-8000-000000000005', (current_date + 1)::text, '09:00:00']);
select pg_temp.as_hector();
select pg_temp.check('but he does not hand it to anybody but a technician',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(3),
    'b3200001-0000-4000-8000-000000000001')$q$),
  'serverErrors.repairNeedsTech');
reset role; reset request.jwt.claims;
select pg_temp.check('and a refused hand-over leaves it with her',
  (select (pg_temp.live_fix(3)).assignee_id), 'b3200005-0000-4000-8000-000000000005'::uuid);

-- A take-off says whom the screen showed. A screen minutes old may show
-- somebody the attempt no longer has: it is told so, and nobody is taken off.
select pg_temp.as_hector();
select pg_temp.check('a take-off of somebody the attempt no longer has is told it changed',
  pg_temp.refusal($q$select public.unassign_problem((pg_temp.live_fix(3)).id,
    'b3200003-0000-4000-8000-000000000003')$q$),
  'serverErrors.taskChangedMeanwhile');
reset role; reset request.jwt.claims;
select pg_temp.check('and she is still on it',
  (select (pg_temp.live_fix(3)).assignee_id), 'b3200005-0000-4000-8000-000000000005'::uuid);

-- He takes a cleaner off a repair the office gave her, too; he hands work
-- only to technicians.
select pg_temp.as_hector();
select pg_temp.check('the head technician takes a cleaner off a repair, naming her',
  pg_temp.refusal($q$select public.unassign_problem((pg_temp.live_fix(3)).id,
    'b3200005-0000-4000-8000-000000000005')$q$),
  'no refusal');
reset role; reset request.jwt.claims;
select pg_temp.check('and the room lamp waits again',
  (select status::text from public.problems where id = pg_temp.pid(3)), 'open');

-- ---------------------------------------------------------------------------
--  The live attempt is a repair
-- ---------------------------------------------------------------------------
--
-- Only a repair is an attempt at a task. A live row of another kind that
-- carries a problem_id — nothing of ours writes one, a manager's direct write
-- could — is not the dispatch's to rewrite; a problem has one live task
-- (tasks_one_fix_per_problem), so no attempt opens beside it either.
insert into public.tasks (id, host_id, property_id, type, status, assignee_id, scheduled_date, problem_id)
values ('b3202001-0000-4000-8000-000000000010', 'b3200000-0000-4000-8000-00000000000a', 900032001,
        'inspection', 'assigned', 'b3200005-0000-4000-8000-000000000005', current_date,
        pg_temp.pid(1));
select pg_temp.as_hector();
select pg_temp.check('the dispatch refuses a task held by an inspection that names it',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(1),
    'b3200004-0000-4000-8000-000000000004', current_date + 2)$q$),
  'serverErrors.problemNotOpen');
select pg_temp.check('nor takes anybody off it as if it were a repair',
  pg_temp.refusal($q$select public.unassign_problem('b3202001-0000-4000-8000-000000000010')$q$),
  'serverErrors.taskNotFound');
reset role; reset request.jwt.claims;
select pg_temp.check('the inspection is not touched',
  (select array[assignee_id::text, scheduled_date::text, status::text] from public.tasks
   where id = 'b3202001-0000-4000-8000-000000000010'),
  array['b3200005-0000-4000-8000-000000000005', current_date::text, 'assigned']);
select pg_temp.check('and no attempt opened beside it',
  (select count(*)::int from public.tasks
   where problem_id = pg_temp.pid(1) and type = 'maintenance'
     and status not in ('done', 'cancelled', 'expired')), 0);

rollback;
