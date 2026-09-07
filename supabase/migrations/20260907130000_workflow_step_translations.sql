-- The step's own words, in the languages the company speaks.
--
-- F7 gave the checklist a title per language; the step that carries the
-- checklist did not have one. The result would read as a Czech checklist
-- under a Russian heading — worse than either language on its own, because
-- it looks like a bug in the app rather than a checklist nobody translated.
--
-- Same shape as everywhere else (see 20260907110000): `title` and
-- `instructions` stay as the manager wrote them, `title_i18n` and
-- `instructions_i18n` hold the other languages, and a reader with no
-- translation of her own gets what the manager wrote.
--
-- The snapshot copies them into the task, so a finished cleaning still reads
-- in the words it was given. One exception, and it is the note step: its
-- instructions are the task's own note, written for that cleaning and for
-- that cleaner, and there is nothing to translate them from.

alter table public.workflow_steps
  add column title_i18n jsonb not null default '{}'::jsonb
    check (jsonb_typeof(title_i18n) = 'object'),
  add column instructions_i18n jsonb not null default '{}'::jsonb
    check (jsonb_typeof(instructions_i18n) = 'object');

comment on column public.workflow_steps.title_i18n is
  'Translations of the title by language code. A language missing from here reads the title itself.';
comment on column public.workflow_steps.instructions_i18n is
  'Translations of the instructions by language code, same fallback as the title.';

alter table public.task_steps
  add column title_i18n jsonb not null default '{}'::jsonb
    check (jsonb_typeof(title_i18n) = 'object'),
  add column instructions_i18n jsonb not null default '{}'::jsonb
    check (jsonb_typeof(instructions_i18n) = 'object');

comment on column public.task_steps.title_i18n is
  'Copied from the template step when the task started; empty for a step whose title the app translates itself.';
comment on column public.task_steps.instructions_i18n is
  'Copied from the template step. Always empty on a note step: its text is the task''s own note.';

-- ---------- the snapshot carries them ----------

/**
 * Copy the applicable template into the task the moment it goes into progress.
 *
 * As before, and now every language of the step's own words travels with it.
 * The note step is the exception: its instructions are the task's note, which
 * exists in one language only.
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
    title_i18n, instructions, instructions_i18n, min_photos, max_photos,
    max_video_sec, config
  )
  select
    new.id, new.host_id, s.id, s.sort_order, s.type, s.required, s.title,
    s.title_i18n,
    case when s.type = 'task_note' then new.notes else s.instructions end,
    case when s.type = 'task_note' then '{}'::jsonb else s.instructions_i18n end,
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

-- ---------- saving them ----------

/**
 * Save a whole template — header and steps — in one call.
 *
 * As before, plus `title_i18n` and `instructions_i18n` on a step. Both are
 * optional: left out of a step that already exists they keep what it has, so
 * an editor that knows nothing about languages cannot wipe another one's work.
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

    if (v_step ? 'title_i18n' and not public.is_localized_text(v_step->'title_i18n'))
       or (v_step ? 'instructions_i18n'
           and not public.is_localized_text(v_step->'instructions_i18n')) then
      raise exception 'Translations must be an object of language code to text'
        using errcode = 'invalid_parameter_value', hint = 'serverErrors.translationsInvalid';
    end if;

    if v_step_id is not null
       and exists (select 1 from public.workflow_steps s
                   where s.id = v_step_id and s.template_id = v_row.id) then
      update public.workflow_steps s
      set sort_order        = v_position,
          type              = (v_step->>'type')::public.workflow_step_type,
          required          = coalesce((v_step->>'required')::boolean, false),
          title             = v_step->>'title',
          title_i18n        = coalesce(v_step->'title_i18n', s.title_i18n),
          instructions      = v_step->>'instructions',
          instructions_i18n = coalesce(v_step->'instructions_i18n', s.instructions_i18n),
          min_photos        = (v_step->>'min_photos')::smallint,
          max_photos        = (v_step->>'max_photos')::smallint,
          max_video_sec     = (v_step->>'max_video_sec')::integer,
          config            = case when jsonb_typeof(v_step->'config') = 'object'
                                   then v_step->'config' else '{}'::jsonb end
      where s.id = v_step_id;
    else
      insert into public.workflow_steps (
        template_id, host_id, sort_order, type, required, title, title_i18n,
        instructions, instructions_i18n, min_photos, max_photos, max_video_sec, config
      )
      values (
        v_row.id, v_host, v_position,
        (v_step->>'type')::public.workflow_step_type,
        coalesce((v_step->>'required')::boolean, false),
        v_step->>'title',
        coalesce(v_step->'title_i18n', '{}'::jsonb),
        v_step->>'instructions',
        coalesce(v_step->'instructions_i18n', '{}'::jsonb),
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

-- ---------- the seeded process, in three languages ----------
--
-- The one step of the default template with words of its own. Written in
-- Russian by the owner; the other two are named by the app itself, which
-- already speaks all three.

update public.workflow_steps s
set title_i18n = jsonb_build_object(
      'en', 'Final check',
      'cs', 'Závěrečná kontrola'
    ),
    instructions_i18n = jsonb_build_object(
      'en', E'Windows shut\nLights and appliances off\nRubbish taken out\nKeys in place',
      'cs', E'Okna zavřená\nSvětla a spotřebiče vypnuté\nOdpadky vyneseny\nKlíče na místě'
    )
from public.workflow_templates t
where t.id = s.template_id
  and t.property_id is null
  and t.scope = 'cleaning'
  and s.type = 'confirmation'
  and s.title = 'Финальная проверка';
