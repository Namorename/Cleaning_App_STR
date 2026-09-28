-- Which events become a push, and for whom. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected (docs/f11-plan.md, «М3 — проект перед кодом»):
-- - the generator moves and cancels cleanings silently; every such change that
--   touches a cleaning she can see reaches the person holding it;
-- - nobody is told about her own action, nobody hears about a cleaning outside
--   the week she can see, and nobody without a phone gets a queue row at all —
--   so until the first phone registers, the triggers write nothing;
-- - a conversation reaches only people who may still read it, never the office;
-- - quiet hours hold what can wait until morning, and nothing else.
--
-- The rows hold kinds, ids and parameters — never text: the language is chosen
-- at the moment of sending.
--
-- Fixture ids live in the a8f130xx range. The listings are in UTC, so "today"
-- in the listing is today in the test.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('a8f13000-0000-4000-8000-00000000000a', 'Host Events'),
  ('a8f13000-0000-4000-8000-00000000000b', 'Host Elsewhere');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('a8f13001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.ev@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('a8f13002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.ev@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a8f13003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bara.ev@test.local','x',now(),now(),
   '{"full_name":"Bara"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a8f13004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tomas.ev@test.local','x',now(),now(),
   '{"full_name":"Tomas"}'::jsonb, '{"role":"tech"}'::jsonb),
  -- Has no phone registered: must never get a queue row.
  ('a8f13005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','nophone.ev@test.local','x',now(),now(),
   '{"full_name":"No Phone"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  -- Dismissed, phone still registered.
  ('a8f13006-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gone.ev@test.local','x',now(),now(),
   '{"full_name":"Gone"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  -- Another company, linked to nothing of ours.
  ('a8f13007-0000-4000-8000-000000000007','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','dana.ev@test.local','x',now(),now(),
   '{"full_name":"Dana"}'::jsonb, '{"role":"cleaner"}'::jsonb);

update public.profiles set host_id = 'a8f13000-0000-4000-8000-00000000000a'
where id::text like 'a8f1300_-0000-4000-8000-00000000000_'
  and id <> 'a8f13007-0000-4000-8000-000000000007';
update public.profiles set host_id = 'a8f13000-0000-4000-8000-00000000000b'
where id = 'a8f13007-0000-4000-8000-000000000007';

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900013001, 'a8f13000-0000-4000-8000-00000000000a', 'Flat A', 'UTC', '15:00', '10:00'),
  (900013002, 'a8f13000-0000-4000-8000-00000000000a', 'Flat B', 'UTC', '15:00', '10:00');

-- Anna and Bara may take free work on Flat A; the phoneless one too. Nobody on B.
insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('a8f13000-0000-4000-8000-00000000000a', 900013001, 'a8f13002-0000-4000-8000-000000000002', 'claim'),
  ('a8f13000-0000-4000-8000-00000000000a', 900013001, 'a8f13003-0000-4000-8000-000000000003', 'claim'),
  ('a8f13000-0000-4000-8000-00000000000a', 900013001, 'a8f13005-0000-4000-8000-000000000005', 'claim'),
  ('a8f13000-0000-4000-8000-00000000000a', 900013001, 'a8f13006-0000-4000-8000-000000000006', 'claim');

-- Phones. Written as postgres: the registration RPC is tested elsewhere.
insert into public.push_tokens (token, profile_id, host_id, platform) values
  ('ExponentPushToken[ev-anna]',  'a8f13002-0000-4000-8000-000000000002', 'a8f13000-0000-4000-8000-00000000000a', 'ios'),
  ('ExponentPushToken[ev-bara]',  'a8f13003-0000-4000-8000-000000000003', 'a8f13000-0000-4000-8000-00000000000a', 'android'),
  ('ExponentPushToken[ev-tomas]', 'a8f13004-0000-4000-8000-000000000004', 'a8f13000-0000-4000-8000-00000000000a', 'ios'),
  ('ExponentPushToken[ev-gone]',  'a8f13006-0000-4000-8000-000000000006', 'a8f13000-0000-4000-8000-00000000000a', 'ios'),
  ('ExponentPushToken[ev-dana]',  'a8f13007-0000-4000-8000-000000000007', 'a8f13000-0000-4000-8000-00000000000b', 'ios'),
  ('ExponentPushToken[ev-boss]',  'a8f13001-0000-4000-8000-000000000001', 'a8f13000-0000-4000-8000-00000000000a', 'ios');

update public.profiles set is_active = false where id = 'a8f13006-0000-4000-8000-000000000006';

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
create or replace function pg_temp.as_boss() returns void language sql as $fn$
  select pg_temp.as_user('a8f13001-0000-4000-8000-000000000001') $fn$;
create or replace function pg_temp.as_anna() returns void language sql as $fn$
  select pg_temp.as_user('a8f13002-0000-4000-8000-000000000002') $fn$;
create or replace function pg_temp.as_bara() returns void language sql as $fn$
  select pg_temp.as_user('a8f13003-0000-4000-8000-000000000003') $fn$;

create or replace function pg_temp.anna()  returns uuid language sql as $fn$ select 'a8f13002-0000-4000-8000-000000000002'::uuid $fn$;
create or replace function pg_temp.bara()  returns uuid language sql as $fn$ select 'a8f13003-0000-4000-8000-000000000003'::uuid $fn$;
create or replace function pg_temp.tomas() returns uuid language sql as $fn$ select 'a8f13004-0000-4000-8000-000000000004'::uuid $fn$;

create or replace function pg_temp.tid(n int) returns uuid language sql as $fn$
  select ('a8f13101-0000-4000-8000-' || lpad(to_hex(n), 12, '0'))::uuid $fn$;

-- What the queue holds, as "recipient-name kind" in order of writing. Read as
-- postgres: the queue lives in raw, closed to every client.
create or replace function pg_temp.queued() returns text[] language sql as $fn$
  select coalesce(array_agg(
           coalesce((select pr.full_name from public.profiles pr where pr.id = o.recipient_id), '?')
           || ' ' || o.kind::text
           order by o.id), '{}')
  from raw.push_outbox o
$fn$;
create or replace function pg_temp.last_row() returns raw.push_outbox language sql as $fn$
  select o.* from raw.push_outbox o order by o.id desc limit 1 $fn$;
create or replace function pg_temp.clear() returns void language sql as $fn$
  delete from raw.push_outbox $fn$;

-- ---------- the queue is closed ----------
select pg_temp.check('the queue lives in raw, out of every client''s reach',
  (select has_schema_privilege('authenticated', 'raw', 'USAGE')
          or has_table_privilege('authenticated', 'raw.push_outbox', 'SELECT')), false);

-- ---------- new cleanings ----------
--
-- Written as postgres with no JWT, as the generator is (auth.uid() is null).
-- A row the generator writes is a NEW cleaning; a row the office writes with a
-- name on it is an ASSIGNMENT (see the repair below): for her, the office
-- handed her a job.
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id) values
  (pg_temp.tid(1), 'a8f13000-0000-4000-8000-00000000000a', 900013002, 'cleaning', 'assigned', current_date,      pg_temp.anna()),
  (pg_temp.tid(2), 'a8f13000-0000-4000-8000-00000000000a', 900013002, 'cleaning', 'assigned', current_date + 30, pg_temp.anna()),
  (pg_temp.tid(3), 'a8f13000-0000-4000-8000-00000000000a', 900013002, 'cleaning', 'assigned', current_date + 3,
   'a8f13005-0000-4000-8000-000000000005'),
  (pg_temp.tid(4), 'a8f13000-0000-4000-8000-00000000000a', 900013002, 'cleaning', 'assigned', current_date + 2,
   'a8f13006-0000-4000-8000-000000000006');

