-- The technician and the cleanings (docs/tech-plan.md, §2). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: a technician has nothing to do with cleanings, and
-- neither has the head technician (§3). He sees and does only the work handed
-- to him. The database refuses the two writes that would make a cleaning his —
-- a link to a listing (any write of one) and a cleaning, a mid-stay cleaning or
-- an inspection with his name on it (any write of one, by any road: save_task,
-- the manager's direct write, the take, the server) — and refuses to turn into
-- a technician somebody who still holds either: the manager takes them off
-- first, and nothing is lost quietly. The rest follows from that, and is
-- proven here rather than coded: the generator hands out work only through
-- 'auto' links, and the queue, the take, the push about free work and the
-- morning count of it all go through links. Old rows written before the rule
-- are planted past it, as the cloud has them.
--
-- Fixture ids live in the 9000310xx range and under b31….
begin;

-- The pg_temp helpers below are created by postgres, whose new functions no
-- longer go to PUBLIC (20260926100000), and they are called as authenticated
-- and as service_role too. Hand them to those roles for the length of this
-- transaction.
alter default privileges for role postgres grant execute on functions to authenticated, service_role;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b3100001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.techrules@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b3100002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.techrules@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b3100003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tomas.techrules@test.local','x',now(),now(),
   '{"full_name":"Tomas"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('b3100004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','hana.techrules@test.local','x',now(),now(),
   '{"full_name":"Hana"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('b3100005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','vera.techrules@test.local','x',now(),now(),
   '{"full_name":"Vera"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b3100006-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','otto.techrules@test.local','x',now(),now(),
   '{"full_name":"Otto"}'::jsonb, '{"role":"cleaner"}'::jsonb);

-- A: Anna takes its free work from the queue. B: she is its automatic cleaner.
-- C: nobody's — the listing a technician could not be given.
insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900031001, 'Queue flat', 'UTC', '15:00', '10:00'),
  (900031002, 'Auto flat',  'UTC', '15:00', '10:00'),
  (900031003, 'Free flat',  'UTC', '15:00', '10:00');

insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900031001, 'b3100002-0000-4000-8000-000000000002', 'claim'),
  (900031002, 'b3100002-0000-4000-8000-000000000002', 'auto');

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
create or replace function pg_temp.as_boss()  returns void language sql as $fn$
  select pg_temp.as_user('b3100001-0000-4000-8000-000000000001') $fn$;
create or replace function pg_temp.as_anna()  returns void language sql as $fn$
  select pg_temp.as_user('b3100002-0000-4000-8000-000000000002') $fn$;
create or replace function pg_temp.as_tomas() returns void language sql as $fn$
  select pg_temp.as_user('b3100003-0000-4000-8000-000000000003') $fn$;
create or replace function pg_temp.as_hana()  returns void language sql as $fn$
  select pg_temp.as_user('b3100004-0000-4000-8000-000000000004') $fn$;

create or replace function pg_temp.role_of(person uuid) returns text language sql as $fn$
  select role::text from public.profiles where id = person $fn$;

select pg_temp.check('the head technician''s role comes from app_metadata at signup',
  pg_temp.role_of('b3100004-0000-4000-8000-000000000004'), 'head_tech');

-- ---------------------------------------------------------------------------
--  1. No link to a listing
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();

select pg_temp.check('a technician is not linked to a listing',
  pg_temp.refusal($q$select public.save_property_cleaner(
    900031001, 'b3100003-0000-4000-8000-000000000003', 'claim', 2)$q$),
  'serverErrors.techNotLinkable');
select pg_temp.check('nor made its automatic cleaner',
  pg_temp.refusal($q$select public.save_property_cleaner(
    900031003, 'b3100003-0000-4000-8000-000000000003', 'auto', 1)$q$),
  'serverErrors.techNotLinkable');
select pg_temp.check('nor is the head technician',
  pg_temp.refusal($q$select public.save_property_cleaner(
    900031003, 'b3100004-0000-4000-8000-000000000004', 'auto', 1)$q$),
  'serverErrors.techNotLinkable');

-- The manager may also write the table directly; the rule is the table's.
select pg_temp.check('a direct insert by the manager is refused the same way',
  pg_temp.refusal($q$insert into public.property_cleaners (property_id, cleaner_id, mode)
                     values (900031003, 'b3100003-0000-4000-8000-000000000003', 'claim')$q$),
  'serverErrors.techNotLinkable');
select pg_temp.check('and so is handing an existing link over to a technician',
  pg_temp.refusal($q$update public.property_cleaners
                     set cleaner_id = 'b3100003-0000-4000-8000-000000000003'
                     where property_id = 900031001
                       and cleaner_id = 'b3100002-0000-4000-8000-000000000002'$q$),
  'serverErrors.techNotLinkable');

