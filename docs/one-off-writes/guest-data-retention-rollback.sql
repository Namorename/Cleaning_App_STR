-- Takes 20261111100000_guest_data_retention away. A WRITE to the cloud: only on
-- the owner's word, never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f rollback.sql
--   npx supabase migration repair --status reverted 20261111100000 --linked
--
-- and the migration file leaves supabase/migrations/ in the same change.
--
-- One statement: db query takes one. The job, the two triggers, the seven
-- functions and the index go; from then on the raw layer stores Hostaway's
-- payloads whole again and nothing is purged on a guest's account.
-- sync_hostaway_reservations / sync_hostaway_listings were never changed, and
-- no Edge Function either, so there is nothing of theirs to restore.
--
-- What the purge deleted and the strip removed does not come back: only the
-- daily backups hold it.
do $rollback$
begin
  perform set_config('lock_timeout', '5s', true);

  perform cron.unschedule(j.jobid) from cron.job j where j.jobname = 'purge-guest-data';

  drop trigger if exists hostaway_reservations_strip_personal on raw.hostaway_reservations;
  drop trigger if exists hostaway_listings_strip_personal on raw.hostaway_listings;

  drop function if exists raw.purge_guest_data();
  drop function if exists raw.strip_hostaway_personal_data();
  drop function if exists raw.strip_hostaway_reservation(jsonb);
  drop function if exists raw.strip_hostaway_listing(jsonb);
  drop function if exists raw.hostaway_reservation_personal_keys();
  drop function if exists raw.hostaway_reservation_unit_personal_keys();
  drop function if exists raw.hostaway_listing_personal_keys();

  drop index if exists raw.webhook_events_failed_received_idx;
end
$rollback$;
