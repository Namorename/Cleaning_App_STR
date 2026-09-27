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
-- And from the owner's word of 2026-09-27, carried by the migration after it:
-- any change of a booking's rooms undoes the move of every cleaning of that
-- booking, not only the one whose room changed; the window of a booking's
-- cleaning is the server's, whatever times a save sends; after the stay the
-- rule is the same, a departure corrected to yesterday included; and when a
-- booking keeps fewer places than it has cleanings, the one somebody holds is
-- kept.
--
-- Every case has its own property; ids 9000025xx, rooms 251xx and 252xx. Days
-- are counted from today.
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
  (900002514, 'Far move, untouched',   'UTC', '15:00', '10:00'),
  (900002516, 'Midnight check-in',     'UTC', '15:00', '10:00'),
  (900002517, 'Office arrives',        'UTC', '15:00', '10:00'),
  (900002518, 'Form left open',        'UTC', '15:00', '10:00'),
  (900002519, 'Arrival after expiry',  'UTC', '15:00', '10:00');

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
  (900002530, 900002511, current_date + 10, current_date + 12, 'new', 'Guest 20', 5),
  (900002531, 900002516, current_date + 5,  current_date + 10, 'new', 'Guest 21', 2),
  -- Hostaway's "no hour" is 00:00: the listing's check-in stands for it.
  (900002532, 900002516, current_date + 10, current_date + 12, 'new', 'Guest 22', 2),
  (900002533, 900002517, current_date + 5,  current_date + 10, 'new', 'Guest 23', 2),
  -- The office's own work arriving is no guest: no turnover.
  (900002534, 900002517, current_date + 10, current_date + 12, 'new', '#Painter', 2),
  (900002535, 900002518, current_date + 5,  current_date + 10, 'new', 'Guest 25', 2),
  (900002536, 900002519, current_date - 2,  current_date + 3,  'new', 'Guest 26', 2);

update public.reservations set check_in_time = '16:00' where id = 900002523;
update public.reservations set check_in_time = '00:00' where id = 900002532;

insert into public.reservation_units (reservation_id, property_id) values
  (900002525, public.property_id_for_unit(25101)),
  (900002525, public.property_id_for_unit(25102)),
  (900002526, public.property_id_for_unit(25102)),
  (900002530, public.property_id_for_unit(25101));

-- The houses of section 14, one per change of rooms, and the listing of 15.
insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900002520, 'Rooms swapped',            'UTC', '15:00', '10:00'),
  (900002521, 'Room added',               'UTC', '15:00', '10:00'),
  (900002522, 'Room given up',            'UTC', '15:00', '10:00'),
  (900002523, 'Rooms back as they were',  'UTC', '15:00', '10:00'),
  (900002524, 'Rooms change after expiry','UTC', '15:00', '10:00'),
  (900002525, 'Window is the server''s',  'UTC', '15:00', '10:00'),
  (900002526, 'Swap past an expired room','UTC', '15:00', '10:00'),
  (900002527, 'Left early, told late',    'UTC', '15:00', '10:00'),
  (900002528, 'Rooms fixed after stay',   'UTC', '15:00', '10:00'),
  (900002529, 'Rooms all dropped',        'UTC', '15:00', '10:00'),
  (900002530, 'Two rooms become one',     'UTC', '15:00', '10:00');

insert into public.properties (id, hostaway_unit_id, parent_id, name,
                               timezone, check_in_time, check_out_time)
select public.property_id_for_unit(u.unit), u.unit, u.listing, 'Room ' || u.unit,
       'UTC', '15:00', '10:00'
from (values (25201, 900002520), (25202, 900002520), (25203, 900002520),
             (25211, 900002521), (25212, 900002521), (25213, 900002521),
             (25221, 900002522), (25222, 900002522),
             (25231, 900002523), (25232, 900002523), (25233, 900002523),
             (25241, 900002524), (25242, 900002524), (25243, 900002524),
             (25261, 900002526), (25262, 900002526), (25263, 900002526),
             (25281, 900002528), (25282, 900002528), (25283, 900002528),
             (25291, 900002529), (25292, 900002529),
             (25301, 900002530), (25302, 900002530), (25303, 900002530)) u(unit, listing);

