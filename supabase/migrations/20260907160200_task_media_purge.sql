-- F8. Retention: the files of a cleaning go after 90 days, the rows stay.
--
-- A photo proves a flat was left clean; ninety days later that dispute is
-- over and the file is only a bill. The row is kept with purged_at set, so a
-- finished task still says how many photos were taken and when — statistics
-- (F12) count rows, not bytes.
--
-- Deleting an object is a Storage API call, not SQL, so the job is an Edge
-- Function (purge-task-media) that asks the two functions below what to
-- remove and what it has removed. Both are service_role only: the phone has
-- no business with either.
--
-- What is due: a file the cleaner took back (deleted_at) — at once; and every
-- file of a task that has been closed (done, cancelled, expired) for longer
-- than the retention. A task still open keeps its files however old.

create or replace function public.task_media_retention_days()
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$ select 90 $$;

/**
 * The next batch of media whose file should be removed.
 *
 * Oldest first, so a backlog drains in order; bounded, so one run of the job
 * stays inside its timeout. A row without an uploaded file is due too — its
 * object may exist half-written — and the job treats "not found" as done.
 */
create or replace function public.task_media_to_purge(p_limit integer default 200)
returns setof public.task_media
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
  from public.task_media m
  join public.tasks t on t.id = m.task_id
  where m.purged_at is null
    and (m.deleted_at is not null
         or (t.status in ('done', 'cancelled', 'expired')
             and coalesce(t.completed_at, t.updated_at)
                 < now() - make_interval(days => public.task_media_retention_days())))
  order by m.created_at
  limit greatest(coalesce(p_limit, 200), 1)
$$;

/** Record that the files of these rows are gone. Returns how many rows it marked. */
create or replace function public.mark_task_media_purged(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.task_media m
  set purged_at = now()
  where m.id = any (p_ids) and m.purged_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.task_media_retention_days() from public, anon;
revoke all on function public.task_media_to_purge(integer) from public, anon, authenticated;
revoke all on function public.mark_task_media_purged(uuid[]) from public, anon, authenticated;
grant execute on function public.task_media_retention_days() to authenticated, service_role;
grant execute on function public.task_media_to_purge(integer) to service_role;
grant execute on function public.mark_task_media_purged(uuid[]) to service_role;

-- Nightly, after the syncs (20260827210000): the job walks its own table and
-- the Storage API, and touches nothing the syncs touch.
select cron.schedule(
  'purge-task-media-daily',
  '30 4 * * *',
  $$select public.invoke_edge_function('purge-task-media')$$
);
