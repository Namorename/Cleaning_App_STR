-- READ ONLY. How «Задания» (problems) are worked and closed today, and whether their theme came back.
with pb as (
  select pb.*, coalesce(pp.parent_id, pp.id) as family, coalesce(pt.theme, cat.theme) as theme,
         (select max(e.created_at) from problem_events e where e.problem_id = pb.id) as last_event,
         (select count(*) from problem_events e where e.problem_id = pb.id and e.kind = 'reopened') as reopens,
         (select t.id from tasks t where t.problem_id = pb.id order by t.created_at desc limit 1) as fix_task,
         exists (select 1 from task_media m where m.problem_id = pb.id) as has_media
  from problems pb
  left join properties pp on pp.id = pb.property_id
  left join problem_themes pt on pt.problem_id = pb.id
  left join problem_categories cat on cat.id = pb.category_id
),
fix as (
  select pb.id, t.status as task_status, t.completed_at, t.assignee_id,
         (select count(*) from task_media m where m.task_id = t.id) as task_photos
  from pb join tasks t on t.id = pb.fix_task
),
returned as (
  select pb.id,
    exists (select 1 from pb p2 where p2.family = pb.family and p2.theme = pb.theme and p2.id <> pb.id
            and p2.created_at > pb.resolved_at and p2.created_at <= pb.resolved_at + interval '60 days') as again_staff,
    exists (select 1 from issue_facts f join properties fp on fp.id = f.property_id
            where coalesce(fp.parent_id, fp.id) = pb.family and f.theme = pb.theme
              and f.layer in ('guest_review', 'guest_message') and coalesce(f.week, f.month) > pb.resolved_at::date) as again_guest
  from pb where pb.status = 'resolved' and pb.theme is not null and pb.theme <> 'other'
)
select json_build_object(
  'problems', (select count(*) from pb),
  'by_status_source', (select json_agg(x) from (select source, status, count(*) n, count(*) filter (where archived_at is not null) archived from pb group by 1, 2 order by 1, 3 desc) x),
  'with_theme', (select count(*) from pb where theme is not null),
  'with_category', (select count(*) from pb where category_id is not null),
  'found_at_cleaning', (select count(*) from pb where task_id is not null),
  'with_fix_task', (select count(*) from pb where fix_task is not null),
  'fix_task_status', (select json_object_agg(task_status, n) from (select task_status, count(*) n from fix group by 1) q),
  'fix_photos', (select json_build_object('done', count(*) filter (where task_status = 'done'), 'done_with_photo', count(*) filter (where task_status = 'done' and task_photos > 0)) from fix),
  'with_media', (select count(*) from pb where has_media),
  'resolved_hours', (select json_build_object('p25', percentile_cont(0.25) within group (order by extract(epoch from resolved_at - created_at) / 3600),
                                              'p50', percentile_cont(0.5) within group (order by extract(epoch from resolved_at - created_at) / 3600),
                                              'p75', percentile_cont(0.75) within group (order by extract(epoch from resolved_at - created_at) / 3600),
                                              'p90', percentile_cont(0.9) within group (order by extract(epoch from resolved_at - created_at) / 3600))
                     from pb where status = 'resolved' and resolved_at is not null),
  'closed_how', (select json_object_agg(coalesce(closed_how, 'null'), n) from (select closed_how, count(*) n from pb where status = 'resolved' group by 1) q),
  'closed_by_reporter_side', (select json_build_object('completed_by_set', count(completed_by), 'source', (select json_object_agg(coalesce(completed_by_source, 'null'), n) from (select completed_by_source, count(*) n from pb where status = 'resolved' group by 1) q2)) from pb where status = 'resolved'),
  'reopened', (select count(*) from pb where reopens > 0),
  'open_now', (select json_build_object('n', count(*), 'no_assignee_task', count(*) filter (where fix_task is null),
       'idle_7d', count(*) filter (where coalesce(last_event, created_at) < now() - interval '7 days'),
       'idle_14d', count(*) filter (where coalesce(last_event, created_at) < now() - interval '14 days'),
       'older_14d', count(*) filter (where created_at < now() - interval '14 days'),
       'overdue_due_on', count(*) filter (where due_on < current_date),
       'by_status', (select json_object_agg(status, n) from (select status, count(*) n from pb where status in ('open', 'assigned', 'in_progress') and archived_at is null group by 1) q))
     from pb where status in ('open', 'assigned', 'in_progress') and archived_at is null),
  'returned', (select json_build_object('resolved_with_theme', count(*), 'again_staff_60d', count(*) filter (where again_staff),
       'again_guest', count(*) filter (where again_guest), 'either', count(*) filter (where again_staff or again_guest)) from returned),
  'recurrence', (select json_build_object('family_theme_pairs', count(*), 'pairs_2plus', count(*) filter (where n >= 2), 'pairs_3plus', count(*) filter (where n >= 3), 'max', max(n))
     from (select family, theme, count(*) n from pb where theme is not null and theme <> 'other' and status <> 'cancelled' group by 1, 2) r),
  'plans', (select json_build_object('n', count(*), 'by_status', (select json_object_agg(status, n) from (select status, count(*) n from resolution_plans group by 1) q),
       'steps', (select json_object_agg(kind, n) from (select kind, count(*) n from resolution_plan_steps group by 1) q2)) from resolution_plans),
  'findings_to_problems', (select json_build_object('linked', count(*) filter (where problem_id is not null)) from signal_findings)
) as result;
