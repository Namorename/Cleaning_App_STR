-- Мультитенантность, фаза A: колонка тенанта и форма политик.
--
-- Приложение строится для одной компании. Продажа сторонним УК рассматривается
-- позже, и машинерия SaaS — пер-тенантные ключи PMS, онбординг, админ-панель
-- платформы — ждёт того решения. Здесь делается только то, что дорожает от
-- ожидания: колонка `host_id` в каждой операционной таблице и предикат тенанта
-- в каждой политике.
--
-- Почему сейчас. Стоимость этой миграции определяется числом политик, а не
-- числом строк: их семнадцать, и каждая новая таблица F6-F9 унаследует форму.
-- Через две волны политик будет вчетверо больше, и цена вырастет ровно во
-- столько же раз.
--
-- ВНИМАНИЕ — ЧЕГО ЗДЕСЬ НЕТ, И ПОЧЕМУ ЭТО НЕ «МУЛЬТИТЕНАНТНОСТЬ ГОТОВА»
--
-- Первичные ключи объектов и броней — это идентификаторы листингов и броней
-- Hostaway. Они уникальны внутри одного аккаунта Hostaway, но НЕ между
-- аккаунтами: у двух разных компаний листинги могут иметь одинаковые id, и
-- тогда `properties.id = 495979` будет означать разные квартиры. Пока аккаунт
-- Hostaway ровно один, столкновение физически невозможно, и этой миграции
-- достаточно.
--
-- Второй тенант с собственным аккаунтом Hostaway ДО фазы B приведёт к тихой
-- порче данных: синхронизация перезапишет чужую квартиру, а не заведёт свою.
-- Фаза B — суррогатные ключи и `unique (host_id, external_id)` — обязательна
-- перед подключением второго аккаунта, а не после.

