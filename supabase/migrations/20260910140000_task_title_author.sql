-- A task a manager writes by hand: what it is called, and who called for it.
--
-- Until now every task was born from a booking: the generator made a cleaning
-- out of a reservation, and the only other author was assign_problem, which
-- turns a report from the field into a maintenance job. A manager could not
-- simply say "deep clean flat 3 on Friday" — there was no column for what such
-- a task is, and no record of who asked for it.
--
-- Two columns close that:
--
--   title / title_i18n  what the manager called it (20260907110000), so a
--                       Czech cleaner reads a Russian title in Czech when the
--                       translation is there, and in Russian when it is not.
--                       An automatic cleaning has no title: the app names it
--                       by its type, as it always did.
--   created_by          who asked. Null means the server did — the generator
--                       from a booking, or the nightly reconciliation. It is
--                       the difference between "the booking says so" and "the
--                       manager decided", and F12 will want it.
--
-- And one check: writing the same kind of job onto the same flat on the same
-- day is refused, and says so. Almost always it is a manager who forgot the
-- job is already on the board, and the cleaner would arrive to find the work
-- done. Almost — a busy flat really can want two cleanings in a day, so the
-- refusal can be confirmed past (p_allow_duplicate) rather than being a wall.
-- Bookings are exempt (a flat can turn over twice in a day), and so are
-- problem fixes: two leaks are two jobs, however alike they look.
--
-- It is a check and not a unique index on purpose. An index would be a rule
-- about the shape of the data, and the data has no such shape: it would also
-- refuse the second cleaning above, refuse it from the generator, and refuse
-- it in a migration years from now with nothing to explain why.

create or replace function public.task_title_max_length()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 120 $$;

revoke all on function public.task_title_max_length() from public, anon;
grant execute on function public.task_title_max_length() to authenticated, service_role;

-- ---------- the columns ----------

alter table public.tasks
  add column title      text,
  add column title_i18n jsonb not null default '{}'::jsonb,
  add column created_by uuid references public.profiles(id) on delete set null,
  add constraint tasks_title_length
    check (title is null or length(btrim(title)) between 1 and 120),
  add constraint tasks_title_i18n_object
    check (jsonb_typeof(title_i18n) = 'object');

comment on column public.tasks.title is
  'What the manager called this job, in the company language. Null for a task the server generated: the app names those by type.';
comment on column public.tasks.title_i18n is
  'The title in other languages, as language code to text. The plain column is the fallback.';
comment on column public.tasks.created_by is
  'The manager who asked for this task. Null when the server made it — from a booking, or from the nightly reconciliation.';

-- Nobody has to remember to fill it in. The generator runs without a session,
-- so auth.uid() is null there and the column stays null, which is what it means.
create or replace function public.stamp_task_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.created_by := coalesce(new.created_by, (select auth.uid()));
  return new;
end;
$$;

create trigger tasks_stamp_author
  before insert on public.tasks
  for each row execute function public.stamp_task_author();

-- The day of a flat, read often enough to be worth an index of its own: the
-- duplicate check below asks for it on every save, and so does the panel.
create index tasks_property_day_idx
  on public.tasks (host_id, property_id, scheduled_date)
  where status not in ('cancelled', 'expired');

-- ---------- the executor still does not rewrite the brief ----------

/**
 * Keep the columns an executor may not touch, and the clock the server owns.
 *
 * Unchanged from 20260907120200 apart from the columns added above: the title
 * is the manager's word for the job and the author is a matter of record, so
 * neither belongs to the person carrying it out.
 */
create or replace function public.guard_task_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if old.started_at is not null then
    new.started_at := old.started_at;
  end if;
  if old.completed_at is not null then
    new.completed_at := old.completed_at;
  end if;

  -- Who asked for the job is a record, not a field: nobody rewrites it.
  new.created_by := old.created_by;

  if not public.is_manager() then
    if old.status in ('done', 'cancelled', 'expired') then
      raise exception 'Task is % and cannot be changed by its executor', old.status
        using errcode = 'check_violation',
              hint = 'serverErrors.taskClosed',
              detail = jsonb_build_object('status', old.status)::text;
    end if;

    -- assignee_id is deliberately NOT reverted here: a change of owner is
    -- caught by the policy's WITH CHECK, which says so. A silent revert here
    -- would intercept it before the check, and the client would read the
    -- handover as a save that worked.
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
    new.title                 := old.title;
    new.title_i18n            := old.title_i18n;
  end if;

  return new;
end;
$$;

-- ---------- the manager writes one ----------

/**
 * Create a task by hand, or rewrite one. Replayable by id.
 *
 * The id is minted by the panel, so a save sent twice over a bad connection
 * writes the same row rather than two jobs for the same morning.
 *
 * What it will not do: change the flat or the kind of an automatic task. A
 * cleaning belongs to its booking and a fix to its report; moving either
 * somewhere else would leave the thing it came from pointing at a job that is
 * no longer about it. Date, time, executor, note and priority stay editable
 * on any task — that is the manager's day to day.
 *
 * p_allow_duplicate is the answer to the refusal below: the panel asks first
 * and sends it only when the manager said yes, meaning "I know, put it there
 * anyway".
 */
