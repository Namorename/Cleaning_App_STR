-- Задачи: уборки, обслуживание, инспекции.

create type public.task_type as enum ('cleaning', 'maintenance', 'inspection');

create type public.task_status as enum (
  'unassigned', 'assigned', 'accepted', 'in_progress',
  'paused', 'blocked', 'done', 'cancelled'
);

create table public.tasks (
  id              uuid primary key default gen_random_uuid(),
  property_id     bigint not null references public.properties(id) on delete cascade,
  -- Задача может быть ручной (deep clean, инспекция) — тогда брони нет.
  reservation_id  bigint references public.reservations(id) on delete set null,
  type            public.task_type   not null,
  status          public.task_status not null default 'unassigned',
  -- 0 — обычная, выше — срочнее. Same-day turnover получает повышенный приоритет.
  priority        smallint not null default 0,
  assignee_id     uuid references public.profiles(id) on delete set null,
  scheduled_date  date not null,
  due_at          timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- Исполнитель обязателен во всех рабочих статусах.
  -- Исключения: ещё не назначена и уже отменена.
  constraint tasks_assigned_has_assignee
    check (status in ('unassigned', 'cancelled') or assignee_id is not null)
);

-- Главный экран клинера: «мои задачи на сегодня».
create index tasks_assignee_date_idx on public.tasks (assignee_id, scheduled_date)
  where status not in ('done', 'cancelled');

-- Очередь неназначенных в панели менеджера.
create index tasks_unassigned_idx on public.tasks (scheduled_date)
  where status = 'unassigned';

create index tasks_property_idx on public.tasks (property_id, scheduled_date);

-- Идемпотентность генератора: одна автоматическая уборка на бронь.
-- Повторный вебхук или суточная сверка не создадут дубль.
create unique index tasks_one_cleaning_per_reservation
  on public.tasks (reservation_id)
  where type = 'cleaning' and reservation_id is not null
        and status <> 'cancelled';

create trigger tasks_touch
  before update on public.tasks
  for each row execute function public.touch_updated_at();

-- RLS фильтрует строки, но базовую привилегию нужно выдать явно:
-- без GRANT политики недостижимы и запрос падает с permission denied.
grant select, insert, update, delete on public.tasks to authenticated;

alter table public.tasks enable row level security;

create policy "assignee reads own tasks"
  on public.tasks for select
  to authenticated
  using (assignee_id = (select auth.uid()));

-- Исполнитель двигает статус и время своей задачи.
-- Переназначить её себе или другому он не может: assignee_id обязан остаться собой.
create policy "assignee updates own tasks"
  on public.tasks for update
  to authenticated
  using (assignee_id = (select auth.uid()))
  with check (assignee_id = (select auth.uid()));

create policy "managers read all tasks"
  on public.tasks for select
  to authenticated
  using (public.is_manager());

create policy "managers write tasks"
  on public.tasks for all
  to authenticated
  using (public.is_manager())
  with check (public.is_manager());
