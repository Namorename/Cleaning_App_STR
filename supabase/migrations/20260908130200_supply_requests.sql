-- F18: supply requests — a cleaner asks for what she works with.
--
-- §Д1 of the spec. Deliberately not a problem (§Д1.2): a different process
-- with a different handler. The request is personal — the cleaner sees only
-- her own — and is written only through RPC, idempotent by a client-
-- generated id like a problem report. Items are replaced wholesale on every
-- save while the request is still 'new'; after a manager has picked it up the
-- cleaner only reads it, so the list does not move under the manager's hands.
--
-- Stock, suppliers and prices are out of scope on purpose: this records the
-- request and its fate, not a warehouse.

create type public.supply_request_status as enum ('new', 'accepted', 'ordered', 'fulfilled', 'rejected');
create type public.supply_priority as enum ('normal', 'urgent');
create type public.supply_unit as enum ('pcs', 'pack', 'l', 'kg', 'roll');

comment on type public.supply_priority is
  'urgent = running out now, the cleaning cannot be done without it.';

create or replace function public.supply_note_max_length()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 2000 $$;

create or replace function public.supply_item_name_max_length()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 120 $$;

revoke all on function public.supply_note_max_length() from public, anon;
revoke all on function public.supply_item_name_max_length() from public, anon;
grant execute on function public.supply_note_max_length() to authenticated, service_role;
grant execute on function public.supply_item_name_max_length() to authenticated, service_role;

-- ---------- tables ----------

create table public.supply_requests (
  id            uuid primary key,
  host_id       uuid not null default public.default_host_id()
                  references public.hosts(id) on delete restrict,
  requested_by  uuid not null references public.profiles(id) on delete restrict,
  -- Null = a general request "for myself", not tied to a flat.
  property_id   bigint references public.properties(id) on delete set null,
  task_id       uuid references public.tasks(id) on delete set null,
  status        public.supply_request_status not null default 'new',
  priority      public.supply_priority not null default 'normal',
  note          text,
  needed_by     date,
  reviewed_by   uuid references public.profiles(id) on delete set null,
  reviewed_at   timestamptz,
  fulfilled_at  timestamptz,
  reject_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (note is null or length(note) <= 2000),
  check (reject_reason is null or length(reject_reason) <= 1000),
  -- A silent refusal is not allowed (§Д1.7): rejected always says why.
  check (status <> 'rejected' or nullif(btrim(coalesce(reject_reason, '')), '') is not null)
);

comment on table public.supply_requests is
  'A cleaner''s request for consumables. Items in supply_request_items. Personal: visible to its author and the managers.';

create index supply_requests_host_status_idx
  on public.supply_requests (host_id, status, created_at desc);
create index supply_requests_requested_by_idx on public.supply_requests (requested_by, created_at desc);

create trigger supply_requests_touch
  before update on public.supply_requests
  for each row execute function public.touch_updated_at();

create table public.supply_request_items (
  id         uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.supply_requests(id) on delete cascade,
  host_id    uuid not null references public.hosts(id) on delete restrict,
  name       text not null,
  quantity   numeric(10, 2) not null,
  unit       public.supply_unit not null default 'pcs',
  comment    text,
  sort_order smallint not null,
  check (length(btrim(name)) between 1 and 120),
  check (quantity > 0),
  check (comment is null or length(comment) <= 300),
  unique (request_id, sort_order)
);

comment on table public.supply_request_items is
  'What and how much. Free text on purpose: the cleaner must never be stuck on an incomplete catalogue (inventory links come with F17).';

create index supply_request_items_request_idx on public.supply_request_items (request_id, sort_order);

-- ---------- grants and row policies ----------

revoke all on public.supply_requests from anon, authenticated;
revoke all on public.supply_request_items from anon, authenticated;
grant select on public.supply_requests to authenticated;
grant select on public.supply_request_items to authenticated;
grant select, insert, update, delete on public.supply_requests to service_role;
grant select, insert, update, delete on public.supply_request_items to service_role;

alter table public.supply_requests enable row level security;
alter table public.supply_request_items enable row level security;

create policy "author reads own supply requests"
  on public.supply_requests for select to authenticated
  using (requested_by = (select auth.uid())
         and host_id = public.current_host_id()
         and public.is_active_user());

create policy "managers read all supply requests"
  on public.supply_requests for select to authenticated
  using (public.is_manager() and host_id = public.current_host_id());

create policy "managers write supply requests"
  on public.supply_requests for all to authenticated
  using (public.is_manager() and host_id = public.current_host_id())
  with check (public.is_manager() and host_id = public.current_host_id());

