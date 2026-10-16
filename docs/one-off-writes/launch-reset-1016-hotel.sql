-- The listing «Hotel» (owner's decision 5 of 2026-10-16; docs/launch-reset-2026-10-16.md, «Hotel»):
-- a place for technicians' jobs that is not in Hostaway and never has a booking.
--
-- Why each value:
--   id 900000000002   properties.id is the Hostaway listing id (no sequence). The cloud's listings
--                     run 98352..597582 and rooms are 10^12 + unit id, so this band is nobody's and
--                     no sync can write it; positive, because the phone's ids are. The band
--                     900000000000..999999999999 is the analytics' test band
--                     (analytics_is_test_listing): the Hotel and its repairs stay out of every
--                     figure, as the demo listing did.
--   timezone          the default is 'UTC'; a repair's default day is the listing's local day.
--   status active     the cleaning generator reads bookings only, and this listing has none.
--   host_id           from its default, the one company (default_host_id()).
--   no parent, no unit, no address, no times: none of them is required.
--
-- Run after pass 2, with the owner's word:
--   npx supabase db query --linked -f docs/one-off-writes/launch-reset-1016-hotel.sql
-- A second run inserts nothing and returns no row. Check:
--   node scripts/cloud-read.mjs docs/rollout/launch_reset_1016_after.sql   (hotel 1)
insert into public.properties (id, name, city, country_code, timezone, status)
values (900000000002, 'Hotel', 'Prague', 'CZ', 'Europe/Prague', 'active')
on conflict (id) do nothing
returning id, name, timezone, parent_id, hostaway_unit_id, status;
