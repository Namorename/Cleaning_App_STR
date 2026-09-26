-- Before pushing 20260926160000_pinned_cleaning: what the first runs will do
-- to cleanings that exist today, under the owner's rule of 2026-09-27 (the
-- cleaning follows its booking). Read-only, counts and days only — no names,
-- no ids:
--
--   node scripts/cloud-read.mjs docs/rollout/pinned_cleaning_probe.sql
--
-- The scope is the nightly sync's: cleanings on a day from 7 days back to 90
-- ahead, or of a booking leaving in that range (sync-reservations,
-- DEFAULT_DAYS_BACK / DEFAULT_DAYS_FORWARD). Webhook runs reach the same
-- cleanings sooner, one booking at a time. Only work nobody has started:
-- unassigned, assigned, accepted.
--
-- The "#" rule is written out (is_service_booking() is not executable by the
-- read role); guest names are matched inside the query and never returned.
--
--   columns_absent    true: neither pinned_arrival nor pinned_departure yet.
--   off_departure     cleanings of a booking that still owes them, in the
--                     right place, on another day than its departure, by
--                     status. No cleaning is moved by a manager before the
--                     push, so the first run takes every one of them to the
--                     departure — as it does today for unassigned and
--                     assigned; accepted is new. Cleanings a manager moved by
--                     hand before the push are among them: the probe cannot
--                     tell the two apart.
--   other_room        cleanings of a booking that still owes one, standing on
--                     its listing or one of its rooms where it owes none now
--                     (the guest was moved, or the rooms named later). The
--                     relocate pass takes each to a place the booking owes and
--                     has no cleaning on; today the unassigned and assigned
--                     ones on a room would be cancelled and a stranger written.
--   beyond_the_night  cleanings on a day of the scope whose booking now leaves
--                     outside it. Today the nightly run cancels them; now they
--                     follow the booking. Counted in off_departure as well.
--   not_owed          cleanings of a booking that owes none any more (or not
--                     there), by status and reason: the cancel pass cancels
--                     them — unassigned and assigned as today, accepted new.
with scope as (
  select current_date - 7 as d_from, current_date + 90 as d_to
),
live as (
  select t.id, t.status, t.scheduled_date, t.property_id,
         r.property_id as listing_id, r.departure_date, r.status as r_status, r.is_block,
         coalesce(r.guest_name ~ ('^[[:space:]' || chr(160) || ']*#'), false) as is_service,
         p.status as p_status, p.parent_id, p.hostaway_unit_id,
         exists (select 1 from public.reservation_units u
                 where u.reservation_id = r.id) as has_rooms,
         exists (select 1 from public.reservation_units u
                 where u.reservation_id = r.id and u.property_id = t.property_id) as on_its_room,
         (r.departure_date not between s.d_from and s.d_to) as leaves_outside
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
         (l.r_status in ('new', 'modified') and not l.is_block and not l.is_service) as booking_owes,
         -- The generator's own place: a room the booking took, else its listing.
         (case when l.has_rooms then l.on_its_room else l.property_id = l.listing_id end
          and l.p_status = 'active') as in_its_place,
         (l.property_id = l.listing_id
          or (l.parent_id = l.listing_id and l.hostaway_unit_id is not null)) as in_its_listing
  from live l
)
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload
  union all
  select 2, 'columns_absent',
         to_jsonb(not exists (select 1 from pg_attribute a
                              where a.attrelid = 'public.tasks'::regclass
                                and a.attname in ('pinned_arrival', 'pinned_departure')
                                and not a.attisdropped))
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
                         where j.booking_owes and j.in_its_place
                           and j.scheduled_date <> j.departure_date
                         group by j.status) x), '{}'::jsonb)
  union all
  select 4, 'other_room',
         coalesce((select jsonb_object_agg(status, n)
                   from (select j.status::text as status, count(*) as n
                         from judged j
                         where j.booking_owes and not j.in_its_place and j.in_its_listing
                           and j.p_status = 'active'
                         group by j.status) x), '{}'::jsonb)
  union all
  select 5, 'beyond_the_night',
         coalesce((select jsonb_object_agg(status, n)
                   from (select j.status::text as status, count(*) as n
                         from judged j
                         where j.booking_owes and j.leaves_outside
                         group by j.status) x), '{}'::jsonb)
  union all
  select 6, 'not_owed',
         coalesce((select jsonb_object_agg(reason, n)
                   from (select j.status::text || ': ' || case
                                  when j.r_status not in ('new', 'modified') then 'booking ' || j.r_status
                                  when j.is_block then 'block'
                                  when j.is_service then 'service booking'
                                  when j.p_status <> 'active' then 'listing ' || j.p_status
                                  else 'another listing or room'
                                end as reason,
                                count(*) as n
                         from judged j
                         where not (j.booking_owes and j.in_its_place)
                         group by 1) x), '{}'::jsonb)
) t order by ord
