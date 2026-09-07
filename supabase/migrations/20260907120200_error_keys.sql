-- Errors the app can translate.
--
-- Every message a database function raised until now was Russian prose meant
-- to be shown as it was. That works for exactly one language, and the app
-- speaks three: a Czech cleaner was being handed Russian, and translating the
-- strings here would only have moved the problem to whoever speaks the third
-- language. The server has no idea who is reading — the language of a member
-- of staff lives in the app.
--
-- So from here on an error carries three things:
--
--   message  English, for logs and for whoever is reading them. Never shown.
--   hint     A stable i18n key, `serverErrors.<name>`. This is the contract.
--   detail   A JSON object of substitution parameters, or nothing.
--
-- The app looks the key up (`serverErrorText()`), translates it into the
-- reader's language and fills the parameters in. A key it does not know falls
-- back to a general sentence, with the English message in small print
-- underneath so it can be passed on to a manager.
--
-- Renaming a key is a breaking change: an app in the field still looks up the
-- old one. Add a new key instead, and keep the old one working until the
-- builds that use it are gone.
--
-- Nothing about the logic changes here — same checks, same order, same
-- errcodes. Only what the functions say, and the migrations they came from
-- (F1, F6, F15, F16) stay as they were: they are already applied.

-- ---------- property hierarchy ----------

create or replace function public.guard_property_link_cycles()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.property_links where child_id = new.parent_id) then
    raise exception 'Listing % is already a child and cannot be a parent', new.parent_id
      using errcode = 'check_violation',
            hint = 'serverErrors.propertyAlreadyChild',
            detail = jsonb_build_object('id', new.parent_id)::text;
  end if;
  if exists (select 1 from public.property_links where parent_id = new.child_id) then
    raise exception 'Listing % is already a parent and cannot be a child', new.child_id
      using errcode = 'check_violation',
            hint = 'serverErrors.propertyAlreadyParent',
            detail = jsonb_build_object('id', new.child_id)::text;
  end if;
  return new;
end;
$$;

create or replace function public.guard_property_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_id is null then
    return new;
  end if;

  if exists (select 1 from public.properties p
             where p.id = new.parent_id and p.parent_id is not null) then
    raise exception 'Listing % is a unit itself and cannot be a parent', new.parent_id
      using errcode = 'check_violation',
            hint = 'serverErrors.propertyIsUnit',
            detail = jsonb_build_object('id', new.parent_id)::text;
  end if;

  if exists (select 1 from public.properties p where p.parent_id = new.id) then
    raise exception 'Listing % has units of its own and cannot be a unit', new.id
      using errcode = 'check_violation',
            hint = 'serverErrors.propertyHasUnits',
            detail = jsonb_build_object('id', new.id)::text;
  end if;

  return new;
end;
$$;

-- ---------- the task ----------

/**
 * Keep the columns an executor may not touch, and the clock the server owns.
 *
 * Unchanged from F6 apart from what it says when it refuses.
 */
create or replace function public.guard_task_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The server context (service_role, the task generator) and nested writes
  -- from our own triggers are left alone.
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
  end if;

  return new;
end;
$$;

/**
 * Apply a status change: check the move, stamp the clock, mark parallel work,
 * and hold the finish while required steps are open.
 *
 * Unchanged from F16 apart from what it says. The count of open steps moves
 * from the sentence into `detail`, so the app can put the number where its
 * own grammar wants it.
 */
create or replace function public.guard_task_transitions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_running   integer;
  v_allowed   boolean;
  v_remaining integer;
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
    raise exception 'Move % -> % is not available to an executor', old.status, new.status
      using errcode = 'check_violation',
            hint = 'serverErrors.transitionNotAllowed',
            detail = jsonb_build_object('from', old.status, 'to', new.status)::text;
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
        raise exception 'Parallel start is off: finish the running cleaning first'
          using errcode = 'check_violation',
                hint = 'serverErrors.parallelStartOff';
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
    -- The gate. Required steps neither completed nor waived hold the finish;
    -- the count travels in `detail` because it is the one number the cleaner
    -- needs. Managers pass: releasing a task by hand is their call.
    if not public.is_manager() then
      select count(*) into v_remaining
      from public.task_steps s
      where s.task_id = new.id
        and s.required
        and s.completed_at is null
        and s.waived_at is null;

      if v_remaining > 0 then
        raise exception 'Required steps are still open: %', v_remaining
          using errcode = 'check_violation',
                hint = 'serverErrors.requiredStepsLeft',
                detail = jsonb_build_object('count', v_remaining)::text;
      end if;
    end if;

    new.completed_at := coalesce(old.completed_at, now());
    new.completed_by := coalesce(new.completed_by, (select auth.uid()));
  end if;

  return new;
end;
$$;

-- ---------- steps of a task ----------

