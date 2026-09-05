-- F16. A task's own copy of its process, and the cleaner's progress through it.
--
-- When a task goes into progress its steps are copied here from the template
-- that applies. From that moment the task carries its own list: the template
-- may be edited, reordered or deleted, and what this cleaning asked for stays
-- exactly as it was asked. A manager looking at a finished task sees what was
-- required then, not what is required now.
--
-- Progress is written only through the functions at the bottom, never by an
-- update on the table. Three reasons. The phone replays an action queued
-- without signal, and replaying "complete" on a step already completed must
-- return the row, not "0 rows updated" — an update with `where completed_at
-- is null` would do exactly that. Each step type has a shape its answer has
-- to fit, and one validator is easier to keep honest than a policy. And the
-- clock is stamped here, as everywhere else in this schema: what the phone
-- says about the time is recorded separately as what the phone said.

create table public.task_steps (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references public.tasks(id) on delete cascade,
  host_id             uuid not null default public.default_host_id()
                        references public.hosts(id) on delete restrict,
  -- Which template step this was copied from; null once that step is deleted.
  -- Statistics group on it (F12).
  template_step_id    uuid references public.workflow_steps(id) on delete set null,
  sort_order          smallint not null,
  type                public.workflow_step_type not null,
  required            boolean not null,
  title               text,
  instructions        text,
  min_photos          smallint,
  max_photos          smallint,
  max_video_sec       integer,
  config              jsonb not null default '{}'::jsonb,
  -- First time the cleaner opened the step.
  started_at          timestamptz,
  -- Stamped by the server when the step is completed.
  completed_at        timestamptz,
  -- What the phone's clock said, for steps completed without signal and sent
  -- later. Informational; completed_at is the record.
  device_completed_at timestamptz,
  completed_by        uuid references public.profiles(id) on delete set null,
  -- The answer, shaped per type: task_note {checked_lines:[…]},
  -- cleaner_comment {text}, confirmation {}. Media never live here (F8 has
  -- its own table), so retention can clear them independently.
  payload             jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  -- An optional step the cleaner chose not to do.
  skipped_at          timestamptz,
  skip_reason         text,
  -- A required step a manager released the task from, with the reason.
  waived_at           timestamptz,
  waived_by           uuid references public.profiles(id) on delete set null,
  waive_reason        text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (task_id, sort_order),
  -- One outcome per step.
  check (completed_at is null or skipped_at is null),
  -- Skipping is for optional steps; a required one is completed or waived.
  check (not required or skipped_at is null),
  check (waived_at is null or (required and btrim(coalesce(waive_reason, '')) <> ''))
);

comment on table public.task_steps is
  'The steps of one task, copied from its template when it started, with the cleaner''s progress. Written only through the task step functions.';
comment on column public.task_steps.device_completed_at is
  'The phone''s clock at completion, for actions queued offline. Informational; completed_at is the record.';
comment on column public.task_steps.waived_at is
  'A manager released the task from this required step; waive_reason says why.';

create index task_steps_host_task_idx on public.task_steps (host_id, task_id, sort_order);
-- What the finish gate asks on every finish: is anything required still open?
create index task_steps_gate_idx on public.task_steps (task_id)
  where required and completed_at is null and waived_at is null;

create trigger task_steps_touch
  before update on public.task_steps
  for each row execute function public.touch_updated_at();

-- ---------- access ----------

grant select on public.task_steps to authenticated;
grant select, insert, update, delete on public.task_steps to service_role;
revoke all on public.task_steps from anon;

alter table public.task_steps enable row level security;

create policy "assignee reads own task steps"
  on public.task_steps for select
  to authenticated
  using (host_id = public.current_host_id()
         and public.is_active_user()
         and exists (select 1 from public.tasks t
                     where t.id = task_id and t.assignee_id = (select auth.uid())));

create policy "managers read all task steps"
  on public.task_steps for select
  to authenticated
  using (public.is_manager() and host_id = public.current_host_id());

-- ---------- the snapshot ----------

/**
 * Copy the applicable template into the task the moment it goes into progress.
 *
 * AFTER trigger, and deliberately not part of guard_task_transitions: the
 * guard steps aside for the server context and for nested writes, while the
 * snapshot is owed on every entry into 'in_progress' — by the cleaner, by a
 * manager in Studio, by a script. Idempotent: a task that already has steps
 * (paused and resumed, say) keeps them.
 *
 * The task's note becomes the text of the task_note step, and a task with no
 * note gets no such step: an empty step is not a step. Copying the text here
 * means the manager editing the note mid-cleaning does not shift the line
 * numbers the cleaner has already ticked.
 */
