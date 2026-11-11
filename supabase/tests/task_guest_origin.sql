-- Where a task from a guest came from (20261111120000, the owner's word of 2026-11-11).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - by role: whoever may read a task from a guest learns its source and its stay; the head technician
--   and the office also the guest's name, the channel, the rating and the day it was sent; the office
--   alone the PMS's numbers (booking, conversation) and the signal for the text button. A person who
--   may not read the task learns nothing, a report of the staff gives nothing;
-- - the name is read from the booking at the moment of the call and kept nowhere else: no row of the
--   task, its finding, its signal or its journal holds it, and the function cannot write;
-- - the empty states: a booking whose name retention cleared says so («erased»), a decided card whose
--   booking the cut took says so («cut»), a stay with no booking says so («none»); the cut stay shows
--   its months, the conversation's number only while the card keeps it;
-- - API v1: a task says its source and its stay, never a guest's name.
--
-- Every value below is synthetic. Fixture ids live in the 900111xxx range and the fb11… uuids.
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
create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true)
$$;

create function pg_temp.boss() returns uuid language sql immutable as $$ select 'fb110001-0000-4000-8000-000000000001'::uuid $$;
create function pg_temp.head() returns uuid language sql immutable as $$ select 'fb110002-0000-4000-8000-000000000002'::uuid $$;
create function pg_temp.tech() returns uuid language sql immutable as $$ select 'fb110003-0000-4000-8000-000000000003'::uuid $$;
create function pg_temp.idle() returns uuid language sql immutable as $$ select 'fb110004-0000-4000-8000-000000000004'::uuid $$;
create function pg_temp.maid() returns uuid language sql immutable as $$ select 'fb110005-0000-4000-8000-000000000005'::uuid $$;
create function pg_temp.rival() returns uuid language sql immutable as $$ select 'fb110006-0000-4000-8000-000000000006'::uuid $$;
create function pg_temp.pid(n integer) returns uuid language sql immutable as $$
  select ('fb110010-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create function pg_temp.gid(n integer) returns uuid language sql immutable as $$
  select ('fb110020-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

-- What the page asks, as a given person. The id is made before the switch: a function of pg_temp
-- is not the client's to call (no default EXECUTE for PUBLIC, 20260907150000).
create function pg_temp.origin(sub uuid, n integer) returns jsonb language plpgsql as $$
declare
  v_id uuid := pg_temp.pid(n);
  v jsonb;
begin
  perform pg_temp.as_user(sub);
  v := public.problem_guest_origin(v_id);
  perform set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true);
  return v;
end $$;

create function pg_temp.keys(v jsonb) returns text language sql immutable as $$
  select coalesce(string_agg(k, ',' order by k), '') from jsonb_object_keys(v) k
$$;

-- ===========================================================================
-- Fixtures: a company with every role, another company, four tasks from guests and one report
-- ===========================================================================

insert into public.hosts (id, name) values
  ('fb110000-0000-4000-8000-00000000000a', 'Origin co'),
  ('fb110000-0000-4000-8000-00000000000b', 'Rival co');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       u.email, 'x', now(), now(), jsonb_build_object('full_name', u.name), jsonb_build_object('role', u.role)
from (values
  (pg_temp.boss(),  'boss.go@test.local',  'Boss',  'manager'),
  (pg_temp.head(),  'head.go@test.local',  'Head',  'head_tech'),
  (pg_temp.tech(),  'tech.go@test.local',  'Tech',  'tech'),
  (pg_temp.idle(),  'idle.go@test.local',  'Idle',  'tech'),
  (pg_temp.maid(),  'maid.go@test.local',  'Maid',  'cleaner'),
  (pg_temp.rival(), 'rival.go@test.local', 'Rival', 'manager')) as u (id, email, name, role);

update public.profiles set host_id = 'fb110000-0000-4000-8000-00000000000a'
where id in (pg_temp.boss(), pg_temp.head(), pg_temp.tech(), pg_temp.idle(), pg_temp.maid());
update public.profiles set host_id = 'fb110000-0000-4000-8000-00000000000b' where id = pg_temp.rival();

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900111001, 'fb110000-0000-4000-8000-00000000000a', 'Origin flat', 'UTC', '15:00', '10:00'),
  (900111002, 'fb110000-0000-4000-8000-00000000000b', 'Rival flat', 'UTC', '15:00', '10:00');