select pg_temp.check('a cleaner is linked as before',
  pg_temp.refusal($q$select public.save_property_cleaner(
    900031003, 'b3100006-0000-4000-8000-000000000006', 'claim', 1)$q$),
  'no refusal');
delete from public.property_cleaners where property_id = 900031003;

-- No server context is exempt: no job of ours links people.
reset role; reset request.jwt.claims;
select pg_temp.check('nor does the server context link a technician',
  pg_temp.refusal($q$insert into public.property_cleaners (property_id, cleaner_id, mode)
                     values (900031003, 'b3100004-0000-4000-8000-000000000004', 'auto')$q$),
  'serverErrors.techNotLinkable');
select pg_temp.check('no technician holds a link',
  (select count(*)::int from public.property_cleaners
   where cleaner_id in ('b3100003-0000-4000-8000-000000000003',
                        'b3100004-0000-4000-8000-000000000004')), 0);

-- ---------------------------------------------------------------------------
--  2. No technician while links and open cleanings remain
-- ---------------------------------------------------------------------------
--
-- Vera is linked to the queue flat and holds an open cleaning. The office
-- changes a role through manage-staff (the service role upserts the profile)
-- or, in principle, by writing the row as a manager: both are refused, and the
-- refusal says how much is left to take off her.

insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900031001, 'b3100005-0000-4000-8000-000000000005', 'claim');
insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date) values
  ('b3101001-0000-4000-8000-000000000001', 900031002, 'cleaning', 'assigned',
   'b3100005-0000-4000-8000-000000000005', current_date + 3),
  -- History and repairs do not count.
  ('b3101001-0000-4000-8000-000000000002', 900031002, 'cleaning', 'done',
   'b3100005-0000-4000-8000-000000000005', current_date - 3),
  ('b3101001-0000-4000-8000-000000000003', 900031002, 'maintenance', 'assigned',
   'b3100005-0000-4000-8000-000000000005', current_date);

select pg_temp.as_boss();
select pg_temp.check('a cleaner with a link and an open cleaning does not become a technician',
  pg_temp.refusal($q$update public.profiles set role = 'tech'
                     where id = 'b3100005-0000-4000-8000-000000000005'$q$),
  'serverErrors.techRoleBlocked {"links": 1, "cleanings": 1}');
select pg_temp.check('nor the head technician',
  pg_temp.refusal($q$update public.profiles set role = 'head_tech'
                     where id = 'b3100005-0000-4000-8000-000000000005'$q$),
  'serverErrors.techRoleBlocked {"links": 1, "cleanings": 1}');

-- manage-staff writes the profile as the service role, with an upsert.
reset role; reset request.jwt.claims;
set local role service_role;
select pg_temp.check('the path manage-staff takes is refused the same way',
  pg_temp.refusal($q$insert into public.profiles (id, full_name, role, is_active)
                     values ('b3100005-0000-4000-8000-000000000005', 'Vera', 'tech', true)
                     on conflict (id) do update
                       set full_name = excluded.full_name, role = excluded.role,
                           is_active = excluded.is_active$q$),
  'serverErrors.techRoleBlocked {"links": 1, "cleanings": 1}');
reset role;
select pg_temp.check('and a refusal changes nothing',
  pg_temp.role_of('b3100005-0000-4000-8000-000000000005'), 'cleaner');

-- The link comes off; the open cleaning still stops it. Then that goes too.
delete from public.property_cleaners where cleaner_id = 'b3100005-0000-4000-8000-000000000005';
select pg_temp.as_boss();
select pg_temp.check('an open cleaning alone is enough to refuse',
  pg_temp.refusal($q$update public.profiles set role = 'tech'
                     where id = 'b3100005-0000-4000-8000-000000000005'$q$),
  'serverErrors.techRoleBlocked {"links": 0, "cleanings": 1}');
reset role; reset request.jwt.claims;
update public.tasks set status = 'cancelled' where id = 'b3101001-0000-4000-8000-000000000001';
select pg_temp.as_boss();
select pg_temp.check('with nothing left the change goes through',
  pg_temp.refusal($q$update public.profiles set role = 'tech'
                     where id = 'b3100005-0000-4000-8000-000000000005'$q$),
  'no refusal');
reset role; reset request.jwt.claims;
select pg_temp.check('and she is a technician now, her repair with her',
  pg_temp.role_of('b3100005-0000-4000-8000-000000000005'), 'tech');

