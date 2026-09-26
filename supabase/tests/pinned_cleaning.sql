-- A booking's cleaning follows its booking; a manager's move holds until the
-- booking changes.
-- Run: npm run test:rls. Runs inside a transaction and rolls back.
--
-- The owner's rule of 2026-09-27 (it replaces the pin of 2026-09-26, which was
-- never rolled out):
--   * the cleaning always follows its booking: moved, lengthened or shortened,
--     or moved to another room of a multi-unit listing, the booking takes its
--     cleaning to the new departure and the new room, with the same cleaner;
--   * a manager may put the cleaning on another day, and it stays there while
--     the booking does not change; any change of the booking's dates or room
--     undoes the move, and the cleaning follows the booking again;
--   * in_progress and paused are never moved;
--   * a cancelled booking, a block or a "#" booking cancels the cleaning while
--     nobody has started it (unassigned, assigned, accepted);
--   * what the phone says about the next check-in is true of the day the
--     cleaning stands on, moved or not (option B).
-- And from 2026-09-26: a cleaning written by hand on a day that has a
-- booking's cleaning asks first; an expired moved cleaning is the booking's
-- tried day.
--
-- Every case has its own property; ids 9000025xx, rooms 251xx. Days are
-- counted from today.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d9002501-0000-4000-8000-0000000025e1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.pinned@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d9002502-0000-4000-8000-0000000025e2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.pinned@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb);

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900002501, 'Move and return',       'UTC', '15:00', '10:00'),
  (900002502, 'Cancelled while taken', 'UTC', '15:00', '10:00'),
  (900002503, 'Started stays',         'UTC', '15:00', '10:00'),
  (900002504, 'Accepted follows',      'UTC', '15:00', '10:00'),
  (900002505, 'Booking lengthened',    'UTC', '15:00', '10:00'),
  (900002506, 'Arrival moves',         'UTC', '15:00', '10:00'),
  (900002507, 'Duplicate question',    'UTC', '15:00', '10:00'),
  (900002508, 'Move never happened',   'UTC', '15:00', '10:00'),
  (900002509, 'Far move, moved',       'UTC', '15:00', '10:00'),
  (900002510, 'Check-in facts',        'UTC', '15:00', '10:00'),
  (900002511, 'Rooms house',           'UTC', '15:00', '10:00'),
  (900002512, 'Old flat',              'UTC', '15:00', '10:00'),
  (900002513, 'New flat',              'UTC', '15:00', '10:00'),
  (900002514, 'Far move, untouched',   'UTC', '15:00', '10:00');

insert into public.properties (id, hostaway_unit_id, parent_id, name,
                               timezone, check_in_time, check_out_time) values
  (public.property_id_for_unit(25101), 25101, 900002511, 'Room A', 'UTC', '15:00', '10:00'),
  (public.property_id_for_unit(25102), 25102, 900002511, 'Room B', 'UTC', '15:00', '10:00'),
  (public.property_id_for_unit(25103), 25103, 900002511, 'Room C', 'UTC', '15:00', '10:00');

insert into public.reservations (id, property_id, arrival_date, departure_date, status,
                                 guest_name, guests_count)
values
  (900002511, 900002501, current_date + 5,  current_date + 10, 'new', 'Guest 1', 2),
  (900002512, 900002502, current_date + 5,  current_date + 10, 'new', 'Guest 2', 2),
  (900002513, 900002502, current_date + 12, current_date + 14, 'new', 'Guest 3', 2),
  (900002514, 900002503, current_date + 5,  current_date + 10, 'new', 'Guest 4', 2),
  (900002515, 900002503, current_date + 12, current_date + 14, 'new', 'Guest 5', 2),
  (900002516, 900002504, current_date + 5,  current_date + 10, 'new', 'Guest 6', 2),
  (900002517, 900002505, current_date + 5,  current_date + 10, 'new', 'Guest 7', 2),
  (900002518, 900002506, current_date + 5,  current_date + 10, 'new', 'Guest 8', 2),
  (900002519, 900002507, current_date + 5,  current_date + 10, 'new', 'Guest 9', 2),
  (900002520, 900002508, current_date - 2,  current_date + 3,  'new', 'Guest 10', 2),
  (900002521, 900002509, current_date + 5,  current_date + 10, 'new', 'Guest 11', 2),
  (900002522, 900002510, current_date + 5,  current_date + 10, 'new', 'Guest 12', 2),
  -- The next guest of Check-in facts: arrives the day 12 leaves.
  (900002523, 900002510, current_date + 10, current_date + 12, 'new', 'Guest 13', 3),
  (900002525, 900002511, current_date + 5,  current_date + 10, 'new', 'Guest 15', 2),
  (900002526, 900002511, current_date + 20, current_date + 22, 'new', 'Guest 16', 2),
  (900002527, 900002512, current_date + 5,  current_date + 10, 'new', 'Guest 17', 2),
  (900002528, 900002514, current_date + 5,  current_date + 10, 'new', 'Guest 18', 2),
  -- Into room A of the rooms house on the day 25 leaves it: a turnover of one room.
  (900002530, 900002511, current_date + 10, current_date + 12, 'new', 'Guest 20', 5);

