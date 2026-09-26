-- A service booking is a block: it earns no cleaning, and its arrival is
-- nobody's same-day turnover.
--
-- The office reserves a flat for its own work -- a boiler repair, an
-- inspection -- as an ordinary Hostaway reservation and marks it by starting
-- the guest name with "#" ("#Boiler - ремонт"). The owner's decision of
-- 2026-09-25: such a booking is treated exactly as a block (is_block, Hostaway
-- status ownerStay). Hostaway does not call it a block, so until now the
-- generator wrote a cleaning for it like for any guest, and made the departure
-- before it a same-day turnover with a deadline at its "check-in".
--
-- The rule lives in one function, public.is_service_booking(guest_name): the
-- name, after leading white space (a no-break space included), begins with
-- "#". A booking with no name is an ordinary booking. The column is_block and
-- the Edge Functions' mapping (_shared/reservation.ts) are left alone: a change
-- there would mean redeploying every function that bundles it, and the name is
-- in the row already.
--
-- is_block changes a cleaning in two places, and the service booking now joins
-- it in both (the latest definitions: 20260912150000 for the window,
-- 20260923120000 for the generator):
--   * generate_cleaning_tasks, `_wanted`: no cleaning is owed for it. Since the
--     cancel pass reads "no longer in _wanted" as "no longer wanted", a live
--     booking renamed into "#..." loses the cleaning nobody has started,
--     exactly as one that becomes a block; work under way or done is left as
--     it is. Named back, it earns a fresh one beside the cancelled row.
--   * reservation_cleaning_window, the arriving guest: a service booking
--     arriving on a departure day makes no same-day turnover -- no priority, no
--     deadline, the window closes at the listing's own check-in.
-- Nothing else reads is_block for cleanings: sync_hostaway_reservations only
-- stores it, and the partial index reservations_departure_idx (where not
-- is_block) still serves the generator's scan, the new test being a filter on
-- top of it.
--
-- The same create or replace corrects a comment of the generator that claimed
-- the insert was idempotent through "the partial unique index on
-- reservation_id". The index is on (reservation_id, property_id), there is no
-- `on conflict`, and what keeps a repeated run from writing twice is the not
-- exists in `owed`; under two concurrent runs the second fails with 23505 and
-- rolls back. The rest of both bodies is unchanged.
--
-- Plans, measured by calling the generator itself under auto_explain on 9000
-- synthetic bookings (local stack, rolled back): the `_wanted` scan stays a
-- bitmap scan on reservations_departure_idx, with is_service_booking() in the
-- filter next to the status.
--
-- Tests: supabase/tests/task_generation.sql, "A service booking is a block".

create or replace function public.is_service_booking(guest_name text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(guest_name ~ '^[[:space:]\u00a0]*#', false)
$$;

comment on function public.is_service_booking(text) is
  'A booking the office made for its own work: the guest name begins with "#" '
  'after leading white space. Treated as a block by the cleaning generator.';

revoke all on function public.is_service_booking(text) from public, anon;
grant execute on function public.is_service_booking(text) to authenticated, service_role;


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
      -- A service booking is a block by another name (20260926102000).
      and not public.is_service_booking(n.guest_name)
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
  v_past_bound  integer;
  v_answer      jsonb;
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
    -- A service booking is a block by another name (20260926102000).
    and not public.is_service_booking(r.guest_name)
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

  -- Insert missing tasks. A repeated run writes nothing twice because `owed`
  -- leaves out every booking whose cleaning is already there (the not exists
  -- below); there is no `on conflict`. The partial unique index
  -- tasks_one_cleaning_per_reservation, on (reservation_id, property_id), is
  -- the backstop for two runs at once: both may find the same cleaning
  -- missing, the second insert then waits for the first run and fails with
  -- 23505 once it commits, and the whole second run rolls back -- the next
  -- run writes whatever it still finds missing.
  --
  -- `owed` is every cleaning the bookings ask for that the table does not yet
  -- answer. Those whose day is already past grace are counted as past_bound
  -- and not written; both numbers come from the one list, so they cannot
  -- disagree about what "missing" means.
  with owed as (
    select w.*,
           -- No cleaning is born for a day the sweep would close: task_is_stale
           -- is the one boundary the sweep and the claim policy already share.
           -- The bound sits here and not in _wanted on purpose -- see the header.
           public.task_is_stale(w.property_id, w.scheduled_date) as is_past
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
  ),
  inserted as (
    insert into public.tasks (
      property_id, reservation_id, type, status, priority,
      scheduled_date, time_from, time_to, guests_count, due_at, assignee_id
    )
    select
      o.property_id, o.reservation_id, 'cleaning',
      (case when o.auto_cleaner_id is not null then 'assigned' else 'unassigned' end)
        ::public.task_status,
      o.priority, o.scheduled_date, o.time_from, o.time_to, o.guests_count,
      o.due_at, o.auto_cleaner_id
    from owed o
    where not o.is_past
    returning 1
  )
  select (select count(*) from inserted),
         (select count(*) from owed where is_past)
    into v_created, v_past_bound;

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
  -- an inquiry, became a block or a service booking, moved out of the window
  -- entirely — or whose listing has since gone into maintenance or been
  -- archived.
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

  v_answer := jsonb_build_object(
    'window_from', from_date,
    'window_to', to_date,
    'relocated', v_relocated,
    'created', v_created,
    'rescheduled', v_rescheduled,
    'assigned', v_assigned,
    'cancelled', v_cancelled,
    'past_bound', v_past_bound
  );

  -- The trace, in its own block: a failure here rolls back only this insert
  -- and is reported, never the run. See the header.
  begin
    lock table raw.generator_runs in row exclusive mode nowait;
    insert into raw.generator_runs (window_from, window_to, answer)
    values (from_date, to_date, v_answer);
  exception when others then
    raise warning 'generate_cleaning_tasks: run trace not written: % (SQLSTATE %)',
      sqlerrm, sqlstate;
  end;

  return v_answer;
end;
$function$;

