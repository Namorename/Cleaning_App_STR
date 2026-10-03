-- The head technician hands repairs out (docs/tech-plan.md, 3.3; owner's
-- decisions 1 and 8 of 2026-10-01).
--
-- He hands a task (problem) to a technician — himself among them — moves it to
-- another day or hours, gives it to another technician, and takes a
-- technician off it. Cancelling, closing and archiving a task stay with the
-- manager. What changes:
--
-- - problem_for_dispatch: problem_for_manager's twin that lets the head
--   technician through too. assign_problem uses it; cancel_problem,
--   resolve_problem, archive_problem, reopen_problem and unarchive_problem keep
--   problem_for_manager.
--
-- - the lock both take on the task's row: FOR NO KEY UPDATE, not FOR UPDATE.
--   FOR UPDATE also stops FOR KEY SHARE, which the foreign keys to problems
--   take for every row written that points at the task — a journal row
--   (problem_events), an attempt inserted or re-pointed (tasks.problem_id), a
--   photo or a thread. A technician's accept or a manager's save_task on the
--   repair writes the journal while it holds the attempt, and the dispatcher,
--   holding the task's row, then wants the attempt: the pair ended in a
--   deadlock (40P01) — reproduced in two sessions on 2026-10-03, both gone with
--   the weaker lock. Nothing needs the stronger one: no key of problems is ever
--   written (its only unique index is the primary key). Of the rows pointing at
--   the task, the seven callers read only its attempts, and an attempt is
--   written only by assign_problem, which waits at this same lock — save_task
--   and the panel never write tasks.problem_id; one written by hand beside a
--   dispatch meets tasks_one_fix_per_problem. Dispatchers and levers still
--   wait for each other, and for the mirror's update of the task's status.
--   problem_for_manager last lived in 20260908130000 and changes here, in its
--   lock alone.
--
-- - assign_problem: the head technician hands work to technicians only (tech
--   or head_tech); the manager, as before, to whoever is on the spot. The
--   person who already holds the live attempt may be moved by him to another
--   day or hours whatever her role: he may take a cleaner off a repair
--   (decision 17 of 2026-10-03), and a move is less. The live attempt is
--   looked up among the task's repairs alone (type 'maintenance'), as
--   unassign_problem takes it: a live row of another kind that carries the
--   problem_id is not rewritten, and since a problem has one live task
--   (tasks_one_fix_per_problem) the call is refused (problemNotOpen) instead
--   of opening an attempt beside it. Last writer wins, as before —
--   two dispatchers meet on the task's row and the second overwrites the
--   first (docs/tech-plan.md, 3.3).
--
-- - unassign_problem(p_task_id, p_expected_assignee): taking a technician off
--   a repair. Until now it was the manager's direct write (the panel's
--   cancelLiveTask): the attempt is cancelled, the mirror puts the task back
--   to 'open', and the technician loses the task and its conversation
--   (20260918110000). The head technician is not the assignee and has no
--   write on tasks, so it is a function, for both. It takes the attempt by id,
--   as the panel does: a click on a screen that is minutes old lands on
--   nothing (taskChangedMeanwhile) instead of on an attempt opened since. With
--   p_expected_assignee — whom the screen showed — a screen that showed
--   somebody else than the attempt now has is told the same, and nobody is
--   taken off: it must not take off a person it never showed. Null, the
--   default, asks nothing. No caller yet: the panel moves to it after the push
--   (docs/tech-plan.md §12).
--
-- - both guards on tasks: for anybody but a manager they hold the day, the
--   hours and the other fields of a task (guard_task_fields, silently) and
--   allow only the executor's moves of status (guard_task_transitions, with a
--   refusal). The head technician's reassignment and move would be put back
--   in silence, and an accepted attempt could not go back to 'assigned'. The
--   two dispatch functions switch on a transaction-local setting for their one
--   write, and the guards treat a write made under it by the head technician
--   as the office's (head_tech_dispatching()). Not his role alone: his own
--   repair, written directly, stays an executor's write. No client can set
--   the setting: PostgREST exposes no set_config, and nothing of ours takes a
--   setting name from a caller.
--
-- Bodies are copied from their latest migrations (assign_problem,
-- guard_task_fields and guard_task_transitions from 20260928110000,
-- problem_for_manager from 20260908130000) with only the changes above. Same
-- signatures, so the ACLs and the generated types stay as they are, except
-- unassign_problem, which is new. No table changes.
--
-- Lock order: a dispatch locks the task's row (problem_for_dispatch), then the
-- attempt's; a direct write of the attempt that moves the task's status — the
-- panel's cancelLiveTask, a technician's start or finish — locks the attempt,
-- then the task's row through the mirror's update. The two racing on one task
-- may end in a deadlock (40P01), one of them refused and nothing half-written:
-- the inverted order 20260923130000 accepted. A write of the attempt that
-- leaves the task's status as it is (an accept, a save of the hours) only
-- journals, and no longer meets the dispatch at all. The panel's take-off
-- moving to unassign_problem removes the likely pair (docs/tech-plan.md §12).

