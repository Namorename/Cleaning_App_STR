-- Профили пользователей. Расширяет auth.users прикладными полями.

create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  phone       text,
  role        public.app_role not null default 'cleaner',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role) where is_active;

-- Функции ролей объявлены ПОСЛЕ profiles: тело language sql проверяется
-- при создании, поэтому таблица к этому моменту должна существовать.

-- Роль текущего пользователя.
-- SECURITY DEFINER обходит RLS на profiles — иначе политики, читающие profiles,
-- рекурсивно вызывали бы сами себя.
-- Деактивированный сотрудник роли не имеет: уволенный клинер не должен
-- сохранять доступ до истечения токена.
create or replace function public.auth_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles
  where id = (select auth.uid()) and is_active
$$;

-- Активен ли текущий пользователь. Используется в политиках операционных
-- таблиц: снятие галочки is_active обязано немедленно закрывать доступ.
create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and is_active
  )
$$;

-- Менеджер или админ: полный доступ к операционным данным.
create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.auth_role() in ('manager', 'admin')
$$;

create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Профиль создаётся автоматически при регистрации.
--
-- Роль читается из raw_app_meta_data, а НЕ из raw_user_meta_data:
-- user_metadata заполняется клиентом дословно из options.data при signup,
-- поэтому {"data":{"role":"admin"}} выдал бы себе админа. app_metadata
-- пишется только сервером через Admin API — туда её кладёт инвайт-флоу.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(
      -- Неизвестное значение не должно ронять регистрацию:
      -- откатываемся на самую ограниченную роль.
      (select r from unnest(enum_range(null::public.app_role)) r
        where r::text = new.raw_app_meta_data ->> 'role'),
      'cleaner'
    )
  )
  -- Профиль мог быть создан заранее (инвайт из панели менеджера).
  -- Без on conflict GoTrue вернул бы непрозрачную 500-ю ошибку.
  on conflict (id) do update
    set full_name = coalesce(excluded.full_name, public.profiles.full_name);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Привилегированные поля правит только менеджер.
-- Клинер может менять имя и телефон, но его role и is_active молча
-- возвращаются к прежним значениям — иначе он повысил бы себя до админа.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Серверный контекст (service_role, миграции, Edge Functions) не ограничиваем.
  if (select auth.uid()) is null then
    return new;
  end if;

  if not public.is_manager() then
    new.role := old.role;
    new.is_active := old.is_active;
  end if;

  return new;
end;
$$;

create trigger profiles_guard_privileges
  before update on public.profiles
  for each row execute function public.guard_profile_privileges();

-- RLS фильтрует строки, но базовую привилегию нужно выдать явно:
-- без GRANT политики недостижимы и запрос падает с permission denied.
-- service_role обходит RLS, но привилегии ему тоже нужны — на нём работают
-- все Edge Functions (синхронизация Hostaway, генератор задач).
grant select, insert, update, delete on public.profiles to authenticated, service_role;

alter table public.profiles enable row level security;

create policy "read own profile"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "managers read all profiles"
  on public.profiles for select
  to authenticated
  using (public.is_manager());

-- Владение проверяет политика, неприкосновенность role/is_active — триггер выше.
-- Подзапрос к profiles внутри политики НА profiles дал бы бесконечную рекурсию.
create policy "update own profile"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "managers manage profiles"
  on public.profiles for all
  to authenticated
  using (public.is_manager())
  with check (public.is_manager());
