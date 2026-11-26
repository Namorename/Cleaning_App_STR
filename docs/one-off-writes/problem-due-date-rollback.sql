-- Rollback of 20261126130000_problem_due_date (docs/problem-due-date.md;
-- docs/rollout/boards-dates-chats-1126.md). One statement, so `supabase db query --linked -f`
-- takes it whole; then `npx supabase migration repair --status reverted 20261126130000 --linked`.
--
-- Order: the code first (main back, the OTA republished), then this. report_problem of
-- 20261115100000 comes back byte for byte (taken from the stand before the migration); the
-- function of the day and its check go; problems.due_on goes — the days planned since are lost
-- (save them first if wanted: select id, due_on from public.problems where due_on is not null).
do $undo$
begin
  perform set_config('lock_timeout', '3s', true);
  if not exists (select 1 from pg_attribute a
                 where a.attrelid = 'public.problems'::regclass and a.attname = 'due_on'
                   and not a.attisdropped) then
    raise notice '20261126130000 is not in this database: nothing to undo';
    return;
  end if;

  drop function if exists public.set_problem_due_date(uuid, date);
  drop function if exists public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean, uuid, date);

  execute $q$
CREATE OR REPLACE FUNCTION public.report_problem(p_id uuid, p_title text, p_description text DEFAULT NULL::text, p_priority problem_priority DEFAULT 'normal'::problem_priority, p_property_id bigint DEFAULT NULL::bigint, p_task_id uuid DEFAULT NULL::uuid, p_critical boolean DEFAULT NULL::boolean, p_category_id uuid DEFAULT NULL::uuid)
 RETURNS problems
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    critical, category_id
  ) values (
    p_id, public.current_host_id(), v_property, p_task_id, (select auth.uid()),
    btrim(v_title), v_title_i18n, nullif(btrim(coalesce(p_description, '')), ''), v_priority,
    v_critical, p_category_id
  )
  returning * into v_problem;

  return v_problem;
end;
$function$
$q$;

  revoke all on function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean, uuid) from public, anon;
  grant execute on function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean, uuid) to authenticated, service_role;

  drop function if exists public.problem_due_check(date);
  alter table public.problems drop column if exists due_on;
end;
$undo$;
