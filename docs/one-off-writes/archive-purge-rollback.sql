-- Rollback of 20261126150000_archive_purge (deleting for good from the archives; the migration's
-- head comment). One statement, so `supabase db query --linked -f` takes it whole; then
-- `npx supabase migration repair --status reverted 20261126150000 --linked`.
--
-- Order: the code first (main back: the panel's «Удалить навсегда» buttons call these functions),
-- then this. What it undoes: the three delete functions, the trigger that queues the files of
-- deleted media rows, the queue itself, and task_media_to_purge and mark_task_media_purged as they
-- were (taken from the stand before the migration: task_media_to_purge of 20261126100000,
-- mark_task_media_purged of 20260907160200; prosrc md5 10b7eaf4750b208b0d2d43f470306f14 and
-- b6aa079f93dec755de55be5c7dd87150).
--
-- What it cannot undo: whatever was deleted is gone for good — boards, cards, tasks, repairs,
-- journals, conversations and the files. Restoring them means the daily backup (Supabase Pro).
--
-- It refuses while the queue still holds files: dropping it would leave those files in the bucket
-- with no row and no purge ever reaching them. Invoke purge-task-media (or wait for its run at
-- 04:30 UTC) and run this again.
do $undo$
declare
  v_waiting bigint;
begin
  perform set_config('lock_timeout', '3s', true);
  if to_regclass('raw.task_media_orphans') is null then
    raise notice '20261126150000 is not in this database: nothing to undo';
    return;
  end if;

  drop function if exists public.delete_archived_board(uuid);
  drop function if exists public.delete_shelved_board_card(uuid);
  drop function if exists public.delete_archived_problem(uuid);
  drop trigger if exists task_media_queue_orphan on public.task_media;
  drop function if exists public.queue_orphaned_media();

  select count(*) into v_waiting from raw.task_media_orphans;
  if v_waiting > 0 then
    raise exception '% files of deleted media rows still wait for purge-task-media: run it, then this again',
      v_waiting;
  end if;

  execute $q$
CREATE OR REPLACE FUNCTION public.task_media_to_purge(p_limit integer DEFAULT 200)
 RETURNS SETOF task_media
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select m.*
  from public.task_media m
  left join public.chat_messages cm on cm.id = m.message_id
  left join public.chat_threads  th on th.id = cm.thread_id
  left join public.problem_additions a on a.id = m.addition_id
  left join public.tasks    t on t.id = coalesce(m.task_id, th.task_id)
  left join public.problems p on p.id = coalesce(m.problem_id, th.problem_id, a.problem_id)
  where m.purged_at is null
    and (m.deleted_at is not null
         or (t.status in ('done', 'cancelled', 'expired')
             and coalesce(t.completed_at, t.updated_at)
                 < now() - make_interval(days => public.task_media_retention_days())
             and (m.message_id is null
                  or cm.created_at < now() - make_interval(days => public.task_media_retention_days())))
         or (p.status in ('resolved', 'cancelled')
             and coalesce(p.resolved_at, p.cancelled_at, p.updated_at)
                 < now() - make_interval(days => public.task_media_retention_days())
             and (m.message_id is null
                  or cm.created_at < now() - make_interval(days => public.task_media_retention_days())))
         or (th.kind = 'direct'
             and cm.created_at
                 < now() - make_interval(days => public.task_media_retention_days()))
         or (m.message_id is not null
             and m.uploaded_at is null
             and m.created_at < now() - public.chat_media_upload_window())
         or (m.addition_id is not null
             and a.published_at is null
             and m.created_at < now() - public.chat_media_upload_window()))
  order by m.created_at, m.id
  limit greatest(coalesce(p_limit, 200), 1)
$function$
$q$;

  execute $q$
CREATE OR REPLACE FUNCTION public.mark_task_media_purged(p_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  update public.task_media m
  set purged_at = now()
  where m.id = any (p_ids) and m.purged_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
$q$;

  drop table raw.task_media_orphans;
end
$undo$;