set local lock_timeout = '3s';

-- ---------- who may dispatch ----------

create or replace function public.problem_for_dispatch(p_id uuid)
returns public.problems
language plpgsql
set search_path = ''
as $$
declare
  v_problem public.problems;
begin
  if not (public.is_manager() or public.is_head_tech()) then
    raise exception 'Only a manager or the head technician may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOrHeadTechOnly';
  end if;

  -- No key update: dispatchers wait for each other here, while a row that
  -- only points at the task (its journal, an attempt) is written beside it.
  select p.* into v_problem
  from public.problems p
  where p.id = p_id and p.host_id = public.current_host_id()
  for no key update;
  if not found then
    raise exception 'Problem not found'
      using errcode = 'check_violation', hint = 'serverErrors.problemNotFound';
  end if;

  return v_problem;
end;
$$;

comment on function public.problem_for_dispatch(uuid) is
  'problem_for_manager for handing a task out: the manager or the head technician '
  '(decision 1 of 2026-10-01, 20261003130000). Locks the row for no key update.';

-- The manager's levers take the task's row the same way (cancel_problem,
-- resolve_problem, reopen_problem, archive_problem, unarchive_problem). Body
-- from 20260908130000 with only the lock changed; same signature and ACL.
create or replace function public.problem_for_manager(p_id uuid)
returns public.problems
language plpgsql
set search_path = ''
as $$
declare
  v_problem public.problems;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  -- No key update, as problem_for_dispatch (20261003130000).
  select p.* into v_problem
  from public.problems p
  where p.id = p_id and p.host_id = public.current_host_id()
  for no key update;
  if not found then
    raise exception 'Problem not found'
      using errcode = 'check_violation', hint = 'serverErrors.problemNotFound';
  end if;

  return v_problem;
end;
$$;

comment on function public.problem_for_manager(uuid) is
  'The task (problem) for a manager''s lever, locked for no key update '
  '(20260908130000; the lock since 20261003130000).';

-- The setting the two dispatch functions switch on around their write, asked
-- by the guards on tasks. Both halves: the setting alone says nothing about
-- who wrote, and the role alone would make every write of his an office's.
create or replace function public.head_tech_dispatching()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(current_setting('str_ops.head_tech_dispatch', true), '') = 'on'
         and public.is_head_tech()
$$;

comment on function public.head_tech_dispatching() is
  'Inside assign_problem or unassign_problem, called by the head technician: the '
  'guards on tasks let the write through as the office''s (20261003130000).';

revoke all on function public.problem_for_dispatch(uuid) from public, anon, authenticated;
revoke all on function public.problem_for_manager(uuid) from public, anon, authenticated;
revoke all on function public.head_tech_dispatching() from public, anon, authenticated;

-- ---------- the guards ----------

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

  -- Who asked for the job, and when, is a record, not a field: nobody
  -- rewrites it.
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  -- The head technician dispatching a repair writes as the office does: who
  -- does it, the day and the hours (assign_problem, unassign_problem;
  -- 20261003130000). His own writes stay an executor's.
  if not (public.is_manager() or public.head_tech_dispatching()) then
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
    -- The instructions are the office's word (save_task writes them).
    new.notes                 := old.notes;
    -- Which problem a task repairs is the manager's to say (20260923130000).
    new.problem_id            := old.problem_id;
    -- So is a manager's move of a booking's cleaning (20260926160000).
    new.pinned_arrival        := old.pinned_arrival;
    new.pinned_departure      := old.pinned_departure;
    new.pinned_rooms          := old.pinned_rooms;
  end if;

  return new;
end;
$$;