insert into public.reservation_units (reservation_id, property_id) values
  (900002525, public.property_id_for_unit(25101)),
  (900002525, public.property_id_for_unit(25102)),
  (900002526, public.property_id_for_unit(25102)),
  (900002530, public.property_id_for_unit(25101));

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

create or replace function pg_temp.as_boss() returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"d9002502-0000-4000-8000-0000000025e2","role":"authenticated"}', true)
$$;

create or replace function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true)
$$;

-- The live cleaning of a booking (on one property, when asked), else the
-- latest closed one. One transaction has one now(), so rows are told apart
-- by status, not by time.
create or replace function pg_temp.cleaning(res_id bigint, on_property bigint default null)
returns public.tasks language sql as $$
  select t.* from public.tasks t
  where t.reservation_id = res_id and t.type = 'cleaning'
    and (on_property is null or t.property_id = on_property)
  order by (t.status in ('cancelled', 'expired')), t.id
  limit 1
$$;

create or replace function pg_temp.live_cleanings(res_id bigint) returns integer
language sql as $$
  select count(*)::int from public.tasks t
  where t.reservation_id = res_id and t.type = 'cleaning'
    and t.status not in ('cancelled', 'expired')
$$;

create or replace function pg_temp.room(unit integer) returns bigint language sql as $$
  select public.property_id_for_unit(unit)
$$;

create or replace function pg_temp.run() returns jsonb language sql as $$
  select public.generate_cleaning_tasks(current_date, current_date + 60)
$$;

-- The run a webhook makes: its window is the departures of the batch, here
-- the one booking's — not the day its cleaning was moved to.
create or replace function pg_temp.run_for(res_id bigint) returns jsonb language sql as $$
  select public.generate_cleaning_tasks(r.departure_date, r.departure_date)
  from public.reservations r where r.id = res_id
$$;

create or replace function pg_temp.hand_to_maria(task_id uuid, to_status text default 'assigned')
returns void language sql as $$
  update public.tasks
  set assignee_id = 'd9002501-0000-4000-8000-0000000025e1', status = to_status::public.task_status
  where id = task_id
$$;

-- A manager moves a booking's cleaning in the panel. The form sends back
-- every field it shows, so everything but the day goes as it was; it sends
-- no priority (apps/web/src/features/tasks/api.ts, saveTask).
create or replace function pg_temp.move(task_id uuid, day date) returns void
language plpgsql as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = task_id;
  perform pg_temp.as_boss();
  perform public.save_task(v_task.id, v_task.property_id, 'cleaning', day,
    v_task.title, null, v_task.assignee_id, v_task.time_from, v_task.time_to,
    v_task.notes);
  perform pg_temp.as_postgres();
end $$;

select pg_temp.run();

-- ---------- 0. one check-in rule ----------

