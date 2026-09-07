-- F7. The checklist of a listing: modules and the items inside them.
--
-- What a cleaner actually walks through in the flat — bathroom, kitchen,
-- bedroom, and under each one the things to do. It belongs to the listing and
-- not to a kind of listing: two studios in the same building can differ by a
-- balcony door that sticks, and a "type of apartment" would hide exactly that.
-- The cost of per-listing checklists is filling them in seventy-eight times,
-- and copy_property_checklist() is the answer to that: take one from another
-- listing and edit the difference.
--
-- How this reaches a cleaning: not as a screen of its own. A template step of
-- type 'checklist' (F16) takes a snapshot of this checklist when the task
-- starts, and from then on the task carries its own copy — the next migration
-- wires that in. Editing a checklist mid-cleaning does not move the ground
-- under the cleaner's feet, and a finished task shows what was asked then.
--
-- Where it is edited: nowhere yet. The manager panel (F10) will call
-- save_property_checklist(); until then rows are written in Studio through
-- the same function. Nothing writes these tables directly.

-- ---------- modules ----------

create table public.checklist_modules (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null default public.default_host_id()
                references public.hosts(id) on delete restrict,
  property_id bigint not null,
  title       text not null check (btrim(title) <> ''),
  -- The same name in the other languages of the company; see 20260907110000.
  -- Empty is the normal state, and then a reader sees `title`.
  title_i18n  jsonb not null default '{}'::jsonb
                check (jsonb_typeof(title_i18n) = 'object'),
  sort_order  smallint not null check (sort_order >= 1),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (host_id, id),
  foreign key (host_id, property_id)
    references public.properties(host_id, id) on delete cascade,
  -- Deferred so that reordering modules inside one save never collides with
  -- itself half-way through.
  unique (property_id, sort_order) deferrable initially deferred
);

comment on table public.checklist_modules is
  'A room-sized part of a listing''s checklist: bathroom, kitchen, bedroom. Items live inside it.';
comment on column public.checklist_modules.title_i18n is
  'Translations of the title by language code. A language missing from here reads the title itself.';

create index checklist_modules_host_property_idx
  on public.checklist_modules (host_id, property_id, sort_order);

create trigger checklist_modules_touch
  before update on public.checklist_modules
  for each row execute function public.touch_updated_at();

-- ---------- items ----------

create table public.checklist_items (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null default public.default_host_id()
                references public.hosts(id) on delete restrict,
  module_id   uuid not null references public.checklist_modules(id) on delete cascade,
  title       text not null check (btrim(title) <> ''),
  title_i18n  jsonb not null default '{}'::jsonb
                check (jsonb_typeof(title_i18n) = 'object'),
  sort_order  smallint not null check (sort_order >= 1),
  -- An item the cleaner may leave unticked and still finish the step: the
  -- window box in winter, the second bathroom nobody used. Everything else
  -- holds the step until it is ticked.
  is_optional boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (host_id, id),
  foreign key (host_id, module_id)
    references public.checklist_modules(host_id, id) on delete cascade,
  unique (module_id, sort_order) deferrable initially deferred
);

comment on table public.checklist_items is
  'One thing to do inside a checklist module. Copied into the task step''s config when a task starts.';
comment on column public.checklist_items.is_optional is
  'True: the cleaner may finish the checklist step without ticking it. False: it holds the step.';
comment on column public.checklist_items.title_i18n is
  'Translations of the title by language code. A language missing from here reads the title itself.';

create index checklist_items_host_module_idx
  on public.checklist_items (host_id, module_id, sort_order);

create trigger checklist_items_touch
  before update on public.checklist_items
  for each row execute function public.touch_updated_at();

-- ---------- access ----------
--
-- Everybody in the company reads the checklist — the cleaner has to see it
-- during the cleaning, and reading it before she starts is no harm either.
-- Nobody writes these tables directly: the only write paths are the two
-- functions below, which check the role themselves. The explicit revoke is
-- not decoration — the cloud hands new tables full privileges to
-- `authenticated` through default privileges, and a grant nobody asked for is
-- how a cleaner ends up able to delete a checklist.

grant select on public.checklist_modules, public.checklist_items to authenticated;
revoke insert, update, delete on public.checklist_modules, public.checklist_items
  from authenticated;
grant select, insert, update, delete
  on public.checklist_modules, public.checklist_items to service_role;
revoke all on public.checklist_modules, public.checklist_items from anon;

alter table public.checklist_modules enable row level security;
alter table public.checklist_items enable row level security;

create policy "active staff read checklist modules"
  on public.checklist_modules for select
  to authenticated
  using (public.is_active_user() and host_id = public.current_host_id());

create policy "active staff read checklist items"
  on public.checklist_items for select
  to authenticated
  using (public.is_active_user() and host_id = public.current_host_id());

-- ---------- whose checklist a listing follows ----------