-- Two bookings: one with its guest's name, one whose name retention has cleared.
insert into public.reservations (id, host_id, property_id, arrival_date, departure_date, status, guest_name, is_block)
values
  (900111011, 'fb110000-0000-4000-8000-00000000000a', 900111001, current_date - 10, current_date - 5,
   'new', 'Synthetic Guest One', false),
  (900111012, 'fb110000-0000-4000-8000-00000000000a', 900111001, current_date - 4, current_date + 2,
   'new', null, false);

-- The signals: 1 a review still linked, 2 a chat linked to the nameless booking, 3 a review the cut
-- has taken, 4 a chat whose booking was never found.
insert into public.guest_signals (id, host_id, provider, kind, external_key, conversation_key, external_id,
                                  external_listing_id, property_id, external_reservation_id, reservation_id,
                                  channel, rating, arrival_date, departure_date, submitted_at, stay_exact,
                                  has_public_text)
values
  (pg_temp.gid(1), 'fb110000-0000-4000-8000-00000000000a', 'hostaway', 'review', repeat('a1', 32), null,
   '7700001', '900111001', 900111001, '900111011', 900111011, 'airbnb', 6,
   current_date - 10, current_date - 5, now() - interval '2 days', true, true),
  (pg_temp.gid(2), 'fb110000-0000-4000-8000-00000000000a', 'hostaway', 'message', repeat('a2', 32),
   repeat('c2', 32), '7700002', '900111001', 900111001, '900111012', 900111012, 'booking', null,
   current_date - 4, current_date + 2, now() - interval '1 day', true, false),
  (pg_temp.gid(3), 'fb110000-0000-4000-8000-00000000000a', 'hostaway', 'review', repeat('a3', 32), null,
   null, '900111001', 900111001, null, null, 'booking', 9,
   date '2026-09-01', date '2026-10-01', timestamptz '2026-10-01 00:00 Europe/Prague', false, false),
  (pg_temp.gid(4), 'fb110000-0000-4000-8000-00000000000a', 'hostaway', 'message', repeat('a4', 32),
   repeat('c4', 32), '7700004', '900111001', 900111001, null, null, 'direct', null,
   current_date - 1, current_date + 3, now() - interval '3 hours', true, false);

-- The tasks they made, and a report of the staff.
insert into public.problems (id, host_id, property_id, reported_by, title, status, source, source_facts)
select pg_temp.pid(n), 'fb110000-0000-4000-8000-00000000000a', 900111001, null, 'Synthetic task ' || n,
       'open', s::public.problem_source,
       jsonb_build_object('kind', 'repair', 'subject', 'plumbing_leak', 'channel', c,
                          'period_month', to_char(current_date, 'YYYY-MM'), 'mode', 'manager')
from (values (1, 'review', 'airbnb'), (2, 'message', 'booking'), (3, 'review', 'booking'),
             (4, 'message', 'direct')) as t (n, s, c);
insert into public.problems (id, host_id, property_id, reported_by, title, status)
values (pg_temp.pid(5), 'fb110000-0000-4000-8000-00000000000a', 900111001, pg_temp.maid(),
        'Synthetic report', 'open');

insert into public.signal_findings (host_id, signal_id, property_id, kind, subject, summary, summary_i18n,
                                    detector, status, decided_mode, problem_id, decided_at,
                                    external_conversation_id, conversation_link_ends)
select 'fb110000-0000-4000-8000-00000000000a', pg_temp.gid(n), 900111001, 'repair', 'plumbing_leak',
       'plumbing_leak', '{}'::jsonb, 'rules-v1', 'task_created', 'manager', pg_temp.pid(n), now(),
       case when n = 2 then 'conv7001' end, case when n = 2 then current_date + 30 end
from generate_series(1, 4) n;

-- The technician holds the live repair of task 1 and of nothing else.
insert into public.tasks (property_id, type, status, assignee_id, scheduled_date, problem_id)
values (900111001, 'maintenance', 'assigned', pg_temp.tech(), current_date, pg_temp.pid(1));

-- ===========================================================================
-- 1. The office: everything, the name from the booking
-- ===========================================================================

select pg_temp.check('1.1 the office reads the review''s whole origin',
  pg_temp.origin(pg_temp.boss(), 1),
  jsonb_build_object(
    'source', 'review',
    'stay', jsonb_build_object('precision', 'day',
                               'arrival', to_char(current_date - 10, 'YYYY-MM-DD'),
                               'departure', to_char(current_date - 5, 'YYYY-MM-DD')),
    'channel', 'airbnb',
    'guest', jsonb_build_object('state', 'shown', 'name', 'Synthetic Guest One'),
    'rating', 6,
    'sent', jsonb_build_object('precision', 'day',
                               'on', to_char(((now() - interval '2 days') at time zone 'Europe/Prague')::date,
                                             'YYYY-MM-DD')),
    'booking_id', '900111011',
    'conversation_id', null,
    'signal_id', pg_temp.gid(1),
    'has_text', true));

