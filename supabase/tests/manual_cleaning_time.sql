-- A manager's time of a booking's cleaning holds against every automatic run while the
-- cleaning keeps its day (20261027120000, docs/manual-cleaning-time.md).
-- Run: npm run test:rls. Runs inside a transaction and rolls back.
--
--   * set_cleaning_time: the hours hold against the generator — a webhook's run and the
--     night's, a change of the booking's hours, the next guest moving — and against a save
--     that keeps the day; everything else still follows the booking;
--   * a change of day drops them (the booking moved, the move undone, the manager moving
--     it) and leaves the panel the day they were for; the journal says who and both windows;
--   * clear_cleaning_time gives the booking's window back and clears both marks;
--   * a booking cancelled and live again: its new cleaning carries the hours on the same
--     day, the mark on another; a change of room keeps them;
--   * only a manager or an admin; an executor's write of the marks is reverted; the cleaner
--     hears of tomorrow's new hours by the push that already exists (cleaning_window).
--
-- Every case has its own listing; ids 9000031xx, rooms 310xx. Days are counted from today.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('a8f31001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.hours@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('a8f31002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.hours@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('a8f31003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','head.hours@test.local','x',now(),now(),
   '{"full_name":"Head"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('a8f31004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','admin.hours@test.local','x',now(),now(),
   '{"full_name":"Admin"}'::jsonb, '{"role":"admin"}'::jsonb),
  ('a8f31005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','other.hours@test.local','x',now(),now(),
   '{"full_name":"Other"}'::jsonb, '{"role":"manager"}'::jsonb);

-- Another company, with a booking's cleaning of its own.
insert into public.hosts (id, name) values ('a8f31000-0000-4000-8000-00000000000b', 'Host Elsewhere');
update public.profiles set host_id = 'a8f31000-0000-4000-8000-00000000000b'
where id = 'a8f31005-0000-4000-8000-000000000005';

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900031001, 'Hours hold',            'UTC', '15:00', '10:00'),
  (900031002, 'Booking moves the day', 'UTC', '15:00', '10:00'),
  (900031003, 'Back to the booking',   'UTC', '15:00', '10:00'),
  (900031004, 'Moved, then hours',     'UTC', '15:00', '10:00'),
  (900031005, 'Manager moves the day', 'UTC', '15:00', '10:00'),
  (900031006, 'Back, same day',        'UTC', '15:00', '10:00'),
  (900031007, 'Back, other day',       'UTC', '15:00', '10:00'),
  (900031008, 'Rooms house',           'UTC', '15:00', '10:00'),
  (900031009, 'Refusals',              'UTC', '15:00', '10:00'),
  (900031010, 'Tomorrow, accepted',    'UTC', '15:00', '10:00');

insert into public.properties (id, hostaway_unit_id, parent_id, name,
                               timezone, check_in_time, check_out_time) values
  (public.property_id_for_unit(31081), 31081, 900031008, 'Room A', 'UTC', '15:00', '10:00'),
  (public.property_id_for_unit(31082), 31082, 900031008, 'Room B', 'UTC', '15:00', '10:00');

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900031020, 'a8f31000-0000-4000-8000-00000000000b', 'Elsewhere', 'UTC', '15:00', '10:00');

insert into public.reservations (id, property_id, arrival_date, departure_date, status,
                                 guest_name, guests_count)
values
  (900031001, 900031001, current_date + 5,  current_date + 10, 'new', 'Guest 1', 2),
  -- The next guest of Hours hold: arrives the day 1 leaves, at 16:00.
  (900031011, 900031001, current_date + 10, current_date + 12, 'new', 'Guest 11', 3),
  (900031002, 900031002, current_date + 5,  current_date + 10, 'new', 'Guest 2', 2),
  (900031003, 900031003, current_date + 5,  current_date + 10, 'new', 'Guest 3', 2),
  (900031004, 900031004, current_date + 5,  current_date + 10, 'new', 'Guest 4', 2),
  (900031005, 900031005, current_date + 5,  current_date + 10, 'new', 'Guest 5', 2),
  (900031006, 900031006, current_date + 5,  current_date + 10, 'new', 'Guest 6', 2),
  (900031007, 900031007, current_date + 5,  current_date + 10, 'new', 'Guest 7', 2),
  (900031008, 900031008, current_date + 5,  current_date + 10, 'new', 'Guest 8', 2),
  (900031009, 900031009, current_date + 5,  current_date + 10, 'new', 'Guest 9', 2),
  (900031010, 900031010, current_date - 2,  current_date + 1,  'new', 'Guest 10', 2);

