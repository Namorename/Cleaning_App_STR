-- The cleanings' closings by status, how, and the source of the worker and of the closer
-- (20261106125500). Valid after the push only: it reads task_closings. Counts, no names.
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_cleaning_closing_counts_1109.sql
select json_build_object(
  'closings', (select coalesce(json_object_agg(k, n), '{}'::json) from (
      select t.status::text || ':' || coalesce(c.closed_how, 'none') || ':'
             || coalesce(c.closed_cause, '-') || ':' || coalesce(c.worker_source, 'no_worker') || ':'
             || coalesce(c.closer_source, '-') as k,
             count(*) as n
      from public.tasks t
      left join public.task_closings c on c.task_id = t.id
      where t.problem_id is null and t.status in ('done', 'cancelled', 'expired')
      group by 1) q),
  'orphans', (select count(*) from public.task_closings c
              join public.tasks t on t.id = c.task_id
              where t.status not in ('done', 'cancelled', 'expired') or t.problem_id is not null)
) as out;
