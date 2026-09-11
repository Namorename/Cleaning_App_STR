-- Taking a listing out of service, and putting it back.
--
-- The status is one column and the panel could write it directly, but the
-- write is never only that: a flat that stops taking guests stops needing the
-- cleanings already on its books, and counting them in the panel and clearing
-- them in a second call leaves a gap where the nightly generator can add one
-- more. Both happen here, within one statement's worth of time.
--
-- The refusal is the interesting half. A manager is told how many cleanings
-- she is about to sweep and has to say so a second time — `p_cancel_tasks`,
-- the same shape as `p_allow_duplicate` in save_task: the server asks the
-- question, the panel only carries the answer back.
--
-- What is never touched: a cleaning already under way, and everything that has
-- already happened. Work in progress belongs to whoever is standing in the
-- flat — the rule generate_cleaning_tasks already follows for a withdrawn
-- booking — and finished work, its measured minutes and its photos are the
-- record of what happened, which archiving a listing does not change.
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

  -- Saying again what is already true is not a change, and must not sweep
  -- anything: the panel may send the same press twice on a slow connection.
  if v_property.status = p_status then
    return v_property;
  end if;

  if p_status <> 'active' then
    -- Only cleanings nobody has started. `accepted` counts as started: she has
    -- said out loud that she is taking it.
    select count(*) into v_open
    from public.tasks t
    where t.property_id = p_property_id
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
    where property_id = p_property_id
      and host_id = v_host
      and type = 'cleaning'
      and status in ('unassigned', 'assigned');
  end if;

  update public.properties
  set status = p_status
  where id = p_property_id
  returning * into v_property;

  return v_property;
end;
$$;

revoke all on function
  public.set_property_status(bigint, public.property_status, boolean)
  from public, anon;
grant execute on function
  public.set_property_status(bigint, public.property_status, boolean)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
--  The number the confirmation shows
-- ---------------------------------------------------------------------------
--
-- The same count the refusal carries, readable on its own so the dialog can
-- name a figure before the manager commits to anything.
create or replace function public.property_open_cleanings(p_property_id bigint)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.tasks t
  where t.property_id = p_property_id
    and t.host_id = public.current_host_id()
    and t.type = 'cleaning'
    and t.status in ('unassigned', 'assigned');
$$;

revoke all on function public.property_open_cleanings(bigint) from public, anon;
grant execute on function public.property_open_cleanings(bigint) to authenticated, service_role;