-- An inspection and a mid-stay cleaning are cleanings for this rule.
insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date) values
  ('b3101001-0000-4000-8000-000000000004', 900031002, 'inspection', 'accepted',
   'b3100006-0000-4000-8000-000000000006', current_date + 1);
select pg_temp.as_boss();
select pg_temp.check('an open inspection stops it too',
  pg_temp.refusal($q$update public.profiles set role = 'tech'
                     where id = 'b3100006-0000-4000-8000-000000000006'$q$),
  'serverErrors.techRoleBlocked {"links": 0, "cleanings": 1}');
reset role; reset request.jwt.claims;
update public.tasks set type = 'midstay' where id = 'b3101001-0000-4000-8000-000000000004';
select pg_temp.as_boss();
select pg_temp.check('and an open mid-stay cleaning',
  pg_temp.refusal($q$update public.profiles set role = 'head_tech'
                     where id = 'b3100006-0000-4000-8000-000000000006'$q$),
  'serverErrors.techRoleBlocked {"links": 0, "cleanings": 1}');
reset role; reset request.jwt.claims;

-- Old rows in the cloud (one technician with links, docs/tech-plan.md §1) are
-- the owner's to take off. Until then an edit that keeps the role is an edit:
-- only a change of role is asked. The rows are planted past the link rule, as
-- they were written before it.
alter table public.property_cleaners disable trigger user;
insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900031003, 'b3100003-0000-4000-8000-000000000003', 'claim');
alter table public.property_cleaners enable trigger user;
select pg_temp.as_boss();
select pg_temp.check('a technician with an old link can still have his phone number fixed',
  pg_temp.refusal($q$update public.profiles set phone = '+420 777 000 111', role = 'tech'
                     where id = 'b3100003-0000-4000-8000-000000000003'$q$),
  'no refusal');
select pg_temp.check('but not be made head technician before the link is off',
  pg_temp.refusal($q$update public.profiles set role = 'head_tech'
                     where id = 'b3100003-0000-4000-8000-000000000003'$q$),
  'serverErrors.techRoleBlocked {"links": 1, "cleanings": 0}');

-- The old link is only taken off. Turned into his automatic one it would feed
-- him the listing's cleanings from the generator; any other edit keeps a link
-- the rule has no room for.
select pg_temp.check('an old link of a technician is not turned into his automatic one',
  pg_temp.refusal($q$update public.property_cleaners set mode = 'auto'
                     where property_id = 900031003
                       and cleaner_id = 'b3100003-0000-4000-8000-000000000003'$q$),
  'serverErrors.techNotLinkable');
select pg_temp.check('nor through save_property_cleaner',
  pg_temp.refusal($q$select public.save_property_cleaner(
    900031003, 'b3100003-0000-4000-8000-000000000003', 'auto', 1)$q$),
  'serverErrors.techNotLinkable');
select pg_temp.check('nor edited at all',
  pg_temp.refusal($q$update public.property_cleaners set priority = 3
                     where property_id = 900031003
                       and cleaner_id = 'b3100003-0000-4000-8000-000000000003'$q$),
  'serverErrors.techNotLinkable');
select pg_temp.check('the old link is still a claim link',
  (select mode::text || ' ' || priority::text from public.property_cleaners
   where property_id = 900031003 and cleaner_id = 'b3100003-0000-4000-8000-000000000003'),
  'claim 1');
select pg_temp.check('and the manager takes it off',
  pg_temp.refusal($q$delete from public.property_cleaners
                     where cleaner_id = 'b3100003-0000-4000-8000-000000000003'$q$),
  'no refusal');
reset role; reset request.jwt.claims;
select pg_temp.check('so he holds no link',
  (select count(*)::int from public.property_cleaners
   where cleaner_id = 'b3100003-0000-4000-8000-000000000003'), 0);

-- Every link is counted, whatever its mode.
select pg_temp.as_boss();
select pg_temp.check('the refusal counts every link of a cleaner who works two flats',
  pg_temp.refusal($q$update public.profiles set role = 'tech'
                     where id = 'b3100002-0000-4000-8000-000000000002'$q$),
  'serverErrors.techRoleBlocked {"links": 2, "cleanings": 0}');
reset role; reset request.jwt.claims;

-- ---------------------------------------------------------------------------
--  3. No cleaning handed to a technician
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();

select pg_temp.check('a cleaning is not handed to a technician',
  pg_temp.refusal($q$select public.save_task('b3101002-0000-4000-8000-000000000001',
    900031003, 'cleaning', current_date + 1, null, null,
    'b3100003-0000-4000-8000-000000000003')$q$),
  'serverErrors.cleaningNotForTech {"type": "cleaning"}');
