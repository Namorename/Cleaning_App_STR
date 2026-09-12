-- A room is worked by whoever works the listing it is in.
--
-- A cleaner is linked to a listing (public.property_cleaners), and rooms are
-- rows of their own since 20260912120000. Nothing links a cleaner to a room,
-- and nothing should: the nine multi-unit listings hold thirty-one rooms
-- between them, so naming the same person on every room would turn nine
-- decisions into thirty-one, and every new room Hostaway reports would arrive
-- unmanned until somebody noticed. The link stays on the listing and the room
-- inherits it.
--
-- Two questions inherit, and they inherit differently:
--
--   who may SEE and TAKE the work — public.cleans_property(). A union: the
--   property's own cleaners plus, for a room, its listing's. Deliberately NOT
--   an override. A link on a room adds somebody, and if that addition silently
--   revoked the listing cleaner's view she would lose the ability to cover for
--   a colleague on that one room without knowing why. The house rule since
--   20260901140000 is that visibility follows the link and is generous; this
--   keeps it so.
--
--   whose it IS the moment it is generated — the auto pick inside
--   public.generate_cleaning_tasks. Here the arms cannot both be consulted: a
--   room and its listing may each carry an 'auto' link, the scalar subquery
--   that reads them accepts one row, and two abort the whole nightly
--   reconciliation with 21000. So the arms are ordered rather than merged, and
--   the room's own wins — the more specific statement about the narrower
--   thing. The shape is a coalesce of two single-row lookups, the same one
--   resolve_checklist_property and resolve_workflow_template already use for
--   "its own, otherwise its parent's".
--
-- No panel screen creates a room-level link and none is planned: the cleaner
-- picker leaves rooms out "permanently so rather than pending a later screen"
-- (apps/web/src/features/team/api.ts). The precedence is not here to serve a
-- manager's flow, then. It is here because PostgREST accepts the row whatever
-- the panel offers, and an ordering that exists only in somebody's head is the
-- one that returns two rows at three in the morning.
--
-- Nothing observable changes today. The generator still builds its work list
-- from reservations.property_id, which is always the listing, so no task has
-- ever been generated against a room and the inherited arm is unreachable
-- until the generator learns to split a booking across the rooms it occupies.
-- That is the next stage, and this one goes first on purpose: in the other
-- order there would be a window where rooms have cleanings and no cleaner can
-- see them.
--
-- One level, never recursive: guard_property_hierarchy (20260905093000, error
-- keys in 20260907120200) refuses a parent that is itself a child and a child
-- that is itself a parent, so the tree is exactly two deep and a recursive
-- climb would be dead code.
--
-- Gated on `hostaway_unit_id is not null`, never on bare `parent_id`. That
-- column carries two different relationships: a room, and a part of a combined
-- listing. A combined listing's part is a real Hostaway listing with its own
-- calendar and its own guests, and letting it inherit its parent's cleaners
-- would hand one listing's schedule to another listing's staff. Same reasoning
-- as the status cascade in 20260912120000.
--
-- The two resolvers cited above do inherit through bare `parent_id`, and that
-- is neither an oversight to copy nor one to correct here. A checklist and a
-- process describe how the work is done, and a part of a combined listing
-- borrowing the building's description is a sane default. Staff is not a
-- description but an authority — who may open the schedule and take the job —
-- and authority does not cross into a listing that keeps its own calendar and
-- its own guests.

/**
 * Is the current user assigned to clean this listing, or the listing this room
 * is in?
 *
 * security definer so a task policy can ask the question without the answer
 * being filtered by property_cleaners' own row security. No tenant filter,
 * unchanged from 20260901140000: all three callers — the two row policies on
 * public.tasks and public.resolve_report_property — carry
 * `host_id = public.current_host_id()` of their own, and
 * supabase/tests/tenant_isolation.sql exists to prove it is that check, not
 * this one, that stops a link reaching across companies.
 *
 * The two arms are separate `exists` clauses rather than one widened lookup so
 * that the second — the only one that touches public.properties — is reached
 * only when the first has already failed. `set search_path = ''` is restated
 * because `create or replace` silently clears proconfig when it is omitted,
 * and a security definer function resolving its tables through the caller's
 * search_path is not a smaller bug than a missing grant.
 */
