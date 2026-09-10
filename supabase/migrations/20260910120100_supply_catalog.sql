-- The company's list of consumables, so a request is picked and not typed.
--
-- F18 stored every line of a supply request as free text: the cleaner typed
-- "средство для стёкол" and the manager read it, once per request, in every
-- spelling. The panel's purchase summary adds lines up by name, and two
-- spellings are two rows. The manager wanted the phone to offer a list and
-- ask only for the quantity.
--
-- supply_catalog_items is that list: one per company, named in the company's
-- language with translations beside it (see 20260907110000_localized_text),
-- each with the unit it is counted in. A line of a request may point at one;
-- then its name and unit are copied from the catalogue on the server, and the
-- request keeps reading right even after the item is renamed or archived.
-- Free text stays allowed: a cleaner must never be stuck because the list
-- has no entry for what ran out (§Д1.3).
--
-- Written only through RPC, so the translations are checked; read by every
-- active member of the company. Archived rather than deleted: old requests
-- point at the rows.

create table public.supply_catalog_items (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null default public.default_host_id()
                references public.hosts(id) on delete restrict,
  name        text not null,
  name_i18n   jsonb not null default '{}'::jsonb,
  unit        public.supply_unit not null default 'pcs',
  sort_order  smallint not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (length(btrim(name)) between 1 and 120),
  check (jsonb_typeof(name_i18n) = 'object')
);

comment on table public.supply_catalog_items is
  'What a cleaner can pick on a supply request: a name in the company language, its translations, the unit. Archived, never deleted.';

-- The same name in the same unit is one entry, whatever the case; an
-- archived entry does not block the name from being used again.
create unique index supply_catalog_items_name_key
  on public.supply_catalog_items (host_id, lower(btrim(name)), unit)
  where archived_at is null;
create index supply_catalog_items_host_idx
  on public.supply_catalog_items (host_id, archived_at, sort_order, name);

create trigger supply_catalog_items_touch
  before update on public.supply_catalog_items
  for each row execute function public.touch_updated_at();

alter table public.supply_request_items
  add column catalog_item_id uuid references public.supply_catalog_items(id) on delete set null;

comment on column public.supply_request_items.catalog_item_id is
  'The catalogue entry this line was picked from; null when the cleaner typed the name herself.';

create index supply_request_items_catalog_idx
  on public.supply_request_items (catalog_item_id) where catalog_item_id is not null;

-- ---------- grants and row policies ----------

revoke all on public.supply_catalog_items from anon, authenticated;
grant select on public.supply_catalog_items to authenticated;
grant select, insert, update, delete on public.supply_catalog_items to service_role;

alter table public.supply_catalog_items enable row level security;

create policy "staff read the catalogue"
  on public.supply_catalog_items for select to authenticated
  using (host_id = public.current_host_id() and public.is_active_user());

-- ---------- the manager's side ----------

/**
 * Create a catalogue entry, or rewrite one. Replayable by id.
 *
 * The id is minted by the panel so a retry after a lost connection replays
 * rather than duplicates. Translations are a bag of language code to text,
 * checked by is_localized_text.
 */
create or replace function public.save_supply_catalog_item(
  p_id         uuid,
  p_name       text,
  p_name_i18n  jsonb default '{}'::jsonb,
  p_unit       public.supply_unit default 'pcs',
  p_sort_order integer default null
)
returns public.supply_catalog_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid := public.current_host_id();
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_item public.supply_catalog_items;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if v_name is null or length(v_name) > public.supply_item_name_max_length() then
    raise exception 'A catalogue entry needs a name of up to % characters',
      public.supply_item_name_max_length()
      using errcode = 'check_violation',
            hint = 'serverErrors.supplyItemInvalid',
            detail = jsonb_build_object('index', 1)::text;
  end if;
  if p_name_i18n is not null and not public.is_localized_text(p_name_i18n) then
    raise exception 'Translations must be an object of language code to text'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.translationsInvalid';
  end if;

  select i.* into v_item
  from public.supply_catalog_items i
  where i.id = p_id and i.host_id = v_host
  for update;

  if found then
    update public.supply_catalog_items i
    set name       = v_name,
        name_i18n  = coalesce(p_name_i18n, '{}'::jsonb),
        unit       = coalesce(p_unit, 'pcs'),
        sort_order = coalesce(p_sort_order, i.sort_order)
    where i.id = p_id
    returning * into v_item;
  else
    insert into public.supply_catalog_items (id, host_id, name, name_i18n, unit, sort_order)
    values (p_id, v_host, v_name, coalesce(p_name_i18n, '{}'::jsonb), coalesce(p_unit, 'pcs'),
            coalesce(p_sort_order,
                     (select coalesce(max(sort_order), 0) + 1
                      from public.supply_catalog_items where host_id = v_host)))
    returning * into v_item;
  end if;

  return v_item;
exception when unique_violation then
  raise exception 'The catalogue already has "%" in this unit', v_name
    using errcode = 'check_violation', hint = 'serverErrors.catalogItemDuplicate';
end;
$$;

/** Take an entry off the phone's list, or put it back. Old requests keep pointing at it. */
create or replace function public.archive_supply_catalog_item(p_id uuid, p_archived boolean default true)
returns public.supply_catalog_items
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item public.supply_catalog_items;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  update public.supply_catalog_items i
  set archived_at = case when p_archived then coalesce(i.archived_at, now()) else null end
  where i.id = p_id and i.host_id = public.current_host_id()
  returning * into v_item;

  if not found then
    raise exception 'Catalogue entry not found'
      using errcode = 'check_violation', hint = 'serverErrors.catalogItemNotFound';
  end if;

  return v_item;
