-- dashboard probe D: checklist steps and media - fill and completeness of done cleanings (counts only)
with dc as (
  select t.id from public.tasks t
  where t.type = 'cleaning' and t.status = 'done' and t.property_id <> 900000000001
)
select json_build_object(
  'steps_total', (select count(*) from public.task_steps),
  'steps_by_type', (select json_object_agg(type, json_build_object('n', n, 'required', r, 'completed', c, 'skipped', s,
                                                                    'waived', w, 'started', st, 'device_completed', dv))
                    from (select type::text as type, count(*) as n, count(*) filter (where required) as r,
                                 count(completed_at) as c, count(skipped_at) as s, count(waived_at) as w,
                                 count(started_at) as st, count(device_completed_at) as dv
                          from public.task_steps group by 1) x),
  'steps_created_min', (select min(created_at)::date from public.task_steps),
  'tasks_with_steps_by_type_status', (select json_object_agg(k, n) from (
                    select t.type::text || '/' || t.status::text as k, count(*) as n from public.tasks t
                    where exists (select 1 from public.task_steps s where s.task_id = t.id) group by 1) y),
  'done_cleanings', (select count(*) from dc),
  'done_with_steps', (select count(*) from dc where exists (select 1 from public.task_steps s where s.task_id = dc.id)),
  'done_all_required_closed', (select count(*) from dc
                    where exists (select 1 from public.task_steps s where s.task_id = dc.id)
                      and not exists (select 1 from public.task_steps s where s.task_id = dc.id and s.required
                                      and s.completed_at is null and s.skipped_at is null and s.waived_at is null)),
  'done_with_waived', (select count(*) from dc where exists (select 1 from public.task_steps s where s.task_id = dc.id and s.waived_at is not null)),
  'done_with_skipped', (select count(*) from dc where exists (select 1 from public.task_steps s where s.task_id = dc.id and s.skipped_at is not null)),
  'media_total', (select count(*) from public.task_media),
  'media_by', (select json_object_agg(k, n) from (
                    select kind::text || '/' || source::text || '/' ||
                           case when task_id is not null then 'task' when problem_id is not null then 'problem'
                                when message_id is not null then 'message' else 'none' end ||
                           case when deleted_at is not null then '/deleted' when purged_at is not null then '/purged'
                                when uploaded_at is null then '/not_uploaded' else '' end as k,
                           count(*) as n
                    from public.task_media group by 1) z),
  'media_created_range', (select json_build_array(min(created_at)::date, max(created_at)::date) from public.task_media),
  'done_with_photo', (select count(*) from dc where exists (select 1 from public.task_media m where m.task_id = dc.id and m.kind = 'photo' and m.uploaded_at is not null)),
  'done_with_video', (select count(*) from dc where exists (select 1 from public.task_media m where m.task_id = dc.id and m.kind = 'video' and m.uploaded_at is not null)),
  'photos_per_done_p50_p90', (select percentile_cont(array[0.5, 0.9]) within group (order by c) from (
                    select count(m.id) as c from dc left join public.task_media m
                      on m.task_id = dc.id and m.kind = 'photo' and m.uploaded_at is not null
                    group by dc.id) q)
) as probe;