-- The generator reads the next guest off reservation_cleaning_window, for the
-- departure; save_task and the refresh of moved cleanings off
-- cleaning_turnover_on, for any day. The rule is written twice, so as not to
-- slow the generator's every row by a nested call (20260926160000); asked of
-- the departure, the two must say the same of every booking here.
select pg_temp.check('the generator and a move read one check-in rule',
  (select count(*)::int
   from public.reservations r
   left join public.reservation_units ru on ru.reservation_id = r.id
   join public.properties p on p.id = coalesce(ru.property_id, r.property_id)
   cross join lateral public.reservation_cleaning_window(r.id, p.id) w
   cross join lateral public.cleaning_turnover_on(r.id, p.id, r.departure_date) f
   where r.id between 900002511 and 900002530
     and ((case when w.same_day_turnover then 1 else 0 end) <> f.priority
          or w.guests_count is distinct from f.guests_count
          or (case when w.same_day_turnover and w.window_to is not null
                   then (r.departure_date + w.window_to) at time zone p.timezone end)
             is distinct from f.due_at)), 0);
select pg_temp.check('and the rule is asked something: one room turns over, one does not',
  array[(pg_temp.cleaning(900002525, pg_temp.room(25101))).priority::int,
        (pg_temp.cleaning(900002525, pg_temp.room(25102))).priority::int],
  array[1, 0]);

-- ---------- 1. a manager's move holds; moving back undoes it ----------

select pg_temp.move((pg_temp.cleaning(900002511)).id, current_date + 11);
select pg_temp.check('a moved cleaning remembers the booking''s dates at the move',
  array[(pg_temp.cleaning(900002511)).pinned_arrival, (pg_temp.cleaning(900002511)).pinned_departure],
  array[current_date + 5, current_date + 10]);
select pg_temp.run();
select pg_temp.check('the generator leaves a moved cleaning on its day',
  (pg_temp.cleaning(900002511)).scheduled_date, current_date + 11);
select pg_temp.check('and writes no second cleaning for its booking',
  pg_temp.live_cleanings(900002511), 1);

select pg_temp.move((pg_temp.cleaning(900002511)).id, current_date + 10);
select pg_temp.check('back on the departure day, the move is undone',
  (pg_temp.cleaning(900002511)).pinned_departure, null::date);
select pg_temp.run();
select pg_temp.check('and the generator keeps it there',
  (pg_temp.cleaning(900002511)).scheduled_date, current_date + 10);

-- ---------- 2. a cancelled booking cancels work nobody has started ----------

select pg_temp.hand_to_maria((pg_temp.cleaning(900002512)).id, 'accepted');
select pg_temp.move((pg_temp.cleaning(900002513)).id, current_date + 13);
select pg_temp.hand_to_maria((pg_temp.cleaning(900002513)).id, 'accepted');
update public.reservations set status = 'cancelled' where id in (900002512, 900002513);
select pg_temp.run_for(900002512);
select pg_temp.run_for(900002513);
select pg_temp.check('an accepted cleaning of a cancelled booking is cancelled',
  (pg_temp.cleaning(900002512)).status::text, 'cancelled');
select pg_temp.check('so is a moved one, by the run of its booking''s departure',
  (pg_temp.cleaning(900002513)).status::text, 'cancelled');

-- ---------- 3. work under way is never moved or cancelled ----------

update public.tasks set status = 'in_progress', assignee_id = 'd9002501-0000-4000-8000-0000000025e1',
                        started_at = now()
where id = (pg_temp.cleaning(900002514)).id;
update public.tasks set status = 'paused', assignee_id = 'd9002501-0000-4000-8000-0000000025e1',
                        started_at = now()
where id = (pg_temp.cleaning(900002515)).id;
update public.reservations set departure_date = current_date + 11 where id = 900002514;
select pg_temp.run_for(900002514);
select pg_temp.check('a cleaning in progress stays on its day when its booking moves',
  (pg_temp.cleaning(900002514)).scheduled_date, current_date + 10);
update public.reservations set status = 'cancelled' where id in (900002514, 900002515);
select pg_temp.run();
select pg_temp.check('and outlives its cancelled booking',
  (pg_temp.cleaning(900002514)).status::text, 'in_progress');
select pg_temp.check('and so does a paused one',
  (pg_temp.cleaning(900002515)).status::text, 'paused');

-- ---------- 4. the cleaning follows its booking, with its cleaner ----------

select pg_temp.hand_to_maria((pg_temp.cleaning(900002516)).id, 'accepted');
update public.reservations set departure_date = current_date + 11 where id = 900002516;
select pg_temp.run_for(900002516);
select pg_temp.check('an accepted cleaning moves with its booking',
  (pg_temp.cleaning(900002516)).scheduled_date, current_date + 11);
