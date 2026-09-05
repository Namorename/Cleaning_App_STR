-- F16. The process constructor: templates and their steps.
--
-- A manager describes once how a cleaning goes — which steps, in what order,
-- which are mandatory, how many photos — and every task of that kind follows
-- it. The template belongs to the company (host) and to a kind of process
-- (scope); one company-wide template covers all seventy-eight listings, and a
-- listing with its own needs gets its own template that replaces the default
-- entirely. Nobody configures the same thing seventy-eight times.
--
-- Where it is edited: nowhere yet. The manager panel (F10) will call
-- `save_workflow_template()`; until then the rows are edited in Studio. The
-- rules — what may be required, what the limits mean — live here, in
-- constraints, so the panel cannot save something the app cannot run.
--
-- What a template does NOT do: it never touches a task already under way.
-- When a cleaner starts a task, its steps are copied into `task_steps` (next
-- migration) and from then on the task carries its own list. A template
-- edited on Tuesday changes Wednesday's cleanings, not Tuesday's.

-- ---------- which steps the app can run ----------

/**
 * Step types the current app build knows how to complete.
 *
 * A required step of a type the app cannot complete would strand the task:
 * the finish gate would refuse until a manager waived it. So a step may be
 * required only if its type is in this list, and the list grows with the
 * phases — `create or replace` here, and the CHECK below loosens on its own.
 */
create or replace function public.workflow_supported_step_types()
returns public.workflow_step_type[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array['task_note', 'cleaner_comment', 'confirmation']::public.workflow_step_type[]
$$;

/**
 * Which process a task of this type follows.
 *
 * The single place the mapping lives. `maintenance` maps to the problem
 * process because F9 will model a repair as a maintenance task; until a
 * manager creates a template for that scope the mapping resolves to nothing.
 */
create or replace function public.workflow_scope_for(p_type public.task_type)
returns public.workflow_scope
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_type
    when 'cleaning'    then 'cleaning'
    when 'midstay'     then 'midstay'
    when 'inspection'  then 'inspection'
    when 'maintenance' then 'problem'
  end::public.workflow_scope
$$;

revoke all on function public.workflow_supported_step_types() from public, anon;
revoke all on function public.workflow_scope_for(public.task_type) from public, anon;
grant execute on function public.workflow_supported_step_types() to authenticated, service_role;
grant execute on function public.workflow_scope_for(public.task_type) to authenticated, service_role;

-- A template that overrides the process for one listing must name a listing
-- of its own company. The composite foreign key below needs this index.
create unique index properties_host_id_uq on public.properties (host_id, id);

-- ---------- templates ----------

create table public.workflow_templates (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null default public.default_host_id()
                  references public.hosts(id) on delete restrict,
  scope         public.workflow_scope not null,
  -- Null: the company default for this scope. Set: replaces the default for
  -- this one listing (and, through parent_id, its units).
  property_id   bigint,
  name          text not null check (btrim(name) <> ''),
  is_active     boolean not null default true,
  -- Reserved: when true, the app will open steps strictly in order. Not read
  -- anywhere yet; the owner chose free order for now.
  enforce_order boolean not null default false,
  -- Bumped by every save. Snapshots do not record it; task_steps keep
  -- template_step_id instead, which survives reorders.
  version       integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (host_id, id),
  foreign key (host_id, property_id)
    references public.properties(host_id, id) on delete cascade
);

comment on table public.workflow_templates is
  'A process: the steps a task of one scope walks through. One per host and scope; a listing may override it with its own.';
comment on column public.workflow_templates.property_id is
  'Null = company default for the scope. Set = this listing (and its units via parent_id) follow this template instead.';
comment on column public.workflow_templates.enforce_order is
  'Reserved. When true the app opens steps strictly in order. Not read yet.';

create unique index workflow_templates_host_default_uq
  on public.workflow_templates (host_id, scope) where property_id is null;
create unique index workflow_templates_property_uq
  on public.workflow_templates (host_id, property_id, scope) where property_id is not null;

create trigger workflow_templates_touch
  before update on public.workflow_templates
  for each row execute function public.touch_updated_at();

-- ---------- steps ----------

create table public.workflow_steps (
  id            uuid primary key default gen_random_uuid(),
  template_id   uuid not null references public.workflow_templates(id) on delete cascade,
  host_id       uuid not null default public.default_host_id()
                  references public.hosts(id) on delete restrict,
  sort_order    smallint not null check (sort_order >= 1),
  type          public.workflow_step_type not null,
  required      boolean not null default false,
  -- Null: the app shows its own translation of the type. Set: the manager's
  -- wording, in the manager's language.
  title         text,
  instructions  text,
  min_photos    smallint,
  max_photos    smallint,
  max_video_sec integer,
  config        jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  -- Reserved for conditions evaluated at snapshot time: only on a same-day
  -- turnover, only when guests_count >= N. Not read yet.
  applies_when  jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (host_id, template_id)
    references public.workflow_templates(host_id, id) on delete cascade,
  -- Deferred so that reordering steps inside one save never collides with
  -- itself half-way through.
  unique (template_id, sort_order) deferrable initially deferred,
  check (min_photos is null or min_photos >= 0),
  check (max_photos is null or max_photos >= 1),
  check (min_photos is null or max_photos is null or min_photos <= max_photos),
  check (max_video_sec is null or max_video_sec between 1 and 600),
  -- Limits mean something only on the step types that collect media.
  check (type in ('photos_before', 'photos_after') or (min_photos is null and max_photos is null)),
  check (type = 'video' or max_video_sec is null),
  -- A required step must be one the app can actually complete.
  check (not required or type = any (public.workflow_supported_step_types()))
);

comment on table public.workflow_steps is
  'One step of a template. Copied into task_steps when a task starts; edits here never reach tasks already under way.';
comment on column public.workflow_steps.title is
  'Null = the app shows its own translation of the type. Set = the manager''s wording.';
comment on column public.workflow_steps.applies_when is
  'Reserved for conditions evaluated at snapshot time (same-day only, guests >= N). Not read yet.';

create index workflow_steps_host_template_idx
  on public.workflow_steps (host_id, template_id, sort_order);

create trigger workflow_steps_touch
  before update on public.workflow_steps
  for each row execute function public.touch_updated_at();

-- ---------- access ----------
--
-- Everybody in the company may read the process — a cleaner will want to see
-- what a task is going to ask of her before she starts it. Nobody writes the
-- tables directly: the only write path is save_workflow_template(), which
-- checks the role itself.

grant select on public.workflow_templates, public.workflow_steps to authenticated;
grant select, insert, update, delete on public.workflow_templates, public.workflow_steps to service_role;
revoke all on public.workflow_templates, public.workflow_steps from anon;

alter table public.workflow_templates enable row level security;
alter table public.workflow_steps enable row level security;

create policy "active staff read templates"
  on public.workflow_templates for select
  to authenticated
  using (public.is_active_user() and host_id = public.current_host_id());

create policy "active staff read steps"
  on public.workflow_steps for select
  to authenticated
  using (public.is_active_user() and host_id = public.current_host_id());

-- ---------- which template a task follows ----------

/**
 * The template a task on this listing follows for this scope, or null.
 *
 * Listing first, then the listing's parent (units of one flat share a
 * process), then the company default. A template switched off is treated as
 * absent, so a listing override can be paused without deleting it.
 *
 * security definer so that the snapshot trigger can ask regardless of who is
 * writing the task.
 */
create or replace function public.resolve_workflow_template(
  p_property_id bigint,
  p_scope       public.workflow_scope
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select t.id from public.workflow_templates t
     where t.property_id = p_property_id and t.scope = p_scope and t.is_active),
    (select t.id from public.workflow_templates t
     join public.properties p on p.id = p_property_id
     where t.property_id = p.parent_id and t.scope = p_scope and t.is_active),
    (select t.id from public.workflow_templates t
     join public.properties p on p.id = p_property_id
     where t.host_id = p.host_id and t.property_id is null
       and t.scope = p_scope and t.is_active)
  )