/**
 * The listing whose checklist applies here, or null.
 *
 * Its own if it has one, otherwise its parent's: the rooms of one flat share
 * the flat's checklist, exactly as they share its process
 * (resolve_workflow_template). "Has one" means at least one item — a module
 * with nothing in it is an unfinished thought, not a checklist.
 *
 * security definer so the snapshot trigger can ask regardless of who is
 * writing the task.
 */
create or replace function public.resolve_checklist_property(p_property_id bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.id from public.properties p
     where p.id = p_property_id
       and exists (select 1 from public.checklist_items i
                   join public.checklist_modules m on m.id = i.module_id
                   where m.property_id = p.id)),
    (select p.parent_id from public.properties p
     where p.id = p_property_id
       and exists (select 1 from public.checklist_items i
                   join public.checklist_modules m on m.id = i.module_id
                   where m.property_id = p.parent_id))
  )
$$;

/**
 * The checklist of a listing, shaped for a task step's config.
 *
 *   { "modules": [ { "id", "title", "title_i18n",
 *                    "items": [ { "id", "title", "title_i18n",
 *                                 "is_optional" } ] } ] }
 *
 * Ids travel with it: the cleaner's answer is a list of item ids, and keeping
 * the ids means an answer can still be read after the checklist itself has
 * been rewritten. Modules with no items are left out — they would show as an
 * empty heading and nothing else.
 *
 * Every language travels with it, not just the one the cleaner reads: the
 * same snapshot is opened later by a manager, and a task finished in March
 * should read in March's words whoever opens it.
 *
 * Returns `{"modules": []}` when there is no checklist. The caller decides
 * what that means; the snapshot trigger drops the step.
 */
