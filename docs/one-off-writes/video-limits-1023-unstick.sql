-- One-off write: the video steps of started cleanings take the company's length of now
-- (docs/video-limits-1023.md, section 6). A WRITE to the cloud: only on the owner's word,
-- never in 03:00–04:40 UTC.
--
-- On 22.10 the company went to 180 s, while these 8 open video steps of cleanings in progress
-- hold the 120 s their step copied from the process at the start. The phones in the field
-- (every 1.2.0 build) and add_task_media both take min(copy ?? company, company): an empty
-- copy is the company's number of the moment, for the old phones and the new, with or without
-- the draft migration 20261023100000. Nothing else changes but updated_at of the touched rows
-- (task_steps_touch): no status, no other column, no media, no finished row.
--
-- The list is the read of 2026-10-23 18:15 UTC (step id, the copy it holds; the comment is
-- the cleaning's short id, the cleaner's short id and the day). A row is touched only while
-- its cleaning is still in progress, its step still open and its copy still that number:
-- the night's sweep closes the cleanings of 22.10 at 03:30 UTC on 24.10 and that of 23.10
-- at 03:30 UTC on 25.10, and those are skipped, not an error. A cleaning started after the
-- read is not in the list: clear the process's video length box first, so no new copy is made.
--
-- Gates, each rolls the whole write back: the listed steps are not of one company; the
-- company allows less than a copy (emptying it would shorten her limit, not lengthen it);
-- nothing left to touch; a different number of rows changed than were open a moment before.
--
-- Run, then read:
--   npx supabase db query --linked -f docs/one-off-writes/video-limits-1023-unstick.sql
--   node scripts/cloud-read.mjs docs/rollout/video_limits_1023_probe.sql
-- Rollback: docs/one-off-writes/video-limits-1023-unstick-rollback.sql.
do $$
declare
  v_hosts   uuid[];
  v_company integer;
  v_open    integer;
  v_n       integer;
begin
  perform set_config('lock_timeout', '5s', true);

  drop table if exists pg_temp.unstick_list;
  create temp table unstick_list (step_id uuid primary key, copy integer not null) on commit drop;
  insert into unstick_list (step_id, copy) values
      ('5c0e5baf-a7b3-4dbf-a84b-5353d9a854b1'::uuid, 120),  -- 58c63431 12b1defa 2026-10-22
      ('07d45f7e-5df1-4714-8548-1f8b646e2d91'::uuid, 120),  -- aeca996d 12b1defa 2026-10-22
      ('0ddaa883-cb30-489e-94c4-4d80cd14b413'::uuid, 120),  -- e7720e8e 58065555 2026-10-22
      ('4a8456b6-658b-469d-9fcf-b7ff3378fd65'::uuid, 120),  -- bfcdf0fc eff885d8 2026-10-22
      ('2da4b127-ba92-4493-a380-211718516013'::uuid, 120),  -- 407f353c 35ed9cc9 2026-10-22
      ('c5ec0adc-ec7a-4b26-9dfd-80763079f645'::uuid, 120),  -- 62b30f72 35ed9cc9 2026-10-22
      ('57c60b50-5eaf-40e6-99d1-c7510ecd750d'::uuid, 120),  -- 9a01fd56 c1670aea 2026-10-22
      ('bc94071c-5866-43ea-ba71-b350ac48c4b3'::uuid, 120);  -- 4cae95b1 35ed9cc9 2026-10-23

  select array_agg(distinct s.host_id) into v_hosts
  from unstick_list l join public.task_steps s on s.id = l.step_id;
  if coalesce(array_length(v_hosts, 1), 0) <> 1 then
    raise exception 'The listed steps belong to % companies, not one', coalesce(array_length(v_hosts, 1), 0);
  end if;

  select h.video_max_sec into v_company from public.hosts h where h.id = v_hosts[1];
  if v_company < (select max(l.copy) from unstick_list l) then
    raise exception 'The company allows % s, less than a copy: nothing to gain', v_company;
  end if;

  select count(*) into v_open
  from unstick_list l
  join public.task_steps s on s.id = l.step_id
  join public.tasks t on t.id = s.task_id
  where t.status = 'in_progress'
    and s.type = 'video'
    and s.max_video_sec = l.copy
    and s.completed_at is null and s.skipped_at is null and s.waived_at is null;
  if v_open = 0 then
    raise exception 'Nothing to touch: every listed cleaning is closed or its step finished';
  end if;

  update public.task_steps s
  set max_video_sec = null
  from unstick_list l, public.tasks t
  where s.id = l.step_id
    and t.id = s.task_id
    and t.status = 'in_progress'
    and s.type = 'video'
    and s.max_video_sec = l.copy
    and s.completed_at is null and s.skipped_at is null and s.waived_at is null;
  get diagnostics v_n = row_count;

  if v_n <> v_open then
    raise exception 'Touched % rows where % were open a moment before: written nothing', v_n, v_open;
  end if;
end;
$$;
