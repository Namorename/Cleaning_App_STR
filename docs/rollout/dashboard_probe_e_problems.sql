-- dashboard probe E: problems (requests to technicians), their events and repair jobs - counts and timings only
select json_build_object(
  'total', (select count(*) from public.problems),
  'demo', (select count(*) from public.problems where property_id = 900000000001),
  'by_status_priority', (select json_object_agg(k, n) from (
      select status::text || '/' || priority::text as k, count(*) as n from public.problems group by 1) x),
  'fill', (select json_build_object(
      'resolved_at', count(resolved_at), 'cancelled_at', count(cancelled_at),
      'cancel_reason', count(*) filter (where coalesce(cancel_reason, '') <> ''),
      'archived_at', count(archived_at), 'property_id', count(property_id), 'task_id', count(task_id),
      'description', count(*) filter (where coalesce(description, '') <> '')) from public.problems),
  'created_range', (select json_build_array(min(created_at)::date, max(created_at)::date) from public.problems),
  'reported_by_role', (select json_object_agg(role, n) from (
      select pr.role::text as role, count(*) as n from public.problems p join public.profiles pr on pr.id = p.reported_by group by 1) y),
  'hours_to_resolve_p50_p90', (select percentile_cont(array[0.5, 0.9]) within group (order by extract(epoch from resolved_at - created_at) / 3600.0)
      from public.problems where resolved_at is not null),
  'events_by_kind', (select json_object_agg(kind, n) from (select kind::text as kind, count(*) as n from public.problem_events group by 1) z),
  'events_range', (select json_build_array(min(created_at)::date, max(created_at)::date) from public.problem_events),
  'problems_with_reported_event', (select count(distinct problem_id) from public.problem_events where kind = 'reported'),
  'event_param_keys', (select json_agg(distinct k) from public.problem_events e
      cross join lateral jsonb_object_keys(case when jsonb_typeof(e.params) = 'object' then e.params else '{}'::jsonb end) as k),
  'events_with_actor', (select count(actor_id) from public.problem_events),
  'events_with_task', (select count(task_id) from public.problem_events),
  'hours_to_first_assigned_p50_p90', (select percentile_cont(array[0.5, 0.9]) within group (order by h) from (
      select extract(epoch from min(e.created_at) - p.created_at) / 3600.0 as h
      from public.problems p join public.problem_events e on e.problem_id = p.id and e.kind = 'assigned' group by p.id, p.created_at) a),
  'hours_to_first_accepted_p50_p90', (select percentile_cont(array[0.5, 0.9]) within group (order by h) from (
      select extract(epoch from min(e.created_at) - p.created_at) / 3600.0 as h
      from public.problems p join public.problem_events e on e.problem_id = p.id and e.kind = 'accepted' group by p.id, p.created_at) b),
  'hours_to_first_started_p50_p90', (select percentile_cont(array[0.5, 0.9]) within group (order by h) from (
      select extract(epoch from min(e.created_at) - p.created_at) / 3600.0 as h
      from public.problems p join public.problem_events e on e.problem_id = p.id and e.kind = 'started' group by p.id, p.created_at) c),
  'repair_jobs_by_status', (select json_object_agg(status, n) from (
      select status::text as status, count(*) as n from public.tasks where type = 'maintenance' group by 1) w),
  'repair_job_assignee_roles', (select json_object_agg(role, n) from (
      select pr.role::text as role, count(*) as n from public.tasks t join public.profiles pr on pr.id = t.assignee_id
      where t.type = 'maintenance' group by 1) v),
  'problems_with_jobs', (select count(distinct problem_id) from public.tasks where problem_id is not null),
  'problems_reopened', (select count(distinct problem_id) from public.problem_events where kind = 'reopened'),
  'properties_with_problems', (select count(distinct property_id) from public.problems),
  'problems_per_property_max', (select max(n) from (select count(*) as n from public.problems where property_id is not null group by property_id) q),
  'inspections_midstay', (select json_object_agg(k, n) from (
      select type::text || '/' || status::text as k, count(*) as n from public.tasks where type in ('inspection', 'midstay') group by 1) u)
) as probe;
