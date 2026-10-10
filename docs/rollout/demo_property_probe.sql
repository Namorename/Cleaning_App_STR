-- Before and after docs/one-off-writes/demo-property.sql, and again once the owner has
-- linked the demo cleaner and made her cleanings. Read-only, one statement, no
-- names, e-mails or phones of people:
--
--   node scripts/cloud-read.mjs docs/rollout/demo_property_probe.sql
--
--   demo          the demo row: null before the insert; after it id 900000000001,
--                 'Demo Apartment', 'Demo Street 1', no parent, no unit, active,
--                 the company's one host.
--   band          rows with an id in 900000000000..999999999999: 0 before, 1 after.
--   properties    all rows: one more after the insert, nothing else changes.
--   on_demo       bookings (must stay 0), cleanings by status, links to people.
--   linked        for each person linked to the demo row: role, working or not,
--                 and how many OTHER listings tie them (links, cleanings, tasks they
--                 reported, supply requests — what staff_property_ids() reads). The
--                 demo cleaner must show other_places 0: she sees the demo row only.
with demo_people as (
  select pc.cleaner_id as id from public.property_cleaners pc
  where pc.property_id = 900000000001
), ties as (
  select dp.id as person, t.property_id
  from demo_people dp
  cross join lateral (
    select pc.property_id from public.property_cleaners pc where pc.cleaner_id = dp.id
    union
    select ta.property_id from public.tasks ta where ta.assignee_id = dp.id
    union
    select pr.property_id from public.problems pr
    where pr.reported_by = dp.id and pr.property_id is not null
    union
    select sr.property_id from public.supply_requests sr
    where sr.requested_by = dp.id and sr.property_id is not null
  ) t
)
select json_build_object(
  'demo', (select json_build_object(
             'id', p.id, 'name', p.name, 'address', p.address, 'parent_id', p.parent_id,
             'unit', p.hostaway_unit_id, 'status', p.status,
             'host_is_the_one', p.host_id = (select h.id from public.hosts h
                                             order by h.created_at, h.id limit 1))
           from public.properties p where p.id = 900000000001),
  'band', (select count(*) from public.properties
           where id between 900000000000 and 999999999999),
  'properties', (select count(*) from public.properties),
  'on_demo', json_build_object(
    'bookings', (select count(*) from public.reservations where property_id = 900000000001),
    'cleanings', (select coalesce(json_object_agg(x.status, x.n), '{}'::json)
                  from (select t.status::text as status, count(*) as n from public.tasks t
                        where t.property_id = 900000000001 group by 1) x),
    'links', (select count(*) from demo_people)),
  'linked', (select coalesce(json_agg(json_build_object(
               'role', pf.role, 'working', pf.is_active,
               'other_places', (select count(*) from ties
                                where ties.person = pf.id
                                  and ties.property_id <> 900000000001))), '[]'::json)
             from demo_people dp join public.profiles pf on pf.id = dp.id)
) as probe;