select pg_temp.check('back to «assigned», for the new day',
  (pg_temp.cleaning(900002516)).status::text, 'assigned');
select pg_temp.check('still hers',
  (pg_temp.cleaning(900002516)).assignee_id, 'd9002501-0000-4000-8000-0000000025e1'::uuid);

-- ---------- 5. a moved cleaning holds until the booking changes ----------

select pg_temp.hand_to_maria((pg_temp.cleaning(900002517)).id);
select pg_temp.move((pg_temp.cleaning(900002517)).id, current_date + 9);
-- The window the generator would write moves to 11:00; the booking itself
-- is the same, so the move holds and the window is the manager's.
update public.properties set check_out_time = '11:00' where id = 900002505;
select pg_temp.run();
select pg_temp.check('a moved cleaning''s window is not rewritten under it',
  (pg_temp.cleaning(900002517)).time_from, '10:00'::time);
select pg_temp.check('nor its day',
  (pg_temp.cleaning(900002517)).scheduled_date, current_date + 9);

-- The guest stays two nights longer: the booking changed.
update public.reservations set departure_date = current_date + 12 where id = 900002517;
select pg_temp.run_for(900002517);
select pg_temp.check('a lengthened booking undoes the move',
  (pg_temp.cleaning(900002517)).pinned_departure, null::date);
select pg_temp.check('and takes its cleaning to the new departure',
  (pg_temp.cleaning(900002517)).scheduled_date, current_date + 12);
select pg_temp.check('with the window of that departure',
  (pg_temp.cleaning(900002517)).time_from, '11:00'::time);
select pg_temp.check('and the same cleaner',
  (pg_temp.cleaning(900002517)).assignee_id, 'd9002501-0000-4000-8000-0000000025e1'::uuid);

-- Only the arrival changes: still a change of the booking's dates.
select pg_temp.move((pg_temp.cleaning(900002518)).id, current_date + 9);
update public.reservations set arrival_date = current_date + 4 where id = 900002518;
select pg_temp.run();
select pg_temp.check('a new arrival date undoes the move too',
  (pg_temp.cleaning(900002518)).scheduled_date, current_date + 10);
select pg_temp.check('and leaves nothing pinned',
  (pg_temp.cleaning(900002518)).pinned_arrival, null::date);

-- ---------- 6. beyond the night's window, it follows all the same ----------

-- The departure moves past the 60 days a run looks at. The cleaning still
-- stands on a day the run sees, and that is how the run finds the booking.
select pg_temp.hand_to_maria((pg_temp.cleaning(900002521)).id);
select pg_temp.move((pg_temp.cleaning(900002521)).id, current_date + 9);
update public.reservations set departure_date = current_date + 90 where id = 900002521;
select pg_temp.hand_to_maria((pg_temp.cleaning(900002528)).id);
update public.reservations set departure_date = current_date + 95 where id = 900002528;
select pg_temp.run();
select pg_temp.check('a moved cleaning follows a booking that leaves the window',
  (pg_temp.cleaning(900002521)).scheduled_date, current_date + 90);
select pg_temp.check('an untouched one too, rather than being cancelled',
  (pg_temp.cleaning(900002528)).scheduled_date, current_date + 95);
select pg_temp.check('still hers, and still one',
  array[(pg_temp.cleaning(900002528)).assignee_id::text, pg_temp.live_cleanings(900002528)::text],
  array['d9002501-0000-4000-8000-0000000025e1', '1']);

-- ---------- 7. another room: the cleaning goes with the guest ----------

-- 25 took rooms A and B; Hostaway moves B's guest to room C.
select pg_temp.hand_to_maria((pg_temp.cleaning(900002525, pg_temp.room(25102))).id);
select pg_temp.move((pg_temp.cleaning(900002525, pg_temp.room(25102))).id, current_date + 11);
update public.reservation_units set property_id = pg_temp.room(25103)
where reservation_id = 900002525 and property_id = pg_temp.room(25102);
select pg_temp.run_for(900002525);
select pg_temp.check('the cleaning moves to the room the guest was moved to',
  (pg_temp.cleaning(900002525, pg_temp.room(25103))).assignee_id,
  'd9002501-0000-4000-8000-0000000025e1'::uuid);
