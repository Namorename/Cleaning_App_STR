-- Rollback of 20261115100000_problem_categories (docs/problem-categories.md). A WRITE to
-- the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
-- Order, when the catalogue is live (docs/rollout/wagner-problem-catalog-1114.md §Откат):
--   0. docs/one-off-writes/wagner-problem-report-mode-free-text.sql (the switch back), and the
--      client's data archived (wagner-problem-categories-rollback.sql);
--   1. the code that reads the schema goes back first, the phones, the panel and the API alike:
--      republish the OTA groups before the one that reads the catalogue; `git revert` the
--      branch's commits in main and wait for Vercel READY; deploy api and mcp from b25ba5b.
--      A build or a panel that selects problems.category_id or hosts.problem_report_mode
--      answers 42703 once they are gone: the list of tasks and the settings go empty. The
--      older code runs on the newer schema unchanged, so this order has no gap;
--   2. this file, one statement:
--        npx supabase db query --linked -f docs/one-off-writes/problem-categories-rollback.sql
--      It drops the catalogue with its rows (the categories of the client go with it) and
--      problems.category_id (which category a task was filed under is lost; titles and
--      urgencies stay as filed).
--   3. the history: npx supabase migration repair --status reverted 20261115100000 --linked
--   4. the file out of the catalogue, or the next db push applies it again (step 1 did it).
--   5. the probe: node scripts/cloud-read.mjs docs/rollout/probe_problem_categories.sql —
--      report_problem(…7) 928acc38…, update_problem(…5) e323a4ad… (their bodies of
--      20261115090000, AFTER_LEVEL_CATALOGUE in rehearsal-problem-categories-1114.mjs), no
--      problem_categories, no problems.category_id, no hosts.problem_report_mode.
--
-- Like the migration it takes ACCESS EXCLUSIVE on problems and hosts for a moment: no long
-- transaction in pg_stat_activity. The panel and the API call report_problem by the six
-- arguments they always sent; nothing of theirs changes.
do $$
begin
  perform set_config('lock_timeout', '3s', true);

  drop function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean, uuid);
  drop function public.update_problem(uuid, text, text, public.problem_priority, boolean, uuid);

  -- The bodies of 20261115090000, word for word.
  create function public.report_problem(
  p_id          uuid,
  p_title       text,
  p_description text default null,
  p_priority    public.problem_priority default 'normal',
  p_property_id bigint default null,
  p_task_id     uuid default null,
  p_critical    boolean default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_problem  public.problems;
  v_property bigint;
  v_critical boolean := coalesce(p_critical, false);
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

  perform public.validate_problem_text(p_title, p_description);
  v_property := public.resolve_report_property(p_property_id, p_task_id);

  insert into public.problems (
    id, host_id, property_id, task_id, reported_by, title, description, priority, critical
  ) values (
    p_id, public.current_host_id(), v_property, p_task_id, (select auth.uid()),
    btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''),
    case when v_critical then 'high' else coalesce(p_priority, 'normal') end, v_critical
  )
  returning * into v_problem;

  return v_problem;
end;
$fn$;

  create function public.update_problem(
  p_id          uuid,
  p_title       text,
  p_description text default null,
  p_priority    public.problem_priority default 'normal',
  p_critical    boolean default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_problem public.problems;
begin
  select p.* into v_problem
  from public.problems p
  where p.id = p_id
    and p.host_id = public.current_host_id()
    and p.reported_by = (select auth.uid())
  for update;
  if not found then
    raise exception 'Problem not found'
      using errcode = 'check_violation', hint = 'serverErrors.problemNotFound';
  end if;
  if v_problem.status <> 'open' then
    raise exception 'Problem is % and can no longer be edited by its reporter', v_problem.status
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;

  perform public.validate_problem_text(p_title, p_description);

  update public.problems p
  set title       = btrim(p_title),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      priority    = case when p_critical then 'high' else coalesce(p_priority, 'normal') end,
      critical    = coalesce(p_critical, p.critical)
  where p.id = p_id
  returning * into v_problem;

  return v_problem;
end;
$fn$;

  revoke all on function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean)
    from public, anon;
  revoke all on function public.update_problem(uuid, text, text, public.problem_priority, boolean)
    from public, anon;
  grant execute on function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean)
    to authenticated, service_role;
  grant execute on function public.update_problem(uuid, text, text, public.problem_priority, boolean)
    to authenticated, service_role;

  drop function public.problem_category_for_report(uuid);
  alter table public.problems drop column category_id;
  drop table public.problem_categories;
  alter table public.hosts drop column problem_report_mode;
end $$;
