-- The day a task is to be done (owner, 2026-11-26, CORE; docs/problem-due-date.md).
--
-- A task (problems) gets an optional day of its doing, a date with no time: the office sets it
-- when it makes the task (report_problem, the panel's «Новое задание» with or without the
-- catalogue, the manager's phone) and changes or clears it on the task (set_problem_due_date), so a
-- task can be planned ahead. The technicians' queues order by it (the day, else the day it was
-- made; then the level; then the moment it was made), and «Висит N дней» and «Просрочено» count from
-- it for a task planned ahead — the clients' rule, packages/shared/src/schedule/job-tail.ts.
--
-- Only the office sets the day: a report from the field that names one is refused, so a cleaner's
-- phone cannot plan a technician's week. The day is from yesterday (the company's evening is the
-- server's next day) to a year ahead. No notification changes and none is added; the task's journal
-- (problem_events) does not record the change, as it does not record a change of words
-- (20261119140000): a new kind of event would break older clients reading the journal.
--
-- API v1 has no field for it (a task's work has its own scheduled_date, the day the technician
-- goes, which is another thing): set_problem_due_date is internal in coverage.json, and the API
-- answers as before.
--
-- Additive: a nullable column; report_problem gains a last argument with the default «nothing
-- said» (older phones and API v1 call it without); one new function.

set local lock_timeout = '3s';

alter table public.problems add column due_on date;

comment on column public.problems.due_on is
  'The day the task is to be done, set by the office; null when not planned (20261126130000).';

/** The day of a task's doing, or the refusal: from yesterday to a year ahead. Internal. */
create function public.problem_due_check(p_due_on date)
returns date
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_due_on is not null
     and (p_due_on < current_date - 1 or p_due_on > current_date + 366) then
    raise exception 'The day of a task is from yesterday to a year ahead, not %', p_due_on
      using errcode = 'check_violation', hint = 'serverErrors.problemDueInvalid',
            detail = jsonb_build_object('days', 366)::text;
  end if;
  return p_due_on;
end;
$$;

comment on function public.problem_due_check(date) is
  'Internal: the day a task is to be done, from yesterday to a year ahead, or the refusal (20261126130000).';

drop function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean, uuid);

/**
 * As in 20261115100000, and p_due_on: the day the task is to be done, the office's to set — null
 * says nothing. A repeat answers the task as it stands.
 */
create function public.report_problem(
  p_id          uuid,
  p_title       text,
  p_description text default null,
  p_priority    public.problem_priority default 'normal',
  p_property_id bigint default null,
  p_task_id     uuid default null,
  p_critical    boolean default null,
  p_category_id uuid default null,
  p_due_on      date default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem    public.problems;
  v_property   bigint;
  v_category   public.problem_categories;
  v_title      text := p_title;
  v_title_i18n jsonb;
  v_critical   boolean := coalesce(p_critical, false);
  v_priority   public.problem_priority := coalesce(p_priority, 'normal');
begin
  select p.* into v_problem
  from public.problems p
  where p.id = p_id and p.host_id = public.current_host_id();
  if found then
    if v_problem.reported_by is distinct from (select auth.uid()) then
      raise exception 'Problem not found'
        using errcode = 'check_violation', hint = 'serverErrors.problemNotFound';
    end if;
    return v_problem;
  end if;

  if p_due_on is not null then
    if not public.is_manager() then
      raise exception 'Only the office plans the day of a task'
        using errcode = 'insufficient_privilege', hint = 'serverErrors.problemDueOfficeOnly';
    end if;
    perform public.problem_due_check(p_due_on);
  end if;

  if p_category_id is not null then
    v_category := public.problem_category_for_report(p_category_id);
    v_title := v_category.name;
    v_title_i18n := nullif(v_category.name_i18n, '{}'::jsonb);
    v_priority := v_category.priority;
    v_critical := v_category.critical;
  end if;
  if v_critical then
    v_priority := 'high';
  end if;

  perform public.validate_problem_text(v_title, p_description);
  v_property := public.resolve_report_property(p_property_id, p_task_id);

  insert into public.problems (
    id, host_id, property_id, task_id, reported_by, title, title_i18n, description, priority,
    critical, category_id, due_on
  ) values (
    p_id, public.current_host_id(), v_property, p_task_id, (select auth.uid()),
    btrim(v_title), v_title_i18n, nullif(btrim(coalesce(p_description, '')), ''), v_priority,
    v_critical, p_category_id, p_due_on
  )
  returning * into v_problem;

  return v_problem;
end;
$$;

comment on function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean, uuid, date) is
  'Reports a task (problem); the office may plan its day (20261126130000).';

/**
 * Sets or clears the day a task is to be done: the office of its company, any status. The same
 * day again changes nothing.
 */
create function public.set_problem_due_date(p_id uuid, p_due_on date)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
begin
  -- The office of this company, the row locked: refuses anybody else (serverErrors.managerOnly)
  -- and a task of another company or none (serverErrors.problemNotFound).
  v_problem := public.problem_for_manager(p_id);
  if v_problem.due_on is not distinct from p_due_on then
    return v_problem;
  end if;
  perform public.problem_due_check(p_due_on);

  update public.problems p
  set due_on = p_due_on
  where p.id = v_problem.id
  returning * into v_problem;
  return v_problem;
end;
$$;

comment on function public.set_problem_due_date(uuid, date) is
  'The office sets or clears the day a task is to be done (20261126130000).';

revoke all on function public.problem_due_check(date) from public, anon, authenticated, service_role;
revoke all on function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean, uuid, date) from public, anon;
revoke all on function public.set_problem_due_date(uuid, date) from public, anon;
grant execute on function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean, uuid, date) to authenticated, service_role;
grant execute on function public.set_problem_due_date(uuid, date) to authenticated;