select pg_temp.check('the same row, not a new one: nothing is left on the old room',
  (select count(*)::int from public.tasks
   where reservation_id = 900002525 and property_id = pg_temp.room(25102)), 0);
select pg_temp.check('a new room undoes the manager''s move',
  (pg_temp.cleaning(900002525, pg_temp.room(25103))).scheduled_date, current_date + 10);
select pg_temp.check('room A is untouched, and the booking still owes two',
  pg_temp.live_cleanings(900002525), 2);

-- The booking gives room A up: its cleaning goes, room C's stays.
delete from public.reservation_units
where reservation_id = 900002525 and property_id = pg_temp.room(25101);
select pg_temp.run_for(900002525);
select pg_temp.check('a room the booking gave up loses its cleaning',
  (pg_temp.cleaning(900002525, pg_temp.room(25101))).status::text, 'cancelled');
select pg_temp.check('the room it kept does not',
  pg_temp.live_cleanings(900002525), 1);

-- 26 names room B, then no room at all: the listing is what gets cleaned.
select pg_temp.hand_to_maria((pg_temp.cleaning(900002526)).id);
delete from public.reservation_units where reservation_id = 900002526;
select pg_temp.run_for(900002526);
select pg_temp.check('a booking that drops its room takes its cleaning to the listing',
  (pg_temp.cleaning(900002526)).property_id, 900002511::bigint);
select pg_temp.check('with its cleaner',
  (pg_temp.cleaning(900002526)).assignee_id, 'd9002501-0000-4000-8000-0000000025e1'::uuid);

-- ---------- 8. another listing: a new cleaning there ----------

-- A booking moved to another flat is served by that flat's own rule (its
-- regular cleaner, if it has one); the old flat's cleaning is called off.
select pg_temp.hand_to_maria((pg_temp.cleaning(900002527)).id);
update public.reservations set property_id = 900002513 where id = 900002527;
select pg_temp.run_for(900002527);
select pg_temp.check('the old flat''s cleaning is cancelled',
  (pg_temp.cleaning(900002527, 900002512)).status::text, 'cancelled');
select pg_temp.check('and the new flat gets one of its own',
  (pg_temp.cleaning(900002527, 900002513)).status::text, 'unassigned');

-- ---------- 9. what the phone says about check-in is true of the day ----------

select pg_temp.check('before a move, the cleaning is a same-day turnover',
  array[(pg_temp.cleaning(900002522)).priority::int, (pg_temp.cleaning(900002522)).guests_count::int],
  array[1, 3]);
select pg_temp.move((pg_temp.cleaning(900002522)).id, current_date + 11);
select pg_temp.check('moved to a day nobody arrives on, it is not urgent',
  (pg_temp.cleaning(900002522)).priority::int, 0);
select pg_temp.check('and has no check-in deadline',
  (pg_temp.cleaning(900002522)).due_at, null::timestamptz);

-- A guest books into that very day after the move.
insert into public.reservations (id, property_id, arrival_date, departure_date, status,
                                 guest_name, guests_count)
values (900002524, 900002510, current_date + 11, current_date + 13, 'new', 'Guest 14', 4);
select pg_temp.run_for(900002524);
select pg_temp.check('a guest arriving on the moved day makes it urgent again',
  (pg_temp.cleaning(900002522)).priority::int, 1);
select pg_temp.check('with the deadline of that arrival',
  (pg_temp.cleaning(900002522)).due_at, ((current_date + 11) + time '15:00') at time zone 'UTC');
select pg_temp.check('and that guest''s party',
  (pg_temp.cleaning(900002522)).guests_count::int, 4);
select pg_temp.check('while the move itself holds',
  (pg_temp.cleaning(900002522)).scheduled_date, current_date + 11);

update public.reservations set status = 'cancelled' where id = 900002524;
select pg_temp.run_for(900002524);
select pg_temp.check('and not once that guest cancels',
  (pg_temp.cleaning(900002522)).priority::int, 0);

-- ---------- 10. a hand-made cleaning on a departure day asks first ----------

