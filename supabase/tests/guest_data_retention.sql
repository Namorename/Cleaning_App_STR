-- Guest data retention (20261110140000).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
--   * the raw Hostaway payloads are stored without the guest's personal data
--     that no code reads, whoever writes them, while every field the
--     normalisers read (_shared/reservation.ts, _shared/listing.ts) stays;
--   * 90 days after a stay its raw booking, its guest name and a failed
--     webhook event of it go, and nothing that is not due;
--   * a service booking ("#…") is still a service booking afterwards: the
--     generator, the cleaning window, task_events, analytics and
--     manual_cleaning_time read that rule from reservations.guest_name;
--   * no client role can reach any of it.
--
-- Every value below is synthetic. Fixture ids live in the 900070xxx range.
begin;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

-- What the normalisers read from a stored payload: the raw layer exists so they
-- can be replayed from it. Written out here, not taken from the migration.
create temp table read_keys (tbl text, key text);
insert into read_keys values
  ('booking', 'id'), ('booking', 'listingMapId'), ('booking', 'status'),
  ('booking', 'arrivalDate'), ('booking', 'departureDate'), ('booking', 'channelId'),
  ('booking', 'guestName'), ('booking', 'numberOfGuests'), ('booking', 'totalPrice'),
  ('booking', 'checkInTime'), ('booking', 'checkOutTime'), ('booking', 'reservationUnit'),
  ('listing', 'id'), ('listing', 'internalListingName'), ('listing', 'name'),
  ('listing', 'address'), ('listing', 'city'), ('listing', 'countryCode'),
  ('listing', 'timeZoneName'), ('listing', 'bedroomsNumber'), ('listing', 'bathroomsNumber'),
  ('listing', 'personCapacity'), ('listing', 'checkInTimeStart'), ('listing', 'checkOutTime'),
  ('listing', 'listingUnits'),
  -- Planned readers: F27 and step 6 of the knowledge base (docs/knowledge-base-plan.md §1.9).
  ('listing', 'customFieldValues'), ('listing', 'keyPickup'), ('listing', 'airbnbAccess'),
  ('listing', 'airbnbNotes'), ('listing', 'houseRules');

/** A Hostaway booking carrying every key the migration strips, and the ones it keeps. */
create or replace function pg_temp.booking_payload(p_id bigint, p_departure date, p_guest text)
returns jsonb language sql as $fn$
  select (select jsonb_object_agg(k, to_jsonb('synthetic ' || k))
            from unnest(raw.hostaway_reservation_personal_keys()) k)
      || jsonb_build_object(
           'id', p_id, 'listingMapId', 900070001, 'status', 'new',
           'arrivalDate', to_char(p_departure - 2, 'YYYY-MM-DD'),
           'departureDate', to_char(p_departure, 'YYYY-MM-DD'),
           'channelId', 2018, 'guestName', p_guest, 'numberOfGuests', 2,
           'totalPrice', 100, 'checkInTime', 15, 'checkOutTime', 10,
           'reservationUnit', jsonb_build_array(
             jsonb_build_object('id', 1, 'listingUnitId', 65001, 'adults', 2,
                                'guestName', p_guest, 'guestFirstName', 'Synthetic',
                                'guestLastName', 'Guest'),
             jsonb_build_object('id', 2, 'listingUnitId', 65002, 'adults', 1,
                                'guestName', p_guest, 'guestFirstName', 'Synthetic',
                                'guestLastName', 'Guest')),
           'adults', 2, 'confirmationCode', 'HMSYNTHETIC', 'guestLocale', 'cs',
           'financeField', '[{"id": 1, "name": "baseRate", "total": 100}]'::jsonb,
           -- The inventory's sensitive keys, written out rather than read from the list.
           'guestEmail', 'synthetic@example.invalid', 'phone', '+000 000 000',
           'guestAddress', 'Synthetic street 1', 'guestNote', 'synthetic note',
           'guestPicture', 'https://example.invalid/synthetic.jpg', 'doorCode', '0000',
           'customFieldValues', '[{"customFieldId": 1, "value": "0000"}]'::jsonb)
$fn$;

/** How many of the given keys a stored payload still carries at its top level. */
create or replace function pg_temp.carried(p_data jsonb, p_keys text[]) returns int
language sql as $fn$
  select count(*)::int from jsonb_object_keys(p_data) k where k = any(p_keys)
$fn$;

create or replace function pg_temp.raw_booking(p_id bigint) returns jsonb language sql as $fn$
  select h.data from raw.hostaway_reservations h where h.id = p_id
$fn$;

