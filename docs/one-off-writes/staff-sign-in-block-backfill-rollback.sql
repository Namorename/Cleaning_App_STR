-- Rollback of docs/one-off-writes/staff-sign-in-block-backfill.sql: lifts what it set, no more.
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
-- What it touches: auth.users.banned_until back to empty on the accounts that still carry the
-- backfill's date, 2126-01-01 00:00:00 UTC, and nothing else. The date is the backfill's alone
-- (manage-staff writes now + 876000 hours, with fractions of a second), so a block manage-staff
-- set is left as it is, and so is an account somebody has switched on or off since: its date is
-- gone already. The accounts lifted are switched off, so they sign in and see nothing, as before.
--
-- Run, then read:
--   1. the probe, for the numbers before:
--        node scripts/cloud-read.mjs docs/rollout/staff_sign_in_block_probe.sql
--   2. this file — one statement, as db query takes no more:
--        npx supabase db query --linked -f docs/one-off-writes/staff-sign-in-block-backfill-rollback.sql
--      it answers with how many accounts it lifted: step 1's set_by_backfill;
--   3. the probe again: set_by_backfill = 0, active_blocked = 0.
--
-- While manage-staff stays deployed, the next edit of each of these people in «Команда» blocks
-- them again: it brings Auth into line with the row. To stop that, put the old function back
-- first. But with the old function back, a block manage-staff set is not lifted by switching the
-- person on: read active_blocked after every such switch, and lift it by hand.
with lifted as (
  update auth.users
     set banned_until = null
   where banned_until = timestamptz '2126-01-01 00:00:00+00'
  returning id
)
select count(*) as lifted from lifted;