select pg_temp.check('nor a mid-stay cleaning to the head technician',
  pg_temp.refusal($q$select public.save_task('b3101002-0000-4000-8000-000000000002',
    900031003, 'midstay', current_date + 1, null, null,
    'b3100004-0000-4000-8000-000000000004')$q$),
  'serverErrors.cleaningNotForTech {"type": "midstay"}');
select pg_temp.check('nor an inspection',
  pg_temp.refusal($q$select public.save_task('b3101002-0000-4000-8000-000000000003',
    900031003, 'inspection', current_date + 1, null, null,
    'b3100003-0000-4000-8000-000000000003')$q$),
  'serverErrors.cleaningNotForTech {"type": "inspection"}');
select pg_temp.check('nothing was written',
  (select count(*)::int from public.tasks
   where id::text like 'b3101002-%'), 0);

-- A repair goes to whoever is on the spot: a technician or a cleaner.
select pg_temp.check('a repair is handed to a technician',
  pg_temp.refusal($q$select public.save_task('b3101002-0000-4000-8000-000000000004',
    900031003, 'maintenance', current_date + 1, 'Door hinge', null,
    'b3100003-0000-4000-8000-000000000003')$q$),
  'no refusal');
select pg_temp.check('and to a cleaner',
  pg_temp.refusal($q$select public.save_task('b3101002-0000-4000-8000-000000000005',
    900031002, 'maintenance', current_date + 1, 'Bulb', null,
    'b3100002-0000-4000-8000-000000000002')$q$),
  'no refusal');
select pg_temp.check('a cleaning is handed to a cleaner as before',
  pg_temp.refusal($q$select public.save_task('b3101002-0000-4000-8000-000000000006',
    900031003, 'cleaning', current_date + 1, null, null,
    'b3100002-0000-4000-8000-000000000002')$q$),
  'no refusal');

-- Not by the back door of an edit either.
select pg_temp.check('a repair of his does not turn into a cleaning',
  pg_temp.refusal($q$select public.save_task('b3101002-0000-4000-8000-000000000004',
    900031003, 'cleaning', current_date + 2, null, null,
    'b3100003-0000-4000-8000-000000000003')$q$),
  'serverErrors.cleaningNotForTech {"type": "cleaning"}');
select pg_temp.check('nor is a cleaner''s cleaning handed over to him',
  pg_temp.refusal($q$select public.save_task('b3101002-0000-4000-8000-000000000006',
    900031003, 'cleaning', current_date + 1, null, null,
    'b3100003-0000-4000-8000-000000000003')$q$),
  'serverErrors.cleaningNotForTech {"type": "cleaning"}');
reset role; reset request.jwt.claims;
select pg_temp.check('the repair is still his and still a repair',
  (select type::text || ' ' || assignee_id::text from public.tasks
   where id = 'b3101002-0000-4000-8000-000000000004'),
  'maintenance b3100003-0000-4000-8000-000000000003');

-- ---------------------------------------------------------------------------
--  3a. The table refuses, whoever writes
-- ---------------------------------------------------------------------------
--
-- save_task is one road of several: the manager may write tasks directly, the
-- take is the phone's direct write, and the generator writes as the server.
-- The rule is the table's (20261003110000), and every road meets it.

select pg_temp.as_boss();
select pg_temp.check('a manager''s direct insert of a cleaning on a technician is refused',
  pg_temp.refusal($q$insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date)
                     values ('b3101005-0000-4000-8000-000000000001', 900031003, 'cleaning', 'assigned',
                             'b3100003-0000-4000-8000-000000000003', current_date + 1)$q$),
  'serverErrors.cleaningNotForTech {"type": "cleaning"}');
select pg_temp.check('and so is handing a cleaner''s cleaning to him directly',
  pg_temp.refusal($q$update public.tasks set assignee_id = 'b3100003-0000-4000-8000-000000000003'
                     where id = 'b3101002-0000-4000-8000-000000000006'$q$),
  'serverErrors.cleaningNotForTech {"type": "cleaning"}');
select pg_temp.check('or to the head technician',
  pg_temp.refusal($q$update public.tasks set assignee_id = 'b3100004-0000-4000-8000-000000000004'
                     where id = 'b3101002-0000-4000-8000-000000000006'$q$),
  'serverErrors.cleaningNotForTech {"type": "cleaning"}');
select pg_temp.check('or turning his repair into an inspection',
  pg_temp.refusal($q$update public.tasks set type = 'inspection'
                     where id = 'b3101002-0000-4000-8000-000000000004'$q$),
  'serverErrors.cleaningNotForTech {"type": "inspection"}');
