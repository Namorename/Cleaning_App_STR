-- Takes «where a task from a guest came from» away (20261111120000): the page's reader, its helpers and
-- the two API fields. A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC, after
-- the panel is back on the commit before it (git revert on main) and the phones on OTA №17:
--
--   npx supabase db query --linked -f docs/one-off-writes/task-source-rollback.sql
--   npx supabase migration repair --status reverted 20261111120000 --linked
--
-- One statement: db query takes one. Nothing was stored by the migration, so nothing is lost: the
-- API task returns to its shape of 20261106125500 (without source and guest_stay).
do $rollback$
begin
  drop function if exists public.problem_guest_origin(uuid);
  drop function if exists public.api_task_guest_stay(public.problems);
  drop function if exists public.problem_origin_signal(uuid);
  drop function if exists public.guest_stay_json(public.guest_signals);

  -- api_task_json as 20261106125500 wrote it.
  execute $sql$
create or replace function public.api_task_json(p public.problems, p_scopes text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'title', public.api_mask_codes(p.title),
    'description', public.api_mask_codes(p.description),
    'text_masked', public.api_mask_codes(p.title) is distinct from p.title
                   or public.api_mask_codes(p.description) is distinct from p.description
                   or public.api_mask_codes(p.cancel_reason) is distinct from p.cancel_reason,
    'priority', p.priority,
    'status', p.status,
    'property_id', p.property_id,
    'cleaning_id', p.task_id,
    'reported_by', p.reported_by,
    'archived', p.archived_at is not null,
    'cancel_reason', public.api_mask_codes(p.cancel_reason),
    'work', (select jsonb_build_object(
                      'cleaning_id', w.id,
                      'status', w.status,
                      'assignee_id', w.assignee_id,
                      'scheduled_date', w.scheduled_date,
                      'time_from', public.api_hm(w.time_from),
                      'time_to', public.api_hm(w.time_to))
             from public.tasks w
             where w.problem_id = p.id and w.host_id = p.host_id and w.type = 'maintenance'
             order by w.created_at desc, w.id desc
             limit 1),
    'created_at', public.api_ts(p.created_at),
    'updated_at', public.api_ts(p.updated_at),
    'resolved_at', public.api_ts(p.resolved_at),
    'cancelled_at', public.api_ts(p.cancelled_at),
    'archived_at', public.api_ts(p.archived_at),
    'completed_by', public.api_task_person_json(p.completed_by, p.host_id, p_scopes),
    'completed_by_source', p.completed_by_source,
    'closed_by', public.api_task_person_json(p.closed_by, p.host_id, p_scopes),
    'closed_how', p.closed_how,
    'closed_cause', p.closed_cause,
    'closed_at', public.api_ts(p.closed_at))
$$;
  $sql$;
  revoke all on function public.api_task_json(public.problems, text[])
    from public, anon, authenticated, service_role;
end;
$rollback$;
