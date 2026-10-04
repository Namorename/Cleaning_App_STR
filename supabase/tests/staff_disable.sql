-- Switching a member of staff off takes her off the work she has not started
-- (owner's word 2026-10-04, docs/staff-disable-plan.md). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: when an account is switched off (profiles.is_active
-- from true to false — manage-staff writing the row as the service role, or a
-- manager writing it), every job on it that nobody has started is taken off at
-- once. A cleaning of any kind, an inspection or a repair written by hand is
-- free again — nobody on it, unassigned — the way save_task frees one. A
-- repair of a task (problem) is taken off the way unassign_problem does it:
-- the attempt cancelled, the task open again, «taken off» in its journal. Work
-- under way (in_progress, paused, blocked) and closed work stay as they are.
-- Her 'auto' links become 'claim', so the generator hands her nothing new;
-- switching her back on brings nothing back. And nothing names a person who no
-- longer works here on live work: not the generator, not a manager's direct
-- write, not a link set to 'auto'.
--
-- The one-off cleanup of the migration is release_work_of_inactive() called for
-- every person already switched off; §2 calls it on such a person, made with
-- the triggers off, as the cloud had them before the rule.
--
-- Fixture ids live in the 9000360xx range and under b36….
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('b3600000-0000-4000-8000-00000000000a', 'Host H');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b3600001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.disable@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b3600002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','hector.disable@test.local','x',now(),now(),
   '{"full_name":"Hector"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('b3600003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tomas.disable@test.local','x',now(),now(),
   '{"full_name":"Tomas"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('b3600004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','petr.disable@test.local','x',now(),now(),
   '{"full_name":"Petr"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('b3600005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.disable@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b3600006-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bella.disable@test.local','x',now(),now(),
   '{"full_name":"Bella"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b3600007-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gone.disable@test.local','x',now(),now(),
   '{"full_name":"Gone"}'::jsonb, '{"role":"cleaner"}'::jsonb);

update public.profiles set host_id = 'b3600000-0000-4000-8000-00000000000a'
where id::text like 'b360000_-0000-4000-8000-00000000000_';

insert into public.properties (id, host_id, name, timezone) values
  (900036001, 'b3600000-0000-4000-8000-00000000000a', 'Flat A', 'UTC'),
  (900036002, 'b3600000-0000-4000-8000-00000000000a', 'Flat B', 'UTC'),
  (900036003, 'b3600000-0000-4000-8000-00000000000a', 'Flat C', 'UTC');

-- Anna holds Flat A (the generator hands her its cleanings) and queues on
-- Flat B; Bella queues on Flat A; Gone held Flat C.
insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('b3600000-0000-4000-8000-00000000000a', 900036001, 'b3600005-0000-4000-8000-000000000005', 'auto'),
  ('b3600000-0000-4000-8000-00000000000a', 900036002, 'b3600005-0000-4000-8000-000000000005', 'claim'),
  ('b3600000-0000-4000-8000-00000000000a', 900036001, 'b3600006-0000-4000-8000-000000000006', 'claim'),
  ('b3600000-0000-4000-8000-00000000000a', 900036003, 'b3600007-0000-4000-8000-000000000007', 'auto');

insert into public.push_tokens (token, profile_id, host_id, platform) values
  ('ExponentPushToken[sd-anna]',  'b3600005-0000-4000-8000-000000000005', 'b3600000-0000-4000-8000-00000000000a', 'ios'),
  ('ExponentPushToken[sd-bella]', 'b3600006-0000-4000-8000-000000000006', 'b3600000-0000-4000-8000-00000000000a', 'android'),
  ('ExponentPushToken[sd-tomas]', 'b3600003-0000-4000-8000-000000000003', 'b3600000-0000-4000-8000-00000000000a', 'ios'),
  ('ExponentPushToken[sd-petr]',  'b3600004-0000-4000-8000-000000000004', 'b3600000-0000-4000-8000-00000000000a', 'ios'),
  ('ExponentPushToken[sd-gone]',  'b3600007-0000-4000-8000-000000000007', 'b3600000-0000-4000-8000-00000000000a', 'ios');

