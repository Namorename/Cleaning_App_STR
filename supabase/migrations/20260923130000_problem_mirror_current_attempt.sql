-- A problem's status follows its current repair; the nightly sweep no longer
-- closes repairs; an archived problem cannot be handed out.
--
-- WHAT WAS WRONG, reproduced on 2026-09-23 (supabase/tests/problem_mirror.sql):
--
-- 1. The sweep closed repairs. public.expire_stale_tasks() (20260904120100)
--    expires every live task one day past its date -- a grace reasoned for
--    cleanings, where the guest has arrived and the work is moot. It predates
--    problems and has no type filter, so it also closed repairs, started ones
--    included: on its day + 2 a repair in progress became `expired`, the
--    problem jumped from in_progress to open, the technician got taskClosed
--    when finishing and lost the report and its chat (the fixer's policy
--    excludes expired tasks). An executor cannot pause a repair, so one
--    waiting for a part died overnight.
-- 2. The mirror copied whichever row changed. public.mirror_problem_status()
--    (20260908130000) mapped NEW alone onto the problem: a write to a
--    superseded attempt reopened a resolved problem and wiped resolved_at, an
--    inserted finished attempt resolved a problem whose live repair was still
--    open, a deleted or re-pointed fix task left its problem at `assigned`
--    with no attempt (no DELETE branch, OLD.problem_id never read), and one
--    statement over two attempts gave a result that depended on row order.
--    The shipped panel reaches the first case: "take the technician off"
--    cancelled the task by id, so a stale screen turned a repair the
--    technician had just finished into `cancelled` (the panel now writes only
--    to a live task; apps/web, same change).
-- 3. assign_problem refused resolved and cancelled problems but not archived
--    ones, and the sweep then rewrote an archived problem's status.
--
-- Production on 2026-09-23 (read-only probe before this migration): six
-- problems, one with fix attempts, and none of the damage classes above -- no
-- expired repair, no status out of step with its live attempt, no archived
-- problem. Nothing to repair by hand.
--
-- THE RULES FROM HERE ON (owner's decisions, 2026-09-23):
--
-- * A repair ends only by its technician finishing it or a manager's lever
--   (resolve, cancel, take the technician off, archive). The sweep keeps
--   closing cleanings and hand-made tasks exactly as before; it skips every
--   task with a problem_id. Accepted costs, written down so nobody rediscovers
--   them as bugs: an overdue repair gives no automatic signal and sits in its
--   column with a past date until a manager acts; a repair held by a
--   technician who has since been deactivated stays `assigned`; a started
--   repair left unfinished keeps counting as that technician's running task
--   for the parallel-start rule; its step photos wait for it to close before
--   their retention clock starts; and once its date is more than
--   HISTORY_DAYS (30) behind, the panel's Tasks section no longer lists it
--   -- it stays on the Problems board, with its technician.
-- * Only the problem's current attempt speaks for it. That is the one live
--   fix task (tasks_one_fix_per_problem allows at most one), or the row that
--   stops being live in this very write. Live: unassigned -> open,
--   assigned/accepted -> assigned, in_progress/paused/blocked -> in_progress.
--   Closing: done -> resolved, cancelled/expired -> open -- the flat is still
--   broken, as the old header said, and the panel's "take the technician off"
--   relies on it. A live fix task deleted or moved to another problem leaves
--   its old problem open. A row that was not live before and is not live
--   after is history and speaks for nobody.
-- * A cancelled problem is never touched (cancel_problem writes the problem
--   before its task). An archived problem is not touched either -- the
--   archive promises "a restored problem comes back in the status it had" --
--   with one exception: a repair that finishes still resolves it, so
--   finished work is not lost in the archive. archive_problem cancels the
--   live task before stamping archived_at, so archiving still reads open.
--   unarchive_problem does not re-derive the status: a live attempt written
--   by hand while the problem sat in the archive stays unmirrored until its
--   next change. No panel path does that.
-- * assign_problem refuses an archived problem (serverErrors.problemArchived).
-- * Only a manager links a task to a problem, and only within the company.
--   guard_task_fields now pins problem_id for an executor like every other
--   planning field: pointing her own task at a problem handed her its report
--   and chat (the fixer's policy follows the link) and let her drive its
--   status. And the mirror touches a problem only of the task's own company:
--   tasks.problem_id is a plain foreign key, and the mirror runs as definer.
--
-- LOCKS. The trigger is replaced with `create or replace trigger`, which takes
-- SHARE ROW EXCLUSIVE on public.tasks; drop + create would take ACCESS
-- EXCLUSIVE and block every read of tasks until commit. lock_timeout makes a
-- busy table fail the push instead of queueing everything behind it. The
-- interactive lock order stays inverted -- problem RPCs lock the problem
-- first, a task write reaches the problem through this trigger -- so an
-- assign_problem racing a technician's own status change can end one side
-- with a deadlock error. No data is lost; it is accepted as the tail of an
-- interactive race. The nightly sweep no longer takes that path at all.

set local lock_timeout = '5s';

create or replace function public.mirror_problem_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_live boolean;
  v_is_live  boolean;
  v_status   public.problem_status;
begin
  v_was_live := tg_op in ('UPDATE', 'DELETE') and old.problem_id is not null
                and old.status not in ('done', 'cancelled', 'expired');
  v_is_live  := tg_op in ('INSERT', 'UPDATE') and new.problem_id is not null
                and new.status not in ('done', 'cancelled', 'expired');

  -- The live attempt left its problem, deleted or pointed elsewhere: nobody
  -- holds that problem now.
  if v_was_live and (tg_op = 'DELETE' or new.problem_id is distinct from old.problem_id) then
    update public.problems p
    set status = 'open'
    where p.id = old.problem_id
      and p.host_id = old.host_id
      and p.status in ('assigned', 'in_progress')
      and p.archived_at is null
      and not exists (select 1 from public.tasks t
                      where t.problem_id = p.id and t.id <> old.id
                        and t.status not in ('done', 'cancelled', 'expired'));
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and old.status = new.status
     and old.problem_id is not distinct from new.problem_id then
    return new;
  end if;

  if v_is_live then
    v_status := case new.status
      when 'unassigned' then 'open'
      when 'assigned'   then 'assigned'
      when 'accepted'   then 'assigned'
      else 'in_progress'
    end;
  elsif v_was_live and new.problem_id = old.problem_id then
    -- The current attempt just closed.
    v_status := case when new.status = 'done' then 'resolved' else 'open' end;
  else
    -- A write to history: an attempt that is not live speaks for nobody.
    return new;
  end if;

  update public.problems p
  set status      = v_status,
      resolved_at = case when v_status = 'resolved'
                         then coalesce(p.resolved_at, new.completed_at, now()) end
  where p.id = new.problem_id
    and p.host_id = new.host_id
    and p.status <> 'cancelled'
    and p.status <> v_status
    and (p.archived_at is null or v_status = 'resolved')
    -- A live attempt speaks for itself; a closing one only if no other
    -- attempt is live (a manager's direct write can open one beside it).
    and (v_is_live or not exists (select 1 from public.tasks t
                                  where t.problem_id = p.id and t.id <> new.id
                                    and t.status not in ('done', 'cancelled', 'expired')));
  return new;
end;
$$;

create or replace trigger tasks_mirror_problem
  after insert or update of status, problem_id or delete on public.tasks
  for each row execute function public.mirror_problem_status();

/**
 * What an executor may not change on her own task.
 *
 * Unchanged from 20260910140000 apart from problem_id, which joins the pinned
 * fields: an executor pointing her task at a problem would hand herself the
 * report and its chat (the fixer's policy follows the link) and drive the
 * problem's status through the mirror above.
 */
create or replace function public.guard_task_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if old.started_at is not null then
    new.started_at := old.started_at;
  end if;
  if old.completed_at is not null then
    new.completed_at := old.completed_at;
  end if;

  -- Who asked for the job is a record, not a field: nobody rewrites it.
  new.created_by := old.created_by;

  if not public.is_manager() then
    if old.status in ('done', 'cancelled', 'expired') then
      raise exception 'Task is % and cannot be changed by its executor', old.status
        using errcode = 'check_violation',
              hint = 'serverErrors.taskClosed',
              detail = jsonb_build_object('status', old.status)::text;
    end if;

    -- assignee_id is deliberately NOT reverted here: a change of owner is
    -- caught by the policy's WITH CHECK, which says so. A silent revert here
    -- would intercept it before the check, and the client would read the
    -- handover as a save that worked.
    new.property_id           := old.property_id;
    new.reservation_id        := old.reservation_id;
    new.type                  := old.type;
    new.priority              := old.priority;
    new.scheduled_date        := old.scheduled_date;
    new.due_at                := old.due_at;
    new.time_from             := old.time_from;
    new.time_to               := old.time_to;
    new.guests_count          := old.guests_count;
    new.started_at            := old.started_at;
    new.completed_at          := old.completed_at;
    new.completed_by          := old.completed_by;
    new.is_parallel           := old.is_parallel;
    new.duration_override_min := old.duration_override_min;
    new.title                 := old.title;
    new.title_i18n            := old.title_i18n;
    -- Which problem a task repairs is the manager's to say (20260923130000).
    new.problem_id            := old.problem_id;
  end if;

  return new;
end;
$$;

/**
 * Close what the day has passed by.
 *
 * Cleanings and hand-made tasks, one day of grace (task_grace_days). Repairs
 * -- tasks with a problem_id -- are not the sweep's: they end by their
 * technician or a manager (20260923130000).
 */
create or replace function public.expire_stale_tasks()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unclaimed  integer;
  v_unfinished integer;
begin
  with swept as (
    update public.tasks t
    set status = 'expired'
    where t.status not in ('done', 'cancelled', 'expired')
      and t.problem_id is null
      and public.task_is_stale(t.property_id, t.scheduled_date)
    returning t.assignee_id
  )
  select count(*) filter (where assignee_id is null),
         count(*) filter (where assignee_id is not null)
    into v_unclaimed, v_unfinished
  from swept;

  return jsonb_build_object(
    'expired_unclaimed', v_unclaimed,
    'expired_unfinished', v_unfinished
  );
end;
$$;

revoke all on function public.expire_stale_tasks() from public, anon, authenticated;
grant execute on function public.expire_stale_tasks() to service_role;

/**
 * Hand the problem to a technician: the fix task is created, or moved when
 * one is already open. The task starts as 'assigned'; the problem follows.
 *
 * Unchanged from 20260908130000 apart from the refusal of an archived
 * problem: the panel hides the button, and now the server refuses too.
 */
create or replace function public.assign_problem(
  p_id             uuid,
  p_assignee_id    uuid,
  p_scheduled_date date default null,
  p_time_from      time default null,
  p_time_to        time default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
  v_task_id uuid;
  v_date    date;
begin
  v_problem := public.problem_for_manager(p_id);

  if v_problem.status in ('resolved', 'cancelled') then
    raise exception 'Problem is % and cannot be assigned', v_problem.status
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;
  if v_problem.archived_at is not null then
    raise exception 'Problem is archived and cannot be assigned'
      using errcode = 'check_violation', hint = 'serverErrors.problemArchived';
  end if;
  if v_problem.property_id is null then
    raise exception 'A problem without a listing cannot be scheduled'
      using errcode = 'check_violation', hint = 'serverErrors.problemNoProperty';
  end if;
  if not exists (select 1 from public.profiles pr
                 where pr.id = p_assignee_id
                   and pr.host_id = v_problem.host_id
                   and pr.is_active) then
    raise exception 'Assignee is not an active member of this company'
      using errcode = 'check_violation', hint = 'serverErrors.problemAssigneeInvalid';
  end if;

  v_date := coalesce(
    p_scheduled_date,
    (select (now() at time zone pr.timezone)::date
     from public.properties pr where pr.id = v_problem.property_id));

  select t.id into v_task_id
  from public.tasks t
  where t.problem_id = p_id and t.status not in ('done', 'cancelled', 'expired')
  for update;

  if found then
    update public.tasks t
    set assignee_id    = p_assignee_id,
        status         = case when t.status = 'unassigned' then 'assigned' else t.status end,
        scheduled_date = v_date,
        time_from      = p_time_from,
        time_to        = p_time_to
    where t.id = v_task_id;
  else
    insert into public.tasks (
      host_id, property_id, type, status, priority, assignee_id,
      scheduled_date, time_from, time_to, notes, problem_id
    ) values (
      v_problem.host_id, v_problem.property_id, 'maintenance', 'assigned', 0, p_assignee_id,
      v_date, p_time_from, p_time_to, v_problem.description, p_id
    );
  end if;

  select p.* into v_problem from public.problems p where p.id = p_id;
  return v_problem;
end;
$$;

revoke all on function public.assign_problem(uuid, uuid, date, time, time) from public, anon;
grant execute on function public.assign_problem(uuid, uuid, date, time, time) to authenticated, service_role;
