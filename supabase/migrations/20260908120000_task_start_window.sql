-- A cleaning cannot start before its window opens.
--
-- Found on 2026-09-08: a cleaner could open tomorrow's task and press start
-- today. The hours report would then carry a start stamp a day before the
-- guests left. The start is held until the window opens: the scheduled date
-- at the window's start time, or midnight of that date when the start is not
-- known, judged in the listing's own timezone — a scheduled date is a calendar
-- date there, not an instant in UTC.
--
-- Managers are not held, like everywhere else in guard_task_transitions():
-- releasing work early is their call, and the app never offers them the
-- button by accident.

/**
 * The instant before which a task may not be started.
 *
 * security definer for the same reason as task_is_beyond_horizon(): the
 * answer must not depend on whether the caller may read the listing.
 */
create or replace function public.task_start_not_before(
  target_property_id    bigint,
  target_scheduled_date date,
  target_time_from      time
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select (target_scheduled_date + coalesce(target_time_from, time '00:00'))
           at time zone p.timezone
  from public.properties p
  where p.id = target_property_id
$$;

revoke all on function public.task_start_not_before(bigint, date, time) from public, anon;
grant execute on function public.task_start_not_before(bigint, date, time)
  to authenticated, service_role;

/**
 * Changed from 20260907120200: the start branch holds an executor until the
 * window opens. The refusal names the date and time it is waiting for, in the
 * listing's timezone, so the app can say when to come back.
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
  v_opens_at  timestamptz;
  v_timezone  text;
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
    raise exception 'Move % -> % is not available to an executor', old.status, new.status
      using errcode = 'check_violation',
            hint = 'serverErrors.transitionNotAllowed',
            detail = jsonb_build_object('from', old.status, 'to', new.status)::text;
  end if;

  if new.status = 'in_progress' then
    if not public.is_manager() then
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
    if not public.is_manager() then
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
