-- Videos since a date, per person (docs/video-upload-1022.md). Read-only, one statement, no
-- names: short ids, roles, the platform of the latest push token, counts and sizes only.
--
--   node scripts/cloud-read.mjs docs/rollout/video_upload_probe.sql
--
-- Run before the update over the air that opens the gallery without the photos permission
-- and reports refusals, and again a few days after it: the cleaners with a started cleaning
-- whose required video step has no video should go down, and Sentry should show the issues
-- "Gallery video refused", "Video too large for the storage", "Media upload gave up".
-- Change the date in `since` to the day to start from.
with since as (select timestamptz '2026-10-19 00:00+00' as t),
tok as (
  select distinct on (pt.profile_id) pt.profile_id, pt.platform
  from public.push_tokens pt
  order by pt.profile_id, pt.updated_at desc
),
v as (
  select tm.created_by, tm.source, tm.byte_size, tm.duration_sec,
         tm.uploaded_at is not null and tm.deleted_at is null as is_live,
         tm.uploaded_at is null and tm.deleted_at is null as is_waiting
  from public.task_media tm, since
  where tm.kind = 'video' and tm.created_at >= since.t
),
open_steps as (
  select t.assignee_id, count(*) as n,
         count(*) filter (where t.status = 'expired') as expired
  from public.task_steps ts
  join public.tasks t on t.id = ts.task_id, since
  where ts.type = 'video' and ts.required and t.started_at >= since.t
    and not exists (select 1 from public.task_media tm
                    where tm.step_id = ts.id and tm.kind = 'video'
                      and tm.uploaded_at is not null and tm.deleted_at is null)
  group by t.assignee_id
)
select json_build_object(
  'people', (select json_agg(row_to_json(x) order by x.role, x.live desc) from (
     select left(p.id::text, 8) as who, p.role, tok.platform,
            count(v.*) filter (where v.is_live) as live,
            count(v.*) filter (where v.is_waiting) as waiting,
            count(v.*) filter (where v.source = 'gallery') as gallery,
            round(max(v.byte_size) / 1e6, 1) as max_mb,
            coalesce(max(o.n), 0) as open_required_steps,
            coalesce(max(o.expired), 0) as of_them_expired
     from public.profiles p
     left join tok on tok.profile_id = p.id
     left join v on v.created_by = p.id
     left join open_steps o on o.assignee_id = p.id
     where p.is_active and p.role in ('cleaner', 'tech', 'head_tech')
     group by p.id, p.role, tok.platform) x),
  'bitrate_mbps_by_source', (select json_agg(row_to_json(b)) from (
     select v.source,
            count(*) as videos,
            round(min(v.byte_size * 8.0 / nullif(v.duration_sec, 0) / 1e6)::numeric, 1) as min_mbps,
            round(max(v.byte_size * 8.0 / nullif(v.duration_sec, 0) / 1e6)::numeric, 1) as max_mbps,
            round(max(v.byte_size) / 1e6, 1) as max_mb
     from v group by v.source) b),
  'objects_over_50mb', (select count(*) from storage.objects o
     where o.bucket_id = 'task-media' and (o.metadata ->> 'size')::bigint > 50000000)
) as videos;