select pg_temp.check('1.2 a chat on a booking whose name retention cleared: erased, the conversation''s number',
  (select jsonb_build_object('guest', o -> 'guest', 'conversation', o ->> 'conversation_id',
                             'booking', o ->> 'booking_id', 'rating', o -> 'rating', 'source', o ->> 'source')
   from pg_temp.origin(pg_temp.boss(), 2) o),
  jsonb_build_object('guest', jsonb_build_object('state', 'erased', 'name', null), 'conversation', 'conv7001',
                     'booking', '900111012', 'rating', null, 'source', 'message'));

select pg_temp.check('1.3 a decided card whose stay the cut took: months, no booking, says why',
  (select jsonb_build_object('stay', o -> 'stay', 'guest', o -> 'guest', 'sent', o -> 'sent',
                             'booking', o -> 'booking_id')
   from pg_temp.origin(pg_temp.boss(), 3) o),
  jsonb_build_object('stay', jsonb_build_object('precision', 'month', 'arrival', '2026-09', 'departure', '2026-10'),
                     'guest', jsonb_build_object('state', 'cut', 'name', null),
                     'sent', jsonb_build_object('precision', 'month', 'on', '2026-10'),
                     'booking', null));

select pg_temp.check('1.4 a chat whose booking was never found: none, its days still exact',
  (select jsonb_build_object('guest', o -> 'guest', 'precision', o -> 'stay' ->> 'precision',
                             'booking', o -> 'booking_id', 'channel', o ->> 'channel')
   from pg_temp.origin(pg_temp.boss(), 4) o),
  jsonb_build_object('guest', jsonb_build_object('state', 'none', 'name', null), 'precision', 'day',
                     'booking', null, 'channel', 'direct'));

select pg_temp.check('1.5 a report of the staff has no origin',
  pg_temp.origin(pg_temp.boss(), 5), null::jsonb);

-- ===========================================================================
-- 2. The head technician: the name and the facts, not the PMS's numbers
-- ===========================================================================

select pg_temp.check('2.1 the head technician''s keys',
  pg_temp.keys(pg_temp.origin(pg_temp.head(), 1)), 'channel,guest,rating,sent,source,stay');