-- The sensitive keys of the inventory, independent of the migration's list.
create temp table inventory_keys (key text);
insert into inventory_keys values
  ('guestEmail'), ('phone'), ('guestAddress'), ('guestCity'), ('guestZipCode'),
  ('guestNote'), ('guestPicture'), ('guestFirstName'), ('guestLastName'),
  ('customFieldValues'), ('doorCode'), ('doorCodeInstruction'), ('doorCodeVendor');

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900070001, 'Retention flat', 'UTC', '15:00', '10:00');

-- ===========================================================================
-- Shape and grants
-- ===========================================================================

select pg_temp.check('1 the sync of bookings is the body of 20260912130000, byte for byte',
  (select left(md5(p.prosrc), 8) from pg_proc p
   where p.oid = 'public.sync_hostaway_reservations(jsonb, jsonb, jsonb)'::regprocedure),
  'ec2fc6b4');

select pg_temp.check('2 the sync of listings is the body of 20260912120000, byte for byte',
  (select left(md5(p.prosrc), 8) from pg_proc p
   where p.oid = 'public.sync_hostaway_listings(jsonb, jsonb, jsonb)'::regprocedure),
  '310fbe78');

select pg_temp.check('3 both raw tables strip on insert and on update, before the row is stored',
  (select string_agg(event_object_table || ' ' || event_manipulation, ', '
                     order by event_object_table, event_manipulation)
   from information_schema.triggers
   where event_object_schema = 'raw'
     and trigger_name in ('hostaway_reservations_strip_personal', 'hostaway_listings_strip_personal')
     and action_timing = 'BEFORE' and action_orientation = 'ROW'),
  'hostaway_listings INSERT, hostaway_listings UPDATE, '
  || 'hostaway_reservations INSERT, hostaway_reservations UPDATE');

select pg_temp.check('4 the purge job is scheduled once',
  (select count(*)::int from cron.job where jobname = 'purge-guest-data'), 1);

select pg_temp.check('5 at 05:55 UTC, outside the night window 03:00–04:40',
  (select schedule from cron.job where jobname = 'purge-guest-data'), '55 5 * * *');

select pg_temp.check('6 created switched off: the owner turns it on',
  (select active from cron.job where jobname = 'purge-guest-data'), false);

select pg_temp.check('7 it calls the purge and nothing else',
  (select command from cron.job where jobname = 'purge-guest-data'),
  'select raw.purge_guest_data()');

select pg_temp.check('8 the purge runs as its owner with an empty search_path',
  (select p.prosecdef::text || ' ' || array_to_string(p.proconfig, ',')
   from pg_proc p where p.oid = 'raw.purge_guest_data()'::regprocedure),
  'true search_path=""');

create temp table new_functions (oid regprocedure);
insert into new_functions values
  ('raw.hostaway_reservation_personal_keys()'), ('raw.hostaway_reservation_unit_personal_keys()'),
  ('raw.hostaway_listing_personal_keys()'), ('raw.strip_hostaway_reservation(jsonb)'),
  ('raw.strip_hostaway_listing(jsonb)'), ('raw.strip_hostaway_personal_data()'),
  ('raw.purge_guest_data()');

select pg_temp.check('9 no client role may execute any of the new functions',
  (select coalesce(string_agg(r || ' ' || f.oid::text, ', '), '')
   from new_functions f cross join unnest(array['anon', 'authenticated']) r
   where has_function_privilege(r, f.oid, 'EXECUTE')),
  '');

select pg_temp.check('10 none carries PUBLIC in its ACL, written or built in',
  (select coalesce(string_agg(f.oid::text, ', '), '')
   from new_functions f
   join pg_proc p on p.oid = f.oid
   cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
   where g.grantee = 0),
  '');

-- A real call as a client, not only the catalogue's word for it.
select set_config('test.refusal', '', true);
set local role authenticated;
do $$ begin
  perform raw.purge_guest_data();
  perform set_config('test.refusal', 'no refusal', true);
exception when others then
  perform set_config('test.refusal', sqlstate, true);
end $$;
reset role;
select pg_temp.check('11 a signed-in client calling the purge is refused',
  current_setting('test.refusal'), '42501');

select set_config('test.refusal', '', true);
set local role anon;
do $$ begin
  perform raw.strip_hostaway_reservation('{}'::jsonb);
  perform set_config('test.refusal', 'no refusal', true);
exception when others then
  perform set_config('test.refusal', sqlstate, true);
end $$;
reset role;
select pg_temp.check('12 so is anon calling a strip function',
  current_setting('test.refusal'), '42501');

