-- Launch reset, pass 3 with the bound 2026-10-18: what the pass must NOT change.
--   node scripts/cloud-read.mjs docs/rollout/launch_reset_1016_pass3_kept.sql
-- Run right before the pass and right after it; every number must match. The only
-- legitimate drift is ordinary traffic between the two runs: bookings_from_bound may grow
-- by what Hostaway sent, and tasks_from_bound may change by the generator or by people —
-- tasks_from_bound_max_updated tells whether anything moved in between. Counts only.
select jsonb_build_object(
  'now_utc', now(),
  'tasks_from_bound', (select jsonb_object_agg(s, n) from (
      select t.status::text as s, count(*) as n from public.tasks t
      where t.scheduled_date >= date '2026-10-18' group by 1) z),
  'tasks_from_bound_max_updated', (select max(t.updated_at) from public.tasks t
      where t.scheduled_date >= date '2026-10-18'),
  'repairs', (select count(*) from public.tasks t where t.problem_id is not null),
  'bookings_from_bound', (select count(*) from public.reservations r
      where r.departure_date >= date '2026-10-18'),
  'bookings_crossing_bound', (select count(*) from public.reservations r
      where r.arrival_date < date '2026-10-18' and r.departure_date >= date '2026-10-18'),
  'test_band', jsonb_build_object(
      'tasks', (select count(*) from public.tasks t where t.property_id between 900000000000 and 999999999999),
      'bookings', (select count(*) from public.reservations r where r.property_id between 900000000000 and 999999999999)),
  'hotel', (select jsonb_build_object('rows', count(*),
      'tasks', (select count(*) from public.tasks t where t.property_id = 800000000001),
      'bookings', (select count(*) from public.reservations r where r.property_id = 800000000001))
    from public.properties p where p.id = 800000000001),
  'people', jsonb_build_object(
      'profiles', (select count(*) from public.profiles),
      'links', (select count(*) from public.property_cleaners)),
  'problems', (select count(*) from public.problems)
) as pass3_kept;