select pg_temp.check('2.2 the head technician reads the name',
  pg_temp.origin(pg_temp.head(), 1) #>> '{guest,name}', 'Synthetic Guest One');
select pg_temp.check('2.3 the head technician sees no conversation''s number',
  pg_temp.origin(pg_temp.head(), 2) ? 'conversation_id', false);

-- ===========================================================================
-- 3. The technician and the maid: the source and the stay, nothing of the guest
-- ===========================================================================

select pg_temp.check('3.1 the technician holding the repair: the source and the stay only',
  pg_temp.origin(pg_temp.tech(), 1),
  jsonb_build_object('source', 'review',
                     'stay', jsonb_build_object('precision', 'day',
                                                'arrival', to_char(current_date - 10, 'YYYY-MM-DD'),
                                                'departure', to_char(current_date - 5, 'YYYY-MM-DD'))));
select pg_temp.check('3.2 a task he does not hold gives him nothing',
  pg_temp.origin(pg_temp.tech(), 2), null::jsonb);
select pg_temp.check('3.3 another technician learns nothing of task 1',
  pg_temp.origin(pg_temp.idle(), 1), null::jsonb);
select pg_temp.check('3.4 the maid learns nothing of a task from a guest',
  pg_temp.origin(pg_temp.maid(), 1), null::jsonb);
select pg_temp.check('3.5 nor of her own report, which has no guest',
  pg_temp.origin(pg_temp.maid(), 5), null::jsonb);
select pg_temp.check('3.6 another company''s manager learns nothing',
  pg_temp.origin(pg_temp.rival(), 1), null::jsonb);

update public.problems set archived_at = now() where id = pg_temp.pid(1);
select pg_temp.check('3.7 once archived, the technician no longer reads it, as with the task itself',
  pg_temp.origin(pg_temp.tech(), 1), null::jsonb);
select pg_temp.check('3.8 the head technician and the office still do',
  (pg_temp.origin(pg_temp.head(), 1) ->> 'source') || ' ' || (pg_temp.origin(pg_temp.boss(), 1) ->> 'source'),
  'review review');
update public.problems set archived_at = null where id = pg_temp.pid(1);

update public.profiles set is_active = false where id = pg_temp.head();
select pg_temp.check('3.9 a head technician switched off learns nothing',
  pg_temp.origin(pg_temp.head(), 1), null::jsonb);
update public.profiles set is_active = true where id = pg_temp.head();

-- ===========================================================================
-- 4. The name is read, never kept
-- ===========================================================================

select pg_temp.check('4.1 the reader cannot write (stable)',
  (select provolatile from pg_proc where oid = 'public.problem_guest_origin(uuid)'::regprocedure), 's'::"char");

select pg_temp.check('4.2 after every reading, the name lives only in the booking',
  (select count(*)::int from public.problems x where row_to_json(x)::text like '%Synthetic Guest One%')
  + (select count(*)::int from public.problem_events x where row_to_json(x)::text like '%Synthetic Guest One%')
  + (select count(*)::int from public.signal_findings x where row_to_json(x)::text like '%Synthetic Guest One%')
  + (select count(*)::int from public.guest_signals x where row_to_json(x)::text like '%Synthetic Guest One%')
  + (select count(*)::int from raw.push_outbox x where row_to_json(x)::text like '%Synthetic Guest One%'),
  0);

update public.reservations set guest_name = null where id = 900111011;
select pg_temp.check('4.3 once retention clears the booking''s name, the task says erased',
  pg_temp.origin(pg_temp.boss(), 1) -> 'guest', jsonb_build_object('state', 'erased', 'name', null));
select pg_temp.check('4.4 and still shows the days',
  pg_temp.origin(pg_temp.boss(), 1) #>> '{stay,precision}', 'day');

update public.signal_findings set external_conversation_id = null, conversation_link_ends = null
where problem_id = pg_temp.pid(2);
select pg_temp.check('4.5 once the conversation''s number is purged, it is gone from the task',
  pg_temp.origin(pg_temp.boss(), 2) -> 'conversation_id', 'null'::jsonb);

-- ===========================================================================
-- 5. API v1: the source and the stay, never the name
-- ===========================================================================

update public.reservations set guest_name = 'Synthetic Guest One' where id = 900111011;

select pg_temp.check('5.1 the API''s task says its source and its stay',
  (select jsonb_build_object('source', j -> 'source', 'guest_stay', j -> 'guest_stay')
   from public.problems p, public.api_task_json(p, array['staff:read_names']) j where p.id = pg_temp.pid(1)),
  jsonb_build_object('source', 'review',
                     'guest_stay', jsonb_build_object('precision', 'day',
                                                      'arrival', to_char(current_date - 10, 'YYYY-MM-DD'),
                                                      'departure', to_char(current_date - 5, 'YYYY-MM-DD'))));
select pg_temp.check('5.2 a cut stay in the API: its months',
  (select j -> 'guest_stay' from public.problems p, public.api_task_json(p, '{}') j where p.id = pg_temp.pid(3)),
  jsonb_build_object('precision', 'month', 'arrival', '2026-09', 'departure', '2026-10'));
select pg_temp.check('5.3 a report of the staff in the API: source staff, no stay',
  (select jsonb_build_object('source', j -> 'source', 'guest_stay', j -> 'guest_stay')
   from public.problems p, public.api_task_json(p, '{}') j where p.id = pg_temp.pid(5)),
  jsonb_build_object('source', 'staff', 'guest_stay', null));
select pg_temp.check('5.4 no task in the API carries the guest''s name, whatever the scopes',
  (select count(*)::int from public.problems p, public.api_task_json(p, array['staff:read_names']) j
   where p.host_id = 'fb110000-0000-4000-8000-00000000000a' and j::text like '%Synthetic Guest One%'),
  0);

-- ===========================================================================
-- 6. Who may call what
-- ===========================================================================

select pg_temp.check('6.1 a person signed in may ask, anon may not',
  has_function_privilege('authenticated', 'public.problem_guest_origin(uuid)', 'execute')::text || ' '
  || has_function_privilege('anon', 'public.problem_guest_origin(uuid)', 'execute')::text,
  'true false');
select pg_temp.check('6.2 the building blocks are no client''s to call',
  (select coalesce(string_agg(r || ' ' || f, ', ' order by r, f), '')
   from unnest(array['anon', 'authenticated', 'service_role']) r
   cross join unnest(array['public.guest_stay_json(public.guest_signals)',
                           'public.problem_origin_signal(uuid)',
                           'public.api_task_guest_stay(public.problems)',
                           'public.api_task_json(public.problems,text[])']) f
   where has_function_privilege(r, f, 'EXECUTE')),
  '');

rollback;
