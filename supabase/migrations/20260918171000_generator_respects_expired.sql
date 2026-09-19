-- The generator stops re-minting a cleaning the sweep has already closed.
--
-- Measured in production on 2026-09-19: 4853 rows of `expired` cleanings
-- standing for 769 real departures -- a multiplier of 6.3, and 3891 of those
-- rows (80% of the table) pure duplicates. 741 of the 769 bookings carried
-- more than one row, the worst of them eleven.
--
-- The loop, in full: the nightly window starts at today-7
-- (supabase/functions/sync-reservations/index.ts, DEFAULT_DAYS_BACK), so every
-- departure of the last week is reconciled again each night. `expired` sits
-- outside the partial unique index and outside the insert's guard, so the
-- generator at 03:15 does not see the row the sweep closed at 03:30 the night
-- before, writes a fresh cleaning for the same departure, and the sweep closes
-- that one too. One new row per booking per night for as long as the departure
-- stays inside the window: roughly 160 rows a night at this account's size,
-- none of them work anybody could do.
--
-- WHAT THE FIX HAS TO PRESERVE. 20260904120100 took `expired` out of the
-- unique index deliberately, and was right: a booking whose first attempt
-- expired and whose departure then moves must get a cleaning for the NEW day,
-- or the departure is lost. So the guard cannot be keyed on the booking -- it
-- has to be keyed on the booking, the property AND the day. Same day: the
-- expired row already answers for it, nothing is owed. Different day: real
-- work, and it is created.
--
-- WHY THE GUARD AND NOT THE INDEX. Widening
-- tasks_one_cleaning_per_reservation to include `expired` was the other
-- candidate and it is wrong twice over. Keyed on (reservation_id,
-- property_id) it forbids the rescheduled departure -- the very regression
-- 20260904120100 removed. Keyed on (reservation_id, property_id,
-- scheduled_date) it forbids something legitimate too: the record of two
-- attempts on one day, one closed unfinished and one live after a booking came
-- back. And either form fails to build on the rows that exist today, because
-- production already holds up to eleven of them per booking -- the index
-- cannot be created until those are cleaned, and cleaning live rows is the
-- owner's call, not a migration's.
--
-- So the rule lives where the decision is made: in the one pass that creates
-- cleanings. Nothing else creates them from a booking, and a task written by
-- hand (save_task) has no reservation_id and never reaches this guard.
--
-- Note what the new branch CANNOT do: suppress future work. A row is only ever
-- `expired` after its day has passed (task_grace_days), so the branch matches
-- past dates only. A cleaning owed tomorrow is created whatever the record of
-- last week says.
--
-- Unchanged from 20260912150000 apart from that one condition.

