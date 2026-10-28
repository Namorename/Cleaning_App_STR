-- Launch reset of 2026-10-16, stage 2, pass 1: the files go first (docs/launch-reset-2026-10-16.md).
--
-- Deleting a task_media row leaves its file in the task-media bucket for ever: storage.objects
-- has no foreign key to it and the retention walks rows, not the bucket. So every row pass 2 will
-- delete is marked deleted here, and the retention (purge-task-media, the only code that removes
-- objects — CLAUDE.md, «Медиа уборки») removes its file and stamps purged_at. The sets are the
-- ones of docs/rollout/launch_reset_1016_probe.sql: cleanings before the bound, the demo listing,
-- every problem and its repairs, and the chat messages on their threads and on the direct threads
-- of every account that goes.
--
-- Run with the owner's word, outside 03:00–04:40 UTC:
--   npx supabase db query --linked -f docs/one-off-writes/launch-reset-1016-pass1-media.sql
-- Then wait two minutes and check:
--   node scripts/cloud-read.mjs docs/rollout/launch_reset_1016_after.sql
--   media.marked_unpurged 0 and media.marked_files 0; otherwise run this file again (a second run
--   marks nothing new and only wakes the retention).
-- Nothing else changes: the rows stay until pass 2, the phone and the panel stop showing them.
do $$
declare
  c_bound      constant date   := date '2026-10-15';
  c_demo       constant bigint := 900000000001;
  c_keep_email constant text   := 'wagnerstays@gmail.com';
  v_keep   uuid;
  v_gone   uuid[];
  v_marked bigint;
begin
  -- Exactly one active manager stays; with none or two the pass stops here (strict).
  select u.id into strict v_keep
  from auth.users u join public.profiles p on p.id = u.id
  where lower(u.email) = c_keep_email and p.role = 'manager' and p.is_active;

  select coalesce(array_agg(u.id), '{}') into v_gone from auth.users u where u.id <> v_keep;

  update public.task_media m
     set deleted_at = now()
   where m.deleted_at is null
     and (m.problem_id is not null
          or m.task_id in (select t.id from public.tasks t
                           where t.scheduled_date < c_bound or t.property_id = c_demo
                              or t.problem_id is not null)
          or m.message_id in (select cm.id
                              from public.chat_messages cm
                              join public.chat_threads ct on ct.id = cm.thread_id
                              where ct.problem_id is not null
                                 or ct.profile_id = any (v_gone)
                                 or ct.task_id in (select t.id from public.tasks t
                                                   where t.scheduled_date < c_bound
                                                      or t.property_id = c_demo
                                                      or t.problem_id is not null)));
  get diagnostics v_marked = row_count;
  raise notice 'task_media rows marked deleted: %', v_marked;

  -- The request leaves after commit (pg_net); the function deletes up to 2 000 files a run.
  perform public.invoke_edge_function('purge-task-media');
end
$$;
