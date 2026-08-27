-- Журнал входящих вебхуков Hostaway.
--
-- Документация Hostaway прямо предупреждает: система не фильтрует события,
-- об одном и том же изменении может прийти несколько уведомлений, и обработчик
-- обязан это переживать. Отвечать при этом нужно за 20 секунд, иначе доставка
-- считается неудачной. Отсюда схема «принять и отложить»: функция пишет событие
-- сюда, отвечает 200 и завершается, а разбор идёт отдельно.
--
-- Журнал лежит в raw, а не в public: тело вебхука содержит имена гостей,
-- а схема raw не выставлена через PostgREST и доступна только service_role.

create type raw.webhook_event_status as enum (
  'pending',    -- принято, ждёт разбора
  'processed',  -- разобрано успешно
  'skipped',    -- событие известного, но не интересного нам типа
  'failed'      -- разбор не удался, см. last_error
);

create table raw.webhook_events (
  id           bigint generated always as identity primary key,
  source       text not null default 'hostaway',
  -- Поля из тела уведомления. Оставлены nullable: Hostaway обещает добавлять
  -- новые события, а неизвестное уведомление всё равно нужно сохранить
  -- целиком, чтобы потом разобраться.
  object_type  text,
  object_id    bigint,
  event_type   text,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  status       raw.webhook_event_status not null default 'pending',
  attempts     smallint not null default 0,
  last_error   text
);

-- Очередь разбора: берём необработанные в порядке поступления.
create index webhook_events_pending_idx
  on raw.webhook_events (received_at)
  where status = 'pending';

-- Дубликаты не отсеиваем на приёме: у уведомления нет собственного
-- идентификатора, а терять событие страшнее, чем разобрать его дважды.
-- Схлопывание происходит при разборе — по object_id берётся актуальное
-- состояние из API, поэтому повтор безвреден.
create index webhook_events_object_idx
  on raw.webhook_events (object_type, object_id, received_at desc);

/**
 * Приём одного уведомления.
 *
 * Возвращает идентификатор записи, чтобы обработчик мог сослаться на неё
 * в журналах. Пишет в закрытую схему, поэтому SECURITY DEFINER.
 */
create or replace function public.record_webhook_event(
  event_payload jsonb,
  event_source  text default 'hostaway'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  insert into raw.webhook_events (source, object_type, object_id, event_type, payload)
  values (
    event_source,
    nullif(event_payload ->> 'object', ''),
    -- objectId может прийти строкой или отсутствовать вовсе.
    (nullif(event_payload ->> 'objectId', ''))::bigint,
    nullif(event_payload ->> 'event', ''),
    event_payload
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.record_webhook_event(jsonb, text) from public, anon, authenticated;
grant execute on function public.record_webhook_event(jsonb, text) to service_role;
