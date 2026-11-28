-- READ ONLY. Our own cleaning signals since cleanings start in the cloud (15.10.2026):
-- photos and steps, measured time against the place's own norm, hand-backs, expired cleanings,
-- who cleans which place, and which technician works which building. Counts only.
with cl as (
  select t.*, coalesce(p.parent_id, p.id) as family,
         (select count(*) from task_media m where m.task_id = t.id and m.kind = 'photo') as photos,
         (select count(*) from task_steps s where s.task_id = t.id and s.required) as req_steps,
         (select count(*) from task_steps s where s.task_id = t.id and s.required and s.completed_at is null) as req_open,
         (select count(*) from task_steps s where s.task_id = t.id and (s.skipped_at is not null or s.waived_at is not null)) as skipped,
         coalesce((select c.completed_by from task_closings c where c.task_id = t.id), t.completed_by) as done_by
  from tasks t join properties p on p.id = t.property_id
  where t.type = 'cleaning' and t.scheduled_date <= current_date
),
done as (select * from cl where status = 'done'),
norm as (select property_id, percentile_cont(0.5) within group (order by measured_minutes) as med, count(*) as n
         from done where measured_minutes is not null and not coalesce(is_short_measurement, false) group by 1),
dev as (select d.*, n.med, n.n as norm_n from done d join norm n on n.property_id = d.property_id where d.measured_minutes is not null),
place_people as (select property_id, count(*) as n, count(distinct done_by) as people,
                 max(c) as top from (select property_id, done_by, count(*) over (partition by property_id, done_by) as c from done) z group by 1),
tech as (select coalesce(p.parent_id, p.id) as family, t.assignee_id, count(*) as n
         from tasks t join properties p on p.id = t.property_id where t.type = 'maintenance' and t.status = 'done' group by 1, 2),
tech_family as (select family, sum(n) as n, count(*) as techs, max(n) as top from tech group by 1)
select json_build_object(
  'cleanings_past', (select count(*) from cl),
  'by_status', (select json_object_agg(status, n) from (select status, count(*) n from cl group by 1) q),
  'expired_by_week', (select json_agg(x order by w) from (select date_trunc('week', scheduled_date)::date w, count(*) filter (where status = 'done') done, count(*) filter (where status = 'expired') expired, count(*) filter (where status = 'expired' and assignee_id is not null) expired_assigned from cl group by 1) x),
  'released', (select json_object_agg(coalesce(release_kind, 'none'), n) from (select release_kind, count(*) n from cl group by 1) q),
  'off_notes', (select json_object_agg(kind, n) from (select kind, count(*) n from task_off_notes group by 1) q),
  'photos', (select json_build_object('done', count(*), 'with_photo', count(*) filter (where photos > 0), 'p50', percentile_cont(0.5) within group (order by photos), 'req_open', count(*) filter (where req_open > 0), 'skipped', count(*) filter (where skipped > 0), 'with_steps', count(*) filter (where req_steps > 0)) from done),
  'minutes', (select json_build_object('measured', count(measured_minutes), 'short', count(*) filter (where is_short_measurement), 'override', count(duration_override_min), 'p50', percentile_cont(0.5) within group (order by measured_minutes), 'p10', percentile_cont(0.1) within group (order by measured_minutes), 'p90', percentile_cont(0.9) within group (order by measured_minutes)) from done),
  'vs_norm', (select json_build_object('with_norm_5', count(*) filter (where norm_n >= 5), 'under_half', count(*) filter (where norm_n >= 5 and measured_minutes < 0.5 * med), 'under_70', count(*) filter (where norm_n >= 5 and measured_minutes < 0.7 * med), 'over_150', count(*) filter (where norm_n >= 5 and measured_minutes > 1.5 * med)) from dev),
  'place_people', (select json_build_object('places', count(*), 'p50_cleanings', percentile_cont(0.5) within group (order by n), 'one_person', count(*) filter (where people = 1), 'two', count(*) filter (where people = 2), 'three_plus', count(*) filter (where people >= 3), 'top_share_p50', percentile_cont(0.5) within group (order by top::numeric / n)) from place_people where n >= 3),
  'cleaner_volume', (select json_agg(n order by n desc) from (select done_by, count(*) n from done where done_by is not null group by 1) q),
  'permanent', (select json_build_object('rows', count(*), 'places', count(distinct property_id), 'first_choice', count(*) filter (where priority = 1),
       'done_by_first_choice', (select count(*) from done d where exists (select 1 from property_cleaners pc where pc.property_id = d.property_id and pc.cleaner_id = d.done_by and pc.priority = (select min(priority) from property_cleaners p2 where p2.property_id = d.property_id))),
       'done_on_places_with_list', (select count(*) from done d where exists (select 1 from property_cleaners pc where pc.property_id = d.property_id))) from property_cleaners),
  'tech', (select json_build_object('families', count(*), 'one_tech', count(*) filter (where techs = 1), 'p50_jobs', percentile_cont(0.5) within group (order by n), 'top_share_p50', percentile_cont(0.5) within group (order by top::numeric / n)) from tech_family where n >= 3),
  'techs', (select count(distinct assignee_id) from tasks where type = 'maintenance' and status = 'done'),
  'supplies', (select json_build_object('requests', count(*), 'with_task', count(task_id), 'places', count(distinct property_id), 'by_status', (select json_object_agg(status, n) from (select status, count(*) n from supply_requests group by 1) q)) from supply_requests),
  'cleaner_comments', (select count(*) from issue_facts where task_step_id is not null),
  'found_at_cleaning', (select count(*) from problems where task_id is not null)
) as result;
