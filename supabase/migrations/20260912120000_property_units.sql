-- Rooms inside one listing.
--
-- Hostaway has two different things that both look like "a listing made of
-- parts", and they must not be confused:
--
--   a combined listing  — several real listings that block each other. Each
--                         part has its own listing id and its own calendar.
--                         `parent_id` was added for this in 20260905093000.
--   a multi-unit listing — ONE listing holding an array of `listingUnits`.
--                         A unit is not a listing: it has no calendar of its
--                         own, and the account's nine such listings hold
--                         thirty-one rooms between them.
--
-- A room is cleaned on its own, so it has to be an object here. It becomes a
-- row in properties under `parent_id`, which buys the whole periphery for
-- free: the checklist already falls back to the parent
-- (20260907120000_property_checklists.sql:149), so does the process
-- (20260905110200_workflow_templates.sql:216), and every reader that filters
-- archived listings keeps working unchanged.
--
-- Why an id of its own shape. `properties.id` has always been the Hostaway
-- listing id, and Hostaway numbers units in a SEPARATE space: units run
-- 18007..64305 in this account, listings 98352..412520. They do not collide
-- today and nothing promises they never will — a unit id is shifted out of
-- the way instead of trusting the gap.

/**
 * The properties row id of a Hostaway listing unit.
 *
 * The single home of the shift. `sync_hostaway_listings` computes ids with it
 * rather than the Edge Function doing its own arithmetic, and the check
 * constraint below holds every row to the same rule.
 *
 * Changing the offset would leave existing rows failing a constraint Postgres
 * does not re-validate on REPLACE. It is not meant to change; a migration that
 * ever does has to rewrite the rows and revalidate the constraint by hand.
 */
create or replace function public.property_id_for_unit(p_unit_id bigint)
returns bigint
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 1000000000000 + p_unit_id
$$;

comment on function public.property_id_for_unit(bigint) is
  'The properties.id given to a Hostaway listingUnit, shifted clear of the listing id space.';

revoke all on function public.property_id_for_unit(bigint) from public, anon;
grant execute on function public.property_id_for_unit(bigint) to authenticated, service_role;

alter table public.properties
  add column hostaway_unit_id bigint;

comment on column public.properties.hostaway_unit_id is
  'The Hostaway listingUnit this row is. Null for a listing, set for a room inside one.';

-- A room always hangs under its listing. The converse is deliberately NOT
-- required: a combined listing's children carry parent_id and are listings in
-- their own right, so `parent_id is not null` must not come to mean "is a
-- room".
alter table public.properties
  add constraint properties_unit_has_parent
    check (hostaway_unit_id is null or parent_id is not null),
  add constraint properties_unit_id_is_derived
    check (hostaway_unit_id is null or id = public.property_id_for_unit(hostaway_unit_id));

-- ---------------------------------------------------------------------------
--  Units arrive with the listing sync
-- ---------------------------------------------------------------------------
--
-- `listingUnits` comes embedded in GET /v1/listings, so rooms cost no extra
-- request. The two-argument version is dropped rather than overloaded: a
-- default third argument would leave `sync_hostaway_listings(jsonb, jsonb)`
-- ambiguous at every call site.
--
-- The Edge Function sends the Hostaway unit number and this computes the row
-- id, so the shift lives in one place instead of being repeated in TypeScript.
--
-- What the sync deliberately does not write on a unit:
--   status                        — same reason `is_active` was never written:
--                                   Hostaway has no such field and the nightly
--                                   run would undo a manager taking one room
--                                   out of service.
--   bedrooms/bathrooms/max_guests — Hostaway reports these per LISTING only.
--                                   The parent's capacity is the capacity of
--                                   all its rooms together and is simply wrong
--                                   for one of them; empty is honest.
drop function if exists public.sync_hostaway_listings(jsonb, jsonb);