insert into public.reservations (id, property_id, arrival_date, departure_date, status,
                                 guest_name, guests_count)
values
  (900002540, 900002520, current_date + 5,  current_date + 10, 'new', 'Guest 40', 2),
  (900002541, 900002521, current_date + 5,  current_date + 10, 'new', 'Guest 41', 2),
  (900002542, 900002522, current_date + 5,  current_date + 10, 'new', 'Guest 42', 2),
  (900002543, 900002523, current_date + 5,  current_date + 10, 'new', 'Guest 43', 2),
  (900002544, 900002524, current_date - 2,  current_date + 3,  'new', 'Guest 44', 2),
  (900002545, 900002525, current_date + 5,  current_date + 10, 'new', 'Guest 45', 2),
  (900002546, 900002526, current_date - 2,  current_date + 3,  'new', 'Guest 46', 2),
  -- Section 16.
  (900002547, 900002527, current_date - 3,  current_date + 2,  'new', 'Guest 47', 2),
  (900002548, 900002528, current_date - 4,  current_date - 1,  'new', 'Guest 48', 2),
  (900002549, 900002529, current_date + 5,  current_date + 10, 'new', 'Guest 49', 2),
  (900002550, 900002530, current_date + 5,  current_date + 10, 'new', 'Guest 50', 2);

