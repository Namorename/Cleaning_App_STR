-- Problems: back to the board, and out of sight.
--
-- Two things the panel could not do. A problem closed by mistake — resolved
-- or cancelled — had nowhere to go: every function refused a closed row. And
-- a report that should never have been made (a test, a duplicate, a joke)
-- stayed on the list forever, because nothing is ever deleted.
--
-- reopen_problem puts a closed problem back to 'open'. The closed fix task
-- stays as history; a fresh attempt gets a fresh task, as it does after a
-- cancelled one.
--
-- archive_problem hides a problem from every screen but the manager's
-- archive. Nothing is deleted: the row, its photos and its tasks stay, and
-- unarchive_problem brings it back exactly as it was. A live fix task is
-- cancelled on the way in — nobody should be fixing what the manager has put
-- away — and the mirror trigger reads the problem as open again, so a
-- restored problem lands on the board and not in a technician's list.

alter table public.problems
  add column archived_at timestamptz;

comment on column public.problems.archived_at is
  'Set when a manager puts the problem away. Hidden from cleaners and technicians; the manager sees it in the archive and can bring it back.';

-- ---------- cleaners and technicians do not see archived problems ----------

drop policy "reporter reads own problems" on public.problems;
create policy "reporter reads own problems"
  on public.problems for select to authenticated
  using (reported_by = (select auth.uid())
         and host_id = public.current_host_id()
         and archived_at is null
         and public.is_active_user());

drop policy "fixer reads problems of own tasks" on public.problems;
create policy "fixer reads problems of own tasks"
  on public.problems for select to authenticated
  using (host_id = public.current_host_id()
         and archived_at is null
         and public.is_active_user()
         and exists (select 1 from public.tasks t
                     where t.problem_id = problems.id
                       and t.assignee_id = (select auth.uid())));

-- ---------- the manager's levers ----------

/** Put a closed problem back on the board. An open one is returned as is. */
create or replace function public.reopen_problem(p_id uuid)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
begin
  v_problem := public.problem_for_manager(p_id);

  if v_problem.status not in ('resolved', 'cancelled') then
    return v_problem;
  end if;

  update public.problems p
  set status        = 'open',
      resolved_at   = null,
      cancelled_at  = null,
      cancel_reason = null
  where p.id = p_id
  returning * into v_problem;

  return v_problem;
end;
$$;

/** Hide the problem from everyone but the archive; a live fix task is cancelled with it. */
create or replace function public.archive_problem(p_id uuid)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
begin
  v_problem := public.problem_for_manager(p_id);

  if v_problem.archived_at is not null then
    return v_problem;
  end if;

  -- The task goes first: the mirror reads the problem as open, and the stamp
  -- below is what keeps it off the board.
  update public.tasks t
  set status = 'cancelled'
  where t.problem_id = p_id and t.status not in ('done', 'cancelled', 'expired');

  update public.problems p
  set archived_at = now()
  where p.id = p_id
  returning * into v_problem;

  return v_problem;
end;
$$;

/** Bring an archived problem back, in whatever status it was put away. */
create or replace function public.unarchive_problem(p_id uuid)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
begin
  v_problem := public.problem_for_manager(p_id);

  if v_problem.archived_at is null then
    return v_problem;
  end if;

  update public.problems p
  set archived_at = null
  where p.id = p_id
  returning * into v_problem;

  return v_problem;
end;
$$;

revoke all on function public.reopen_problem(uuid) from public, anon;
revoke all on function public.archive_problem(uuid) from public, anon;
revoke all on function public.unarchive_problem(uuid) from public, anon;
grant execute on function public.reopen_problem(uuid) to authenticated, service_role;
grant execute on function public.archive_problem(uuid) to authenticated, service_role;
grant execute on function public.unarchive_problem(uuid) to authenticated, service_role;
