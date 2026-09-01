-- The deadline must follow the property's check-in time.
--
-- Found in production on 2026-09-01: six same-day tasks were created in the
-- minutes when check_in_time was still null, and every later run left their
-- due_at null. The reschedule branch only fired when scheduled_date or
-- priority differed, so a stale deadline alone was invisible to it — and a
-- property that simply moves its check-in from 15:00 to 17:00 would have kept
-- the old deadline forever.
--
-- Two changes:
--   1. due_at joins the comparison that decides whether a task is rewritten.
--   2. The wanted-set is computed once, with priority and due_at as columns,
--      instead of repeating the same case expression in three places.
--
-- The temp table is also dropped explicitly at the end. It was created with
-- `on commit drop`, which is fine in production where every call is its own
-- transaction, but made the function fail on a second call inside one
-- transaction with `relation "_wanted" already exists` — which is exactly how
-- a regression test has to call it. Dropping only at the end is enough: if the
-- function raises, the transaction unwinds and takes the table with it.

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
  -- Reservations that should have a cleaning task, with priority and deadline
  -- already resolved. A same-day arrival makes the deadline the next guest's
  -- check-in time; otherwise the task simply belongs to that day.
  create temporary table _wanted on commit drop as
  with departures as (
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
      and p.is_active
  )
  select
    d.reservation_id,
    d.property_id,
    d.scheduled_date,
    (case when d.same_day_turnover then 1 else 0 end)::smallint as priority,
    case
      when d.same_day_turnover and d.check_in_time is not null
      -- The next guest may arrive at check-in time, so that is the hard
      -- deadline. Computed in the property's own timezone: two of the
      -- properties in this account check in at 16:00 and 17:00, not 15:00.
      then (d.scheduled_date + d.check_in_time) at time zone d.timezone
    end as due_at
  from departures d;

  -- Insert missing tasks. The partial unique index on reservation_id keeps
  -- this idempotent: a repeated run collides and does nothing.
  with inserted as (
    insert into public.tasks (
      property_id, reservation_id, type, status, priority, scheduled_date, due_at
    )
    select
      w.property_id, w.reservation_id, 'cleaning', 'unassigned',
      w.priority, w.scheduled_date, w.due_at
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

  -- Move tasks whose reservation was shifted, or whose deadline no longer
  -- matches the property. Only untouched tasks: once a cleaner has accepted or
  -- started, rescheduling underneath them would be worse than leaving the task
  -- where it is for a human to sort out.
  with moved as (
    update public.tasks t
    set scheduled_date = w.scheduled_date,
        priority       = w.priority,
        due_at         = w.due_at
    from _wanted w
    where t.reservation_id = w.reservation_id
      and t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned')
      and (t.scheduled_date is distinct from w.scheduled_date
           or t.priority is distinct from w.priority
           or t.due_at is distinct from w.due_at)
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

  drop table _wanted;

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
