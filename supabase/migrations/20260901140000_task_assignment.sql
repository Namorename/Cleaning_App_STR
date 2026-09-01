-- Who cleans which listing, and how the task reaches her.
--
-- A cleaner is linked to the listings she works on. Each link carries its own
-- mode, because the two arrangements coexist in the same company:
--   'auto'  — the listing has a regular cleaner; the task is hers the moment
--             it is generated, and she finds it already in her list.
--   'claim' — several interchangeable cleaners share the listing; the task
--             waits in the queue and whoever takes it first gets it.
--
-- The mode sits on the link rather than on the listing so that one cleaner can
-- be the default for a listing while others still see its queue.
--
-- A listing may have at most one 'auto' link. With two, "assign immediately"
-- has no defined answer, and picking one arbitrarily would look like the
-- system losing work. The partial unique index turns that into an error the
-- manager sees at the moment of the mistake.
--
-- Visibility follows the link, not the assignment: a cleaner sees the whole
-- schedule of her listings, including work a colleague has taken, so she can
-- cover for someone without asking the office.

create type public.assignment_mode as enum ('auto', 'claim');

create table public.property_cleaners (
  property_id bigint not null references public.properties(id) on delete cascade,
  cleaner_id  uuid   not null references public.profiles(id)   on delete cascade,
  mode        public.assignment_mode not null default 'claim',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (property_id, cleaner_id)
);

comment on table public.property_cleaners is
  'Which cleaners work a listing, and whether tasks are handed to them or queued.';

-- "Assign immediately" must resolve to exactly one person.
create unique index property_cleaners_one_auto
  on public.property_cleaners (property_id)
  where mode = 'auto';

-- The cleaner's own listing list, read on every task query through
-- public.cleans_property().
create index property_cleaners_cleaner_idx
  on public.property_cleaners (cleaner_id);

create trigger property_cleaners_touch
  before update on public.property_cleaners
  for each row execute function public.touch_updated_at();

grant select, insert, update, delete on public.property_cleaners to authenticated, service_role;

-- Belt and braces: default privileges for anon were revoked in
-- 20260825030000, but that fix was found the hard way — the hosted project
-- hands new public tables to anon while the local stack does not, so the
-- smoke test cannot see the difference. Revoking explicitly costs nothing.
revoke all on public.property_cleaners from anon;

alter table public.property_cleaners enable row level security;

create policy "cleaner reads own links"
  on public.property_cleaners for select
  to authenticated
  using (cleaner_id = (select auth.uid()) and public.is_active_user());

create policy "managers read all links"
  on public.property_cleaners for select
  to authenticated
  using (public.is_manager());

create policy "managers write links"
  on public.property_cleaners for all
  to authenticated
  using (public.is_manager())
  with check (public.is_manager());

/**
 * Is the current user assigned to clean this listing?
 *
 * security definer so a task policy can ask the question without the answer
 * being filtered by property_cleaners' own row security.
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
  );
$$;

revoke all on function public.cleans_property(bigint) from public, anon;
grant execute on function public.cleans_property(bigint) to authenticated, service_role;

-- ---------- task visibility and claiming ----------

-- Sits alongside "assignee reads own tasks": permissive policies are OR-ed, so
-- a cleaner keeps her own tasks and gains the schedule of her listings.
create policy "cleaner reads tasks of her listings"
  on public.tasks for select
  to authenticated
  using (public.cleans_property(property_id) and public.is_active_user());

-- Taking a free task. USING keeps it to work nobody holds on a listing she is
-- linked to, so an already-claimed task is simply not visible to this policy
-- and the update touches nothing. WITH CHECK stops her from writing anyone
-- else's name into it.
create policy "cleaner claims a free task on her listings"
  on public.tasks for update
  to authenticated
  using (assignee_id is null
         and status = 'unassigned'
         and public.cleans_property(property_id)
         and public.is_active_user())
  with check (assignee_id = (select auth.uid())
              and status = 'assigned');

-- ---------- generator ----------

/**
 * Reconcile cleaning tasks for departures in the given window.
 *
 * Returns counts so the caller can log what changed.
 */
