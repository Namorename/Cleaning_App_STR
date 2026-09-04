-- Actual check-in and check-out hours of a booking.
--
-- Until now a cleaning was planned against the listing's standard hours, and
-- the booking's own times were thrown away at import. They are not the same
-- thing: a guest who buys a late check-out leaves at 12:00 where the listing
-- says 10:00, and a cleaner sent at 10:00 stands in front of an occupied door.
--
-- Established on live data on 2026-09-04, not from the documentation:
--   - all 1704 stored reservations carry `checkInTime` and `checkOutTime`;
--   - every `reservation.created` / `reservation.updated` webhook carries them
--     inside `payload.data`, so both import paths see them;
--   - the values really differ from the listing default — 22 reservations on
--     check-in, 2 on check-out (65157641 leaves at 12:00, 63364516 at 11:00);
--   - Hostaway sends them as WHOLE HOURS (integers 0-23), never minutes.
--
-- Stored as `time` rather than as an hour number: the column then means what
-- it says, sorts and compares like the listing window next to it, and survives
-- Hostaway ever gaining minutes without a data migration.
--
-- 00:00 is kept as it arrives. It means "the channel gave no time" — seen once,
-- an Airbnb booking on a listing whose check-in is 15:00 — and that reading is
-- applied where the window is computed, not here: this table records what
-- Hostaway said, interpretation belongs to one place further on.

alter table public.reservations
  add column check_in_time  time,
  add column check_out_time time;

comment on column public.reservations.check_in_time is
  'Arrival hour of this booking as Hostaway reports it. Falls back to properties.check_in_time when absent.';
comment on column public.reservations.check_out_time is
  'Departure hour of this booking as Hostaway reports it. Falls back to properties.check_out_time when absent.';

-- Backfill from the raw layer, which is exactly why it exists: the values were
-- already arriving and being stored verbatim, they were simply not normalised.
-- Anything that is not a plain hour is left null and the listing window applies.
update public.reservations r
set check_in_time =
      case when jsonb_typeof(h.data->'checkInTime') = 'number'
             and (h.data->>'checkInTime')::int between 0 and 23
           then make_time((h.data->>'checkInTime')::int, 0, 0) end,
    check_out_time =
      case when jsonb_typeof(h.data->'checkOutTime') = 'number'
             and (h.data->>'checkOutTime')::int between 0 and 23
           then make_time((h.data->>'checkOutTime')::int, 0, 0) end
from raw.hostaway_reservations h
where h.id = r.id;

/**
 * Запись выгрузки броней одной транзакцией.
 *
 * Unchanged from 20260827200000 except that the booking's own check-in and
 * check-out hours now travel with the row.
 *
 * Отдельно обрабатывается случай, который иначе ломает всю синхронизацию:
 * бронь ссылается на объект, которого у нас ещё нет. Такое бывает, когда
 * в Hostaway завели новый листинг, а sync-listings ещё не отработал.
 * Внешний ключ отверг бы всю пачку, поэтому такие брони откладываются
 * и возвращаются в поле skipped_property_ids — вызывающий по нему поймёт,
 * что пора обновить объекты.
 */
create or replace function public.sync_hostaway_reservations(
  raw_rows         jsonb,
  reservation_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw      integer;
  v_inserted integer;
  v_updated  integer;
  v_skipped  bigint[];
begin
  with incoming as (
    insert into raw.hostaway_reservations (id, data, synced_at)
    select r.id, r.data, r.synced_at
    from jsonb_to_recordset(raw_rows)
      as r(id bigint, data jsonb, synced_at timestamptz)
    on conflict (id) do update
      set data = excluded.data,
          synced_at = excluded.synced_at
    returning 1
  )
  select count(*) into v_raw from incoming;

  -- Брони, чей объект нам неизвестен.
  select coalesce(array_agg(distinct r.property_id), '{}')
  into v_skipped
  from jsonb_to_recordset(reservation_rows) as r(property_id bigint)
  where not exists (select 1 from public.properties p where p.id = r.property_id);

  with upserted as (
    insert into public.reservations (
      id, property_id, arrival_date, departure_date, status,
      channel_id, guest_name, guests_count, total_price, is_block, synced_at,
      check_in_time, check_out_time
    )
    select r.id, r.property_id, r.arrival_date, r.departure_date, r.status,
           r.channel_id, r.guest_name, r.guests_count, r.total_price,
           r.is_block, r.synced_at, r.check_in_time, r.check_out_time
    from jsonb_to_recordset(reservation_rows)
      as r(
        id bigint, property_id bigint, arrival_date date, departure_date date,
        status text, channel_id integer, guest_name text, guests_count smallint,
        total_price numeric(12,2), is_block boolean, synced_at timestamptz,
        check_in_time time, check_out_time time
      )
    where exists (select 1 from public.properties p where p.id = r.property_id)
    on conflict (id) do update
      set property_id    = excluded.property_id,
          arrival_date   = excluded.arrival_date,
          departure_date = excluded.departure_date,
          status         = excluded.status,
          channel_id     = excluded.channel_id,
          guest_name     = excluded.guest_name,
          guests_count   = excluded.guests_count,
          total_price    = excluded.total_price,
          is_block       = excluded.is_block,
          synced_at      = excluded.synced_at,
          check_in_time  = excluded.check_in_time,
          check_out_time = excluded.check_out_time
    returning (xmax = 0) as was_inserted
  )
  select
    count(*) filter (where was_inserted),
    count(*) filter (where not was_inserted)
  into v_inserted, v_updated
  from upserted;

  return jsonb_build_object(
    'raw_upserted', v_raw,
    'reservations_inserted', v_inserted,
    'reservations_updated', v_updated,
    'skipped_property_ids', to_jsonb(v_skipped)
  );
end;
$$;

revoke all on function public.sync_hostaway_reservations(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sync_hostaway_reservations(jsonb, jsonb) to service_role;