update public.reservations set check_in_time = '16:00' where id = 900031011;

insert into public.reservation_units (reservation_id, property_id) values
  (900031008, public.property_id_for_unit(31081));

-- The cleaning of Refusals under a known id, written before the first run: the generator
-- finds it live and writes no other. A refusal asked as somebody who cannot read it must
-- not depend on reading it.
insert into public.tasks (id, property_id, reservation_id, type, status, scheduled_date,
                          time_from, time_to)
values ('a8f31009-0000-4000-8000-000000000009', 900031009, 900031009, 'cleaning', 'unassigned',
        current_date + 10, '10:00', '15:00');

insert into public.reservations (id, host_id, property_id, arrival_date, departure_date,
                                 status, guest_name, guests_count)
values (900031020, 'a8f31000-0000-4000-8000-00000000000b', 900031020,
        current_date + 5, current_date + 10, 'new', 'Guest 20', 2);
insert into public.tasks (id, host_id, property_id, reservation_id, type, status, scheduled_date,
                          time_from, time_to)
values ('a8f31020-0000-4000-8000-000000000020', 'a8f31000-0000-4000-8000-00000000000b',
        900031020, 900031020, 'cleaning', 'unassigned', current_date + 10, '10:00', '15:00');

-- Maria's phone, for the push of section 9.
insert into public.push_tokens (token, profile_id, host_id, platform)
select 'ExponentPushToken[hours-maria]', p.id, p.host_id, 'android'
from public.profiles p where p.id = 'a8f31002-0000-4000-8000-000000000002';

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.refusal(statement text)
returns text language plpgsql as $$
declare
  v_hint text;
begin
  execute statement;
  return 'no refusal';
exception when check_violation or insufficient_privilege or invalid_parameter_value then
  get stacked diagnostics v_hint = pg_exception_hint;
  return v_hint;
end $$;

create or replace function pg_temp.sqlstate_of(statement text)
returns text language plpgsql as $$
begin
  execute statement;
  return 'none';
exception when others then
  return sqlstate;
end $$;

create or replace function pg_temp.as_user(user_id text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || user_id || '","role":"authenticated"}', true)
$$;

create or replace function pg_temp.as_boss() returns void language sql as $$
  select pg_temp.as_user('a8f31001-0000-4000-8000-000000000001')
$$;

create or replace function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true)
$$;

-- The live cleaning of a booking, else the latest closed one.
create or replace function pg_temp.cleaning(res_id bigint)
returns public.tasks language sql as $$
  select t.* from public.tasks t
  where t.reservation_id = res_id and t.type = 'cleaning'
  order by (t.status in ('cancelled', 'expired')), t.id
  limit 1
$$;

create or replace function pg_temp.run() returns jsonb language sql as $$
  select public.generate_cleaning_tasks(current_date - 7, current_date + 60)
$$;

-- A webhook's run: the departures of its batch, here the one booking's.
create or replace function pg_temp.run_for(res_id bigint) returns jsonb language sql as $$
  select public.generate_cleaning_tasks(r.departure_date, r.departure_date)
  from public.reservations r where r.id = res_id
$$;

-- The manager sets the hours in the panel: the day the form showed goes with them.
create or replace function pg_temp.set_hours(res_id bigint, t_from time, t_to time)
returns void language plpgsql as $$
declare
  v_task public.tasks := pg_temp.cleaning(res_id);
