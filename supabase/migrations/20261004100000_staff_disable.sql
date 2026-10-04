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
--     before the attempt, as the dispatchers lock it.
--   Work under way (in_progress, paused, blocked) and closed work stay as they
--   are: the manager decides about them, and the dashboard shows them.
--   She hears nothing: every push is asked of a person who works
--   (push_on_task_change when it is written, claim_push_batch when it is
--   sent), and she no longer does. Nobody else hears of a task open again:
--   there is no push of that kind, and none is added here.
-- - Her 'auto' links become 'claim'. The generator names a person only through
--   an 'auto' link; without one, her listings' cleanings come free. Her place
--   in their queue stays, so switched on again she may take their free work —
--   and nothing more: no job comes back, and no link turns 'auto' by itself.
-- - Nothing names a person who no longer works here on live work. A trigger on
--   tasks refuses a write that puts her on a live job — a new job, a change of
--   person, a closed job brought back, work under way turned back into work
--   not started — whoever writes it: a manager directly, the generator, and
--   save_task and assign_problem (both refuse before it, in their own words).
--   A trigger on property_cleaners refuses to make her a listing's fixed
--   ('auto') cleaner.
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
-- UPDATE in id order, the attempts, her other jobs, her links. A write that
-- names her — the generator, save_task, a dispatch, a manager, her own take of
-- free work — reads her profile row FOR SHARE in the guard, so whoever comes
-- second waits for the first and sees what it wrote: a job handed to her first
-- is taken off by the release; a release first makes the write that names her
-- fail. A generator run that meets her so is refused whole, as one that met a
-- technician (20261003110000), and the next run reads her link as 'claim'. A
-- dispatcher locks the task's row before the attempt, as the release does, so
-- the two do not deadlock over an attempt she holds. Two rare deadlocks (40P01)
-- remain and are accepted, nothing half-written: a generator run that moved one
-- of her cleanings in its reschedule pass and then hands her another through
-- her 'auto' link, while the release waits for the first; and her own start of
-- a repair of a task in the same second — the start holds the attempt and waits
-- for the task's row (the mirror), the release the other way round: the
-- inverted order 20260923130000 and 20261003130000 accepted for a direct write
-- of an attempt against a dispatch.
--
-- The cleanup of what hangs today is release_work_of_inactive() for everybody
-- switched off, at the end of this file (counted first by
-- docs/rollout/staff_disable_probe.sql).
--
-- unassign_problem's body is copied from 20261003130000 with only its write
-- moved into take_off_repairs(); same signature, so its ACL and the generated
-- types stay. New: five functions (none a client may call) and four triggers —
-- one on profiles, two on tasks, one on property_cleaners; creating a trigger
-- takes a brief SHARE ROW EXCLUSIVE lock on its table, hence the lock timeout.
-- No table changes.

set local lock_timeout = '3s';

-- ---------- 1. taking a person off repairs: one function ----------

create or replace function public.take_off_repairs(p_task_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- The take-off flag (20261003130000): the journal writes taken_off, the
  -- person hears the work was taken from her rather than cancelled, the
  -- guards on tasks read the head technician's dispatch as the office's.
  -- Switched on for the write alone.
  perform set_config('str_ops.head_tech_dispatch', 'on', true);

  update public.tasks t
  set status = 'cancelled'
  where t.id = any (p_task_ids)
    and t.type = 'maintenance'
    and t.problem_id is not null
    and t.status not in ('done', 'cancelled', 'expired');
  get diagnostics v_count = row_count;

  perform set_config('str_ops.head_tech_dispatch', '', true);
  return v_count;
end;
$$;

comment on function public.take_off_repairs(uuid[]) is
  'Take the people off these live repairs of tasks: each attempt cancelled under the '
  'take-off flag, its task open again through the mirror. The callers lock first: '
  'unassign_problem, and the release of a person switched off (20261004100000).';

revoke all on function public.take_off_repairs(uuid[]) from public, anon, authenticated;

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
    v_taken_off := public.take_off_repairs(v_repairs);
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

  -- The generator names a person through an 'auto' link alone. Her place in
  -- the listings' queue stays.
  update public.property_cleaners pc
  set mode = 'claim'
  where pc.cleaner_id = p_person
    and pc.mode = 'auto';
  get diagnostics v_links = row_count;

  return jsonb_build_object('cleanings', v_freed, 'repairs', v_taken_off, 'links', v_links);
end;
$$;

comment on function public.release_work_of_inactive(uuid) is
  'Take a person who no longer works here off every job nobody has started: a '
  'repair of a task taken off (take_off_repairs), any other job free again, her '
  '''auto'' links ''claim''. Work under way and closed work stay. Answers what it '
  'did: cleanings, repairs, links (20261004100000).';

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

create or replace function public.guard_auto_link_works()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_active boolean;
begin
  -- FOR SHARE, as above: a link made 'auto' while she is being switched off
  -- either waits and is refused, or is made first and turned 'claim' by the
  -- release.
  select p.is_active into v_active
  from public.profiles p
  where p.id = new.cleaner_id
  for share;

  if v_active is false then
    raise exception 'Person % no longer works here and is no listing''s fixed cleaner', new.cleaner_id
      using errcode = 'check_violation', hint = 'serverErrors.cleanerAutoInactive';
  end if;

  return new;
end;
$$;

comment on function public.guard_auto_link_works() is
  'A person who no longer works here is no listing''s fixed (''auto'') cleaner: the '
  'generator would hand her its cleanings (20261004100000).';

revoke all on function public.guard_auto_link_works() from public, anon, authenticated;

create trigger property_cleaners_auto_works
  before insert or update on public.property_cleaners
  for each row
  when (new.mode = 'auto')
  execute function public.guard_auto_link_works();

-- ---------- 4. what hangs today ----------

-- Everybody switched off before this file, in one order. Written as the
-- migration's owner with nobody signed in: the journal says «the system».
do $$
declare
  v_person uuid;
  v_done   jsonb;
  v_total  jsonb := jsonb_build_object('people', 0, 'cleanings', 0, 'repairs', 0, 'links', 0);
begin
  for v_person in
    select p.id from public.profiles p where not p.is_active order by p.id
  loop
    v_done := public.release_work_of_inactive(v_person);
    v_total := jsonb_build_object(
      'people',    (v_total ->> 'people')::int + 1,
      'cleanings', (v_total ->> 'cleanings')::int + (v_done ->> 'cleanings')::int,
      'repairs',   (v_total ->> 'repairs')::int + (v_done ->> 'repairs')::int,
      'links',     (v_total ->> 'links')::int + (v_done ->> 'links')::int);
  end loop;
  raise notice 'staff_disable cleanup: %', v_total;
end;
$$;
