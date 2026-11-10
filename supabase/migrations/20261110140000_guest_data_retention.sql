-- Guest data retention: the raw Hostaway payloads lose what no code reads, and
-- what is left of a stay goes 90 days after its departure.
--
-- DRAFT of 2026-11-10 for the owner. Applied only on the word «ретенция в raw»
-- (this file and the job switched on); the one-off strip of the rows stored
-- before it is a separate file and a separate word (backfill.sql).
--
-- What is kept without a term today (cloud, counts of 2026-11-10):
--   raw.hostaway_reservations  2 701 whole Hostaway bookings: e-mail (1 337),
--                              phone (1 156), address, guest notes, photos,
--                              guest-portal links and hashes, the booking's
--                              custom fields (2 591), the guest's names again
--                              inside reservationUnit (778 rooms). No purge.
--   raw.hostaway_listings      82 listings, overwritten daily: the listing
--                              contact's names, phones and e-mail (8), Wi-Fi
--                              credentials (2). No purge.
--   public.reservations        guest_name of every booking. No purge.
--   raw.webhook_events         processed and skipped events go at 30 days
--                              (purge-webhook-events, 20260924160000); failed
--                              ones stay for good (0 today).
--
-- 1. STRIP ON WRITE. A BEFORE INSERT OR UPDATE OF data trigger on each of the
--    two raw tables removes the keys named by raw.hostaway_reservation_personal_keys()
--    and raw.hostaway_listing_personal_keys(), and the guest's names inside every
--    reservationUnit element. A trigger rather than new bodies for
--    sync_hostaway_reservations / sync_hostaway_listings: those two stay
--    byte-for-byte what 20260912130000 and 20260912120000 made them (prosrc md5
--    ec2fc6b4 / 310fbe78, docs/rollout/*_expected.json), so no Edge Function
--    changes and nothing to redeploy; and every other writer of the raw tables
--    (a backfill, a test, a function of tomorrow) is held to the same rule.
--
--    Kept because code reads it. The raw layer exists so normalisation can be
--    replayed from it (20260824190200), so what the normalisers read stays:
--      bookings  id, listingMapId, status, arrivalDate, departureDate, channelId,
--                guestName, numberOfGuests, totalPrice, checkInTime, checkOutTime
--                — normalizeReservation (_shared/reservation.ts). guestName becomes
--                reservations.guest_name, whose leading "#" is the service-booking
--                rule (public.is_service_booking). reservationUnit[].listingUnitId
--                — reservationUnits (same file) and the backfill of 20260912130000.
--      listings  id, internalListingName, name, address, city, countryCode,
--                timeZoneName, bedroomsNumber, bathroomsNumber, personCapacity,
--                checkInTimeStart, checkOutTime, listingUnits[].id and .name —
--                normalizeListing / normalizeUnits (_shared/listing.ts).
--      planned   a listing's customFieldValues, keyPickup, airbnbAccess,
--                airbnbNotes, houseRules: F27 (access codes) and step 6 of the
--                knowledge base import them from raw.hostaway_listings
--                (docs/knowledge-base-plan.md, §1.9). No guest's data; they join
--                the list once those imports are done.
--    What is neither personal nor read stays verbatim: prices, fees, channels,
--    counts of guests, verification flags, booking codes, the guest's language.
--
-- 2. PURGE. raw.purge_guest_data(), job purge-guest-data at 05:55 UTC, created
--    INACTIVE: the owner switches it on.
--      - A raw booking goes 90 days after its departure, or once nobody has
--        written it for 90 days. A booking far ahead is written again by the
--        nightly reconciliation (departures -7..+90 days) when its turn comes;
--        nothing reads the raw layer at run time, so the gap costs nothing.
--      - reservations.guest_name becomes NULL 90 days after the departure. A
--        service booking ("#Boiler - ремонт": the office's own label, not a
--        guest) keeps its name, so is_service_booking() answers as before for
--        every row: the generator, the cleaning window, task_events, analytics
--        and manual_cleaning_time read the rule from guest_name. The row, its
--        dates, status and is_block stay; the panel shows its «no name» label,
--        as for a booking Hostaway sent without a name. The update moves
--        updated_at (reservations_touch): an API client reading bookings with
--        updated_since sees each such booking once more; the API never shows
--        guest_name.
--      - A failed webhook event goes 90 days after it arrived. Processed and
--        skipped ones already go at 30 days; pending ones are the queue.
--    05:55 UTC: outside the night window 03:00–04:40 (listings 03:00,
--    reservations 03:15, sweeps to 03:50, media 04:30, API records 04:05) and
--    after the signal purges (05:00–05:20). A webhook can write a departed
--    booking again (a late change in Hostaway); the next run clears it again.
--
-- Not covered here: the copies in the daily backups (kept by the plan's backup
-- term) and the dead row versions until autovacuum.
--
-- LOCKS. The triggers take SHARE ROW EXCLUSIVE on the two raw tables, the index
-- SHARE on raw.webhook_events (~100 000 rows, under a second): the webhook
-- intake and the processor wait for the commit. lock_timeout bounds the wait.
--
-- Tests: supabase/tests/guest_data_retention.sql.

set local lock_timeout = '3s';

-- ---------------------------------------------------------------------------
--  What goes
-- ---------------------------------------------------------------------------

/**
 * The top-level keys of a Hostaway booking that are a guest's personal data and
 * that no code reads. Counts are the cloud's of 2026-11-10 (non-empty / 2 701).
 */
create or replace function raw.hostaway_reservation_personal_keys()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array[
    -- Who the guest is and how to reach them.
    'guestFirstName',          -- 2 650
    'guestLastName',           -- 2 336
    'guestEmail',              -- 1 337
    'phone',                   -- 1 156
    'hostProxyEmail',          -- 2 701, the channel's relay address
    'guestAddress',            --   343
    'guestCity',               --   478
    'guestZipCode',            --   228
    'guestCountry',            -- 1 249
    'guestPicture',            -- 1 224
    'guestExternalAccountId',  -- 1 260
    'guestWork',
    'bookingcomBookerName',    --   125
    'bookingcomBookerCompany', --     6
    'customerUserId',
    'customerIcalId',
    'customerIcalName',
    -- Free text a guest or the office wrote about the stay.
    'guestNote',               -- 1 243
    'comment',                 -- 1 383
    'hostNote',                --   616
    'bookingcomSpecialRequests', -- 125
    -- The guest portal: a link and a hash that open the guest's own booking.
    'guestAuthHash',           -- 2 701
    'guestPortalUrl',          -- 2 701
    'guestPortalRevampUrl',
    -- The booking's custom fields and door codes.
    'customFieldValues',       -- 2 591
    'listingCustomFields',
    'doorCode',
    'doorCodeInstruction',
    'doorCodeVendor',
    -- Card and payment processor data: empty today, never ours to keep.
    'ccName',
    'ccNumber',
    'ccNumberEndingDigits',
    'ccExpirationMonth',
    'ccExpirationYear',
    'cvc',
    'braintreeGuestId',
    'braintreeMessage',
    'stripeGuestId',
    'stripeMessage',
    'rentalAgreementFileUrl'
  ]::text[]
$$;

comment on function raw.hostaway_reservation_personal_keys() is
  'Top-level keys of a Hostaway booking stripped from raw.hostaway_reservations on write: '
  'a guest''s personal data that no code reads (20261110140000).';

/** The guest's names that Hostaway repeats inside each reservationUnit element (778 today). */
create or replace function raw.hostaway_reservation_unit_personal_keys()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array['guestName', 'guestFirstName', 'guestLastName']::text[]
$$;

comment on function raw.hostaway_reservation_unit_personal_keys() is
  'Keys stripped from every reservationUnit element of a raw booking; listingUnitId stays.';

/**
 * The top-level keys of a Hostaway listing that are a person's data or a
 * credential and that no code reads (non-empty / 82 today). The listing's
 * contact is the owner's or a caretaker's person, not a guest.
 */
create or replace function raw.hostaway_listing_personal_keys()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array[
    'contactName',             -- 8
    'contactSurName',          -- 8
    'contactEmail',            -- 5
    'contactPhone1',           -- 8
    'contactPhone2',           -- 3
    'contactAddress',          -- 1
    'contactLanguage',         -- 8
    'invoicingContactName',
    'invoicingContactSurName',
    'invoicingContactEmail',
    'invoicingContactPhone1',
    'invoicingContactPhone2',
    'invoicingContactAddress',
    'invoicingContactCity',
    'invoicingContactZipcode',
    'invoicingContactCountry',
    'invoicingContactLanguage',
    'wifiUsername',            -- 2
    'wifiPassword',            -- 2
    'doorSecurityCode'
  ]::text[]
$$;

comment on function raw.hostaway_listing_personal_keys() is
  'Top-level keys of a Hostaway listing stripped from raw.hostaway_listings on write: '
  'a person''s data or a credential that no code reads (20261110140000).';

/**
 * A booking as it may be stored. Only an object is touched. A missing
 * reservationUnit stays missing and an empty one stays empty: the sync reads
 * the difference ("nothing to say" against "no rooms", _shared/reservation.ts).
 */
create or replace function raw.strip_hostaway_reservation(p_data jsonb)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_data) is distinct from 'object' then p_data
    when jsonb_typeof(p_data -> 'reservationUnit') = 'array' then
      jsonb_set(
        p_data - raw.hostaway_reservation_personal_keys(),
        '{reservationUnit}',
        coalesce(
          (select jsonb_agg(case when jsonb_typeof(u.unit) = 'object'
                                 then u.unit - raw.hostaway_reservation_unit_personal_keys()
                                 else u.unit end
                            order by u.ord)
             from jsonb_array_elements(p_data -> 'reservationUnit')
                  with ordinality as u(unit, ord)),
          '[]'::jsonb))
    else p_data - raw.hostaway_reservation_personal_keys()
  end