-- Flat A: a stay leaving today (Anna's cleaning) and one leaving tomorrow,
-- whose cleaning the generator has not written yet. Flat C, days 5 and 6
-- ahead, so a run over those two days reads Gone's alone.
insert into public.reservations (id, host_id, property_id, arrival_date, departure_date, status, guest_name)
values
  (900036101, 'b3600000-0000-4000-8000-00000000000a', 900036001, current_date - 2, current_date, 'new', 'Guest One'),
  (900036102, 'b3600000-0000-4000-8000-00000000000a', 900036001, current_date, current_date + 1, 'new', 'Guest Two'),
  (900036103, 'b3600000-0000-4000-8000-00000000000a', 900036003, current_date + 3, current_date + 5, 'new', 'Guest Three'),
  (900036104, 'b3600000-0000-4000-8000-00000000000a', 900036003, current_date + 5, current_date + 6, 'new', 'Guest Four');

insert into public.problems (id, host_id, property_id, reported_by, title) values
  ('b3603001-0000-4000-8000-000000000001', 'b3600000-0000-4000-8000-00000000000a', 900036001,
   'b3600006-0000-4000-8000-000000000006', 'Tap leaks'),
  ('b3603001-0000-4000-8000-000000000002', 'b3600000-0000-4000-8000-00000000000a', 900036001,
   'b3600006-0000-4000-8000-000000000006', 'Door squeaks'),
  ('b3603001-0000-4000-8000-000000000003', 'b3600000-0000-4000-8000-00000000000a', 900036001,
   'b3600006-0000-4000-8000-000000000006', 'Lamp flickers'),
  ('b3603001-0000-4000-8000-000000000005', 'b3600000-0000-4000-8000-00000000000a', 900036002,
   'b3600006-0000-4000-8000-000000000006', 'Shelf loose'),
  ('b3603001-0000-4000-8000-000000000006', 'b3600000-0000-4000-8000-00000000000a', 900036001,
   'b3600006-0000-4000-8000-000000000006', 'Window stuck'),
  ('b3603001-0000-4000-8000-000000000007', 'b3600000-0000-4000-8000-00000000000a', 900036003,
   'b3600006-0000-4000-8000-000000000006', 'Boiler noisy');

-- Written as postgres, with nobody signed in: the guards on tasks let it be.
insert into public.tasks (id, host_id, property_id, reservation_id, type, status, assignee_id,
                          scheduled_date, problem_id, started_at, completed_at)
values
  -- Anna's: every kind and every state.
  ('b3602001-0000-4000-8000-000000000001', 'b3600000-0000-4000-8000-00000000000a', 900036001, 900036101,
   'cleaning', 'assigned', 'b3600005-0000-4000-8000-000000000005', current_date, null, null, null),
  ('b3602001-0000-4000-8000-000000000002', 'b3600000-0000-4000-8000-00000000000a', 900036002, null,
   'cleaning', 'accepted', 'b3600005-0000-4000-8000-000000000005', current_date + 1, null, null, null),
  ('b3602001-0000-4000-8000-000000000003', 'b3600000-0000-4000-8000-00000000000a', 900036002, null,
   'cleaning', 'in_progress', 'b3600005-0000-4000-8000-000000000005', current_date, null, now(), null),
  ('b3602001-0000-4000-8000-000000000004', 'b3600000-0000-4000-8000-00000000000a', 900036002, null,
   'midstay', 'paused', 'b3600005-0000-4000-8000-000000000005', current_date, null, now(), null),
  ('b3602001-0000-4000-8000-000000000005', 'b3600000-0000-4000-8000-00000000000a', 900036002, null,
   'inspection', 'assigned', 'b3600005-0000-4000-8000-000000000005', current_date + 2, null, null, null),
  ('b3602001-0000-4000-8000-000000000006', 'b3600000-0000-4000-8000-00000000000a', 900036001, null,
   'midstay', 'accepted', 'b3600005-0000-4000-8000-000000000005', current_date + 3, null, null, null),
  -- A repair the office wrote by hand, with no task behind it.
  ('b3602001-0000-4000-8000-000000000007', 'b3600000-0000-4000-8000-00000000000a', 900036002, null,
   'maintenance', 'assigned', 'b3600005-0000-4000-8000-000000000005', current_date, null, null, null),
  ('b3602001-0000-4000-8000-000000000008', 'b3600000-0000-4000-8000-00000000000a', 900036002, null,
   'cleaning', 'done', 'b3600005-0000-4000-8000-000000000005', current_date - 5, null, now(), now()),
  ('b3602001-0000-4000-8000-000000000009', 'b3600000-0000-4000-8000-00000000000a', 900036002, null,
   'cleaning', 'expired', 'b3600005-0000-4000-8000-000000000005', current_date - 4, null, null, null),
  ('b3602001-0000-4000-8000-000000000010', 'b3600000-0000-4000-8000-00000000000a', 900036002, null,
   'cleaning', 'blocked', 'b3600005-0000-4000-8000-000000000005', current_date - 1, null, now(), null),
  -- A repair of a task, held by a cleaner: small repairs go to whoever is on the spot.
  ('b3602001-0000-4000-8000-000000000011', 'b3600000-0000-4000-8000-00000000000a', 900036002, null,
   'maintenance', 'assigned', 'b3600005-0000-4000-8000-000000000005', current_date, 'b3603001-0000-4000-8000-000000000005', null, null),
  -- Bella's, nothing to do with Anna.
  ('b3602001-0000-4000-8000-000000000012', 'b3600000-0000-4000-8000-00000000000a', 900036002, null,
   'cleaning', 'assigned', 'b3600006-0000-4000-8000-000000000006', current_date + 1, null, null, null),
  -- Tomas's repairs: handed out, accepted, under way.
  ('b3602001-0000-4000-8000-000000000021', 'b3600000-0000-4000-8000-00000000000a', 900036001, null,
   'maintenance', 'assigned', 'b3600003-0000-4000-8000-000000000003', current_date, 'b3603001-0000-4000-8000-000000000001', null, null),
  ('b3602001-0000-4000-8000-000000000022', 'b3600000-0000-4000-8000-00000000000a', 900036001, null,
   'maintenance', 'accepted', 'b3600003-0000-4000-8000-000000000003', current_date + 1, 'b3603001-0000-4000-8000-000000000002', null, null),
  ('b3602001-0000-4000-8000-000000000023', 'b3600000-0000-4000-8000-00000000000a', 900036001, null,
   'maintenance', 'in_progress', 'b3600003-0000-4000-8000-000000000003', current_date, 'b3603001-0000-4000-8000-000000000003', now(), null),
  -- Petr's repair.
  ('b3602001-0000-4000-8000-000000000026', 'b3600000-0000-4000-8000-00000000000a', 900036001, null,
   'maintenance', 'assigned', 'b3600004-0000-4000-8000-000000000004', current_date, 'b3603001-0000-4000-8000-000000000006', null, null),
  -- Gone's, written while he still worked.
  ('b3602001-0000-4000-8000-000000000031', 'b3600000-0000-4000-8000-00000000000a', 900036003, 900036103,
   'cleaning', 'assigned', 'b3600007-0000-4000-8000-000000000007', current_date + 5, null, null, null),
  ('b3602001-0000-4000-8000-000000000032', 'b3600000-0000-4000-8000-00000000000a', 900036003, null,
   'inspection', 'accepted', 'b3600007-0000-4000-8000-000000000007', current_date + 5, null, null, null),
  ('b3602001-0000-4000-8000-000000000033', 'b3600000-0000-4000-8000-00000000000a', 900036003, null,
   'maintenance', 'assigned', 'b3600007-0000-4000-8000-000000000007', current_date + 5, 'b3603001-0000-4000-8000-000000000007', null, null),
  ('b3602001-0000-4000-8000-000000000034', 'b3600000-0000-4000-8000-00000000000a', 900036003, null,
   'cleaning', 'in_progress', 'b3600007-0000-4000-8000-000000000007', current_date + 4, null, now(), null);

-- Gone was switched off before the rule existed: the triggers stay quiet, his
-- work stays on him, as the cloud's 87 cleanings did.
set local session_replication_role = replica;
update public.profiles set is_active = false where id = 'b3600007-0000-4000-8000-000000000007';
set local session_replication_role = origin;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

/** How a statement fails, as 'SQLSTATE hint', or 'no error'. */
create or replace function pg_temp.refusal(stmt text) returns text
language plpgsql as $fn$
declare
  v_hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return trim(sqlstate || ' ' || coalesce(v_hint, ''));
end $fn$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $fn$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$fn$;
create or replace function pg_temp.as_boss()   returns void language sql as $fn$
  select pg_temp.as_user('b3600001-0000-4000-8000-000000000001') $fn$;
create or replace function pg_temp.as_hector() returns void language sql as $fn$
  select pg_temp.as_user('b3600002-0000-4000-8000-000000000002') $fn$;

create or replace function pg_temp.anna() returns uuid language sql immutable as $fn$
  select 'b3600005-0000-4000-8000-000000000005'::uuid $fn$;
create or replace function pg_temp.bella() returns uuid language sql immutable as $fn$
  select 'b3600006-0000-4000-8000-000000000006'::uuid $fn$;
create or replace function pg_temp.tomas() returns uuid language sql immutable as $fn$
  select 'b3600003-0000-4000-8000-000000000003'::uuid $fn$;
create or replace function pg_temp.petr() returns uuid language sql immutable as $fn$
  select 'b3600004-0000-4000-8000-000000000004'::uuid $fn$;
create or replace function pg_temp.gone() returns uuid language sql immutable as $fn$
  select 'b3600007-0000-4000-8000-000000000007'::uuid $fn$;
create or replace function pg_temp.task(n integer) returns uuid language sql immutable as $fn$
  select ('b3602001-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $fn$;
create or replace function pg_temp.pid(n integer) returns uuid language sql immutable as $fn$
  select ('b3603001-0000-4000-8000-00000000000' || n::text)::uuid $fn$;

-- A task as "status Person", read as postgres; "nobody" when nobody holds it.
create or replace function pg_temp.state(n integer) returns text language sql as $fn$
  select t.status::text || ' ' || coalesce(pr.full_name, 'nobody')
  from public.tasks t left join public.profiles pr on pr.id = t.assignee_id
  where t.id = pg_temp.task(n) $fn$;
create or replace function pg_temp.states(ns integer[]) returns text[] language sql as $fn$
  select array_agg(pg_temp.state(n) order by i)
  from unnest(ns) with ordinality as u(n, i) $fn$;
create or replace function pg_temp.problem(n integer) returns text language sql as $fn$
  select p.status::text from public.problems p where p.id = pg_temp.pid(n) $fn$;
-- A person's links as "Flat mode", by flat.
create or replace function pg_temp.links(p_person uuid) returns text language sql as $fn$
  select string_agg(right(pr.name, 1) || ' ' || pc.mode::text, ', ' order by pr.name)
  from public.property_cleaners pc join public.properties pr on pr.id = pc.property_id
  where pc.cleaner_id = p_person $fn$;
-- The events of one task, as "kind Actor" in order.
create or replace function pg_temp.history(n integer) returns text[] language sql as $fn$
  select coalesce(array_agg(e.kind::text || ' ' || coalesce(pr.full_name, '(system)')
                            order by e.created_at, e.id), '{}')
  from public.problem_events e
  left join public.profiles pr on pr.id = e.actor_id
  where e.problem_id = pg_temp.pid(n) $fn$;
create or replace function pg_temp.last_params(n integer) returns jsonb language sql as $fn$
  select e.params from public.problem_events e
  where e.problem_id = pg_temp.pid(n) order by e.created_at desc, e.id desc limit 1 $fn$;
-- What the push queue holds, as "Person kind", sorted.
create or replace function pg_temp.queued() returns text[] language sql as $fn$
  select coalesce(array_agg(coalesce(pr.full_name, '?') || ' ' || o.kind::text
                            order by pr.full_name, o.kind::text, o.task_id), '{}')
  from raw.push_outbox o left join public.profiles pr on pr.id = o.recipient_id $fn$;
create or replace function pg_temp.clear() returns void language sql as $fn$
  delete from raw.push_outbox $fn$;
-- Unstarted live work on a person: what the rule says cannot outlive her account.
create or replace function pg_temp.unstarted(p_person uuid) returns integer language sql as $fn$
  select count(*)::int from public.tasks t
  where t.assignee_id = p_person and t.status in ('unassigned', 'assigned', 'accepted') $fn$;

-- ---------------------------------------------------------------------------
--  1. Where the rule lives
-- ---------------------------------------------------------------------------

select pg_temp.check('switching off wakes one trigger, after the row is written, for that move alone',
  (select pg_get_triggerdef(oid) ~ 'AFTER UPDATE OF is_active ON public\.profiles FOR EACH ROW WHEN \(\(old\.is_active AND \(NOT new\.is_active\)\)\)'
   from pg_trigger where tgname = 'profiles_release_work'), true);
select pg_temp.check('the release and its parts are no client''s to call',
  (select coalesce(string_agg(r || ' ' || f, ', ' order by r, f), '')
   from unnest(array['anon', 'authenticated']) r
   cross join unnest(array['public.release_work_of_inactive(uuid)',
                           'public.take_off_repairs(uuid[])',
                           'public.release_work_on_deactivation()',
                           'public.guard_person_works()',
                           'public.guard_auto_link_works()']) f
   where has_function_privilege(r, f, 'EXECUTE')),
  '');
select pg_temp.check('unassign_problem is still the office''s to call',
  array[has_function_privilege('authenticated', 'public.unassign_problem(uuid, uuid)', 'EXECUTE'),
        has_function_privilege('anon', 'public.unassign_problem(uuid, uuid)', 'EXECUTE')],
  array[true, false]);

-- ---------------------------------------------------------------------------
--  2. Switched off before the rule: the migration's cleanup
-- ---------------------------------------------------------------------------

select pg_temp.check('a run that would hand a cleaning to somebody switched off is refused whole',
  pg_temp.refusal('select public.generate_cleaning_tasks(current_date + 5, current_date + 6)'),
  '23514 serverErrors.taskAssigneeInvalid');

select pg_temp.check('the cleanup counts what it took off, and the pushes still waiting for him',
  public.release_work_of_inactive(pg_temp.gone()),
  jsonb_build_object('cleanings', 2, 'repairs', 1, 'links', 1, 'pushes', 3));
select pg_temp.check('his unstarted cleaning and inspection are free',
  pg_temp.states(array[31, 32]), array['unassigned nobody', 'unassigned nobody']);
select pg_temp.check('his repair is taken off and its task open again',
  array[pg_temp.state(33), pg_temp.problem(7)], array['cancelled Gone', 'open']);
select pg_temp.check('his work under way stays his',
  pg_temp.state(34), 'in_progress Gone');
select pg_temp.check('his auto link is a queue link now',
  pg_temp.links(pg_temp.gone()), 'C claim');
select pg_temp.check('the cleanup refuses a person who still works',
  pg_temp.refusal(format('select public.release_work_of_inactive(%L)', pg_temp.bella())),
  '22023');

select public.generate_cleaning_tasks(current_date + 5, current_date + 6);
select pg_temp.check('then the generator runs, and hands him nothing',
  pg_temp.unstarted(pg_temp.gone()), 0);
select pg_temp.check('the booking it had not cleaned yet gets a free cleaning',
  (select t.status::text || ' ' || coalesce(t.assignee_id::text, 'nobody')
   from public.tasks t where t.reservation_id = 900036104 and t.type = 'cleaning'),
  'unassigned nobody');
select pg_temp.check('and his freed cleaning stays free',
  pg_temp.state(31), 'unassigned nobody');

-- ---------------------------------------------------------------------------
--  3. Anna switched off by manage-staff (the service role: nobody signed in)
-- ---------------------------------------------------------------------------

select pg_temp.clear();
update public.profiles set is_active = false where id = pg_temp.anna();

select pg_temp.check('her unstarted cleanings, inspection and hand-made repair are free',
  pg_temp.states(array[1, 2, 5, 6, 7]),
  array['unassigned nobody', 'unassigned nobody', 'unassigned nobody', 'unassigned nobody',
        'unassigned nobody']);
select pg_temp.check('a freed cleaning keeps its day',
  (select t.scheduled_date from public.tasks t where t.id = pg_temp.task(2)), current_date + 1);
select pg_temp.check('her work under way stays hers',
  pg_temp.states(array[3, 4, 10]), array['in_progress Anna', 'paused Anna', 'blocked Anna']);
select pg_temp.check('her closed work stays as it was',
  pg_temp.states(array[8, 9]), array['done Anna', 'expired Anna']);
select pg_temp.check('somebody else''s work is not touched',
  pg_temp.state(12), 'assigned Bella');
select pg_temp.check('her repair of a task is taken off, the task open again',
  array[pg_temp.state(11), pg_temp.problem(5)], array['cancelled Anna', 'open']);
select pg_temp.check('the journal says she was taken off, by the system',
  pg_temp.history(5), array['reported (system)', 'assigned (system)', 'taken_off (system)']);
select pg_temp.check('and names her',
  pg_temp.last_params(5), jsonb_build_object('assignee', pg_temp.anna()));
select pg_temp.check('her auto link is a queue link now, her queue link stays',
  pg_temp.links(pg_temp.anna()), 'A claim, B claim');
select pg_temp.check('she hears nothing: her phone went with her account; her colleague on the listing hears the cleanings are free',
  pg_temp.queued(), array['Bella cleaning_free', 'Bella cleaning_free']);
select pg_temp.check('the free ones she hears of are the cleanings of her listing',
  (select array_agg(o.task_id order by o.task_id) from raw.push_outbox o),
  array[pg_temp.task(1), pg_temp.task(6)]);

select pg_temp.clear();
select public.generate_cleaning_tasks(current_date - 1, current_date + 3);
select pg_temp.check('the generator hands her nothing through her old auto link',
  pg_temp.unstarted(pg_temp.anna()), 0);
select pg_temp.check('her freed cleaning of the booking stays free',
  pg_temp.state(1), 'unassigned nobody');
select pg_temp.check('the booking it had not cleaned yet gets a free cleaning',
  (select t.status::text || ' ' || coalesce(t.assignee_id::text, 'nobody')
   from public.tasks t where t.reservation_id = 900036102 and t.type = 'cleaning'),
  'unassigned nobody');

-- ---------------------------------------------------------------------------
--  4. Tomas switched off by the manager writing his row
-- ---------------------------------------------------------------------------

select pg_temp.clear();
select pg_temp.as_boss();
update public.profiles set is_active = false where id = pg_temp.tomas();
reset role; reset request.jwt.claims;

select pg_temp.check('his handed-out and accepted repairs are taken off, their tasks open again',
  array[pg_temp.state(21), pg_temp.state(22), pg_temp.problem(1), pg_temp.problem(2)],
  array['cancelled Tomas', 'cancelled Tomas', 'open', 'open']);
select pg_temp.check('his repair under way stays his, its task in progress',
  array[pg_temp.state(23), pg_temp.problem(3)], array['in_progress Tomas', 'in_progress']);
select pg_temp.check('the journal names the manager who switched him off',
  pg_temp.history(1), array['reported (system)', 'assigned (system)', 'taken_off Boss']);
select pg_temp.check('and him',
  pg_temp.last_params(2), jsonb_build_object('assignee', pg_temp.tomas()));
select pg_temp.check('another technician''s repair is not touched',
  pg_temp.state(26), 'assigned Petr');
select pg_temp.check('nobody hears of it: he is switched off, and a task open again is no free work',
  pg_temp.queued(), '{}'::text[]);

-- ---------------------------------------------------------------------------
--  5. Switched on again: nothing comes back
-- ---------------------------------------------------------------------------

update public.profiles set is_active = true where id in (pg_temp.anna(), pg_temp.tomas());

select pg_temp.check('her freed work stays free',
  pg_temp.states(array[1, 2, 5, 6, 7]),
  array['unassigned nobody', 'unassigned nobody', 'unassigned nobody', 'unassigned nobody',
        'unassigned nobody']);
select pg_temp.check('the repairs stay taken off, their tasks open',
  array[pg_temp.state(11), pg_temp.state(21), pg_temp.state(22),
        pg_temp.problem(5), pg_temp.problem(1), pg_temp.problem(2)],
  array['cancelled Anna', 'cancelled Tomas', 'cancelled Tomas', 'open', 'open', 'open']);
select pg_temp.check('her links stay queue links',
  pg_temp.links(pg_temp.anna()), 'A claim, B claim');

select public.generate_cleaning_tasks(current_date - 1, current_date + 3);
select pg_temp.check('and the generator gives her nothing back',
  pg_temp.unstarted(pg_temp.anna()), 0);

-- Switched off again: nothing unstarted is left, nothing changes.
update public.profiles set is_active = false where id = pg_temp.anna();
select pg_temp.check('switched off again, her work under way still stays hers',
  pg_temp.states(array[3, 4, 10]), array['in_progress Anna', 'paused Anna', 'blocked Anna']);

-- ---------------------------------------------------------------------------
--  6. Nothing names her on live work while she is off
-- ---------------------------------------------------------------------------

set local track_functions = 'all';
create or replace function pg_temp.calls(fn text) returns integer language sql as $fn$
  select coalesce(sum(calls), 0)::int from pg_stat_xact_user_functions
  where schemaname = 'public' and funcname = fn $fn$;
create temp table guard_before on commit drop as
  select pg_temp.calls('guard_person_works') as calls;

select pg_temp.as_boss();
select pg_temp.check('a manager''s direct write cannot hand her a job',
  pg_temp.refusal(format(
    $q$update public.tasks set assignee_id = %L, status = 'assigned' where id = %L$q$,
    pg_temp.anna(), pg_temp.task(1))),
  '23514 serverErrors.taskAssigneeInvalid');
select pg_temp.check('nor write a new one with her name',
  pg_temp.refusal(format(
    $q$insert into public.tasks (host_id, property_id, type, status, assignee_id, scheduled_date)
       values ('b3600000-0000-4000-8000-00000000000a', 900036002, 'cleaning', 'assigned', %L, current_date + 2)$q$,
    pg_temp.anna())),
  '23514 serverErrors.taskAssigneeInvalid');
select pg_temp.check('nor bring a closed job of hers back to life',
  pg_temp.refusal(format($q$update public.tasks set status = 'assigned' where id = %L$q$,
                         pg_temp.task(8))),
  '23514 serverErrors.taskAssigneeInvalid');
select pg_temp.check('nor turn her work under way back into work not started',
  pg_temp.refusal(format($q$update public.tasks set status = 'accepted' where id = %L$q$,
                         pg_temp.task(3))),
  '23514 serverErrors.taskAssigneeInvalid');
select pg_temp.check('save_task refuses her too',
  pg_temp.refusal(format(
    $q$select public.save_task('b3602001-0000-4000-8000-000000000099', 900036002, 'cleaning',
                               current_date + 2, p_assignee_id => %L)$q$, pg_temp.anna())),
  '23514 serverErrors.taskAssigneeInvalid');
select pg_temp.check('and so does a dispatch',
  pg_temp.refusal(format($q$select public.assign_problem(%L, %L)$q$,
                         pg_temp.pid(1), pg_temp.anna())),
  '23514 serverErrors.problemAssigneeInvalid');
select pg_temp.check('the manager decides about her work under way: hands it on',
  pg_temp.refusal(format($q$update public.tasks set assignee_id = %L where id = %L$q$,
                         pg_temp.bella(), pg_temp.task(4))),
  'no error');
select pg_temp.check('or closes it',
  pg_temp.refusal(format($q$update public.tasks set status = 'done' where id = %L$q$,
                         pg_temp.task(3))),
  'no error');
select pg_temp.check('both done',
  pg_temp.states(array[4, 3]), array['paused Bella', 'done Anna']);
reset role; reset request.jwt.claims;

select pg_temp.check('nor does the server name her',
  pg_temp.refusal(format($q$update public.tasks set assignee_id = %L, status = 'assigned' where id = %L$q$,
                         pg_temp.anna(), pg_temp.task(2))),
  '23514 serverErrors.taskAssigneeInvalid');

-- A write that names nobody, or keeps the person live work already has, does
-- not even ask: the generator's reschedule and a freed job cost nothing.
select pg_temp.check('the refusals above were the guard''s',
  pg_temp.calls('guard_person_works') - (select calls from guard_before) > 0, true);
create temp table guard_quiet on commit drop as
  select pg_temp.calls('guard_person_works') as calls;
update public.tasks set scheduled_date = current_date + 2, status = 'assigned'
where id = pg_temp.task(12);
update public.tasks set assignee_id = null, status = 'unassigned' where id = pg_temp.task(12);
select pg_temp.check('moving a job with its person, or freeing one, never calls the guard',
  pg_temp.calls('guard_person_works') - (select calls from guard_quiet), 0);

-- ---------------------------------------------------------------------------
--  7. Nor does a link make her the listing's fixed cleaner
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();
select pg_temp.check('a manager cannot fix her to a listing',
  pg_temp.refusal(format($q$select public.save_property_cleaner(900036002, %L, 'auto')$q$,
                         pg_temp.anna())),
  '23514 serverErrors.cleanerAutoInactive');
select pg_temp.check('nor turn her old link into one',
  pg_temp.refusal(format(
    $q$update public.property_cleaners set mode = 'auto' where cleaner_id = %L and property_id = 900036001$q$,
    pg_temp.anna())),
  '23514 serverErrors.cleanerAutoInactive');
select pg_temp.check('a queue link stays hers to keep: she may come back',
  pg_temp.refusal(format($q$select public.save_property_cleaner(900036003, %L, 'claim')$q$,
                         pg_temp.anna())),
  'no error');
reset role; reset request.jwt.claims;
select pg_temp.check('her links',
  pg_temp.links(pg_temp.anna()), 'A claim, B claim, C claim');

-- ---------------------------------------------------------------------------
--  8. unassign_problem takes a technician off as before
-- ---------------------------------------------------------------------------

select pg_temp.clear();
select pg_temp.as_hector();
select public.unassign_problem(pg_temp.task(26), pg_temp.petr());
reset role; reset request.jwt.claims;
select pg_temp.check('the head technician takes Petr off: the attempt cancelled, the task open',
  array[pg_temp.state(26), pg_temp.problem(6)], array['cancelled Petr', 'open']);
select pg_temp.check('the journal says taken off, by him',
  pg_temp.history(6), array['reported (system)', 'assigned (system)', 'taken_off Hector']);
select pg_temp.check('and Petr hears the work was taken from him',
  pg_temp.queued(), array['Petr cleaning_unassigned']);

-- ---------------------------------------------------------------------------
--  9. What is left on people switched off: work under way alone
-- ---------------------------------------------------------------------------

select pg_temp.check('nothing unstarted names anybody switched off',
  (select count(*)::int from public.tasks t join public.profiles p on p.id = t.assignee_id
   where t.host_id = 'b3600000-0000-4000-8000-00000000000a'
     and not p.is_active
     and t.status in ('unassigned', 'assigned', 'accepted')),
  0);
select pg_temp.check('work under way on them is what the dashboard shows',
  (select array_agg(right(t.id::text, 2) || ' ' || t.status::text order by t.id)
   from public.tasks t join public.profiles p on p.id = t.assignee_id
   where t.host_id = 'b3600000-0000-4000-8000-00000000000a'
     and not p.is_active
     and t.status in ('in_progress', 'paused', 'blocked')),
  array['10 blocked', '34 in_progress']);

-- ---------------------------------------------------------------------------
--  10. Her pushes still waiting go with her
-- ---------------------------------------------------------------------------

-- At night the office hands Bella a cleaning, and the push waits for the
-- morning. She is switched off before it goes and back on before seven: she
-- must not hear «Вам назначена уборка» of a cleaning the switch took off her.
-- Her rows are settled as claim_push_batch would settle them while she is off
-- (skipped); a group a sender holds right now is the sender's.
select pg_temp.clear();
select pg_temp.as_boss();
select public.save_task('b3602001-0000-4000-8000-000000000040', 900036002, 'cleaning',
                        current_date + 3, p_assignee_id => pg_temp.bella());
reset role; reset request.jwt.claims;
-- Seven o'clock has come: the row is due.
update raw.push_outbox set send_after = now() - interval '1 minute',
                           expire_at = now() + interval '30 minutes'
where recipient_id = pg_temp.bella();
insert into raw.push_outbox (host_id, recipient_id, kind, collapse_key, params, urgent,
                             send_after, expire_at, claimed_until, claimed_at, claimed_by)
values ('b3600000-0000-4000-8000-00000000000a', pg_temp.bella(), 'cleaning_window', 'task:leased',
        '{}', true, now() - interval '1 minute', now() + interval '30 minutes',
        now() + interval '1 minute', now(), gen_random_uuid());
select pg_temp.check('the handing out waits in the queue for her, beside a group a sender holds',
  (select array_agg(o.kind::text order by o.kind::text) from raw.push_outbox o
   where o.recipient_id = pg_temp.bella() and o.settled_at is null),
  array['cleaning_assigned', 'cleaning_window']);

update public.profiles set is_active = false where id = pg_temp.bella();
select pg_temp.check('switched off, her waiting push is settled as skipped, unleased',
  (select array[o.outcome, (o.settled_at is not null)::text, (o.claimed_until is null)::text]
   from raw.push_outbox o
   where o.recipient_id = pg_temp.bella() and o.kind = 'cleaning_assigned'),
  array['skipped', 'true', 'true']);
select pg_temp.check('the group a sender holds is left to the sender',
  (select o.settled_at is null from raw.push_outbox o
   where o.recipient_id = pg_temp.bella() and o.collapse_key = 'task:leased'),
  true);

update public.profiles set is_active = true where id = pg_temp.bella();
select pg_temp.check('switched on again before seven, the sender hands her nothing',
  (select count(*)::int from jsonb_array_elements(public.claim_push_batch(100)) g
   where g ->> 'recipient_id' = pg_temp.bella()::text),
  0);

rollback;
