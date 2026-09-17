-- Units 6.6: the expired-cleanings review says which house, not just which room.
--
-- Since cleanings moved onto rooms, `property_name` on this view is the room's
-- own name -- "1 - 2109", "Unit 3 - 7013" -- and those name no house. A manager
-- opening the review to find out what went unclaimed would read a list of
-- identifiers with no address in it.
--
-- The view hands out the parts and not the finished line: the separator lives
-- in packages/shared (`propertyPath`) because the phone and the panel have to
-- spell a place identically, down to the dash, or the panel's search stops
-- finding the phone's reports. Composing it here would be the third copy.
--
-- `unit_id` rides along so the reader can tell a room from a part of a
-- combined listing. `parent_id` alone cannot: it carries both relations, and a
-- part of a combined listing is a listing of its own that must keep its name.
--
-- `create or replace`, not drop and recreate: dropping the view would drop the
-- grant with it, and a view that silently loses `select` from `authenticated`
-- fails as "permission denied" long after the migration looked fine. Replace
-- only appends columns, so the two new ones sit at the end.

create or replace view public.expired_tasks_review
with (security_invoker = on) as
select
  t.id,
  t.property_id,
  p.name       as property_name,
  t.reservation_id,
  t.assignee_id,
  pr.full_name as assignee_name,
  t.priority,
  t.scheduled_date,
  t.due_at,
  t.notes      as task_notes,
  t.updated_at as expired_at,
  -- Null unless the row above is a room; then it is the house it stands in.
  case when p.hostaway_unit_id is not null then parent.name end as parent_name,
  p.hostaway_unit_id                                           as unit_id
from public.tasks t
join public.properties p on p.id = t.property_id
left join public.properties parent on parent.id = p.parent_id
left join public.profiles pr on pr.id = t.assignee_id
where t.type = 'cleaning' and t.status = 'expired';

comment on view public.expired_tasks_review is
  'Cleanings that expired unclaimed. property_name is the row''s own name, which for a room names no house: label it with parent_name through propertyPath in packages/shared, never on its own.';
