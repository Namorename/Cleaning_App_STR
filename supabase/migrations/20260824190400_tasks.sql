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
  -- Исполнитель обязателен только в рабочих статусах.
  -- 'done' в списке исключений намеренно: удаление пользователя каскадом
  -- обнуляет assignee_id, и без этого послабления любого сотрудника с хотя бы
  -- одной выполненной задачей стало бы невозможно удалить.
  constraint tasks_assigned_has_assignee
    check (status in ('unassigned', 'cancelled', 'done') or assignee_id is not null)
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

-- Исполнитель ведёт ход работ, но не переписывает саму постановку задачи.
-- Политика проверяет только владение; какие колонки разрешено менять —
-- решается здесь. Иначе клинер сдвинул бы scheduled_date, чтобы исчезнуть
-- из дневной очереди менеджера, или проставил completed_at, ни разу не начав
-- работу, испортив статистику F12.
create or replace function public.guard_task_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Серверный контекст (service_role, генератор задач) не ограничиваем.
  if (select auth.uid()) is null then
    return new;
  end if;

  if not public.is_manager() then
    -- assignee_id намеренно НЕ откатывается здесь: смену владельца ловит
    -- WITH CHECK политики и отдаёт явную ошибку. Молчаливый откат здесь
    -- перехватил бы её до проверки, и клиент считал бы передачу успешной.
    new.property_id    := old.property_id;
    new.reservation_id := old.reservation_id;
    new.type           := old.type;
    new.priority       := old.priority;
    new.scheduled_date := old.scheduled_date;
    new.due_at         := old.due_at;
  end if;

  return new;
end;
$$;

create trigger tasks_guard_fields
  before update on public.tasks
  for each row execute function public.guard_task_fields();

-- RLS фильтрует строки, но базовую привилегию нужно выдать явно.
-- service_role обходит RLS, однако привилегии ему тоже необходимы:
-- на нём работает генератор задач из вебхуков Hostaway.
grant select, insert, update, delete on public.tasks to authenticated, service_role;

alter table public.tasks enable row level security;

create policy "assignee reads own tasks"
  on public.tasks for select
  to authenticated
  using (assignee_id = (select auth.uid()) and public.is_active_user());

-- Исполнитель двигает статус и время своей задачи.
-- Переназначить её он не может: assignee_id обязан остаться собой (политика),
-- а прочие поля постановки откатывает триггер guard_task_fields.
create policy "assignee updates own tasks"
  on public.tasks for update
  to authenticated
  using (assignee_id = (select auth.uid()) and public.is_active_user())
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
