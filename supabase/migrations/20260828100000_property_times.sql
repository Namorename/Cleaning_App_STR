-- Check-in and check-out times per property.
--
-- The cleaning task generator needs a real deadline. Hostaway carries these
-- in the listing payload as whole hours: checkOutTime = 10, checkInTimeStart
-- = 15 across all 78 listings in this account. That is a five-hour window on
-- a same-day turnover, and it is the number the deadline must come from —
-- not an invented default.
--
-- Stored as `time` rather than an integer hour: Hostaway happens to use whole
-- hours today, but a 10:30 checkout is an ordinary thing to configure later.

alter table public.properties
  add column check_in_time  time,
  add column check_out_time time;

comment on column public.properties.check_in_time is
  'Earliest guest arrival, local to the property. Cleaning must finish by then.';
comment on column public.properties.check_out_time is
  'Guest departure time, local to the property. Cleaning can start from then.';

-- Carry the two new columns through the listing sync.
-- is_active stays absent from the update list for the same reason as before:
-- Hostaway does not report it, and overwriting would undo a manual
-- deactivation in the manager panel.
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
      timezone, bedrooms, bathrooms, max_guests,
      check_in_time, check_out_time, synced_at
    )
    select p.id, p.name, p.address, p.city, p.country_code,
           p.timezone, p.bedrooms, p.bathrooms, p.max_guests,
           p.check_in_time, p.check_out_time, p.synced_at
    from jsonb_to_recordset(property_rows)
      as p(
        id bigint, name text, address text, city text, country_code text,
        timezone text, bedrooms smallint, bathrooms numeric(3,1),
        max_guests smallint, check_in_time time, check_out_time time,
        synced_at timestamptz
      )
    on conflict (id) do update
      set name           = excluded.name,
          address        = excluded.address,
          city           = excluded.city,
          country_code   = excluded.country_code,
          timezone       = excluded.timezone,
          bedrooms       = excluded.bedrooms,
          bathrooms      = excluded.bathrooms,
          max_guests     = excluded.max_guests,
          check_in_time  = excluded.check_in_time,
          check_out_time = excluded.check_out_time,
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
    'properties_inserted', v_inserted,
    'properties_updated', v_updated
  );
end;
$$;

revoke all on function public.sync_hostaway_listings(jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.sync_hostaway_listings(jsonb, jsonb) to service_role;

-- Backfill from the raw layer so the generator has deadlines before the next
-- listing sync runs.
update public.properties p
set check_in_time = case
      when r.data ->> 'checkInTimeStart' ~ '^[0-9]{1,2}$'
      then make_time((r.data ->> 'checkInTimeStart')::int, 0, 0)
    end,
    check_out_time = case
      when r.data ->> 'checkOutTime' ~ '^[0-9]{1,2}$'
      then make_time((r.data ->> 'checkOutTime')::int, 0, 0)
    end
from raw.hostaway_listings r
where r.id = p.id;
