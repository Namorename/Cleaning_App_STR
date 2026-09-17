-- Units 6.3: a listing's card sees what lives in its rooms.
--
-- Both reads on the card name a single property: `.eq('property_id', id)`.
-- Since 20260912150000 a cleaning stands on the ROOM, and a report filed from
-- a cleaning inherits that row (resolve_report_property takes the property
-- straight off the task), so a manager opening the house saw none of the
-- breakages reported inside it. The Maintenance tab is blind the same way and
-- not theoretically: the manual task form offers rooms and save_task accepts
-- them, so a repair can already be booked on one.
--
-- The fold is the server's, as in 20260917130000. The rule already exists
-- three times in SQL -- property_open_cleanings, open_cleanings_by_listing,
-- cleans_property -- and a fourth copy in TypeScript would be the weak one.
-- The panel also cannot make that copy cheaply: fetchRegistry deliberately
-- excludes rooms, so the ids are not on the client and fetching them first
-- would be both a round trip and a snapshot taken at a different moment.
--
-- The predicate is `= any (array(...))`, and that spelling was measured rather
-- than assumed. On 20,000 problems across 200 listings and 600 rooms, in a
-- transaction rolled back afterwards:
--
--   `a = x or a in (select ...)`  -- what property_open_cleanings writes --
--        Seq Scan on problems, 19,900 rows removed by filter.
--   `a = any (array(select ... union all select ...))`
--        Bitmap Index Scan on problems_property_idx, 134 heap blocks.
--
-- The OR form cannot use the index: the planner turns the subquery into a
-- hashed SubPlan and the disjunction forces it to look at every row. The array
-- form builds the id list once as an InitPlan and hands it to the index as
-- `= ANY`. A set-returning helper would have been worse still -- a `SET`
-- clause blocks SQL-function inlining, so it plans as an opaque ProjectSet.
--
-- property_open_cleanings (20260912120000:414-431) keeps the OR form. It is a
-- count over a table this one reads rows from, and changing it is not this
-- migration's business -- but it is the same fold and the same index, so it is
-- worth knowing the shape is not free.
--
-- `hostaway_unit_id`, never a bare `parent_id`. A part of a combined listing
-- is a real listing with a card of its own, where its reports are already
-- visible; folding it in would show the same report on two cards, one of
-- which owns neither the calendar nor the guests it came from.
--
-- Invoker, not definer. The manager policies on problems and tasks are
-- host-scoped already, and 20260917120000 has just taken a needless definer
-- away rather than added one.
--
-- `unit_name` is keyed on IDENTITY, not on roomness: it is the name of the row
-- this one stands on whenever that is not the property being asked about.
-- Asked about a room directly -- which the card does not do today but may --
-- the answer is null, because the card's own heading is already that room.
--
-- `p_limit` has no default. The panel is the only caller and holds
-- RECENT_LIMIT; a default here would be a second declaration of 60 in a second
-- language, which is the drift this file spends its header preaching against.

create or replace function public.property_problems(
  p_property_id bigint,
  p_limit       integer
)
returns table (
  id          uuid,
  title       text,
  status      public.problem_status,
  priority    public.problem_priority,
  created_at  timestamptz,
  resolved_at timestamptz,
  property_id bigint,
  unit_name   text
)
language sql
stable
set search_path = ''
as $$
  select pr.id, pr.title, pr.status, pr.priority, pr.created_at, pr.resolved_at,
         pr.property_id,
         case when p.id <> p_property_id then p.name end
  from public.problems pr
  join public.properties p on p.id = pr.property_id
  where pr.archived_at is null
    and pr.property_id = any (array(
          select p_property_id
          union all
          select u.id
          from public.properties u
          where u.parent_id = p_property_id
            and u.hostaway_unit_id is not null))
  order by pr.created_at desc
  limit greatest(p_limit, 1);
$$;

comment on function public.property_problems(bigint, integer) is
  'Reports on a listing and on the rooms inside it, newest first, archived ones left out. unit_name names the room when the report does not stand on the listing itself.';

create or replace function public.property_maintenance_tasks(
  p_property_id bigint,
  p_limit       integer
)
returns table (
  id             uuid,
  title          text,
  status         public.task_status,
  scheduled_date date,
  completed_at   timestamptz,
  assignee_name  text,
  property_id    bigint,
  unit_name      text
)
language sql
stable
set search_path = ''
as $$
  select t.id, t.title, t.status, t.scheduled_date, t.completed_at,
         a.full_name, t.property_id,
         case when p.id <> p_property_id then p.name end
  from public.tasks t
  join public.properties p on p.id = t.property_id
  left join public.profiles a on a.id = t.assignee_id
  where t.type = 'maintenance'
    and t.property_id = any (array(
          select p_property_id
          union all
          select u.id
          from public.properties u
          where u.parent_id = p_property_id
            and u.hostaway_unit_id is not null))
  order by t.scheduled_date desc nulls last, t.id
  limit greatest(p_limit, 1);
$$;

comment on function public.property_maintenance_tasks(bigint, integer) is
  'Repairs on a listing and on the rooms inside it, newest scheduled first. The technician arrives flat as assignee_name rather than as an embed, so the caller needs no join of its own.';

revoke all on function public.property_problems(bigint, integer) from public, anon;
grant execute on function public.property_problems(bigint, integer)
  to authenticated, service_role;

revoke all on function public.property_maintenance_tasks(bigint, integer) from public, anon;
grant execute on function public.property_maintenance_tasks(bigint, integer)
  to authenticated, service_role;
