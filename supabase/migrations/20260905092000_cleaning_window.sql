-- F15. The cleaning window, the arriving guest, and the columns the panel owes.
--
-- A cleaning is not "a day". It is the gap between the guest who leaves and
-- the guest who arrives, and until now the task carried only a deadline, and
-- only when the next guest came the same day. An ordinary cleaning had no time
-- at all — nothing for a calendar to draw and nothing for a cleaner to plan by.
--
-- From here on every task carries `time_from` / `time_to`:
--   start = the departing booking's own check-out hour,
--   end   = the arriving booking's own check-in hour,
--   and the listing's standard window only where the booking says nothing.
--
-- `due_at` stays what it always was — the hard deadline, set only when someone
-- is actually arriving. It is `time_to` expressed as an instant, and it is kept
-- rather than derived on the client because turning a local time into an
-- instant needs the listing's timezone.

-- ---------- one definition of a cleaning window ----------

/**
 * The window a cleaning has to fit into, and who it is being prepared for.
 *
 * Both ends prefer the booking's own hour and fall back to the listing's
 * standard one. 00:00 is treated as "the channel gave no time" rather than as
 * midnight: Hostaway sends 0 when it has nothing, a midnight arrival is not a
 * thing in this portfolio, and a window ending at 00:00 would end before it
 * began. A genuinely conflicting window — an arrival earlier than the
 * departure it follows — is left as it is: that is a real problem to surface
 * later (F23), not one to smooth over here.
 *
 * Declared once and used by the generator and by the backfill below, so the
 * planned window and the recorded window cannot drift apart.
 */
create or replace function public.reservation_cleaning_window(
  target_reservation_id bigint
)
returns table (
  window_from       time,
  window_to         time,
  guests_count      smallint,
  same_day_turnover boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce(nullif(r.check_out_time, time '00:00'), p.check_out_time),
    coalesce(nullif(nxt.check_in_time, time '00:00'), p.check_in_time),
    nxt.guests_count,
    nxt.id is not null
  from public.reservations r
  join public.properties p on p.id = r.property_id
  -- The guest who arrives on the day this one leaves. At most one matters;
  -- ordering by id keeps the answer stable if the data ever holds two.
  left join lateral (
    select n.id, n.check_in_time, n.guests_count
    from public.reservations n
    where n.property_id = r.property_id
      and n.arrival_date = r.departure_date
      and n.id <> r.id
      and n.status in ('new', 'modified')
      and not n.is_block
    order by n.id
    limit 1
  ) nxt on true
  where r.id = target_reservation_id
$$;

revoke all on function public.reservation_cleaning_window(bigint) from public, anon;
grant execute on function public.reservation_cleaning_window(bigint)
  to authenticated, service_role;

-- ---------- columns ----------

alter table public.tasks
  add column time_from    time,
  add column time_to      time,
  add column guests_count smallint,
  -- The person who actually closed the work. Usually the assignee, but a
  -- colleague finishing someone else's shift is an ordinary event, and the
  -- hours report is wrong if it credits the wrong person.
  add column completed_by uuid references public.profiles(id) on delete set null;

comment on column public.tasks.time_from is
  'Start of the cleaning window: when the departing guest actually leaves.';
comment on column public.tasks.time_to is
  'End of the cleaning window: when the next guest may arrive, or the listing check-in if none.';
comment on column public.tasks.guests_count is
  'Guests of the ARRIVING booking — the cleaning prepares the flat for them, not for whoever just left.';

alter table public.properties
  add column cleaner_notes  text,
  add column internal_notes text;

comment on column public.properties.cleaner_notes is
  'Shown to the cleaner in the task and in Help. Access codes and quirks of the flat.';
comment on column public.properties.internal_notes is
  'Office only. Never leaves the manager panel.';

-- The order in which cleaners are offered work on a listing. Nothing reads it
-- yet: the "by priority" strategy waits for pool offers (F21). It is added now
-- because the link table is small and the column is free today.
alter table public.property_cleaners
  add column priority smallint not null default 1;

comment on column public.property_cleaners.priority is
  'Lower goes first when work is offered by priority. 1 is the listing main cleaner.';

-- ---------- the cleaner does not move her own window ----------

/**
 * Guard the parts of a task an executor does not own.
 *
 * Unchanged from 20260904120100 except that the window and the guest count
 * join the fields an executor cannot rewrite. They are the statement of the
 * job, exactly like the date: a cleaner who could widen her own window would
 * be marking herself on time by moving the finish line.
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
    new.time_from      := old.time_from;
    new.time_to        := old.time_to;
    new.guests_count   := old.guests_count;
  end if;

  return new;
end;
$$;

-- ---------- generator ----------

/**
 * Reconcile cleaning tasks for departures in the given window.
 *
 * Changed from 20260904120100: the window, the guest count and the deadline
 * all come from public.reservation_cleaning_window(), so a late check-out
 * bought after the task was created moves the task on the next run. That is
 * the same defect class as the stale due_at fixed on 2026-09-01 — state
 * written once at creation and never revisited — and it is why the rerun
 * branch compares the window too.
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
    -- At most one row can match: property_cleaners_one_auto guarantees it.
    (select pc.cleaner_id
     from public.property_cleaners pc
     where pc.property_id = r.property_id and pc.mode = 'auto') as auto_cleaner_id
  from public.reservations r
  join public.properties p on p.id = r.property_id
  cross join lateral public.reservation_cleaning_window(r.id) w
  where r.departure_date between from_date and to_date
    and r.status in ('new', 'modified')
    and not r.is_block
    and p.is_active;

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

-- ---------- backfill ----------

-- Existing tasks were created before the window existed. Filled through the
-- same function the generator uses, so history and future agree.
--
-- `due_at` is deliberately not rewritten here: a finished cleaning keeps the
-- deadline it was actually judged against, and live tasks get theirs from the
-- generator's next run, which is the path that is under test.
update public.tasks t
set time_from    = w.window_from,
    time_to      = w.window_to,
    guests_count = w.guests_count
from public.reservations r,
     lateral public.reservation_cleaning_window(r.id) w
where r.id = t.reservation_id
  and t.type = 'cleaning'
  and t.time_from is null;
