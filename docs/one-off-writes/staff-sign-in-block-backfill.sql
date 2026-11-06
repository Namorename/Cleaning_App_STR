-- One-off write: block the sign-in of the accounts switched off before manage-staff began to do it.
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
-- From its deploy on, manage-staff blocks a person it switches off and lifts the block when it
-- switches her on. Nobody goes back over the people already off: they keep signing in and seeing
-- nothing, until this file or the next edit of each of them in «Команда».
--
-- Order. manage-staff with the block goes first: the old function knows nothing of a block, so
-- switching somebody on through it would leave her working in the panel and unable to sign in.
--   1. manage-staff deployed (npx supabase functions deploy manage-staff);
--   2. the probe, for the numbers before:
--        node scripts/cloud-read.mjs docs/rollout/staff_sign_in_block_probe.sql
--      seen_in_auth = profiles, active_blocked = 0, otherwise stop and read why;
--   3. this file — one statement, as db query takes no more:
--        npx supabase db query --linked -f docs/one-off-writes/staff-sign-in-block-backfill.sql
--      it answers with how many accounts it blocked: the probe's disabled - disabled_blocked;
--   4. the probe again: disabled_blocked = disabled, active_blocked = 0, set_by_backfill = the
--      number step 3 answered.
--
-- What it touches: the one column auth.users.banned_until, of accounts whose profile says
-- is_active = false and that no block holds yet. updated_at stays, so a rollback leaves no trace.
-- An account that is working is not touched, nor is an account with no profile, nor a block
-- already in place: that one stays as manage-staff or the dashboard set it. The two triggers on
-- auth.users do not wake: one fires on insert, the other on a change of the address.
--
-- Why a fixed date. 2126-01-01 00:00:00 UTC marks what this file set, so the rollback can lift
-- exactly that: manage-staff writes now + 876000 hours, a later date with fractions of a second.
--
-- A session already open is not ended: the access token runs until it expires, and the refresh
-- after it is refused. Row security closed the data when the account was switched off.
--
-- Rollback: docs/one-off-writes/staff-sign-in-block-backfill-rollback.sql.
with blocked as (
  update auth.users u
     set banned_until = timestamptz '2126-01-01 00:00:00+00'
    from public.profiles p
   where p.id = u.id
     and not p.is_active
     and (u.banned_until is null or u.banned_until <= now())
  returning u.id
)
select count(*) as blocked from blocked;