select pg_temp.check('one statement, four new cleanings: only the one she can see and has a phone for',
  pg_temp.queued(), array['Anna cleaning_new']);
select pg_temp.check('today''s is urgent',
  (pg_temp.last_row()).urgent, true);
select pg_temp.check('the row says which cleaning, and carries ids and dates, not text',
  (select array[o.task_id::text, o.collapse_key, o.params ->> 'date']
   from raw.push_outbox o order by o.id desc limit 1),
  array[pg_temp.tid(1)::text, 'task:' || pg_temp.tid(1), current_date::text]);
select pg_temp.check('an urgent one waits a minute for the change to settle',
  (select o.send_after = now() + interval '60 seconds' from raw.push_outbox o order by o.id desc limit 1),
  true);
select pg_temp.check('and lapses half an hour after it was due',
  (select o.expire_at = o.send_after + interval '30 minutes' from raw.push_outbox o order by o.id desc limit 1),
  true);
select pg_temp.clear();

-- ---------- free work ----------
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date) values
  (pg_temp.tid(5), 'a8f13000-0000-4000-8000-00000000000a', 900013001, 'cleaning', 'unassigned', current_date + 1),
  (pg_temp.tid(6), 'a8f13000-0000-4000-8000-00000000000a', 900013002, 'cleaning', 'unassigned', current_date + 1);