reset role; reset request.jwt.claims;
select pg_temp.check('nor does the server context write one',
  pg_temp.refusal($q$insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date)
                     values ('b3101005-0000-4000-8000-000000000002', 900031003, 'midstay', 'assigned',
                             'b3100004-0000-4000-8000-000000000004', current_date + 1)$q$),
  'serverErrors.cleaningNotForTech {"type": "midstay"}');
select pg_temp.check('nothing of it was written',
  (select count(*)::int from public.tasks where id::text like 'b3101005-%')
  + (select count(*)::int from public.tasks
     where id = 'b3101002-0000-4000-8000-000000000006'
       and assignee_id <> 'b3100002-0000-4000-8000-000000000002')
  + (select count(*)::int from public.tasks
     where id = 'b3101002-0000-4000-8000-000000000004' and type <> 'maintenance'), 0);

-- An old cleaning on a technician, from before the rule, is the office's to
-- take off him: handed to a cleaner, put back in the queue or cancelled. The
-- table refuses only a write that names him on a cleaning.
alter table public.tasks disable trigger user;
insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date) values
  ('b3101005-0000-4000-8000-000000000003', 900031003, 'cleaning', 'assigned',
   'b3100003-0000-4000-8000-000000000003', current_date + 2),
  ('b3101005-0000-4000-8000-000000000004', 900031003, 'inspection', 'assigned',
   'b3100003-0000-4000-8000-000000000003', current_date + 2),
  ('b3101005-0000-4000-8000-000000000005', 900031003, 'midstay', 'assigned',
   'b3100003-0000-4000-8000-000000000003', current_date + 2);
alter table public.tasks enable trigger user;
select pg_temp.as_boss();
select pg_temp.check('an old cleaning on him is not edited with his name kept',
  pg_temp.refusal($q$update public.tasks set assignee_id = 'b3100003-0000-4000-8000-000000000003',
                                             notes = 'Keys at the desk'
                     where id = 'b3101005-0000-4000-8000-000000000003'$q$),
  'serverErrors.cleaningNotForTech {"type": "cleaning"}');
select pg_temp.check('it is handed to a cleaner',
  pg_temp.refusal($q$update public.tasks set assignee_id = 'b3100002-0000-4000-8000-000000000002'
                     where id = 'b3101005-0000-4000-8000-000000000003'$q$),
  'no refusal');
select pg_temp.check('or put back in the queue',
  pg_temp.refusal($q$update public.tasks set assignee_id = null, status = 'unassigned'
                     where id = 'b3101005-0000-4000-8000-000000000004'$q$),
  'no refusal');
select pg_temp.check('or cancelled',
  pg_temp.refusal($q$update public.tasks set status = 'cancelled'
                     where id = 'b3101005-0000-4000-8000-000000000005'$q$),
  'no refusal');
reset role; reset request.jwt.claims;
select pg_temp.check('and none of them is on him any more, but the cancelled one''s record',
  (select string_agg(right(id::text, 1) || ' ' || status::text || ' '
                     || coalesce(right(assignee_id::text, 1), '-'), ', ' order by id)
   from public.tasks where id::text like 'b3101005-%'),
  '3 assigned 2, 4 unassigned -, 5 cancelled 3');
-- The closed one stays in his sight like any closed work of his (§2.4); out
-- of the way of what follows.
delete from public.tasks where id::text like 'b3101005-%';

-- ---------------------------------------------------------------------------
--  3b. A closed cleaning is not brought back on a technician
-- ---------------------------------------------------------------------------
--
-- The rule above wakes for a write that names the person or the kind. A write
-- of the status alone, from a closed one back to a live one, names neither: a
-- closed cleaning on a technician — an old one, or one closed while he was
-- still a cleaner — would come back on him, and he could start and finish it.
-- A second trigger asks the same rule of exactly that write (20261003110000);
-- the office brings such a cleaning back by handing it to a cleaner in the
-- same write. The rows are planted past the rules, as the cloud may have them.

alter table public.tasks disable trigger user;
insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date) values
  ('b3101006-0000-4000-8000-000000000001', 900031003, 'cleaning', 'cancelled',
   'b3100003-0000-4000-8000-000000000003', current_date + 2),
  ('b3101006-0000-4000-8000-000000000002', 900031003, 'inspection', 'expired',
   'b3100003-0000-4000-8000-000000000003', current_date - 2),
  ('b3101006-0000-4000-8000-000000000003', 900031003, 'midstay', 'done',
   'b3100004-0000-4000-8000-000000000004', current_date - 1),
  ('b3101006-0000-4000-8000-000000000004', 900031002, 'cleaning', 'cancelled',
   'b3100002-0000-4000-8000-000000000002', current_date + 2),
  ('b3101006-0000-4000-8000-000000000005', 900031002, 'inspection', 'expired',
   'b3100002-0000-4000-8000-000000000002', current_date - 2),
  ('b3101006-0000-4000-8000-000000000006', 900031003, 'cleaning', 'assigned',
   'b3100003-0000-4000-8000-000000000003', current_date),
  ('b3101006-0000-4000-8000-000000000007', 900031003, 'cleaning', 'cancelled',
   'b3100003-0000-4000-8000-000000000003', current_date + 3);