$$;

revoke all on function public.resolve_workflow_template(bigint, public.workflow_scope) from public, anon;
grant execute on function public.resolve_workflow_template(bigint, public.workflow_scope) to authenticated, service_role;

-- ---------- saving a template ----------

/**
 * Save a whole template — header and steps — in one call.
 *
 * Shape:
 *   { id?, scope, property_id?, name, is_active?,
 *     steps: [ { id?, type, required?, title?, instructions?,
 *                min_photos?, max_photos?, max_video_sec?, config? }, ... ] }
 *
 * The array order is the step order. A step that arrives with an id it
 * already has in this template is updated in place, so task_steps written
 * from it keep pointing at the same row; a step without one is created; a
 * step of the template that is missing from the array is deleted. Without an
 * id the template is found by its natural key (host, scope, listing) and
 * created if absent. Every save bumps the version.
 *
 * Managers only, and only inside their own company. Validation is the table's
 * own constraints: an error from here is the same error Studio would show.
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
    raise exception 'Сохранять процесс может только менеджер'
      using errcode = 'insufficient_privilege';
  end if;

  if jsonb_typeof(p_template) <> 'object' or jsonb_typeof(p_template->'steps') <> 'array' then
    raise exception 'Шаблон должен быть объектом со списком steps'
      using errcode = 'invalid_parameter_value';
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
      raise exception 'Шаблон не найден' using errcode = 'check_violation';
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

revoke all on function public.save_workflow_template(jsonb) from public, anon;
grant execute on function public.save_workflow_template(jsonb) to authenticated, service_role;
