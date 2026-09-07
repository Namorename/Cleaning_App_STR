-- F7. The checklist becomes a step of the process.
--
-- Everything the step needs already exists: the catalogue has had 'checklist'
-- in it since F16, the snapshot mechanism copies a template step into a task,
-- and the finish gate holds on required steps. Three things change here.
--
-- One: 'checklist' joins the list of types the app can complete, so a manager
-- may mark such a step required without stranding the task.
--
-- Two: the snapshot copies the listing's checklist into the step's config.
-- The task then carries the modules and items as they were at the moment it
-- started — a checklist rewritten during the cleaning does not shuffle what
-- the cleaner is ticking, and a task finished in March still shows what March
-- asked for. A listing with no checklist gets no such step at all: an empty
-- step is not a step, the same rule the note follows.
--
-- Three: the answer is validated against that snapshot. The cleaner sends the
-- ids she ticked; every item that is not optional has to be among them. Ids
-- that are not in the snapshot are dropped rather than refused — an item
-- deleted from the checklist while the phone was offline is not the cleaner's
-- mistake, and the queue must not jam on it.
--
-- Validating an answer against the step's config needs the config, which the
-- validator did not take before. Its signature grows by one argument, so it
-- is created anew and the old one dropped once complete_task_step() has been
-- pointed at the new one.

-- ---------- the app can now complete a checklist ----------

create or replace function public.workflow_supported_step_types()
returns public.workflow_step_type[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array['task_note', 'cleaner_comment', 'confirmation', 'checklist']::public.workflow_step_type[]
$$;

-- ---------- what the answer to a step has to look like ----------

/**
 * Check an answer against its step type and return it normalised.
 *
 * As before, plus the step's config: a checklist answer means nothing without
 * the checklist it answers. Raises check_violation with a message the app can
 * show. The default branch still refuses a type this build does not know.
 */
create or replace function public.validate_task_step_payload(
  p_type         public.workflow_step_type,
  p_instructions text,
  p_config       jsonb,
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
  v_known   text[];
  v_needed  text[];
  v_ticked  text[];
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Step payload must be an object'
      using errcode = 'check_violation', hint = 'serverErrors.stepPayloadInvalid';
  end if;

  case p_type
    when 'confirmation' then
      return '{}'::jsonb;

    when 'cleaner_comment' then
      v_text := btrim(coalesce(p_payload->>'text', ''));
      if v_text = '' then
        raise exception 'The comment is empty'
          using errcode = 'check_violation', hint = 'serverErrors.commentEmpty';
      end if;
      if length(v_text) > 4000 then
        raise exception 'The comment is longer than 4000 characters'
          using errcode = 'check_violation',
                hint = 'serverErrors.commentTooLong',
                detail = jsonb_build_object('limit', 4000)::text;
      end if;
      return jsonb_build_object('text', v_text);

    when 'task_note' then
      v_lines := public.task_note_line_count(p_instructions);
      if jsonb_typeof(p_payload->'checked_lines') <> 'array' then
        raise exception 'Not every line of the note is ticked'
          using errcode = 'check_violation', hint = 'serverErrors.noteLinesLeft';
      end if;
      select array_agg(distinct (line.value)::integer order by (line.value)::integer)
        into v_checked
      from jsonb_array_elements_text(p_payload->'checked_lines') as line;
      select array_agg(i) into v_wanted from generate_series(0, v_lines - 1) as i;
      if v_checked is distinct from v_wanted then
        raise exception 'Not every line of the note is ticked'
          using errcode = 'check_violation', hint = 'serverErrors.noteLinesLeft';
      end if;
      return jsonb_build_object('checked_lines', to_jsonb(coalesce(v_checked, '{}'::integer[])));

    when 'checklist' then
      if jsonb_typeof(p_payload->'checked_item_ids') <> 'array' then
        raise exception 'Not every required item is ticked'
          using errcode = 'check_violation', hint = 'serverErrors.checklistItemsLeft';
      end if;

      -- Ids stay text on both sides: they come out of the same snapshot the
      -- app read, and a cast here would turn a malformed id into a database
      -- error instead of a dropped one.
      select array_agg(item.value->>'id'),
             array_agg(item.value->>'id')
               filter (where not coalesce((item.value->>'is_optional')::boolean, false))
        into v_known, v_needed
      from jsonb_array_elements(coalesce(p_config->'modules', '[]'::jsonb)) as module,
           jsonb_array_elements(coalesce(module.value->'items', '[]'::jsonb)) as item;

      select array_agg(distinct ticked.value order by ticked.value)
        into v_ticked
      from jsonb_array_elements_text(p_payload->'checked_item_ids') as ticked
      where ticked.value = any (coalesce(v_known, '{}'::text[]));

      if not (coalesce(v_needed, '{}'::text[]) <@ coalesce(v_ticked, '{}'::text[])) then
        raise exception 'Not every required item is ticked'
          using errcode = 'check_violation', hint = 'serverErrors.checklistItemsLeft';
      end if;

      return jsonb_build_object('checked_item_ids', to_jsonb(coalesce(v_ticked, '{}'::text[])));

    else
      raise exception 'This build cannot complete a step of this type'
        using errcode = 'check_violation', hint = 'serverErrors.stepTypeUnsupported';
  end case;
end;
$$;

revoke all on function public.validate_task_step_payload(
  public.workflow_step_type, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.validate_task_step_payload(
  public.workflow_step_type, text, jsonb, jsonb) to service_role;

/**
 * Complete a step with its answer.
 *
 * Unchanged except for what it hands the validator: the step's own config,
 * which is where a checklist step keeps the modules it was started with.
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
    raise exception 'This build cannot complete a step of this type'
      using errcode = 'check_violation', hint = 'serverErrors.stepTypeUnsupported';
  end if;

  v_payload := public.validate_task_step_payload(
    v_step.type, v_step.instructions, v_step.config, coalesce(p_payload, '{}'::jsonb));

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

drop function public.validate_task_step_payload(public.workflow_step_type, text, jsonb);

-- ---------- the snapshot carries the checklist along ----------

/**
 * Copy the applicable template into the task the moment it goes into progress.
 *
 * As before, and now a checklist step is filled from the listing's own
 * checklist (or its parent's — see resolve_checklist_property). A listing
 * with nothing on its checklist gets no checklist step, exactly as a task
 * with no note gets no note step.
 */
create or replace function public.snapshot_task_steps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template  uuid;
  v_checklist jsonb;
  v_has_list  boolean := false;
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

  -- Only worth asking when the process actually has such a step.
  if exists (select 1 from public.workflow_steps s
             where s.template_id = v_template and s.type = 'checklist') then
    v_checklist := public.property_checklist_snapshot(new.property_id);
    v_has_list  := jsonb_array_length(coalesce(v_checklist->'modules', '[]'::jsonb)) > 0;
  end if;

  insert into public.task_steps (
    task_id, host_id, template_step_id, sort_order, type, required, title,
    instructions, min_photos, max_photos, max_video_sec, config
  )
  select
    new.id, new.host_id, s.id, s.sort_order, s.type, s.required, s.title,
    case when s.type = 'task_note' then new.notes else s.instructions end,
    s.min_photos, s.max_photos, s.max_video_sec,
    case when s.type = 'checklist' then v_checklist else s.config end
  from public.workflow_steps s
  where s.template_id = v_template
    and not (s.type = 'task_note' and nullif(btrim(coalesce(new.notes, '')), '') is null)
    and not (s.type = 'checklist' and not v_has_list)
  order by s.sort_order;

  return null;
end;
$$;
