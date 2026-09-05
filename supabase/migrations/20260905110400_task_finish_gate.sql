-- F16. A task with required steps still open cannot be finished by its cleaner.
--
-- The rule belongs next to the other rules of the status machine, so this
-- replaces guard_task_transitions() from 20260905100000 with one addition
-- before the finish stamp. Everything else in the body is unchanged.
--
-- A task with no steps at all — no template applied — finishes exactly as it
-- did before F16. A manager may finish any task; a required step left open is
-- then visible in task_steps for what it is.

/**
 * Apply a status change: check that the executor may make it, stamp the
 * clock, mark parallel work, and refuse a finish with required steps open.
 *
 * An executor has three moves — unassigned -> assigned (the claim, whose
 * other conditions live in its policy), assigned -> in_progress, and
 * in_progress -> done — and anything else is refused with an error the app
 * can show. A manager may set any status; the stamps still come from the
 * database.
 *
 * Fires after guard_task_fields (trigger names run alphabetically), which has
 * already thrown away whatever the client said about the time. The snapshot
 * of steps is taken by tasks_snapshot_workflow, an AFTER trigger, once this
 * one has let the row through.
 */
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
begin
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.status = old.status then
    return new;
  end if;

  if not public.is_manager()
     and not (
       (old.status = 'unassigned'  and new.status = 'assigned') or
       (old.status = 'assigned'    and new.status = 'in_progress') or
       (old.status = 'in_progress' and new.status = 'done')
     ) then
    raise exception 'Переход % -> % исполнителю недоступен', old.status, new.status
      using errcode = 'check_violation';
  end if;

  if new.status = 'in_progress' then
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
        raise exception 'Параллельный старт выключен: сначала завершите текущую уборку'
          using errcode = 'check_violation';
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
    -- the count is in the message because it is the one number the cleaner
    -- needs. Managers pass: releasing a task by hand is their call.
    if not public.is_manager() then
      select count(*) into v_remaining
      from public.task_steps s
      where s.task_id = new.id
        and s.required
        and s.completed_at is null
        and s.waived_at is null;

      if v_remaining > 0 then
        raise exception 'Не выполнено обязательных шагов: %', v_remaining
          using errcode = 'check_violation';
      end if;
    end if;

    new.completed_at := coalesce(old.completed_at, now());
    new.completed_by := coalesce(new.completed_by, (select auth.uid()));
  end if;

  return new;
end;
$$;