create or replace function public.property_checklist_snapshot(p_property_id bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with source as (
    select public.resolve_checklist_property(p_property_id) as property_id
  ),
  filled as (
    select m.sort_order,
           jsonb_build_object(
             'id', m.id,
             'title', m.title,
             'title_i18n', m.title_i18n,
             'items', (
               select jsonb_agg(jsonb_build_object(
                        'id', i.id,
                        'title', i.title,
                        'title_i18n', i.title_i18n,
                        'is_optional', i.is_optional
                      ) order by i.sort_order)
               from public.checklist_items i
               where i.module_id = m.id
             )
           ) as module
    from public.checklist_modules m
    join source on source.property_id = m.property_id
    where exists (select 1 from public.checklist_items i where i.module_id = m.id)
  )
  select jsonb_build_object(
    'modules',
    coalesce((select jsonb_agg(module order by sort_order) from filled), '[]'::jsonb)
  )
$$;

revoke all on function public.resolve_checklist_property(bigint) from public, anon;
revoke all on function public.property_checklist_snapshot(bigint) from public, anon;
grant execute on function public.resolve_checklist_property(bigint) to authenticated, service_role;
grant execute on function public.property_checklist_snapshot(bigint) to authenticated, service_role;

-- ---------- saving a checklist ----------

/**
 * Save a listing's whole checklist — modules and items — in one call.
 *
 * Shape:
 *   [ { id?, title, title_i18n?,
 *       items: [ { id?, title, title_i18n?, is_optional? }, ... ] }, ... ]
 *
 * `title_i18n` is optional everywhere. Left out of a row that already exists
 * it keeps the translations that row has — an editor that knows nothing about
 * languages cannot wipe them by accident.
 *
 * The array order is the order on screen. A module or item that arrives with
 * an id it already has here is updated in place, so a snapshot taken from it
 * keeps pointing at the same row; one without an id is created; one missing
 * from the array is deleted with everything under it. An empty array clears
 * the checklist.
 *
 * Managers only, and only inside their own company. Returns the checklist as
 * the snapshot sees it, which is what the caller wants to show back.
 */
create or replace function public.save_property_checklist(
  p_property_id bigint,
  p_modules     jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host         uuid := public.current_host_id();
  v_module       jsonb;
  v_item         jsonb;
  v_module_id    uuid;
  v_item_id      uuid;
  v_position     integer := 0;
  v_item_pos     integer;
  v_kept_modules uuid[] := '{}';
  v_kept_items   uuid[] := '{}';
begin
  if not public.is_manager() then
    raise exception 'Only a manager may save a checklist'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  if jsonb_typeof(p_modules) <> 'array' then
    raise exception 'A checklist must be a list of modules'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.checklistShapeInvalid';
  end if;

  if not exists (select 1 from public.properties p
                 where p.id = p_property_id and p.host_id = v_host) then
    raise exception 'Listing not found'
      using errcode = 'check_violation', hint = 'serverErrors.propertyNotFound';
  end if;

  for v_module in select value from jsonb_array_elements(p_modules) loop
    v_position  := v_position + 1;
    v_module_id := (v_module->>'id')::uuid;

    if v_module ? 'title_i18n' and not public.is_localized_text(v_module->'title_i18n') then
      raise exception 'Translations must be an object of language code to text'
        using errcode = 'invalid_parameter_value', hint = 'serverErrors.translationsInvalid';
    end if;

    if v_module_id is not null
       and exists (select 1 from public.checklist_modules m
                   where m.id = v_module_id and m.property_id = p_property_id) then
      update public.checklist_modules m
      set title      = coalesce(v_module->>'title', m.title),
          title_i18n = coalesce(v_module->'title_i18n', m.title_i18n),
          sort_order = v_position
      where m.id = v_module_id;
    else
      insert into public.checklist_modules (host_id, property_id, title, title_i18n, sort_order)
      values (v_host, p_property_id, coalesce(v_module->>'title', ''),
              coalesce(v_module->'title_i18n', '{}'::jsonb), v_position)
      returning id into v_module_id;
    end if;

    v_kept_modules := v_kept_modules || v_module_id;
    v_item_pos     := 0;

    if jsonb_typeof(v_module->'items') = 'array' then
      for v_item in select value from jsonb_array_elements(v_module->'items') loop
        v_item_pos := v_item_pos + 1;
        v_item_id  := (v_item->>'id')::uuid;

        if v_item ? 'title_i18n' and not public.is_localized_text(v_item->'title_i18n') then
          raise exception 'Translations must be an object of language code to text'
            using errcode = 'invalid_parameter_value', hint = 'serverErrors.translationsInvalid';
        end if;

        if v_item_id is not null
           and exists (select 1 from public.checklist_items i
                       where i.id = v_item_id and i.module_id = v_module_id) then
          update public.checklist_items i
          set title       = coalesce(v_item->>'title', i.title),
              title_i18n  = coalesce(v_item->'title_i18n', i.title_i18n),
              is_optional = coalesce((v_item->>'is_optional')::boolean, false),
              sort_order  = v_item_pos
          where i.id = v_item_id;
        else
          insert into public.checklist_items (
            host_id, module_id, title, title_i18n, sort_order, is_optional
          )
          values (v_host, v_module_id, coalesce(v_item->>'title', ''),
                  coalesce(v_item->'title_i18n', '{}'::jsonb), v_item_pos,
                  coalesce((v_item->>'is_optional')::boolean, false))
          returning id into v_item_id;
        end if;

        v_kept_items := v_kept_items || v_item_id;
      end loop;
    end if;
  end loop;

  delete from public.checklist_items i
  where i.module_id = any (v_kept_modules) and not (i.id = any (v_kept_items));

  delete from public.checklist_modules m
  where m.property_id = p_property_id and not (m.id = any (v_kept_modules));

  return public.property_checklist_snapshot(p_property_id);
end;
$$;

/**
 * Take another listing's checklist and make it this listing's own.
 *
 * The panel's "take from another apartment". New rows with new ids: after the
 * copy the two checklists are strangers, and editing one leaves the other
 * alone. Whatever the target had is replaced — the manager is saying "make it
 * like that one", not "add that one to this".
 *
 * Only the source's own checklist is copied, never one it inherits from its
 * parent: copying something the source itself does not have would surprise
 * whoever asked.
 */
create or replace function public.copy_property_checklist(
  p_source_property_id bigint,
  p_target_property_id bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid := public.current_host_id();
begin
  if not public.is_manager() then
    raise exception 'Only a manager may copy a checklist'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  if p_source_property_id = p_target_property_id then
    raise exception 'Source and target are the same listing'
      using errcode = 'check_violation', hint = 'serverErrors.checklistCopySameProperty';
  end if;

  if not exists (select 1 from public.properties p
                 where p.id = p_target_property_id and p.host_id = v_host)
     or not exists (select 1 from public.properties p
                    where p.id = p_source_property_id and p.host_id = v_host) then
    raise exception 'Listing not found'
      using errcode = 'check_violation', hint = 'serverErrors.propertyNotFound';
  end if;

  if not exists (select 1 from public.checklist_modules m
                 where m.property_id = p_source_property_id) then
    raise exception 'The source listing has no checklist of its own'
      using errcode = 'check_violation', hint = 'serverErrors.checklistSourceEmpty';
  end if;

  delete from public.checklist_modules m where m.property_id = p_target_property_id;

  with copied as (
    insert into public.checklist_modules (host_id, property_id, title, title_i18n, sort_order)
    select v_host, p_target_property_id, m.title, m.title_i18n, m.sort_order
    from public.checklist_modules m
    where m.property_id = p_source_property_id
    returning id, sort_order
  )
  insert into public.checklist_items (
    host_id, module_id, title, title_i18n, sort_order, is_optional
  )
  select v_host, copied.id, i.title, i.title_i18n, i.sort_order, i.is_optional
  from copied
  join public.checklist_modules source on source.property_id = p_source_property_id
                                      and source.sort_order = copied.sort_order
  join public.checklist_items i on i.module_id = source.id;

  return public.property_checklist_snapshot(p_target_property_id);
end;
$$;

revoke all on function public.save_property_checklist(bigint, jsonb) from public, anon;
revoke all on function public.copy_property_checklist(bigint, bigint) from public, anon;
grant execute on function public.save_property_checklist(bigint, jsonb) to authenticated, service_role;
grant execute on function public.copy_property_checklist(bigint, bigint) to authenticated, service_role;