begin
  perform pg_temp.as_boss();
  perform public.set_cleaning_time(v_task.id, t_from, t_to, v_task.scheduled_date);
  perform pg_temp.as_postgres();
end $$;

create or replace function pg_temp.clear_hours(res_id bigint)
returns void language plpgsql as $$
declare
  v_task public.tasks := pg_temp.cleaning(res_id);
begin
  perform pg_temp.as_boss();
  perform public.clear_cleaning_time(v_task.id, v_task.scheduled_date);
  perform pg_temp.as_postgres();
end $$;

-- The panel's save of the whole form: every field as it stands, the day the form showed.
create or replace function pg_temp.save(res_id bigint, day date, t_from time default null,
                                        t_to time default null)
returns void language plpgsql as $$
declare
  v_task public.tasks := pg_temp.cleaning(res_id);
begin
  perform pg_temp.as_boss();
  perform public.save_task(v_task.id, v_task.property_id, 'cleaning', day,
    v_task.title, null, v_task.assignee_id, coalesce(t_from, v_task.time_from),
    coalesce(t_to, v_task.time_to), v_task.notes, null, false, v_task.scheduled_date);
  perform pg_temp.as_postgres();
end $$;

create or replace function pg_temp.hours(res_id bigint) returns text language sql as $$
  select to_char(t.time_from, 'HH24:MI') || '-' || to_char(t.time_to, 'HH24:MI')
  from pg_temp.cleaning(res_id) t
$$;

create or replace function pg_temp.marks(res_id bigint) returns text language sql as $$
  select coalesce('on +' || (t.manual_time_on - current_date), 'on -')
         || ' lost ' || coalesce('+' || (t.manual_time_lost_on - current_date), '-')
  from pg_temp.cleaning(res_id) t
$$;

-- The journal of the hours of a task: kind, the actor's role or "system", the cause.
create or replace function pg_temp.hour_events(task_id uuid) returns text[] language sql as $$
  select coalesce(array_agg(e.kind::text || ' ' || coalesce(p.role::text, 'system')
                            || coalesce(' ' || e.cause, '') order by e.id), '{}')
  from public.task_events e
  left join public.profiles p on p.id = e.actor_id
  where e.task_id = hour_events.task_id and e.kind::text like 'time\_%'
$$;

create or replace function pg_temp.last_hour_params(task_id uuid) returns jsonb language sql as $$
  select e.params from public.task_events e
  where e.task_id = last_hour_params.task_id and e.kind::text like 'time\_%'
  order by e.id desc limit 1
$$;

select pg_temp.run();

-- ---------- 1. the hours hold ----------

select pg_temp.check('1: before, the booking''s window up to the next guest', pg_temp.hours(900031001), '10:00-16:00');
select pg_temp.set_hours(900031001, '12:00', '15:30');
select pg_temp.check('1: set', pg_temp.hours(900031001), '12:00-15:30');
select pg_temp.check('1: marked for its day', pg_temp.marks(900031001), 'on +10 lost -');
select pg_temp.check('1: the journal says who',
  pg_temp.hour_events((pg_temp.cleaning(900031001)).id), array['time_set manager']);
select pg_temp.check('1: and both windows',
  pg_temp.last_hour_params((pg_temp.cleaning(900031001)).id),
  jsonb_build_object('date', current_date + 10,
                     'from', jsonb_build_object('time_from', '10:00:00', 'time_to', '16:00:00'),
                     'to', jsonb_build_object('time_from', '12:00:00', 'time_to', '15:30:00')));

select pg_temp.run();
select pg_temp.check('1: the night''s run leaves them', pg_temp.hours(900031001), '12:00-15:30');
select pg_temp.run_for(900031001);
select pg_temp.check('1: a webhook''s run leaves them', pg_temp.hours(900031001), '12:00-15:30');