select pg_temp.check('13 no key a normaliser reads is on the booking list',
  (select coalesce(string_agg(key, ', '), '') from read_keys
   where tbl = 'booking' and key = any(raw.hostaway_reservation_personal_keys())),
  '');

select pg_temp.check('14 the room of a booking is not on the list of its rooms',
  'listingUnitId' = any(raw.hostaway_reservation_unit_personal_keys()), false);

select pg_temp.check('15 no key a normaliser or a planned import reads is on the listing list',
  (select coalesce(string_agg(key, ', '), '') from read_keys
   where tbl = 'listing' and key = any(raw.hostaway_listing_personal_keys())),
  '');

-- ===========================================================================
-- Stripping on write: through the sync itself
-- ===========================================================================

create temp table sent as
select pg_temp.booking_payload(900070011, current_date + 3, 'Synthetic Guest') as data;

create temp table synced as
select public.sync_hostaway_reservations(
  jsonb_build_array(jsonb_build_object(
    'id', 900070011, 'data', (select data from sent), 'synced_at', now())),
  jsonb_build_array(jsonb_build_object(
    'id', 900070011, 'property_id', 900070001,
    'arrival_date', current_date + 1, 'departure_date', current_date + 3,
    'status', 'new', 'channel_id', 2018, 'guest_name', 'Synthetic Guest',
    'guests_count', 2, 'total_price', 100, 'is_block', false, 'synced_at', now())),
  null) as answer;

select pg_temp.check('16 the sync writes the booking as before',
  (select (answer ->> 'raw_upserted')::int + (answer ->> 'reservations_inserted')::int from synced), 2);

select pg_temp.check('17 the stored booking carries none of the stripped keys',
  pg_temp.carried(pg_temp.raw_booking(900070011), raw.hostaway_reservation_personal_keys()), 0);

select pg_temp.check('18 nor any sensitive key of the inventory',
  pg_temp.carried(pg_temp.raw_booking(900070011), (select array_agg(key) from inventory_keys)), 0);

select pg_temp.check('19 every field the normaliser reads is stored as sent',
  (select coalesce(string_agg(k.key, ', '), '')
   from read_keys k, sent s
   where k.tbl = 'booking' and k.key <> 'reservationUnit'
     and pg_temp.raw_booking(900070011) -> k.key is distinct from s.data -> k.key),
  '');

select pg_temp.check('20 each room keeps its listingUnitId, in order',
  (select string_agg(u.unit ->> 'listingUnitId', ',' order by u.ord)
   from jsonb_array_elements(pg_temp.raw_booking(900070011) -> 'reservationUnit')
        with ordinality as u(unit, ord)),
  '65001,65002');

select pg_temp.check('21 and no room carries the guest''s names',
  (select count(*)::int
   from jsonb_array_elements(pg_temp.raw_booking(900070011) -> 'reservationUnit') u(unit)
   where u.unit ?| raw.hostaway_reservation_unit_personal_keys()),
  0);

select pg_temp.check('22 what is neither personal nor read stays verbatim',
  (select count(*)::int from sent s, unnest(array['adults', 'confirmationCode',
                                                  'guestLocale', 'financeField']) k
   where pg_temp.raw_booking(900070011) -> k = s.data -> k),
  4);

select pg_temp.check('23 the booking row keeps its guest name: stripping is the raw layer''s',
  (select guest_name from public.reservations where id = 900070011), 'Synthetic Guest');

-- The update path of the same upsert, with a changed status.
select public.sync_hostaway_reservations(
  jsonb_build_array(jsonb_build_object(
    'id', 900070011,
    'data', pg_temp.booking_payload(900070011, current_date + 3, 'Synthetic Guest')
            || '{"status": "modified"}'::jsonb,
    'synced_at', now())),
  '[]'::jsonb, null);

select pg_temp.check('24 written again, it is stripped again',
  pg_temp.carried(pg_temp.raw_booking(900070011), raw.hostaway_reservation_personal_keys()), 0);

select pg_temp.check('25 and the change itself is stored',
  pg_temp.raw_booking(900070011) ->> 'status', 'modified');

-- Any writer, not only the sync.
update raw.hostaway_reservations
set data = data || '{"guestEmail": "late@example.invalid", "hostNote": "synthetic"}'::jsonb
where id = 900070011;

select pg_temp.check('26 a direct write is held to the same rule',
  pg_temp.raw_booking(900070011) ?| array['guestEmail', 'hostNote'], false);

-- "Nothing to say about rooms" and "no rooms" must stay apart.
insert into raw.hostaway_reservations (id, data) values
  (900070012, pg_temp.booking_payload(900070012, current_date + 3, 'Synthetic') - 'reservationUnit'),
  (900070013, jsonb_set(pg_temp.booking_payload(900070013, current_date + 3, 'Synthetic'),
                        '{reservationUnit}', '[]'));

