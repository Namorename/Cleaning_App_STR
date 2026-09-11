-- The three states a listing can be in, in place of a boolean.
--
-- `is_active` answered one question — does this listing get cleanings — and
-- the panel needs two. A flat under renovation is not a flat that has left the
-- company: both stop the cleaning schedule, but only one of them is coming
-- back, and only one should still turn up in a list where a manager files a
-- problem or books a technician. A boolean cannot hold that difference, and
-- the two were being told apart by memory.
--
-- Hostaway never reports this. The listing sync writes everything else about a
-- listing and deliberately leaves this column out of its update list (see
-- supabase/functions/_shared/listing.ts), so the manager's decision survives
-- the next sync — which is exactly why the column is worth widening rather
-- than replacing with something derived.
create type public.property_status as enum ('active', 'maintenance', 'archived');

comment on type public.property_status is
  'Состояние объекта: active — работает, уборки создаются; maintenance — ремонт, уборки не создаются, но объект остаётся в работе; archived — выведен из работы.';

alter table public.properties
  add column status public.property_status not null default 'active';

-- Everything switched off was switched off to take it out of the schedule, and
-- nothing recorded why. Archived is the honest reading of that: a manager who
-- meant "under repair" says so in one press, and nobody has to guess on her
-- behalf which of the two a row from last month was.
update public.properties
set status = (case when is_active then 'active' else 'archived' end)::public.property_status;

alter table public.properties drop column is_active;

comment on column public.properties.status is
  'Уборки генерируются только для active. Синхронизация листингов эту колонку не трогает.';

-- ---------------------------------------------------------------------------
--  The one place that read the boolean
-- ---------------------------------------------------------------------------
--
-- Recreated verbatim but for the last line of the gathering query: a listing
-- earns a cleaning only while it is `active`. Under maintenance the schedule
-- stops exactly as it did when the flag was off — the flat is not receiving
-- guests — and cleanings already on the books are cancelled by the same pass
-- that cancels a withdrawn booking, since the reservation stops matching.
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
