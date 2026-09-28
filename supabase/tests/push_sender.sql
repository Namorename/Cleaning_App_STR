-- How the queue is handed to the sender and settled. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected (docs/f11-plan.md, «М3 — проект перед кодом» and §4 M3):
-- - a group — one person, one cleaning or thread — goes out only when its LAST
--   row is due: a new change to the same cleaning pushes the send back, so a
--   burst folds into one push;
-- - two runs of the sender never hand out the same row: a claimed group is
--   leased, and a send that failed lets it go for the next run;
-- - the choice is checked at the moment of sending, not at the moment of the
--   event: a kind she switched off since, a dismissal, a lost phone, a thread
--   she may no longer read, free work somebody has since taken — none of these
--   goes out, and each is settled with the reason;
-- - a group whose time ran out is settled as expired, never sent late;
-- - the sender gets everything it needs to write the text in her language —
--   the language, the phones, the place names — and nothing is text;
-- - a phone Expo calls unregistered is forgotten, unless it registered again
--   after the push that found it dead;
-- - history is kept a week, the cron's own log too.
--
-- Written as postgres: the queue lives in raw, and the sender calls these with
-- the secret key. Fixture ids live in the a8f140xx range. One transaction means
-- one now(): times are set relative to it by hand.
begin;

-- The hosted project grants EXECUTE on new functions to authenticated by
-- default; the migration has to take it away itself.
alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name, default_language) values
  ('a8f14000-0000-4000-8000-00000000000a', 'Host Sender', 'cs');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('a8f14001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.se@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('a8f14002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.se@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a8f14003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bara.se@test.local','x',now(),now(),
   '{"full_name":"Bara"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a8f14004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tomas.se@test.local','x',now(),now(),
   '{"full_name":"Tomas"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('a8f14005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gone.se@test.local','x',now(),now(),
   '{"full_name":"Gone"}'::jsonb, '{"role":"cleaner"}'::jsonb);

update public.profiles set host_id = 'a8f14000-0000-4000-8000-00000000000a'
where id::text like 'a8f1400_-0000-4000-8000-00000000000_';
-- Anna reads Russian by her own choice; Bara never chose, her phone is English;
-- Tomas chose nothing and his phone says nothing: the company's Czech.
update public.profiles set preferred_language = 'ru' where id = 'a8f14002-0000-4000-8000-000000000002';
update public.profiles set preferred_language = null
where id in ('a8f14003-0000-4000-8000-000000000003', 'a8f14004-0000-4000-8000-000000000004');

-- A house with a room in it, and a flat on its own.
insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900014001, 'a8f14000-0000-4000-8000-00000000000a', 'Vinohradska House', 'UTC', '15:00', '10:00'),
  (900014003, 'a8f14000-0000-4000-8000-00000000000a', 'Flat C', 'UTC', '15:00', '10:00');
insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time,
                               parent_id, hostaway_unit_id) values
  (1000000014002, 'a8f14000-0000-4000-8000-00000000000a', '1 - 2109', 'UTC', '15:00', '10:00',
   900014001, 14002);

insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('a8f14000-0000-4000-8000-00000000000a', 900014001, 'a8f14002-0000-4000-8000-000000000002', 'claim'),
  ('a8f14000-0000-4000-8000-00000000000a', 900014001, 'a8f14003-0000-4000-8000-000000000003', 'claim');

insert into public.push_tokens (token, profile_id, host_id, platform, language, updated_at) values
  ('ExponentPushToken[se-anna-1]', 'a8f14002-0000-4000-8000-000000000002', 'a8f14000-0000-4000-8000-00000000000a', 'ios', 'cs', now() - interval '2 days'),
  ('ExponentPushToken[se-anna-2]', 'a8f14002-0000-4000-8000-000000000002', 'a8f14000-0000-4000-8000-00000000000a', 'android', null, now() - interval '1 day'),
  ('ExponentPushToken[se-bara]',   'a8f14003-0000-4000-8000-000000000003', 'a8f14000-0000-4000-8000-00000000000a', 'android', 'en', now() - interval '1 day'),
  ('ExponentPushToken[se-tomas]',  'a8f14004-0000-4000-8000-000000000004', 'a8f14000-0000-4000-8000-00000000000a', 'ios', null, now() - interval '1 day'),
  ('ExponentPushToken[se-gone]',   'a8f14005-0000-4000-8000-000000000005', 'a8f14000-0000-4000-8000-00000000000a', 'ios', null, now() - interval '1 day');

