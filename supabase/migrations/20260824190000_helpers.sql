-- Базовые расширения, служебные функции и роли.

create extension if not exists "pgcrypto";

-- Сырой слой: данные Hostaway как есть. Схема НЕ выставляется через PostgREST —
-- доступ только у Edge Functions по service_role.
create schema if not exists raw;
revoke all on schema raw from anon, authenticated;
grant usage on schema raw to service_role;
alter default privileges in schema raw
  grant all on tables to service_role;

-- Роли пользователей приложения.
create type public.app_role as enum ('cleaner', 'tech', 'manager', 'admin');

-- Автообновление updated_at.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