create or replace function public.snapshot_task_steps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template uuid;
begin
  if new.status <> 'in_progress' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = new.status then
    return null;
  end if;
  if exists (select 1 from public.task_steps s where s.task_id = new.id) then
    return null;
  end if;

  v_template := public.resolve_workflow_template(
    new.property_id, public.workflow_scope_for(new.type));
  if v_template is null then
    return null;
  end if;

  insert into public.task_steps (
    task_id, host_id, template_step_id, sort_order, type, required, title,
    instructions, min_photos, max_photos, max_video_sec, config
  )
  select
    new.id, new.host_id, s.id, s.sort_order, s.type, s.required, s.title,
    case when s.type = 'task_note' then new.notes else s.instructions end,
    s.min_photos, s.max_photos, s.max_video_sec, s.config
  from public.workflow_steps s
  where s.template_id = v_template
    and not (s.type = 'task_note' and nullif(btrim(coalesce(new.notes, '')), '') is null)
  order by s.sort_order;

  return null;
end;
$$;

create trigger tasks_snapshot_workflow
  after insert or update of status on public.tasks
  for each row execute function public.snapshot_task_steps();

-- ---------- what the answer to a step has to look like ----------

/**
 * How many lines of a note the cleaner has to tick.
 *
 * Lines are split on CR/LF and blank ones do not count. The app splits the
 * same way (features/steps/schema.ts); the two are kept in step by a shared
 * fixture in both test suites.
 */
create or replace function public.task_note_line_count(p_text text)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select count(*)::integer
  from unnest(regexp_split_to_array(coalesce(p_text, ''), E'\\r?\\n')) as line
  where btrim(line) <> ''
$$;

/**
 * Check an answer against its step type and return it normalised.
 *
 * Raises check_violation with a message the app can show. The default branch
 * is the one that matters most: a type this build does not know is refused,
 * so a template may name future steps without a task ever being "completed"
 * on a step nobody could do.
 */