create or replace function public.cleans_property(target_property_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.property_cleaners pc
    where pc.property_id = target_property_id
      and pc.cleaner_id = (select auth.uid())
  ) or exists (
    select 1
    from public.properties p
    join public.property_cleaners pc on pc.property_id = p.parent_id
    where p.id = target_property_id
      and p.hostaway_unit_id is not null
      and pc.cleaner_id = (select auth.uid())
  );
$$;

-- No grants restated: the signature is unchanged, and `create or replace`
-- keeps the ACL the function already carries from 20260901140000.

-- ---------------------------------------------------------------------------
--  The same inheritance where work is handed out
-- ---------------------------------------------------------------------------
--
-- Recreated from its current definition in 20260911160000 — the version that
-- gates on `p.status = 'active'` — with one expression changed: the pick of
-- the regular cleaner. Everything else is verbatim.
--
-- One asymmetry worth naming, because the sentence above about cleans_property
-- does not cover it: the generator has never filtered by tenant. It runs as
-- service_role, where current_host_id() is null, and reconciles the whole table
-- in one pass. The inherited arm keeps that property and adds no tenant check
-- of its own, so it leans on the invariant that a room and its listing are in
-- the same company — which the listing sync guarantees by writing the parent's
-- host_id onto the room (20260912120000), and which the schema does not yet
-- enforce, properties_parent_id_fkey naming one column and not the tenant. A
-- composite foreign key would close it, and does not belong on this migration:
-- it also changes what happens when a part of a combined listing is deleted,
-- which is a decision of its own and not a rider on this one.