$$;

comment on function raw.strip_hostaway_reservation(jsonb) is
  'A Hostaway booking without raw.hostaway_reservation_personal_keys() and without the '
  'guest''s names in its reservationUnit elements. Used by the trigger and the backfill.';

/** A listing as it may be stored. Only an object is touched. */
create or replace function raw.strip_hostaway_listing(p_data jsonb)
returns jsonb
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_data) = 'object' then p_data - raw.hostaway_listing_personal_keys()
    else p_data
  end
$$;

comment on function raw.strip_hostaway_listing(jsonb) is
  'A Hostaway listing without raw.hostaway_listing_personal_keys(). Used by the trigger and the backfill.';

-- Security definer: the trigger calls the two functions above, which no role
-- but their owner may execute, whoever writes the row.
create or replace function raw.strip_hostaway_personal_data()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_schema = 'raw' and tg_table_name = 'hostaway_reservations' then
    new.data := raw.strip_hostaway_reservation(new.data);
  elsif tg_table_schema = 'raw' and tg_table_name = 'hostaway_listings' then
    new.data := raw.strip_hostaway_listing(new.data);
  else
    raise exception 'strip_hostaway_personal_data has no rule for %.%',
      tg_table_schema, tg_table_name;
  end if;
  return new;
end;
$$;

