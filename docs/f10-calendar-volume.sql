-- Calendar volume probe for F10 stage 7 (/calendar, docs/f10-plan.md).
--
-- Read-only and counts only: no names, no guest data, no addresses, and no id of a
-- person, property or booking. Timezone names and calendar dates are returned; they
-- are configuration, not personal data. One statement, one result set of
-- (metric text, value jsonb), ordered:
--
--   npx supabase db query --linked -f docs/f10-calendar-volume.sql
--
-- Measured 2026-09-23 for the stage 7 plan (docs/f10-plan.md, "Этап 7. Календарь — план").
-- Re-run before stage 7.6 and after the expired duplicates are cleaned up. Metric i1 was
-- added after that run from a separate query of the same logic, and i2-i4 after the plan
-- review; since then the whole file has run only against the local stack (all 34 metrics
-- answer), not against the cloud.
--
-- Definitions, read from supabase/migrations (latest definition of each name wins):
--   room             properties.hostaway_unit_id is not null          20260912120000:54-68
--   multi_unit       a listing with at least one room under parent_id
--   combined_parent  a listing with a child whose hostaway_unit_id is null (20260905093000:13-18)
--   combined_part    parent_id not null and hostaway_unit_id null
--   plain            none of the above
--   group            coalesce(parent_id, id): the row a nested row collapses into
--   live task        status not in (done, cancelled, expired)          20260923130000:97-100
--   live booking     status in (new, modified) or is_block             20260923120000:213-214;
--                    is_block is exactly status 'ownerStay'            functions/_shared/reservation.ts:20,104
--   bar on day d     arrival_date <= d < departure_date                20260824190300:12-15
--   drawn row        the room named in reservation_units, else the booking's listing -- the
--                    generator's own fan-out (20260923120000:209-210)
--   in window        booking: arrival_date < to and departure_date >= from (the checkout day is
--                    drawn); task: from <= scheduled_date < to. Both windows are half-open:
--                    90d = [today-30, today+60), 30d = [today-7, today+23).
--   today            (now() at time zone anchor)::date, anchor = the most common timezone of the
--                    non-archived top-level listings. "Overdue" uses each listing's own timezone,
--                    as task_is_stale does (20260904120100:45-59).