create or replace function public.save_task(
  p_id              uuid,
  p_property_id     bigint,
  p_type            public.task_type,
  p_scheduled_date  date,
  p_title           text default null,
  p_title_i18n      jsonb default '{}'::jsonb,
  p_assignee_id     uuid default null,
  p_time_from       time default null,
  p_time_to         time default null,
  p_notes           text default null,
  p_priority        integer default null,
  p_allow_duplicate boolean default false
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host     uuid := public.current_host_id();
  v_task     public.tasks;
  v_title    text := nullif(btrim(coalesce(p_title, '')), '');
  v_property bigint := p_property_id;
  v_type     public.task_type := p_type;
  v_status   public.task_status;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select t.* into v_task
  from public.tasks t
  where t.id = p_id and t.host_id = v_host
  for update;

  if found then
    if v_task.status in ('done', 'cancelled', 'expired') then
      raise exception 'Task is % and can no longer be edited', v_task.status
        using errcode = 'check_violation',
              hint = 'serverErrors.taskClosed',
              detail = jsonb_build_object('status', v_task.status)::text;
    end if;
    -- A generated task keeps the flat and the kind it was generated with.
    if v_task.reservation_id is not null or v_task.problem_id is not null then
      v_property := v_task.property_id;
      v_type     := v_task.type;
    end if;
  end if;

  if v_title is null then
    raise exception 'A task needs a title'
      using errcode = 'check_violation', hint = 'serverErrors.taskTitleRequired';
  end if;
  if length(v_title) > public.task_title_max_length() then
    raise exception 'The title is longer than % characters', public.task_title_max_length()
      using errcode = 'check_violation',
            hint = 'serverErrors.taskTitleTooLong',
            detail = jsonb_build_object('limit', public.task_title_max_length())::text;
  end if;
  if p_title_i18n is not null and not public.is_localized_text(p_title_i18n) then
    raise exception 'Translations must be an object of language code to text'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.translationsInvalid';
  end if;
  if v_property is null
     or not exists (select 1 from public.properties pr
                    where pr.id = v_property and pr.host_id = v_host) then
    raise exception 'Listing % is not in this company', v_property
      using errcode = 'check_violation', hint = 'serverErrors.propertyNotFound';
  end if;
  if p_scheduled_date is null then
    raise exception 'A task needs a day'
      using errcode = 'check_violation', hint = 'serverErrors.taskDateRequired';
  end if;
  if p_assignee_id is not null
     and not exists (select 1 from public.profiles pr
                     where pr.id = p_assignee_id and pr.host_id = v_host and pr.is_active) then
    raise exception 'Assignee is not an active member of this company'
      using errcode = 'check_violation', hint = 'serverErrors.taskAssigneeInvalid';
  end if;

  -- The same kind of job, on the same flat, on the same day. A job from a
  -- booking or from a report is not one of these — it was not written by
  -- hand — and a cancelled or expired one is out of the way by definition.
  if not coalesce(p_allow_duplicate, false)
     and exists (select 1 from public.tasks t
                 where t.host_id = v_host
                   and t.property_id = v_property
                   and t.type = v_type
                   and t.scheduled_date = p_scheduled_date
                   and t.reservation_id is null
                   and t.problem_id is null
                   and t.status not in ('cancelled', 'expired')
                   and t.id <> p_id) then
    raise exception 'A % task for listing % on % already exists',
      v_type, v_property, p_scheduled_date
      using errcode = 'check_violation',
            hint = 'serverErrors.taskDuplicate',
            detail = jsonb_build_object('type', v_type, 'date', p_scheduled_date)::text;
  end if;

  -- Handing the job out moves it out of the queue; taking the executor away
  -- puts it back, but only while nobody has started. A task already in
  -- progress keeps its status: the work happened, whatever the roster says.
  v_status := case
    when v_task.id is null then
      case when p_assignee_id is null then 'unassigned'::public.task_status
           else 'assigned'::public.task_status end
    when p_assignee_id is null and v_task.status in ('unassigned', 'assigned', 'accepted')
      then 'unassigned'::public.task_status
    when p_assignee_id is not null and v_task.status = 'unassigned'
      then 'assigned'::public.task_status
    else v_task.status
  end;

  if v_task.id is null then
    insert into public.tasks (
      id, host_id, property_id, type, status, priority, assignee_id,
      scheduled_date, time_from, time_to, notes, title, title_i18n
    ) values (
      p_id, v_host, v_property, v_type, v_status, coalesce(p_priority, 0), p_assignee_id,
      p_scheduled_date, p_time_from, p_time_to, nullif(btrim(coalesce(p_notes, '')), ''),
      v_title, coalesce(p_title_i18n, '{}'::jsonb)
    )
    returning * into v_task;
  else
    update public.tasks t
    set property_id    = v_property,
        type           = v_type,
        status         = v_status,
        priority       = coalesce(p_priority, t.priority),
        assignee_id    = p_assignee_id,
        scheduled_date = p_scheduled_date,
        time_from      = p_time_from,
        time_to        = p_time_to,
        notes          = nullif(btrim(coalesce(p_notes, '')), ''),
        title          = v_title,
        title_i18n     = coalesce(p_title_i18n, '{}'::jsonb)
    where t.id = p_id
    returning * into v_task;
  end if;

  return v_task;
end;
$$;

revoke all on function public.save_task(
  uuid, bigint, public.task_type, date, text, jsonb, uuid, time, time, text, integer, boolean
) from public, anon;
grant execute on function public.save_task(
  uuid, bigint, public.task_type, date, text, jsonb, uuid, time, time, text, integer, boolean
) to authenticated, service_role;