comment on function raw.strip_hostaway_personal_data() is
  'Trigger: strips personal keys from a raw Hostaway booking or listing as it is written.';

-- INSERT … ON CONFLICT DO UPDATE SET data = excluded.data, the sync's form,
-- fires both: the proposed row on insert, the updated one on update.
create trigger hostaway_reservations_strip_personal
  before insert or update of data on raw.hostaway_reservations
  for each row execute function raw.strip_hostaway_personal_data();

create trigger hostaway_listings_strip_personal
  before insert or update of data on raw.hostaway_listings
  for each row execute function raw.strip_hostaway_personal_data();

-- ---------------------------------------------------------------------------
--  What is left of a stay, 90 days after it
-- ---------------------------------------------------------------------------

-- The purge reads failed events by age; the existing partial indexes cover
-- pending (the queue) and processed/skipped (the 30-day purge) only.
create index webhook_events_failed_received_idx
  on raw.webhook_events (received_at)
  where status = 'failed';

/**
 * Daily retention of a guest's data (job purge-guest-data). Returns what it did.
 *
 * A booking's departure is its normalised row's; a raw booking with no row (its
 * listing was unknown to us) is dated by its own departureDate, compared as ISO
 * text, so a malformed date in a payload cannot stop the purge on a cast.
 */