-- The booking's hours change, and the next guest's: the window would move, the hours do not;
-- what the phone says about the next check-in still follows the booking.
update public.reservations set check_out_time = '11:00' where id = 900031001;
update public.reservations set check_in_time = '17:00', guests_count = 4 where id = 900031011;
select pg_temp.run();
select pg_temp.check('1: the booking''s new hours do not take them', pg_temp.hours(900031001), '12:00-15:30');
select pg_temp.check('1: the next guest''s hour and party still follow',
  (select row(t.priority, t.due_at, t.guests_count)::text from pg_temp.cleaning(900031001) t),
  row(1::smallint, ((current_date + 10) + time '17:00') at time zone 'UTC', 4::smallint)::text);
select pg_temp.check('1: still marked', pg_temp.marks(900031001), 'on +10 lost -');

-- The form saved again on the same day, with whatever hours it shows.
select pg_temp.save(900031001, current_date + 10, '09:00', '11:00');
select pg_temp.check('1: a save that keeps the day keeps them', pg_temp.hours(900031001), '12:00-15:30');
select pg_temp.check('1: and the mark', pg_temp.marks(900031001), 'on +10 lost -');

-- The same hours again: the replay of a lost answer writes nothing.
select pg_temp.set_hours(900031001, '12:00', '15:30');
select pg_temp.check('1: the same hours again journal nothing',
  pg_temp.hour_events((pg_temp.cleaning(900031001)).id), array['time_set manager']);
select pg_temp.set_hours(900031001, '13:00', '15:00');
select pg_temp.check('1: other hours are set again',
  pg_temp.hour_events((pg_temp.cleaning(900031001)).id), array['time_set manager', 'time_set manager']);
select pg_temp.check('1: from the first hand to the second',
  pg_temp.last_hour_params((pg_temp.cleaning(900031001)).id) -> 'from',
  jsonb_build_object('time_from', '12:00:00', 'time_to', '15:30:00'));

-- ---------- 2. the booking moves the day ----------

select pg_temp.set_hours(900031002, '12:00', '14:00');
update public.reservations set departure_date = current_date + 11 where id = 900031002;
select pg_temp.run();
select pg_temp.check('2: the cleaning follows the booking', (pg_temp.cleaning(900031002)).scheduled_date, current_date + 11);
select pg_temp.check('2: on the new day, the booking''s window', pg_temp.hours(900031002), '10:00-15:00');
select pg_temp.check('2: the hand dropped, the day it was for kept', pg_temp.marks(900031002), 'on - lost +10');
select pg_temp.check('2: the journal: set, then dropped by the booking',
  pg_temp.hour_events((pg_temp.cleaning(900031002)).id),
  array['time_set manager', 'time_dropped system booking_changed']);
select pg_temp.check('2: what was dropped, and from which day',
  pg_temp.last_hour_params((pg_temp.cleaning(900031002)).id),
  jsonb_build_object('date', current_date + 11, 'from_date', current_date + 10,
                     'manual_on', current_date + 10,
                     'from', jsonb_build_object('time_from', '12:00:00', 'time_to', '14:00:00'),
                     'to', jsonb_build_object('time_from', '10:00:00', 'time_to', '15:00:00')));
select pg_temp.check('2: the day''s move is journaled before the hours',
  (select array_agg(e.kind::text order by e.id) from public.task_events e
   where e.task_id = (pg_temp.cleaning(900031002)).id and e.kind::text in ('moved', 'time_dropped')),
  array['moved', 'time_dropped']);

-- The manager has seen it: the mark goes, nothing else changes, nothing is journaled.
select pg_temp.clear_hours(900031002);
select pg_temp.check('2: seen: no mark', pg_temp.marks(900031002), 'on - lost -');
select pg_temp.check('2: seen: the hours as they were', pg_temp.hours(900031002), '10:00-15:00');
select pg_temp.check('2: seen: nothing journaled',
  cardinality(pg_temp.hour_events((pg_temp.cleaning(900031002)).id)), 2);

-- ---------- 3. back to the booking ----------

