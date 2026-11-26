-- Rollback of 20261126100000_problem_additions (the office adds photos, videos and a comment to
-- a task; docs/problem-additions-1126.md). One do-block: `npx supabase db query --linked -f` takes
-- one statement. Then: npx supabase migration repair --status reverted 20261126100000 --linked.
--
-- Always: the client levers (add_office_media, publish_office_media), the closing's three new
-- arguments (resolve_problem as of 20261106125000) and the journal's trigger on chat messages go.
-- The panel and the phones before this change call nothing of it.
--
-- Only while nobody has added anything (no row in problem_additions): the table, the column
-- task_media.addition_id with its policy and the owner check, and remove_task_media,
-- task_media_to_purge and mark_signal_false_positive as they were. Once a batch exists they stay:
-- its files keep their owner, their readers and their sweep, and nothing of today reads them.
--
-- Stay in any case: the values media_added and comment_added of problem_event_kind (Postgres
-- drops no enum value) and the journal's rows of those kinds, which every build reads as
-- «Другое событие».
do $rollback$
begin
  set local lock_timeout = '3s';

  drop trigger if exists chat_messages_journal_office on public.chat_messages;
  drop function if exists public.journal_office_comment();

  drop function if exists public.add_office_media(uuid, uuid, uuid, public.media_kind, text,
    integer, integer, integer, numeric, timestamptz, public.media_source);
  drop function if exists public.publish_office_media(uuid);
  drop function if exists public.resolve_problem(uuid, uuid, boolean, uuid, uuid, text);
  drop function if exists public.problem_closing_addition(public.problems, uuid, uuid, text);
  drop function if exists public.publish_problem_addition(uuid, text, uuid);
  drop function if exists public.problem_addition_max_files();

create function public.resolve_problem(
  p_id           uuid,
  p_completed_by uuid default null,
  p_alone        boolean default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
  v_how     text;
begin
  v_problem := public.problem_for_manager(p_id);

  if v_problem.status = 'resolved' then
    return v_problem;
  end if;
  if v_problem.status = 'cancelled' then
    raise exception 'Problem is cancelled and cannot be resolved'
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;

  if p_completed_by is not null and coalesce(p_alone, false) then
    raise exception 'Name the worker or close alone, not both'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.problemCompleterInvalid';
  end if;
  if p_completed_by is not null then
    if not exists (select 1 from public.profiles pr
                   where pr.id = p_completed_by
                     and pr.host_id = v_problem.host_id
                     and pr.role in ('tech', 'head_tech', 'cleaner')) then
      raise exception 'The worker named is not of this company''s staff'
        using errcode = 'check_violation', hint = 'serverErrors.problemCompleterInvalid';
    end if;
    v_how := 'manager_for';
  elsif coalesce(p_alone, false) then
    v_how := 'manager_self';
  end if;

  if v_how is not null then
    perform set_config('str_ops.problem_closing',
                       jsonb_build_object('problem', p_id, 'how', v_how,
                                          'completed_by', p_completed_by)::text,
                       true);
  end if;

  -- The attempt is finished first: the mirror resolves the task. The worker named is its
  -- finisher; otherwise the guard writes the manager, as it always has.
  update public.tasks t
  set status       = 'done',
      completed_by = case when v_how = 'manager_for' then p_completed_by else t.completed_by end
  where t.problem_id = p_id and t.status not in ('done', 'cancelled', 'expired');

  update public.problems p
  set status      = 'resolved',
      resolved_at = coalesce(p.resolved_at, now())
  where p.id = p_id
  returning * into v_problem;

  perform set_config('str_ops.problem_closing', '', true);
  return v_problem;
end;
$$;
  revoke all on function public.resolve_problem(uuid, uuid, boolean) from public, anon;
  grant execute on function public.resolve_problem(uuid, uuid, boolean) to authenticated, service_role;

  if exists (select 1 from public.problem_additions) then
    raise notice 'problem_additions holds batches: their table, files and sweep stay';
    return;
  end if;

create or replace function public.remove_task_media(p_id uuid)
returns public.task_media
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media   public.task_media;
  v_step    public.task_steps;
  v_status  public.problem_status;
begin
  select m.* into v_media
  from public.task_media m
  where m.id = p_id
    and m.host_id = public.current_host_id()
    and m.created_by = (select auth.uid())
  for update;

  if not found then
    raise exception 'Media not found'
      using errcode = 'check_violation', hint = 'serverErrors.mediaNotFound';
  end if;

  if v_media.deleted_at is not null then
    return v_media;
  end if;

  if v_media.message_id is not null then
    if v_media.uploaded_at is not null then
      raise exception 'The photo is part of a sent message and cannot be taken back'
        using errcode = 'check_violation', hint = 'serverErrors.messageMediaSent';
    end if;
  elsif v_media.problem_id is not null then
    select p.status into v_status from public.problems p where p.id = v_media.problem_id for update;
    if v_status <> 'open' then
      raise exception 'Problem is % and its photos can no longer change', v_status
        using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
    end if;
  else
    v_step := public.task_step_for_update(v_media.step_id, true);
    if v_step.completed_at is not null then
      raise exception 'The step is completed; reopen it to change its media'
        using errcode = 'check_violation', hint = 'serverErrors.stepCompleted';
    end if;
  end if;

  update public.task_media m
  set deleted_at = now()
  where m.id = p_id
  returning m.* into v_media;

  return v_media;
end;
$$;
create or replace function public.task_media_to_purge(p_limit integer default 200)
returns setof public.task_media
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
  from public.task_media m
  left join public.chat_messages cm on cm.id = m.message_id
  left join public.chat_threads  th on th.id = cm.thread_id
  left join public.tasks    t on t.id = coalesce(m.task_id, th.task_id)
  left join public.problems p on p.id = coalesce(m.problem_id, th.problem_id)
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
             and m.created_at < now() - public.chat_media_upload_window()))
  order by m.created_at, m.id
  limit greatest(coalesce(p_limit, 200), 1)
