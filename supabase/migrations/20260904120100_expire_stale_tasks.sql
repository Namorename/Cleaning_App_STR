-- Closing cleanings that were never done.
--
-- Until now a task's date carried no meaning once it had gone by: the row
-- stayed 'unassigned' for ever, so the queue offered a cleaner work from the
-- previous week and let her take it. Found on 2026-09-04.
--
-- The rule from here on: past its grace period an open task becomes
-- 'expired' — a terminal status. Nothing is deleted; the record of what was
-- not done is exactly what a manager needs. But the task leaves the active
-- queue, and claiming it is refused by the database rather than merely hidden
-- by the app: hiding it in the client would leave the same broken write one
-- crafted request away, and a second client (the manager panel in F10) would
-- have to reimplement the same rule and get it right again.

/**
 * How long after its day a cleaning may still be picked up.
 *
 * One whole day. A cleaning that runs past midnight, or that the cleaner
 * catches up on the following morning, is ordinary work — expiring it at
 * 00:00 would close tasks that are actively being done. Still open the day
 * after that, it is not going to happen: the guest has arrived, and whatever
 * had to be solved was solved by hand.
 *
 * Declared as a function rather than written into the queries so that the
 * period is defined once, and the policy and the nightly sweep can never
 * disagree about it.
 */
create or replace function public.task_grace_days()
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$ select 1 $$;

/**
 * Is this task past the day it could still be done?
 *
 * Judged in the listing's own timezone: this account spans properties in
 * different zones, and a date is a calendar date there, not an instant in UTC.
 *
 * security definer so that a row policy can ask the question without the
 * answer depending on whether the caller may read the listing.
 */