update public.profiles set is_active = false where id = 'a8f14005-0000-4000-8000-000000000005';

-- Tomas switched moves off.
insert into public.push_preferences (profile_id, host_id, muted) values
  ('a8f14004-0000-4000-8000-000000000004', 'a8f14000-0000-4000-8000-00000000000a', '{cleaning_moved}');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

create or replace function pg_temp.anna()  returns uuid language sql as $fn$ select 'a8f14002-0000-4000-8000-000000000002'::uuid $fn$;
create or replace function pg_temp.bara()  returns uuid language sql as $fn$ select 'a8f14003-0000-4000-8000-000000000003'::uuid $fn$;
create or replace function pg_temp.tomas() returns uuid language sql as $fn$ select 'a8f14004-0000-4000-8000-000000000004'::uuid $fn$;
create or replace function pg_temp.gone()  returns uuid language sql as $fn$ select 'a8f14005-0000-4000-8000-000000000005'::uuid $fn$;
create or replace function pg_temp.tid(n int) returns uuid language sql as $fn$
  select ('a8f14101-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $fn$;

insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id) values
  (pg_temp.tid(1), 'a8f14000-0000-4000-8000-00000000000a', 1000000014002, 'cleaning', 'assigned', current_date + 1, pg_temp.anna()),
  (pg_temp.tid(2), 'a8f14000-0000-4000-8000-00000000000a', 900014003, 'cleaning', 'assigned', current_date + 2, pg_temp.anna()),
  (pg_temp.tid(3), 'a8f14000-0000-4000-8000-00000000000a', 900014003, 'maintenance', 'assigned', current_date + 1, pg_temp.tomas()),
  (pg_temp.tid(4), 'a8f14000-0000-4000-8000-00000000000a', 900014001, 'cleaning', 'unassigned', current_date + 3, null),
  (pg_temp.tid(5), 'a8f14000-0000-4000-8000-00000000000a', 900014001, 'cleaning', 'assigned', current_date + 3, pg_temp.bara());

-- The triggers of M3a write rows for these inserts; the test builds the queue
-- by hand, with times it controls.
delete from raw.push_outbox;

-- A queue row, due `p_due_in` from now (negative: already due).
create or replace function pg_temp.queue(
  p_recipient uuid, p_kind public.push_kind, p_task uuid, p_due_in interval,
  p_params jsonb default '{}', p_thread uuid default null
) returns bigint language sql as $fn$
  insert into raw.push_outbox (host_id, recipient_id, kind, task_id, thread_id, collapse_key,
                               params, urgent, send_after, expire_at)
  values ('a8f14000-0000-4000-8000-00000000000a', p_recipient, p_kind, p_task, p_thread,
          coalesce('thread:' || p_thread, 'task:' || p_task), p_params, true,
          now() + p_due_in, now() + p_due_in + interval '30 minutes')
  returning id
$fn$;

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

create or replace function pg_temp.outcome(p_id bigint) returns text language sql as $fn$
  select coalesce(o.outcome, 'pending') from raw.push_outbox o where o.id = p_id $fn$;

create or replace function pg_temp.receipts_due() returns text[] language sql as $fn$
  select array_agg(x order by x) from jsonb_array_elements_text(public.claim_push_receipts()) x $fn$;

-- ---------- only the sender may call these ----------
select pg_temp.check('no client may hand out, settle, read receipts or purge',
  (select coalesce(string_agg(f, ', ' order by f), '')
   from unnest(array['public.claim_push_batch(integer)',
                     'public.record_push_results(jsonb)',
                     'public.claim_push_receipts(integer)',
                     'public.record_push_receipts(jsonb)',
                     'public.purge_push_history()']) f
   where has_function_privilege('authenticated', f, 'EXECUTE')
      or has_function_privilege('anon', f, 'EXECUTE')
      or not has_function_privilege('service_role', f, 'EXECUTE')),
  '');
select pg_temp.check('the tickets live in raw, out of every client''s reach',
  has_table_privilege('authenticated', 'raw.push_tickets', 'SELECT'), false);

