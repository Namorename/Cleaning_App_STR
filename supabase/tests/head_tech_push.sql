-- The head technician's pushes (docs/tech-plan.md, 5; owner's decisions 5 and
-- 6 of 2026-10-01). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - a task reported in his company reaches every active head technician with
--   a phone, never the one who reported it; a high priority is urgent, the
--   rest waits out quiet hours; one push a task; the row says what, where and
--   who, never the task's text;
-- - when it is due, a task closed or put away since, a recipient who is no
--   longer the head technician, or one who switched the kind off gets nothing;
-- - a message in the conversation of any task reaches him, a cleaning's never;
-- - the morning summary is his, without free cleanings;
-- - his move of a repair reads as the office's, and taking a technician off
--   tells the technician the work was taken from him, not cancelled;
-- - his unread list asks nothing per task thread.
--
-- Fixture ids live in the 9000340xx range and under b34…. The listing is in
-- UTC, so "today" in the listing is today in the test.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('b3400000-0000-4000-8000-00000000000a', 'Host H'),
  ('b3400000-0000-4000-8000-00000000000b', 'Host O');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b3400001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.htpush@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b3400002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','hector.htpush@test.local','x',now(),now(),
   '{"full_name":"Hector"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('b3400003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','ivan.htpush@test.local','x',now(),now(),
   '{"full_name":"Ivan"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('b3400004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tomas.htpush@test.local','x',now(),now(),
   '{"full_name":"Tomas"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('b3400005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.htpush@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  -- Dismissed, phone still registered.
  ('b3400006-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gone.htpush@test.local','x',now(),now(),
   '{"full_name":"Gone"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  -- No phone registered.
  ('b3400007-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','nora.htpush@test.local','x',now(),now(),
   '{"full_name":"Nora"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  -- Another company's head technician.
  ('b3400009-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','olga.htpush@test.local','x',now(),now(),
   '{"full_name":"Olga"}'::jsonb, '{"role":"head_tech"}'::jsonb);

update public.profiles set host_id = 'b3400000-0000-4000-8000-00000000000a'
where id::text like 'b340000_-0000-4000-8000-00000000000_'
  and id <> 'b3400009-0000-4000-8000-000000000009';
update public.profiles set host_id = 'b3400000-0000-4000-8000-00000000000b'
where id = 'b3400009-0000-4000-8000-000000000009';
update public.profiles set is_active = false where id = 'b3400006-0000-4000-8000-000000000006';

insert into public.properties (id, host_id, name, timezone) values
  (900034001, 'b3400000-0000-4000-8000-00000000000a', 'Leak flat', 'UTC'),
  (900034009, 'b3400000-0000-4000-8000-00000000000b', 'Their flat', 'UTC');

insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('b3400000-0000-4000-8000-00000000000a', 900034001, 'b3400005-0000-4000-8000-000000000005', 'claim');

-- Phones. Written as postgres: the registration RPC is tested elsewhere.
insert into public.push_tokens (token, profile_id, host_id, platform) values
  ('ExponentPushToken[htp-boss]',   'b3400001-0000-4000-8000-000000000001', 'b3400000-0000-4000-8000-00000000000a', 'ios'),
  ('ExponentPushToken[htp-hector]', 'b3400002-0000-4000-8000-000000000002', 'b3400000-0000-4000-8000-00000000000a', 'android'),
  ('ExponentPushToken[htp-ivan]',   'b3400003-0000-4000-8000-000000000003', 'b3400000-0000-4000-8000-00000000000a', 'ios'),
  ('ExponentPushToken[htp-tomas]',  'b3400004-0000-4000-8000-000000000004', 'b3400000-0000-4000-8000-00000000000a', 'ios'),
  ('ExponentPushToken[htp-anna]',   'b3400005-0000-4000-8000-000000000005', 'b3400000-0000-4000-8000-00000000000a', 'android'),
  ('ExponentPushToken[htp-gone]',   'b3400006-0000-4000-8000-000000000006', 'b3400000-0000-4000-8000-00000000000a', 'ios'),
  ('ExponentPushToken[htp-olga]',   'b3400009-0000-4000-8000-000000000009', 'b3400000-0000-4000-8000-00000000000b', 'ios');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $fn$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$fn$;
create or replace function pg_temp.as_boss()   returns void language sql as $fn$
  select pg_temp.as_user('b3400001-0000-4000-8000-000000000001') $fn$;
create or replace function pg_temp.as_hector() returns void language sql as $fn$
  select pg_temp.as_user('b3400002-0000-4000-8000-000000000002') $fn$;
create or replace function pg_temp.as_anna()   returns void language sql as $fn$
  select pg_temp.as_user('b3400005-0000-4000-8000-000000000005') $fn$;

create or replace function pg_temp.hector() returns uuid language sql immutable as $fn$
  select 'b3400002-0000-4000-8000-000000000002'::uuid $fn$;
create or replace function pg_temp.ivan() returns uuid language sql immutable as $fn$
  select 'b3400003-0000-4000-8000-000000000003'::uuid $fn$;
create or replace function pg_temp.tomas() returns uuid language sql immutable as $fn$
  select 'b3400004-0000-4000-8000-000000000004'::uuid $fn$;
create or replace function pg_temp.pid(n integer) returns uuid language sql immutable as $fn$
  select ('b3403001-0000-4000-8000-00000000000' || n::text)::uuid $fn$;
create or replace function pg_temp.live_fix(n integer) returns uuid language sql as $fn$
  select t.id from public.tasks t
  where t.problem_id = pg_temp.pid(n) and t.status not in ('done', 'cancelled', 'expired') $fn$;

-- What the queue holds, as "recipient-name kind" in order of writing. Read as
-- postgres: the queue lives in raw, closed to every client.
create or replace function pg_temp.queued() returns text[] language sql as $fn$
  select coalesce(array_agg(
           coalesce((select pr.full_name from public.profiles pr where pr.id = o.recipient_id), '?')
           || ' ' || o.kind::text
           order by o.id), '{}')
  from raw.push_outbox o
$fn$;
create or replace function pg_temp.row_for(p_recipient uuid, p_kind public.push_kind)
returns raw.push_outbox language sql as $fn$
  select o.* from raw.push_outbox o
  where o.recipient_id = p_recipient and o.kind = p_kind
  order by o.id desc limit 1 $fn$;
create or replace function pg_temp.clear() returns void language sql as $fn$
  delete from raw.push_outbox $fn$;

-- What a claim handed out, as "recipient-name collapse-key: kind, kind".
create or replace function pg_temp.handed(batch jsonb) returns text[] language sql as $fn$
  select coalesce(array_agg(
           (select pr.full_name from public.profiles pr where pr.id = (g ->> 'recipient_id')::uuid)
           || ' ' || (g ->> 'collapse_key') || ': '
           || (select string_agg(r ->> 'kind', ', ' order by (r ->> 'id')::bigint)
               from jsonb_array_elements(g -> 'rows') r)
           order by g ->> 'recipient_id', g ->> 'collapse_key'), '{}')
  from jsonb_array_elements(batch) g
$fn$;

-- ---------------------------------------------------------------------------
--  «Новое задание»
-- ---------------------------------------------------------------------------

select pg_temp.check('the kind sits with the work, before the conversation and the summary',
  (select array_position(enum_range(null::public.push_kind), 'problem_new')
          = array_position(enum_range(null::public.push_kind), 'chat_message') - 1), true);

select pg_temp.as_anna();
select public.report_problem(pg_temp.pid(1), 'Door squeaks', 'Bedroom', 'normal', 900034001);
reset role; reset request.jwt.claims;
-- Gone is dismissed, Nora has no phone, Olga works elsewhere, Tomas and the
-- manager are not head technicians, Anna reported it.
select pg_temp.check('a reported task reaches every active head technician with a phone',
  pg_temp.queued(), array['Hector problem_new', 'Ivan problem_new']);
select pg_temp.check('one push a task, about the task and no cleaning',
  (select array[(o).collapse_key, coalesce((o).task_id::text, '-'), coalesce((o).thread_id::text, '-')]
   from (select pg_temp.row_for(pg_temp.hector(), 'problem_new') as o) x),
  array['problem:' || pg_temp.pid(1), '-', '-']);
select pg_temp.check('what, where and who reported it — never its title or text',
  (select (o).params from (select pg_temp.row_for(pg_temp.hector(), 'problem_new') as o) x),
  jsonb_build_object('problem_id', pg_temp.pid(1), 'priority', 'normal',
                     'property', 900034001, 'reporter_name', 'Anna'));
select pg_temp.check('an ordinary task waits out quiet hours, as calm news does',
  (select array[(o).urgent::text,
                ((o).send_after = public.push_send_after(false))::text,
                ((o).expire_at = (o).send_after + public.push_lifetime())::text]
   from (select pg_temp.row_for(pg_temp.hector(), 'problem_new') as o) x),
  array['false', 'true', 'true']);
select pg_temp.clear();

select pg_temp.as_anna();
select public.report_problem(pg_temp.pid(2), 'Water on the floor', null, 'high', 900034001);
reset role; reset request.jwt.claims;
select pg_temp.check('a task of high priority is urgent: it goes in a minute, at any hour',
  (select array[(o).urgent::text, ((o).send_after = public.push_send_after(true))::text]
   from (select pg_temp.row_for(pg_temp.ivan(), 'problem_new') as o) x),
  array['true', 'true']);
select pg_temp.clear();

-- The head technician reports from his own repair: his colleague hears of it,
-- he does not.
select pg_temp.as_boss();
select public.assign_problem(pg_temp.pid(1), pg_temp.hector());
select pg_temp.as_hector();
select public.report_problem(pg_temp.pid(3), 'Pipe rusted through', null, 'normal', null,
                             pg_temp.live_fix(1));
reset role; reset request.jwt.claims;
select pg_temp.check('the head technician who reported it is not told',
  (select array_agg(x order by x) from unnest(pg_temp.queued()) x where x like '% problem_new'),
  array['Ivan problem_new']);
select pg_temp.clear();

-- Written with nobody signed in (an import, say): everybody hears of it.
insert into public.problems (id, host_id, property_id, reported_by, title) values
  (pg_temp.pid(4), 'b3400000-0000-4000-8000-00000000000a', 900034001,
   'b3400005-0000-4000-8000-000000000005', 'Window stuck');
select pg_temp.check('a task the system wrote reaches them too',
  pg_temp.queued(), array['Hector problem_new', 'Ivan problem_new']);
select pg_temp.clear();

insert into public.problems (id, host_id, property_id, reported_by, title) values
  (pg_temp.pid(9), 'b3400000-0000-4000-8000-00000000000b', 900034009,
   'b3400009-0000-4000-8000-000000000009', 'Their roof');
select pg_temp.check('another company''s task reaches nobody here, and not its own reporter',
  pg_temp.queued(), '{}'::text[]);

select pg_temp.check('no client may call the trigger''s function',
  has_function_privilege('authenticated', 'public.push_on_problem_reported()', 'EXECUTE'), false);

-- ---------------------------------------------------------------------------
--  When it is due
-- ---------------------------------------------------------------------------

-- Rows written by hand, due a minute ago: one push a task and person.
create or replace function pg_temp.queue_new(p_recipient uuid, n integer) returns bigint
language sql as $fn$
  insert into raw.push_outbox (host_id, recipient_id, kind, collapse_key, params, urgent,
                               send_after, expire_at)
  values ('b3400000-0000-4000-8000-00000000000a', p_recipient, 'problem_new',
          'problem:' || pg_temp.pid(n),
          jsonb_build_object('problem_id', pg_temp.pid(n), 'priority', 'normal',
                             'property', 900034001, 'reporter_name', 'Anna'),
          false, now() - interval '1 minute', now() + interval '29 minutes')
  returning id
$fn$;
create or replace function pg_temp.outcome(p_id bigint) returns text language sql as $fn$
  select coalesce(o.outcome, 'pending') from raw.push_outbox o where o.id = p_id $fn$;

create temp table due (name text primary key, id bigint);
insert into due values
  ('live',     pg_temp.queue_new(pg_temp.hector(), 1)),
  ('muted',    pg_temp.queue_new(pg_temp.ivan(), 1)),
  ('archived', pg_temp.queue_new(pg_temp.hector(), 2)),
  ('closed',   pg_temp.queue_new(pg_temp.hector(), 4));
insert into public.push_preferences (profile_id, host_id, muted) values
  (pg_temp.ivan(), 'b3400000-0000-4000-8000-00000000000a', '{problem_new}');
update public.problems set archived_at = now() where id = pg_temp.pid(2);
update public.problems set status = 'cancelled', cancelled_at = now() where id = pg_temp.pid(4);

create temp table due_claim as select public.claim_push_batch() as batch;
select pg_temp.check('a task still open goes, to the head technician who wants it',
  pg_temp.handed((select batch from due_claim)),
  array['Hector problem:' || pg_temp.pid(1) || ': problem_new']);
select pg_temp.check('named by its place',
  (select array[g -> 'rows' -> 0 ->> 'property_id', g -> 'places' -> '900034001' ->> 'name']
   from due_claim, jsonb_array_elements(batch) g),
  array['900034001', 'Leak flat']);
select pg_temp.check('switched off, put away since, or closed since: settled, never handed out',
  array[pg_temp.outcome((select id from due where name = 'muted')),
        pg_temp.outcome((select id from due where name = 'archived')),
        pg_temp.outcome((select id from due where name = 'closed'))],
  array['muted', 'skipped', 'skipped']);

-- No longer the head technician by the time it is due.
select pg_temp.clear();
insert into due values ('demoted', pg_temp.queue_new(pg_temp.hector(), 1)) on conflict (name) do
  update set id = excluded.id;
update public.profiles set role = 'tech' where id = pg_temp.hector();
select pg_temp.check('a recipient no longer the head technician is not told',
  pg_temp.handed(public.claim_push_batch()), '{}'::text[]);
select pg_temp.check('and the row is settled as skipped',
  pg_temp.outcome((select id from due where name = 'demoted')), 'skipped');
update public.profiles set role = 'head_tech' where id = pg_temp.hector();
delete from public.push_preferences where profile_id = pg_temp.ivan();
update public.problems set archived_at = null where id = pg_temp.pid(2);
select pg_temp.clear();

-- ---------------------------------------------------------------------------
--  The conversation of every task, and no cleaning's
-- ---------------------------------------------------------------------------

-- Task 2 has nobody on it: nobody but the reporter, the head technicians and
-- whoever wrote before is in its conversation.
select pg_temp.as_anna();
select public.send_message('b3407001-0000-4000-8000-000000000001', 'Течёт под ванной',
                           null, pg_temp.pid(2));
reset role; reset request.jwt.claims;
select pg_temp.check('a message in a task''s conversation reaches the head technicians, who never wrote there',
  pg_temp.queued(), array['Hector chat_message', 'Ivan chat_message']);
select pg_temp.clear();

select pg_temp.as_hector();
select public.send_message('b3407001-0000-4000-8000-000000000002', 'Буду в 14:00',
                           null, pg_temp.pid(2));
reset role; reset request.jwt.claims;
select pg_temp.check('his own message reaches the reporter and his colleague, not him',
  pg_temp.queued(), array['Ivan chat_message', 'Anna chat_message']);
select pg_temp.clear();

insert into public.tasks (id, host_id, property_id, type, status, assignee_id, scheduled_date) values
  ('b3402001-0000-4000-8000-000000000001', 'b3400000-0000-4000-8000-00000000000a', 900034001,
   'cleaning', 'assigned', 'b3400005-0000-4000-8000-000000000005', current_date);
select pg_temp.clear();
select pg_temp.as_boss();
select public.send_message('b3407001-0000-4000-8000-000000000003', 'Ключ в ящике',
                           'b3402001-0000-4000-8000-000000000001');
reset role; reset request.jwt.claims;
select pg_temp.check('a cleaning''s conversation reaches its cleaner, never the head technician',
  pg_temp.queued(), array['Anna chat_message']);
select pg_temp.clear();

-- ---------------------------------------------------------------------------
--  The morning summary
-- ---------------------------------------------------------------------------

-- Hector holds the repair of task 1 today (handed to him above). Free work
-- on the leak flat is Anna's to take, never his.
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date) values
  ('b3402001-0000-4000-8000-000000000002', 'b3400000-0000-4000-8000-00000000000a', 900034001,
   'cleaning', 'unassigned', current_date);
select pg_temp.clear();
select public.enqueue_daily_digest(((current_date + time '07:10') at time zone 'Europe/Prague'));
select pg_temp.check('the head technician with work today gets the summary; his colleague with none does not',
  (select array_agg(x order by x) from unnest(pg_temp.queued()) x where x not like 'Anna %'),
  array['Hector daily_digest']);
select pg_temp.check('saying what is his today, and nothing free',
  (select array[(o).params ->> 'today', (o).params ->> 'free']
   from (select pg_temp.row_for(pg_temp.hector(), 'daily_digest') as o) x),
  array['1', '0']);
select pg_temp.clear();

-- ---------------------------------------------------------------------------
--  His dispatch reads as the office's
-- ---------------------------------------------------------------------------

select pg_temp.as_hector();
select public.assign_problem(pg_temp.pid(2), pg_temp.tomas());
reset role; reset request.jwt.claims;
select pg_temp.check('the technician he hands a repair to is told it is his',
  pg_temp.queued(), array['Tomas cleaning_assigned']);
select pg_temp.clear();

select pg_temp.as_hector();
select public.assign_problem(pg_temp.pid(2), pg_temp.tomas(), current_date + 1);
reset role; reset request.jwt.claims;
select pg_temp.check('a repair he moves was moved by the office, not by a booking',
  (select array[(o).kind::text, (o).params ->> 'by']
   from (select pg_temp.row_for(pg_temp.tomas(), 'cleaning_moved') as o) x),
  array['cleaning_moved', 'office']);
select pg_temp.clear();

select pg_temp.as_boss();
select public.assign_problem(pg_temp.pid(2), pg_temp.tomas(), current_date + 2);
reset role; reset request.jwt.claims;
select pg_temp.check('as a manager''s move always was',
  (select (o).params ->> 'by' from (select pg_temp.row_for(pg_temp.tomas(), 'cleaning_moved') as o) x),
  'office');
select pg_temp.clear();

-- His own repair, which he moves directly, is still an executor's write: the
-- guard holds the day, and nobody is told anything.
select pg_temp.as_hector();
update public.tasks set scheduled_date = current_date + 3 where id = pg_temp.live_fix(1);
reset role; reset request.jwt.claims;
select pg_temp.check('his direct write moves nothing and tells nobody',
  pg_temp.queued(), '{}'::text[]);

select pg_temp.as_hector();
select public.assign_problem(pg_temp.pid(2), pg_temp.tomas(), current_date + 1);
reset role; reset request.jwt.claims;
select pg_temp.clear();
select pg_temp.as_hector();
select public.unassign_problem(pg_temp.live_fix(2));
reset role; reset request.jwt.claims;
select pg_temp.check('taken off, the technician hears the work was taken from him, at once',
  (select array[(o).kind::text, (o).urgent::text]
   from (select pg_temp.row_for(pg_temp.tomas(), 'cleaning_unassigned') as o) x),
  array['cleaning_unassigned', 'true']);
select pg_temp.check('and not that it was cancelled',
  pg_temp.queued(), array['Tomas cleaning_unassigned']);
select pg_temp.clear();

select pg_temp.as_boss();
select public.assign_problem(pg_temp.pid(2), pg_temp.tomas(), current_date + 1);
reset role; reset request.jwt.claims;
select pg_temp.clear();
select pg_temp.as_boss();
select public.cancel_problem(pg_temp.pid(2));
reset role; reset request.jwt.claims;
select pg_temp.check('the task cancelled by the office is cancelled work, as before',
  pg_temp.queued(), array['Tomas cleaning_cancelled']);
select pg_temp.clear();

-- ---------------------------------------------------------------------------
--  His unread list asks nothing per task thread
-- ---------------------------------------------------------------------------

-- Task 1 waits for Hector to read what Anna said; in task 2 the last word is
-- his; the cleaning's thread is not his at all.
select pg_temp.as_anna();
select public.send_message('b3407001-0000-4000-8000-000000000004', 'Дверь всё ещё скрипит',
                           null, pg_temp.pid(1));
reset role; reset request.jwt.claims;

set local track_functions = 'all';
create or replace function pg_temp.calls(fn text) returns integer language sql as $fn$
  select coalesce(sum(calls), 0)::int from pg_stat_xact_user_functions
  where schemaname = 'public' and funcname = fn $fn$;
create temp table calls_mark on commit drop as select pg_temp.calls('chat_participates') as calls;

select pg_temp.as_hector();
create temp table his_unread on commit drop as
  select thread_id, problem_id from public.chat_unread_threads();
reset role; reset request.jwt.claims;
-- The cleaning's thread is asked; a task's is his by being in his company
-- (task 2's never gets that far: its last word is his).
select pg_temp.check('the threads of tasks take the short cut, as a manager''s do',
  pg_temp.calls('chat_participates') - (select calls from calls_mark), 1);
select pg_temp.check('and the list is what the rule says: the task whose last word is not his',
  (select array_agg(problem_id order by problem_id) from his_unread),
  array[pg_temp.pid(1)]);
select pg_temp.as_hector();
select pg_temp.check('the same as with the ids on his screen',
  (select array_agg(problem_id order by problem_id)
   from public.chat_unread_threads(null, array[pg_temp.pid(1), pg_temp.pid(2)])),
  array[pg_temp.pid(1)]);
reset role; reset request.jwt.claims;

rollback;