alter table public.tasks enable trigger user;

-- Moves between live states, into a closed one, or from one closed state to
-- another do not even call the rule: the WHEN leaves them out.
set local track_functions = 'all';
create or replace function pg_temp.calls(fn text) returns integer language sql as $fn$
  select coalesce(sum(calls), 0)::int from pg_stat_xact_user_functions
  where schemaname = 'public' and funcname = fn $fn$;
create temp table tr_revive_calls on commit drop as
  select pg_temp.calls('guard_cleaning_assignee') as rule_calls;

select pg_temp.as_boss();
select pg_temp.check('an old live cleaning on him moves between live states as before',
  pg_temp.refusal($q$update public.tasks set status = 'accepted'
                     where id = 'b3101006-0000-4000-8000-000000000006'$q$),
  'no refusal');
select pg_temp.check('and into a closed one',
  pg_temp.refusal($q$update public.tasks set status = 'cancelled'
                     where id = 'b3101006-0000-4000-8000-000000000006'$q$),
  'no refusal');
select pg_temp.check('and a closed one of his into another closed state',
  pg_temp.refusal($q$update public.tasks set status = 'expired'
                     where id = 'b3101006-0000-4000-8000-000000000007'$q$),
  'no refusal');
reset role; reset request.jwt.claims;
select pg_temp.check('none of those moves asks the rule',
  pg_temp.calls('guard_cleaning_assignee') - (select rule_calls from tr_revive_calls), 0);

-- The status alone, from closed to live, by every road that may write it.
select pg_temp.as_boss();
select pg_temp.check('a cancelled cleaning on a technician is not brought back by its status',
  pg_temp.refusal($q$update public.tasks set status = 'assigned'
                     where id = 'b3101006-0000-4000-8000-000000000001'$q$),
  'serverErrors.cleaningNotForTech {"type": "cleaning"}');
select pg_temp.check('nor an expired inspection',
  pg_temp.refusal($q$update public.tasks set status = 'accepted'
                     where id = 'b3101006-0000-4000-8000-000000000002'$q$),
  'serverErrors.cleaningNotForTech {"type": "inspection"}');
reset role; reset request.jwt.claims;
set local role service_role;
select pg_temp.check('nor by the service role',
  pg_temp.refusal($q$update public.tasks set status = 'assigned'
                     where id = 'b3101006-0000-4000-8000-000000000002'$q$),
  'serverErrors.cleaningNotForTech {"type": "inspection"}');
reset role;
select pg_temp.check('nor a done mid-stay cleaning on the head technician, by the server context',
  pg_temp.refusal($q$update public.tasks set status = 'in_progress'
                     where id = 'b3101006-0000-4000-8000-000000000003'$q$),
  'serverErrors.cleaningNotForTech {"type": "midstay"}');
select pg_temp.check('they stay closed',
  (select string_agg(right(id::text, 1) || ' ' || status::text, ', ' order by id)
   from public.tasks where id in ('b3101006-0000-4000-8000-000000000001',
                                  'b3101006-0000-4000-8000-000000000002',
                                  'b3101006-0000-4000-8000-000000000003')),
  '1 cancelled, 2 expired, 3 done');

-- A cleaner's come back as before, and so does his once a cleaner is named.
select pg_temp.as_boss();
select pg_temp.check('a cancelled cleaning of a cleaner comes back as before',
  pg_temp.refusal($q$update public.tasks set status = 'assigned'
                     where id = 'b3101006-0000-4000-8000-000000000004'$q$),
  'no refusal');
reset role; reset request.jwt.claims;
select pg_temp.check('and so does her expired inspection, by the server context',
  pg_temp.refusal($q$update public.tasks set status = 'assigned'
                     where id = 'b3101006-0000-4000-8000-000000000005'$q$),
  'no refusal');
select pg_temp.as_boss();
select pg_temp.check('the office brings his cancelled cleaning back by handing it to a cleaner at once',
  pg_temp.refusal($q$update public.tasks
                     set status = 'assigned', assignee_id = 'b3100002-0000-4000-8000-000000000002'
                     where id = 'b3101006-0000-4000-8000-000000000001'$q$),
  'no refusal');