$$;
create or replace function public.mark_signal_false_positive(
  p_problem_id uuid,
  p_delete     boolean default false
)
returns public.signal_findings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
  v_finding public.signal_findings;
  v_action  text;
begin
  if not public.is_manager() then
    raise exception 'Only a manager decides about findings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;

  -- The signal first, then the finding, then the problem: the order of
  -- approve and reject, so a manager and the job never wait crosswise.
  perform 1 from public.guest_signals g
  where g.id = (select f.signal_id from public.signal_findings f
                where f.problem_id = p_problem_id
                  and f.host_id = public.current_host_id()
                  and (f.status = 'task_created'
                       or (f.status = 'rejected' and f.reject_reason = 'false_positive'))
                order by f.status = 'task_created' desc
                limit 1)
  for update;
  select * into v_finding from public.signal_findings f
  where f.problem_id = p_problem_id
    and f.host_id = public.current_host_id()
    and (f.status = 'task_created' or (f.status = 'rejected' and f.reject_reason = 'false_positive'))
  order by f.status = 'task_created' desc
  limit 1
  for update;
  if not found then
    raise exception 'Problem % was not made from a guest signal', p_problem_id
      using errcode = 'no_data_found', hint = 'serverErrors.signalProblemNotFromSignal';
  end if;
  if v_finding.status = 'rejected' then
    return v_finding;
  end if;

  -- The lock the dispatch levers take (20261003130000).
  select * into v_problem from public.problems
  where id = p_problem_id and host_id = public.current_host_id()
  for no key update;

  if coalesce(p_delete, false) then
    if v_problem.status <> 'open'
       or exists (select 1 from public.tasks t where t.problem_id = p_problem_id)
       or exists (select 1 from public.task_media m where m.problem_id = p_problem_id)
       or exists (select 1 from public.chat_threads c where c.problem_id = p_problem_id)
       or exists (select 1 from public.signal_findings f
                  where f.problem_id = p_problem_id and f.id <> v_finding.id) then
      raise exception 'Problem % has work on it; it can only be archived', p_problem_id
        using errcode = 'check_violation', hint = 'serverErrors.signalProblemHasWork';
    end if;
    v_action := 'deleted';
  else
    v_action := 'archived';
  end if;

  update public.signal_findings
  set status = 'rejected', reject_reason = 'false_positive', decided_mode = 'manager',
      decided_by = (select auth.uid()), decided_at = now()
  where id = v_finding.id;
  perform public.record_signal_feedback(v_finding.id, 'false_positive', v_action);

  if v_action = 'deleted' then
    -- The finding keeps its verdict; its link goes with the problem (on
    -- delete set null), and so do the problem's own journal rows. Its push
    -- not yet sent stays queued: claim_push_batch settles a problem_new
    -- whose problem is gone as skipped (20261003160000), and this function,
    -- callable by a manager, touches nothing in raw (table_grants.sql).
    delete from public.problems where id = p_problem_id;
  else
    -- As cancel_problem does: a repair left waiting for somebody goes too.
    update public.tasks t
    set status = 'cancelled'
    where t.problem_id = p_problem_id and t.status not in ('done', 'cancelled', 'expired');
    update public.problems
    set status       = case when status in ('open', 'assigned', 'in_progress')
                            then 'cancelled'::public.problem_status else status end,
        cancelled_at = case when status in ('open', 'assigned', 'in_progress')
                            then now() else cancelled_at end,
        archived_at  = coalesce(archived_at, now())
    where id = p_problem_id;
  end if;

  select * into v_finding from public.signal_findings where id = v_finding.id;
  return v_finding;
end;
$$;

  drop policy if exists "addition media is read by whoever reads the addition" on public.task_media;
  alter table public.task_media
    drop constraint task_media_one_owner,
    add constraint task_media_one_owner check (
      (task_id is not null and step_id is not null and problem_id is null and message_id is null)
      or (problem_id is not null and task_id is null and step_id is null and message_id is null)
      or (message_id is not null and task_id is null and step_id is null and problem_id is null)
    );
  alter table public.task_media drop column addition_id;
  drop table public.problem_additions;
end
$rollback$;
