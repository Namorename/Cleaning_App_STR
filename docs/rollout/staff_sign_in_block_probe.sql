-- The block on signing in of people switched off: where the cloud stands.
-- Read-only, one statement, counts only: no names, no e-mails, no ids of people.
--
--   node scripts/cloud-read.mjs docs/rollout/staff_sign_in_block_probe.sql
--
-- Run before and after docs/one-off-writes/staff-sign-in-block-backfill.sql, and whenever somebody
-- doubts the block. What it answers:
--
--   profiles          every profile.
--   seen_in_auth      those whose account this read could see in auth.users. Must equal profiles:
--                     a role that cannot read the table would show the three numbers below as 0
--                     and pass for healthy, so read this one first.
--   disabled          profiles switched off.
--   disabled_blocked  those of them that a block holds right now. After the backfill it equals
--                     disabled; below it means a block is missing: a save that failed and was not
--                     repeated, or a row switched off past manage-staff.
--   active_blocked    profiles working that a block holds right now. MUST BE 0: such a person is
--                     shown as working and cannot sign in (a lift that failed and was not repeated).
--   set_by_backfill   accounts carrying the backfill's own date: what the rollback would lift.
--
-- A date that has passed holds nobody, so it is compared with now(), not with null.
select
  count(*) as profiles,
  count(u.id) as seen_in_auth,
  count(*) filter (where not p.is_active) as disabled,
  count(*) filter (where not p.is_active and u.banned_until > now()) as disabled_blocked,
  count(*) filter (where p.is_active and u.banned_until > now()) as active_blocked,
  count(*) filter (where u.banned_until = timestamptz '2126-01-01 00:00:00+00') as set_by_backfill
from public.profiles p
left join auth.users u on u.id = p.id;