reset role; reset request.jwt.claims;
select pg_temp.check('the three came back on the cleaner',
  (select string_agg(right(id::text, 1) || ' ' || status::text || ' ' || right(assignee_id::text, 1),
                     ', ' order by id)
   from public.tasks where id in ('b3101006-0000-4000-8000-000000000001',
                                  'b3101006-0000-4000-8000-000000000004',
                                  'b3101006-0000-4000-8000-000000000005')),
  '1 assigned 2, 4 assigned 2, 5 assigned 2');
delete from public.tasks where id::text like 'b3101006-%';

-- ---------------------------------------------------------------------------
--  4. The generator hands out work through 'auto' links only
-- ---------------------------------------------------------------------------
--
-- A booking leaves each flat. Anna is the automatic cleaner of B; the attempt
-- to make a technician the automatic cleaner of C was refused above, so C's
-- cleaning waits in the queue.

insert into public.reservations (id, property_id, arrival_date, departure_date, status, guest_name) values
  (900031051, 900031002, current_date, current_date + 2, 'new', 'Guest B'),
  (900031052, 900031003, current_date, current_date + 2, 'new', 'Guest C');

-- The table's rule is asked of a cleaning with a person on it, and of nothing
-- else: the generator writes cleanings by the thousand, most of them free.
set local track_functions = 'all';
create or replace function pg_temp.calls(fn text) returns integer language sql as $fn$
  select coalesce(sum(calls), 0)::int from pg_stat_xact_user_functions
  where schemaname = 'public' and funcname = fn $fn$;
create temp table tr_calls on commit drop as
  select pg_temp.calls('guard_cleaning_assignee') as rule_calls;

select public.generate_cleaning_tasks(current_date - 1, current_date + 7);

select pg_temp.check('the generator asks the rule once, for the one cleaning it hands out',
  pg_temp.calls('guard_cleaning_assignee') - (select rule_calls from tr_calls), 1);

select pg_temp.check('the automatic cleaner gets her cleaning',
  (select assignee_id from public.tasks
   where reservation_id = 900031051 and type = 'cleaning'),
  'b3100002-0000-4000-8000-000000000002'::uuid);
select pg_temp.check('a listing with nobody automatic leaves it in the queue',
  (select status::text || ' ' || coalesce(assignee_id::text, 'nobody') from public.tasks
   where reservation_id = 900031052 and type = 'cleaning'),
  'unassigned nobody');
select pg_temp.check('no technician holds a cleaning after the generator',
  (select count(*)::int from public.tasks
   where assignee_id in ('b3100003-0000-4000-8000-000000000003',
                         'b3100004-0000-4000-8000-000000000004')
     and type in ('cleaning', 'midstay', 'inspection')
     and reservation_id is not null), 0);

-- ---------------------------------------------------------------------------
--  5. What a technician sees and may take
-- ---------------------------------------------------------------------------
--
-- Tomas holds a repair today on the queue flat, where Anna takes free work and
-- a free cleaning waits. The free cleaning arrives once both have phones, so
-- that the push about it is written.

insert into public.push_tokens (token, profile_id, host_id, platform)
select v.token, v.person, pr.host_id, v.platform
from (values
  ('ExponentPushToken[tr-anna]',  'b3100002-0000-4000-8000-000000000002'::uuid, 'ios'),
  ('ExponentPushToken[tr-tomas]', 'b3100003-0000-4000-8000-000000000003'::uuid, 'android'),
  ('ExponentPushToken[tr-hana]',  'b3100004-0000-4000-8000-000000000004'::uuid, 'ios')
) v(token, person, platform)
join public.profiles pr on pr.id = v.person;

insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date) values
  ('b3101003-0000-4000-8000-000000000001', 900031001, 'maintenance', 'assigned',
   'b3100003-0000-4000-8000-000000000003', current_date);
delete from raw.push_outbox;
insert into public.tasks (id, property_id, type, status, scheduled_date) values
  ('b3101003-0000-4000-8000-000000000002', 900031001, 'cleaning', 'unassigned', current_date);

select pg_temp.check('the free cleaning is told to the cleaner who may take it',
  (select count(*)::int from raw.push_outbox
   where kind = 'cleaning_free' and recipient_id = 'b3100002-0000-4000-8000-000000000002'), 1);
select pg_temp.check('and to no technician',
  (select count(*)::int from raw.push_outbox
   where kind = 'cleaning_free'
     and recipient_id in ('b3100003-0000-4000-8000-000000000003',
                          'b3100004-0000-4000-8000-000000000004')), 0);

select pg_temp.as_tomas();
select pg_temp.check('a technician does not clean the flat of his repair',
  public.cleans_property(900031001), false);
