-- A person's own order of the board tabs above «Задания» in the panel (owner, 2026-11-26, CORE;
-- docs/manager-boards.md «Личный порядок вкладок»).
--
-- The tabs — «Задания техников», «Назначено мне», the manager boards the person sees — are dragged
-- into the order she likes, and the order follows her account to another computer and browser.
-- One row a person: her tabs in her order, by id ('tech' for the technicians' board, 'mine' for
-- «Назначено мне», a board's uuid). The panel applies it to the tabs she has now: a tab the order
-- does not name goes last, an id that is no tab of hers any more is passed over. No row: the tabs
-- stand as they always did.
--
-- Additive only: a new table and two new functions. Nothing that exists changes, and no older
-- client reads or writes any of it.
--
-- Who may: a person reads and writes her own row and no other (RLS on auth.uid(), only while her
-- account is active, only in her company). save_board_tab_order is SECURITY INVOKER — the same rule
-- holds for it as for a write straight into the table; it only saves the client the upsert.

create function public.board_tab_ids_valid(p_ids text[])
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_ids is not null
     and coalesce(array_ndims(p_ids), 1) = 1
     and coalesce(cardinality(p_ids), 0) <= 200
     and array_position(p_ids, null) is null
     and coalesce((select bool_and(x ~ '^(tech|mine|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$')
                   from unnest(p_ids) x), true)
     and (select count(distinct x) = count(*) from unnest(p_ids) x)
$$;

comment on function public.board_tab_ids_valid(text[]) is
  'A list of board tabs: ''tech'', ''mine'' or a lower-case uuid, each once, at most 200.';

revoke all on function public.board_tab_ids_valid(text[]) from public, anon;
-- A CHECK calls it as the writer: the person writing her row must be able to run it.
grant execute on function public.board_tab_ids_valid(text[]) to authenticated, service_role;

create table public.board_tab_orders (
  profile_id  uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  host_id     uuid not null default public.current_host_id() references public.hosts (id),
  tab_ids     text[] not null default '{}',
  updated_at  timestamptz not null default now(),
  constraint board_tab_orders_ids_valid check (public.board_tab_ids_valid(tab_ids))
);

comment on table public.board_tab_orders is
  'A person''s own order of the board tabs in the panel, by tab id. No row: the default order. '
  'Read and written by the person herself only (RLS).';

create trigger board_tab_orders_touch
  before update on public.board_tab_orders
  for each row execute function public.touch_updated_at();

alter table public.board_tab_orders enable row level security;
revoke all on public.board_tab_orders from public, anon, authenticated;
grant select, insert, update on public.board_tab_orders to authenticated;

create policy "person reads own board tab order"
  on public.board_tab_orders
  for select
  to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()));

create policy "person adds own board tab order"
  on public.board_tab_orders
  for insert
  to authenticated
  with check (profile_id = (select auth.uid()) and host_id = (select public.current_host_id()));

create policy "person changes own board tab order"
  on public.board_tab_orders
  for update
  to authenticated
  using (profile_id = (select auth.uid()) and (select public.is_active_user()))
  with check (profile_id = (select auth.uid()) and host_id = (select public.current_host_id()));

create function public.save_board_tab_order(p_tab_ids text[])
returns text[]
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids text[];
begin
  if not (select public.is_active_user()) then
    raise exception 'Only an active person keeps an order of board tabs'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.notSignedIn';
  end if;
  if not public.board_tab_ids_valid(p_tab_ids) then
    raise exception 'The board tab order is not a list of board tabs'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.boardTabOrderInvalid',
            detail = json_build_object('count', coalesce(cardinality(p_tab_ids), 0))::text;
  end if;

  insert into public.board_tab_orders as o (profile_id, host_id, tab_ids)
  values ((select auth.uid()), (select public.current_host_id()), p_tab_ids)
  -- The company too: a person moved to another company keeps one row, now of the new one.
  on conflict (profile_id) do update set tab_ids = excluded.tab_ids, host_id = excluded.host_id
  returning o.tab_ids into v_ids;

  return v_ids;
end;
$$;

comment on function public.save_board_tab_order(text[]) is
  'Saves the caller''s own order of the board tabs and answers it. SECURITY INVOKER: the table''s '
  'RLS decides, as for a write straight into it.';

revoke all on function public.save_board_tab_order(text[]) from public, anon;
grant execute on function public.save_board_tab_order(text[]) to authenticated, service_role;
