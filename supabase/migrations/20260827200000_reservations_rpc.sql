-- Приём броней и обслуживание журнала вебхуков.

/**
 * Запись выгрузки броней одной транзакцией.
 *
 * Отдельно обрабатывается случай, который иначе ломает всю синхронизацию:
 * бронь ссылается на объект, которого у нас ещё нет. Такое бывает, когда
 * в Hostaway завели новый листинг, а sync-listings ещё не отработал.
 * Внешний ключ отверг бы всю пачку, поэтому такие брони откладываются
 * и возвращаются в поле skipped_property_ids — вызывающий по нему поймёт,
 * что пора обновить объекты.
 */
create or replace function public.sync_hostaway_reservations(
  raw_rows         jsonb,
  reservation_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw      integer;
  v_inserted integer;
  v_updated  integer;
  v_skipped  bigint[];
begin
  with incoming as (
    insert into raw.hostaway_reservations (id, data, synced_at)
    select r.id, r.data, r.synced_at
    from jsonb_to_recordset(raw_rows)
      as r(id bigint, data jsonb, synced_at timestamptz)
    on conflict (id) do update
      set data = excluded.data,
          synced_at = excluded.synced_at
    returning 1
  )
  select count(*) into v_raw from incoming;

  -- Брони, чей объект нам неизвестен.
  select coalesce(array_agg(distinct r.property_id), '{}')
  into v_skipped
  from jsonb_to_recordset(reservation_rows) as r(property_id bigint)
  where not exists (select 1 from public.properties p where p.id = r.property_id);

  with upserted as (
    insert into public.reservations (
      id, property_id, arrival_date, departure_date, status,
      channel_id, guest_name, guests_count, total_price, is_block, synced_at
    )
    select r.id, r.property_id, r.arrival_date, r.departure_date, r.status,
           r.channel_id, r.guest_name, r.guests_count, r.total_price,
           r.is_block, r.synced_at
    from jsonb_to_recordset(reservation_rows)
      as r(
        id bigint, property_id bigint, arrival_date date, departure_date date,
        status text, channel_id integer, guest_name text, guests_count smallint,
        total_price numeric(12,2), is_block boolean, synced_at timestamptz
      )
    where exists (select 1 from public.properties p where p.id = r.property_id)
    on conflict (id) do update
      set property_id    = excluded.property_id,
          arrival_date   = excluded.arrival_date,
          departure_date = excluded.departure_date,
          status         = excluded.status,
          channel_id     = excluded.channel_id,
          guest_name     = excluded.guest_name,
          guests_count   = excluded.guests_count,
          total_price    = excluded.total_price,
          is_block       = excluded.is_block,
          synced_at      = excluded.synced_at
    returning (xmax = 0) as was_inserted
  )
  select
    count(*) filter (where was_inserted),
    count(*) filter (where not was_inserted)
  into v_inserted, v_updated
  from upserted;

  return jsonb_build_object(
    'raw_upserted', v_raw,
    'reservations_inserted', v_inserted,
    'reservations_updated', v_updated,
    'skipped_property_ids', to_jsonb(v_skipped)
  );
end;
$$;

/**
 * Забор пачки необработанных уведомлений.
 *
 * FOR UPDATE SKIP LOCKED позволяет запускать разбор параллельно: две копии
 * возьмут разные записи, а не подерутся за одни и те же.
 *
 * Счётчик попыток растёт сразу при заборе. Уведомление, которое роняет
 * обработчик раз за разом, после max_attempts помечается failed и перестаёт
 * забирать время у остальных — но остаётся в журнале для разбора руками.
 */
create or replace function public.claim_webhook_events(
  batch_size   integer default 50,
  max_attempts integer default 5
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events jsonb;
begin
  -- Отработавшие лимит попыток уводим из очереди.
  update raw.webhook_events
  set status = 'failed',
      processed_at = now(),
      last_error = coalesce(last_error, '') || ' | исчерпан лимит попыток'
  where status = 'pending' and attempts >= max_attempts;

  with claimed as (
    select id
    from raw.webhook_events
    where status = 'pending'
    order by received_at
    limit batch_size
    for update skip locked
  ),
  bumped as (
    update raw.webhook_events e
    set attempts = e.attempts + 1
    from claimed c
    where e.id = c.id
    returning e.id, e.object_type, e.object_id, e.event_type, e.attempts
  )
  select coalesce(jsonb_agg(to_jsonb(bumped) order by bumped.id), '[]'::jsonb)
  into v_events
  from bumped;

  return v_events;
end;
$$;

/** Отметка результата разбора. */
create or replace function public.mark_webhook_events(
  event_ids  bigint[],
  new_status text,
  error_text text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update raw.webhook_events
  set status = new_status::raw.webhook_event_status,
      processed_at = now(),
      last_error = error_text
  where id = any(event_ids);

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.sync_hostaway_reservations(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.claim_webhook_events(integer, integer) from public, anon, authenticated;
revoke all on function public.mark_webhook_events(bigint[], text, text) from public, anon, authenticated;

grant execute on function public.sync_hostaway_reservations(jsonb, jsonb) to service_role;
grant execute on function public.claim_webhook_events(integer, integer) to service_role;
grant execute on function public.mark_webhook_events(bigint[], text, text) to service_role;
