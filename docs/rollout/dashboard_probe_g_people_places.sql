-- dashboard probe G: properties, timezones, staff by role and load spread (counts only, no names)
select json_build_object(
  'hosts', (select count(*) from public.hosts),
  'properties_by_status_kind', (select json_object_agg(k, n) from (
      select p.status::text || '/' ||
             case when p.parent_id is not null then 'unit'
                  when exists (select 1 from public.properties c where c.parent_id = p.id) then 'parent'
                  else 'single' end as k,
             count(*) as n
      from public.properties p group by 1) x),
  'timezones', (select json_object_agg(timezone, n) from (select timezone, count(*) as n from public.properties group by 1) t),
  'countries', (select json_object_agg(c, n) from (select coalesce(country_code, 'null') as c, count(*) as n from public.properties group by 1) c),
  'fill', (select json_build_object('check_out_time', count(check_out_time), 'check_in_time', count(check_in_time),
      'hostaway_unit_id', count(hostaway_unit_id), 'bedrooms', count(bedrooms), 'max_guests', count(max_guests),
      'city', count(city)) from public.properties),
  'cleanings_on_kind', (select json_object_agg(k, n) from (
      select case when p.parent_id is not null then 'unit'
                  when exists (select 1 from public.properties c where c.parent_id = p.id) then 'parent'
                  else 'single' end as k,
             count(*) as n
      from public.tasks t join public.properties p on p.id = t.property_id where t.type = 'cleaning' group by 1) y),
  'profiles_by_role', (select json_object_agg(k, n) from (
      select role::text || case when is_active then '' else '/off' end as k, count(*) as n from public.profiles group by 1) r),
  'profiles_created_range', (select json_build_array(min(created_at)::date, max(created_at)::date) from public.profiles),
  'property_cleaners_by_mode', (select json_object_agg(mode, n) from (select mode::text as mode, count(*) as n from public.property_cleaners group by 1) m),
  'linked_cleaners', (select count(distinct cleaner_id) from public.property_cleaners),
  'linked_properties', (select count(distinct property_id) from public.property_cleaners),
  'cleaning_assignees', (select count(distinct assignee_id) from public.tasks where type = 'cleaning'),
  'cleaning_assignee_roles', (select json_object_agg(role, n) from (
      select pr.role::text as role, count(*) as n from public.tasks t join public.profiles pr on pr.id = t.assignee_id
      where t.type = 'cleaning' group by 1) a),
  'assigned_cleanings_per_assignee_min_med_max', (select percentile_cont(array[0, 0.5, 1]) within group (order by n) from (
      select count(*) as n from public.tasks where type = 'cleaning' and assignee_id is not null group by assignee_id) b),
  'same_day_turnovers_next_30d', (select count(*) from public.reservations a join public.reservations b
      on b.property_id = a.property_id and b.arrival_date = a.departure_date and b.id <> a.id
      where not a.is_block and not b.is_block
        and a.departure_date between current_date and current_date + 30)
) as probe;