create or replace function public.guard_task_transitions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_running   integer;
  v_allowed   boolean;
  v_remaining integer;
  v_opens_at  timestamptz;
  v_timezone  text;
  v_office    boolean;
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  -- The office: a manager, or the head technician dispatching a repair
  -- through assign_problem or unassign_problem (20261003130000). Asked once.
  v_office := public.is_manager() or public.head_tech_dispatching();

  -- A take says so: an executor who puts her name on free work moves it out
  -- of 'unassigned'. Her name on a row left 'unassigned' would make it neither
  -- free (gone from the queue) nor hers (nothing says she took it) — night
  -- review 2026-09-29. The trigger wakes for assignee_id too, for this.
  if new.status = 'unassigned'
     and new.assignee_id is distinct from old.assignee_id
     and not v_office then
    raise exception 'An executor takes free work by moving it out of unassigned'
      using errcode = 'check_violation',
            hint = 'serverErrors.transitionNotAllowed',
            detail = jsonb_build_object('from', old.status, 'to', new.status)::text;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not v_office
     and not (
       (old.status = 'unassigned'  and new.status in ('assigned', 'accepted')) or
       (old.status = 'assigned'    and new.status in ('accepted', 'in_progress')) or
       (old.status = 'accepted'    and new.status = 'in_progress') or
       (old.status = 'in_progress' and new.status = 'done')
     ) then
    raise exception 'Move % -> % is not available to an executor', old.status, new.status
      using errcode = 'check_violation',
            hint = 'serverErrors.transitionNotAllowed',
            detail = jsonb_build_object('from', old.status, 'to', new.status)::text;
  end if;

  if new.status = 'in_progress' then
    if not v_office then
      v_opens_at := public.task_start_not_before(new.property_id, new.scheduled_date, new.time_from);

      if now() < v_opens_at then
        select p.timezone into v_timezone from public.properties p where p.id = new.property_id;

        raise exception 'Cleaning cannot start before %', v_opens_at
          using errcode = 'check_violation',
                hint = 'serverErrors.startTooEarly',
                detail = jsonb_build_object(
                  'date', to_char(v_opens_at at time zone v_timezone, 'YYYY-MM-DD'),
                  'time', to_char(v_opens_at at time zone v_timezone, 'HH24:MI')
                )::text;
      end if;
    end if;

    new.started_at := coalesce(old.started_at, now());

    select count(*) into v_running
    from public.tasks t
    where t.assignee_id = new.assignee_id
      and t.status = 'in_progress'
      and t.id <> new.id;

    if v_running > 0 then
      select h.parallel_start_allowed into v_allowed
      from public.hosts h where h.id = new.host_id;

      if not coalesce(v_allowed, true) then
        raise exception 'Parallel start is off: finish the running cleaning first'
          using errcode = 'check_violation',
                hint = 'serverErrors.parallelStartOff';
      end if;

      -- Both sides of the overlap are marked: the one starting now and every
      -- one still running. Overlap is symmetric, and the later start is the
      -- only moment at which it is certain to be visible.
      new.is_parallel := true;

      update public.tasks t
      set is_parallel = true
      where t.assignee_id = new.assignee_id
        and t.status = 'in_progress'
        and t.id <> new.id
        and not t.is_parallel;
    end if;
  end if;

  if new.status = 'done' then
    -- The gate. Required steps neither completed nor waived hold the finish;
    -- the count travels in `detail` because it is the one number the cleaner
    -- needs. Managers pass: releasing a task by hand is their call.
    if not v_office then
      select count(*) into v_remaining
      from public.task_steps s
      where s.task_id = new.id
        and s.required
        and s.completed_at is null
        and s.waived_at is null;

      if v_remaining > 0 then
        raise exception 'Required steps are still open: %', v_remaining
          using errcode = 'check_violation',
                hint = 'serverErrors.requiredStepsLeft',
                detail = jsonb_build_object('count', v_remaining)::text;
      end if;
    end if;

    new.completed_at := coalesce(old.completed_at, now());
    new.completed_by := coalesce(new.completed_by, (select auth.uid()));
  end if;

  return new;
end;
$$;

-- ---------- handing out ----------

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
  v_holder  uuid;
  v_date    date;
  v_role    public.app_role;
