-- CANCELLED 2026-10-18 (owner): do not run. Pass 3 now has the bound 2026-10-18, takes cleanings
-- and bookings together and runs once, on 2026-10-25 after 04:40 UTC, by the owner's word that
-- day (docs/launch-reset-2026-10-16.md, «Проход 3 с границей 18.10»). This script, kept as it was,
-- would refuse that bound anyway: bookings of 15-17.10 have cleanings.
--
-- Launch reset of 2026-10-16, stage 2, pass 3: bookings that ended before 2026-10-15 and came back
-- after pass 2 (docs/launch-reset-2026-10-16.md, «Синк»).
--
-- The nightly reconcile asks Hostaway for departures from (today UTC − 7 days), and a webhook
-- re-reads its booking whatever its age; both upsert by id, so a deleted booking comes back. It
-- comes back without a cleaning: the generator never creates one on a day already past
-- (task_is_stale). This pass deletes them again — the first run after the 03:15 UTC reconcile of
-- 2026-10-22 (window from 2026-10-15) is the last one the nightly sync makes necessary. Webhooks
-- keep bringing ended bookings back after that: 116 distinct ones in the 30 days before
-- 2026-10-16 (plan, «Синк»), so without a change to the sync this pass is a recurring one.
--
-- Run with the owner's word, outside 03:00–04:40 UTC:
--   npx supabase db query --linked -f docs/one-off-writes/launch-reset-1016-pass3-returned.sql
-- Then: node scripts/cloud-read.mjs docs/rollout/launch_reset_1016_after.sql
--   reservations.ended_before_bound 0, reservations.raw_without_booking 0, tasks.on_ended_booking 0.
do $$
declare
  c_bound constant date := date '2026-10-15';
  c_drop_raw_bookings constant boolean := true;
  v_n   bigint;
  v_raw bigint := 0;
begin
  perform set_config('lock_timeout', '20s', true);

  if exists (select 1 from public.tasks t
             join public.reservations r on r.id = t.reservation_id
             where r.departure_date < c_bound) then
    raise exception 'a returned booking has a cleaning: look at it before deleting';
  end if;

  delete from public.reservations where departure_date < c_bound;
  get diagnostics v_n = row_count;
  if c_drop_raw_bookings then
    delete from raw.hostaway_reservations h
     where not exists (select 1 from public.reservations r where r.id = h.id);
    get diagnostics v_raw = row_count;
  end if;

  raise notice 'launch reset pass 3 done: bookings=% raw_bookings=%', v_n, v_raw;
end
$$;
