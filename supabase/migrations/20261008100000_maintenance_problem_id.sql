-- The listing card's job row learns which report a repair fixes.
--
-- A repair booked from a report talks in the report's thread, not in one of
-- its own. The card's maintenance tab reads its jobs through
-- property_maintenance_tasks(), whose rows carried no problem_id, so it could
-- mark a job's own thread but never its report's (review of 2026-10-05). The
-- new column is tasks.problem_id — the link the problem's status follows.
--
-- RETURNS TABLE cannot grow under CREATE OR REPLACE, so the function is dropped
-- and created again inside this migration's transaction. The new column goes
-- last: PostgREST hands rows out by name, and the panel's zod schema drops keys
-- it does not know, so the panel already in production keeps reading the old
-- eight until it is taught the ninth. Apart from that column the body is the
-- one in 20260917160000_listing_card_rooms.sql, word for word.
--
-- A dropped function takes its grants with it, and a created one hands EXECUTE
-- to PUBLIC, so the revoke and the grant are repeated as they were.

drop function public.property_maintenance_tasks(bigint, integer);

create function public.property_maintenance_tasks(
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
  unit_name      text,
  problem_id     uuid
)
language sql
stable
set search_path = ''
as $$
  select t.id, t.title, t.status, t.scheduled_date, t.completed_at,
         a.full_name, t.property_id,
         case when p.id <> p_property_id then p.name end,
         t.problem_id
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
  'Repairs on a listing and on the rooms inside it, newest scheduled first. The technician arrives flat as assignee_name rather than as an embed, so the caller needs no join of its own. problem_id names the report a repair fixes: such a repair talks in that report''s thread.';

revoke all on function public.property_maintenance_tasks(bigint, integer) from public, anon;
grant execute on function public.property_maintenance_tasks(bigint, integer)
  to authenticated, service_role;