create or replace function raw.purge_guest_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- One term for all three: a stay's data lives 90 days past its departure.
  c_keep_days constant integer := 90;
  v_cutoff_day     date        := current_date - c_keep_days;
  v_cutoff_at      timestamptz := now() - make_interval(days => c_keep_days);
  v_raw_deleted    integer;
  v_names_cleared  integer;
  v_events_deleted integer;
begin
  with gone as (
    delete from raw.hostaway_reservations h
    where h.synced_at < v_cutoff_at
       or exists (select 1 from public.reservations r
                  where r.id = h.id and r.departure_date < v_cutoff_day)
       or (not exists (select 1 from public.reservations r where r.id = h.id)
           and h.data ->> 'departureDate' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
           and h.data ->> 'departureDate' < to_char(v_cutoff_day, 'YYYY-MM-DD'))
    returning 1
  )
  select count(*) into v_raw_deleted from gone;

  -- A service booking keeps its name: it is the office's label, and the rule
  -- that makes it a block reads that name.
  with cleared as (
    update public.reservations r
    set guest_name = null
    where r.departure_date < v_cutoff_day
      and r.guest_name is not null
      and not public.is_service_booking(r.guest_name)
    returning 1
  )
  select count(*) into v_names_cleared from cleared;

  with gone as (
    delete from raw.webhook_events e
    where e.status = 'failed'
      and e.received_at < v_cutoff_at
    returning 1
  )
  select count(*) into v_events_deleted from gone;

  return jsonb_build_object(
    'departed_before', v_cutoff_day,
    'raw_reservations_deleted', v_raw_deleted,
    'guest_names_cleared', v_names_cleared,
    'failed_events_deleted', v_events_deleted
  );
end;
$$;

comment on function raw.purge_guest_data() is
  'Daily guest data retention (job purge-guest-data): raw bookings, reservations.guest_name '
  'and failed webhook events go 90 days after the stay; a service booking keeps its "#" name.';

-- Nobody but the owner (postgres, which the job runs as) calls any of these.
revoke all on function raw.hostaway_reservation_personal_keys()      from public, anon, authenticated;
revoke all on function raw.hostaway_reservation_unit_personal_keys() from public, anon, authenticated;
revoke all on function raw.hostaway_listing_personal_keys()          from public, anon, authenticated;
revoke all on function raw.strip_hostaway_reservation(jsonb)         from public, anon, authenticated;
revoke all on function raw.strip_hostaway_listing(jsonb)             from public, anon, authenticated;
revoke all on function raw.strip_hostaway_personal_data()            from public, anon, authenticated;
revoke all on function raw.purge_guest_data()                        from public, anon, authenticated;

-- Created inactive. The owner switches it on with the word «ретенция в raw»:
--   select cron.alter_job(j.jobid, active => true)
--   from cron.job j where j.jobname = 'purge-guest-data';
-- cron.schedule is idempotent by name.
select cron.schedule(
  'purge-guest-data',
  '55 5 * * *',
  $$select raw.purge_guest_data()$$
);

select cron.alter_job(j.jobid, active => false)
from cron.job j
where j.jobname = 'purge-guest-data';