create table public.hosts (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.hosts is
  'Компания-тенант. Пока ровно одна; см. предупреждение в 20260905094000 о ключах Hostaway.';

create trigger hosts_touch
  before update on public.hosts
  for each row execute function public.touch_updated_at();

insert into public.hosts (name) values ('Primary host');

/**
 * Тенант по умолчанию.
 *
 * Костыль фазы A и ничего больше: пока компания одна, «тенант по умолчанию» —
 * это она. Функция стоит значением по умолчанию у колонок `host_id`, поэтому
 * ни один существующий путь записи — генератор задач, синхронизация листингов
 * и броней, триггер профиля — не пришлось переписывать.
 *
 * В фазе B умолчание убирается, и каждый путь записи обязан назвать тенант
 * явно. Пока этого не произошло, новая строка молча попадает в первую
 * компанию, и это правильный ответ ровно до второго тенанта.
 */
create or replace function public.default_host_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select h.id from public.hosts h order by h.created_at, h.id limit 1
$$;

revoke all on function public.default_host_id() from public, anon;
grant execute on function public.default_host_id() to authenticated, service_role;

-- ---------- колонка ----------

alter table public.profiles
  add column host_id uuid not null default public.default_host_id()
    references public.hosts(id) on delete restrict;

alter table public.properties
  add column host_id uuid not null default public.default_host_id()
    references public.hosts(id) on delete restrict;

alter table public.reservations
  add column host_id uuid not null default public.default_host_id()
    references public.hosts(id) on delete restrict;

alter table public.tasks
  add column host_id uuid not null default public.default_host_id()
    references public.hosts(id) on delete restrict;

alter table public.property_cleaners
  add column host_id uuid not null default public.default_host_id()
    references public.hosts(id) on delete restrict;

-- Тенант стоит первым в каждом индексе, потому что первым стоит в каждом
-- запросе: любая выборка начинается с «в моей компании».
create index profiles_host_idx          on public.profiles (host_id);
create index properties_host_idx        on public.properties (host_id);
create index reservations_host_idx      on public.reservations (host_id);
create index tasks_host_idx             on public.tasks (host_id, scheduled_date);
create index property_cleaners_host_idx on public.property_cleaners (host_id);

-- Объявляется после колонки: тело language sql проверяется при создании,
-- поэтому profiles.host_id к этому моменту обязан существовать.
/**
 * Тенант текущего пользователя.
 *
 * security definer, потому что её вызывают политики на самой `profiles`:
 * обычный запрос упёрся бы в RLS той же таблицы и ушёл в рекурсию.
 * Деактивированный сотрудник тенанта не имеет — как и роли (см. auth_role).
 */
create or replace function public.current_host_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.host_id from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;

revoke all on function public.default_host_id() from public, anon;
revoke all on function public.current_host_id() from public, anon;
grant execute on function public.default_host_id() to authenticated, service_role;
grant execute on function public.current_host_id() to authenticated, service_role;

-- ---------- доступ к самой таблице тенантов ----------

grant select on public.hosts to authenticated;
grant select, insert, update, delete on public.hosts to service_role;
revoke all on public.hosts from anon;

alter table public.hosts enable row level security;

create policy "staff read own host"
  on public.hosts for select
  to authenticated
  using (id = public.current_host_id());

-- ---------- политики ----------
--
-- Каждая политика получает предикат тенанта. Исключение — две политики на
-- `profiles`, ограниченные собственным uid: строка, найденная по своему же
-- идентификатору, по определению лежит в своём тенанте, а лишний вызов
-- current_host_id() отобрал бы у деактивированного сотрудника доступ к
-- собственному профилю — поведение, менять которое эта миграция не бралась.

drop policy "managers read all profiles" on public.profiles;
create policy "managers read all profiles"
  on public.profiles for select
  to authenticated
  using (public.is_manager() and host_id = public.current_host_id());

drop policy "managers manage profiles" on public.profiles;
create policy "managers manage profiles"
  on public.profiles for all
  to authenticated
  using (public.is_manager() and host_id = public.current_host_id())
  with check (public.is_manager() and host_id = public.current_host_id());

drop policy "active staff read properties" on public.properties;
create policy "active staff read properties"
  on public.properties for select
  to authenticated
  using (public.is_active_user() and host_id = public.current_host_id());

drop policy "managers write properties" on public.properties;
create policy "managers write properties"
  on public.properties for all
  to authenticated
  using (public.is_manager() and host_id = public.current_host_id())
  with check (public.is_manager() and host_id = public.current_host_id());

drop policy "managers read reservations" on public.reservations;
create policy "managers read reservations"
  on public.reservations for select
  to authenticated
  using (public.is_manager() and host_id = public.current_host_id());

drop policy "managers write reservations" on public.reservations;
create policy "managers write reservations"
  on public.reservations for all
  to authenticated
  using (public.is_manager() and host_id = public.current_host_id())
  with check (public.is_manager() and host_id = public.current_host_id());

drop policy "cleaner reads own links" on public.property_cleaners;
create policy "cleaner reads own links"
  on public.property_cleaners for select
  to authenticated
  using (cleaner_id = (select auth.uid())
         and host_id = public.current_host_id()
         and public.is_active_user());

drop policy "managers read all links" on public.property_cleaners;
create policy "managers read all links"
  on public.property_cleaners for select
  to authenticated
  using (public.is_manager() and host_id = public.current_host_id());

drop policy "managers write links" on public.property_cleaners;
create policy "managers write links"
  on public.property_cleaners for all
  to authenticated
  using (public.is_manager() and host_id = public.current_host_id())
  with check (public.is_manager() and host_id = public.current_host_id());

drop policy "assignee reads own tasks" on public.tasks;
create policy "assignee reads own tasks"
  on public.tasks for select
  to authenticated
  using (assignee_id = (select auth.uid())
         and host_id = public.current_host_id()
         and not public.task_is_beyond_horizon(property_id, scheduled_date)
         and public.is_active_user());

drop policy "cleaner reads tasks of her listings" on public.tasks;
create policy "cleaner reads tasks of her listings"
  on public.tasks for select
  to authenticated
  using (public.cleans_property(property_id)
         and host_id = public.current_host_id()
         and not public.task_is_beyond_horizon(property_id, scheduled_date)
         and public.is_active_user());

drop policy "assignee updates own tasks" on public.tasks;
create policy "assignee updates own tasks"
  on public.tasks for update
  to authenticated
  using (assignee_id = (select auth.uid())
         and host_id = public.current_host_id()
         and not public.task_is_beyond_horizon(property_id, scheduled_date)
         and public.is_active_user())
  with check (assignee_id = (select auth.uid())
              and host_id = public.current_host_id());

drop policy "cleaner claims a free task on her listings" on public.tasks;
create policy "cleaner claims a free task on her listings"
  on public.tasks for update
  to authenticated
  using (assignee_id is null
         and status = 'unassigned'
         and host_id = public.current_host_id()
         and not public.task_is_stale(property_id, scheduled_date)
         and not public.task_is_beyond_horizon(property_id, scheduled_date)
         and public.cleans_property(property_id)
         and public.is_active_user())
  with check (assignee_id = (select auth.uid())
              and status = 'assigned'
              and host_id = public.current_host_id());

drop policy "managers read all tasks" on public.tasks;
create policy "managers read all tasks"
  on public.tasks for select
  to authenticated
  using (public.is_manager() and host_id = public.current_host_id());

drop policy "managers write tasks" on public.tasks;
create policy "managers write tasks"
  on public.tasks for all
  to authenticated
  using (public.is_manager() and host_id = public.current_host_id())
  with check (public.is_manager() and host_id = public.current_host_id());