insert into public.reservation_units (reservation_id, property_id) values
  (900002540, public.property_id_for_unit(25201)),
  (900002540, public.property_id_for_unit(25202)),
  (900002541, public.property_id_for_unit(25211)),
  (900002541, public.property_id_for_unit(25212)),
  (900002542, public.property_id_for_unit(25221)),
  (900002542, public.property_id_for_unit(25222)),
  (900002543, public.property_id_for_unit(25231)),
  (900002543, public.property_id_for_unit(25232)),
  (900002544, public.property_id_for_unit(25241)),
  (900002544, public.property_id_for_unit(25242)),
  (900002546, public.property_id_for_unit(25261)),
  (900002546, public.property_id_for_unit(25262)),
  (900002548, public.property_id_for_unit(25281)),
  (900002548, public.property_id_for_unit(25282)),
  (900002549, public.property_id_for_unit(25291)),
  (900002549, public.property_id_for_unit(25292)),
  (900002550, public.property_id_for_unit(25301)),
  (900002550, public.property_id_for_unit(25302));

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
-- no priority (apps/web/src/features/tasks/api.ts, saveTask), and — the
-- panel of this migration — the day it was opened with.
create or replace function pg_temp.move(task_id uuid, day date) returns void
language plpgsql as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = task_id;
  perform pg_temp.as_boss();
  perform public.save_task(v_task.id, v_task.property_id, 'cleaning', day,
    v_task.title, null, v_task.assignee_id, v_task.time_from, v_task.time_to,
    v_task.notes, null, false, v_task.scheduled_date);
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
   where r.id between 900002511 and 900002559
     and ((case when w.same_day_turnover then 1 else 0 end) <> f.priority
          or w.guests_count is distinct from f.guests_count
          or w.window_to is distinct from f.window_to
          or w.window_from is distinct from f.window_from
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

-- The panel before this migration sends no p_expected_date: its save says
-- nothing about a move, so none is recorded — as before, the booking's day
-- comes back on the next run. A form left open while the booking moved
-- cannot pin the old day this way.
select pg_temp.as_boss();
select public.save_task((pg_temp.cleaning(900002511)).id, 900002501, 'cleaning',
  current_date + 12);
select pg_temp.as_postgres();
select pg_temp.check('a save from the old panel records no move',
  (pg_temp.cleaning(900002511)).pinned_departure, null::date);
select pg_temp.run();
select pg_temp.check('and the booking takes its cleaning back',
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
-- The listing's check-out moves to 11:00. The booking itself is the same, so
-- the move holds; the window of a booking's cleaning is the server's, moved
-- or not, and follows the listing on the moved day.
update public.properties set check_out_time = '11:00' where id = 900002505;
select pg_temp.run();
select pg_temp.check('a moved cleaning''s window follows the listing''s hours',
  (pg_temp.cleaning(900002517)).time_from, '11:00'::time);
select pg_temp.check('while its day holds',
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
select pg_temp.check('its window ends at the next guest''s hour',
  (pg_temp.cleaning(900002522)).time_to, '16:00'::time);
select pg_temp.move((pg_temp.cleaning(900002522)).id, current_date + 11);
select pg_temp.check('moved to a day nobody arrives on, it is not urgent',
  (pg_temp.cleaning(900002522)).priority::int, 0);
select pg_temp.check('and has no check-in deadline',
  (pg_temp.cleaning(900002522)).due_at, null::timestamptz);
select pg_temp.check('its window ends at the listing''s check-in, not the old guest''s',
  (pg_temp.cleaning(900002522)).time_to, '15:00'::time);
select pg_temp.check('and starts at the listing''s check-out: nobody leaves that day',
  (pg_temp.cleaning(900002522)).time_from, '10:00'::time);

-- A guest books into that very day after the move.
insert into public.reservations (id, property_id, arrival_date, departure_date, status,
                                 guest_name, guests_count)
values (900002524, 900002510, current_date + 11, current_date + 13, 'new', 'Guest 14', 4);
update public.reservations set check_in_time = '17:30' where id = 900002524;
select pg_temp.run_for(900002524);
select pg_temp.check('a guest arriving on the moved day makes it urgent again',
  (pg_temp.cleaning(900002522)).priority::int, 1);
select pg_temp.check('with the deadline of that arrival',
  (pg_temp.cleaning(900002522)).due_at, ((current_date + 11) + time '17:30') at time zone 'UTC');
select pg_temp.check('and a window ending at that hour',
  (pg_temp.cleaning(900002522)).time_to, '17:30'::time);
select pg_temp.check('and that guest''s party',
  (pg_temp.cleaning(900002522)).guests_count::int, 4);
select pg_temp.check('while the move itself holds',
  (pg_temp.cleaning(900002522)).scheduled_date, current_date + 11);

update public.reservations set status = 'cancelled' where id = 900002524;
select pg_temp.run_for(900002524);
select pg_temp.check('and not once that guest cancels',
  array[(pg_temp.cleaning(900002522)).priority::int::text,
        (pg_temp.cleaning(900002522)).time_to::text],
  array['0', '15:00:00']);

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
-- Only the arrival changes after it expired: the move is void all the same,
-- and the departure itself was never tried.
select pg_temp.move((pg_temp.cleaning(900002536)).id, current_date - 3);
update public.tasks set status = 'expired' where id = (pg_temp.cleaning(900002536)).id;
update public.reservations set arrival_date = current_date - 1 where id = 900002536;
select pg_temp.run_for(900002536);
select pg_temp.check('a new arrival after it expired brings the cleaning back on the departure',
  (select scheduled_date from public.tasks
   where reservation_id = 900002536 and status not in ('cancelled', 'expired')),
  current_date + 3);

select pg_temp.check('a booking that changes after it is owed a cleaning on its new day',
  (select scheduled_date from public.tasks
   where reservation_id = 900002520 and status not in ('cancelled', 'expired')),
  current_date + 5);

-- ---------- 13. a form left open while the booking moved ----------

-- The form opened with the cleaning on +10; the booking then moved to +11
-- and took the cleaning along. The form still says +10.
update public.reservations set departure_date = current_date + 11 where id = 900002535;
select pg_temp.run_for(900002535);
select pg_temp.as_boss();
select pg_temp.check('a form opened before the cleaning moved is told so, not obeyed',
  pg_temp.refusal(format($sql$select public.save_task(%L::uuid, 900002518, 'cleaning',
    current_date + 10, null, null, null, null, null, null, null, false,
    current_date + 10)$sql$, (pg_temp.cleaning(900002535)).id)),
  'serverErrors.taskMovedMeanwhile');
select pg_temp.check('a form opened on the day it stands on moves it',
  pg_temp.refusal(format($sql$select public.save_task(%L::uuid, 900002518, 'cleaning',
    current_date + 12, null, null, null, null, null, null, null, false,
    current_date + 11)$sql$, (pg_temp.cleaning(900002535)).id)),
  'no refusal');
select pg_temp.as_postgres();
select pg_temp.check('and the move holds against the booking as it now is',
  array[(pg_temp.cleaning(900002535)).scheduled_date, (pg_temp.cleaning(900002535)).pinned_departure],
  array[current_date + 12, current_date + 11]);
-- The answer to that save is lost, and the manager presses Save again: the
-- same form, opened on +11, sends +12 — the day the cleaning now stands on.
-- It lands where the row is, so nothing was moved under the form
-- (20260927120000).
select pg_temp.as_boss();
select pg_temp.check('a save replayed onto the day it already stands on is no stale form',
  pg_temp.refusal(format($sql$select public.save_task(%L::uuid, 900002518, 'cleaning',
    current_date + 12, null, null, null, null, null, null, null, false,
    current_date + 11)$sql$, (pg_temp.cleaning(900002535)).id)),
  'no refusal');
select pg_temp.as_postgres();
select pg_temp.check('and leaves the move as it was',
  array[(pg_temp.cleaning(900002535)).scheduled_date, (pg_temp.cleaning(900002535)).pinned_departure],
  array[current_date + 12, current_date + 11]);

-- ---------- 12. an executor cannot move or undo a move ----------

-- As postgres, so row level security stays out of the way: what is tested is
-- the field guard, which reads the caller from the claims.
select set_config('request.jwt.claims',
  '{"sub":"d9002501-0000-4000-8000-0000000025e1","role":"authenticated"}', true);
update public.tasks set pinned_departure = current_date, pinned_arrival = current_date,
                        pinned_rooms = '{}'
where id = (pg_temp.cleaning(900002516)).id;
select pg_temp.as_postgres();
select pg_temp.check('the cleaner''s own change of the pin is undone',
  array[(pg_temp.cleaning(900002516)).pinned_arrival, (pg_temp.cleaning(900002516)).pinned_departure],
  array[null::date, null::date]);
select pg_temp.check('the rooms of the pin with it',
  (pg_temp.cleaning(900002516)).pinned_rooms, null::bigint[]);

-- ---------- 14. any change of a booking's rooms undoes every move ----------

-- The owner's word of 2026-09-27: a booking of several rooms that changes any
-- of them has changed, and every cleaning of it follows it again — not only
-- the one whose room changed, which is all 20260926160000 undid.

-- 40 took rooms A and B; the manager moves A's cleaning.
select pg_temp.move((pg_temp.cleaning(900002540, pg_temp.room(25201))).id, current_date + 11);
select pg_temp.check('a move remembers the booking''s rooms, in order',
  (pg_temp.cleaning(900002540, pg_temp.room(25201))).pinned_rooms,
  array[pg_temp.room(25201), pg_temp.room(25202)]);
select pg_temp.run();
select pg_temp.check('the move holds while the rooms stay',
  (pg_temp.cleaning(900002540, pg_temp.room(25201))).scheduled_date, current_date + 11);
-- Hostaway moves B's guest to room C.
update public.reservation_units set property_id = pg_temp.room(25203)
where reservation_id = 900002540 and property_id = pg_temp.room(25202);
select pg_temp.run_for(900002540);
select pg_temp.check('another room of the booking changing undoes the move of this one',
  (pg_temp.cleaning(900002540, pg_temp.room(25201))).pinned_departure, null::date);
select pg_temp.check('and takes its cleaning back to the departure',
  (pg_temp.cleaning(900002540, pg_temp.room(25201))).scheduled_date, current_date + 10);
select pg_temp.check('nothing of the pin is left on it',
  (pg_temp.cleaning(900002540, pg_temp.room(25201))).pinned_rooms, null::bigint[]);
select pg_temp.check('while the changed room''s cleaning went with its guest',
  (pg_temp.cleaning(900002540, pg_temp.room(25203))).scheduled_date, current_date + 10);

-- 41 took A and B; A's cleaning is moved; the booking takes room C as well.
select pg_temp.move((pg_temp.cleaning(900002541, pg_temp.room(25211))).id, current_date + 11);
insert into public.reservation_units (reservation_id, property_id)
values (900002541, pg_temp.room(25213));
select pg_temp.run_for(900002541);
select pg_temp.check('a room added to the booking undoes the move',
  array[(pg_temp.cleaning(900002541, pg_temp.room(25211))).scheduled_date::text,
        coalesce((pg_temp.cleaning(900002541, pg_temp.room(25211))).pinned_departure::text, '-')],
  array[(current_date + 10)::text, '-']);
select pg_temp.check('and the new room is owed its own cleaning',
  pg_temp.live_cleanings(900002541), 3);

-- 42 took A and B; A's cleaning is moved; the booking gives B up.
select pg_temp.move((pg_temp.cleaning(900002542, pg_temp.room(25221))).id, current_date + 11);
delete from public.reservation_units
where reservation_id = 900002542 and property_id = pg_temp.room(25222);
select pg_temp.run_for(900002542);
select pg_temp.check('a room given up undoes the move of the room kept',
  array[(pg_temp.cleaning(900002542, pg_temp.room(25221))).scheduled_date::text,
        coalesce((pg_temp.cleaning(900002542, pg_temp.room(25221))).pinned_departure::text, '-')],
  array[(current_date + 10)::text, '-']);
select pg_temp.check('and the room given up loses its cleaning',
  (pg_temp.cleaning(900002542, pg_temp.room(25222))).status::text, 'cancelled');

-- 43 took A and B; A's cleaning is moved. B goes to C and back before any
-- run, and the sync rewrites the same two rooms: nothing changed.
select pg_temp.move((pg_temp.cleaning(900002543, pg_temp.room(25231))).id, current_date + 11);
update public.reservation_units set property_id = pg_temp.room(25233)
where reservation_id = 900002543 and property_id = pg_temp.room(25232);
update public.reservation_units set property_id = pg_temp.room(25232)
where reservation_id = 900002543 and property_id = pg_temp.room(25233);
delete from public.reservation_units where reservation_id = 900002543;
insert into public.reservation_units (reservation_id, property_id) values
  (900002543, pg_temp.room(25232)), (900002543, pg_temp.room(25231));
select pg_temp.run_for(900002543);
select pg_temp.run();
select pg_temp.check('rooms changed and changed back before a run are no change',
  array[(pg_temp.cleaning(900002543, pg_temp.room(25231))).scheduled_date,
        (pg_temp.cleaning(900002543, pg_temp.room(25231))).pinned_departure],
  array[current_date + 11, current_date + 10]);

-- 44 took A and B; A's cleaning is moved before the departure and never
-- happens. While the rooms stay, the moved day is the booking's tried day for
-- A (section 11); once the rooms change, the move is void, and A's departure
-- was never tried.
select pg_temp.move((pg_temp.cleaning(900002544, pg_temp.room(25241))).id, current_date - 3);
update public.tasks set status = 'expired'
where id = (pg_temp.cleaning(900002544, pg_temp.room(25241))).id;
select pg_temp.run_for(900002544);
select pg_temp.run();
select pg_temp.check('an expired move holds A''s departure while the rooms stay',
  (select count(*)::int from public.tasks
   where reservation_id = 900002544 and property_id = pg_temp.room(25241)
     and status not in ('cancelled', 'expired')), 0);
-- A room is added rather than swapped: a swap would hand B's live cleaning
-- to A, whose place stands open, and prove nothing about the stopper.
insert into public.reservation_units (reservation_id, property_id)
values (900002544, pg_temp.room(25243));
select pg_temp.run_for(900002544);
select pg_temp.check('a change of rooms after it expired brings A''s cleaning back on the departure',
  (select scheduled_date from public.tasks
   where reservation_id = 900002544 and property_id = pg_temp.room(25241)
     and status not in ('cancelled', 'expired')),
  current_date + 3);

-- 46 took A and B; B's cleaning is Maria's; A's was moved before the
-- departure and never happened. Then Hostaway moves B's guest to C. A's place
-- stands open (its cleaning expired) and so does C's: the guest went to C, and
-- Maria's cleaning goes with her there — not to A, the lower room — while A,
-- its move void, is owed a cleaning of its own (20260927120000).
select pg_temp.hand_to_maria((pg_temp.cleaning(900002546, pg_temp.room(25262))).id);
select pg_temp.move((pg_temp.cleaning(900002546, pg_temp.room(25261))).id, current_date - 1);
update public.tasks set status = 'expired'
where id = (pg_temp.cleaning(900002546, pg_temp.room(25261))).id;
update public.reservation_units set property_id = pg_temp.room(25263)
where reservation_id = 900002546 and property_id = pg_temp.room(25262);
select pg_temp.run_for(900002546);
select pg_temp.check('a swapped room''s cleaning follows its guest past a room whose cleaning expired',
  (pg_temp.cleaning(900002546, pg_temp.room(25263))).assignee_id,
  'd9002501-0000-4000-8000-0000000025e1'::uuid);
select pg_temp.check('and the room whose move is void is owed its own, on the departure',
  (select array[count(*)::text, min(scheduled_date)::text] from public.tasks
   where reservation_id = 900002546 and property_id = pg_temp.room(25261)
     and status not in ('cancelled', 'expired')),
  array['1', (current_date + 3)::text]);

-- A pin is whole: rooms without the dates of a move are refused (a check
-- constraint says so with an empty hint).
select pg_temp.check('rooms without the dates of a move are refused',
  pg_temp.refusal(format($sql$update public.tasks set pinned_rooms = '{}' where id = %L$sql$,
    (pg_temp.cleaning(900002545)).id)),
  '');

-- ---------- 15. the window of a booking's cleaning is the server's ----------

-- The generator writes it on every unmoved cleaning and a move writes it for
-- the new day (20260926160000); a save that keeps the day and sends other
-- times — a form opened before a guest booked into the day, or the panel
-- before the times went read-only — does not overwrite it.
select pg_temp.as_boss();
select public.save_task((pg_temp.cleaning(900002545)).id, 900002525, 'cleaning',
  current_date + 10, null, null, null, '08:00', '09:00', null, null, false, current_date + 10);
select pg_temp.as_postgres();
select pg_temp.check('a save that keeps the day keeps the server''s window',
  array[(pg_temp.cleaning(900002545)).time_from, (pg_temp.cleaning(900002545)).time_to],
  array['10:00'::time, '15:00'::time]);
select pg_temp.as_boss();
select public.save_task((pg_temp.cleaning(900002545)).id, 900002525, 'cleaning',
  current_date + 10, null, null, null, '07:00', '07:30');
select pg_temp.as_postgres();
select pg_temp.check('so does a save from the panel that sends no day',
  array[(pg_temp.cleaning(900002545)).time_from, (pg_temp.cleaning(900002545)).time_to],
  array['10:00'::time, '15:00'::time]);
select pg_temp.as_boss();
select public.save_task('c9002525-0000-4000-8000-000000000001'::uuid, 900002525, 'maintenance',
  current_date + 3, null, null, 'd9002501-0000-4000-8000-0000000025e1'::uuid, '08:00', '09:00');
select pg_temp.as_postgres();
select pg_temp.check('a task written by hand keeps the times the manager gives it',
  (select array[time_from, time_to] from public.tasks
   where id = 'c9002525-0000-4000-8000-000000000001'),
  array['08:00'::time, '09:00'::time]);

-- ---------- 16. after the stay the rule is the same; a cleaner's cleaning is kept ----------

-- The owner's word of 2026-09-27: no rule of its own after the departure.
-- The cleaning follows its booking there too — a departure corrected after
-- the fact takes it to the new day, yesterday included: yesterday's cleaning
-- is still to be seen and done today, and the sweep closes it only a day
-- later.

-- 47 was to leave the day after tomorrow; Hostaway learns today that the
-- guest left yesterday.
select pg_temp.hand_to_maria((pg_temp.cleaning(900002547)).id);
update public.reservations set departure_date = current_date - 1 where id = 900002547;
select pg_temp.run_for(900002547);
select pg_temp.check('a departure corrected to yesterday takes the cleaning there, still live and hers',
  array[(pg_temp.cleaning(900002547)).scheduled_date::text,
        (pg_temp.cleaning(900002547)).status::text,
        (pg_temp.cleaning(900002547)).assignee_id::text],
  array[(current_date - 1)::text, 'assigned', 'd9002501-0000-4000-8000-0000000025e1']);
select pg_temp.check('and not yet past its grace',
  public.task_is_stale(900002527, (pg_temp.cleaning(900002547)).scheduled_date), false);

-- 48 left yesterday from rooms A and B; B's cleaning was put on tomorrow.
-- Hostaway then corrects room A to C: a change of the booking, which undoes
-- every move of it, after the stay as before it.
select pg_temp.run_for(900002548);
select pg_temp.move((pg_temp.cleaning(900002548, pg_temp.room(25282))).id, current_date + 1);
update public.reservation_units set property_id = pg_temp.room(25283)
where reservation_id = 900002548 and property_id = pg_temp.room(25281);
select pg_temp.run_for(900002548);
select pg_temp.check('a change of rooms after the stay undoes the move as well',
  array[(pg_temp.cleaning(900002548, pg_temp.room(25282))).scheduled_date::text,
        coalesce((pg_temp.cleaning(900002548, pg_temp.room(25282))).pinned_departure::text, '-')],
  array[(current_date - 1)::text, '-']);

-- 49 took A and B; B's cleaning is Maria's, A's is nobody's. The booking
-- drops both rooms and is cleaned as the listing: one place for two
-- cleanings. The one somebody holds is the one kept (20260927120000); before,
-- the lower room's won, and Maria's was cancelled.
select pg_temp.hand_to_maria((pg_temp.cleaning(900002549, pg_temp.room(25292))).id);
delete from public.reservation_units where reservation_id = 900002549;
select pg_temp.run_for(900002549);
select pg_temp.check('rooms folded into the listing keep the cleaning somebody holds',
  (pg_temp.cleaning(900002549, 900002529)).assignee_id,
  'd9002501-0000-4000-8000-0000000025e1'::uuid);
select pg_temp.check('and the one nobody held is cancelled, one live cleaning left',
  pg_temp.live_cleanings(900002549), 1);

-- 50 took A and B, B's Maria's; both guests are moved into room C.
select pg_temp.hand_to_maria((pg_temp.cleaning(900002550, pg_temp.room(25302))).id);
delete from public.reservation_units where reservation_id = 900002550;
insert into public.reservation_units (reservation_id, property_id)
values (900002550, pg_temp.room(25303));
select pg_temp.run_for(900002550);
select pg_temp.check('two rooms become one: the room keeps the cleaning somebody holds',
  (pg_temp.cleaning(900002550, pg_temp.room(25303))).assignee_id,
  'd9002501-0000-4000-8000-0000000025e1'::uuid);

rollback;
