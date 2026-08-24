-- Брони. Источник — reservations из Hostaway (вебхуки + суточная сверка).

create table raw.hostaway_reservations (
  id         bigint primary key,
  data       jsonb not null,
  synced_at  timestamptz not null default now()
);

create table public.reservations (
  id              bigint primary key,        -- id резервации в Hostaway
  property_id     bigint not null references public.properties(id) on delete cascade,
  -- Семантика Hostaway: arrival включительно, departure исключительно.
  -- Ночей в брони = departure_date - arrival_date.
  arrival_date    date not null,
  departure_date  date not null,
  status          text not null,
  channel_id      integer,
  guest_name      text,
  guests_count    smallint,
  -- Внутренние блокировки (например "NY Block", channel_id = 2000) закрывают
  -- календарь, но гостя нет — уборка после них не нужна.
  is_block        boolean not null default false,
  synced_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Зеркало чужого фида: Hostaway отдаёт нулевые интервалы для части блоков
  -- и хозяйских заездов. Строгое > роняло бы весь батч синхронизации из-за
  -- одной записи, поэтому допускаем равенство и отсеиваем такие брони в F4.
  constraint reservations_dates_ordered check (departure_date >= arrival_date)
);

-- Основной запрос генератора задач: «кто выезжает в этот день».
create index reservations_departure_idx
  on public.reservations (departure_date, property_id)
  where not is_block;

create index reservations_property_arrival_idx
  on public.reservations (property_id, arrival_date);

create trigger reservations_touch
  before update on public.reservations
  for each row execute function public.touch_updated_at();

-- RLS фильтрует строки, но базовую привилегию нужно выдать явно:
-- без GRANT политики недостижимы и запрос падает с permission denied.
grant select, insert, update, delete on public.reservations to authenticated, service_role;

alter table public.reservations enable row level security;

-- Брони содержат имена гостей. Исполнителям они не нужны: всё необходимое
-- переносится в задачу. Поэтому прямой доступ — только у менеджеров.
create policy "managers read reservations"
  on public.reservations for select
  to authenticated
  using (public.is_manager());

create policy "managers write reservations"
  on public.reservations for all
  to authenticated
  using (public.is_manager())
  with check (public.is_manager());