begin
  v_problem := public.problem_for_dispatch(p_id);

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
  select pr.role into v_role
  from public.profiles pr
  where pr.id = p_assignee_id
    and pr.host_id = v_problem.host_id
    and pr.is_active;
  if not found then
    raise exception 'Assignee is not an active member of this company'
      using errcode = 'check_violation', hint = 'serverErrors.problemAssigneeInvalid';
  end if;

  -- The live attempt is a repair.
  select t.id, t.assignee_id into v_task_id, v_holder
  from public.tasks t
  where t.problem_id = p_id
    and t.type = 'maintenance'
    and t.status not in ('done', 'cancelled', 'expired')
  for update;

  -- A problem has one live task (tasks_one_fix_per_problem). A live row of
  -- another kind carrying its problem_id — nothing of ours writes one, a
  -- manager's direct write could — is not the dispatch's to rewrite, and no
  -- attempt can open beside it: said so, rather than left to the index.
  if v_task_id is null
     and exists (select 1 from public.tasks t
                 where t.problem_id = p_id
                   and t.status not in ('done', 'cancelled', 'expired')) then
    raise exception 'Problem % is held by live work that is not a repair', p_id
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;

  -- The head technician hands work to technicians, himself among them
  -- (decisions 1 and 8 of 2026-10-01); the office to whoever is on the spot.
  -- The person already on the live attempt he may move to another day or
  -- hours, whatever her role: he may take her off (decision 17), and a move
  -- hands nothing to anybody.
  if not public.is_manager()
     and v_role not in ('tech', 'head_tech')
     and (v_task_id is null or p_assignee_id is distinct from v_holder) then
    raise exception 'The head technician hands work to technicians only'
      using errcode = 'check_violation', hint = 'serverErrors.repairNeedsTech';
  end if;

  v_date := coalesce(
    p_scheduled_date,
    (select (now() at time zone pr.timezone)::date
     from public.properties pr where pr.id = v_problem.property_id));

  -- The guards on tasks hold an executor's write; this one is the office's,
  -- and so is the head technician's. Switched on for the write alone
  -- (20261003130000).
  perform set_config('str_ops.head_tech_dispatch', 'on', true);

  if v_task_id is not null then
    update public.tasks t
    set assignee_id    = p_assignee_id,
        -- Another technician, or another day, has been accepted by nobody
        -- yet (20260928110000). SET reads the row as it was.
        status         = case when t.status = 'unassigned' then 'assigned'
                              when t.status = 'accepted'
                                   and (t.assignee_id is distinct from p_assignee_id
                                        or t.scheduled_date is distinct from v_date)
                                then 'assigned'
                              else t.status end,
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

  perform set_config('str_ops.head_tech_dispatch', '', true);

  select p.* into v_problem from public.problems p where p.id = p_id;
  return v_problem;
end;
$$;

-- ---------- taking a technician off ----------

create or replace function public.unassign_problem(
  p_task_id           uuid,
  -- Whom the screen showed on the attempt. Null — the default — asks nothing.
  p_expected_assignee uuid default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem_id uuid;
  v_problem    public.problems;
  v_holder     uuid;
  v_closed     boolean;
begin
  -- Asked before the attempt is looked up: whoever may not dispatch learns
  -- nothing about which ids exist.
  if not (public.is_manager() or public.is_head_tech()) then
    raise exception 'Only a manager or the head technician may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOrHeadTechOnly';
  end if;

  -- A repair of a task, of this company. A cleaning, or a repair the office
  -- wrote by hand, is nobody's to take off here.
  select t.problem_id into v_problem_id
  from public.tasks t
  where t.id = p_task_id
    and t.host_id = public.current_host_id()
    and t.type = 'maintenance'
    and t.problem_id is not null;
  if v_problem_id is null then
    raise exception 'Repair % not found', p_task_id
      using errcode = 'check_violation', hint = 'serverErrors.taskNotFound';
  end if;

  -- The task's row first, as assign_problem takes it: two dispatchers meet
  -- there rather than on the attempt. Then the attempt, as it is now.
  v_problem := public.problem_for_dispatch(v_problem_id);

  select t.assignee_id, t.status in ('done', 'cancelled', 'expired')
    into v_holder, v_closed
  from public.tasks t
  where t.id = p_task_id
  for update;

  -- A screen minutes old: the attempt has closed since (or is gone), or holds
  -- somebody the screen did not show. Nobody is taken off whom the caller
  -- never saw.
  if not found
     or v_closed
     or (p_expected_assignee is not null and p_expected_assignee is distinct from v_holder) then
    raise exception 'Repair % changed while the screen was open', p_task_id
      using errcode = 'check_violation', hint = 'serverErrors.taskChangedMeanwhile';
  end if;

  perform set_config('str_ops.head_tech_dispatch', 'on', true);
  update public.tasks t
  set status = 'cancelled'
  where t.id = p_task_id;
  perform set_config('str_ops.head_tech_dispatch', '', true);

  -- The mirror has put the task back to 'open'.
  select p.* into v_problem from public.problems p where p.id = v_problem_id;
  return v_problem;
end;
$$;

comment on function public.unassign_problem(uuid, uuid) is
  'Take the person off a repair: the live attempt is cancelled and its task '
  'waits again. With p_expected_assignee, only if the attempt still holds that '
  'person. For the manager and the head technician (decisions 1 and 17, '
  '20261003130000).';

revoke all on function public.unassign_problem(uuid, uuid) from public, anon;
grant execute on function public.unassign_problem(uuid, uuid) to authenticated, service_role;