select pg_temp.check('free work reaches those who may take it and have a phone, nobody else',
  pg_temp.queued(), array['Anna cleaning_free', 'Bara cleaning_free']);
select pg_temp.clear();

-- Anna takes it. It is her own doing: she is not told, and it is no longer
-- free for Bara to hear about.
select pg_temp.as_anna();
update public.tasks set assignee_id = pg_temp.anna(), status = 'accepted'
where id = pg_temp.tid(5) and status = 'unassigned';
reset role; reset request.jwt.claims;
select pg_temp.check('taking free work tells nobody', pg_temp.queued(), '{}'::text[]);

-- ---------- the office hands it over, moves it, changes its hours ----------
select pg_temp.as_boss();
select public.save_task(
  p_id => pg_temp.tid(5), p_property_id => 900013001, p_type => 'cleaning',
  p_scheduled_date => current_date + 1, p_assignee_id => pg_temp.bara());
reset role; reset request.jwt.claims;
select pg_temp.check('handed to Bara: she is told, and Anna hears it was taken off her',
  pg_temp.queued(), array['Anna cleaning_unassigned', 'Bara cleaning_assigned']);
select pg_temp.clear();

select pg_temp.as_boss();
select public.save_task(
  p_id => pg_temp.tid(5), p_property_id => 900013001, p_type => 'cleaning',
  p_scheduled_date => current_date + 2, p_assignee_id => pg_temp.bara(),
  p_expected_date => current_date + 1);
reset role; reset request.jwt.claims;
select pg_temp.check('the office moves it: she is told',
  pg_temp.queued(), array['Bara cleaning_moved']);
select pg_temp.check('with where from, where to, and that it was the office',
  (select array[o.params ->> 'from_date', o.params ->> 'to_date', o.params ->> 'by']
   from raw.push_outbox o order by o.id desc limit 1),
  array[(current_date + 1)::text, (current_date + 2)::text, 'office']);
select pg_temp.check('a move from tomorrow is urgent', (pg_temp.last_row()).urgent, true);
select pg_temp.clear();

-- The booking moves it (the generator: no JWT).
update public.tasks set scheduled_date = current_date + 4 where id = pg_temp.tid(5);
select pg_temp.check('the booking moves it: she is told it was the booking',
  (select array[o.kind::text, o.params ->> 'by'] from raw.push_outbox o order by o.id desc limit 1),
  array['cleaning_moved', 'booking']);
select pg_temp.check('a move four days out is not urgent', (pg_temp.last_row()).urgent, false);
select pg_temp.clear();

-- Out of the week and back into it.
update public.tasks set scheduled_date = current_date + 30 where id = pg_temp.tid(5);
select pg_temp.check('moved out of her week: she is told it left', pg_temp.queued(), array['Bara cleaning_moved']);
select pg_temp.clear();
update public.tasks set scheduled_date = current_date + 31 where id = pg_temp.tid(5);
select pg_temp.check('moved about beyond her week: silence', pg_temp.queued(), '{}'::text[]);
update public.tasks set scheduled_date = current_date + 1 where id = pg_temp.tid(5);
select pg_temp.check('moved into her week: she is told', pg_temp.queued(), array['Bara cleaning_moved']);
select pg_temp.clear();

-- Hours. Tomorrow's matter; next week's do not.
update public.tasks set time_from = '11:00', time_to = '14:00' where id = pg_temp.tid(5);
select pg_temp.check('tomorrow''s hours change: she is told', pg_temp.queued(), array['Bara cleaning_window']);
select pg_temp.clear();
update public.tasks set scheduled_date = current_date + 5 where id = pg_temp.tid(5);
select pg_temp.clear();
update public.tasks set time_from = '12:00' where id = pg_temp.tid(5);
select pg_temp.check('hours five days out: silence', pg_temp.queued(), '{}'::text[]);

