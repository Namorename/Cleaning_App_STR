-- One-off: strips the personal keys from the raw Hostaway rows stored before
-- 20261110140000_guest_data_retention. A WRITE to the cloud: only on the owner's
-- word «чистка raw» (separate from «ретенция в raw»), after that migration is in,
-- never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f backfill.sql
--
-- One statement: db query takes one. Idempotent: a row already stripped is not
-- written again, so a run stopped by a lock wait is simply run again.
--
-- What it touches (cloud, 2026-11-10): up to 2 701 bookings and 8 listings
-- (the listings whose contact or Wi-Fi fields are filled). Without it, a stored
-- booking loses its keys only when the sync writes it again (every night for
-- departures -7..+90 days, by webhook otherwise) or when the purge deletes it.
--
-- LOCKS. Both tables are locked against writers first (SHARE ROW EXCLUSIVE):
-- the webhook processor (every 2 minutes) and the syncs wait the few seconds
-- this takes instead of deadlocking with it row by row; Hostaway's intake writes
-- raw.webhook_events and is not held. lock_timeout bounds the wait for the lock.
--
-- Not undoable: the stripped values exist afterwards only in the daily backups.
do $backfill$
declare
  v_bookings integer;
  v_listings integer;
begin
  if to_regprocedure('raw.strip_hostaway_reservation(jsonb)') is null
     or to_regprocedure('raw.strip_hostaway_listing(jsonb)') is null then
    raise exception 'guest data backfill: 20261110140000_guest_data_retention is not applied';
  end if;

  perform set_config('lock_timeout', '5s', true);
  lock table raw.hostaway_reservations, raw.hostaway_listings in share row exclusive mode;

  update raw.hostaway_reservations h
  set data = raw.strip_hostaway_reservation(h.data)
  where h.data is distinct from raw.strip_hostaway_reservation(h.data);
  get diagnostics v_bookings = row_count;

  update raw.hostaway_listings l
  set data = raw.strip_hostaway_listing(l.data)
  where l.data is distinct from raw.strip_hostaway_listing(l.data);
  get diagnostics v_listings = row_count;

  raise notice 'guest data backfill: % bookings and % listings stripped', v_bookings, v_listings;
end
$backfill$;
