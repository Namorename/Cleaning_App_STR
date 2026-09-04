-- F6. The life of a task in the cleaner's hands: start, finish, and the clock.
--
-- Three things the cleaner does with a task — take, start, finish — and two of
-- them are clock events. The database stamps the clock itself: what the client
-- says about the time is ignored, because the measurement is what the hours
-- report and the pay conversation are built on, and a timestamp typed by the
-- phone is a claim, not a record.
--
-- Parallel work is the normal case. A cleaner on a floor starts one flat,
-- steps out, starts the next; three flats started at 10:00 and finished at
-- 13:00 are three hours each, and adding them up gives nine hours for three.
-- The measurements are not divided or invented — each is what it is — but
-- every task that overlapped another of the same person is marked, so F12 can
-- keep them apart from ordinary measurements. The host may switch parallel
-- starts off; by default they are on, because that is how this team works.
--
-- The original measurement is never rewritten — not by the cleaner, not by the
-- manager. A correction goes into its own column and the original stays next
-- to it (§13.3). A cleaning shorter than five minutes is flagged as
-- questionable: it usually means the documenting was done after the work.

-- ---------- the host setting ----------

alter table public.hosts
  add column parallel_start_allowed boolean not null default true;

comment on column public.hosts.parallel_start_allowed is
  'May one cleaner have several tasks in progress at once. On by default: floor-by-floor cleaning is how this team works.';

-- ---------- measurement columns ----------

/**
 * Below this, a measurement is more likely the paperwork than the work.
 *
 * A function rather than a literal in the generated column so the threshold
 * has exactly one home; immutable because a generated column requires it and
 * because it genuinely never changes at runtime.
 */
create or replace function public.short_cleaning_threshold()
returns interval
language sql
immutable
parallel safe
set search_path = ''
as $$ select interval '5 minutes' $$;

alter table public.tasks
  -- Another task of the same cleaner was in progress when this one started
  -- (or this one was in progress when another started). Set by the database,
  -- never by the client; F12 reads it to keep overlapping hours apart.
  add column is_parallel boolean not null default false,
  -- A manager's correction of the measured time. The measurement itself is
  -- untouched: started_at and completed_at are write-once.
  add column duration_override_min integer
    check (duration_override_min is null or duration_override_min >= 0),
  add column measured_minutes integer
    generated always as (
      (floor(extract(epoch from (completed_at - started_at)) / 60))::integer
    ) stored,
  add column is_short_measurement boolean
    generated always as (
      (completed_at - started_at) < public.short_cleaning_threshold()
    ) stored;

comment on column public.tasks.is_parallel is
  'Overlapped another task of the same cleaner. Its minutes are real but not comparable with a solo cleaning.';
comment on column public.tasks.duration_override_min is
  'Manual correction by a manager. The original measurement is kept in measured_minutes.';
comment on column public.tasks.measured_minutes is
  'completed_at minus started_at, as measured. Never edited; see duration_override_min.';
comment on column public.tasks.is_short_measurement is
  'Under five minutes — usually the paperwork, not the work. Flagged, not hidden.';

-- The parallel check looks up a cleaner's running tasks on every start.
create index tasks_running_by_assignee_idx on public.tasks (assignee_id)
  where status = 'in_progress';

-- ---------- what nobody rewrites ----------

/**
 * Guard the parts of a task that are not the executor's to change.
 *
 * Unchanged from 20260905092000 in what an executor may not touch, with two
 * additions. First, the clock stamps and the parallel flag are the database's
 * own — for an executor they always revert, and the transition guard below
 * sets them. Second, a measurement once written is written for everyone:
 * a manager who wants a different duration has duration_override_min.
 *
 * Nested writes made by the database's own triggers pass through untouched;
 * pg_trigger_depth() > 1 means one of them, not a client.
 */
create or replace function public.guard_task_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Серверный контекст (service_role, генератор задач) и вложенные записи
  -- собственных триггеров не ограничиваем.
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  -- The measurement is write-once for everyone.
  if old.started_at is not null then
    new.started_at := old.started_at;
  end if;
  if old.completed_at is not null then
    new.completed_at := old.completed_at;
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
    new.property_id           := old.property_id;
    new.reservation_id        := old.reservation_id;
    new.type                  := old.type;
    new.priority              := old.priority;
    new.scheduled_date        := old.scheduled_date;
    new.due_at                := old.due_at;
    new.time_from             := old.time_from;
    new.time_to               := old.time_to;
    new.guests_count          := old.guests_count;
    new.started_at            := old.started_at;
    new.completed_at          := old.completed_at;
    new.completed_by          := old.completed_by;
    new.is_parallel           := old.is_parallel;
    new.duration_override_min := old.duration_override_min;
  end if;

  return new;
end;
$$;

-- ---------- the moves and the clock ----------

/**
 * Apply a status change: check that the executor may make it, stamp the
 * clock, and mark parallel work.
 *
 * An executor has three moves — unassigned -> assigned (the claim, whose
 * other conditions live in its policy), assigned -> in_progress, and
 * in_progress -> done — and anything else is refused with an error the app
 * can show, rather than a silent revert that reads as a save that worked. A manager may set any
 * status; the stamps still come from the database.
 *
 * Fires after guard_task_fields (trigger names run alphabetically), which has
 * already thrown away whatever the client said about the time.
 */
create or replace function public.guard_task_transitions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_running integer;
  v_allowed boolean;
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not public.is_manager()
     and not (
       (old.status = 'unassigned'  and new.status = 'assigned') or
       (old.status = 'assigned'    and new.status = 'in_progress') or
       (old.status = 'in_progress' and new.status = 'done')
     ) then
    raise exception 'Переход % -> % исполнителю недоступен', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'in_progress' then
    new.started_at := coalesce(old.started_at, now());

    select count(*) into v_running
    from public.tasks t
    where t.assignee_id = new.assignee_id
      and t.status = 'in_progress'
      and t.id <> new.id;

    if v_running > 0 then
      select h.parallel_start_allowed into v_allowed
      from public.hosts h where h.id = new.host_id;

      if not coalesce(v_allowed, true) then
        raise exception 'Параллельный старт выключен: сначала завершите текущую уборку'
          using errcode = 'check_violation';
      end if;

      -- Both sides of the overlap are marked: the one starting now and every
      -- one still running. Overlap is symmetric, and the later start is the
      -- only moment at which it is certain to be visible.
      new.is_parallel := true;

      update public.tasks t
      set is_parallel = true
      where t.assignee_id = new.assignee_id
        and t.status = 'in_progress'
        and t.id <> new.id
        and not t.is_parallel;
    end if;
  end if;

  if new.status = 'done' then
    new.completed_at := coalesce(old.completed_at, now());
    new.completed_by := coalesce(new.completed_by, (select auth.uid()));
  end if;

  return new;
end;
$$;

create trigger tasks_guard_transitions
  before update of status on public.tasks
  for each row execute function public.guard_task_transitions();