create or replace function public.generate_cleaning_tasks(from_date date, to_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_created     integer;
  v_rescheduled integer;
  v_assigned    integer;
  v_cancelled   integer;
begin
  -- Reservations that should have a cleaning task, with window, guests,
  -- deadline and the listing's default cleaner already resolved.
  create temporary table _wanted on commit drop as
  select
    r.id             as reservation_id,
    r.property_id,
    r.departure_date as scheduled_date,
    (case when w.same_day_turnover then 1 else 0 end)::smallint as priority,
    w.window_from    as time_from,
    w.window_to      as time_to,
    w.guests_count,
    case
      when w.same_day_turnover and w.window_to is not null
      -- The next guest may arrive at that hour, so that is the hard deadline.
      -- Computed in the property's own timezone: a date is a calendar date
      -- there, not an instant in UTC.
      then (r.departure_date + w.window_to) at time zone p.timezone
    end as due_at,
    -- The regular cleaner: this property's own, the listing above it
    -- otherwise. Each arm matches at most one row — that is exactly what
    -- property_cleaners_one_auto guarantees, and it guarantees it per property,
    -- which is why the arms are a coalesce and not one widened WHERE.
    -- `pc.property_id in (p.id, p.parent_id)` would match both at once for a
    -- room carrying its own auto link under a listing that has one too, and a
    -- scalar subquery returning two rows does not mis-assign a cleaning — it
    -- aborts the whole nightly reconciliation with 21000.
    --
    -- Both arms are keyed off `p` and never off `r.property_id`, though the
    -- join makes those the same value today. `p` is the property being cleaned.
    -- A booking takes its rooms through public.reservation_units, and the
    -- fan-out over them is the next stage; the day this query stops being one
    -- row per booking, the first arm has to follow the room and not the
    -- booking. Keyed off `p` it follows whatever `p` becomes. Keyed off
    -- `r.property_id` it would quietly begin reading the listing in both arms,
    -- leaving the precedence below inert with every test still green.
    --
    -- A room's own 'claim' link does not stop the listing's auto link from
    -- reaching it. Inside a single listing a claim link has never stopped an
    -- auto link either: it puts a colleague in the queue, it does not empty
    -- the queue. Only an auto link answers "whose is this the moment it is
    -- made", so only an auto link on the room itself overrides the listing's.
    coalesce(
      (select pc.cleaner_id
       from public.property_cleaners pc
       where pc.property_id = p.id and pc.mode = 'auto'),
      (select pc.cleaner_id
       from public.property_cleaners pc
       where p.hostaway_unit_id is not null
         and pc.property_id = p.parent_id
         and pc.mode = 'auto')
    ) as auto_cleaner_id
  from public.reservations r
  join public.properties p on p.id = r.property_id
  cross join lateral public.reservation_cleaning_window(r.id) w
  where r.departure_date between from_date and to_date
    and r.status in ('new', 'modified')
    and not r.is_block
    and p.status = 'active';

  -- Insert missing tasks. The partial unique index on reservation_id keeps
  -- this idempotent: a repeated run collides and does nothing.
  with inserted as (
    insert into public.tasks (
      property_id, reservation_id, type, status, priority,
      scheduled_date, time_from, time_to, guests_count, due_at, assignee_id
    )
    select
      w.property_id, w.reservation_id, 'cleaning',
      (case when w.auto_cleaner_id is not null then 'assigned' else 'unassigned' end)
        ::public.task_status,
      w.priority, w.scheduled_date, w.time_from, w.time_to, w.guests_count,
      w.due_at, w.auto_cleaner_id
    from _wanted w
    where not exists (
      select 1 from public.tasks t
      where t.reservation_id = w.reservation_id
        and t.type = 'cleaning'
        and t.status not in ('cancelled', 'expired')
    )
    returning 1
  )
  select count(*) into v_created from inserted;

  -- Move tasks whose booking shifted, whose window changed, or whose guest
  -- count changed. Only untouched tasks: once a cleaner has accepted or
  -- started, rewriting the job underneath her is worse than leaving it for a
  -- human to sort out.
  with moved as (
    update public.tasks t
    set scheduled_date = w.scheduled_date,
        priority       = w.priority,
        time_from      = w.time_from,
        time_to        = w.time_to,
        guests_count   = w.guests_count,
        due_at         = w.due_at
    from _wanted w
    where t.reservation_id = w.reservation_id
      and t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned')
      and (t.scheduled_date is distinct from w.scheduled_date
           or t.priority is distinct from w.priority
           or t.time_from is distinct from w.time_from
           or t.time_to is distinct from w.time_to
           or t.guests_count is distinct from w.guests_count
           or t.due_at is distinct from w.due_at)
    returning 1
  )
  select count(*) into v_rescheduled from moved;

  -- Hand over tasks that are still waiting on a listing with a default
  -- cleaner. This covers the link being switched to 'auto' after the task
  -- already existed — the same shape as a stale deadline, where state set once
  -- at creation was never revisited.
  --
  -- Only genuinely free work: a task someone already holds, whether claimed by
  -- a cleaner or handed over by the manager, is left exactly as it is.
  with taken as (
    update public.tasks t
    set assignee_id = w.auto_cleaner_id,
        status      = 'assigned'
    from _wanted w
    where t.reservation_id = w.reservation_id
      and t.type = 'cleaning'
      and t.status = 'unassigned'
      and t.assignee_id is null
      and w.auto_cleaner_id is not null
    returning 1
  )
  select count(*) into v_assigned from taken;

  -- Cancel tasks whose reservation no longer qualifies: cancelled, turned into
  -- an inquiry, became a block, moved out of the window entirely — or whose
  -- listing has since gone into maintenance or been archived.
  --
  -- Work already done or under way is never touched, and neither is work that
  -- expired: those are answers about what happened, not open questions.
  with dropped as (
    update public.tasks t
    set status = 'cancelled'
    where t.type = 'cleaning'
      and t.reservation_id is not null
      and t.status in ('unassigned', 'assigned')
      and t.scheduled_date between from_date and to_date
      and not exists (
        select 1 from _wanted w where w.reservation_id = t.reservation_id
      )
    returning 1
  )
  select count(*) into v_cancelled from dropped;

  drop table _wanted;

  return jsonb_build_object(
    'window_from', from_date,
    'window_to', to_date,
    'created', v_created,
    'rescheduled', v_rescheduled,
    'assigned', v_assigned,
    'cancelled', v_cancelled
  );
end;
$function$;