select pg_temp.set_hours(900031003, '12:00', '14:00');
select pg_temp.clear_hours(900031003);
select pg_temp.check('3: the booking''s window again', pg_temp.hours(900031003), '10:00-15:00');
select pg_temp.check('3: no marks', pg_temp.marks(900031003), 'on - lost -');
select pg_temp.check('3: the window the generator writes',
  (select row(w.window_from, w.window_to)::text
   from public.reservation_cleaning_window(900031003, 900031003) w),
  (select row(t.time_from, t.time_to)::text from pg_temp.cleaning(900031003) t));
select pg_temp.check('3: journaled as back to the booking',
  pg_temp.hour_events((pg_temp.cleaning(900031003)).id), array['time_set manager', 'time_auto manager']);

-- ---------- 4. a moved cleaning, then hours on its day ----------

select pg_temp.save(900031004, current_date + 8);
select pg_temp.check('4: moved', (pg_temp.cleaning(900031004)).pinned_departure, current_date + 10);
select pg_temp.set_hours(900031004, '13:00', '15:00');
-- A guest books into the moved day: the refresh brings the check-in, not the hours.
insert into public.reservations (id, property_id, arrival_date, departure_date, status,
                                 guest_name, guests_count, check_in_time)
values (900031014, 900031004, current_date + 8, current_date + 9, 'new', 'Guest 14', 4, '18:00');
select pg_temp.run();
select pg_temp.check('4: the refresh leaves the hours', pg_temp.hours(900031004), '13:00-15:00');
select pg_temp.check('4: and brings the next check-in',
  (select row(t.priority, t.guests_count)::text from pg_temp.cleaning(900031004) t),
  row(1::smallint, 4::smallint)::text);
-- The booking changes its dates: the move is undone, and with the day the hours.
update public.reservations set departure_date = current_date + 12 where id = 900031004;
select pg_temp.run();
select pg_temp.check('4: back on the booking''s new departure', (pg_temp.cleaning(900031004)).scheduled_date, current_date + 12);
select pg_temp.check('4: the booking''s window', pg_temp.hours(900031004), '10:00-15:00');
select pg_temp.check('4: the mark of the moved day', pg_temp.marks(900031004), 'on - lost +8');

-- ---------- 5. the manager moves the day ----------

select pg_temp.set_hours(900031005, '12:00', '14:00');
select pg_temp.save(900031005, current_date + 9);
select pg_temp.check('5: moved', (pg_temp.cleaning(900031005)).scheduled_date, current_date + 9);
select pg_temp.check('5: the window of the new day', pg_temp.hours(900031005), '10:00-15:00');
select pg_temp.check('5: the hand dropped', pg_temp.marks(900031005), 'on - lost +10');
select pg_temp.check('5: journaled as the manager''s',
  pg_temp.hour_events((pg_temp.cleaning(900031005)).id),
  array['time_set manager', 'time_dropped manager manager']);
-- Set again on the new day: the mark goes.
select pg_temp.set_hours(900031005, '11:00', '13:00');
select pg_temp.check('5: set on the new day', pg_temp.marks(900031005), 'on +9 lost -');

-- ---------- 6. a booking back, the same day ----------

select pg_temp.set_hours(900031006, '12:00', '14:00');
update public.reservations set status = 'cancelled' where id = 900031006;
select pg_temp.run();
select pg_temp.check('6: cancelled with its booking', (pg_temp.cleaning(900031006)).status, 'cancelled'::public.task_status);
update public.reservations set status = 'modified' where id = 900031006;
select pg_temp.run();
select pg_temp.check('6: a new cleaning', (pg_temp.cleaning(900031006)).status, 'unassigned'::public.task_status);
select pg_temp.check('6: with the manager''s hours', pg_temp.hours(900031006), '12:00-14:00');
select pg_temp.check('6: and the mark', pg_temp.marks(900031006), 'on +10 lost -');
select pg_temp.check('6: journaled as carried',
  pg_temp.last_hour_params((pg_temp.cleaning(900031006)).id),
  jsonb_build_object('date', current_date + 10, 'carried', true,
                     'to', jsonb_build_object('time_from', '12:00:00', 'time_to', '14:00:00')));