-- A change of nothing she acts on.
update public.tasks set notes = 'bring the ladder' where id = pg_temp.tid(5);
select pg_temp.check('a new note alone: silence', pg_temp.queued(), '{}'::text[]);

-- ---------- cancelled ----------
select pg_temp.as_boss();
update public.tasks set status = 'cancelled' where id = pg_temp.tid(5);
reset role; reset request.jwt.claims;
select pg_temp.check('the office cancels it: she is told', pg_temp.queued(), array['Bara cleaning_cancelled']);
select pg_temp.clear();

-- Work under way can be cancelled by the office too.
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id) values
  (pg_temp.tid(7), 'a8f13000-0000-4000-8000-00000000000a', 900013002, 'cleaning', 'in_progress', current_date, pg_temp.anna());
select pg_temp.clear();
select pg_temp.as_boss();
update public.tasks set status = 'cancelled' where id = pg_temp.tid(7);
reset role; reset request.jwt.claims;
select pg_temp.check('work under way cancelled by the office: she is told',
  pg_temp.queued(), array['Anna cleaning_cancelled']);
select pg_temp.clear();

-- The sweep closes what nobody did.
update public.tasks set status = 'expired' where id = pg_temp.tid(1);
select pg_temp.check('expiry by the sweep: silence', pg_temp.queued(), '{}'::text[]);

-- ---------- a booking cancelled while she is cleaning ----------
insert into public.reservations (id, host_id, property_id, arrival_date, departure_date, status) values
  (900013901, 'a8f13000-0000-4000-8000-00000000000a', 900013002, current_date - 3, current_date, 'new');
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id, reservation_id) values
  (pg_temp.tid(8), 'a8f13000-0000-4000-8000-00000000000a', 900013002, 'cleaning', 'in_progress', current_date,
   pg_temp.anna(), 900013901);
select pg_temp.clear();

-- The sync writes every column of every booking every night; only a change of
-- status may speak.
update public.reservations set guests_count = 2 where id = 900013901;
update public.reservations set status = 'new' where id = 900013901;
select pg_temp.check('a sync that changes nothing that matters: silence', pg_temp.queued(), '{}'::text[]);
update public.reservations set status = 'cancelled' where id = 900013901;
select pg_temp.check('the booking is cancelled while she cleans: she is told, urgently',
  (select array[o.kind::text, o.urgent::text, o.recipient_id::text] from raw.push_outbox o),
  array['booking_cancelled_live', 'true', pg_temp.anna()::text]);
select pg_temp.clear();

-- ---------- conversations ----------
--
-- Anna's cleaning today; Bara (linked to the listing) wrote in its thread once.
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id) values
  (pg_temp.tid(9), 'a8f13000-0000-4000-8000-00000000000a', 900013001, 'cleaning', 'assigned', current_date, pg_temp.anna());
select pg_temp.clear();

select pg_temp.as_bara();
select public.send_message('a8f13201-0000-4000-8000-000000000001', 'Keys are under the mat', pg_temp.tid(9));
reset role; reset request.jwt.claims;
select pg_temp.check('a colleague writes: the cleaner of the flat is told, the office is not',
  pg_temp.queued(), array['Anna chat_message']);
select pg_temp.clear();

select pg_temp.as_boss();
select public.send_message('a8f13201-0000-4000-8000-000000000002', 'Guests leave early', pg_temp.tid(9));
reset role; reset request.jwt.claims;
select pg_temp.check('the office writes: the cleaner and whoever wrote before are told',
  pg_temp.queued(), array['Anna chat_message', 'Bara chat_message']);
select pg_temp.check('the row names the thread', (pg_temp.last_row()).collapse_key like 'thread:%', true);
select pg_temp.clear();

-- Bara loses the listing: she no longer reads the thread, so she is not told.
delete from public.property_cleaners where cleaner_id = pg_temp.bara();
select pg_temp.as_boss();
select public.send_message('a8f13201-0000-4000-8000-000000000003', 'Towels in the hall', pg_temp.tid(9));
reset role; reset request.jwt.claims;
select pg_temp.check('someone who wrote once but may no longer read is not told',
  pg_temp.queued(), array['Anna chat_message']);