create or replace function public.validate_task_step_payload(
  p_type         public.workflow_step_type,
  p_instructions text,
  p_payload      jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text    text;
  v_lines   integer;
  v_checked integer[];
  v_wanted  integer[];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Данные шага должны быть объектом' using errcode = 'check_violation';
  end if;

  case p_type
    when 'confirmation' then
      return '{}'::jsonb;

    when 'cleaner_comment' then
      v_text := btrim(coalesce(p_payload->>'text', ''));
      if v_text = '' then
        raise exception 'Комментарий пуст' using errcode = 'check_violation';
      end if;
      if length(v_text) > 4000 then
        raise exception 'Комментарий длиннее 4000 символов' using errcode = 'check_violation';
      end if;
      return jsonb_build_object('text', v_text);

    when 'task_note' then
      v_lines := public.task_note_line_count(p_instructions);
      if jsonb_typeof(p_payload->'checked_lines') <> 'array' then
        raise exception 'Отмечены не все строки заметки' using errcode = 'check_violation';
      end if;
      select array_agg(distinct (line.value)::integer order by (line.value)::integer)
        into v_checked
      from jsonb_array_elements_text(p_payload->'checked_lines') as line;
      select array_agg(i) into v_wanted from generate_series(0, v_lines - 1) as i;
      if v_checked is distinct from v_wanted then
        raise exception 'Отмечены не все строки заметки' using errcode = 'check_violation';
      end if;
      return jsonb_build_object('checked_lines', to_jsonb(coalesce(v_checked, '{}'::integer[])));

    else
      raise exception 'Шаг этого типа пока не поддерживается приложением'
        using errcode = 'check_violation';
  end case;
end;
$$;

-- Pure helpers; the step functions below call them as their owner, so no
-- client needs execute on them.
revoke all on function public.task_note_line_count(text) from public, anon, authenticated;
revoke all on function public.validate_task_step_payload(public.workflow_step_type, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.task_note_line_count(text) to service_role;
grant execute on function public.validate_task_step_payload(public.workflow_step_type, text, jsonb)
  to service_role;

-- ---------- the step functions ----------

/**
 * Lock a step for a write and check that the caller may touch it.
 *
 * Always the caller's company. With p_require_assignee, also the caller's own
 * task and only while it is in progress: a step of a finished task is history.
 * One message for every refusal, on purpose — telling a cleaner that a step
 * exists but belongs to a colleague is information she has no use for.
 */
create or replace function public.task_step_for_update(
  p_step_id          uuid,
  p_require_assignee boolean
)
returns public.task_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.task_steps;
  v_task public.tasks;
begin
  select s.* into v_step
  from public.task_steps s
  where s.id = p_step_id and s.host_id = public.current_host_id()
  for update;

  if not found then
    raise exception 'Шаг не найден или задача не в работе' using errcode = 'check_violation';
  end if;

  select t.* into v_task from public.tasks t where t.id = v_step.task_id;

  if p_require_assignee
     and (v_task.assignee_id is distinct from (select auth.uid())
          or v_task.status <> 'in_progress') then
    raise exception 'Шаг не найден или задача не в работе' using errcode = 'check_violation';
  end if;

  return v_step;
end;
$$;

revoke all on function public.task_step_for_update(uuid, boolean) from public, anon, authenticated;
grant execute on function public.task_step_for_update(uuid, boolean) to service_role;

/** The cleaner opened the step. Stamps the first opening only. */
create or replace function public.open_task_step(p_step_id uuid)
returns public.task_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.task_steps;
begin
  v_step := public.task_step_for_update(p_step_id, true);

  update public.task_steps s
  set started_at = coalesce(s.started_at, now())
  where s.id = p_step_id
  returning s.* into v_step;

  return v_step;
end;
$$;

/**
 * Complete a step with its answer.
 *
 * Idempotent: a step already completed is returned as it is, first stamps
 * kept — this is what makes a replay from the offline queue harmless. The
 * answer is validated for the step's type; the server stamps the time and
 * records what the phone said the time was.
 */
create or replace function public.complete_task_step(
  p_step_id             uuid,
  p_payload             jsonb default '{}'::jsonb,
  p_device_completed_at timestamptz default null
)
returns public.task_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step    public.task_steps;
  v_payload jsonb;
begin
  v_step := public.task_step_for_update(p_step_id, true);

  if v_step.completed_at is not null then
    return v_step;
  end if;

  if not (v_step.type = any (public.workflow_supported_step_types())) then
    raise exception 'Шаг этого типа пока не поддерживается приложением'
      using errcode = 'check_violation';
  end if;

  v_payload := public.validate_task_step_payload(
    v_step.type, v_step.instructions, coalesce(p_payload, '{}'::jsonb));

  update public.task_steps s
  set started_at          = coalesce(s.started_at, now()),
      completed_at        = now(),
      completed_by        = (select auth.uid()),
      device_completed_at = p_device_completed_at,
      payload             = v_payload,
      skipped_at          = null,
      skip_reason         = null
  where s.id = p_step_id
  returning s.* into v_step;

  return v_step;
end;
$$;

/**
 * Take a step back to "not done" — a mis-tap, or something to redo.
 *
 * Only while the task is in progress. The answer is kept as a draft so the
 * cleaner does not retype a comment; the stamps are cleared.
 */
create or replace function public.reopen_task_step(p_step_id uuid)
returns public.task_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.task_steps;
begin
  v_step := public.task_step_for_update(p_step_id, true);

  update public.task_steps s
  set completed_at        = null,
      completed_by        = null,
      device_completed_at = null,
      skipped_at          = null,
      skip_reason         = null
  where s.id = p_step_id
  returning s.* into v_step;

  return v_step;
end;
$$;

/** Skip an optional step. A required one cannot be skipped, only waived. */
create or replace function public.skip_task_step(
  p_step_id uuid,
  p_reason  text default null
)
returns public.task_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.task_steps;
begin
  v_step := public.task_step_for_update(p_step_id, true);

  if v_step.required then
    raise exception 'Обязательный шаг нельзя пропустить' using errcode = 'check_violation';
  end if;
  if v_step.skipped_at is not null then
    return v_step;
  end if;

  update public.task_steps s
  set skipped_at   = now(),
      skip_reason  = nullif(btrim(coalesce(p_reason, '')), ''),
      completed_at = null,
      completed_by = null
  where s.id = p_step_id
  returning s.* into v_step;

  return v_step;
end;
$$;

/**
 * Release a task from one of its required steps.
 *
 * Managers only, with a reason: the reason is what a later reader of the
 * task sees instead of the step's answer. The task must still be open — a
 * finished task has nothing to release.
 */
create or replace function public.waive_task_step(
  p_step_id uuid,
  p_reason  text
)
returns public.task_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step   public.task_steps;
  v_status public.task_status;
begin
  if not public.is_manager() then
    raise exception 'Снять обязательность шага может только менеджер'
      using errcode = 'insufficient_privilege';
  end if;

  v_step := public.task_step_for_update(p_step_id, false);

  if not v_step.required then
    raise exception 'Снять обязательность можно только с обязательного шага'
      using errcode = 'check_violation';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Укажите причину' using errcode = 'check_violation';
  end if;

  select t.status into v_status from public.tasks t where t.id = v_step.task_id;
  if v_status in ('done', 'cancelled', 'expired') then
    raise exception 'Задача закрыта со статусом %', v_status using errcode = 'check_violation';
  end if;

  if v_step.waived_at is not null then
    return v_step;
  end if;

  update public.task_steps s
  set waived_at    = now(),
      waived_by    = (select auth.uid()),
      waive_reason = btrim(p_reason)
  where s.id = p_step_id
  returning s.* into v_step;

  return v_step;
end;
$$;

revoke all on function public.open_task_step(uuid) from public, anon;
revoke all on function public.complete_task_step(uuid, jsonb, timestamptz) from public, anon;
revoke all on function public.reopen_task_step(uuid) from public, anon;
revoke all on function public.skip_task_step(uuid, text) from public, anon;
revoke all on function public.waive_task_step(uuid, text) from public, anon;
grant execute on function public.open_task_step(uuid) to authenticated, service_role;
grant execute on function public.complete_task_step(uuid, jsonb, timestamptz) to authenticated, service_role;
grant execute on function public.reopen_task_step(uuid) to authenticated, service_role;
grant execute on function public.skip_task_step(uuid, text) to authenticated, service_role;
grant execute on function public.waive_task_step(uuid, text) to authenticated, service_role;
