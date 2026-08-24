-- Объекты. Источник — listings из Hostaway.

-- Сырой JSON: схема Hostaway меняется без предупреждения, нормализацию
-- всегда можно переиграть из сохранённых данных.
create table raw.hostaway_listings (
  id         bigint primary key,
  data       jsonb not null,
  synced_at  timestamptz not null default now()
);

create table public.properties (
  id            bigint primary key,          -- id листинга в Hostaway
  name          text not null,
  address       text,
  city          text,
  country_code  text,
  -- Дедлайны уборок считаются в локальном времени объекта, не в UTC.
  timezone      text not null default 'UTC',
  bedrooms      smallint,
  bathrooms     numeric(3,1),
  max_guests    smallint,
  is_active     boolean not null default true,
  synced_at     timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger properties_touch
  before update on public.properties
  for each row execute function public.touch_updated_at();

-- Связанные листинги: комбинированный объект состоит из отдельных юнитов.
-- Пример из практики: 571441 = 566761 + 566769.
-- Без явного маппинга бронь на комбинированный объект порождает дубли задач.
create table public.property_links (
  parent_id   bigint not null references public.properties(id) on delete cascade,
  child_id    bigint not null references public.properties(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (parent_id, child_id),
  constraint property_links_no_self check (parent_id <> child_id)
);

create index property_links_child_idx on public.property_links (child_id);

-- RLS фильтрует строки, но базовую привилегию нужно выдать явно:
-- без GRANT политики недостижимы и запрос падает с permission denied.
grant select, insert, update, delete on public.properties to authenticated, service_role;
grant select, insert, update, delete on public.property_links to authenticated, service_role;

alter table public.properties     enable row level security;
alter table public.property_links enable row level security;

-- Адрес объекта нужен любому исполнителю, чтобы доехать.
create policy "active staff read properties"
  on public.properties for select
  to authenticated
  using (public.is_active_user());

create policy "managers write properties"
  on public.properties for all
  to authenticated
  using (public.is_manager())
  with check (public.is_manager());

create policy "active staff read property links"
  on public.property_links for select
  to authenticated
  using (public.is_active_user());

create policy "managers write property links"
  on public.property_links for all
  to authenticated
  using (public.is_manager())
  with check (public.is_manager());

-- Объект не может быть одновременно родителем и потомком: генератор задач в F4
-- разворачивает родителя в потомков, и на цикле A->B + B->A он зациклится
-- или выдаст задачу дважды.
create or replace function public.guard_property_link_cycles()
returns trigger
language plpgsql
as $$
begin
  if exists (select 1 from public.property_links where child_id = new.parent_id) then
    raise exception 'Объект % уже является потомком — родителем быть не может', new.parent_id;
  end if;
  if exists (select 1 from public.property_links where parent_id = new.child_id) then
    raise exception 'Объект % уже является родителем — потомком быть не может', new.child_id;
  end if;
  return new;
end;
$$;

create trigger property_links_guard_cycles
  before insert or update on public.property_links
  for each row execute function public.guard_property_link_cycles();
