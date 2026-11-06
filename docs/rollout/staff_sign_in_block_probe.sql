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
--                     a role that cannot read the table would show the numbers below as 0 and pass
--                     for healthy, so read this one first.
--   disabled          profiles switched off.
--   disabled_blocked  those of them that a block holds right now. After the backfill it equals
--                     disabled; below it means a block is missing: a save that failed and was not
--                     repeated, a process that died between the row and Auth, two opposite saves
--                     at once, or a row switched off past manage-staff.
--   active_marked     profiles working whose account carries the marker sign_in_block = staff.
--                     MUST BE 0: such a person is shown as working and manage-staff's block still
--                     stands (a lift that failed, a process that died, two opposite saves at once).
--                     The same save of that person again repairs it.
--   active_blocked    profiles working that any block holds right now. Each one is either counted
--                     in active_marked or is a ban somebody set by hand, which manage-staff leaves
--                     alone. 0 unless the owner banned somebody by hand.
--   set_by_backfill   accounts carrying the backfill's marker and date: what the rollback lifts.
--
-- A date that has passed holds nobody, so it is compared with now(), not with null. The marker is
-- read with ->>, so a key left as a JSON null does not count as one.
select
  count(*) as profiles,
  count(u.id) as seen_in_auth,
  count(*) filter (where not p.is_active) as disabled,
  count(*) filter (where not p.is_active and u.banned_until > now()) as disabled_blocked,
  count(*) filter (where p.is_active and u.raw_app_meta_data ->> 'sign_in_block' = 'staff') as active_marked,
  count(*) filter (where p.is_active and u.banned_until > now()) as active_blocked,
  count(*) filter (
    where u.banned_until = timestamptz '2126-01-01 00:00:00+00'
      and u.raw_app_meta_data ->> 'sign_in_block' = 'staff'
  ) as set_by_backfill
from public.profiles p
left join auth.users u on u.id = p.id;