select pg_temp.as_boss();
select pg_temp.check('a cleaning by hand on the day of a booking''s cleaning is a question',
  pg_temp.refusal($sql$select public.save_task(
    'c9002507-0000-4000-8000-000000000001'::uuid, 900002507, 'cleaning',
    current_date + 10)$sql$),
  'serverErrors.taskDuplicate');
select public.save_task('c9002507-0000-4000-8000-000000000001'::uuid, 900002507, 'cleaning',
  current_date + 10, null, null, null, null, null, null, null, true);
select pg_temp.check('an edit that keeps its day asks nothing again',
  pg_temp.refusal($sql$select public.save_task(
    'c9002507-0000-4000-8000-000000000001'::uuid, 900002507, 'cleaning',
    current_date + 10, 'Deep clean')$sql$),
  'no refusal');
-- Nor does an edit of the booking's side of the pair: handing it to a cleaner.
select pg_temp.check('nor an edit of the booking''s cleaning that keeps its day',
  pg_temp.refusal(format($sql$select public.save_task(%L::uuid, 900002507, 'cleaning',
    current_date + 10, null, null, 'd9002501-0000-4000-8000-0000000025e1'::uuid)$sql$,
    (pg_temp.cleaning(900002519)).id)),
  'no refusal');
select public.save_task('c9002507-0000-4000-8000-000000000002'::uuid, 900002507, 'inspection',
  current_date + 10);
-- An inspection that becomes a cleaning lands on the day as a cleaning.
select pg_temp.check('a second inspection that day, confirmed, saves',
  pg_temp.refusal($sql$select public.save_task(
    'c9002507-0000-4000-8000-000000000003'::uuid, 900002507, 'inspection',
    current_date + 10, null, null, null, null, null, null, null, true)$sql$),
  'no refusal');
select pg_temp.check('turned into a cleaning on that day, it is asked about',
  pg_temp.refusal($sql$select public.save_task(
    'c9002507-0000-4000-8000-000000000003'::uuid, 900002507, 'cleaning',
    current_date + 10)$sql$),
  'serverErrors.taskDuplicate');
select pg_temp.as_postgres();
select pg_temp.check('another kind of job that day asks nothing',
  (select type::text from public.tasks where id = 'c9002507-0000-4000-8000-000000000002'),
  'inspection');
select pg_temp.check('a task written by hand is never pinned',
  (select pinned_departure from public.tasks where id = 'c9002507-0000-4000-8000-000000000001'),
  null::date);

-- ---------- 11. a moved cleaning that never happened ----------

-- Moved to a day before the departure, never closed, swept: the day the
-- booking's cleaning was tried is the moved one, and its departure is not
-- tried again — the rule an unmoved cleaning already keeps on its own day.
select pg_temp.move((pg_temp.cleaning(900002520)).id, current_date - 3);
update public.tasks set status = 'expired' where id = (pg_temp.cleaning(900002520)).id;
select pg_temp.run_for(900002520);
select pg_temp.run();
select pg_temp.check('a moved cleaning that never happened is not written again on the departure',
  pg_temp.live_cleanings(900002520), 0);

update public.reservations set departure_date = current_date + 5 where id = 900002520;
select pg_temp.run_for(900002520);
select pg_temp.check('a booking that changes after it is owed a cleaning on its new day',
  (select scheduled_date from public.tasks
   where reservation_id = 900002520 and status not in ('cancelled', 'expired')),
  current_date + 5);

-- ---------- 12. an executor cannot move or undo a move ----------

-- As postgres, so row level security stays out of the way: what is tested is
-- the field guard, which reads the caller from the claims.
select set_config('request.jwt.claims',
  '{"sub":"d9002501-0000-4000-8000-0000000025e1","role":"authenticated"}', true);
update public.tasks set pinned_departure = current_date, pinned_arrival = current_date
where id = (pg_temp.cleaning(900002516)).id;
select pg_temp.as_postgres();
select pg_temp.check('the cleaner''s own change of the pin is undone',
  array[(pg_temp.cleaning(900002516)).pinned_arrival, (pg_temp.cleaning(900002516)).pinned_departure],
  array[null::date, null::date]);

rollback;
