-- One-off write: block the sign-in of the accounts switched off before manage-staff began to do it.
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
-- The whole rollout, with its words: docs/rollout/staff-sign-in-block-1106.md.
--
-- From its deploy on, manage-staff blocks a person it switches off and lifts its own block when it
-- switches her on. Nobody goes back over the people already off: they keep signing in and seeing
-- nothing, until this file or the next edit of each of them in «Команда».
--
-- Order. manage-staff with the block goes first: the old function knows nothing of a block, so
-- switching somebody on through it would leave her working in the panel and unable to sign in.
--   1. manage-staff deployed (npx supabase functions deploy manage-staff);
--   2. the probe, for the numbers before:
--        node scripts/cloud-read.mjs docs/rollout/staff_sign_in_block_probe.sql
--      seen_in_auth = profiles, active_marked = 0, otherwise stop and read why;
--   3. this file — one statement, as db query takes no more:
--        npx supabase db query --linked -f docs/one-off-writes/staff-sign-in-block-backfill.sql
--      it answers with how many accounts it blocked: the probe's disabled - disabled_blocked;
--   4. the probe again: disabled_blocked = disabled, active_marked = 0, set_by_backfill = the
--      number step 3 answered.
--
-- What it touches, on accounts whose profile says is_active = false and that no block holds yet:
-- auth.users.banned_until, and one key added to auth.users.raw_app_meta_data, the marker
-- sign_in_block = staff that manage-staff writes with a block of its own. Without the marker
-- switching the person on would not lift the block, as with a ban set by hand. The role and the
-- provider in that column stay. updated_at stays, so a rollback leaves no trace.
-- An account that is working is not touched, nor is an account with no profile, nor a block
-- already in place: that one stays as manage-staff or the dashboard set it. The two triggers on
-- auth.users do not wake: one fires on insert, the other on a change of the address.
--
-- Why a fixed date. 2126-01-01 00:00:00 UTC, with the marker, is what the rollback recognises:
-- manage-staff writes now + 876000 hours, a later date with fractions of a second. A later save of
-- somebody off writes that date over this one, and she then belongs to manage-staff.
--
-- A session already open is not ended: the access token runs until it expires, and the refresh
-- after it is refused. Row security closed the data when the account was switched off.
--
-- Rollback: docs/one-off-writes/staff-sign-in-block-backfill-rollback.sql.
with blocked as (
  update auth.users u
     set banned_until = timestamptz '2126-01-01 00:00:00+00',
         raw_app_meta_data = coalesce(u.raw_app_meta_data, '{}'::jsonb) || '{"sign_in_block":"staff"}'::jsonb
    from public.profiles p
   where p.id = u.id
     and not p.is_active
     and (u.banned_until is null or u.banned_until <= now())
  returning u.id
)
select count(*) as blocked from blocked;