create or replace function public.sync_hostaway_listings(
  raw_rows      jsonb,
  property_rows jsonb,
  unit_rows     jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw       integer;
  v_inserted  integer;
  v_updated   integer;
  v_units_ins integer;
  v_units_upd integer;
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

  -- Rooms go in after their listings: the foreign key on parent_id needs the
  -- parent row to exist, and a listing new this run has only just arrived.
  with upserted_units as (
    insert into public.properties (
      id, hostaway_unit_id, parent_id, name,
      address, city, country_code, timezone,
      check_in_time, check_out_time, synced_at
    )
    select public.property_id_for_unit(u.hostaway_unit_id),
           u.hostaway_unit_id, u.parent_id, u.name,
           u.address, u.city, u.country_code, u.timezone,
           u.check_in_time, u.check_out_time, u.synced_at
    from jsonb_to_recordset(unit_rows)
      as u(
        hostaway_unit_id bigint, parent_id bigint, name text,
        address text, city text, country_code text, timezone text,
        check_in_time time, check_out_time time, synced_at timestamptz
      )
    on conflict (id) do update
      set parent_id      = excluded.parent_id,
          name           = excluded.name,
          address        = excluded.address,
          city           = excluded.city,
          country_code   = excluded.country_code,
          timezone       = excluded.timezone,
          check_in_time  = excluded.check_in_time,
          check_out_time = excluded.check_out_time,
          synced_at      = excluded.synced_at
    returning (xmax = 0) as was_inserted
  )
  select
    count(*) filter (where was_inserted),
    count(*) filter (where not was_inserted)
  into v_units_ins, v_units_upd
  from upserted_units;

  return jsonb_build_object(
    'raw_upserted', v_raw,
    'properties_inserted', v_inserted,
    'properties_updated', v_updated,
    'units_inserted', v_units_ins,
    'units_updated', v_units_upd
  );
end;
$$;

revoke all on function public.sync_hostaway_listings(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_hostaway_listings(jsonb, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
--  Taking a listing out of service takes its rooms with it
-- ---------------------------------------------------------------------------
--
-- A status written on a listing applies to every room inside it. Archiving a
-- building and leaving its rooms taking cleanings would be a trap, and so
-- would the reverse — putting it back and having to remember seven separate
-- presses. The same holds for `maintenance`: the generator only builds tasks
-- for an `active` property, and a listing under repair whose rooms kept
-- producing cleanings would say one thing and do another.
--
-- A status written on a ROOM stays on that room. One room under repair while
-- its neighbours keep letting is the ordinary case, and it is why a room has
-- a status of its own rather than reading the parent's.
--
-- The one combination refused is a room more alive than its listing: an
-- archived building has no working rooms, and the generator — which reads the
-- room's own status — would quietly start scheduling cleanings nobody can do.
--
-- `id = p or parent_id = p` covers both directions in one expression: a room
-- can never be a parent (guard_property_hierarchy), so on a room it matches
-- the room alone.
create or replace function public.set_property_status(
  p_property_id  bigint,
  p_status       public.property_status,
  p_cancel_tasks boolean default false
)
returns public.properties
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host     uuid := public.current_host_id();
  v_property public.properties;
  v_parent   public.property_status;
  v_open     integer;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may change a listing status'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select * into v_property
  from public.properties
  where id = p_property_id and host_id = v_host;

  if not found then
    raise exception 'Property % is not in this company', p_property_id
      using errcode = 'no_data_found', hint = 'serverErrors.propertyNotFound';
  end if;

  if v_property.parent_id is not null and p_status = 'active' then
    select status into v_parent
    from public.properties
    where id = v_property.parent_id and host_id = v_host;

    if v_parent is distinct from 'active' then
      raise exception 'Unit % cannot go back to work while listing % is not active',
        p_property_id, v_property.parent_id
        using errcode = 'check_violation',
              hint = 'serverErrors.unitParentNotActive',
              detail = json_build_object('parentId', v_property.parent_id)::text;
    end if;
  end if;

  -- Saying again what is already true is not a change, and must not sweep
  -- anything: the panel may send the same press twice on a slow connection.
  -- A listing whose rooms have drifted is still a change, so the rooms are
  -- part of the question.
  if v_property.status = p_status and not exists (
    select 1 from public.properties u
    where u.parent_id = p_property_id and u.host_id = v_host and u.status <> p_status
  ) then
    return v_property;
  end if;

  if p_status <> 'active' then
    -- Only cleanings nobody has started. `accepted` counts as started: she has
    -- said out loud that she is taking it.
    select count(*) into v_open
    from public.tasks t
    where (t.property_id = p_property_id or t.property_id in (
             select u.id from public.properties u where u.parent_id = p_property_id
           ))
      and t.host_id = v_host
      and t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned');

    if v_open > 0 and not coalesce(p_cancel_tasks, false) then
      raise exception 'Listing % still has % cleanings on the books', p_property_id, v_open
        using errcode = 'check_violation',
              hint = 'serverErrors.propertyHasOpenTasks',
              detail = json_build_object('total', v_open)::text;
    end if;

    update public.tasks
    set status = 'cancelled'
    where (property_id = p_property_id or property_id in (
             select u.id from public.properties u where u.parent_id = p_property_id
           ))
      and host_id = v_host
      and type = 'cleaning'
      and status in ('unassigned', 'assigned');
  end if;

  update public.properties
  set status = p_status
  where (id = p_property_id or parent_id = p_property_id)
    and host_id = v_host;

  select * into v_property
  from public.properties
  where id = p_property_id;

  return v_property;
end;
$$;

revoke all on function
  public.set_property_status(bigint, public.property_status, boolean)
  from public, anon;
grant execute on function
  public.set_property_status(bigint, public.property_status, boolean)
  to authenticated, service_role;

-- The figure the confirmation shows, now counting the rooms that would be
-- swept along with their listing.
create or replace function public.property_open_cleanings(p_property_id bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.tasks t
  where t.host_id = public.current_host_id()
    and t.type = 'cleaning'
    and t.status in ('unassigned', 'assigned')
    and (t.property_id = p_property_id
         or t.property_id in (select u.id
                              from public.properties u
                              where u.parent_id = p_property_id));
$$;

revoke all on function public.property_open_cleanings(bigint) from public, anon;
grant execute on function public.property_open_cleanings(bigint) to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  The rooms that already exist
-- ---------------------------------------------------------------------------
--
-- Built from the raw layer rather than waiting for the next listing sync: the
-- reservation binding in the next migration resolves a Hostaway unit to the
-- row created here, and a backfill that ran first would find nothing to point
-- at. Checked against the hosted project on 2026-09-12: nine listings carry
-- `listingUnits`, thirty-one rooms between them.
--
-- host_id comes from the parent rather than default_host_id(): identical
-- today with one company, and the right answer when there is more than one.
--
-- A room with no usable name still gets a row — named by its Hostaway number
-- so a manager can see and rename it. Dropping it would lose the cleanings.
insert into public.properties (
  id, hostaway_unit_id, parent_id, host_id, name,
  address, city, country_code, timezone,
  check_in_time, check_out_time, synced_at
)
select
  public.property_id_for_unit((u.value ->> 'id')::bigint),
  (u.value ->> 'id')::bigint,
  p.id,
  p.host_id,
  coalesce(nullif(btrim(u.value ->> 'name'), ''), 'Unit ' || (u.value ->> 'id')),
  p.address, p.city, p.country_code, p.timezone,
  p.check_in_time, p.check_out_time, r.synced_at
from raw.hostaway_listings r
join public.properties p on p.id = r.id
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(r.data -> 'listingUnits') = 'array'
       then r.data -> 'listingUnits'
       else '[]'::jsonb end
) as u(value)
where (u.value ->> 'id') ~ '^[0-9]+$'
on conflict (id) do nothing;