-- ---------- 7. a booking back, another day ----------

select pg_temp.set_hours(900031007, '12:00', '14:00');
update public.reservations set status = 'cancelled' where id = 900031007;
select pg_temp.run();
update public.reservations set status = 'modified', departure_date = current_date + 11
where id = 900031007;
select pg_temp.run();
select pg_temp.check('7: a new cleaning on the new day', (pg_temp.cleaning(900031007)).scheduled_date, current_date + 11);
select pg_temp.check('7: with the booking''s window', pg_temp.hours(900031007), '10:00-15:00');
select pg_temp.check('7: and the mark of the old day', pg_temp.marks(900031007), 'on - lost +10');
select pg_temp.check('7: journaled as dropped by the booking',
  pg_temp.hour_events((pg_temp.cleaning(900031007)).id), array['time_dropped system booking_changed']);

-- ---------- 8. another room of the listing ----------

select pg_temp.set_hours(900031008, '12:00', '14:00');
delete from public.reservation_units where reservation_id = 900031008;
insert into public.reservation_units (reservation_id, property_id) values
  (900031008, public.property_id_for_unit(31082));
select pg_temp.run();
select pg_temp.check('8: the cleaning goes to the new room',
  (pg_temp.cleaning(900031008)).property_id, public.property_id_for_unit(31082));
select pg_temp.check('8: the same day keeps the hours', pg_temp.hours(900031008), '12:00-14:00');
select pg_temp.check('8: and the mark', pg_temp.marks(900031008), 'on +10 lost -');

-- ---------- 9. the cleaner ----------

-- Hers, tomorrow: the new hours reach her phone by the push that tells her of new hours.
update public.tasks set assignee_id = 'a8f31002-0000-4000-8000-000000000002', status = 'accepted'
where id = (pg_temp.cleaning(900031010)).id;
delete from raw.push_outbox;
select pg_temp.set_hours(900031010, '12:00', '14:00');
select pg_temp.check('9: she is told',
  (select array_agg(o.kind::text || ' ' || (o.params ->> 'time_from')) from raw.push_outbox o
   where o.recipient_id = 'a8f31002-0000-4000-8000-000000000002'),
  array['cleaning_window 12:00:00']);
select pg_temp.check('9: what she accepted stays accepted',
  (pg_temp.cleaning(900031010)).status, 'accepted'::public.task_status);

-- Her own write of the hours and the marks is the office's to make.
select pg_temp.as_user('a8f31002-0000-4000-8000-000000000002');
update public.tasks
set time_from = '06:00', manual_time_on = null, manual_time_lost_on = current_date
where reservation_id = 900031010 and type = 'cleaning' and status = 'accepted';
select pg_temp.as_postgres();
select pg_temp.check('9: her write of the hours is reverted', pg_temp.hours(900031010), '12:00-14:00');
select pg_temp.check('9: and of the marks', pg_temp.marks(900031010), 'on +1 lost -');

-- ---------- 10. who may ----------

select pg_temp.as_user('a8f31002-0000-4000-8000-000000000002');
select pg_temp.check('10: a cleaner may not',
  pg_temp.refusal('select public.set_cleaning_time(''a8f31009-0000-4000-8000-000000000009'', ''12:00'', ''13:00'')'),
  'serverErrors.managerOnly');
select pg_temp.as_user('a8f31003-0000-4000-8000-000000000003');
select pg_temp.check('10: nor the head technician',
  pg_temp.refusal('select public.clear_cleaning_time(''a8f31009-0000-4000-8000-000000000009'')'),
  'serverErrors.managerOnly');
select pg_temp.as_user('a8f31005-0000-4000-8000-000000000005');
select pg_temp.check('10: another company''s manager does not find ours',
  pg_temp.refusal('select public.set_cleaning_time(''a8f31009-0000-4000-8000-000000000009'', ''12:00'', ''13:00'')'),
  'serverErrors.taskNotFound');