/**
 * Lock a step for a write and check that the caller may touch it.
 *
 * Unchanged from F16 apart from what it says. One message for every refusal,
 * on purpose — telling a cleaner that a step exists but belongs to a
 * colleague is information she has no use for.
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
    raise exception 'Step not found, or its task is not in progress'
      using errcode = 'check_violation', hint = 'serverErrors.stepNotFound';
  end if;

  select t.* into v_task from public.tasks t where t.id = v_step.task_id;

  if p_require_assignee
     and (v_task.assignee_id is distinct from (select auth.uid())
          or v_task.status <> 'in_progress') then
    raise exception 'Step not found, or its task is not in progress'
      using errcode = 'check_violation', hint = 'serverErrors.stepNotFound';
  end if;

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
    raise exception 'A required step cannot be skipped'
      using errcode = 'check_violation', hint = 'serverErrors.requiredStepNotSkippable';
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
 * Unchanged from F16 apart from what it says.
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
    raise exception 'Only a manager may waive a required step'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  v_step := public.task_step_for_update(p_step_id, false);

  if not v_step.required then
    raise exception 'Only a required step can be waived'
      using errcode = 'check_violation', hint = 'serverErrors.waiveOptionalStep';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'A reason is required'
      using errcode = 'check_violation', hint = 'serverErrors.reasonRequired';
  end if;

  select t.status into v_status from public.tasks t where t.id = v_step.task_id;
  if v_status in ('done', 'cancelled', 'expired') then
    raise exception 'Task is %', v_status
      using errcode = 'check_violation',
            hint = 'serverErrors.taskClosed',
            detail = jsonb_build_object('status', v_status)::text;
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

-- ---------- saving a process ----------

/**
 * Save a whole template — header and steps — in one call.
 *
 * Unchanged from F16 apart from what it says.
 */
create or replace function public.save_workflow_template(p_template jsonb)
returns public.workflow_templates
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host     uuid := public.current_host_id();
  v_row      public.workflow_templates;
  v_id       uuid;
  v_scope    public.workflow_scope;
  v_property bigint;
  v_step     jsonb;
  v_step_id  uuid;
  v_position integer := 0;
  v_kept     uuid[] := '{}';
begin
  if not public.is_manager() then
    raise exception 'Only a manager may save a process'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  if jsonb_typeof(p_template) <> 'object' or jsonb_typeof(p_template->'steps') <> 'array' then
    raise exception 'A template must be an object with a list of steps'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.templateShapeInvalid';
  end if;

  v_id       := (p_template->>'id')::uuid;
  v_scope    := (p_template->>'scope')::public.workflow_scope;
  v_property := (p_template->>'property_id')::bigint;

  if v_id is null then
    select t.id into v_id
    from public.workflow_templates t
    where t.host_id = v_host
      and t.scope = v_scope
      and t.property_id is not distinct from v_property;
  end if;

  if v_id is null then
    insert into public.workflow_templates (host_id, scope, property_id, name, is_active)
    values (v_host, v_scope, v_property,
            coalesce(p_template->>'name', ''),
            coalesce((p_template->>'is_active')::boolean, true))
    returning * into v_row;
  else
    update public.workflow_templates t
    set name      = coalesce(p_template->>'name', t.name),
        is_active = coalesce((p_template->>'is_active')::boolean, t.is_active),
        version   = t.version + 1
    where t.id = v_id and t.host_id = v_host
    returning * into v_row;

    if not found then
      raise exception 'Template not found'
        using errcode = 'check_violation', hint = 'serverErrors.templateNotFound';
    end if;
  end if;

  for v_step in select value from jsonb_array_elements(p_template->'steps') loop
    v_position := v_position + 1;
    v_step_id  := (v_step->>'id')::uuid;

    if v_step_id is not null
       and exists (select 1 from public.workflow_steps s
                   where s.id = v_step_id and s.template_id = v_row.id) then
      update public.workflow_steps s
      set sort_order    = v_position,
          type          = (v_step->>'type')::public.workflow_step_type,
          required      = coalesce((v_step->>'required')::boolean, false),
          title         = v_step->>'title',
          instructions  = v_step->>'instructions',
          min_photos    = (v_step->>'min_photos')::smallint,
          max_photos    = (v_step->>'max_photos')::smallint,
          max_video_sec = (v_step->>'max_video_sec')::integer,
          config        = case when jsonb_typeof(v_step->'config') = 'object'
                               then v_step->'config' else '{}'::jsonb end
      where s.id = v_step_id;
    else
      insert into public.workflow_steps (
        template_id, host_id, sort_order, type, required, title, instructions,
        min_photos, max_photos, max_video_sec, config
      )
      values (
        v_row.id, v_host, v_position,
        (v_step->>'type')::public.workflow_step_type,
        coalesce((v_step->>'required')::boolean, false),
        v_step->>'title',
        v_step->>'instructions',
        (v_step->>'min_photos')::smallint,
        (v_step->>'max_photos')::smallint,
        (v_step->>'max_video_sec')::integer,
        case when jsonb_typeof(v_step->'config') = 'object'
             then v_step->'config' else '{}'::jsonb end
      )
      returning id into v_step_id;
    end if;

    v_kept := v_kept || v_step_id;
  end loop;

  delete from public.workflow_steps s
  where s.template_id = v_row.id and not (s.id = any (v_kept));

  return v_row;
end;
$$;
