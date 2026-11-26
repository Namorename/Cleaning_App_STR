-- Scale: tasks (problems) whose technician's fix task holds uploaded, live media in the last 30 days.
-- The panel shows a fix task's steps only while it is live (not done/cancelled/expired);
-- the manager's phone never shows them on the task screen.
with fix_media as (
  select t.problem_id, t.id as task_id, t.status::text as task_status, m.id as media_id, m.kind::text as kind,
         m.created_at, (o.id is not null) as has_object
  from public.task_media m
  join public.tasks t on t.id = m.task_id
  left join storage.objects o on o.bucket_id = 'task-media' and o.name = m.storage_path
  where t.problem_id is not null
    and m.uploaded_at is not null and m.deleted_at is null and m.purged_at is null
    and m.created_at >= now() - interval '30 days'
),
per_problem as (
  select problem_id,
         bool_or(task_status in ('done', 'cancelled', 'expired')) as has_closed_fix_media,
         bool_and(task_status in ('done', 'cancelled', 'expired')) as all_closed,
         count(*) as files,
         count(*) filter (where kind = 'video') as videos,
         count(*) filter (where not has_object) as files_without_object,
         string_agg(distinct task_status, ',') as statuses,
         max(created_at) as last_at
  from fix_media group by problem_id
)
select 'summary' as row_kind,
       count(*)::text as problems_with_fix_media,
       count(*) filter (where has_closed_fix_media)::text as panel_hidden,
       sum(files)::text as files,
       sum(videos)::text as videos,
       sum(files_without_object)::text as files_without_object,
       null::text as last_at
from per_problem
union all
select 'by_status', statuses, count(*)::text, sum(files)::text, sum(videos)::text, sum(files_without_object)::text, null
from per_problem group by statuses
union all
(select 'example', problem_id::text, statuses, files::text, videos::text, files_without_object::text, last_at::text
 from per_problem where has_closed_fix_media order by last_at desc limit 8);
