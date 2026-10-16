-- dashboard probe F: bookings - statuses, ranges, fill and raw Hostaway keys (no guest data, keys only)
select json_build_object(
  'total', (select count(*) from public.reservations),
  'by_status', (select json_object_agg(k, n) from (
      select status || case when is_block then '/block' else '' end as k, count(*) as n from public.reservations group by 1) x),
  'arrival_range', (select json_build_array(min(arrival_date), max(arrival_date)) from public.reservations),
  'departure_range', (select json_build_array(min(departure_date), max(departure_date)) from public.reservations),
  'fill', (select json_build_object(
      'check_out_time', count(check_out_time), 'check_in_time', count(check_in_time), 'guests_count', count(guests_count),
      'total_price', count(total_price), 'channel_id', count(channel_id), 'synced_at', count(synced_at)) from public.reservations),
  'channels', (select json_object_agg(c, n) from (
      select coalesce(channel_id::text, 'null') as c, count(*) as n from public.reservations group by 1) ch),
  'demo', (select count(*) from public.reservations where property_id = 900000000001),
  'with_units', (select count(distinct reservation_id) from public.reservation_units),
  'unit_rows', (select count(*) from public.reservation_units),
  'by_departure_month', (select json_object_agg(m, n) from (
      select to_char(date_trunc('month', departure_date), 'YYYY-MM') as m, count(*) as n
      from public.reservations where not is_block group by 1) d),
  'created_range', (select json_build_array(min(created_at)::date, max(created_at)::date) from public.reservations),
  'raw_count', (select count(*) from raw.hostaway_reservations),
  'raw_keys', (select json_agg(k order by k) from (select distinct jsonb_object_keys(data) as k from raw.hostaway_reservations) kk)
) as probe;