select pg_temp.as_user('a8f31004-0000-4000-8000-000000000004');
select pg_temp.check('10: an admin may',
  pg_temp.refusal('select public.set_cleaning_time(''a8f31009-0000-4000-8000-000000000009'', ''12:00'', ''13:00'')'),
  'no refusal');
select pg_temp.as_postgres();
select pg_temp.check('10: the admin''s hours', pg_temp.hours(900031009), '12:00-13:00');
select pg_temp.check('10: journaled as the admin''s',
  pg_temp.hour_events('a8f31009-0000-4000-8000-000000000009'), array['time_set admin']);
select pg_temp.check('10: anon may call neither',
  has_function_privilege('anon', 'public.set_cleaning_time(uuid, time, time, date)', 'execute')
  or has_function_privilege('anon', 'public.clear_cleaning_time(uuid, date)', 'execute'), false);
select pg_temp.check('10: the shared checks are no client''s',
  has_function_privilege('authenticated', 'public.lock_cleaning_for_time(uuid, date)', 'execute'), false);

-- ---------- 11. refusals ----------

select pg_temp.as_boss();
select public.save_task('a8f31011-0000-4000-8000-000000000011', 900031009, 'cleaning',
                        current_date + 20, null, null, null, '09:00', '11:00', null, null, true);
select pg_temp.check('11: a cleaning written by hand keeps its own hours',
  pg_temp.refusal('select public.set_cleaning_time(''a8f31011-0000-4000-8000-000000000011'', ''12:00'', ''13:00'')'),
  'serverErrors.cleaningTimeNotFromBooking');
select pg_temp.check('11: the start before the end',
  pg_temp.refusal('select public.set_cleaning_time(''a8f31009-0000-4000-8000-000000000009'', ''13:00'', ''12:00'')'),
  'serverErrors.cleaningTimeInvalid');
select pg_temp.check('11: both hours',
  pg_temp.refusal('select public.set_cleaning_time(''a8f31009-0000-4000-8000-000000000009'', ''13:00'', null)'),
  'serverErrors.cleaningTimeInvalid');
select pg_temp.check('11: a form opened on another day',
  pg_temp.refusal(format('select public.set_cleaning_time(''a8f31009-0000-4000-8000-000000000009'', ''12:00'', ''13:00'', %L)',
                         current_date + 9)),
  'serverErrors.taskMovedMeanwhile');
select pg_temp.as_postgres();
update public.tasks
set assignee_id = 'a8f31002-0000-4000-8000-000000000002', status = 'in_progress', started_at = now()
where id = 'a8f31009-0000-4000-8000-000000000009';
select pg_temp.as_boss();
select pg_temp.check('11: under way, the hours stay',
  pg_temp.refusal('select public.set_cleaning_time(''a8f31009-0000-4000-8000-000000000009'', ''12:00'', ''14:00'')'),
  'serverErrors.cleaningTimeStarted');
select pg_temp.as_postgres();
update public.tasks set status = 'done', completed_at = now()
where id = 'a8f31009-0000-4000-8000-000000000009';
select pg_temp.as_boss();
select pg_temp.check('11: closed',
  pg_temp.refusal('select public.clear_cleaning_time(''a8f31009-0000-4000-8000-000000000009'')'),
  'serverErrors.taskClosed');
select pg_temp.as_postgres();
select pg_temp.check('11: a mark on a cleaning written by hand is refused by the table',
  pg_temp.sqlstate_of('update public.tasks set manual_time_on = current_date + 20
                       where id = ''a8f31011-0000-4000-8000-000000000011'''),
  '23514');

-- ---------- 12. the rest of the table ----------

-- A second run right after a full one rewrites nothing: the hands held above are not
-- compared again and again, and every unmarked cleaning is where the booking puts it.
select pg_temp.run();
select pg_temp.check('12: a second run moves nothing', (pg_temp.run() ->> 'rescheduled')::int, 0);

rollback;
