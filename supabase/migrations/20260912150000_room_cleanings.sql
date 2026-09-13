-- A cleaning stands on the room that was slept in.
--
-- Until now one booking owed one cleaning, and it stood on the listing. On the
-- nine multi-unit listings that is the wrong flat: the guest slept in one room
-- of up to ten, the cleaner is sent to the building, and a booking that took
-- three rooms produced one cleaning for three rooms' work. Since 20260912130000
-- the booking says which rooms it took (public.reservation_units), and since
-- 20260912140000 a room's cleaner is known. This is the stage that uses both.
--
-- Three things change, and a fourth is done once to the work already on the
-- books:
--
--   the work list fans out. `_wanted` becomes one row per room the booking
--   took, falling back to the listing when it took none — which is every
--   booking on the seventy ordinary listings, and is expressed as a left join
--   rather than a branch.
--
--   identity gains a column. A cleaning was identified by its booking alone,
--   in the unique index and in all four clauses of the generator. One booking
--   now owes several, so the pair (booking, property) is what names one. Left
--   as it was, the index would refuse the second room outright and the four
--   clauses would each pick an arbitrary sibling — the insert would skip rooms
--   that have no task, the reschedule and the hand-over would write one room's
--   answer onto another, and the cancel would spare a room because a different
--   one matched.
--
--   urgency is judged per room. `same_day_turnover` asks whether the next
--   guest arrives the day this one leaves; asked of the listing it says yes
--   when ANY room turns over, which marks the other nine urgent for a
--   changeover that is not theirs. On this account that is the difference
--   between 199 urgent cleanings and 159.
--
--   and the cleanings already on the books move. 327 live ones stand on the
--   nine listings today, every one of them for a booking that names its rooms.
--   They are moved rather than re-made: the row keeps its id, so the cleaner's
--   acceptance, her photos, her steps, the problems filed against it and the
--   manager's own assignment all travel with it. Only the rooms nobody was
--   sent to are new rows.
--
-- Untouched, deliberately: anything done, cancelled or expired. Those are
-- answers about what happened, and moving a finished cleaning onto a room
-- nobody was ever sent to would be inventing history rather than recording it.

-- ---------------------------------------------------------------------------
--  The window, asked about a room
-- ---------------------------------------------------------------------------

/**
 * When the cleaning of this booking, in this room, can start and must end.
 *
 * Gains the property being cleaned. The old one-argument form is dropped
 * rather than kept beside it: a default second argument would have to stand
 * for "the listing", and that is exactly the answer that was wrong — the
 * caller must say which room it is asking about, and there is only one caller.
 *
 * The arriving guest now has to be arriving into THIS room. On a listing whose
 * bookings name no rooms the test is vacuous and the answer is what it always
 * was, which is what keeps the seventy ordinary listings unchanged.
 */
drop function public.reservation_cleaning_window(bigint);

