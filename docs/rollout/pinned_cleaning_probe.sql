-- Before pushing 20260926160000_pinned_cleaning: what the first runs will do
-- to cleanings that exist today. Read-only, counts and days only — no names,
-- no ids:
--
--   node scripts/cloud-read.mjs docs/rollout/pinned_cleaning_probe.sql
--
-- The scope is the nightly sync's: departures from 7 days back to 90 ahead
-- (sync-reservations, DEFAULT_DAYS_BACK / DEFAULT_DAYS_FORWARD). Webhook runs
-- reach the same cleanings sooner, one booking at a time.
--
-- The "#" rule is written out (is_service_booking() is not executable by the
-- read role); guest names are matched inside the query and never returned.
--
--   off_departure  live cleanings of a booking that still owes one, standing on
--                  another day than its departure, by status. No row is pinned
--                  before the push, so the first run treats every one of them
--                  as "the booking moved": unassigned and assigned ones it
--                  moves back today already; accepted ones it will now move
--                  too, back to «assigned». Among them may be cleanings a
--                  manager moved by hand — the probe cannot tell the two apart.
--   not_owed       accepted cleanings of a booking that owes none any more, by
--                  reason: the new cancel pass cancels them.
with scope as (
  select current_date - 7 as d_from, current_date + 90 as d_to
),
live as (
  select t.id, t.status, t.scheduled_date, t.property_id,
         r.departure_date, r.status as r_status, r.is_block,
         coalesce(r.guest_name ~ ('^[[:space:]' || chr(160) || ']*#'), false) as is_service,
         p.status as p_status,
         (t.property_id = r.property_id
          or exists (select 1 from public.reservation_units u
                     where u.reservation_id = r.id and u.property_id = t.property_id)) as is_its_place
  from public.tasks t
  join public.reservations r on r.id = t.reservation_id
  join public.properties p on p.id = t.property_id
  cross join scope s
  where t.type = 'cleaning'
    and t.status in ('unassigned', 'assigned', 'accepted')
    and (r.departure_date between s.d_from and s.d_to
         or t.scheduled_date between s.d_from and s.d_to)
),
judged as (
  select l.*,
         (l.r_status in ('new', 'modified') and not l.is_block and not l.is_service
          and l.p_status = 'active' and l.is_its_place) as is_owed
  from live l
)
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload
  union all
  select 2, 'column_absent',
         to_jsonb(not exists (select 1 from pg_attribute a
                              where a.attrelid = 'public.tasks'::regclass
                                and a.attname = 'pinned_departure' and not a.attisdropped))
  union all
  select 3, 'off_departure',
         coalesce((select jsonb_object_agg(status, jsonb_build_object(
                     'count', n, 'first_day', first_day, 'last_day', last_day,
                     'days_off', days_off))
                   from (select j.status::text as status, count(*) as n,
                                min(j.scheduled_date) as first_day,
                                max(j.scheduled_date) as last_day,
                                jsonb_agg(distinct j.scheduled_date - j.departure_date) as days_off
                         from judged j
                         where j.is_owed and j.scheduled_date <> j.departure_date
                         group by j.status) x), '{}'::jsonb)
  union all
  select 4, 'not_owed',
         coalesce((select jsonb_object_agg(reason, n)
                   from (select case
                                  when j.r_status not in ('new', 'modified') then 'booking ' || j.r_status
                                  when j.is_block then 'block'
                                  when j.is_service then 'service booking'
                                  when j.p_status <> 'active' then 'listing ' || j.p_status
                                  else 'another listing or room'
                                end as reason,
                                count(*) as n
                         from judged j
                         where j.status = 'accepted' and not j.is_owed
                         group by 1) x), '{}'::jsonb)
) t order by ord