-- ---------- a group goes when its last row is due ----------
select pg_temp.queue(pg_temp.anna(), 'cleaning_assigned', pg_temp.tid(1), interval '-3 minutes');
-- The same cleaning changed again half a minute ago: the group waits for it.
select pg_temp.queue(pg_temp.anna(), 'cleaning_window', pg_temp.tid(1), interval '30 seconds',
                     '{"date": "2026-11-10", "time_from": "11:00:00", "time_to": "15:00:00"}');
-- Another of her cleanings, all due.
select pg_temp.queue(pg_temp.anna(), 'cleaning_assigned', pg_temp.tid(2), interval '-2 minutes');
select pg_temp.queue(pg_temp.anna(), 'cleaning_moved', pg_temp.tid(2), interval '-1 minute',
                     '{"from_property": 900014003, "to_property": 1000000014002,
                       "from_date": "2026-11-10", "to_date": "2026-11-11"}');

create temp table first_claim as select public.claim_push_batch() as batch;

select pg_temp.check('a group waits for its last row; a group all due goes, rows in the order written',
  pg_temp.handed((select batch from first_claim)),
  array['Anna task:' || pg_temp.tid(2) || ': cleaning_assigned, cleaning_moved']);

select pg_temp.check('the group says which language to write in: hers',
  (select batch -> 0 ->> 'language' from first_claim), 'ru');
select pg_temp.check('and every phone she has, the latest first',
  (select array_agg(t ->> 'token' order by ord)
   from first_claim, jsonb_array_elements(batch -> 0 -> 'tokens') with ordinality as x(t, ord)),
  array['ExponentPushToken[se-anna-2]', 'ExponentPushToken[se-anna-1]']);
select pg_temp.check('with each phone''s platform',
  (select array_agg(t ->> 'platform' order by ord)
   from first_claim, jsonb_array_elements(batch -> 0 -> 'tokens') with ordinality as x(t, ord)),
  array['android', 'ios']);
select pg_temp.check('and each place a row names, the room with its house',
  (select batch -> 0 -> 'places' from first_claim),
  jsonb_build_object(
    '1000000014002', jsonb_build_object('name', '1 - 2109', 'hostaway_unit_id', 14002,
                                    'parent', jsonb_build_object('name', 'Vinohradska House')),
    '900014003', jsonb_build_object('name', 'Flat C', 'hostaway_unit_id', null, 'parent', null)));
select pg_temp.check('the rows carry their parameters as written, never text',
  (select r -> 'params' ->> 'to_date'
   from first_claim, jsonb_array_elements(batch -> 0 -> 'rows') r
   where r ->> 'kind' = 'cleaning_moved'),
  '2026-11-11');

select pg_temp.check('each row says which flat it is about: the cleaning''s own',
  (select array_agg(distinct r ->> 'property_id')
   from first_claim, jsonb_array_elements(batch -> 0 -> 'rows') r),
  array['900014003']);

-- ---------- two runs never hand out the same row ----------
select pg_temp.check('a second run while the first holds the lease gets nothing of it',
  pg_temp.handed(public.claim_push_batch()), '{}'::text[]);

-- ---------- settling what was sent ----------
select public.record_push_results(jsonb_build_array(jsonb_build_object(
  'outbox_ids', (select jsonb_agg(r -> 'id') from first_claim, jsonb_array_elements(batch -> 0 -> 'rows') r),
  'recipient_id', pg_temp.anna(),
  'outcome', 'sent',
  'tickets', jsonb_build_array(
    jsonb_build_object('token', 'ExponentPushToken[se-anna-2]', 'status', 'ok', 'ticket_id', 'tk-anna-2'),
    jsonb_build_object('token', 'ExponentPushToken[se-anna-1]', 'status', 'error',
                       'error', 'DeviceNotRegistered', 'message', 'not a valid token')))));

select pg_temp.check('what went out is settled as sent',
  (select array_agg(distinct o.outcome) from raw.push_outbox o where o.task_id = pg_temp.tid(2)),
  array['sent']);
select pg_temp.check('each phone''s answer is kept as a ticket',
  (select array_agg(t.token || ' ' || t.status order by t.token) from raw.push_tickets t),
  array['ExponentPushToken[se-anna-1] error', 'ExponentPushToken[se-anna-2] ok']);
select pg_temp.check('a phone Expo calls unregistered is forgotten',
  (select array_agg(t.token order by t.token) from public.push_tokens t where t.profile_id = pg_temp.anna()),
  array['ExponentPushToken[se-anna-2]']);