exception when unique_violation then
  raise exception 'The catalogue already has an entry with this name in this unit'
    using errcode = 'check_violation', hint = 'serverErrors.catalogItemDuplicate';
end;
$$;

revoke all on function public.save_supply_catalog_item(uuid, text, jsonb, public.supply_unit, integer)
  from public, anon;
revoke all on function public.archive_supply_catalog_item(uuid, boolean) from public, anon;
grant execute on function public.save_supply_catalog_item(uuid, text, jsonb, public.supply_unit, integer)
  to authenticated, service_role;
grant execute on function public.archive_supply_catalog_item(uuid, boolean) to authenticated, service_role;

-- ---------- the cleaner's side: a line may be picked from the catalogue ----------

/**
 * Create a request, or rewrite one that is still 'new'. Replayable.
 *
 * p_items: [{"name": "…", "quantity": 2, "unit": "pcs", "comment": "…"}, …]
 * or [{"catalog_item_id": "…", "quantity": 2, "comment": "…"}, …], in the
 * order they were entered. A line with a catalogue id takes its name and
 * unit from the catalogue, whatever else it says. At least one item; each is
 * checked and the first bad one is named by its position.
 */
create or replace function public.save_supply_request(
  p_id          uuid,
  p_items       jsonb,
  p_priority    public.supply_priority default 'normal',
  p_note        text default null,
  p_needed_by   date default null,
  p_property_id bigint default null,
  p_task_id     uuid default null
)
returns public.supply_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request  public.supply_requests;
  v_property bigint;
  v_item     jsonb;
  v_index    integer := 0;
  v_name     text;
  v_quantity numeric;
  v_unit     public.supply_unit;
  v_comment  text;
  v_catalog  public.supply_catalog_items;
begin
  select r.* into v_request
  from public.supply_requests r
  where r.id = p_id and r.host_id = public.current_host_id()
  for update;
  if found then
    if v_request.requested_by is distinct from (select auth.uid()) then
      raise exception 'Supply request not found'
        using errcode = 'check_violation', hint = 'serverErrors.supplyNotFound';
    end if;
    if v_request.status <> 'new' then
      raise exception 'Supply request is % and can no longer be edited', v_request.status
        using errcode = 'check_violation', hint = 'serverErrors.supplyNotEditable';
    end if;
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'A supply request needs at least one item'
      using errcode = 'check_violation', hint = 'serverErrors.supplyItemsRequired';
  end if;
  if length(coalesce(p_note, '')) > public.supply_note_max_length() then
    raise exception 'The note is longer than % characters', public.supply_note_max_length()
      using errcode = 'check_violation',
            hint = 'serverErrors.supplyNoteTooLong',
            detail = jsonb_build_object('limit', public.supply_note_max_length())::text;
  end if;

  v_property := public.resolve_report_property(p_property_id, p_task_id);

  if v_request.id is null then
    insert into public.supply_requests (
      id, host_id, requested_by, property_id, task_id, priority, note, needed_by
    ) values (
      p_id, public.current_host_id(), (select auth.uid()), v_property, p_task_id,
      coalesce(p_priority, 'normal'), nullif(btrim(coalesce(p_note, '')), ''), p_needed_by
    )
    returning * into v_request;
  else
    update public.supply_requests r
    set property_id = v_property,
        task_id     = p_task_id,
        priority    = coalesce(p_priority, 'normal'),
        note        = nullif(btrim(coalesce(p_note, '')), ''),
        needed_by   = p_needed_by
    where r.id = p_id
    returning * into v_request;

    delete from public.supply_request_items i where i.request_id = p_id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;

    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Item % is not an object', v_index
        using errcode = 'check_violation',
              hint = 'serverErrors.supplyItemInvalid',
              detail = jsonb_build_object('index', v_index)::text;
    end if;

    v_catalog := null;
    v_name := nullif(btrim(coalesce(v_item ->> 'name', '')), '');
    v_comment := nullif(btrim(coalesce(v_item ->> 'comment', '')), '');
    begin
      v_quantity := (v_item ->> 'quantity')::numeric;
      v_unit := coalesce(v_item ->> 'unit', 'pcs')::public.supply_unit;
      if nullif(v_item ->> 'catalog_item_id', '') is not null then
        select c.* into v_catalog
        from public.supply_catalog_items c
        where c.id = (v_item ->> 'catalog_item_id')::uuid
          and c.host_id = v_request.host_id
          and c.archived_at is null;
        if not found then
          raise exception 'Item % points at no catalogue entry', v_index;
        end if;
        v_name := v_catalog.name;
        v_unit := v_catalog.unit;
      end if;
    exception when others then
      raise exception 'Item % has a bad quantity, unit or catalogue entry', v_index
        using errcode = 'check_violation',
              hint = 'serverErrors.supplyItemInvalid',
              detail = jsonb_build_object('index', v_index)::text;
    end;

    if v_name is null
       or length(v_name) > public.supply_item_name_max_length()
       or v_quantity is null or v_quantity <= 0
       or length(coalesce(v_comment, '')) > 300 then
      raise exception 'Item % is incomplete', v_index
        using errcode = 'check_violation',
              hint = 'serverErrors.supplyItemInvalid',
              detail = jsonb_build_object('index', v_index)::text;
    end if;

    insert into public.supply_request_items (
      request_id, host_id, name, quantity, unit, comment, sort_order, catalog_item_id
    ) values (
      p_id, v_request.host_id, v_name, round(v_quantity, 2), v_unit, v_comment, v_index,
      v_catalog.id
    );
  end loop;

  return v_request;
end;
$$;
