-- Switching a member of staff off takes her off the work nobody has started
-- (owner's word 2026-10-04; docs/staff-disable-plan.md).
--
-- Until now switching an account off (profiles.is_active, written by
-- manage-staff or by a manager) closed the person's access and touched no job:
-- her cleanings stayed «assigned» to somebody who could no longer open them,
-- the sweep closed them a day late as never done, a repair she held waited for
-- ever (20260923130000 wrote that down as an accepted cost), and the generator
-- kept handing her the cleanings of her 'auto' listings. On 2026-10-04 the
-- cloud held 87 live cleanings on the two cleaners switched off.
--
-- The rule from here on:
--
-- - Switching her off takes her off every job she has not started — assigned,
--   accepted, or 'unassigned' with her name on it — in the same transaction:
--   * a cleaning, a mid-stay cleaning, an inspection, a repair the office wrote
--     by hand: free again — nobody on it, 'unassigned' — as save_task frees a
--     job whose person the manager clears. Its day, hours and the rest stay.
--     The push about free work goes as for any job made free (cleaning_free,
--     to whoever may take it from the listing);
--   * a repair of a task (problem): taken off as unassign_problem takes a
--     person off — the attempt cancelled under the take-off flag, so its
--     journal says taken_off and the mirror puts the task back to 'open'. The
--     two now share one function, take_off_repairs(); the task's row is locked
--     before the attempt, as the dispatchers lock it. Taken off by the switch,
--     the journal line says why: params.cause = 'account_disabled' (owner's
--     answer 3 of 2026-10-04) — a second transaction-local flag,
--     str_ops.take_off_cause, set by take_off_repairs for its write and read by
--     journal_repair_change. unassign_problem sets no cause.
--   Work under way (in_progress, paused, blocked) and closed work stay as they
--   are: the manager decides about them, and the dashboard shows them. A job
--   under way that is not a repair of a task is not left for ever: the night
--   sweep (expire_stale_tasks) closes it a day after its day as one that never
--   happened, as any live job — the manager has about a day and a half.
--   She hears nothing: every push is asked of a person who works
--   (push_on_task_change when it is written, claim_push_batch when it is
--   sent), and she no longer does. Nobody else hears of a task open again:
--   there is no push of that kind, and none is added (owner's answer 2).
-- - Her pushes still waiting in the queue are settled as skipped — what the
--   sender does with them while she is off (claim_push_batch) — so switched on
--   again before they go, she does not hear «Вам назначена уборка» of a
--   cleaning the switch took off her. A group a sender holds right now is that
--   sender's; the release waits for a claim under way (its advisory lock).
-- - Every link of hers to a listing is removed, whatever its mode (owner's
--   answer 1). The generator names a person only through an 'auto' link;
--   without one, her listings' cleanings come free. Switched on again she has
--   no listing until the office gives her some: no job comes back, no link
--   either. Made 'auto' again by hand, she gets what the generator's hand-over
--   gives any 'auto' cleaner: the listing's cleanings still free in its run,
--   those the switch freed among them.
-- - Nothing names a person who no longer works here on live work. A trigger on
--   tasks refuses a write that puts her on a live job — a new job, a change of
--   person, a closed job brought back, work under way turned back into work
--   not started — whoever writes it: a manager directly, the generator, and
--   save_task and assign_problem (both refuse before it, in their own words).
--   A trigger on property_cleaners refuses any link of hers, written or
--   changed, whatever its mode: save_property_cleaner, a direct write. The
--   panel's «Команда» writes the account before the links (staff-form.tsx:
--   the save, then applyLinks), so switching her on and ticking listings in
--   one save works; ticking listings for somebody left switched off is
--   refused, and the form says so.
--
-- Where the rule lives: profiles_release_work, an AFTER trigger on the move of
-- is_active from true to false. Both paths that switch a person off write that
-- row — manage-staff upserts it as the service role, a manager may write it —
-- and nobody else may move the switch (guard_profile_privileges). AFTER, so the
-- row already says she is off when her jobs are written: the push triggers and
-- the guard read it so. Switching on wakes nothing.
--
-- Locks. The switch holds her profile row from its write to the commit; the
-- release then locks the tasks (problems) of her unstarted repairs FOR NO KEY
-- UPDATE in id order, the attempts, her other jobs, her links, her pushes. A
-- write that puts her on a job — the generator, a new job through save_task, a
-- dispatch, a manager, her own take of free work — reads her profile row FOR
-- SHARE in the guard (save_task in itself too), so whoever comes second waits
-- for the first and sees what it wrote: a job handed to her first is taken off
-- by the release; a release first makes the write that names her fail. A
-- generator run that meets her so is refused whole, as one that met a
-- technician (20261003110000), and the next run finds no link of hers. A
-- dispatcher locks the task's row before the attempt, as the release does, so
-- the two do not deadlock over an attempt she holds. Three rare deadlocks
-- (40P01) remain and are accepted, nothing half-written: a generator run that
-- moved one of her cleanings in its reschedule pass and then hands her another
-- through her 'auto' link, while the release waits for the first; her own
-- start of a repair of a task in the same second — the start holds the attempt
-- and waits for the task's row (the mirror), the release the other way round:
-- the inverted order 20260923130000 and 20261003130000 accepted for a direct
-- write of an attempt against a dispatch; and save_task keeping her on one of
-- her own jobs in the same second — it locks the job, then reads her profile
-- FOR SHARE, while the switch holds the profile and wants the job.
--
-- Accepted too: a manager's direct write that points her hand-made repair at a
-- task (tasks.problem_id) while she is being switched off leaves a repair of a
-- task on her — the release takes repairs of tasks first and the freeing then
-- reads the row as such a repair. No path of the product writes problem_id on
-- an existing job: the panel never does, assign_problem only inserts it.
--
-- The cleanup of what hangs today is release_work_of_inactive() for everybody
-- switched off, at the end of this file (counted first by
-- docs/rollout/staff_disable_probe.sql).
--
-- unassign_problem's body is copied from 20261003130000 with only its write
-- moved into take_off_repairs(); same signature, so its ACL and the generated
-- types stay. journal_repair_change's body is copied from 20261003140000 with
-- only the cause added to taken_off. New: five functions (none a client may
-- call) and four triggers — one on profiles, two on tasks, one on
-- property_cleaners; creating a trigger takes a brief SHARE ROW EXCLUSIVE lock
-- on its table, hence the lock timeout. No table changes.

set local lock_timeout = '3s';

-- ---------- 1. taking a person off repairs: one function ----------

create or replace function public.take_off_repairs(
  p_task_ids uuid[],
  -- Why, for the journal: null — a person taken off by the office — or
  -- 'account_disabled', the switch.
  p_cause    text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_cause is not null and p_cause <> 'account_disabled' then
    raise exception 'Unknown cause of a take-off: %', p_cause
      using errcode = 'invalid_parameter_value';
  end if;

  -- The take-off flag (20261003130000): the journal writes taken_off, the
  -- person hears the work was taken from her rather than cancelled, the
  -- guards on tasks read the head technician's dispatch as the office's. And
  -- the cause, which the journal writes beside it. Both for the write alone.
  perform set_config('str_ops.head_tech_dispatch', 'on', true);
  perform set_config('str_ops.take_off_cause', coalesce(p_cause, ''), true);

  update public.tasks t
  set status = 'cancelled'
  where t.id = any (p_task_ids)
    and t.type = 'maintenance'
    and t.problem_id is not null
    and t.status not in ('done', 'cancelled', 'expired');
  get diagnostics v_count = row_count;

  perform set_config('str_ops.take_off_cause', '', true);
  perform set_config('str_ops.head_tech_dispatch', '', true);
  return v_count;
end;
$$;

comment on function public.take_off_repairs(uuid[], text) is
  'Take the people off these live repairs of tasks: each attempt cancelled under the '
  'take-off flag, its task open again through the mirror, the cause (null or '
  '''account_disabled'') in its journal. The callers lock first: unassign_problem, and '
  'the release of a person switched off (20261004100000).';

revoke all on function public.take_off_repairs(uuid[], text) from public, anon, authenticated;

-- The journal of a repair: taken_off says why when the take-off says so. Body
-- from 20261003140000 with only the cause added; same signature and ACL.
create or replace function public.journal_repair_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_kind   public.problem_event_kind;
  v_params jsonb;
  v_moved  boolean;
  v_person boolean;
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null then
      insert into public.problem_events (host_id, problem_id, task_id, kind, actor_id, params)
      values (new.host_id, new.problem_id, new.id, 'assigned', v_actor,
              jsonb_strip_nulls(jsonb_build_object(
                'to', new.assignee_id, 'date', new.scheduled_date,
                'time_from', new.time_from, 'time_to', new.time_to)));
    end if;
    return null;
  end if;

  -- An attempt moved to another task is the mirror's business; the journal
  -- follows an attempt of one task.
  if new.problem_id is distinct from old.problem_id then
    return null;
  end if;

  v_person := new.assignee_id is distinct from old.assignee_id;
  v_moved  := new.scheduled_date is distinct from old.scheduled_date
              or new.time_from is distinct from old.time_from
              or new.time_to is distinct from old.time_to;

  -- The person, and with a new person the day and hours the attempt now has.
  if v_person then
    v_kind := case when old.assignee_id is null then 'assigned'
                   when new.assignee_id is null then 'unassigned'
                   else 'reassigned' end;
    v_params := case v_kind
      when 'unassigned' then jsonb_build_object('from', old.assignee_id)
      else jsonb_strip_nulls(jsonb_build_object(
             'from', old.assignee_id, 'to', new.assignee_id,
             'from_date', case when new.scheduled_date is distinct from old.scheduled_date
                               then old.scheduled_date end,
             'date', new.scheduled_date,
             'time_from', new.time_from, 'time_to', new.time_to))
    end;
    insert into public.problem_events (host_id, problem_id, task_id, kind, actor_id, params)
    values (new.host_id, new.problem_id, new.id, v_kind, v_actor, v_params);
  elsif v_moved then
    insert into public.problem_events (host_id, problem_id, task_id, kind, actor_id, params)
    values (new.host_id, new.problem_id, new.id, 'rescheduled', v_actor,
            jsonb_strip_nulls(jsonb_build_object(
              'from_date', old.scheduled_date, 'date', new.scheduled_date,
              'time_from', new.time_from, 'time_to', new.time_to)));
  end if;

  if new.status is not distinct from old.status then
    return null;
  end if;

  v_params := '{}'::jsonb;
  v_kind := case
    -- unassign_problem cancels under the dispatch setting (20261003130000);
    -- so does the release of a person switched off (take_off_repairs,
    -- 20261004100000). Nothing else cancels an attempt under it.
    when new.status = 'cancelled'
         and coalesce(current_setting('str_ops.head_tech_dispatch', true), '') = 'on'
      then 'taken_off'
    when new.status = 'cancelled' then 'attempt_cancelled'
    when new.status = 'done' then 'completed'
    when new.status = 'in_progress' and old.status in ('unassigned', 'assigned', 'accepted')
      then 'started'
    when new.status = 'accepted' and old.status in ('unassigned', 'assigned')
      then 'accepted'
    -- What a change of person or day does to the status (waiting again, or
    -- accepted by nobody yet) is said by that change.
    when (v_person or v_moved) and new.status in ('unassigned', 'assigned') then null
    else 'status_changed'
  end;

  if v_kind is null then
    return null;
  end if;
  if v_kind = 'taken_off' then
    -- Why, when the take-off said so: 'account_disabled' (20261004100000).
    v_params := jsonb_strip_nulls(jsonb_build_object(
      'assignee', old.assignee_id,
      'cause', nullif(coalesce(current_setting('str_ops.take_off_cause', true), ''), '')));
  elsif v_kind = 'attempt_cancelled' then
    v_params := jsonb_strip_nulls(jsonb_build_object('assignee', old.assignee_id));
  elsif v_kind = 'status_changed' then
    v_params := jsonb_build_object('from', old.status, 'to', new.status);
  end if;

  insert into public.problem_events (host_id, problem_id, task_id, kind, actor_id, params)
  values (new.host_id, new.problem_id, new.id, v_kind, v_actor, v_params);
  return null;
end;
$$;

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

  -- The write is the one a switched-off person's repairs get too
  -- (20261004100000).
  perform public.take_off_repairs(array[p_task_id]);

  -- The mirror has put the task back to 'open'.
  select p.* into v_problem from public.problems p where p.id = v_problem_id;
  return v_problem;
end;
$$;

-- ---------- 2. what a person switched off leaves ----------

create or replace function public.release_work_of_inactive(p_person uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_repairs   uuid[];
  v_taken_off integer := 0;
  v_freed     integer;
  v_links     integer;
  v_pushes    integer;
begin
  -- Only somebody who no longer works here: the trigger calls it for a person
  -- just switched off, the cleanup below for everybody already off.
  if exists (select 1 from public.profiles p where p.id = p_person and p.is_active) then
    raise exception 'Person % still works here: nothing of hers is released', p_person
      using errcode = 'invalid_parameter_value';
  end if;

  -- Her repairs of tasks. The task's row first, in one order, as the
  -- dispatchers take it (problem_for_dispatch); then the attempts, as they are
  -- once those are held — one started meanwhile is no longer hers to lose.
  perform 1
  from public.problems pb
  where pb.id in (select t.problem_id
                  from public.tasks t
                  where t.assignee_id = p_person
                    and t.type = 'maintenance'
                    and t.problem_id is not null
                    and t.status in ('unassigned', 'assigned', 'accepted'))
  order by pb.id
  for no key update of pb;

  select coalesce(array_agg(x.id order by x.id), '{}') into v_repairs
  from (select t.id
        from public.tasks t
        where t.assignee_id = p_person
          and t.type = 'maintenance'
          and t.problem_id is not null
          and t.status in ('unassigned', 'assigned', 'accepted')
        order by t.id
        for update of t) x;

  if cardinality(v_repairs) > 0 then
    v_taken_off := public.take_off_repairs(v_repairs, 'account_disabled');
  end if;

  -- Every other job nobody has started is free again, as save_task frees one
  -- whose person the manager clears: nobody on it, 'unassigned'.
  update public.tasks t
  set assignee_id = null,
      status      = 'unassigned'
  where t.assignee_id = p_person
    and t.status in ('unassigned', 'assigned', 'accepted')
    and not (t.type = 'maintenance' and t.problem_id is not null);
  get diagnostics v_freed = row_count;

  -- Every link of hers, whatever its mode (owner's answer 1): the generator
  -- names a person through an 'auto' link, and the office gives listings
  -- again to whoever it switches back on.
  delete from public.property_cleaners pc
  where pc.cleaner_id = p_person;
  get diagnostics v_links = row_count;

  -- Her pushes still waiting, settled now as the sender settles them while she
  -- is off (claim_push_batch: skipped). Switched on again before they are due,
  -- she would otherwise hear «Вам назначена уборка» of work the switch took
  -- off her. One sender decides what is due at a time: the release waits for
  -- a claim under way, then leaves a group a sender holds to that sender.
  perform pg_advisory_xact_lock(hashtext('public.claim_push_batch'));
  update raw.push_outbox o
  set settled_at = now(),
      outcome = 'skipped',
      claimed_until = null
  where o.recipient_id = p_person
    and o.settled_at is null
    and not exists (select 1 from raw.push_outbox l
                    where l.recipient_id = o.recipient_id
                      and l.collapse_key = o.collapse_key
                      and l.settled_at is null
                      and l.claimed_until > now());
  get diagnostics v_pushes = row_count;

  return jsonb_build_object('cleanings', v_freed, 'repairs', v_taken_off, 'links', v_links,
                            'pushes', v_pushes);
end;
$$;

comment on function public.release_work_of_inactive(uuid) is
  'Take a person who no longer works here off every job nobody has started: a '
  'repair of a task taken off (take_off_repairs, cause account_disabled), any other '
  'job free again, every link of hers removed, her pushes still waiting settled as '
  'skipped. Work under way and closed work stay. Answers what it did: cleanings, '
  'repairs, links, pushes (20261004100000).';

revoke all on function public.release_work_of_inactive(uuid) from public, anon, authenticated;

create or replace function public.release_work_on_deactivation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.release_work_of_inactive(new.id);
  return null;
end;
$$;

comment on function public.release_work_on_deactivation() is
  'Trigger on profiles: switched off, a person is taken off the work nobody has '
  'started (release_work_of_inactive; 20261004100000).';

revoke all on function public.release_work_on_deactivation() from public, anon, authenticated;

-- The move from on to off alone; the privilege guard (BEFORE) has already put
-- back a switch the caller may not move.
create trigger profiles_release_work
  after update of is_active on public.profiles
  for each row
  when (old.is_active and not new.is_active)
  execute function public.release_work_on_deactivation();

-- ---------- 3. nobody names her on live work ----------

create or replace function public.guard_person_works()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
begin
  -- FOR SHARE: switching her off waits for this write, and this write for a
  -- switch already under way — and then sees she is off.
  select p.is_active into v_active
  from public.profiles p
  where p.id = new.assignee_id
  for share;

  if v_active is false then
    raise exception 'Person % no longer works here and is given no live work', new.assignee_id
      using errcode = 'check_violation', hint = 'serverErrors.taskAssigneeInvalid';
  end if;

  return new;
end;
$$;

comment on function public.guard_person_works() is
  'No live job is written with a person who no longer works here on it: a new job, '
  'a change of person, a closed job brought back, work under way turned back into '
  'work not started (20261004100000).';

revoke all on function public.guard_person_works() from public, anon, authenticated;

-- A new live job with somebody on it.
create trigger tasks_person_works_insert
  before insert on public.tasks
  for each row
  when (new.assignee_id is not null
        and new.status not in ('done', 'cancelled', 'expired'))
  execute function public.guard_person_works();

-- A live job that takes a person: another person, a closed job brought back,
-- or work under way turned back into work not started. A job moved with its
-- person, freed, started or closed never calls the function — the generator's
-- reschedule, the release above, an executor's own moves.
create trigger tasks_person_works_update
  before update of assignee_id, status on public.tasks
  for each row
  when (new.assignee_id is not null
        and new.status not in ('done', 'cancelled', 'expired')
        and (new.assignee_id is distinct from old.assignee_id
             or old.status in ('done', 'cancelled', 'expired')
             or (new.status in ('unassigned', 'assigned', 'accepted')
                 and old.status not in ('unassigned', 'assigned', 'accepted'))))
  execute function public.guard_person_works();

create or replace function public.guard_link_works()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
begin
  -- FOR SHARE, as above: a link written while she is being switched off
  -- either waits and is refused, or is written first and removed by the
  -- release.
  select p.is_active into v_active
  from public.profiles p
  where p.id = new.cleaner_id
  for share;

  if v_active is false then
    raise exception 'Person % no longer works here and is linked to no listing', new.cleaner_id
      using errcode = 'check_violation', hint = 'serverErrors.cleanerLinkInactive';
  end if;

  return new;
end;
$$;

comment on function public.guard_link_works() is
  'A person who no longer works here is linked to no listing, in any mode: switching '
  'her off removes her links, and none is written or changed until she is on again '
  '(20261004100000).';

revoke all on function public.guard_link_works() from public, anon, authenticated;

-- Any write of a link; a removal is always allowed.
create trigger property_cleaners_person_works
  before insert or update on public.property_cleaners
  for each row
  execute function public.guard_link_works();

-- ---------- 4. what hangs today ----------

-- Everybody switched off before this file, in one order. Written as the
-- migration's owner with nobody signed in: the journal says «the system».
do $$
declare
  v_person uuid;
  v_done   jsonb;
  v_total  jsonb := jsonb_build_object('people', 0, 'cleanings', 0, 'repairs', 0, 'links', 0,
                                       'pushes', 0);
begin
  for v_person in
    select p.id from public.profiles p where not p.is_active order by p.id
  loop
    v_done := public.release_work_of_inactive(v_person);
    v_total := jsonb_build_object(
      'people',    (v_total ->> 'people')::int + 1,
      'cleanings', (v_total ->> 'cleanings')::int + (v_done ->> 'cleanings')::int,
      'repairs',   (v_total ->> 'repairs')::int + (v_done ->> 'repairs')::int,
      'links',     (v_total ->> 'links')::int + (v_done ->> 'links')::int,
      'pushes',    (v_total ->> 'pushes')::int + (v_done ->> 'pushes')::int);
  end loop;
  raise notice 'staff_disable cleanup: %', v_total;
end;
$$;
