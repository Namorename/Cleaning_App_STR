-- Rollback of docs/one-off-writes/staff-sign-in-block-backfill.sql: lifts what it set, no more.
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
-- The whole rollback, with its word: docs/rollout/staff-sign-in-block-1106.md.
--
-- What it touches: only accounts carrying both the marker sign_in_block = staff and the backfill's
-- date, 2126-01-01 00:00:00 UTC. On those, auth.users.banned_until goes back to empty and the one
-- key leaves auth.users.raw_app_meta_data; the role and the provider stay. Neither mark alone is
-- enough. A ban set by hand has no marker, and a block manage-staff set has its own date
-- (now + 876000 hours, with fractions of a second), so both are left as they are. So is anybody
-- saved in «Команда» since the backfill: every save of somebody off writes manage-staff's date. The
-- accounts lifted are switched off, so they sign in and see nothing, as before.
--
-- Run, then read:
--   1. the probe, for the numbers before:
--        node scripts/cloud-read.mjs docs/rollout/staff_sign_in_block_probe.sql
--   2. this file — one statement, as db query takes no more:
--        npx supabase db query --linked -f docs/one-off-writes/staff-sign-in-block-backfill-rollback.sql
--      it answers with how many accounts it lifted: step 1's set_by_backfill;
--   3. the probe again: set_by_backfill = 0, active_marked = 0.
--
-- While manage-staff stays deployed, the next edit of each of these people in «Команда» blocks
-- them again: it brings Auth into line with the row. To stop that, put the old function back
-- first. But with the old function back, switching a person on lifts no block at all, so a block
-- manage-staff set stays on somebody working: read active_marked after every such switch, and lift
-- it by hand.
with lifted as (
  update auth.users
     set banned_until = null,
         raw_app_meta_data = raw_app_meta_data - 'sign_in_block'
   where banned_until = timestamptz '2126-01-01 00:00:00+00'
     and raw_app_meta_data ->> 'sign_in_block' = 'staff'
  returning id
)
select count(*) as lifted from lifted;