select public.record_push_results(jsonb_build_array(jsonb_build_object(
  'outbox_ids', (select jsonb_agg(r -> 'id') from first_claim, jsonb_array_elements(batch -> 0 -> 'rows') r),
  'recipient_id', pg_temp.anna(), 'outcome', 'collapsed', 'tickets', '[]'::jsonb)));
select pg_temp.check('a settled row keeps its first outcome when the answer is repeated',
  (select array_agg(distinct o.outcome) from raw.push_outbox o where o.task_id = pg_temp.tid(2)),
  array['sent']);

-- ---------- a failed send lets the group go again ----------
select pg_temp.queue(pg_temp.bara(), 'cleaning_assigned', pg_temp.tid(5), interval '-1 minute');
create temp table bara_claim as select public.claim_push_batch() as batch;
select pg_temp.check('Bara''s group is handed out', pg_temp.handed((select batch from bara_claim)),
  array['Bara task:' || pg_temp.tid(5) || ': cleaning_assigned']);
select pg_temp.check('in her phone''s language, as she never chose one',
  (select batch -> 0 ->> 'language' from bara_claim), 'en');
select public.record_push_results(jsonb_build_array(jsonb_build_object(
  'outbox_ids', (select jsonb_agg(r -> 'id') from bara_claim, jsonb_array_elements(batch -> 0 -> 'rows') r),
  'recipient_id', pg_temp.bara(), 'outcome', 'failed', 'tickets', '[]'::jsonb)));
select pg_temp.check('Expo did not answer: the rows stay unsettled and are handed out again',
  pg_temp.handed(public.claim_push_batch()),
  array['Bara task:' || pg_temp.tid(5) || ': cleaning_assigned']);
select public.record_push_results(jsonb_build_array(jsonb_build_object(
  'outbox_ids', (select jsonb_agg(o.id) from raw.push_outbox o where o.recipient_id = pg_temp.bara()),
  'recipient_id', pg_temp.bara(), 'outcome', 'sent', 'tickets', '[]'::jsonb)));

-- ---------- checked at the moment of sending ----------
-- Tomas: a move he switched off, and a new repair he did not.
create temp table t_ids as select
  pg_temp.queue(pg_temp.tomas(), 'cleaning_moved', pg_temp.tid(3), interval '-2 minutes') as moved,
  pg_temp.queue(pg_temp.tomas(), 'cleaning_assigned', pg_temp.tid(3), interval '-1 minute') as assigned;
-- The dismissed cleaner, phone still registered.
create temp table g_ids as select
  pg_temp.queue(pg_temp.gone(), 'cleaning_assigned', pg_temp.tid(5), interval '-1 minute') as id;
-- Free work Bara has taken since: Anna is not told about it any more.
update public.tasks set status = 'accepted', assignee_id = pg_temp.bara() where id = pg_temp.tid(4);
delete from raw.push_outbox where task_id = pg_temp.tid(4);
create temp table f_ids as select
  pg_temp.queue(pg_temp.anna(), 'cleaning_free', pg_temp.tid(4), interval '-1 minute') as id;
-- A group whose time ran out.
create temp table e_ids as select
  pg_temp.queue(pg_temp.bara(), 'cleaning_cancelled', pg_temp.tid(5), interval '-40 minutes') as id;

create temp table later_claim as select public.claim_push_batch() as batch;

select pg_temp.check('Tomas gets the repair, not the move he switched off; nobody else gets anything',
  pg_temp.handed((select batch from later_claim)),
  array['Tomas task:' || pg_temp.tid(3) || ': cleaning_assigned']);
select pg_temp.check('in the company''s language, as neither he nor his phone chose one',
  (select batch -> 0 ->> 'language' from later_claim), 'cs');
select pg_temp.check('the switched-off move is settled as muted',
  pg_temp.outcome((select moved from t_ids)), 'muted');
select pg_temp.check('a dismissed person''s push is settled as skipped',
  pg_temp.outcome((select id from g_ids)), 'skipped');
select pg_temp.check('free work taken since is settled as skipped',
  pg_temp.outcome((select id from f_ids)), 'skipped');
select pg_temp.check('a group past its lifetime is settled as expired, never sent late',
  pg_temp.outcome((select id from e_ids)), 'expired');

