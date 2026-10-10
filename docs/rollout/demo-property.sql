-- The one demo listing for Apple's App Review (owner's plan of 2026-10-10, block 5;
-- the owner allowed exactly one insert into the production database). The demo
-- cleaner the reviewer signs in as is linked to this listing alone, so she sees
-- nothing of the real company: no real address, no booking, no guest.
--
-- What the row is, and why it cannot meet a real one:
--   id 900000000001   properties.id is the Hostaway listing id; the cloud's
--                     listings run 98352..597582 and rooms are 10^12 + unit id
--                     (property_id_for_unit), so this band is nobody's. Positive,
--                     because the phone's links hold a property id positive.
--   no parent, no unit, no booking: sync-listings and sync-reservations only
--                     write the ids Hostaway sends, and never delete a listing.
--   made-up name and address, in English for the reviewer.
--
-- Run once, the owner confirming the tool call:
--   npx supabase db query --linked -f docs/rollout/demo-property.sql
-- A second run inserts nothing and returns no row. Before and after:
--   node scripts/cloud-read.mjs docs/rollout/demo_property_probe.sql
-- The launch reset keeps this row and what hangs on it (docs/launch-reset.md).
insert into public.properties
  (id, name, address, city, country_code, timezone, check_in_time, check_out_time, status)
values
  (900000000001, 'Demo Apartment', 'Demo Street 1', 'Prague', 'CZ', 'Europe/Prague',
   '15:00', '10:00', 'active')
on conflict (id) do nothing
returning id, name, address, parent_id, hostaway_unit_id, status;
