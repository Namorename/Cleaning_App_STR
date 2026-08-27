-- Cleaning task generation.
--
-- A departing guest produces a cleaning task on the departure date. The
-- function reconciles rather than appends: it is safe to run after every
-- webhook batch and again nightly, and it converges on the same result.
--
-- Which reservations qualify was established against live data:
--   new, modified               -> confirmed stay, cleaning needed
--   cancelled, expired          -> nobody arrives
--   inquiry, inquiryPreapproved -> not confirmed, does not hold the calendar
--   is_block (ownerStay)        -> occupancy without a paying guest
--
-- Channel and price deliberately play no part. channelId = 2000 mixes promo
-- shoots, photo sessions, owner stays and genuine direct bookings, and a zero
-- price shows up on stays where people were actually in the flat. Missing a
-- needed cleaning is worse than scheduling a spare one.

/**
 * Reconcile cleaning tasks for departures in the given window.
 *
 * Returns counts so the caller can log what changed.
 */
create or replace function public.generate_cleaning_tasks(
  from_date date,
  to_date   date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created     integer;
  v_rescheduled integer;
  v_cancelled   integer;
begin
  -- Reservations that should have a cleaning task, with the deadline already
  -- resolved. A same-day arrival makes the deadline the next guest's check-in
  -- time; otherwise the task simply belongs to that day.
  create temporary table _wanted on commit drop as
  select
    r.id             as reservation_id,
    r.property_id,
    r.departure_date as scheduled_date,
    exists (
      select 1
      from public.reservations nxt
      where nxt.property_id = r.property_id
        and nxt.arrival_date = r.departure_date
        and nxt.id <> r.id
        and nxt.status in ('new', 'modified')
        and not nxt.is_block
    )                as same_day_turnover,
    p.timezone,
    p.check_in_time
  from public.reservations r
  join public.properties p on p.id = r.property_id
  where r.departure_date between from_date and to_date
    and r.status in ('new', 'modified')
    and not r.is_block
    and p.is_active;

  -- Insert missing tasks. The partial unique index on reservation_id keeps
  -- this idempotent: a repeated run collides and does nothing.
  with inserted as (
    insert into public.tasks (
      property_id, reservation_id, type, status, priority, scheduled_date, due_at
    )
    select
      w.property_id,
      w.reservation_id,
      'cleaning',
      'unassigned',
      case when w.same_day_turnover then 1 else 0 end,
      w.scheduled_date,
      case
        when w.same_day_turnover and w.check_in_time is not null
        -- The next guest may arrive at check-in time, so that is the hard
        -- deadline. Computed in the property's own timezone: two of the
        -- properties in this account check in at 16:00 and 17:00, not 15:00.
        then (w.scheduled_date + w.check_in_time) at time zone w.timezone
      end
    from _wanted w
    where not exists (
      select 1 from public.tasks t
      where t.reservation_id = w.reservation_id
        and t.type = 'cleaning'
        and t.status <> 'cancelled'
    )
    returning 1
  )
  select count(*) into v_created from inserted;

  -- Move tasks whose reservation was shifted. Only untouched tasks: once a
  -- cleaner has accepted or started, rescheduling underneath them would be
  -- worse than leaving the task where it is for a human to sort out.
  with moved as (
    update public.tasks t
    set scheduled_date = w.scheduled_date,
        priority = case when w.same_day_turnover then 1 else 0 end,
        due_at = case
          when w.same_day_turnover and w.check_in_time is not null
          then (w.scheduled_date + w.check_in_time) at time zone w.timezone
        end
    from _wanted w
    where t.reservation_id = w.reservation_id
      and t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned')
      and (t.scheduled_date is distinct from w.scheduled_date
           or t.priority is distinct from case when w.same_day_turnover then 1 else 0 end)
    returning 1
  )
  select count(*) into v_rescheduled from moved;

  -- Cancel tasks whose reservation no longer qualifies: cancelled, turned into
  -- an inquiry, became a block, or moved out of the window entirely.
  --
  -- Work already done or under way is never touched. A cleaner who finished a
  -- flat must keep the record of it even if the booking was cancelled
  -- afterwards, and pulling a task out from under someone mid-shift is worse
  -- than leaving a spare one.
  with dropped as (
    update public.tasks t
    set status = 'cancelled'
    where t.type = 'cleaning'
      and t.reservation_id is not null
      and t.status in ('unassigned', 'assigned')
      and t.scheduled_date between from_date and to_date
      and not exists (
        select 1 from _wanted w where w.reservation_id = t.reservation_id
      )
    returning 1
  )
  select count(*) into v_cancelled from dropped;

  return jsonb_build_object(
    'window_from', from_date,
    'window_to', to_date,
    'created', v_created,
    'rescheduled', v_rescheduled,
    'cancelled', v_cancelled
  );
end;
$$;

revoke all on function public.generate_cleaning_tasks(date, date) from public, anon, authenticated;
grant execute on function public.generate_cleaning_tasks(date, date) to service_role;
