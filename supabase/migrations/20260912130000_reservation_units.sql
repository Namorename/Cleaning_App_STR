-- Which room a booking took.
--
-- On a multi-unit listing the booking belongs to the LISTING — `listingMapId`
-- — and names its room separately, in `reservationUnit[].listingUnitId`.
-- Verified against the live account on 2026-09-12: every one of 616 bookings
-- in the August-December window carries it, in every status including
-- cancelled and ownerStay, and all 625 unit references resolve to a room of
-- their own listing.
--
-- The field arrives without `includeResources=1`, contrary to the published
-- specification (p. 57), which means the raw layer has been storing it all
-- along: 465 of 465 stored bookings on those listings carry it, back to the
-- first sync on 2026-08-27. The backfill at the bottom reads them rather than
-- re-fetching thirteen hundred bookings from Hostaway.
--
-- Why a table and not a column: eight bookings in the account take more than
-- one room, one of them three. A booking to rooms 3, 5 and 7 is three
-- cleanings, and a column could not say so.
--
-- `reservations.property_id` stays the LISTING. That is what Hostaway says the
-- booking is against, and teaching the column to mean something else would be
-- lying to the source.

-- The composite foreign key below needs this, the same way
-- `properties_host_id_uq` already carries the one on checklists and templates.
create unique index reservations_host_id_uq on public.reservations (host_id, id);

create table public.reservation_units (
  host_id        uuid   not null default public.default_host_id()
                   references public.hosts(id) on delete restrict,
  reservation_id bigint not null,
  -- The room's properties row, not the Hostaway unit number: everything
  -- downstream — the task, the checklist, the cleaner link — speaks in
  -- property ids, and a second identifier here would have to be translated at
  -- every one of those places.
  property_id    bigint not null,
  created_at     timestamptz not null default now(),
  primary key (reservation_id, property_id),
  foreign key (host_id, reservation_id)
    references public.reservations(host_id, id) on delete cascade,
  foreign key (host_id, property_id)
    references public.properties(host_id, id) on delete cascade
);

comment on table public.reservation_units is
  'Rooms a booking took on a multi-unit listing. Empty for the seventy listings that have no rooms.';
comment on column public.reservation_units.property_id is
  'The room, as a properties row under the listing. See public.property_id_for_unit().';

-- Read by the generator for every departure in the window, and by the panel
-- for every day of the calendar.
create index reservation_units_property_idx
  on public.reservation_units (property_id);

-- Written by the sync and by nothing else: the rows are a copy of what
-- Hostaway said, and a hand-edited one would be silently overwritten on the
-- next run. Managers read; cleaners never need it, because the task itself
-- already points at the room.
revoke all on public.reservation_units from public, anon, authenticated;
grant select on public.reservation_units to authenticated;
grant select, insert, update, delete on public.reservation_units to service_role;

alter table public.reservation_units enable row level security;

create policy "managers read reservation units"
  on public.reservation_units for select
  to authenticated
  using (public.is_manager() and host_id = public.current_host_id());

-- ---------------------------------------------------------------------------
--  The sync writes the rooms alongside the bookings
-- ---------------------------------------------------------------------------
--
-- `unit_rows` carries the Hostaway unit number and this maps it to a room row,
-- for the same reason the listing sync does: the shift belongs to
-- property_id_for_unit() and nowhere else.
--
-- The set is REPLACED for every booking in the batch, not added to. A guest
-- moved from room 3 to room 5, or a booking cut from three rooms to two, has
-- to leave no trace of where it used to be — otherwise the generator keeps
-- producing a cleaning for a room nobody is in. The scope is the bookings this
-- batch actually wrote, so a booking with no rooms at all (the seventy
-- ordinary listings) correctly ends up with none.
--
-- A room the listing sync has not created yet is skipped and reported rather
-- than failing the batch: a new room appears in Hostaway before our next
-- listing run, and losing thirteen hundred bookings over one of them would be
-- the wrong trade.
--
-- NULL AND EMPTY MEAN DIFFERENT THINGS, and the difference is the whole safety
-- of the deploy. `'[]'` is an assertion — "I looked, this booking has no rooms"
-- — and it clears what is there. NULL is the absence of one — "I have nothing
-- to say about rooms" — and it leaves the links exactly as they are.
--
-- The default is NULL for that reason. Between `db:push` and `functions deploy`
-- the already-deployed edge function calls this with two named arguments and no
-- unit_rows at all; PostgREST resolves that to this function with the third
-- argument defaulted. Measured on the local stack: with a default of `'[]'` that
-- call reported `units_freed: 1` and emptied the table for every booking in the
-- batch. The nightly reconciliation walks about 1290 bookings, so the whole
-- backfill would have been gone by morning.
drop function if exists public.sync_hostaway_reservations(jsonb, jsonb);

