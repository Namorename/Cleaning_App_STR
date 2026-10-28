-- Video limits of 23.10, before and after each step of docs/video-limits-1023.md. Read-only,
-- one statement; short ids, no names:
--
--   node scripts/cloud-read.mjs docs/rollout/video_limits_1023_probe.sql
--
-- company      the three numbers and the gallery switch;
-- functions    every overload of add_task_media and snapshot_task_steps with its arguments,
--              security definer, search_path and ACL, which the draft keeps (in the cloud on
--              23.10 both: definer, search_path="", {postgres=X, authenticated=X,
--              service_role=X}), and the md5 of its body: 1aae2aac / 54f7a9f0 before the draft
--              20261023100000, bf208d8c / dd81ff14 with it; draft_recorded whether it is in
--              the migration history;
-- listed       the 8 video steps of the one-off write: their cleaning, the copy, and the media;
-- open_steps   every open video step of a cleaning not done or cancelled, by status and copy
--              (null = the company's number of the moment);
-- new_starts   video steps of cleanings started in the last day, by copy: after the draft
--              they are all null.
with listed(step_id) as (values
    ('5c0e5baf-a7b3-4dbf-a84b-5353d9a854b1'::uuid),
    ('07d45f7e-5df1-4714-8548-1f8b646e2d91'::uuid),
    ('0ddaa883-cb30-489e-94c4-4d80cd14b413'::uuid),
    ('4a8456b6-658b-469d-9fcf-b7ff3378fd65'::uuid),
    ('2da4b127-ba92-4493-a380-211718516013'::uuid),
    ('c5ec0adc-ec7a-4b26-9dfd-80763079f645'::uuid),
    ('57c60b50-5eaf-40e6-99d1-c7510ecd750d'::uuid),
    ('bc94071c-5866-43ea-ba71-b350ac48c4b3'::uuid)
)
select json_build_object(
  'company', (select json_agg(json_build_object('sec', h.video_max_sec, 'kbps', h.video_bitrate_kbps,
       'mb', h.video_max_mb, 'gallery', h.gallery_allowed,
       'updated', to_char(h.updated_at at time zone 'UTC', 'MM-DD HH24:MI'))) from public.hosts h),
  'functions', (select json_agg(json_build_object(
       'name', p.proname, 'args', pg_get_function_identity_arguments(p.oid),
       'security_definer', p.prosecdef, 'config', p.proconfig, 'acl', p.proacl::text,
       'md5', left(md5(p.prosrc), 8)) order by p.proname, p.oid)
     from pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname in ('add_task_media', 'snapshot_task_steps')),
  'draft_recorded', (select count(*) from supabase_migrations.schema_migrations where version = '20261023100000'),
  'listed', (select json_agg(json_build_object(
       'step', left(s.id::text, 8), 'task', left(t.id::text, 8), 'who', left(t.assignee_id::text, 8),
       'status', t.status, 'copy', s.max_video_sec, 'step_done', s.completed_at is not null,
       'media', (select count(*) from public.task_media m where m.step_id = s.id),
       'media_uploaded', (select count(*) from public.task_media m where m.step_id = s.id
                          and m.uploaded_at is not null and m.deleted_at is null))
       order by t.scheduled_date, t.started_at)
     from listed l join public.task_steps s on s.id = l.step_id join public.tasks t on t.id = s.task_id),
  'open_steps', (select json_agg(row_to_json(x)) from (
     select t.status, s.max_video_sec as copy, count(*) as steps
     from public.task_steps s join public.tasks t on t.id = s.task_id
     where s.type = 'video' and t.status not in ('done', 'cancelled')
       and s.completed_at is null and s.skipped_at is null and s.waived_at is null
     group by t.status, s.max_video_sec order by t.status, s.max_video_sec) x),
  'new_starts', (select json_agg(row_to_json(y)) from (
     select s.max_video_sec as copy, count(*) as steps
     from public.task_steps s join public.tasks t on t.id = s.task_id
     where s.type = 'video' and t.started_at >= now() - interval '1 day'
     group by s.max_video_sec) y)
) as video_limits_1023;
