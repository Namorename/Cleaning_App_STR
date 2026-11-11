-- The guest's message of a chat task, read from Hostaway on the fly (20261111140000, the owner's word
-- of 2026-11-11). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - the link of a task: a card made into a task keeps its booking, its days, its ids in the PMS, the
--   conversation's key and number and the conversation's line in the queue until the night the
--   guest's name goes (91 days after the departure) — through the decision and every nightly job —
--   and loses all of them that night; reviews too;
-- - what has no task is cut as before: a card decided without a task, a task made before this
--   migration (no date), a stay already cut when the task was made (nothing comes back), a task
--   undone as a false positive;
-- - who may read: guest_message_target answers the office and the head technician by task, the
--   office alone by a card of «Гости»; a technician, a maid, a deactivated head technician, another
--   company never; a review, a report of the staff and a malformed ask find nothing;
-- - the terms: no conversation's number, its end passed, or neither the message's id nor its key —
--   «expired»;
-- - nothing of a text: the answer is ids only, the reader is read-only, the only write is a count
--   (60 in ten minutes a person), and no client role reaches either.
--
-- Every value below is synthetic. Fixture ids live in the 900112xxx range and the fc12… uuids.
begin;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

create function pg_temp.as_user(sub uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;

create function pg_temp.host() returns uuid language sql immutable as $$ select 'fc120000-0000-4000-8000-00000000000a'::uuid $$;
create function pg_temp.boss() returns uuid language sql immutable as $$ select 'fc120001-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.admin() returns uuid language sql immutable as $$ select 'fc120002-0000-4000-8000-000000000002'::uuid $$;
create function pg_temp.head() returns uuid language sql immutable as $$ select 'fc120003-0000-4000-8000-000000000003'::uuid $$;
create function pg_temp.gone() returns uuid language sql immutable as $$ select 'fc120004-0000-4000-8000-000000000004'::uuid $$;
create function pg_temp.tech() returns uuid language sql immutable as $$ select 'fc120005-0000-4000-8000-000000000005'::uuid $$;
create function pg_temp.maid() returns uuid language sql immutable as $$ select 'fc120006-0000-4000-8000-000000000006'::uuid $$;
create function pg_temp.rival() returns uuid language sql immutable as $$ select 'fc120007-0000-4000-8000-000000000007'::uuid $$;
create function pg_temp.gid(n integer) returns uuid language sql immutable as $$
  select ('fc120020-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.fid(n integer) returns uuid language sql immutable as $$
  select ('fc120030-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

-- The manager decides a card as the panel does: approve_signal_finding, signed in. The ids are made
-- before the switch: a function of pg_temp is not the client's to call.
create function pg_temp.approve(n integer, p_link uuid default null) returns public.signal_findings
language plpgsql as $$
declare
  v_id   uuid := pg_temp.fid(n);
  v_boss uuid := pg_temp.boss();
  v public.signal_findings;
begin
  perform set_config('role', 'authenticated', true),
          set_config('request.jwt.claims', '{"sub":"' || v_boss || '","role":"authenticated"}', true);
  v := public.approve_signal_finding(v_id, 'Synthetic title ' || n, p_link_problem_id => p_link);
  perform set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
  return v;
end $$;

create function pg_temp.task_of(n integer) returns uuid language sql as $$
  select problem_id from public.signal_findings where id = pg_temp.fid(n)
$$;

-- Every nightly job of the guests' data, as cron runs them (05:00, 05:05, 05:20, 05:55 UTC).
create function pg_temp.night() returns void language plpgsql as $$
begin
  perform public.purge_signal_stays();
  perform public.purge_signal_data();
  perform public.purge_guest_message_links();
  perform raw.purge_guest_data();
end $$;

-- ===========================================================================
-- Fixtures: a company with every role, another company, two bookings, five signals and their cards
-- ===========================================================================

insert into public.hosts (id, name) values
  (pg_temp.host(), 'Message co'),
  ('fc120000-0000-4000-8000-00000000000b', 'Rival co');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), jsonb_build_object('full_name', u.name), jsonb_build_object('role', u.role)
from (values
  (pg_temp.boss(),  'boss.gm@test.local',  'Boss',  'manager'),
  (pg_temp.admin(), 'admin.gm@test.local', 'Admin', 'admin'),
  (pg_temp.head(),  'head.gm@test.local',  'Head',  'head_tech'),
  (pg_temp.gone(),  'gone.gm@test.local',  'Gone',  'head_tech'),
  (pg_temp.tech(),  'tech.gm@test.local',  'Tech',  'tech'),
  (pg_temp.maid(),  'maid.gm@test.local',  'Maid',  'cleaner'),
  (pg_temp.rival(), 'rival.gm@test.local', 'Rival', 'manager')) as u (id, email, name, role);

update public.profiles set host_id = pg_temp.host()
where id in (pg_temp.boss(), pg_temp.admin(), pg_temp.head(), pg_temp.gone(), pg_temp.tech(), pg_temp.maid());
update public.profiles set host_id = 'fc120000-0000-4000-8000-00000000000b' where id = pg_temp.rival();
update public.profiles set is_active = false where id = pg_temp.gone();

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900112001, pg_temp.host(), 'Message flat', 'UTC', '15:00', '10:00'),
  (900112002, pg_temp.host(), 'Message loft', 'UTC', '15:00', '10:00');

insert into public.signal_settings (host_id, kind, tasks_enabled) values
  (pg_temp.host(), 'message', true),
  (pg_temp.host(), 'review', true);

-- A stay going on now (its name lives), and one that ended six days ago.
insert into public.reservations (id, host_id, property_id, arrival_date, departure_date, status, guest_name, is_block)
values (900112011, pg_temp.host(), 900112001, current_date - 3, current_date + 2, 'new', 'Synthetic Guest', false),
       (900112012, pg_temp.host(), 900112002, current_date - 9, current_date - 6, 'new', 'Synthetic Guest Two', false);

-- 1 a chat message with a card, exact and linked; 2 another message of the same stay whose card will
--   join task 1; 3 a review with a card; 4 a message already cut to its month, its card still
--   waiting; 5 a message whose task was made before this migration.
insert into public.guest_signals (id, host_id, provider, kind, external_key, conversation_key, external_id,
                                  external_listing_id, property_id, external_reservation_id, reservation_id,
                                  channel, rating, arrival_date, departure_date, submitted_at, stay_exact,
                                  stay_phase)
values
  (pg_temp.gid(1), pg_temp.host(), 'hostaway', 'message', repeat('b1', 32), repeat('c1', 32), '880001',
   '900112001', 900112001, '900112011', 900112011, 'airbnb', null,
   current_date - 3, current_date + 2, now() - interval '1 day', true, 'stay'),
  (pg_temp.gid(2), pg_temp.host(), 'hostaway', 'message', repeat('b2', 32), repeat('c1', 32), '880002',
   '900112001', 900112001, '900112011', 900112011, 'airbnb', null,
   current_date - 3, current_date + 2, now() - interval '20 hours', true, 'stay'),
  (pg_temp.gid(3), pg_temp.host(), 'hostaway', 'review', repeat('b3', 32), null, '880003',
   '900112002', 900112002, '900112012', 900112012, 'booking', 6,
   current_date - 9, current_date - 6, now() - interval '2 days', true, null),
  (pg_temp.gid(4), pg_temp.host(), 'hostaway', 'message', repeat('b4', 32), repeat('c4', 32), null,
   '900112002', 900112002, null, null, 'direct', null,
   date_trunc('month', current_date)::date, date_trunc('month', current_date)::date,
   public.signal_month_of(now()), false, 'stay'),
  (pg_temp.gid(5), pg_temp.host(), 'hostaway', 'message', repeat('b5', 32), repeat('c5', 32), '880005',
   '900112002', 900112002, '900112012', 900112012, 'booking', null,
   current_date - 9, current_date - 6, now() - interval '7 days', true, 'stay');

insert into public.signal_findings (id, host_id, signal_id, property_id, kind, subject, summary, summary_i18n,
                                    detector, evidence_source, external_conversation_id, conversation_link_ends)
values
  (pg_temp.fid(1), pg_temp.host(), pg_temp.gid(1), 900112001, 'repair', 'hot_water', 'hot_water', '{}',
   'claude-haiku-5-5@themes-v1-msg', 'message', '7101', current_date + 88),
  (pg_temp.fid(2), pg_temp.host(), pg_temp.gid(2), 900112001, 'repair', 'hot_water', 'hot_water', '{}',
   'claude-haiku-5-5@themes-v1-msg', 'message', '7101', current_date + 89),
  (pg_temp.fid(3), pg_temp.host(), pg_temp.gid(3), 900112002, 'repair', 'plumbing_leak', 'plumbing_leak', '{}',
   'rules-v1', 'public', null, null),
  (pg_temp.fid(4), pg_temp.host(), pg_temp.gid(4), 900112002, 'repair', 'electric', 'electric', '{}',
   'claude-haiku-5-5@themes-v1-msg', 'message', '7104', current_date + 60);

-- The conversation's line in the queue of chats.
insert into raw.signal_message_queue (host_id, provider, external_conversation_id, external_listing_id,
                                      state, via, last_event_at, read_to, updated_at)
values (pg_temp.host(), 'hostaway', '7101', '900112001', 'idle', 'webhook',
        now() - interval '1 day', now() - interval '1 day', now() - interval '1 day');

-- A report of the staff, for the reader's «not found».
insert into public.problems (id, host_id, property_id, reported_by, title, status)
values ('fc120040-0000-4000-8000-000000000001', pg_temp.host(), 900112001, pg_temp.maid(), 'Synthetic report', 'open');

-- ===========================================================================
-- 1. A task keeps its link through the decision
-- ===========================================================================

select pg_temp.check('1.1 the manager makes a task of the chat card',
  (pg_temp.approve(1)).status::text, 'task_created');

select pg_temp.check('1.2 its link ends the night the name goes: the booking''s departure + 91',
  (select task_link_ends from public.signal_findings where id = pg_temp.fid(1)), current_date + 2 + 91);

select pg_temp.check('1.3 the conversation''s number lives as long',
  (select external_conversation_id || '/' || (conversation_link_ends - current_date)
   from public.signal_findings where id = pg_temp.fid(1)), '7101/93');

select pg_temp.check('1.4 the decision did not cut the message: booking, days, id, time stay',
  (select stay_exact and reservation_id = 900112011 and external_reservation_id = '900112011'
          and external_id = '880001' and departure_date = current_date + 2
          and submitted_at > now() - interval '25 hours'
   from public.guest_signals where id = pg_temp.gid(1)), true);

-- Each decision in a statement of its own: a check in the same statement would read the rows as they
-- were when the statement began.
select pg_temp.approve(2, pg_temp.task_of(1));
select pg_temp.check('1.5 the second card joins the task: no task of its own, cut as before',
  (select status::text || '/' || coalesce(task_link_ends::text, '-')
   from public.signal_findings where id = pg_temp.fid(2))
  || '/' || (select (not stay_exact and reservation_id is null and external_id is null)::text
             from public.guest_signals where id = pg_temp.gid(2)),
  'duplicate/-/true');

select pg_temp.approve(3);
select pg_temp.check('1.6 a review''s task keeps its booking too',
  (select status::text || '/' || (task_link_ends = current_date - 6 + 91)::text
   from public.signal_findings where id = pg_temp.fid(3))
  || '/' || (select (stay_exact and reservation_id = 900112012)::text from public.guest_signals where id = pg_temp.gid(3)),
  'task_created/true/true');

select pg_temp.approve(4);
select pg_temp.check('1.7 a stay already cut gets no link and nothing back',
  (select status::text || '/' || coalesce(task_link_ends::text, '-')
   from public.signal_findings where id = pg_temp.fid(4))
  || '/' || (select (not stay_exact and reservation_id is null)::text from public.guest_signals where id = pg_temp.gid(4)),
  'task_created/-/true');

-- A task made before 20261111140000: the card is a task, with no date.
insert into public.problems (id, host_id, property_id, reported_by, title, status, source, source_facts)
values ('fc120040-0000-4000-8000-000000000005', pg_temp.host(), 900112002, null, 'Synthetic old task', 'open',
        'message', '{"kind": "repair", "subject": "hot_water", "mode": "manager"}');
insert into public.signal_findings (id, host_id, signal_id, property_id, kind, subject, summary, summary_i18n,
                                    detector, evidence_source, status, decided_mode, problem_id, decided_at,
                                    external_conversation_id, conversation_link_ends)
values (pg_temp.fid(5), pg_temp.host(), pg_temp.gid(5), 900112002, 'repair', 'hot_water', 'hot_water', '{}',
        'claude-haiku-5-5@themes-v1-msg', 'message', 'task_created', 'manager',
        'fc120040-0000-4000-8000-000000000005', now() - interval '6 days', '7105', current_date + 20);
update public.signal_findings set task_link_ends = null where id = pg_temp.fid(5);

-- ===========================================================================
-- 2. Every night until the link ends: the task's link stays, the rest goes as before
-- ===========================================================================

-- Past every old term: the message 120 days old, decided 60 days ago, the queue's line quiet for
-- 100 days; the joined card decided 40 days ago. The task's link (current_date + 93) is ahead.
update public.guest_signals set submitted_at = now() - interval '120 days' where id = pg_temp.gid(1);
update public.signal_findings set decided_at = now() - interval '60 days' where id = pg_temp.fid(1);
update public.signal_findings set decided_at = now() - interval '40 days' where id = pg_temp.fid(2);
update raw.signal_message_queue set updated_at = now() - interval '100 days'
where host_id = pg_temp.host() and external_conversation_id = '7101';

select pg_temp.night();

select pg_temp.check('2.1 the night keeps the task''s message whole: booking, days, id, key, conversation''s key',
  (select stay_exact and reservation_id = 900112011 and external_id = '880001'
          and external_key = repeat('b1', 32) and conversation_key = repeat('c1', 32)
   from public.guest_signals where id = pg_temp.gid(1)), true);

select pg_temp.check('2.2 the card keeps the conversation''s number past 30 days from the decision',
  (select external_conversation_id || '/' || (conversation_link_ends - current_date)
   from public.signal_findings where id = pg_temp.fid(1)), '7101/93');

select pg_temp.check('2.3 the conversation keeps its line in the queue',
  (select count(*) from raw.signal_message_queue where host_id = pg_temp.host() and external_conversation_id = '7101'),
  1::bigint);

select pg_temp.check('2.4 the old task (no date) is cut by the night, as before',
  (select (not stay_exact and reservation_id is null and external_id is null)::text
   from public.guest_signals where id = pg_temp.gid(5)), 'true');

select pg_temp.check('2.5 the card without a task forgets the conversation 30 days after its decision',
  (select external_conversation_id is null from public.signal_findings where id = pg_temp.fid(2)), true);

-- ===========================================================================
-- 3. The reader: who may read what
-- ===========================================================================

select pg_temp.check('3.1 the manager reads the chat task: ids only',
  public.guest_message_target(pg_temp.boss(), pg_temp.task_of(1)),
  jsonb_build_object('status', 'ok', 'provider', 'hostaway', 'conversation_id', '7101',
                     'message_id', '880001', 'message_key', repeat('b1', 32)));

select pg_temp.check('3.2 the admin reads it',
  public.guest_message_target(pg_temp.admin(), pg_temp.task_of(1)) ->> 'status', 'ok');

select pg_temp.check('3.3 the head technician reads it by the task',
  public.guest_message_target(pg_temp.head(), pg_temp.task_of(1)) ->> 'status', 'ok');

select pg_temp.check('3.4 the manager reads it by the card of «Гости»',
  public.guest_message_target(pg_temp.boss(), null, pg_temp.fid(1)) ->> 'conversation_id', '7101');

select pg_temp.check('3.5 the head technician may not read by a card of «Гости»',
  public.guest_message_target(pg_temp.head(), null, pg_temp.fid(1)) ->> 'status', 'forbidden');

select pg_temp.check('3.6 a technician, a maid and a deactivated head technician may not read',
  (select string_agg(public.guest_message_target(p, pg_temp.task_of(1)) ->> 'status', ',' order by o)
   from (values (1, pg_temp.tech()), (2, pg_temp.maid()), (3, pg_temp.gone())) as t (o, p)),
  'forbidden,forbidden,forbidden');

select pg_temp.check('3.7 a manager of another company finds nothing',
  public.guest_message_target(pg_temp.rival(), pg_temp.task_of(1)) ->> 'status', 'not_found');

select pg_temp.check('3.8 nobody is nobody',
  public.guest_message_target('fc12ffff-0000-4000-8000-000000000000', pg_temp.task_of(1)) ->> 'status', 'forbidden');

select pg_temp.check('3.9 a review''s task, a report of the staff, both ids or none: not found',
  (select string_agg(v ->> 'status', ',' order by o) from (values
     (1, public.guest_message_target(pg_temp.boss(), pg_temp.task_of(3))),
     (2, public.guest_message_target(pg_temp.boss(), 'fc120040-0000-4000-8000-000000000001')),
     (3, public.guest_message_target(pg_temp.boss(), pg_temp.task_of(1), pg_temp.fid(1))),
     (4, public.guest_message_target(pg_temp.boss()))) as t (o, v)),
  'not_found,not_found,not_found,not_found');

select pg_temp.check('3.10 a cut message is found by its key while its id is gone',
  public.guest_message_target(pg_temp.boss(), pg_temp.task_of(4)),
  jsonb_build_object('status', 'ok', 'provider', 'hostaway', 'conversation_id', '7104',
                     'message_id', null, 'message_key', repeat('b4', 32)));

-- ===========================================================================
-- 4. The terms: what is gone is «expired»
-- ===========================================================================

update public.signal_findings set conversation_link_ends = current_date where id = pg_temp.fid(4);
select pg_temp.check('4.1 the conversation''s end has come',
  public.guest_message_target(pg_temp.boss(), pg_temp.task_of(4)) ->> 'status', 'expired');

update public.signal_findings set conversation_link_ends = current_date + 20 where id = pg_temp.fid(4);
update public.guest_signals set external_key = 'purged:' || id::text where id = pg_temp.gid(4);
select pg_temp.check('4.2 neither the message''s id nor its key',
  public.guest_message_target(pg_temp.boss(), pg_temp.task_of(4)) ->> 'status', 'expired');

update public.signal_findings set external_conversation_id = null, conversation_link_ends = null
where id = pg_temp.fid(4);
select pg_temp.check('4.3 no conversation''s number',
  public.guest_message_target(pg_temp.boss(), null, pg_temp.fid(4)) ->> 'status', 'expired');

-- ===========================================================================
-- 5. The night the link ends: everything goes by its own job
-- ===========================================================================

-- A stay shortened after its task was made: its link was counted from the old departure (30 days
-- ahead), but the booking now left 95 days ago and its name goes tonight — the link goes with it.
insert into public.reservations (id, host_id, property_id, arrival_date, departure_date, status, guest_name, is_block)
values (900112013, pg_temp.host(), 900112002, current_date - 98, current_date - 95, 'new', 'Synthetic Guest Three', false);
insert into public.guest_signals (id, host_id, provider, kind, external_key, conversation_key, external_id,
                                  external_listing_id, property_id, external_reservation_id, reservation_id,
                                  channel, arrival_date, departure_date, submitted_at, stay_exact, stay_phase)
values (pg_temp.gid(6), pg_temp.host(), 'hostaway', 'message', repeat('b6', 32), repeat('c6', 32), '880006',
        '900112002', 900112002, '900112013', 900112013, 'booking', current_date - 98, current_date - 95,
        now() - interval '96 days', true, 'stay');
insert into public.signal_findings (id, host_id, signal_id, property_id, kind, subject, summary, summary_i18n,
                                    detector, evidence_source, status, decided_mode, decided_at)
values (pg_temp.fid(6), pg_temp.host(), pg_temp.gid(6), 900112002, 'repair', 'heating', 'heating', '{}',
        'claude-haiku-5-5@themes-v1-msg', 'message', 'task_created', 'manager', now() - interval '90 days');
update public.signal_findings set task_link_ends = current_date + 30 where id = pg_temp.fid(6);

update public.signal_findings set task_link_ends = current_date where id = pg_temp.fid(1);
select pg_temp.night();

select pg_temp.check('5.0 the cut erases the link''s date: kept, it would tell the departure''s day',
  (select task_link_ends is null from public.signal_findings where id = pg_temp.fid(1)), true);

select pg_temp.check('5.0b a stay shortened since its task: the link goes the night the name goes',
  (select (not stay_exact and reservation_id is null)::text from public.guest_signals where id = pg_temp.gid(6))
  || '/' || (select coalesce(task_link_ends::text, '-') from public.signal_findings where id = pg_temp.fid(6))
  || '/' || (select coalesce(guest_name, '-') from public.reservations where id = 900112013),
  'true/-/-');

select pg_temp.check('5.1 the message is cut; its id, its key and the conversation''s key are gone',
  (select not stay_exact and reservation_id is null and external_id is null
          and external_key like 'purged:%' and conversation_key is null
   from public.guest_signals where id = pg_temp.gid(1)), true);

select pg_temp.check('5.2 the card forgets the conversation''s number',
  (select external_conversation_id is null from public.signal_findings where id = pg_temp.fid(1)), true);

select pg_temp.check('5.3 the conversation leaves the queue',
  (select count(*) from raw.signal_message_queue where host_id = pg_temp.host() and external_conversation_id = '7101'),
  0::bigint);

select pg_temp.check('5.4 and the reader says «expired»',
  public.guest_message_target(pg_temp.head(), pg_temp.task_of(1)) ->> 'status', 'expired');

select pg_temp.check('5.5 the task itself stays',
  (select count(*) from public.problems where id = pg_temp.task_of(1)), 1::bigint);

-- ===========================================================================
-- 6. A task undone loses its link
-- ===========================================================================

do $$
declare
  v_task uuid := pg_temp.task_of(3);
  v_boss uuid := pg_temp.boss();
begin
  perform set_config('role', 'authenticated', true),
          set_config('request.jwt.claims', '{"sub":"' || v_boss || '","role":"authenticated"}', true);
  perform public.mark_signal_false_positive(v_task);
  perform set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
end $$;

select pg_temp.check('6.1 a false positive drops the date',
  (select status::text || '/' || coalesce(task_link_ends::text, '-')
   from public.signal_findings where id = pg_temp.fid(3)), 'rejected/-');

select public.purge_signal_stays();
select pg_temp.check('6.2 and the next night cuts its stay',
  (select (not stay_exact and reservation_id is null)::text from public.guest_signals where id = pg_temp.gid(3)),
  'true');

-- ===========================================================================
-- 7. The count of reads, and nothing of a text
-- ===========================================================================

do $$
declare
  v_allowed integer := 0;
  v_last boolean;
begin
  for i in 1..61 loop
    v_last := public.take_message_text_read(pg_temp.boss());
    if v_last then
      v_allowed := v_allowed + 1;
    end if;
  end loop;
  perform pg_temp.check('7.1 60 reads in ten minutes go through', v_allowed, 60);
  perform pg_temp.check('7.2 the 61st is refused', v_last, false);
end $$;

select pg_temp.check('7.3 the refused read is counted too',
  (select reads from raw.message_text_reads where user_id = pg_temp.boss()), 61);

select pg_temp.check('7.4 another person has a limit of their own',
  public.take_message_text_read(pg_temp.head()), true);

select pg_temp.check('7.5 the counts keep a person, a window and a number',
  (select array_agg(column_name::text order by ordinal_position)
   from information_schema.columns where table_schema = 'raw' and table_name = 'message_text_reads'),
  array['user_id', 'window_start', 'reads']);

update raw.message_text_reads set window_start = window_start - interval '2 days' where user_id = pg_temp.head();
select public.take_message_text_read(pg_temp.boss());
select pg_temp.check('7.6 a day-old window is gone',
  (select count(*) from raw.message_text_reads where user_id = pg_temp.head()), 0::bigint);

do $$
begin
  perform public.take_message_text_read(null);
  raise exception 'FAIL a read without a reader was counted';
exception when invalid_parameter_value then
  raise notice 'ok  7.7 a read without a reader is refused';
end $$;

select pg_temp.check('7.8 the reader cannot write: it is stable',
  (select provolatile from pg_proc where oid = 'public.guest_message_target(uuid, uuid, uuid)'::regprocedure),
  's'::"char");

select pg_temp.check('7.9 the reader''s answers name no text, name or booking',
  (select count(*) from (values
     (public.guest_message_target(pg_temp.boss(), pg_temp.task_of(1))),
     (public.guest_message_target(pg_temp.admin(), null, pg_temp.fid(2)))) as t (v),
   jsonb_object_keys(t.v) k
   where k not in ('status', 'provider', 'conversation_id', 'message_id', 'message_key')),
  0::bigint);

select pg_temp.check('7.10 no table of the chats gained a column for a message''s text',
  (select string_agg(table_name || '.' || column_name, ',' order by table_name, column_name)
   from information_schema.columns
   where table_schema in ('public', 'raw')
     and table_name in ('guest_signals', 'signal_findings', 'message_text_reads', 'signal_message_queue')
     and (column_name like '%text%' or column_name like '%body%' or column_name like '%message%')),
  'guest_signals.has_private_text,guest_signals.has_public_text,guest_signals.private_text,'
  'guest_signals.public_text,guest_signals.text_purge_after,guest_signals.text_truncated');

-- ===========================================================================
-- 8. Rights
-- ===========================================================================

select pg_temp.check('8.1 no client role reaches the reader or the counter',
  (select count(*) from (values ('public.guest_message_target(uuid, uuid, uuid)'),
                                ('public.take_message_text_read(uuid)')) as f (sig),
                        (values ('authenticated'), ('anon')) as r (role)
   where has_function_privilege(r.role, f.sig, 'execute')),
  0::bigint);

select pg_temp.check('8.2 the function''s service role calls both',
  has_function_privilege('service_role', 'public.guest_message_target(uuid, uuid, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.take_message_text_read(uuid)', 'execute'), true);

select pg_temp.check('8.3 the helper and the trigger are nobody''s to call',
  (select count(*) from (values ('public.signal_task_link_ends(uuid)'), ('public.signal_findings_task_link()')) as f (sig),
                        (values ('authenticated'), ('anon'), ('service_role')) as r (role)
   where has_function_privilege(r.role, f.sig, 'execute')),
  0::bigint);

select pg_temp.check('8.4 no client reads or writes the counts',
  has_table_privilege('authenticated', 'raw.message_text_reads', 'select')
  or has_table_privilege('authenticated', 'raw.message_text_reads', 'insert')
  or has_table_privilege('anon', 'raw.message_text_reads', 'select'), false);

select pg_temp.check('8.5 the jobs keep their rights',
  has_function_privilege('service_role', 'public.purge_signal_data()', 'execute')
  and has_function_privilege('service_role', 'public.purge_guest_message_links()', 'execute')
  and not has_function_privilege('authenticated', 'public.purge_signal_data()', 'execute')
  and not has_function_privilege('authenticated', 'public.purge_guest_message_links()', 'execute')
  and not has_function_privilege('service_role', 'public.cut_signal_stay_links(uuid[])', 'execute'), true);

rollback;