create or replace function public.generate_cleaning_tasks(
  from_date date,
  to_date   date
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created     integer;
  v_rescheduled integer;
  v_assigned    integer;
  v_cancelled   integer;
begin
  -- Reservations that should have a cleaning task, with priority, deadline and
  -- the listing's default cleaner already resolved. A same-day arrival makes
  -- the deadline the next guest's check-in time; otherwise the task simply
  -- belongs to that day.
  create temporary table _wanted on commit drop as
  with departures as (
    select
      r.id             as reservation_id,
      r.property_id,
      r.departure_date as scheduled_date,
      exists (
        select 1
        from public.reservations nxt
        where nxt.property_id = r.property_id
          and nxt.arrival_date = r.departure_date
          and nxt.id <> r.id
          and nxt.status in ('new', 'modified')
          and not nxt.is_block
      )                as same_day_turnover,
      p.timezone,
      p.check_in_time
    from public.reservations r
    join public.properties p on p.id = r.property_id
    where r.departure_date between from_date and to_date
      and r.status in ('new', 'modified')
      and not r.is_block
      and p.is_active
  )
  select
    d.reservation_id,
    d.property_id,
    d.scheduled_date,
    (case when d.same_day_turnover then 1 else 0 end)::smallint as priority,
    case
      when d.same_day_turnover and d.check_in_time is not null
      -- The next guest may arrive at check-in time, so that is the hard
      -- deadline. Computed in the property's own timezone: two of the
      -- properties in this account check in at 16:00 and 17:00, not 15:00.
      then (d.scheduled_date + d.check_in_time) at time zone d.timezone
    end as due_at,
    -- At most one row can match: property_cleaners_one_auto guarantees it.
    (select pc.cleaner_id
     from public.property_cleaners pc
     where pc.property_id = d.property_id and pc.mode = 'auto') as auto_cleaner_id
  from departures d;

  -- Insert missing tasks. The partial unique index on reservation_id keeps
  -- this idempotent: a repeated run collides and does nothing.
  with inserted as (
    insert into public.tasks (
      property_id, reservation_id, type, status, priority,
      scheduled_date, due_at, assignee_id
    )
    select
      w.property_id, w.reservation_id, 'cleaning',
      (case when w.auto_cleaner_id is not null then 'assigned' else 'unassigned' end)
        ::public.task_status,
      w.priority, w.scheduled_date, w.due_at, w.auto_cleaner_id
    from _wanted w
    where not exists (
      select 1 from public.tasks t
      where t.reservation_id = w.reservation_id
        and t.type = 'cleaning'
        and t.status <> 'cancelled'
    )
    returning 1
  )
  select count(*) into v_created from inserted;

  -- Move tasks whose reservation was shifted, or whose deadline no longer
  -- matches the property. Only untouched tasks: once a cleaner has accepted or
  -- started, rescheduling underneath them would be worse than leaving the task
  -- where it is for a human to sort out.
  with moved as (
    update public.tasks t
    set scheduled_date = w.scheduled_date,
        priority       = w.priority,
        due_at         = w.due_at
    from _wanted w
    where t.reservation_id = w.reservation_id
      and t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned')
      and (t.scheduled_date is distinct from w.scheduled_date
           or t.priority is distinct from w.priority
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
  -- an inquiry, became a block, or moved out of the window entirely.
  --
  -- Work already done or under way is never touched. A cleaner who finished a
  -- flat must keep the record of it even if the booking was cancelled
  -- afterwards, and pulling a task out from under someone mid-shift is worse
  -- than leaving a spare one.
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
$$;

revoke all on function public.generate_cleaning_tasks(date, date) from public, anon, authenticated;
grant execute on function public.generate_cleaning_tasks(date, date) to service_role;
