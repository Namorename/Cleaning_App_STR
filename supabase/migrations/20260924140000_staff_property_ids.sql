-- Window 3, Б1: which property rows a non-manager may read -- the rule.
--
-- Until now any active member of staff read every property of her company:
-- the name (18 of 110 in production carry a door code), the address and the
-- note for the cleaner. The screens of the phone show only her own places,
-- so the hole was in the API. The policy that closes it comes in the next
-- file; this one adds the rule it stands on (docs/window3-plan.md, «Б»).
--
-- A cleaner or a technician reads a property P of her company when she is
-- tied to P or to a room or part right under it:
--   * linked to it in property_cleaners;
--   * assignee of a task on it, in ANY status and with no lower bound in time
--     -- the history. A narrower rule was turned down on 2026-09-11 because
--     the places of finished work would lose their names;
--   * author of a problem or of a supply request on it, archived ones too;
-- and she reads the real rooms (hostaway_unit_id) under a listing she is
-- linked to -- the second arm of cleans_property, unchanged, which is what the
-- free queue and the report picker stand on. The listing above any tied row
-- comes along through bare parent_id, the same way effective_cleaner_notes
-- inherits: the phone embeds parent:parent_id(name) in all three feeds and
-- reads the key-box note through the parent. The tree is two levels deep, so
-- one step up is all there is.
--
-- A technician is covered by the assignee arm: a repair's property is copied
-- from its problem (assign_problem) and frozen for non-managers
-- (guard_task_fields). There is no completed_by arm (owner's word
-- 2026-09-24): a finisher who is not the assignee is always a manager, and a
-- cleaner cannot read such a task anyway.
--
-- The price, accepted by the owner: a cleaner who once got a task on a flat
-- (a stand-in shift) reads that flat for good -- name, address, where the
-- keys are. She has been there; a deactivated one loses everything.
--
-- A SET, not a per-row test. A per-row definer function in the policy was
-- measured first, on a seed the size of production (110 properties, about
-- 6000 tasks), under the generic plan PostgREST runs: the assignee arm became
-- a Seq Scan of tasks on every row, and the phone's task feed went from 40 to
-- about 240 ms. The same rule as a set behind `id = any (array(...))` is built
-- once per statement as an InitPlan and handed to the primary key -- 65 ms,
-- the shape 20260917160000 measured for the listing card.
--
-- Definer, search_path ''. The arms read tasks, problems and supply requests
-- past the caller's own horizon and archive filters, and an invoker body that
-- reads properties would re-enter the very policy it serves. There is no
-- company filter inside, as in cleans_property: the policy carries
-- host_id = current_host_id(), and a stray link or room of another company
-- yields an id the policy then refuses.
--
-- LOCKS. The index takes SHARE on public.tasks until this file commits. It is
-- a file of its own for that reason: in one transaction with the policy swap
-- it held tasks while waiting for ACCESS EXCLUSIVE on properties, and the
-- generator, which reads properties and then writes tasks on every webhook
-- batch, deadlocked against it in a rolled-back experiment.

set local lock_timeout = '3s';

create function public.staff_property_ids()
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  with tie as (
    select pc.property_id as id
    from public.property_cleaners pc
    where pc.cleaner_id = (select auth.uid())
    union
    select t.property_id
    from public.tasks t
    where t.assignee_id = (select auth.uid())
    union
    select pr.property_id
    from public.problems pr
    where pr.reported_by = (select auth.uid())
      and pr.property_id is not null
    union
    select sr.property_id
    from public.supply_requests sr
    where sr.requested_by = (select auth.uid())
      and sr.property_id is not null
  )
  select tie.id from tie
  union
  -- the listing above a tied row
  select p.parent_id
  from public.properties p
  join tie on tie.id = p.id
  where p.parent_id is not null
  union
  -- the rooms under a linked listing
  select r.id
  from public.properties r
  join public.property_cleaners pc on pc.property_id = r.parent_id
  where pc.cleaner_id = (select auth.uid())
    and r.hostaway_unit_id is not null;
$$;

comment on function public.staff_property_ids() is
  'Property ids a non-manager may read: tied (linked, assignee in any status, problem or supply author) to the row or to a room/part right under it, plus the rooms under a linked listing. The read policy of properties for staff. docs/window3-plan.md.';

revoke all on function public.staff_property_ids() from public, anon;
grant execute on function public.staff_property_ids() to authenticated, service_role;

-- The assignee arm reads every task she ever had, closed ones included.
-- tasks_assignee_date_idx is partial and leaves out done, cancelled and
-- expired (20260904120100), which are exactly the history.
create index tasks_assignee_property_idx
  on public.tasks (assignee_id, property_id)
  where assignee_id is not null;

-- effective_cleaner_notes stays invoker. It was made so while every member
-- of staff read every listing (20260917150000); it stays right because the
-- listing above any row she reads is now hers to read by the rule itself.
comment on function public.effective_cleaner_notes(public.properties) is
  'The note for the cleaner at the door: the row''s own, else the listing above it. Invoker: the parent is read under the caller''s policy, which since window 3 always admits the listing above a row she reads (staff_property_ids).';