select pg_temp.clear();

-- A report and its repair.
insert into public.problems (id, host_id, property_id, reported_by, title) values
  ('a8f13301-0000-4000-8000-000000000001', 'a8f13000-0000-4000-8000-00000000000a',
   900013001, pg_temp.anna(), 'Tap leaks');
select pg_temp.as_boss();
select public.assign_problem('a8f13301-0000-4000-8000-000000000001', pg_temp.tomas(), current_date);
reset role; reset request.jwt.claims;
select pg_temp.check('a repair handed out: the technician is told',
  pg_temp.queued(), array['Tomas cleaning_assigned']);
select pg_temp.clear();

select pg_temp.as_boss();
select public.send_message('a8f13201-0000-4000-8000-000000000004', 'Parts arrive at 10',
                           null, 'a8f13301-0000-4000-8000-000000000001');
reset role; reset request.jwt.claims;
select pg_temp.check('the office writes about a report: the reporter and the technician are told',
  pg_temp.queued(), array['Anna chat_message', 'Tomas chat_message']);
select pg_temp.clear();

-- ---------- quiet hours ----------
--
-- 21:00 to 07:00 in Prague. The clock inside a test stands still, so the
-- function takes the moment as an argument.
select pg_temp.check('urgent goes a minute after, even at night',
  public.push_send_after(true, '2026-10-01 23:30 Europe/Prague'),
  '2026-10-01 23:31 Europe/Prague'::timestamptz);
select pg_temp.check('in the day, anything goes a minute after',
  public.push_send_after(false, '2026-10-01 12:00 Europe/Prague'),
  '2026-10-01 12:01 Europe/Prague'::timestamptz);
select pg_temp.check('late evening waits for seven next morning',
  public.push_send_after(false, '2026-10-01 22:15 Europe/Prague'),
  '2026-10-02 07:00 Europe/Prague'::timestamptz);
select pg_temp.check('the small hours wait for seven the same morning',
  public.push_send_after(false, '2026-10-02 05:20 Europe/Prague'),
  '2026-10-02 07:00 Europe/Prague'::timestamptz);
select pg_temp.check('across the change to winter time it is still seven in Prague',
  public.push_send_after(false, '2026-10-24 22:00 Europe/Prague'),
  '2026-10-25 07:00 Europe/Prague'::timestamptz);

-- ---------- the morning summary ----------
select pg_temp.clear();
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id) values
  (pg_temp.tid(10), 'a8f13000-0000-4000-8000-00000000000a', 900013002, 'cleaning', 'accepted', current_date + 7, pg_temp.bara());
select pg_temp.clear();

select public.enqueue_daily_digest(((current_date + time '07:10') at time zone 'Europe/Prague'));
-- Tomas has today's repair. The office, the phoneless, the dismissed and the
-- other company get nothing.
select pg_temp.check('at seven: one summary for each person with work today or new this week',
  pg_temp.queued(), array['Anna daily_digest', 'Bara daily_digest', 'Tomas daily_digest']);
select pg_temp.check('Anna''s says what is hers today',
  (select o.params ->> 'today' from raw.push_outbox o where o.recipient_id = pg_temp.anna()), '1');
select pg_temp.check('Bara''s says what came into her week',
  (select array[o.params ->> 'today', o.params ->> 'new_in_week'] from raw.push_outbox o
   where o.recipient_id = pg_temp.bara()),
  array['0', '1']);
select public.enqueue_daily_digest(((current_date + time '07:40') at time zone 'Europe/Prague'));
select pg_temp.check('asked again the same morning: still one each', cardinality(pg_temp.queued()), 3);
select pg_temp.clear();
select public.enqueue_daily_digest(((current_date + time '09:10') at time zone 'Europe/Prague'));
select pg_temp.check('outside seven o''clock: nothing', pg_temp.queued(), '{}'::text[]);

select pg_temp.check('no client may queue a summary',
  has_function_privilege('authenticated', 'public.enqueue_daily_digest(timestamptz)', 'EXECUTE'), false);

rollback;