create or replace function public.sync_hostaway_reservations(
  raw_rows         jsonb,
  reservation_rows jsonb,
  unit_rows        jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_raw          integer;
  v_inserted     integer;
  v_updated      integer;
  v_skipped      bigint[];
  v_units_linked integer;
  v_units_freed  integer;
  v_units_missed bigint[];
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
      channel_id, guest_name, guests_count, total_price, is_block, synced_at,
      check_in_time, check_out_time
    )
    select r.id, r.property_id, r.arrival_date, r.departure_date, r.status,
           r.channel_id, r.guest_name, r.guests_count, r.total_price,
           r.is_block, r.synced_at, r.check_in_time, r.check_out_time
    from jsonb_to_recordset(reservation_rows)
      as r(
        id bigint, property_id bigint, arrival_date date, departure_date date,
        status text, channel_id integer, guest_name text, guests_count smallint,
        total_price numeric(12,2), is_block boolean, synced_at timestamptz,
        check_in_time time, check_out_time time
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
          synced_at      = excluded.synced_at,
          check_in_time  = excluded.check_in_time,
          check_out_time = excluded.check_out_time
    returning (xmax = 0) as was_inserted
  )
  select
    count(*) filter (where was_inserted),
    count(*) filter (where not was_inserted)
  into v_inserted, v_updated
  from upserted;

  -- A caller that said nothing about rooms is not saying there are none.
  if unit_rows is null then
    return jsonb_build_object(
      'raw_upserted', v_raw,
      'reservations_inserted', v_inserted,
      'reservations_updated', v_updated,
      'skipped_property_ids', to_jsonb(v_skipped),
      'units_linked', 0,
      'units_freed', 0,
      'units_untouched', true,
      'skipped_unit_ids', to_jsonb('{}'::bigint[])
    );
  end if;

  -- Bookings whose set must NOT be replaced, for either of two reasons.
  --
  --   hostaway_unit_id is null — the caller is saying "Hostaway told me nothing
  --     about rooms for this booking". Silence is not the assertion that there
  --     are none, and reading it as one is how a change of shape on their side
  --     would delete every link we hold.
  --   the room is unknown to us — a room created in Hostaway since our last
  --     listing run. Emptying the booking would lose the cleaning outright,
  --     where leaving it puts the cleaning on the room it had until sync-listings
  --     catches up.
  create temporary table _untouchable_res on commit drop as
  select distinct u.reservation_id
  from jsonb_to_recordset(unit_rows) as u(reservation_id bigint, hostaway_unit_id bigint)
  where u.hostaway_unit_id is null
     or not exists (
          select 1 from public.properties p
          where p.id = public.property_id_for_unit(u.hostaway_unit_id)
        );

  select coalesce(array_agg(distinct u.hostaway_unit_id), '{}')
  into v_units_missed
  from jsonb_to_recordset(unit_rows) as u(reservation_id bigint, hostaway_unit_id bigint)
  where u.hostaway_unit_id is not null
    and not exists (
      select 1 from public.properties p
      where p.id = public.property_id_for_unit(u.hostaway_unit_id)
    );


  -- The rooms this batch claims, already translated, already checked against
  -- the bookings and rooms that exist, and with the untouchable bookings taken
  -- out. Half a set is not a set: a booking naming one room we have and one we
  -- do not is frozen whole rather than half-applied, which would leave it
  -- claiming a room it kept and a room it just moved into at the same time.
  --
  -- Dropped explicitly at the end rather than left to `on commit drop`, the
  -- same way generate_cleaning_tasks handles `_wanted`: the reconciliation
  -- calls this once per batch of two hundred, and inside one transaction the
  -- second call would find the table still standing.
  create temporary table _wanted_units on commit drop as
  select distinct
    r.host_id,
    u.reservation_id,
    public.property_id_for_unit(u.hostaway_unit_id) as property_id
  from jsonb_to_recordset(unit_rows) as u(reservation_id bigint, hostaway_unit_id bigint)
  join public.reservations r on r.id = u.reservation_id
  join public.properties   p on p.id = public.property_id_for_unit(u.hostaway_unit_id)
                            and p.host_id = r.host_id
  where u.hostaway_unit_id is not null
    and not exists (
      select 1 from _untouchable_res x where x.reservation_id = u.reservation_id
    );

  -- Bookings in _untouchable_res keep whatever they have; every other booking
  -- this batch wrote has its set replaced by what the caller named.
  with freed as (
    delete from public.reservation_units ru
    where ru.reservation_id in (
            select r.id from jsonb_to_recordset(reservation_rows) as r(id bigint)
          )
      and not exists (
            select 1 from _untouchable_res x where x.reservation_id = ru.reservation_id
          )
      and not exists (
            select 1 from _wanted_units w
            where w.reservation_id = ru.reservation_id
              and w.property_id = ru.property_id
          )
    returning 1
  )
  select count(*) into v_units_freed from freed;

  with linked as (
    insert into public.reservation_units (host_id, reservation_id, property_id)
    select w.host_id, w.reservation_id, w.property_id
    from _wanted_units w
    on conflict (reservation_id, property_id) do nothing
    returning 1
  )
  select count(*) into v_units_linked from linked;

  drop table _wanted_units;
  drop table _untouchable_res;

  return jsonb_build_object(
    'raw_upserted', v_raw,
    'reservations_inserted', v_inserted,
    'reservations_updated', v_updated,
    'skipped_property_ids', to_jsonb(v_skipped),
    'units_linked', v_units_linked,
    'units_freed', v_units_freed,
    'units_untouched', false,
    'skipped_unit_ids', to_jsonb(v_units_missed)
  );