create or replace function public.reservation_cleaning_window(
  target_reservation_id bigint,
  target_property_id    bigint
)
returns table (
  window_from       time,
  window_to         time,
  guests_count      smallint,
  same_day_turnover boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(nullif(r.check_out_time, time '00:00'), p.check_out_time),
    coalesce(nullif(nxt.check_in_time, time '00:00'), p.check_in_time),
    nxt.guests_count,
    nxt.id is not null
  from public.reservations r
  join public.properties p on p.id = r.property_id
  -- The guest who arrives on the day this one leaves. At most one matters;
  -- ordering by id keeps the answer stable if the data ever holds two.
  left join lateral (
    select n.id, n.check_in_time, n.guests_count
    from public.reservations n
    where n.property_id = r.property_id
      and n.arrival_date = r.departure_date
      and n.id <> r.id
      and n.status in ('new', 'modified')
      and not n.is_block
      -- ...and who is arriving into the room being cleaned. Asked about the
      -- listing itself — an ordinary flat, or a multi-unit booking that named
      -- no rooms — the first branch is true and nothing is narrowed.
      and (target_property_id = r.property_id
           or exists (select 1
                      from public.reservation_units nu
                      where nu.reservation_id = n.id
                        and nu.property_id = target_property_id))
    order by n.id
    limit 1
  ) nxt on true
  where r.id = target_reservation_id
$$;

revoke all on function public.reservation_cleaning_window(bigint, bigint) from public, anon;
grant execute on function public.reservation_cleaning_window(bigint, bigint)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  What names one cleaning
-- ---------------------------------------------------------------------------
--
-- Unchanged from 20260904120100 but for the second column: 'expired' and
-- 'cancelled' are still outside the index, because a booking rescheduled into
-- the future is owed a fresh task and the slot the abandoned attempt occupies
-- has to be free.

drop index public.tasks_one_cleaning_per_reservation;

create unique index tasks_one_cleaning_per_reservation
  on public.tasks (reservation_id, property_id)
  where type = 'cleaning' and reservation_id is not null
        and status not in ('cancelled', 'expired');

-- ---------------------------------------------------------------------------
--  The generator
-- ---------------------------------------------------------------------------
--
-- Recreated from its current definition in 20260912140000 — the version whose
-- regular-cleaner pick reads `p` — with the work list fanned out over rooms,
-- the window asked per room, and `and t.property_id = w.property_id` added to
-- each of the four clauses that find an existing task. Everything else is
-- verbatim, `p` having been the property being cleaned since that migration.

create or replace function public.generate_cleaning_tasks(from_date date, to_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
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
        and t.status not in ('cancelled', 'expired')
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
    'created', v_created,
    'rescheduled', v_rescheduled,
    'assigned', v_assigned,
    'cancelled', v_cancelled
  );
end;
$function$;


-- ---------------------------------------------------------------------------
--  The cleanings already on the books
-- ---------------------------------------------------------------------------
--
-- Three explicit steps rather than a call to the generator. The generator
-- reconciles a whole date window, and the window wide enough to hold this
-- work — the live cleanings run from 2024 to 2027 — is also wide enough for
-- its cancelling pass to close bookings that lapsed on listings this migration
-- has no business touching. What follows moves only cleanings whose booking
-- names rooms, adds only rooms that have none, and re-times only rooms.

do $backfill$
declare
  v_moved   integer;
  v_added   integer;
  v_retimed integer;
begin
  -- 1. Move each live cleaning onto the first room its booking took. Lowest
  --    property id is an arbitrary choice among the rooms but a stable one,
  --    and it is only ever a choice of WHICH room keeps the existing row: the
  --    others are rooms nobody had been sent to, and they are made below.
  --
  --    The row keeps its id, its assignee, its status and its history. That is
  --    the whole reason this is an update and not a delete and an insert.
  with first_room as (
    select t.id as task_id, min(ru.property_id) as room_id
    from public.tasks t
    join public.reservations r       on r.id = t.reservation_id
    join public.reservation_units ru on ru.reservation_id = t.reservation_id
    where t.type = 'cleaning'
      and t.status not in ('done', 'cancelled', 'expired')
      -- Only what still stands on the listing. A cleaning already on a room is
      -- one this has run over before, and running over it again would move an
      -- accepted job to a different room.
      and t.property_id = r.property_id
    group by t.id
  ),
  relocated as (
    update public.tasks t
    set property_id = fr.room_id
    from first_room fr
    where t.id = fr.task_id
    returning 1
  )
  select count(*) into v_moved from relocated;

  -- 2. Add the rooms now owed a cleaning of their own: the other rooms of a
  --    booking whose cleaning has just moved. The regular cleaner is picked
  --    exactly as the generator picks it — the room's own, else the listing's.
  with owed as (
    select distinct t.reservation_id, ru.property_id as room_id,
           t.host_id, t.scheduled_date
    from public.tasks t
    join public.reservation_units ru on ru.reservation_id = t.reservation_id
    where t.type = 'cleaning'
      and t.status not in ('done', 'cancelled', 'expired')
      and not exists (
        select 1 from public.tasks x
        where x.reservation_id = t.reservation_id
          and x.property_id = ru.property_id
          and x.type = 'cleaning'
          and x.status not in ('cancelled', 'expired')
      )
  ),
  created as (
    insert into public.tasks (
      host_id, property_id, reservation_id, type, status, priority,
      scheduled_date, time_from, time_to, guests_count, due_at, assignee_id
    )
    select
      o.host_id, o.room_id, o.reservation_id, 'cleaning',
      (case when auto.cleaner_id is not null then 'assigned' else 'unassigned' end)
        ::public.task_status,
      (case when w.same_day_turnover then 1 else 0 end)::smallint,
      o.scheduled_date, w.window_from, w.window_to, w.guests_count,
      case when w.same_day_turnover and w.window_to is not null
           then (o.scheduled_date + w.window_to) at time zone p.timezone
      end,
      auto.cleaner_id
    from owed o
    join public.properties p on p.id = o.room_id
    cross join lateral public.reservation_cleaning_window(o.reservation_id, o.room_id) w
    cross join lateral (
      select coalesce(
        (select pc.cleaner_id from public.property_cleaners pc
         where pc.property_id = p.id and pc.mode = 'auto'),
        (select pc.cleaner_id from public.property_cleaners pc
         where p.hostaway_unit_id is not null
           and pc.property_id = p.parent_id and pc.mode = 'auto')
      ) as cleaner_id
    ) auto
    returning 1
  )
  select count(*) into v_added from created;

  -- 3. Re-time what moved. Its window, its guest count and its urgency were
  --    all computed for the whole listing, and urgency is the one that shows:
  --    a room marked same-day because a different room turned over sends a
  --    cleaner running for a changeover that is not hers.
  --
  --    Only 'unassigned' and 'assigned', which is the generator's own rule —
  --    once a cleaner has accepted or started, rewriting the job underneath
  --    her is worse than leaving it for a human to sort out. And only rooms:
  --    an ordinary listing's answer has not changed, and this statement must
  --    not be the one that discovers otherwise.
  with target as (
    select t.id,
           (case when w.same_day_turnover then 1 else 0 end)::smallint as priority,
           w.window_from, w.window_to, w.guests_count,
           case when w.same_day_turnover and w.window_to is not null
                then (t.scheduled_date + w.window_to) at time zone p.timezone
           end as due_at
    from public.tasks t
    join public.properties p on p.id = t.property_id
    cross join lateral public.reservation_cleaning_window(t.reservation_id, t.property_id) w
    where t.type = 'cleaning'
      and t.reservation_id is not null
      and t.status in ('unassigned', 'assigned')
      and p.hostaway_unit_id is not null
  ),
  retimed as (
    update public.tasks t
    set priority     = tg.priority,
        time_from    = tg.window_from,
        time_to      = tg.window_to,
        guests_count = tg.guests_count,
        due_at       = tg.due_at
    from target tg
    where t.id = tg.id
      and (t.priority     is distinct from tg.priority
           or t.time_from is distinct from tg.window_from
           or t.time_to   is distinct from tg.window_to
           or t.guests_count is distinct from tg.guests_count
           or t.due_at    is distinct from tg.due_at)
    returning 1
  )
  select count(*) into v_retimed from retimed;

  raise notice 'room cleanings: % moved onto a room, % rooms added, % re-timed',
    v_moved, v_added, v_retimed;
end;
$backfill$;