-- Items are read by whoever reads the request: the subquery runs under the
-- caller's own policies on supply_requests.
create policy "items are read with their request"
  on public.supply_request_items for select to authenticated
  using (host_id = public.current_host_id()
         and exists (select 1 from public.supply_requests r
                     where r.id = supply_request_items.request_id));

create policy "managers write supply request items"
  on public.supply_request_items for all to authenticated
  using (public.is_manager() and host_id = public.current_host_id())
  with check (public.is_manager() and host_id = public.current_host_id());

-- ---------- the cleaner's side ----------

/**
 * Create a request, or rewrite one that is still 'new'. Replayable.
 *
 * p_items: [{"name": "…", "quantity": 2, "unit": "pcs", "comment": "…"}, …]
 * in the order they were entered. At least one item; each is checked and
 * the first bad one is named by its position.
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

    v_name := nullif(btrim(coalesce(v_item ->> 'name', '')), '');
    v_comment := nullif(btrim(coalesce(v_item ->> 'comment', '')), '');
    begin
      v_quantity := (v_item ->> 'quantity')::numeric;
      v_unit := coalesce(v_item ->> 'unit', 'pcs')::public.supply_unit;
    exception when others then
      raise exception 'Item % has a bad quantity or unit', v_index
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
      request_id, host_id, name, quantity, unit, comment, sort_order
    ) values (
      p_id, v_request.host_id, v_name, round(v_quantity, 2), v_unit, v_comment, v_index
    );
  end loop;

  return v_request;
end;
$$;

/** Withdraw a request nobody has picked up. Already gone counts as done. */
create or replace function public.delete_supply_request(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.supply_requests;
begin
  select r.* into v_request
  from public.supply_requests r
  where r.id = p_id
    and r.host_id = public.current_host_id()
    and r.requested_by = (select auth.uid())
  for update;
  if not found then
    return false;
  end if;
  if v_request.status <> 'new' then
    raise exception 'Supply request is % and can no longer be withdrawn', v_request.status
      using errcode = 'check_violation', hint = 'serverErrors.supplyNotEditable';
  end if;

  delete from public.supply_requests r where r.id = p_id;
  return true;
end;
$$;

-- ---------- the manager's side (the web panel of F10; tested here) ----------

/**
 * Move a request along: new → accepted → ordered → fulfilled, or reject it
 * from any live state with a reason. Repeating the current status is a no-op.
 */
create or replace function public.review_supply_request(
  p_id            uuid,
  p_status        public.supply_request_status,
  p_reject_reason text default null
)
returns public.supply_requests
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.supply_requests;
  v_allowed boolean;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select r.* into v_request
  from public.supply_requests r
  where r.id = p_id and r.host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Supply request not found'
      using errcode = 'check_violation', hint = 'serverErrors.supplyNotFound';
  end if;

  if v_request.status = p_status then
    return v_request;
  end if;

  v_allowed := (v_request.status = 'new' and p_status = 'accepted')
            or (v_request.status = 'accepted' and p_status = 'ordered')
            or (v_request.status in ('accepted', 'ordered') and p_status = 'fulfilled')
            or (v_request.status in ('new', 'accepted', 'ordered') and p_status = 'rejected');
  if not v_allowed then
    raise exception 'Supply request cannot go from % to %', v_request.status, p_status
      using errcode = 'check_violation',
            hint = 'serverErrors.supplyTransitionInvalid',
            detail = jsonb_build_object('from', v_request.status, 'to', p_status)::text;
  end if;

  if p_status = 'rejected' and nullif(btrim(coalesce(p_reject_reason, '')), '') is null then
    raise exception 'A rejection needs a reason'
      using errcode = 'check_violation', hint = 'serverErrors.reasonRequired';
  end if;

  update public.supply_requests r
  set status        = p_status,
      reviewed_by   = coalesce(r.reviewed_by, (select auth.uid())),
      reviewed_at   = coalesce(r.reviewed_at, now()),
      fulfilled_at  = case when p_status = 'fulfilled' then now() else r.fulfilled_at end,
      reject_reason = case when p_status = 'rejected' then btrim(p_reject_reason) else r.reject_reason end
  where r.id = p_id
  returning * into v_request;

  return v_request;
end;
$$;

revoke all on function public.save_supply_request(uuid, jsonb, public.supply_priority, text, date, bigint, uuid)
  from public, anon;
revoke all on function public.delete_supply_request(uuid) from public, anon;
revoke all on function public.review_supply_request(uuid, public.supply_request_status, text)
  from public, anon;
grant execute on function public.save_supply_request(uuid, jsonb, public.supply_priority, text, date, bigint, uuid)
  to authenticated, service_role;
grant execute on function public.delete_supply_request(uuid) to authenticated, service_role;
grant execute on function public.review_supply_request(uuid, public.supply_request_status, text)
  to authenticated, service_role;