create or replace function public.generate_cleaning_tasks(from_date date, to_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_relocated   integer;
  v_created     integer;
  v_rescheduled integer;
  v_assigned    integer;
  v_cancelled   integer;
begin
  -- One row per cleaning owed: a booking on an ordinary listing owes one, a
  -- booking that took three rooms owes three. `p` is the thing being cleaned
  -- from here on — the room where there is one, the listing where there is
  -- not — and every column below is read off it.
  create temporary table _wanted on commit drop as
  select
    r.id             as reservation_id,
    p.id             as property_id,
    -- Carried for one reason: a cleaning finished before this migration stands
    -- on the listing and answers for every room at once. See the insert.
    r.property_id    as listing_id,
    r.departure_date as scheduled_date,
    (case when w.same_day_turnover then 1 else 0 end)::smallint as priority,
    w.window_from    as time_from,
    w.window_to      as time_to,
    w.guests_count,
    case
      when w.same_day_turnover and w.window_to is not null
      -- The next guest may arrive at that hour, so that is the hard deadline.
      -- Computed in the property's own timezone: a date is a calendar date
      -- there, not an instant in UTC.
      then (r.departure_date + w.window_to) at time zone p.timezone
    end as due_at,
    -- The regular cleaner: this property's own, the listing above it
    -- otherwise. Each arm matches at most one row — that is exactly what
    -- property_cleaners_one_auto guarantees, and it guarantees it per property,
    -- which is why the arms are a coalesce and not one widened WHERE.
    -- `pc.property_id in (p.id, p.parent_id)` would match both at once for a
    -- room carrying its own auto link under a listing that has one too, and a
    -- scalar subquery returning two rows does not mis-assign a cleaning — it
    -- aborts the whole nightly reconciliation with 21000.
    --
    -- Both arms are keyed off `p` and never off `r.property_id`, though the
    -- join makes those the same value today. `p` is the property being cleaned.
    -- A booking takes its rooms through public.reservation_units, and the
    -- fan-out over them is the next stage; the day this query stops being one
    -- row per booking, the first arm has to follow the room and not the
    -- booking. Keyed off `p` it follows whatever `p` becomes. Keyed off
    -- `r.property_id` it would quietly begin reading the listing in both arms,
    -- leaving the precedence below inert with every test still green.
    --
    -- A room's own 'claim' link does not stop the listing's auto link from
    -- reaching it. Inside a single listing a claim link has never stopped an
    -- auto link either: it puts a colleague in the queue, it does not empty
    -- the queue. Only an auto link answers "whose is this the moment it is
    -- made", so only an auto link on the room itself overrides the listing's.
    coalesce(
      (select pc.cleaner_id
       from public.property_cleaners pc
       where pc.property_id = p.id and pc.mode = 'auto'),
      (select pc.cleaner_id
       from public.property_cleaners pc
       where p.hostaway_unit_id is not null
         and pc.property_id = p.parent_id
         and pc.mode = 'auto')
    ) as auto_cleaner_id
  from public.reservations r
  -- No row in reservation_units means the booking named no rooms, and the
  -- listing itself is what gets cleaned. A left join says exactly that, and
  -- says it without a second branch to keep in step.
  left join public.reservation_units ru on ru.reservation_id = r.id
  join public.properties p on p.id = coalesce(ru.property_id, r.property_id)
  cross join lateral public.reservation_cleaning_window(r.id, p.id) w
  where r.departure_date between from_date and to_date
    and r.status in ('new', 'modified')
    and not r.is_block
    and p.status = 'active';


  -- Move a cleaning that still stands on the listing onto the room the booking
  -- turns out to have taken.
  --
  -- A booking can learn its room after its cleaning exists: Hostaway assigns
  -- the unit later, or a listing grows rooms it did not have. The row on the
  -- listing and the row owed on the room are then the same cleaning under two
  -- names, and moving it keeps its id and with it the cleaner's name, her
  -- photos, her steps and the problems filed against it.
  --
  -- Without this pass the insert below reads the listing row as "already
  -- served" and skips the room, and the cancel pass — which judges by the pair
  -- — then takes that very row away: the booking comes out of the run owing
  -- nothing, and tomorrow's run gives back a stranger with no cleaner on it.
  -- Measured against a copy of production, that pair cancelled 192 cleanings
  -- and created none, 96 of them with a cleaner's name on them.
  --
  -- Only untouched work, which is the rule the other three passes keep: a
  -- cleaning somebody has accepted or started stays where she accepted it, and
  -- the insert's listing branch below is what keeps it from being duplicated
  -- onto a room.
  with wanted_room as (
    -- The lowest room id the booking took: an arbitrary choice among them, but
    -- a stable one, and the same one the one-off backfill makes. The booking's
    -- other rooms are owed cleanings of their own and the insert writes them.
    select distinct on (reservation_id) reservation_id, property_id, listing_id
    from _wanted
    where property_id <> listing_id
    order by reservation_id, property_id
  ),
  relocated as (
    update public.tasks t
    set property_id = w.property_id
    from wanted_room w
    where t.reservation_id = w.reservation_id
      and t.property_id = w.listing_id
      and t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned')
      -- If the room already holds this booking's cleaning, the move would
      -- collide with the pair that names one. The listing row is then a
      -- duplicate of work that already exists where it belongs, and the cancel
      -- pass below is what clears it.
      and not exists (
        select 1 from public.tasks x
        where x.reservation_id = w.reservation_id
          and x.property_id = w.property_id
          and x.type = 'cleaning'
          and x.status not in ('cancelled', 'expired')
      )
    returning 1
  )
  select count(*) into v_relocated from relocated;

  -- Insert missing tasks. The partial unique index on reservation_id keeps
  -- this idempotent: a repeated run collides and does nothing.
  with inserted as (
    insert into public.tasks (
      property_id, reservation_id, type, status, priority,
      scheduled_date, time_from, time_to, guests_count, due_at, assignee_id
    )
    select
      w.property_id, w.reservation_id, 'cleaning',
      (case when w.auto_cleaner_id is not null then 'assigned' else 'unassigned' end)
        ::public.task_status,
      w.priority, w.scheduled_date, w.time_from, w.time_to, w.guests_count,
      w.due_at, w.auto_cleaner_id
    from _wanted w
    where not exists (
      select 1 from public.tasks t
      where t.reservation_id = w.reservation_id
        and t.type = 'cleaning'
        -- Live work already exists for this booking -- or the very day was
        -- already tried and closed unfinished. The second half is what stops
        -- the nightly loop; the header of this migration says why.
        and (t.status not in ('cancelled', 'expired')
             or (t.status = 'expired' and t.scheduled_date = w.scheduled_date))
        and (t.property_id = w.property_id
             -- ...or it stands on the booking's own listing, which is where
             -- every cleaning stood before this migration. Such a row is the
             -- same cleaning recorded under the identity of the day, and it
             -- answers for every room the booking took.
             --
             -- Without this the ten cleanings finished last week on the nine
             -- multi-unit listings would each be created again, on a room, for
             -- work already done — and three of them would arrive already
             -- assigned to the cleaner who did it. History is not moved onto a
             -- room (it is not ours to restate), so it has to be read where it
             -- lies.
             --
             -- The branch cannot suppress work that is genuinely owed: after
             -- this migration the generator never puts a cleaning on a listing
             -- whose booking names rooms, so a row it matches is always one
             -- from before. On an ordinary listing w.property_id and
             -- w.listing_id are the same value and it says nothing new.
             or t.property_id = w.listing_id)
    )
    returning 1
  )
  select count(*) into v_created from inserted;

  -- Move tasks whose booking shifted, whose window changed, or whose guest
  -- count changed. Only untouched tasks: once a cleaner has accepted or
  -- started, rewriting the job underneath her is worse than leaving it for a
  -- human to sort out.
  with moved as (
    update public.tasks t
    set scheduled_date = w.scheduled_date,
        priority       = w.priority,
        time_from      = w.time_from,
        time_to        = w.time_to,
        guests_count   = w.guests_count,
        due_at         = w.due_at
    from _wanted w
    where t.reservation_id = w.reservation_id
      and t.property_id = w.property_id
      and t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned')
      and (t.scheduled_date is distinct from w.scheduled_date
           or t.priority is distinct from w.priority
           or t.time_from is distinct from w.time_from
           or t.time_to is distinct from w.time_to
           or t.guests_count is distinct from w.guests_count
           or t.due_at is distinct from w.due_at)
    returning 1
  )
  select count(*) into v_rescheduled from moved;

  -- Hand over tasks that are still waiting on a listing with a default
  -- cleaner. This covers the link being switched to 'auto' after the task
  -- already existed — the same shape as a stale deadline, where state set once
  -- at creation was never revisited.
  --
  -- Only genuinely free work: a task someone already holds, whether claimed by
  -- a cleaner or handed over by the manager, is left exactly as it is.
  with taken as (
    update public.tasks t
    set assignee_id = w.auto_cleaner_id,
        status      = 'assigned'
    from _wanted w
    where t.reservation_id = w.reservation_id
      and t.property_id = w.property_id
      and t.type = 'cleaning'
      and t.status = 'unassigned'
      and t.assignee_id is null
      and w.auto_cleaner_id is not null
    returning 1
  )
  select count(*) into v_assigned from taken;

  -- Cancel tasks whose reservation no longer qualifies: cancelled, turned into
  -- an inquiry, became a block, moved out of the window entirely — or whose
  -- listing has since gone into maintenance or been archived.
  --
  -- Work already done or under way is never touched, and neither is work that
  -- expired: those are answers about what happened, not open questions.
  with dropped as (
    update public.tasks t
    set status = 'cancelled'
    where t.type = 'cleaning'
      and t.reservation_id is not null
      and t.status in ('unassigned', 'assigned')
      and t.scheduled_date between from_date and to_date
      and not exists (
        select 1 from _wanted w
        where w.reservation_id = t.reservation_id
          and w.property_id = t.property_id
      )
    returning 1
  )
  select count(*) into v_cancelled from dropped;

  drop table _wanted;

  return jsonb_build_object(
    'window_from', from_date,
    'window_to', to_date,
    'relocated', v_relocated,
    'created', v_created,
    'rescheduled', v_rescheduled,
    'assigned', v_assigned,
    'cancelled', v_cancelled
  );
end;
$function$;

revoke all on function public.generate_cleaning_tasks(date, date) from public, anon, authenticated;
grant execute on function public.generate_cleaning_tasks(date, date) to service_role;