select pg_temp.check('his visible work is his repairs: no cleaning, mine or free',
  (select string_agg(distinct type::text, ', ') from public.tasks
   where property_id between 900031001 and 900031099), 'maintenance');

with taken as (
  update public.tasks
  set assignee_id = 'b3100003-0000-4000-8000-000000000003', status = 'accepted'
  where id = 'b3101003-0000-4000-8000-000000000002'
  returning id)
select pg_temp.check('and he cannot take the free cleaning', (select count(*)::int from taken), 0);

-- Through an old link from before the rule he would clean the flat as far as
-- the take's policy can tell; the table refuses the take itself.
reset role; reset request.jwt.claims;
alter table public.property_cleaners disable trigger user;
insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900031001, 'b3100003-0000-4000-8000-000000000003', 'claim');
alter table public.property_cleaners enable trigger user;
select pg_temp.as_tomas();
select pg_temp.check('an old link makes the flat his to clean, as far as the policy knows',
  public.cleans_property(900031001), true);
select pg_temp.check('but the take of the free cleaning through it is refused',
  pg_temp.refusal($q$update public.tasks
                     set assignee_id = 'b3100003-0000-4000-8000-000000000003', status = 'accepted'
                     where id = 'b3101003-0000-4000-8000-000000000002'$q$),
  'serverErrors.cleaningNotForTech {"type": "cleaning"}');
reset role; reset request.jwt.claims;
delete from public.property_cleaners where cleaner_id = 'b3100003-0000-4000-8000-000000000003';

select pg_temp.as_hana();
select pg_temp.check('the head technician does not clean it either',
  public.cleans_property(900031001), false);
with taken as (
  update public.tasks
  set assignee_id = 'b3100004-0000-4000-8000-000000000004', status = 'accepted'
  where id = 'b3101003-0000-4000-8000-000000000002'
  returning id)
select pg_temp.check('nor take it', (select count(*)::int from taken), 0);

reset role; reset request.jwt.claims;
select pg_temp.check('the cleaning is still free',
  (select status::text from public.tasks where id = 'b3101003-0000-4000-8000-000000000002'),
  'unassigned');
select pg_temp.check('nor does the twin the push asks count either of them as cleaning',
  (select count(*)::int from public.properties p
   cross join (values ('b3100003-0000-4000-8000-000000000003'::uuid),
                      ('b3100004-0000-4000-8000-000000000004'::uuid)) who(id)
   where p.id between 900031001 and 900031099
     and public.cleans_property_as(who.id, p.id)), 0);

-- The morning: Anna counts the free cleaning, Tomas hears about his repair and
-- of nothing free.
delete from raw.push_outbox;
select public.enqueue_daily_digest(((current_date + time '07:10') at time zone 'Europe/Prague'));
select pg_temp.check('the cleaner''s morning counts the free work she may take',
  (select (params ->> 'free')::int > 0 from raw.push_outbox
   where kind = 'daily_digest' and recipient_id = 'b3100002-0000-4000-8000-000000000002'), true);
select pg_temp.check('the technician''s morning has his repair and no free line',
  (select array[params ->> 'today', params ->> 'free'] from raw.push_outbox
   where kind = 'daily_digest' and recipient_id = 'b3100003-0000-4000-8000-000000000003'),
  array['1', '0']);

-- ---------------------------------------------------------------------------
--  6. Reading tasks is not asked about the role
-- ---------------------------------------------------------------------------
--
-- A role in the hot policies would cost a call on every row of the feed, and
-- reading must not hide what is already handed out: a cleaning nobody does.
-- An old cleaning on a technician stays in his sight until the owner moves it.
-- It is planted past the table's rule, as it was written before it.

alter table public.tasks disable trigger user;
insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date) values
  ('b3101004-0000-4000-8000-000000000001', 900031003, 'cleaning', 'assigned',
   'b3100003-0000-4000-8000-000000000003', current_date + 1);
alter table public.tasks enable trigger user;
select pg_temp.as_tomas();
select pg_temp.check('a cleaning already on a technician stays in his sight',
  (select count(*)::int from public.tasks where id = 'b3101004-0000-4000-8000-000000000001'), 1);
reset role; reset request.jwt.claims;

select pg_temp.check('the field staff''s task policies name no role',
  (select coalesce(string_agg(policyname, ', '), '') from pg_policies
   where schemaname = 'public' and tablename = 'tasks'
     and policyname in ('assignee reads own tasks', 'cleaner reads tasks of her listings',
                        'assignee updates own tasks', 'cleaner claims a free task on her listings')
     and (coalesce(qual, '') || coalesce(with_check, '')) ~* 'role|head_tech'), '');

rollback;