select pg_temp.check('27 a booking without reservationUnit gains none',
  pg_temp.raw_booking(900070012) ? 'reservationUnit', false);

select pg_temp.check('28 an empty reservationUnit stays an empty array',
  pg_temp.raw_booking(900070013) -> 'reservationUnit', '[]'::jsonb);

select pg_temp.check('29 a payload that is not an object is stored as it came',
  raw.strip_hostaway_reservation('["guestEmail"]'::jsonb), '["guestEmail"]'::jsonb);

-- Listings, through their sync.
create temp table listing_sent as
select (select jsonb_object_agg(k, to_jsonb('synthetic ' || k))
          from unnest(raw.hostaway_listing_personal_keys()) k)
    || jsonb_build_object(
         'id', 900070002, 'internalListingName', 'CZ - Synthetic 1', 'name', 'Synthetic flat',
         'address', 'Synthetic street 2', 'city', 'Praha', 'countryCode', 'CZ',
         'timeZoneName', 'Europe/Prague', 'bedroomsNumber', 2, 'bathroomsNumber', 1,
         'personCapacity', 4, 'checkInTimeStart', 15, 'checkOutTime', 10,
         'listingUnits', '[]'::jsonb,
         'customFieldValues', '[{"customFieldId": 91710, "value": "0000"}]'::jsonb,
         'keyPickup', 'synthetic', 'airbnbAccess', 'synthetic', 'airbnbNotes', 'synthetic',
         'houseRules', 'synthetic', 'price', 100) as data;

select public.sync_hostaway_listings(
  jsonb_build_array(jsonb_build_object(
    'id', 900070002, 'data', (select data from listing_sent), 'synced_at', now())),
  jsonb_build_array(jsonb_build_object(
    'id', 900070002, 'name', 'CZ - Synthetic 1', 'timezone', 'Europe/Prague', 'synced_at', now())),
  null);

select pg_temp.check('30 the stored listing carries no contact and no Wi-Fi credential',
  pg_temp.carried((select data from raw.hostaway_listings where id = 900070002),
                  raw.hostaway_listing_personal_keys()), 0);

select pg_temp.check('31 every field the listing normaliser and the planned imports read stays',
  (select coalesce(string_agg(k.key, ', '), '')
   from read_keys k, listing_sent s
   where k.tbl = 'listing'
     and (select data from raw.hostaway_listings where id = 900070002) -> k.key
         is distinct from s.data -> k.key),
  '');

select pg_temp.check('32 the listing''s property row is written as before',
  (select name from public.properties where id = 900070002), 'CZ - Synthetic 1');

-- ===========================================================================
-- The purge
-- ===========================================================================

-- The stand is shared: whatever else is due goes first, inside this
-- transaction, so the counts below are the fixtures' own.
select raw.purge_guest_data();

insert into public.reservations
  (id, property_id, arrival_date, departure_date, status, guest_name, is_block) values
  -- departed 91 days ago: due
  (900070101, 900070001, current_date - 93, current_date - 91, 'new', 'Synthetic A', false),
  -- departed exactly 90 days ago: not yet
  (900070102, 900070001, current_date - 92, current_date - 90, 'new', 'Synthetic B', false),
  -- service bookings long gone: the office's label stays
  (900070103, 900070001, current_date - 122, current_date - 120, 'new', '#Boiler - repair', false),
  (900070104, 900070001, current_date - 122, current_date - 120, 'new', chr(160) || '#Inspection', false),
  -- far ahead, its raw copy not written for 91 days
  (900070105, 900070001, current_date + 198, current_date + 200, 'new', 'Synthetic E', false),
  -- departed yesterday
  (900070106, 900070001, current_date - 3, current_date - 1, 'new', 'Synthetic F', false),
  -- an owner stay long gone: the name goes, the block stays a block
  (900070107, 900070001, current_date - 102, current_date - 100, 'ownerStay', 'Synthetic Owner', true),
  -- long gone, no name to begin with
  (900070108, 900070001, current_date - 102, current_date - 100, 'new', null, false);

insert into raw.hostaway_reservations (id, data, synced_at)
select r.id, pg_temp.booking_payload(r.id, r.departure_date, r.guest_name),
       case when r.id = 900070105 then now() - interval '91 days' else now() end
from public.reservations r
where r.id between 900070101 and 900070108;

