-- Window 3, Г: taking a listing out of service cancels stay-over cleanings too.
--
-- A midstay is a cleaning while the guests stay. Since the phone offers free
-- ones in «Свободные» (2026-09-24), a free midstay on an archived flat could be
-- taken -- the claim policy does not look at the property's status -- and the
-- archive dialog did not even count it: set_property_status counted and
-- cancelled `type = 'cleaning'` only, and so did the two numbers the manager
-- reads before saying yes. The owner's word of 2026-09-24: archiving and
-- maintenance take unstarted midstays with them; an inspection or a repair
-- stays -- an inspection after a repair is what a flat under maintenance is
-- for.
--
-- The three places have to agree, so they change together: the sweep and its
-- count in set_property_status, property_open_cleanings (the number the
-- confirmation shows) and open_cleanings_by_listing (the registry beside it).
-- Same signatures, so the ACLs, the generated types and the panel stay as they
-- are. The dialog text is unchanged: «уборок» is true of a stay-over cleaning.
--
-- property_open_cleanings also gains the manager check it never had (owner's
-- word 2026-09-24). It is a definer granted to authenticated, so a cleaner
-- could ask how many cleanings any flat of her company had open; the number
-- is the manager's question, asked only by the panel.
--
-- Only function bodies change: no table lock beyond what a create or replace
-- takes, and a call already running finishes on the old body.

set local lock_timeout = '3s';

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
  --
  -- Rooms are NOT part of that question, and an earlier draft that made them
  -- part of it was wrong. A room under repair inside a working listing is the
  -- ordinary case and the whole reason a room carries a status of its own;
  -- reading it as drift meant a second manager pressing "in service" on the
  -- listing — or one stale panel retrying — quietly sent the room back to work
  -- with a burst pipe in it. The other direction cannot drift: a room more
  -- alive than its listing is refused above.
  if v_property.status = p_status then
    return v_property;
  end if;

  if p_status <> 'active' then
    -- Only cleanings nobody has started, stay-over ones included. `accepted`
    -- counts as started: she has said out loud that she is taking it.
    select count(*) into v_open
    from public.tasks t
    where (t.property_id = p_property_id or t.property_id in (
             select u.id from public.properties u
             where u.parent_id = p_property_id and u.hostaway_unit_id is not null
           ))
      and t.host_id = v_host
      and t.type in ('cleaning', 'midstay')
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
             select u.id from public.properties u
             where u.parent_id = p_property_id and u.hostaway_unit_id is not null
           ))
      and host_id = v_host
      and type in ('cleaning', 'midstay')
      and status in ('unassigned', 'assigned');
  end if;

  update public.properties
  set status = p_status
  where (id = p_property_id
         or (parent_id = p_property_id and hostaway_unit_id is not null))
    and host_id = v_host;

  select * into v_property
  from public.properties
  where id = p_property_id;

  return v_property;
end;
$$;

-- The figure the confirmation shows. plpgsql now, for the refusal: the number
-- at stake is a manager's question.
create or replace function public.property_open_cleanings(p_property_id bigint)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'Only a manager may ask what archiving would cancel'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  return (
    select count(*)::integer
    from public.tasks t
    where t.host_id = public.current_host_id()
      and t.type in ('cleaning', 'midstay')
      and t.status in ('unassigned', 'assigned')
      and (t.property_id = p_property_id
           or t.property_id in (select u.id
                                from public.properties u
                                where u.parent_id = p_property_id
                                  and u.hostaway_unit_id is not null)));
end;
$$;

-- The registry's column, the same rule for the whole company in one read.
create or replace function public.open_cleanings_by_listing()
returns table (property_id bigint, cleanings integer)
language sql
stable
set search_path = ''
as $$
  select case when p.hostaway_unit_id is not null then p.parent_id else p.id end,
         count(*)::integer
  from public.tasks t
  join public.properties p on p.id = t.property_id
  where t.type in ('cleaning', 'midstay')
    and t.status in ('unassigned', 'assigned')
  group by 1;
$$;
