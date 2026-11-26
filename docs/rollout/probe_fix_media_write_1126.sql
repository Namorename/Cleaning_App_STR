-- Write-path integrity for the last 30 days: is any file of a fix task lost to its task by the write?
with m as (
  select m.*, t.problem_id as task_problem_id, t.type::text as task_type,
         (o.id is not null) as has_object
  from public.task_media m
  left join public.tasks t on t.id = m.task_id
  left join storage.objects o on o.bucket_id = 'task-media' and o.name = m.storage_path
  where m.created_at >= now() - interval '30 days'
)
select 'owner_shape' as check_name,
       (case when task_id is not null and step_id is not null then 'task+step'
             when task_id is not null then 'task_no_step'
             when problem_id is not null then 'problem'
             when addition_id is not null then 'addition'
             when message_id is not null then 'message'
             else 'NO_OWNER' end) as bucket,
       coalesce(task_type, '-') as task_type,
       (task_problem_id is not null)::text as is_fix_task,
       count(*)::text as n,
       count(*) filter (where uploaded_at is null)::text as not_confirmed,
       count(*) filter (where uploaded_at is null and has_object)::text as object_but_not_confirmed
from m
where deleted_at is null and purged_at is null
group by 2, 3, 4
union all
-- A fix task's step media whose step belongs to another task: the link that would lose it.
select 'step_of_other_task', m.id::text, '', '', '1', '', ''
from m join public.task_steps s on s.id = m.step_id
where m.task_id is not null and s.task_id <> m.task_id
union all
-- Objects in the bucket with no row at all (the client cannot make them; a lost link would).
select 'object_without_row', count(*)::text, '', '', '', '', ''
from storage.objects o
where o.bucket_id = 'task-media' and o.created_at >= now() - interval '30 days'
  and not exists (select 1 from public.task_media x where x.storage_path = o.name);
