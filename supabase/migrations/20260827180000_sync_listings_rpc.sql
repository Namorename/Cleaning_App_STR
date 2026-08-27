-- Приём выгрузки объектов из Hostaway одной транзакцией.
--
-- Зачем RPC, а не обычный upsert через PostgREST: схема raw намеренно не
-- выставлена наружу, и открывать её ради синхронизации значило бы расширять
-- поверхность API. SECURITY DEFINER позволяет функции писать в raw, оставив
-- саму схему закрытой.
--
-- Побочная выгода: сырой слой и нормализованный обновляются атомарно —
-- расхождения между ними невозможны даже при обрыве на середине.

create or replace function public.sync_hostaway_listings(
  raw_rows      jsonb,
  property_rows jsonb
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
begin
  with incoming as (
    insert into raw.hostaway_listings (id, data, synced_at)
    select r.id, r.data, r.synced_at
    from jsonb_to_recordset(raw_rows)
      as r(id bigint, data jsonb, synced_at timestamptz)
    on conflict (id) do update
      set data = excluded.data,
          synced_at = excluded.synced_at
    returning 1
  )
  select count(*) into v_raw from incoming;

  with upserted as (
    insert into public.properties (
      id, name, address, city, country_code,
      timezone, bedrooms, bathrooms, max_guests, synced_at
    )
    select p.id, p.name, p.address, p.city, p.country_code,
           p.timezone, p.bedrooms, p.bathrooms, p.max_guests, p.synced_at
    from jsonb_to_recordset(property_rows)
      as p(
        id bigint, name text, address text, city text, country_code text,
        timezone text, bedrooms smallint, bathrooms numeric(3,1),
        max_guests smallint, synced_at timestamptz
      )
    on conflict (id) do update
      set name         = excluded.name,
          address      = excluded.address,
          city         = excluded.city,
          country_code = excluded.country_code,
          timezone     = excluded.timezone,
          bedrooms     = excluded.bedrooms,
          bathrooms    = excluded.bathrooms,
          max_guests   = excluded.max_guests,
          synced_at    = excluded.synced_at
      -- is_active сознательно отсутствует: Hostaway такого поля не отдаёт,
      -- а перезапись затирала бы ручную деактивацию объекта в панели.
    returning (xmax = 0) as was_inserted
  )
  select
    count(*) filter (where was_inserted),
    count(*) filter (where not was_inserted)
  into v_inserted, v_updated
  from upserted;

  return jsonb_build_object(
    'raw_upserted', v_raw,
    'properties_inserted', v_inserted,
    'properties_updated', v_updated
  );
end;
$$;

-- Функция пишет в закрытую схему, поэтому доступна только серверной роли.
revoke all on function public.sync_hostaway_listings(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sync_hostaway_listings(jsonb, jsonb) to service_role;
