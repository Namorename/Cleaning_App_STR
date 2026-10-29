-- Rollback of docs/one-off-writes/video-limits-1023-unstick.sql: the listed steps get back
-- the copy they held. A WRITE to the cloud: only on the owner's word, never in
-- 03:00–04:40 UTC. Touches only a listed step whose copy is empty, whatever its cleaning's
-- state now, so the copies are as before the write (updated_at moves on, task_steps_touch).
-- With the draft migration 20261023100000 in the cloud the copy limits nothing either way;
-- without it, the old rule applies again: min(copy, company).
--
--   npx supabase db query --linked -f docs/one-off-writes/video-limits-1023-unstick-rollback.sql
--   node scripts/cloud-read.mjs docs/rollout/video_limits_1023_probe.sql
do $$
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

  update public.task_steps s
  set max_video_sec = l.copy
  from unstick_list l
  where s.id = l.step_id
    and s.type = 'video'
    and s.max_video_sec is null;
end;
$$;