-- ---------- a conversation she may no longer read ----------
insert into public.chat_threads (id, host_id, kind, task_id) values
  ('a8f14201-0000-4000-8000-000000000001', 'a8f14000-0000-4000-8000-00000000000a', 'task', pg_temp.tid(5));
-- Anna wrote in Bara's cleaning once; the listing link that let her read it is gone.
delete from public.property_cleaners where cleaner_id = pg_temp.anna();
create temp table c_ids as select
  pg_temp.queue(pg_temp.anna(), 'chat_message', pg_temp.tid(5), interval '-1 minute',
                '{"author_name": "Bara"}', 'a8f14201-0000-4000-8000-000000000001') as id;
select pg_temp.check('a thread she may no longer read is not handed out',
  pg_temp.handed(public.claim_push_batch()), '{}'::text[]);
select pg_temp.check('and is settled as skipped',
  pg_temp.outcome((select id from c_ids)), 'skipped');

-- ---------- receipts ----------
insert into raw.push_tickets (outbox_ids, recipient_id, token, status, ticket_id, created_at) values
  ('{1}', pg_temp.bara(),  'ExponentPushToken[se-bara]',  'ok', 'tk-old-bara',  now() - interval '20 minutes'),
  ('{1}', pg_temp.tomas(), 'ExponentPushToken[se-tomas]', 'ok', 'tk-old-tomas', now() - interval '20 minutes'),
  ('{1}', pg_temp.tomas(), 'ExponentPushToken[se-tomas]', 'ok', 'tk-fresh',     now() - interval '5 minutes');
-- Tomas's phone registered again after the old push: it is alive.
update public.push_tokens set updated_at = now() - interval '10 minutes' where token = 'ExponentPushToken[se-tomas]';

select pg_temp.check('receipts are asked for tickets older than a quarter of an hour',
  pg_temp.receipts_due(), array['tk-old-bara', 'tk-old-tomas']);
select public.record_push_receipts(jsonb_build_array(
  jsonb_build_object('ticket_id', 'tk-old-bara', 'status', 'error', 'error', 'DeviceNotRegistered'),
  jsonb_build_object('ticket_id', 'tk-old-tomas', 'status', 'error', 'error', 'DeviceNotRegistered')));
select pg_temp.check('a receipt saying the phone is gone forgets it',
  exists (select 1 from public.push_tokens where token = 'ExponentPushToken[se-bara]'), false);
select pg_temp.check('unless the phone registered again after that push',
  exists (select 1 from public.push_tokens where token = 'ExponentPushToken[se-tomas]'), true);
select pg_temp.check('a ticket with its receipt is not asked about again',
  pg_temp.receipts_due(), null::text[]);

-- ---------- history ----------
update raw.push_outbox set created_at = now() - interval '8 days', settled_at = now() - interval '8 days'
where task_id = pg_temp.tid(2);
update raw.push_tickets set created_at = now() - interval '8 days' where ticket_id = 'tk-anna-2';
insert into cron.job_run_details (jobid, runid, command, status, start_time, end_time)
values (0, -14001, 'select 1', 'succeeded', now() - interval '8 days', now() - interval '8 days'),
       (0, -14002, 'select 1', 'succeeded', now() - interval '1 day', now() - interval '1 day');
select public.purge_push_history();
select pg_temp.check('settled rows older than a week are gone',
  (select count(*)::int from raw.push_outbox where task_id = pg_temp.tid(2)), 0);
select pg_temp.check('unsettled rows stay whatever their age',
  (select count(*)::int from raw.push_outbox where task_id = pg_temp.tid(1)), 2);
select pg_temp.check('tickets older than a week are gone, younger ones stay',
  (select array_agg(ticket_id order by ticket_id) from raw.push_tickets where ticket_id in ('tk-anna-2', 'tk-fresh')),
  array['tk-fresh']);
select pg_temp.check('the cron''s own log keeps a week',
  (select array_agg(runid order by runid) from cron.job_run_details where runid in (-14001, -14002)),
  array[-14002::bigint]);

-- ---------- the schedule ----------
select pg_temp.check('the sender runs every minute, the summary hourly, the purge nightly',
  (select array_agg(j.jobname || ' ' || j.schedule order by j.jobname)
   from cron.job j where j.jobname in ('send-push', 'push-daily-digest', 'push-history-purge')),
  array['push-daily-digest 5 * * * *', 'push-history-purge 40 2 * * *', 'send-push * * * * *']);

rollback;
