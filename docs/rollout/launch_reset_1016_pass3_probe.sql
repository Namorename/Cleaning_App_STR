-- Launch reset, pass 3 with the bound 2026-10-18 (docs/launch-reset-2026-10-16.md, «Проход 3»;
-- owner's decision of 2026-10-18): what the pass would take, and the gates it must hold.
--   node scripts/cloud-read.mjs docs/rollout/launch_reset_1016_pass3_probe.sql
-- Run before the pass (25.10 after 04:40 UTC) and right after it. Counts only.
-- Gates before the pass, every one 0: tasks.gate_open_or_worked, tasks.gate_started,
--   repairs_before_bound, every key of cascade except task_events,
--   bookings.gate_live_task_on_gone_booking.
-- tasks.with_assignee is not a gate: a cleaning someone took and the sweep closed as expired
--   goes with the bound (owner, 18.10); its number goes into the log. One that was started or
--   done trips gate_started, and the pass stops for the owner to look at it.
-- Expected after the pass: tasks.n 0, cascade.task_events 0, bookings.n — 0, or only what a
--   webhook brought back since the commit; bookings.raw_copies equal to bookings.n.
-- The bound is a Prague date: a cleaning goes when scheduled_date < 18.10, a booking when its
-- departure_date < 18.10 (one that crosses the bound stays). Repairs and the test band
-- 900000000000…999999999999 are outside the pass; «Hotel» (800000000001) has neither.
with bound as (select date '2026-10-18' as d),
gone_tasks as (
  select t.* from public.tasks t, bound
  where t.scheduled_date < bound.d and t.problem_id is null
    and not (t.property_id between 900000000000 and 999999999999)),
gone_bookings as (
  select r.* from public.reservations r, bound
  where r.departure_date < bound.d
    and not (r.property_id between 900000000000 and 999999999999))
select jsonb_build_object(
  'now_utc', now(),
  'tasks', (select jsonb_build_object(
      'n', count(*),
      'by_status', (select jsonb_object_agg(s, n) from (
          select status::text as s, count(*) as n from gone_tasks group by 1) z),
      'with_assignee', count(*) filter (where assignee_id is not null),
      -- after the sweep of 19.10 every cleaning before the bound is expired or cancelled
      'gate_open_or_worked', count(*) filter (where status not in ('expired', 'cancelled')),
      'gate_started', count(*) filter (where started_at is not null or completed_at is not null))
    from gone_tasks),
  'repairs_before_bound', (select count(*) from public.tasks t, bound
      where t.scheduled_date < bound.d and t.problem_id is not null),
  -- what the delete of the cleanings takes along; only the journal is expected
  'cascade', jsonb_build_object(
      'task_events', (select count(*) from public.task_events e join gone_tasks g on g.id = e.task_id),
      'task_steps', (select count(*) from public.task_steps s join gone_tasks g on g.id = s.task_id),
      'task_media', (select count(*) from public.task_media m join gone_tasks g on g.id = m.task_id),
      'chat_threads', (select count(*) from public.chat_threads c join gone_tasks g on g.id = c.task_id),
      'push_outbox', (select count(*) from raw.push_outbox o join gone_tasks g on g.id = o.task_id),
      'problems_pointing', (select count(*) from public.problems p join gone_tasks g on g.id = p.task_id),
      'supply_pointing', (select count(*) from public.supply_requests s join gone_tasks g on g.id = s.task_id)),
  'bookings', (select jsonb_build_object(
      'n', count(*),
      'departure_before_15_10', count(*) filter (where departure_date < date '2026-10-15'),
      'departure_15_to_17_10', count(*) filter (where departure_date >= date '2026-10-15'),
      'raw_copies', (select count(*) from raw.hostaway_reservations h join gone_bookings b on b.id = h.id),
      'units', (select count(*) from public.reservation_units u join gone_bookings b on b.id = u.reservation_id),
      'crossing_bound_kept', (select count(*) from public.reservations r, bound
          where r.arrival_date < bound.d and r.departure_date >= bound.d),
      -- a cleaning on or after the bound must not stand on a booking that goes
      'gate_live_task_on_gone_booking', (select count(*) from public.tasks t
          join gone_bookings b on b.id = t.reservation_id, bound
          where t.scheduled_date >= bound.d))
    from gone_bookings),
  -- Diagnostic: bookings that ended before 15.10 and came back after pass 2 (16.10 17:08:09 UTC)
  -- and that analytics_occupancy_rows / analytics_checkout_rows count (new/modified, not a
  -- block, not a «#» service booking), measured over the panel's default 30 days before 18.10.
  'analytics_returned', (select jsonb_build_object(
      'bookings', count(*),
      'checkouts_19_09_to_18_10', count(*) filter (
          where r.departure_date between date '2026-09-19' and date '2026-10-18'),
      'nights_19_09_to_18_10', coalesce(sum(greatest(0,
          least(r.departure_date, date '2026-10-19') - greatest(r.arrival_date, date '2026-09-19'))), 0))
    from public.reservations r
    where r.created_at > timestamptz '2026-10-16 17:08:09+00'
      and r.departure_date < date '2026-10-15'
      and r.status in ('new', 'modified') and not r.is_block
      and not (ltrim(coalesce(r.guest_name, ''), ' ' || chr(160) || chr(9)) like '#%')
      and not (r.property_id between 900000000000 and 999999999999)),
  'analytics_all_19_09_to_18_10', (select jsonb_build_object(
      'checkouts', count(*) filter (where r.departure_date between date '2026-09-19' and date '2026-10-18'),
      'nights', coalesce(sum(greatest(0,
          least(r.departure_date, date '2026-10-19') - greatest(r.arrival_date, date '2026-09-19'))), 0))
    from public.reservations r
    where r.status in ('new', 'modified') and not r.is_block
      and not (ltrim(coalesce(r.guest_name, ''), ' ' || chr(160) || chr(9)) like '#%')
      and not (r.property_id between 900000000000 and 999999999999))
) as pass3_probe;