with
tz as materialized (
  -- Local today per timezone, and only for names Postgres knows: one unknown name must not
  -- abort the whole probe with 22023. CASE keeps the conversion behind the check.
  select t.timezone,
         case when exists (select 1 from pg_catalog.pg_timezone_names n where n.name = t.timezone)
              then (now() at time zone t.timezone)::date
         end as local_today
  from (select distinct p.timezone from public.properties p) t
),
anchor as materialized (
  select coalesce(
           (select p.timezone
            from public.properties p
            join tz on tz.timezone = p.timezone
            where tz.local_today is not null
              and p.status <> 'archived'
              and p.parent_id is null
            group by p.timezone
            order by count(*) desc, p.timezone
            limit 1),
           'UTC') as anchor_tz
),
day0 as materialized (
  select a.anchor_tz, (now() at time zone a.anchor_tz)::date as today
  from anchor a
),
win as materialized (
  select '90d'::text as w, d.today - 30 as ws, d.today + 60 as we from day0 d
  union all
  select '30d'::text, d.today - 7, d.today + 23 from day0 d
),
w90 as materialized (select ws, we from win where w = '90d'),
w30 as materialized (select ws, we from win where w = '30d'),
kids as materialized (
  select c.parent_id as id,
         count(*) filter (where c.hostaway_unit_id is not null)                            as rooms_all,
         count(*) filter (where c.hostaway_unit_id is not null and c.status <> 'archived') as rooms_open,
         count(*) filter (where c.hostaway_unit_id is null)                                as parts_all,
         count(*) filter (where c.hostaway_unit_id is null and c.status <> 'archived')     as parts_open
  from public.properties c
  where c.parent_id is not null
  group by c.parent_id
),
prop as materialized (
  select p.id,
         p.parent_id,
         p.status::text as status,
         case when p.hostaway_unit_id is not null then 'room'
              when p.parent_id is not null        then 'combined_part'
              when coalesce(k.parts_all, 0) > 0   then 'combined_parent'
              when coalesce(k.rooms_all, 0) > 0   then 'multi_unit'
              else 'plain'
         end as kind,
         coalesce(k.rooms_all, 0)          as rooms_all,
         coalesce(k.rooms_open, 0)         as rooms_open,
         coalesce(k.parts_all, 0)          as parts_all,
         coalesce(k.parts_open, 0)         as parts_open,
         coalesce(p.parent_id, p.id)       as group_id,
         tz.local_today is null            as tz_unknown,
         coalesce(tz.local_today, d.today) as local_today
  from public.properties p
  left join kids k on k.id = p.id
  left join tz on tz.timezone = p.timezone
  cross join day0 d
),
unit_n as materialized (
  select ru.reservation_id, count(*) as n
  from public.reservation_units ru
  group by ru.reservation_id
),
res_win as materialized (
  select wn.w, wn.ws, wn.we,
         r.id, r.property_id, r.arrival_date, r.departure_date, r.status, r.is_block,
         r.departure_date - r.arrival_date as nights,
         (r.status in ('new', 'modified') or r.is_block) as is_live
  from win wn
  join public.reservations r
    on r.arrival_date < wn.we and r.departure_date >= wn.ws
),
res_rows as materialized (
  -- One row per bar: a booking that took three rooms draws three bars.
  select rw.w, rw.ws, rw.we, rw.id, rw.is_live, rw.arrival_date, rw.departure_date,
         rw.property_id                           as listing_id,
         coalesce(ru.property_id, rw.property_id) as row_id
  from res_win rw
  left join public.reservation_units ru on ru.reservation_id = rw.id
),
res_days as materialized (
  -- Occupied nights of each bar, clipped to the window.
  select rr.w, rr.row_id, rr.is_live, g.ts::date as night_date
  from res_rows rr
  cross join lateral generate_series(
    greatest(rr.arrival_date, rr.ws)::timestamp,
    (least(rr.departure_date, rr.we) - 1)::timestamp,
    interval '1 day') as g(ts)
),
bars as materialized (
  select w, 'by_booking_listing'::text as mapping, 'all'::text as scope,
         listing_id as row_id, count(distinct id) as n
  from res_rows group by w, listing_id
  union all
  select w, 'by_booking_listing', 'live', listing_id, count(distinct id)
  from res_rows where is_live group by w, listing_id
  union all
  select w, 'by_drawn_row', 'all', row_id, count(*)
  from res_rows group by w, row_id
  union all
  select w, 'by_drawn_row', 'live', row_id, count(*)
  from res_rows where is_live group by w, row_id
),
task_win as materialized (
  select wn.w, t.property_id, t.reservation_id, t.problem_id, t.scheduled_date,
         t.type::text as type, t.status::text as status,
         t.status not in ('done', 'cancelled', 'expired') as is_live
  from win wn
  join public.tasks t on t.scheduled_date >= wn.ws and t.scheduled_date < wn.we
),
chip_cells as materialized (
  select w, 'all'::text as scope, property_id as row_id, scheduled_date, count(*) as n
  from task_win group by w, property_id, scheduled_date
  union all
  select w, 'not_expired_not_cancelled', property_id, scheduled_date, count(*)
  from task_win where status not in ('expired', 'cancelled')
  group by w, property_id, scheduled_date
  union all
  select w, 'live_only', property_id, scheduled_date, count(*)
  from task_win where is_live
  group by w, property_id, scheduled_date
  union all
  select w, 'expired_only', property_id, scheduled_date, count(*)
  from task_win where status = 'expired'
  group by w, property_id, scheduled_date
  union all
  -- A collapsed group: every room's chip drawn on its listing's row.
  select tw.w, 'not_expired_not_cancelled_collapsed', p.group_id, tw.scheduled_date, count(*)
  from task_win tw
  join prop p on p.id = tw.property_id
  where tw.status not in ('expired', 'cancelled')
  group by tw.w, p.group_id, tw.scheduled_date
),
exp as materialized (
  select t.reservation_id, t.property_id, t.scheduled_date, t.type::text as type,
         t.created_at, t.updated_at
  from public.tasks t
  where t.status = 'expired'
),
sib as materialized (
  -- Per (booking, property): the attempts that are not expired.
  select t.reservation_id, t.property_id,
         count(*) filter (where t.status not in ('done', 'cancelled', 'expired')) as live_n,
         count(*) filter (where t.status = 'done')                                as done_n
  from public.tasks t
  where t.reservation_id is not null
  group by t.reservation_id, t.property_id
),
sib_day as materialized (
  -- Per cell of a booking: attempts that would be drawn as a real chip.
  select t.reservation_id, t.property_id, t.scheduled_date, count(*) as n
  from public.tasks t
  where t.reservation_id is not null
    and t.status not in ('cancelled', 'expired')
  group by t.reservation_id, t.property_id, t.scheduled_date
),
exp_key3 as materialized (
  select e.reservation_id, e.property_id, e.scheduled_date, count(*) as n
  from exp e
  where e.reservation_id is not null
  group by e.reservation_id, e.property_id, e.scheduled_date
),
exp_key2 as materialized (
  select e.reservation_id, e.property_id,
         count(*)                         as n,
         count(distinct e.scheduled_date) as dates,
         count(*) filter (where e.scheduled_date >= w90.ws and e.scheduled_date < w90.we) as n90,
         count(*) filter (where e.scheduled_date >= w30.ws and e.scheduled_date < w30.we) as n30
  from exp e
  cross join w90
  cross join w30
  where e.reservation_id is not null
  group by e.reservation_id, e.property_id
),
live_fix as materialized (
  select distinct t.problem_id
  from public.tasks t
  where t.problem_id is not null
    and t.status not in ('done', 'cancelled', 'expired')
),
rep as materialized (
  select t.status::text as status,
         t.scheduled_date,
         t.status not in ('done', 'cancelled', 'expired') as is_live,
         t.assignee_id is null as no_assignee,
         pr.is_active          as assignee_active,
         p.kind,
         p.status              as property_status,
         p.local_today
  from public.tasks t
  join prop p on p.id = t.property_id
  left join public.profiles pr on pr.id = t.assignee_id
  where t.problem_id is not null
)
select metric, value
from (

  -- ---------------------------------------------------------------- meta
  select 0 as ord, 'z0_meta'::text as metric,
         jsonb_build_object(
           'now_utc', now(),
           'anchor_tz', d.anchor_tz,
           'today', d.today,
           'windows', (select jsonb_object_agg(w, jsonb_build_object('from', ws, 'to_exclusive', we))
                       from win),
           'migration_head', (select max(version) from supabase_migrations.schema_migrations),
           'hosts', (select count(*) from public.hosts),
           'task_grace_days', public.task_grace_days(),
           'timezones_not_archived',
             (select jsonb_object_agg(x.timezone, x.n)
              from (select p.timezone, count(*) as n
                    from public.properties p
                    where p.status <> 'archived'
                    group by p.timezone) x),
           'properties_with_unknown_tz', (select count(*) from prop where tz_unknown),
           -- the local stack's cap (supabase/config.toml); the cloud's is a dashboard
           -- setting and cannot be read from SQL
           'postgrest_max_rows_local_config', 1000) as value
  from day0 d

  -- ---------------------------------------------------------------- a. properties
  union all
  select 10, 'a1_properties_by_kind_and_status',
         (select jsonb_object_agg(y.kind, y.by_status)
          from (select x.kind, jsonb_object_agg(x.status, x.n) as by_status
                from (select kind, status, count(*) as n from prop group by kind, status) x
                group by x.kind) y)

  union all
  select 11, 'a2_rooms_per_multi_unit_listing',
         (select jsonb_build_object(
                   'listings_not_archived', count(*) filter (where status <> 'archived'),
                   'listings_archived',     count(*) filter (where status = 'archived'),
                   'rooms_open_min',   min(rooms_open) filter (where status <> 'archived'),
                   'rooms_open_max',   max(rooms_open) filter (where status <> 'archived'),
                   'rooms_open_avg',   round(avg(rooms_open) filter (where status <> 'archived'), 2),
                   'rooms_open_total', sum(rooms_open) filter (where status <> 'archived'),
                   'rooms_all_min',    min(rooms_all),
                   'rooms_all_max',    max(rooms_all),
                   'rooms_all_avg',    round(avg(rooms_all), 2),
                   'rooms_all_total',  sum(rooms_all),
                   'listings_also_combined_parent', count(*) filter (where parts_all > 0))
          from prop
          where rooms_all > 0)

  union all
  select 12, 'a3_parts_per_combined_parent',
         (select jsonb_build_object(
                   'parents_not_archived', count(*) filter (where status <> 'archived'),
                   'parents_archived',     count(*) filter (where status = 'archived'),
                   'parts_open_min',   min(parts_open) filter (where status <> 'archived'),
                   'parts_open_max',   max(parts_open) filter (where status <> 'archived'),
                   'parts_open_total', sum(parts_open) filter (where status <> 'archived'),
                   'parts_all_total',  sum(parts_all))
          from prop
          where parts_all > 0)

  union all
  select 13, 'a4_calendar_rows',
         (select jsonb_build_object(
                   'top_level_not_archived', count(*) filter (where parent_id is null and status <> 'archived'),
                   'rooms_not_archived',     count(*) filter (where kind = 'room' and status <> 'archived'),
                   'parts_not_archived',     count(*) filter (where kind = 'combined_part' and status <> 'archived'),
                   'rows_expanded_not_archived', count(*) filter (where status <> 'archived'),
                   'rows_expanded_active_only',  count(*) filter (where status = 'active'),
                   'rows_maintenance',           count(*) filter (where status = 'maintenance'),
                   'rows_archived',              count(*) filter (where status = 'archived'),
                   'cells_expanded_90d',  90 * count(*) filter (where status <> 'archived'),
                   'cells_expanded_30d',  30 * count(*) filter (where status <> 'archived'),
                   'cells_collapsed_90d', 90 * count(*) filter (where parent_id is null and status <> 'archived'),
                   'cells_collapsed_30d', 30 * count(*) filter (where parent_id is null and status <> 'archived'))
          from prop)

  union all
  select 14, 'a5_hierarchy_checks',
         (select jsonb_build_object(
                   'rooms_under_non_listing_parent',
                     count(*) filter (where c.kind = 'room' and par.kind in ('room', 'combined_part')),
                   'rooms_open_under_archived_parent',
                     count(*) filter (where c.kind = 'room' and c.status <> 'archived' and par.status = 'archived'),
                   'rooms_active_under_non_active_parent',
                     count(*) filter (where c.kind = 'room' and c.status = 'active' and par.status <> 'active'),
                   'rooms_status_differs_from_parent',
                     count(*) filter (where c.kind = 'room' and c.status <> par.status),
                   'parts_open_under_archived_parent',
                     count(*) filter (where c.kind = 'combined_part' and c.status <> 'archived' and par.status = 'archived'),
                   'listings_with_rooms_and_parts',
                     (select count(*) from prop where rooms_all > 0 and parts_all > 0))
          from prop c
          join prop par on par.id = c.parent_id)

  -- ---------------------------------------------------------------- b. bookings
  union all
  select 20, 'b1_bookings_in_window_by_status',
         (select jsonb_object_agg(y.w, y.o)
          from (select x.w,
                       jsonb_build_object('total', sum(x.n), 'by_status', jsonb_object_agg(x.k, x.n)) as o
                from (select w, status || case when is_block then ' [block]' else '' end as k,
                             count(*) as n
                      from res_win
                      group by 1, 2) x
                group by x.w) y)

  union all
  select 21, 'b2_bars_per_row',
         (select jsonb_object_agg(y.w, y.o)
          from (select x.w, jsonb_object_agg(x.mapping || '.' || x.scope, x.o) as o
                from (select w, mapping, scope,
                             jsonb_build_object(
                               'rows_with_bars', count(*),
                               'bars', sum(n),
                               'max', max(n),
                               'p95', percentile_disc(0.95) within group (order by n),
                               'avg', round(avg(n), 2)) as o
                      from bars
                      group by w, mapping, scope) x
                group by x.w) y)

  union all
  select 22, 'b3_nights_per_booking',
         (select jsonb_object_agg(y.w, y.o)
          from (select x.w, jsonb_object_agg(x.scope, x.o) as o
                from (select w, 'all'::text as scope,
                             jsonb_build_object(
                               'bookings', count(*),
                               'avg', round(avg(nights), 2),
                               'p95', percentile_disc(0.95) within group (order by nights),
                               'max', max(nights),
                               'zero_nights', count(*) filter (where nights = 0),
                               'spanning_whole_window',
                                 count(*) filter (where arrival_date <= ws and departure_date >= we)) as o
                      from res_win
                      group by w
                      union all
                      select w, 'live',
                             jsonb_build_object(
                               'bookings', count(*),
                               'avg', round(avg(nights), 2),
                               'p95', percentile_disc(0.95) within group (order by nights),
                               'max', max(nights),
                               'zero_nights', count(*) filter (where nights = 0),
                               'spanning_whole_window',
                                 count(*) filter (where arrival_date <= ws and departure_date >= we))
                      from res_win
                      where is_live
                      group by w) x
                group by x.w) y)

  union all
  select 23, 'b4_bookings_on_multi_unit_listings',
         (select jsonb_object_agg(y.w, y.o)
          from (select rw.w,
                       jsonb_build_object(
                         'bookings', count(*),
                         'live_with_rooms',      count(*) filter (where rw.is_live and u.n is not null),
                         'live_without_rooms',   count(*) filter (where rw.is_live and u.n is null),
                         'other_with_rooms',     count(*) filter (where not rw.is_live and u.n is not null),
                         'other_without_rooms',  count(*) filter (where not rw.is_live and u.n is null),
                         'with_more_than_one_room',      count(*) filter (where u.n > 1),
                         'live_with_more_than_one_room', count(*) filter (where rw.is_live and u.n > 1),
                         'max_rooms_per_booking', coalesce(max(u.n), 0),
                         'unit_rows', coalesce(sum(u.n), 0)) as o
                from res_win rw
                join prop p on p.id = rw.property_id and p.rooms_all > 0
                left join unit_n u on u.reservation_id = rw.id
                group by rw.w) y)

  union all
  select 24, 'b5_booking_integrity',
         jsonb_build_object(
           'bookings_total', (select count(*) from public.reservations),
           'bookings_by_listing_kind',
             (select jsonb_object_agg(x.kind, x.n)
              from (select p.kind, count(*) as n
                    from public.reservations r
                    join prop p on p.id = r.property_id
                    group by p.kind) x),
           'unit_rows_total', (select count(*) from public.reservation_units),
           'unit_rows_not_on_a_room',
             (select count(*)
              from public.reservation_units ru
              join prop p on p.id = ru.property_id
              where p.kind <> 'room'),
           'unit_rows_room_of_another_listing',
             (select count(*)
              from public.reservation_units ru
              join public.reservations r on r.id = ru.reservation_id
              join prop p on p.id = ru.property_id
              where p.kind = 'room' and p.parent_id is distinct from r.property_id),
           'bookings_with_rooms_on_listing_without_rooms',
             (select count(*)
              from unit_n u
              join public.reservations r on r.id = u.reservation_id
              join prop p on p.id = r.property_id
              where p.rooms_all = 0),
           'zero_night_bookings_total',
             (select count(*) from public.reservations r where r.departure_date = r.arrival_date),
           'bars_90d_on_archived_rows',
             (select count(*) from res_rows rr join prop p on p.id = rr.row_id
              where rr.w = '90d' and p.status = 'archived'),
           'live_bars_90d_on_archived_rows',
             (select count(*) from res_rows rr join prop p on p.id = rr.row_id
              where rr.w = '90d' and rr.is_live and p.status = 'archived'),
           'live_bars_90d_on_maintenance_rows',
             (select count(*) from res_rows rr join prop p on p.id = rr.row_id
              where rr.w = '90d' and rr.is_live and p.status = 'maintenance'))

  union all
  select 25, 'b6_concurrent_bars_per_row_day',
         (select jsonb_object_agg(y.w, y.o)
          from (select x.w, jsonb_object_agg(x.scope, x.o) as o
                from (select c.w, c.scope,
                             jsonb_build_object(
                               'row_days_with_bar', count(*),
                               'max_concurrent', max(c.n),
                               'row_days_gt1', count(*) filter (where c.n > 1),
                               'row_days_gt2', count(*) filter (where c.n > 2)) as o
                      from (select w, 'all'::text as scope, row_id, night_date, count(*) as n
                            from res_days
                            group by w, row_id, night_date
                            union all
                            select w, 'live', row_id, night_date, count(*)
                            from res_days
                            where is_live
                            group by w, row_id, night_date) c
                      group by c.w, c.scope) x
                group by x.w) y)

  union all
  select 26, 'b7_same_day_turnover_cells_live',
         (select jsonb_object_agg(y.w, y.n)
          from (select a.w, count(*) as n
                from (select distinct w, row_id, departure_date as d
                      from res_rows
                      where is_live and departure_date >= ws and departure_date < we) a
                join (select distinct w, row_id, arrival_date as d
                      from res_rows
                      where is_live and arrival_date >= ws and arrival_date < we) b
                  on b.w = a.w and b.row_id = a.row_id and b.d = a.d
                group by a.w) y)

  union all
  select 27, 'b8_live_departures_per_day_by_drawn_row',
         (select jsonb_object_agg(y.w, y.o)
          from (select x.w,
                       jsonb_build_object(
                         'days_with_departures', count(*),
                         'max', max(x.n),
                         'avg', round(avg(x.n), 2)) as o
                from (select w, departure_date, count(*) as n
                      from res_rows
                      where is_live and departure_date >= ws and departure_date < we
                      group by w, departure_date) x
                group by x.w) y)

  -- ---------------------------------------------------------------- c. task chips
  union all
  select 30, 'c1_tasks_in_window_by_type_and_status',
         (select jsonb_object_agg(z.w, z.o)
          from (select y.w,
                       jsonb_build_object('total', sum(y.n),
                                          'by_type', jsonb_object_agg(y.type, y.by_status)) as o
                from (select x.w, x.type, sum(x.n) as n, jsonb_object_agg(x.status, x.n) as by_status
                      from (select w, type, status, count(*) as n
                            from task_win
                            group by w, type, status) x
                      group by x.w, x.type) y
                group by y.w) z)

  union all
  select 31, 'c2_chips_per_cell',
         (select jsonb_object_agg(y.w, y.o)
          from (select x.w, jsonb_object_agg(x.scope, x.o) as o
                from (select w, scope,
                             jsonb_build_object(
                               'cells_with_chips', count(*),
                               'chips', sum(n),
                               'max', max(n),
                               'p95', percentile_disc(0.95) within group (order by n),
                               'cells_gt1', count(*) filter (where n > 1),
                               'cells_gt2', count(*) filter (where n > 2),
                               'cells_gt4', count(*) filter (where n > 4)) as o
                      from chip_cells
                      group by w, scope) x
                group by x.w) y)

  union all
  select 32, 'c3_live_tasks_before_window_start',
         (select jsonb_object_agg(y.w, y.o)
          from (select wn.w,
                       jsonb_build_object(
                         'total', count(t.id),
                         'with_problem', count(t.id) filter (where t.problem_id is not null),
                         'cleaning', count(t.id) filter (where t.type = 'cleaning'),
                         'other_without_problem',
                           count(t.id) filter (where t.type <> 'cleaning' and t.problem_id is null)) as o
                from win wn
                left join public.tasks t
                  on t.scheduled_date < wn.ws
                 and t.status not in ('done', 'cancelled', 'expired')
                group by wn.w) y)

  -- ---------------------------------------------------------------- d. expired duplicates
  union all
  select 40, 'd1_expired_dup_by_booking_property_date',
         (select jsonb_build_object(
                   'distinct_keys', count(*),
                   'groups_gt1', count(*) filter (where k.n > 1),
                   'rows_in_groups_gt1', coalesce(sum(k.n) filter (where k.n > 1), 0),
                   'excess_rows', coalesce(sum(k.n - 1), 0),
                   'max_group_size', max(k.n),
                   'groups_gt1_in_90d',
                     count(*) filter (where k.n > 1 and k.scheduled_date >= w90.ws and k.scheduled_date < w90.we),
                   'rows_in_groups_gt1_in_90d',
                     coalesce(sum(k.n) filter (where k.n > 1 and k.scheduled_date >= w90.ws and k.scheduled_date < w90.we), 0),
                   'excess_rows_in_90d',
                     coalesce(sum(k.n - 1) filter (where k.scheduled_date >= w90.ws and k.scheduled_date < w90.we), 0),
                   'groups_gt1_in_30d',
                     count(*) filter (where k.n > 1 and k.scheduled_date >= w30.ws and k.scheduled_date < w30.we),
                   'rows_in_groups_gt1_in_30d',
                     coalesce(sum(k.n) filter (where k.n > 1 and k.scheduled_date >= w30.ws and k.scheduled_date < w30.we), 0),
                   'excess_rows_in_30d',
                     coalesce(sum(k.n - 1) filter (where k.scheduled_date >= w30.ws and k.scheduled_date < w30.we), 0))
          from exp_key3 k
          cross join w90
          cross join w30)

  union all
  select 41, 'd2_expired_dup_by_booking_property',
         (select jsonb_build_object(
                   'distinct_keys', count(*),
                   'groups_gt1', count(*) filter (where k.n > 1),
                   'rows_in_groups_gt1', coalesce(sum(k.n) filter (where k.n > 1), 0),
                   'excess_rows', coalesce(sum(k.n - 1), 0),
                   'max_group_size', max(k.n),
                   'groups_gt1_over_several_dates', count(*) filter (where k.n > 1 and k.dates > 1),
                   'rows_in_groups_gt1_in_90d', coalesce(sum(k.n90) filter (where k.n > 1), 0),
                   'rows_in_groups_gt1_in_30d', coalesce(sum(k.n30) filter (where k.n > 1), 0),
                   'keys_with_live_attempt', count(*) filter (where s.live_n > 0),
                   'keys_with_done_attempt', count(*) filter (where s.done_n > 0))
          from exp_key2 k
          left join sib s on s.reservation_id = k.reservation_id and s.property_id = k.property_id)

  union all
  select 42, 'd3_expired_overall',
         (select jsonb_build_object(
                   'rows', count(*),
                   'without_booking', count(*) filter (where e.reservation_id is null),
                   'by_type', (select jsonb_object_agg(x.type, x.n)
                               from (select type, count(*) as n from exp group by type) x),
                   'min_scheduled_date', min(e.scheduled_date),
                   'max_scheduled_date', max(e.scheduled_date),
                   'rows_in_90d', count(*) filter (where e.scheduled_date >= w90.ws and e.scheduled_date < w90.we),
                   'rows_in_30d', count(*) filter (where e.scheduled_date >= w30.ws and e.scheduled_date < w30.we),
                   'rows_sharing_cell_with_real_chip', count(*) filter (where sd.n is not null),
                   'rows_sharing_cell_with_real_chip_in_90d',
                     count(*) filter (where sd.n is not null
                                        and e.scheduled_date >= w90.ws and e.scheduled_date < w90.we))
          from exp e
          cross join w90
          cross join w30
          left join sib_day sd
            on sd.reservation_id = e.reservation_id
           and sd.property_id = e.property_id
           and sd.scheduled_date = e.scheduled_date)

  union all
  select 43, 'd4_expired_rows_by_day_last_14',
         jsonb_build_object(
           'by_created_day',
             (select jsonb_object_agg(x.on_day, x.n)
              from (select (e.created_at at time zone d.anchor_tz)::date::text as on_day, count(*) as n
                    from exp e
                    cross join day0 d
                    where e.created_at >= now() - interval '14 days'
                    group by 1) x),
           'by_updated_day',
             (select jsonb_object_agg(x.on_day, x.n)
              from (select (e.updated_at at time zone d.anchor_tz)::date::text as on_day, count(*) as n
                    from exp e
                    cross join day0 d
                    where e.updated_at >= now() - interval '14 days'
                    group by 1) x))

  -- ---------------------------------------------------------------- e. repairs
  union all
  select 50, 'e1_repair_tasks',
         (select jsonb_build_object(
                   'all', count(*),
                   'by_status', (select jsonb_object_agg(x.status, x.n)
                                 from (select status, count(*) as n from rep group by status) x),
                   'live', count(*) filter (where r.is_live),
                   'live_overdue_local_today',
                     count(*) filter (where r.is_live and r.scheduled_date < r.local_today),
                   'live_past_grace',
                     count(*) filter (where r.is_live
                                        and r.scheduled_date < r.local_today - public.task_grace_days()),
                   'live_max_days_overdue',
                     max(r.local_today - r.scheduled_date) filter (where r.is_live and r.scheduled_date < r.local_today),
                   'live_no_assignee', count(*) filter (where r.is_live and r.no_assignee),
                   'live_assignee_inactive', count(*) filter (where r.is_live and r.assignee_active = false),
                   'live_before_90d_window', count(*) filter (where r.is_live and r.scheduled_date < w90.ws),
                   'live_in_90d', count(*) filter (where r.is_live and r.scheduled_date >= w90.ws and r.scheduled_date < w90.we),
                   'live_in_30d', count(*) filter (where r.is_live and r.scheduled_date >= w30.ws and r.scheduled_date < w30.we),
                   'live_after_90d_window', count(*) filter (where r.is_live and r.scheduled_date >= w90.we),
                   'live_on_non_active_property', count(*) filter (where r.is_live and r.property_status <> 'active'),
                   'live_by_property_kind', (select jsonb_object_agg(x.kind, x.n)
                                             from (select kind, count(*) as n from rep where is_live group by kind) x),
                   'expired', count(*) filter (where r.status = 'expired'))
          from rep r
          cross join w90
          cross join w30)

  union all
  select 51, 'e2_problems',
         (select jsonb_build_object(
                   'all', count(*),
                   'by_status', (select jsonb_object_agg(x.status, x.n)
                                 from (select pb2.status::text as status, count(*) as n
                                       from public.problems pb2
                                       group by 1) x),
                   'archived', count(*) filter (where pb.archived_at is not null),
                   'without_property', count(*) filter (where pb.property_id is null),
                   'without_property_unresolved',
                     count(*) filter (where pb.property_id is null
                                        and pb.status in ('open', 'assigned', 'in_progress')
                                        and pb.archived_at is null),
                   'unresolved_with_live_task',
                     count(*) filter (where pb.status in ('open', 'assigned', 'in_progress')
                                        and pb.archived_at is null and lf.problem_id is not null),
                   'unresolved_without_live_task',
                     count(*) filter (where pb.status in ('open', 'assigned', 'in_progress')
                                        and pb.archived_at is null and lf.problem_id is null),
                   'unresolved_by_property_kind',
                     (select jsonb_object_agg(x.kind, x.n)
                      from (select coalesce(p2.kind, 'none') as kind, count(*) as n
                            from public.problems pb3
                            left join prop p2 on p2.id = pb3.property_id
                            where pb3.status in ('open', 'assigned', 'in_progress')
                              and pb3.archived_at is null
                            group by 1) x))
          from public.problems pb
          left join live_fix lf on lf.problem_id = pb.id)

  union all
  select 52, 'e3_non_cleaning_tasks_without_problem',
         jsonb_build_object(
           'live_by_type',
             (select jsonb_object_agg(x.type, x.n)
              from (select t.type::text as type, count(*) as n
                    from public.tasks t
                    where t.problem_id is null
                      and t.type <> 'cleaning'
                      and t.status not in ('done', 'cancelled', 'expired')
                    group by 1) x),
           'with_booking_by_type',
             (select jsonb_object_agg(x.type, x.n)
              from (select t.type::text as type, count(*) as n
                    from public.tasks t
                    where t.problem_id is null
                      and t.type <> 'cleaning'
                      and t.reservation_id is not null
                    group by 1) x))

  -- ---------------------------------------------------------------- f. which row a chip lands on
  union all
  select 60, 'f1_tasks_by_property_kind',
         (select jsonb_object_agg(z.w, z.o)
          from (select y.w, jsonb_object_agg(y.kind, y.by_class) as o
                from (select x.w, x.kind, jsonb_object_agg(x.cls, x.n) as by_class
                      from (select tw.w, p.kind,
                                   case when tw.is_live then 'live' else tw.status end as cls,
                                   count(*) as n
                            from task_win tw
                            join prop p on p.id = tw.property_id
                            group by 1, 2, 3) x
                      group by x.w, x.kind) y
                group by y.w) z)

  union all
  select 61, 'f2_cleaning_chip_vs_its_booking',
         (select jsonb_object_agg(z.w, z.o)
          from (select y.w, jsonb_object_agg(y.cls, y.o) as o
                from (select x.w, x.cls,
                             jsonb_build_object(
                               'chips', count(*),
                               'on_booking_listing', count(*) filter (where x.place = 'listing'),
                               'on_booked_room', count(*) filter (where x.place = 'booked_room'),
                               'elsewhere', count(*) filter (where x.place = 'elsewhere'),
                               'on_listing_although_booking_has_rooms',
                                 count(*) filter (where x.place = 'listing' and x.booking_has_rooms),
                               'date_is_departure', count(*) filter (where x.scheduled_date = x.departure_date),
                               'date_differs_from_departure', count(*) filter (where x.scheduled_date <> x.departure_date),
                               'booking_not_live', count(*) filter (where not x.booking_live)) as o
                      from (select tw.w,
                                   case when tw.is_live then 'live' else tw.status end as cls,
                                   tw.scheduled_date,
                                   r.departure_date,
                                   (r.status in ('new', 'modified') or r.is_block) as booking_live,
                                   u.n is not null as booking_has_rooms,
                                   case when tw.property_id = r.property_id then 'listing'
                                        when ru.property_id is not null     then 'booked_room'
                                        else 'elsewhere'
                                   end as place
                            from task_win tw
                            join public.reservations r on r.id = tw.reservation_id
                            left join public.reservation_units ru
                              on ru.reservation_id = r.id and ru.property_id = tw.property_id
                            left join unit_n u on u.reservation_id = r.id
                            where tw.type = 'cleaning') x
                      group by x.w, x.cls) y
                group by y.w) z)

  union all
  select 62, 'f3_tasks_on_rows_not_active',
         (select jsonb_object_agg(y.w, y.o)
          from (select x.w, jsonb_object_agg(x.k, x.n) as o
                from (select tw.w,
                             p.status || '.' || case when tw.is_live then 'live' else tw.status end as k,
                             count(*) as n
                      from task_win tw
                      join prop p on p.id = tw.property_id
                      where p.status <> 'active'
                      group by 1, 2) x
                group by x.w) y)

  -- ---------------------------------------------------------------- g. rows per request vs max_rows
  union all
  select 70, 'g1_rows_per_request',
         (select jsonb_object_agg(
                   y.w,
                   y.o || jsonb_build_object(
                            'over_max_rows',
                            (select coalesce(jsonb_agg(e.key order by e.key), '[]'::jsonb)
                             from jsonb_each(y.o) e
                             where jsonb_typeof(e.value) = 'number'
                               and (e.value)::numeric > 1000)))
          from (select wn.w,
                       jsonb_build_object(
                         'properties_all', (select count(*) from prop),
                         'properties_not_archived', (select count(*) from prop where status <> 'archived'),
                         'bookings_all_statuses', (select count(*) from res_win r where r.w = wn.w),
                         'bookings_live', (select count(*) from res_win r where r.w = wn.w and r.is_live),
                         'reservation_units_all_statuses',
                           (select count(*) from public.reservation_units ru
                            join res_win r on r.id = ru.reservation_id
                            where r.w = wn.w),
                         'reservation_units_live',
                           (select count(*) from public.reservation_units ru
                            join res_win r on r.id = ru.reservation_id
                            where r.w = wn.w and r.is_live),
                         'tasks_all', (select count(*) from task_win t where t.w = wn.w),
                         'tasks_not_cancelled',
                           (select count(*) from task_win t where t.w = wn.w and t.status <> 'cancelled'),
                         'tasks_not_cancelled_not_expired',
                           (select count(*) from task_win t
                            where t.w = wn.w and t.status not in ('cancelled', 'expired')),
                         'tasks_live', (select count(*) from task_win t where t.w = wn.w and t.is_live),
                         'problems_all', (select count(*) from public.problems)) as o
                from win wn) y)

  -- ---------------------------------------------------------------- h. today's /tasks reader
  union all
  select 80, 'h1_fetch_tasks_reader_today',
         -- fetchTasks: gte(scheduled_date, today - 30), no upper bound, no status filter,
         -- ordered by scheduled_date asc (apps/web/src/features/tasks/api.ts:55-66)
         (select jsonb_build_object(
                   'rows_total', count(*),
                   'rows_expired', count(*) filter (where t.status = 'expired'),
                   'rows_cancelled', count(*) filter (where t.status = 'cancelled'),
                   'rows_from_today', count(*) filter (where t.scheduled_date >= d.today),
                   'live_from_today',
                     count(*) filter (where t.scheduled_date >= d.today
                                        and t.status not in ('done', 'cancelled', 'expired')),
                   'date_of_row_1000',
                     (select x.scheduled_date
                      from public.tasks x
                      where x.scheduled_date >= d.today - 30
                      order by x.scheduled_date, x.time_from nulls last
                      offset 999 limit 1))
          from public.tasks t
          cross join day0 d
          where t.scheduled_date >= d.today - 30
          group by d.today)

  union all
  select 81, 'h2_postgrest_role_config',
         -- only the two settings that matter; role configs may hold secrets otherwise
         (select coalesce(jsonb_agg(r.rolname || ': ' || c.setting), '[]'::jsonb)
          from pg_catalog.pg_roles r
          cross join lateral unnest(r.rolconfig) as c(setting)
          where r.rolname in ('authenticator', 'authenticated', 'anon')
            and (c.setting like '%max_rows%' or c.setting like 'statement_timeout=%'))

  -- ---------------------------------------------------------------- i. expired collapsed per cell
  union all
  select 90, 'i1_cells_with_expired_collapsed',
         -- what a cell draws when the expired rows of one booking collapse on
         -- (reservation_id, property_id, scheduled_date); hand-made expired tasks
         -- (no booking) stay one chip each
         (select jsonb_object_agg(y.w, y.o)
          from (select x.w,
                       jsonb_build_object('cells', count(*), 'chips', sum(x.n), 'max', max(x.n),
                                          'cells_gt2', count(*) filter (where x.n > 2)) as o
                from (select s.w, s.property_id, s.scheduled_date, sum(s.n) as n
                      from (select w, property_id, scheduled_date, count(*) as n
                            from task_win
                            where status not in ('cancelled', 'expired')
                               or (status = 'expired' and reservation_id is null)
                            group by 1, 2, 3
                            union all
                            select w, property_id, scheduled_date,
                                   count(distinct reservation_id) as n
                            from task_win
                            where status = 'expired' and reservation_id is not null
                            group by 1, 2, 3) s
                      group by 1, 2, 3) x
                group by x.w) y)

  union all
  select 91, 'i2_expired_by_month',
         -- the calendar loads by calendar month; how heavy is each month's expired class
         (select jsonb_object_agg(x.m, jsonb_build_object('rows', x.n, 'keys', x.k))
          from (select to_char(e.scheduled_date, 'YYYY-MM') as m,
                       count(*) as n,
                       count(distinct (e.reservation_id, e.property_id, e.scheduled_date)) as k
                from exp e
                group by 1) x)

  union all
  select 92, 'i3_days_with_most_duplicates',
         -- the day to look at when checking the collapse by eye
         (select jsonb_agg(jsonb_build_object('date', x.d, 'excess_rows', x.e, 'max_per_key', x.mx)
                           order by x.e desc)
          from (select k.scheduled_date as d, sum(k.n - 1) as e, max(k.n) as mx
                from exp_key3 k
                group by 1
                order by 2 desc
                limit 5) x)

  union all
  select 93, 'i4_collapsed_group_with_expired',
         -- a collapsed group row (rooms and parts folded onto group_id) with the
         -- expired rows collapsed per booking, as the calendar would draw it
         (select jsonb_object_agg(y.w, y.o)
          from (select x.w,
                       jsonb_build_object('cells', count(*), 'max', max(x.n),
                                          'cells_gt2', count(*) filter (where x.n > 2)) as o
                from (select s.w, s.group_id, s.scheduled_date, sum(s.n) as n
                      from (select tw.w, p.group_id, tw.scheduled_date, count(*) as n
                            from task_win tw
                            join prop p on p.id = tw.property_id
                            where tw.status not in ('cancelled', 'expired')
                               or (tw.status = 'expired' and tw.reservation_id is null)
                            group by 1, 2, 3
                            union all
                            select tw.w, p.group_id, tw.scheduled_date,
                                   count(distinct (tw.reservation_id, tw.property_id)) as n
                            from task_win tw
                            join prop p on p.id = tw.property_id
                            where tw.status = 'expired' and tw.reservation_id is not null
                            group by 1, 2, 3) s
                      group by 1, 2, 3) x
                group by x.w) y)

) m
order by ord;