end;
$$;

revoke all on function public.sync_hostaway_reservations(jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_hostaway_reservations(jsonb, jsonb, jsonb) to service_role;

-- ---------------------------------------------------------------------------
--  The bookings we already have
-- ---------------------------------------------------------------------------
--
-- Read from the raw layer, not from Hostaway. The field has been arriving
-- since the first sync — checked on the hosted project 2026-09-12: 465 of 465
-- stored bookings on the nine multi-unit listings carry a non-empty
-- `reservationUnit`, between them naming all thirty-one rooms.
--
-- A booking whose room row does not exist is passed over rather than forced:
-- the rooms were created by the previous migration from the same raw layer, so
-- the two agree by construction, and a mismatch means something we have not
-- seen and should not guess at.
--
-- The numeric guard sits in a CTE rather than beside the cast. A WHERE clause
-- and a JOIN qualifier in the same query have no ordering guarantee, so a
-- single `"listingUnitId": ""` among the 1926 stored bookings could be cast
-- before the guard filtered it and abort the whole migration on `invalid input
-- syntax for type bigint`. Filtering in a separate scan makes that impossible.
with named as (
  select res.host_id, res.id as reservation_id, u.value ->> 'listingUnitId' as unit_text
  from raw.hostaway_reservations r
  join public.reservations res on res.id = r.id
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(r.data -> 'reservationUnit') = 'array'
         then r.data -> 'reservationUnit'
         else '[]'::jsonb end
  ) as u(value)
), numbered as (
  select host_id, reservation_id, unit_text::bigint as hostaway_unit_id
  from named
  where unit_text ~ '^[0-9]+$'
)
insert into public.reservation_units (host_id, reservation_id, property_id)
select distinct n.host_id, n.reservation_id, p.id
from numbered n
join public.properties p
  on p.id = public.property_id_for_unit(n.hostaway_unit_id)
 and p.host_id = n.host_id
on conflict (reservation_id, property_id) do nothing;