create or replace function public.task_is_stale(
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
           < ((now() at time zone p.timezone)::date - public.task_grace_days())
  from public.properties p
  where p.id = target_property_id
$$;

revoke all on function public.task_grace_days() from public, anon;
revoke all on function public.task_is_stale(bigint, date) from public, anon;
grant execute on function public.task_grace_days() to authenticated, service_role;
grant execute on function public.task_is_stale(bigint, date) to authenticated, service_role;

-- ---------- the new status is terminal ----------

-- An expired task that nobody ever took has no assignee, so it needs the same
-- exemption as 'unassigned', 'cancelled' and 'done'.
alter table public.tasks drop constraint tasks_assigned_has_assignee;
alter table public.tasks add constraint tasks_assigned_has_assignee
  check (status in ('unassigned', 'cancelled', 'done', 'expired')
         or assignee_id is not null);

-- Expiring must not block the listing for ever. If the booking is rescheduled
-- into the future, the generator owes a fresh task for it, and the slot the
-- expired attempt occupies has to be free — the same reasoning that already
-- excluded 'cancelled'.
drop index public.tasks_one_cleaning_per_reservation;
create unique index tasks_one_cleaning_per_reservation
  on public.tasks (reservation_id)
  where type = 'cleaning' and reservation_id is not null
        and status not in ('cancelled', 'expired');

-- The cleaner's own list is of work she can still do; expired rows would
-- accumulate in this index for ever without ever being read from it.
drop index public.tasks_assignee_date_idx;
create index tasks_assignee_date_idx on public.tasks (assignee_id, scheduled_date)
  where status not in ('done', 'cancelled', 'expired');

-- The manager's review list: closed, unfinished, most recent first.
create index tasks_expired_idx on public.tasks (scheduled_date desc)
  where status = 'expired';

/**
 * Guard the parts of a task an executor does not own.
 *
 * Unchanged from 20260824190400 except for the first rule: a closed task stays
 * closed. Without it the cleaner holding an expired task could simply set it
 * back to 'in_progress' — she owns the row, so her own update policy lets it
 * through — and the whole point of a terminal status would be gone. The same
 * now holds for 'done' and 'cancelled', which had the same hole.
 *
 * It raises rather than silently reverting: a refusal the client is told about
 * can be shown to the cleaner, whereas a silent revert reads as a save that
 * worked.
 */
create or replace function public.guard_task_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Серверный контекст (service_role, генератор задач) не ограничиваем.
  if (select auth.uid()) is null then
    return new;
  end if;

  if not public.is_manager() then
    if old.status in ('done', 'cancelled', 'expired') then
      raise exception
        'Задача закрыта со статусом % и не может быть изменена исполнителем', old.status
        using errcode = 'check_violation';
    end if;

    -- assignee_id намеренно НЕ откатывается здесь: смену владельца ловит
    -- WITH CHECK политики и отдаёт явную ошибку. Молчаливый откат здесь
    -- перехватил бы её до проверки, и клиент считал бы передачу успешной.
    new.property_id    := old.property_id;
    new.reservation_id := old.reservation_id;
    new.type           := old.type;
    new.priority       := old.priority;
    new.scheduled_date := old.scheduled_date;
    new.due_at         := old.due_at;
  end if;

  return new;
end;
$$;

-- ---------- claiming ----------

-- Replaces the policy from 20260901140000 with one extra condition. The
-- nightly sweep is a sweeper, not the guarantee: between midnight and the job
-- a task past its grace is still 'unassigned', and it must already be out of
-- reach by then.
drop policy "cleaner claims a free task on her listings" on public.tasks;

create policy "cleaner claims a free task on her listings"
  on public.tasks for update
  to authenticated
  using (assignee_id is null
         and status = 'unassigned'
         and not public.task_is_stale(property_id, scheduled_date)
         and public.cleans_property(property_id)
         and public.is_active_user())
  with check (assignee_id = (select auth.uid())
              and status = 'assigned');

-- ---------- the sweep ----------

/**
 * Close every open task whose grace period has run out.
 *
 * Returns the two numbers a manager reads differently: work nobody took, and
 * work somebody took and did not finish. The second is the one worth a
 * conversation.
 *
 * The staleness test is the same function the claim policy uses, one row at a
 * time rather than as a join, so the two can never drift apart. At this size —
 * a few hundred open tasks — the cost of that is not measurable.
 */
create or replace function public.expire_stale_tasks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unclaimed  integer;
  v_unfinished integer;
begin
  with swept as (
    update public.tasks t
    set status = 'expired'
    where t.status not in ('done', 'cancelled', 'expired')
      and public.task_is_stale(t.property_id, t.scheduled_date)
    returning t.assignee_id
  )
  select count(*) filter (where assignee_id is null),
         count(*) filter (where assignee_id is not null)
    into v_unclaimed, v_unfinished
  from swept;

  return jsonb_build_object(
    'expired_unclaimed', v_unclaimed,
    'expired_unfinished', v_unfinished
  );
end;
$$;

revoke all on function public.expire_stale_tasks() from public, anon, authenticated;
grant execute on function public.expire_stale_tasks() to service_role;

-- ---------- what the manager sees ----------

/**
 * Expired cleanings, with the names behind the ids.
 *
 * Closing a task must not make it disappear quietly. Until the manager panel
 * exists (F10) this view is where unfinished work is read from; afterwards it
 * is what that screen selects.
 *
 * security_invoker so the underlying row policies still apply: a manager sees
 * everything, a cleaner sees only the listings she is linked to.
 */
create view public.expired_tasks_review
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
  t.updated_at as expired_at
from public.tasks t
join public.properties p on p.id = t.property_id
left join public.profiles pr on pr.id = t.assignee_id
where t.type = 'cleaning' and t.status = 'expired';

comment on view public.expired_tasks_review is
  'Cleanings closed as expired: what was not done, when, and who was holding it.';

grant select on public.expired_tasks_review to authenticated, service_role;

-- Belt and braces: the hosted project hands new public objects to anon through
-- default privileges while the local stack does not, so the smoke test cannot
-- see the difference. Revoking explicitly costs nothing.
revoke all on public.expired_tasks_review from anon;

-- ---------- generator ----------

/**
 * Reconcile cleaning tasks for departures in the given window.
 *
 * Unchanged from 20260901140000 apart from one clause: a task that expired no
 * longer counts as the task a reservation already has. Without that, a booking
 * rescheduled into the future after its first attempt expired would never get
 * a new task — the expired row would answer "one exists" for ever.
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
        and t.status not in ('cancelled', 'expired')
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
$$;

revoke all on function public.generate_cleaning_tasks(date, date) from public, anon, authenticated;
grant execute on function public.generate_cleaning_tasks(date, date) to service_role;

-- ---------- schedule ----------

-- Runs after the nightly reconciliation (03:15), never before it: a booking
-- that moved forward must have its task rescheduled before anything judges the
-- date stale, otherwise the sweep would close a task that is no longer late.
--
-- cron.schedule is idempotent by job name, so re-running this migration
-- updates the schedule instead of creating duplicates.
select cron.schedule(
  'expire-stale-tasks',
  '30 3 * * *',
  $$select public.expire_stale_tasks()$$
);
