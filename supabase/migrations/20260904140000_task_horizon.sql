-- How far ahead a cleaner works.
--
-- The queue showed the whole future of a listing. A month out the schedule is
-- still being reshuffled by arrivals, cancellations and shifted departures, so
-- a task taken then is a promise nobody can keep — and the list a cleaner
-- opens in a doorway is about what to do next, not about November.
--
-- From here on she sees, and can take, a rolling window of the next seven
-- days. Like the grace period at the other end, the rule lives in the row
-- policies rather than in a client filter: a task beyond the horizon is not
-- returned at all, so there is no value for the app to mirror and nothing for
-- the two to disagree about. The manager is on no horizon.

/**
 * How many days ahead the cleaner's window reaches.
 *
 * Sits next to public.task_grace_days(), which bounds the same window at the
 * other end: grace is how long after its day a task can still be done, horizon
 * is how long before it a task is worth showing at all.
 */
create or replace function public.task_horizon_days()
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$ select 7 $$;

/**
 * Is this task further ahead than a cleaner is asked to look?
 *
 * Judged in the listing's own timezone, for the same reason as staleness: a
 * scheduled date is a calendar date there, not an instant in UTC.
 *
 * security definer so a row policy can ask without the answer depending on
 * whether the caller may read the listing.
 */
create or replace function public.task_is_beyond_horizon(
  target_property_id    bigint,
  target_scheduled_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target_scheduled_date
           > ((now() at time zone p.timezone)::date + public.task_horizon_days())
  from public.properties p
  where p.id = target_property_id
$$;

revoke all on function public.task_horizon_days() from public, anon;
revoke all on function public.task_is_beyond_horizon(bigint, date) from public, anon;
grant execute on function public.task_horizon_days() to authenticated, service_role;
grant execute on function public.task_is_beyond_horizon(bigint, date) to authenticated, service_role;

-- ---------- what a cleaner sees ----------

-- An upper bound only. Everything already done stays readable: the record of
-- a listing is not something to hide from the person who cleaned it.
drop policy "assignee reads own tasks" on public.tasks;

create policy "assignee reads own tasks"
  on public.tasks for select
  to authenticated
  using (assignee_id = (select auth.uid())
         and not public.task_is_beyond_horizon(property_id, scheduled_date)
         and public.is_active_user());

drop policy "cleaner reads tasks of her listings" on public.tasks;

create policy "cleaner reads tasks of her listings"
  on public.tasks for select
  to authenticated
  using (public.cleans_property(property_id)
         and not public.task_is_beyond_horizon(property_id, scheduled_date)
         and public.is_active_user());

-- ---------- what a cleaner touches ----------

-- Kept in step with the read policy on purpose. A row that is invisible but
-- still writable is a state nobody can reason about: the app would never show
-- it, and only a crafted request could reach it.
drop policy "assignee updates own tasks" on public.tasks;

create policy "assignee updates own tasks"
  on public.tasks for update
  to authenticated
  using (assignee_id = (select auth.uid())
         and not public.task_is_beyond_horizon(property_id, scheduled_date)
         and public.is_active_user())
  with check (assignee_id = (select auth.uid()));

-- Replaces the policy from 20260904120100 with the far end of the same window.
drop policy "cleaner claims a free task on her listings" on public.tasks;

create policy "cleaner claims a free task on her listings"
  on public.tasks for update
  to authenticated
  using (assignee_id is null
         and status = 'unassigned'
         and not public.task_is_stale(property_id, scheduled_date)
         and not public.task_is_beyond_horizon(property_id, scheduled_date)
         and public.cleans_property(property_id)
         and public.is_active_user())
  with check (assignee_id = (select auth.uid())
              and status = 'assigned');