-- Raw bookings with no booking row: their listing was unknown to us.
insert into raw.hostaway_reservations (id, data, synced_at) values
  (900070201, pg_temp.booking_payload(900070201, current_date - 100, 'Synthetic G'), now()),
  (900070202, pg_temp.booking_payload(900070202, current_date + 5, 'Synthetic H'), now()),
  (900070203, pg_temp.booking_payload(900070203, current_date - 100, 'Synthetic I')
              || '{"departureDate": "soon"}'::jsonb, now()),
  (900070204, pg_temp.booking_payload(900070204, current_date - 100, 'Synthetic J')
              || '{"departureDate": "soon"}'::jsonb, now() - interval '91 days');

insert into raw.webhook_events (object_type, object_id, event_type, payload, status, received_at) values
  ('reservation', 900070301, 'reservation.updated', '{}', 'failed',    now() - interval '91 days'),
  ('reservation', 900070302, 'reservation.updated', '{}', 'failed',    now() - interval '89 days'),
  ('reservation', 900070303, 'reservation.updated', '{}', 'processed', now() - interval '91 days'),
  ('reservation', 900070304, 'reservation.updated', '{}', 'pending',   now() - interval '91 days'),
  ('reservation', 900070305, 'reservation.updated', '{}', 'skipped',   now() - interval '91 days');

-- What the generator and the readers of the "#" rule see, before.
create temp table before_purge as
select r.id, r.arrival_date, r.departure_date, r.status, r.is_block,
       public.is_service_booking(r) as is_service
from public.reservations r
where r.id between 900070101 and 900070108;

create temp table answer as select raw.purge_guest_data() as a;

select pg_temp.check('33 the purge says what it did',
  (select (a ->> 'raw_reservations_deleted') || ' ' || (a ->> 'guest_names_cleared')
          || ' ' || (a ->> 'failed_events_deleted') from answer),
  '8 2 1');

select pg_temp.check('34 raw bookings 90 days past the stay, or unwritten for 90 days, are gone',
  (select string_agg(id::text, ',' order by id) from raw.hostaway_reservations
   where id between 900070101 and 900070299),
  '900070102,900070106,900070202,900070203');

select pg_temp.check('35 guest names 90 days past the stay are cleared, the rest stay',
  (select string_agg(id::text || '=' || coalesce(guest_name, '∅'), ', ' order by id)
   from public.reservations where id between 900070101 and 900070108),
  '900070101=∅, 900070102=Synthetic B, 900070103=#Boiler - repair, '
  || '900070104=' || chr(160) || '#Inspection, 900070105=Synthetic E, 900070106=Synthetic F, '
  || '900070107=∅, 900070108=∅');

select pg_temp.check('36 no booking row is deleted',
  (select count(*)::int from public.reservations where id between 900070101 and 900070108), 8);

select pg_temp.check('37 every booking is a service booking exactly when it was before',
  (select count(*)::int from before_purge b join public.reservations r using (id)
   where public.is_service_booking(r) is distinct from b.is_service),
  0);

select pg_temp.check('38 and both service bookings are still service bookings',
  (select count(*)::int from public.reservations r
   where r.id between 900070101 and 900070108 and public.is_service_booking(r.guest_name)),
  2);

select pg_temp.check('39 dates, status and is_block are untouched',
  (select count(*)::int from before_purge b join public.reservations r using (id)
   where (r.arrival_date, r.departure_date, r.status, r.is_block)
         is distinct from (b.arrival_date, b.departure_date, b.status, b.is_block)),
  0);

select pg_temp.check('40 only a failed event 90 days old goes; the queue and the 30-day purge''s rows stay',
  (select string_agg(object_id::text || ' ' || status::text, ', ' order by object_id)
   from raw.webhook_events where object_id between 900070301 and 900070305),
  '900070302 failed, 900070303 processed, 900070304 pending, 900070305 skipped');

-- The job's own command, a second time: nothing more is due.
do $$ begin
  execute (select command from cron.job where jobname = 'purge-guest-data');
end $$;

select pg_temp.check('41 run again by the job, it finds nothing more among the fixtures',
  (select count(*)::int from raw.hostaway_reservations where id between 900070101 and 900070299)
  + (select count(*)::int from public.reservations
     where id between 900070101 and 900070108 and guest_name is not null)
  + (select count(*)::int from raw.webhook_events where object_id between 900070301 and 900070305),
  4 + 5 + 4);

select pg_temp.check('42 a second direct run deletes and clears nothing',
  (select raw.purge_guest_data() - 'departed_before'),
  '{"guest_names_cleared": 0, "failed_events_deleted": 0, "raw_reservations_deleted": 0}'::jsonb);

rollback;
