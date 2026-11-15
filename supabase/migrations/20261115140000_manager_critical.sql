-- CORE (owner, 2026-11-15): «Критическая», the level above high (20261115090000), wherever a
-- manager sets how urgent a new task is — not only in the forms of the task itself:
--   * the approval of what a guest's review or chat suggested (approve_signal_finding), and the
--     task a manager adds to a guest's message by hand (add_signal_finding): p_critical, default
--     null — the panel of before, or a caller that says nothing, files as it did. What the model
--     proposed (signal_findings.urgency) is not touched: only the manager's choice is;
--   * the steps of a resolution plan: resolution_plan_steps.critical, read and written as the
--     level 'critical' in the steps of save_resolution_plan, answered beside priority by
--     resolution_plan, and filed on the task when the plan is launched.
-- Stored as on every task: priority 'high' with the flag. A server that took three values takes
-- four; a caller that sends three is answered as before.
--
-- The functions below are the live definitions (20261030110000, 20261110220000) read back with
-- pg_get_functiondef and changed only where the comments say; the rollback
-- (docs/one-off-writes/manager-critical-rollback.sql) restores them byte for byte.
--
-- Locks: ADD COLUMN on resolution_plan_steps takes ACCESS EXCLUSIVE for a moment (a constant
-- default: no rewrite). After 3 s the push gives up whole. Push outside 03:00–04:40 UTC.

set local lock_timeout = '3s';

alter table public.resolution_plan_steps
  add column critical boolean not null default false;

alter table public.resolution_plan_steps
  add constraint resolution_plan_steps_critical_is_high check (not critical or priority = 'high');

comment on column public.resolution_plan_steps.critical is
  'The level above high, as on a task (20261115090000): true only with priority = ''high''; the launched task takes it.';

-- ---------- the guests' suggestions: the manager's choice ----------

drop function public.approve_signal_finding(p_finding_id uuid, p_title text, p_priority problem_priority, p_link_problem_id uuid, p_description text, p_assignee_id uuid, p_scheduled_date date);

CREATE OR REPLACE FUNCTION public.approve_signal_finding(p_finding_id uuid, p_title text DEFAULT NULL::text, p_priority problem_priority DEFAULT NULL::problem_priority, p_link_problem_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_assignee_id uuid DEFAULT NULL::uuid, p_scheduled_date date DEFAULT NULL::date, p_critical boolean DEFAULT NULL::boolean)
 RETURNS signal_findings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_finding public.signal_findings;
  v_signal  public.guest_signals;
  v_since   date;
  v_enabled boolean;
  v_link    public.problems;
  v_twin    uuid;
  v_problem uuid;
begin
  if not public.is_manager() then
    raise exception 'Only a manager decides about findings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;

  -- The signal first, then the finding: the order apply_signal_findings and
  -- erase_signal_texts take them in, so a manager and the job never wait on
  -- each other crosswise.
  perform 1 from public.guest_signals g
  where g.id = (select f.signal_id from public.signal_findings f
                where f.id = p_finding_id and f.host_id = public.current_host_id())
  for update;
  select * into v_finding from public.signal_findings
  where id = p_finding_id and host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Finding % not found', p_finding_id
      using errcode = 'no_data_found', hint = 'serverErrors.signalFindingNotFound';
  end if;
  if v_finding.status in ('task_created', 'duplicate') then
    return v_finding;
  end if;
  -- The manager may overrule the rules: a finding dropped for low confidence,
  -- or one they took for fixed, can still become work. A rejection, or a kind
  -- or place that never makes a problem, cannot.
  if v_finding.status not in ('candidate', 'dropped', 'already_fixed') then
    raise exception 'Finding % is already decided', p_finding_id
      using errcode = 'check_violation', hint = 'serverErrors.signalFindingDecided',
            detail = jsonb_build_object('status', v_finding.status)::text;
  end if;

  select * into v_signal from public.guest_signals where id = v_finding.signal_id;
  v_since := public.signal_since(v_signal);

  select coalesce(s.tasks_enabled, false) into v_enabled
  from public.signal_settings s where s.host_id = v_finding.host_id and s.kind = v_signal.kind;
  if not coalesce(v_enabled, false) then
    raise exception 'Problems from guest signals of this kind are switched off'
      using errcode = 'check_violation', hint = 'serverErrors.signalTasksDisabled',
            detail = jsonb_build_object('kind', v_signal.kind)::text;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('signal-place:' || public.signal_place_family(v_finding.property_id), 0));

  if p_link_problem_id is not null then
    select * into v_link from public.problems
    where id = p_link_problem_id and host_id = v_finding.host_id;
    if not found
       or public.signal_place_family(v_link.property_id)
          is distinct from public.signal_place_family(v_finding.property_id)
       or not ((v_link.archived_at is null and v_link.status in ('open', 'assigned', 'in_progress'))
               or (v_link.status = 'resolved'
                   and coalesce(v_link.resolved_at::date >= v_since, false))) then
      raise exception 'Problem % cannot take this finding', p_link_problem_id
        using errcode = 'check_violation', hint = 'serverErrors.signalLinkInvalid';
    end if;
    update public.signal_findings
    set status = case when v_link.status = 'resolved'
                      then 'already_fixed'::public.signal_finding_status
                      else 'duplicate'::public.signal_finding_status end,
        problem_id = v_link.id, decided_mode = 'manager',
        decided_by = (select auth.uid()), decided_at = now()
    where id = p_finding_id;
    perform public.record_signal_feedback(
      p_finding_id,
      case when v_link.status = 'resolved' then 'already_fixed' else 'duplicate' end::public.signal_verdict);
    perform public.cut_signal_stay_links(array[v_finding.signal_id]);
    select * into v_finding from public.signal_findings where id = p_finding_id;
    return v_finding;
  end if;

  -- The same fault already has its work order (two guests, or a candidate
  -- that waited while the job made one): no second visit. The screen offers
  -- «Это то же самое» with this id.
  v_twin := public.signal_open_twin(p_finding_id);
  if v_twin is not null then
    raise exception 'An open problem from a guest signal is about the same: %', v_twin
      using errcode = 'check_violation', hint = 'serverErrors.signalDuplicateOpen',
            detail = jsonb_build_object('problem_id', v_twin)::text;
  end if;

  -- No words to offer (a rules card, or one whose text was erased): the
  -- screen fills the title from the kind and the subject in the manager's
  -- language, and the manager may change it.
  if v_finding.summary_i18n = '{}'::jsonb and nullif(btrim(p_title), '') is null then
    raise exception 'Finding % has no wording; it needs a title', p_finding_id
      using errcode = 'check_violation', hint = 'serverErrors.signalTitleRequired';
  end if;

  -- The manager's own title is in the company's language and has no
  -- translations; the model's comes with all three.
  v_problem := public.create_signal_problem(
    p_finding_id,
    coalesce(nullif(btrim(p_title), ''), v_finding.summary),
    case when nullif(btrim(p_title), '') is null then v_finding.summary_i18n end,
    case when p_critical then 'high' else coalesce(p_priority, v_finding.urgency) end,
    'manager',
    p_description);
  -- The level above high (20261115090000): filed high, the flag set before anything reads
  -- it (the push went out on the insert, as for high).
  if p_critical then
    update public.problems set critical = true where id = v_problem;
  end if;
  perform public.record_signal_feedback(p_finding_id, 'confirmed');

  -- Sent at once, or left in «Открытые». assign_problem checks the person
  -- (an active member of the company) and the day; a refusal there undoes
  -- the problem too — one press, one outcome.
  if p_assignee_id is not null then
    perform public.assign_problem(v_problem, p_assignee_id, p_scheduled_date);
  end if;

  -- Decided: with no other candidate left, the stay goes to its month.
  perform public.cut_signal_stay_links(array[v_finding.signal_id]);

  select * into v_finding from public.signal_findings where id = p_finding_id;
  return v_finding;
end;
$function$
;

revoke all on function public.approve_signal_finding(p_finding_id uuid, p_title text, p_priority problem_priority, p_link_problem_id uuid, p_description text, p_assignee_id uuid, p_scheduled_date date, p_critical boolean) from public, anon, authenticated, service_role;
grant execute on function public.approve_signal_finding(p_finding_id uuid, p_title text, p_priority problem_priority, p_link_problem_id uuid, p_description text, p_assignee_id uuid, p_scheduled_date date, p_critical boolean) to authenticated, service_role;

drop function public.add_signal_finding(p_signal_id uuid, p_kind signal_finding_kind, p_subject text, p_title text, p_priority problem_priority, p_description text, p_assignee_id uuid, p_scheduled_date date);

CREATE OR REPLACE FUNCTION public.add_signal_finding(p_signal_id uuid, p_kind signal_finding_kind, p_subject text, p_title text, p_priority problem_priority DEFAULT 'normal'::problem_priority, p_description text DEFAULT NULL::text, p_assignee_id uuid DEFAULT NULL::uuid, p_scheduled_date date DEFAULT NULL::date, p_critical boolean DEFAULT NULL::boolean)
 RETURNS signal_findings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_signal public.guest_signals;
  v_id     uuid;
begin
  if not public.is_manager() then
    raise exception 'Only a manager decides about findings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;
  -- Locked first, as approve_signal_finding takes it.
  select * into v_signal from public.guest_signals
  where id = p_signal_id and host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Guest signal % not found', p_signal_id
      using errcode = 'no_data_found', hint = 'serverErrors.signalNotFound';
  end if;
  if not public.signal_finding_gives_task(p_kind) then
    raise exception 'Kind % never makes a problem', p_kind
      using errcode = 'check_violation', hint = 'serverErrors.signalKindNoTask',
            detail = jsonb_build_object('kind', p_kind)::text;
  end if;
  if not (p_subject = any (public.signal_subjects())) then
    raise exception 'Unknown subject %', p_subject
      using errcode = 'check_violation', hint = 'serverErrors.signalSubjectUnknown',
            detail = jsonb_build_object('subject', p_subject)::text;
  end if;
  perform public.validate_problem_text(p_title, p_description);

  insert into public.signal_findings (host_id, signal_id, property_id, kind, subject, urgency,
                                      summary, summary_i18n, confidence, detector)
  values (v_signal.host_id, v_signal.id, coalesce(v_signal.room_id, v_signal.property_id),
          p_kind, p_subject, case when p_critical then 'high' else coalesce(p_priority, 'normal') end, btrim(p_title), '{}'::jsonb, 1, 'manual')
  on conflict (signal_id, kind, subject) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.signal_findings
    where signal_id = p_signal_id and kind = p_kind and subject = p_subject;
  end if;
  return public.approve_signal_finding(v_id, p_title, p_priority,
                                       p_description    => p_description,
                                       p_critical       => p_critical,
                                       p_assignee_id    => p_assignee_id,
                                       p_scheduled_date => p_scheduled_date);
end;
$function$
;

revoke all on function public.add_signal_finding(p_signal_id uuid, p_kind signal_finding_kind, p_subject text, p_title text, p_priority problem_priority, p_description text, p_assignee_id uuid, p_scheduled_date date, p_critical boolean) from public, anon, authenticated, service_role;
grant execute on function public.add_signal_finding(p_signal_id uuid, p_kind signal_finding_kind, p_subject text, p_title text, p_priority problem_priority, p_description text, p_assignee_id uuid, p_scheduled_date date, p_critical boolean) to authenticated, service_role;

-- ---------- the steps of a resolution plan ----------

CREATE OR REPLACE FUNCTION public.save_resolution_plan(p_id uuid, p_property_id bigint, p_title text, p_steps jsonb, p_rev integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_host  uuid := public.current_host_id();
  v_plan  public.resolution_plans;
  v_title text := btrim(coalesce(p_title, ''));
  v_draft uuid;
  v_step  jsonb;
  v_index integer := 0;
  v_ids   uuid[] := '{}';
  v_id    uuid;
  v_theme text;
  v_kind  public.plan_step_kind;
  v_text  text;
  v_i18n  jsonb;
  v_notes text;
  v_who   uuid;
  v_due   date;
  v_prio  public.problem_priority;
  v_crit  boolean;
  v_link  uuid;
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'Plans are for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if char_length(v_title) not between 1 and 200 then
    raise exception 'A plan needs a title of up to 200 characters'
      using errcode = 'check_violation', hint = 'serverErrors.planTitleInvalid';
  end if;
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'Steps must be an array'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.planStepInvalid';
  end if;
  if jsonb_array_length(p_steps) > 100 then
    raise exception 'A plan holds up to 100 steps'
      using errcode = 'check_violation', hint = 'serverErrors.planTooManySteps';
  end if;

  select p.* into v_plan
  from public.resolution_plans p
  where p.id = p_id and p.host_id = v_host
  for update;

  if found then
    if v_plan.status = 'cancelled' then
      raise exception 'Plan % is cancelled', p_id
        using errcode = 'check_violation', hint = 'serverErrors.planClosed';
    end if;
    if p_rev is distinct from v_plan.rev then
      raise exception 'Plan % changed while it was open', p_id
        using errcode = 'check_violation', hint = 'serverErrors.planChanged';
    end if;
  else
    if exists (select 1 from public.resolution_plans p where p.id = p_id) then
      raise exception 'Plan % is not in this company', p_id
        using errcode = 'check_violation', hint = 'serverErrors.planNotFound';
    end if;
    if not exists (select 1 from public.properties l
                   where l.id = p_property_id and l.host_id = v_host
                     and l.parent_id is null and l.status <> 'archived') then
      raise exception 'Listing % cannot take a plan', p_property_id
        using errcode = 'check_violation', hint = 'serverErrors.propertyNotFound';
    end if;
    select p.id into v_draft
    from public.resolution_plans p
    where p.property_id = p_property_id and p.status = 'draft';
    if found then
      raise exception 'Listing % already has a draft', p_property_id
        using errcode = 'check_violation',
              hint = 'serverErrors.planDraftExists',
              detail = jsonb_build_object('plan_id', v_draft)::text;
    end if;
    insert into public.resolution_plans (id, host_id, property_id, title, created_by)
    values (p_id, v_host, p_property_id, v_title, (select auth.uid()))
    returning * into v_plan;
  end if;

  for v_step in select value from jsonb_array_elements(p_steps) loop
    v_index := v_index + 1;
    begin
      v_id    := (v_step ->> 'id')::uuid;
      v_theme := v_step ->> 'theme';
      v_kind  := (v_step ->> 'kind')::public.plan_step_kind;
      v_text  := btrim(coalesce(v_step ->> 'title', ''));
      v_i18n  := coalesce(v_step -> 'title_i18n', '{}'::jsonb);
      v_notes := nullif(btrim(coalesce(v_step ->> 'description', '')), '');
      v_who   := nullif(v_step ->> 'assignee_id', '')::uuid;
      v_due   := nullif(v_step ->> 'due_on', '')::date;
      -- 'critical' is the level above high (20261115090000): high with the flag.
      v_crit  := coalesce((v_step ->> 'priority') = 'critical', false);
      v_prio  := case when v_crit then 'high'
                      else coalesce(nullif(v_step ->> 'priority', ''), 'normal') end::public.problem_priority;
      v_link  := nullif(v_step ->> 'linked_problem_id', '')::uuid;
    exception when others then
      raise exception 'Step % cannot be read', v_index
        using errcode = 'check_violation',
              hint = 'serverErrors.planStepInvalid',
              detail = jsonb_build_object('index', v_index)::text;
    end;

    if v_id is null
       or char_length(v_text) not between 1 and 200
       or char_length(coalesce(v_notes, '')) > 2000
       or not public.is_localized_text(v_i18n)
       or not exists (select 1 from public.issue_themes t where t.code = v_theme)
       or (v_link is not null and v_kind <> 'repair')
       or (v_who is not null
           and not exists (select 1 from public.profiles f where f.id = v_who and f.host_id = v_host))
       or (v_link is not null
           and not exists (select 1 from public.problems pr
                           join public.properties l on l.id = pr.property_id
                           where pr.id = v_link and pr.host_id = v_host
                             and coalesce(l.parent_id, l.id) = v_plan.property_id))
       or exists (select 1 from public.resolution_plan_steps s
                  where s.id = v_id and (s.plan_id <> p_id or s.launched_at is not null)) then
      raise exception 'Step % is not valid', v_index
        using errcode = 'check_violation',
              hint = 'serverErrors.planStepInvalid',
              detail = jsonb_build_object('index', v_index)::text;
    end if;

    insert into public.resolution_plan_steps (id, plan_id, host_id, theme, kind, title, title_i18n,
                                              description, assignee_id, due_on, priority, critical, sort_order,
                                              linked_problem_id)
    values (v_id, p_id, v_host, v_theme, v_kind, v_text, v_i18n, v_notes, v_who, v_due, v_prio, v_crit,
            v_index, v_link)
    on conflict (id) do update
    set theme = excluded.theme, kind = excluded.kind, title = excluded.title,
        title_i18n = excluded.title_i18n, description = excluded.description,
        assignee_id = excluded.assignee_id, due_on = excluded.due_on, priority = excluded.priority,
        critical = excluded.critical,
        sort_order = excluded.sort_order, linked_problem_id = excluded.linked_problem_id,
        updated_at = now();
    v_ids := v_ids || v_id;
  end loop;

  delete from public.resolution_plan_steps s
  where s.plan_id = p_id and s.launched_at is null and not (s.id = any (v_ids));

  update public.resolution_plans p
  set title = v_title, rev = p.rev + 1, updated_at = now()
  where p.id = p_id;

  return public.resolution_plan(p_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.resolution_plan(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan public.resolution_plans;
  v_done boolean;
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'Plans are for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select p.* into v_plan
  from public.resolution_plans p
  where p.id = p_id and p.host_id = public.current_host_id();
  if not found then
    return null;
  end if;

  v_done := v_plan.status = 'launched'
            and exists (select 1 from public.resolution_step_states(p_id))
            and not exists (select 1 from public.resolution_step_states(p_id) x where x.state <> 'closed');

  return jsonb_build_object(
    'id', v_plan.id,
    'property_id', v_plan.property_id,
    'property_name', (select l.name from public.properties l where l.id = v_plan.property_id),
    'title', v_plan.title,
    'status', case when v_done then 'done' else v_plan.status::text end,
    'rev', v_plan.rev,
    'created_at', v_plan.created_at,
    'launched_at', v_plan.launched_at,
    'cancelled_at', v_plan.cancelled_at,
    'closed_at', case when v_done
                      then (select max(x.closed_at) from public.resolution_step_states(p_id) x) end,
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id,
               'theme', s.theme,
               'kind', s.kind,
               'title', s.title,
               'title_i18n', s.title_i18n,
               'description', s.description,
               'assignee_id', s.assignee_id,
               'assignee_name', pf.full_name,
               'due_on', s.due_on,
               'priority', s.priority,
               'critical', s.critical,
               'linked_problem_id', s.linked_problem_id,
               'launched_at', s.launched_at,
               'state', x.state,
               'work_status', x.work_status,
               'closed_at', x.closed_at
             ) order by s.sort_order)
      from public.resolution_plan_steps s
      join public.resolution_step_states(p_id) x on x.step_id = s.id
      left join public.profiles pf on pf.id = s.assignee_id
      where s.plan_id = p_id
    ), '[]'::jsonb)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.launch_resolution_plan(p_id uuid, p_rev integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_host    uuid := public.current_host_id();
  v_plan    public.resolution_plans;
  v_step    public.resolution_plan_steps;
  v_refused jsonb;
  v_fresh   jsonb;
  v_now     timestamptz := now();
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'Plans are for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select p.* into v_plan
  from public.resolution_plans p
  where p.id = p_id and p.host_id = v_host
  for update;
  if not found then
    raise exception 'Plan % not found', p_id
      using errcode = 'check_violation', hint = 'serverErrors.planNotFound';
  end if;
  if v_plan.status = 'cancelled' then
    raise exception 'Plan % is cancelled', p_id
      using errcode = 'check_violation', hint = 'serverErrors.planClosed';
  end if;

  -- A second press, or a repeat after a lost answer: what was launched stands.
  if v_plan.status = 'launched'
     and not exists (select 1 from public.resolution_plan_steps s
                     where s.plan_id = p_id and s.launched_at is null) then
    return public.resolution_plan(p_id);
  end if;

  if p_rev is distinct from v_plan.rev then
    raise exception 'Plan % changed while it was open', p_id
      using errcode = 'check_violation', hint = 'serverErrors.planChanged';
  end if;
  if not exists (select 1 from public.resolution_plan_steps s
                 where s.plan_id = p_id and s.launched_at is null) then
    raise exception 'Plan % has no steps to launch', p_id
      using errcode = 'check_violation', hint = 'serverErrors.planNoSteps';
  end if;
  if not exists (select 1 from public.properties l
                 where l.id = v_plan.property_id and l.status <> 'archived') then
    raise exception 'Listing % is archived', v_plan.property_id
      using errcode = 'check_violation', hint = 'serverErrors.planPlaceArchived';
  end if;

  select jsonb_agg(jsonb_build_object('step', x.id, 'reason', x.reason) order by x.sort_order)
  into v_refused
  from (
    select s.id, s.sort_order,
           case
             when s.assignee_id is not null and not coalesce(f.is_active, false) then 'assignee_inactive'
             when s.assignee_id is not null
                  and not (case s.kind
                             when 'repair' then f.role in ('tech', 'head_tech')
                             when 'inspection' then f.role in ('cleaner', 'manager', 'admin')
                             else f.role in ('manager', 'admin')
                           end) then 'assignee_role'
             when s.kind = 'inspection' and s.due_on is null then 'date_missing'
             when s.linked_problem_id is not null
                  and (pr.status in ('resolved', 'cancelled') or pr.archived_at is not null) then 'task_closed'
             when s.kind = 'repair' and s.linked_problem_id is null
                  and (char_length(s.title) > public.problem_title_max_length()
                       or char_length(coalesce(s.description, '')) > public.problem_description_max_length())
                  then 'text_too_long'
             when s.kind = 'inspection' and char_length(s.title) > public.task_title_max_length()
                  then 'text_too_long'
           end as reason
    from public.resolution_plan_steps s
    left join public.profiles f on f.id = s.assignee_id
    left join public.problems pr on pr.id = s.linked_problem_id
    where s.plan_id = p_id and s.launched_at is null
  ) x
  where x.reason is not null;

  if v_refused is not null then
    raise exception 'Plan % has steps that cannot be launched', p_id
      using errcode = 'check_violation',
            hint = 'serverErrors.planNotLaunchable',
            detail = jsonb_build_object('steps', v_refused)::text;
  end if;

  for v_step in
    select s.* from public.resolution_plan_steps s
    where s.plan_id = p_id and s.launched_at is null
    order by s.sort_order
  loop
    if v_step.kind = 'repair' and v_step.linked_problem_id is null then
      perform public.validate_problem_text(v_step.title, v_step.description);
      insert into public.problems (id, host_id, property_id, reported_by, title, title_i18n,
                                   description, priority, critical, source, source_facts)
      values (v_step.id, v_host, v_plan.property_id, (select auth.uid()), v_step.title,
              v_step.title_i18n, v_step.description, v_step.priority, v_step.critical, 'plan',
              -- kind is read by the push trigger: a plan is never urgent at night.
              jsonb_build_object('kind', 'plan', 'subject', v_step.theme, 'plan_id', p_id));
      -- The theme the manager chose: the work answers it from the first hour.
      insert into public.problem_themes (problem_id, theme, source, detector)
      values (v_step.id, v_step.theme, 'manual', 'manual');
      if v_step.assignee_id is not null then
        perform public.assign_problem(v_step.id, v_step.assignee_id, v_step.due_on);
      end if;
    elsif v_step.kind = 'inspection' then
      perform public.save_task(
        p_id => v_step.id,
        p_property_id => v_plan.property_id,
        p_type => 'inspection',
        p_scheduled_date => v_step.due_on,
        p_title => v_step.title,
        p_title_i18n => v_step.title_i18n,
        p_assignee_id => v_step.assignee_id,
        p_notes => v_step.description,
        p_allow_duplicate => true
      );
    elsif v_step.kind = 'purchase' then
      perform public.save_supply_request(
        v_step.id,
        jsonb_build_array(jsonb_build_object(
          'name', left(v_step.title, public.supply_item_name_max_length()), 'quantity', 1, 'unit', 'pcs')),
        case when v_step.priority = 'high' then 'urgent' else 'normal' end::public.supply_priority,
        v_step.description,
        v_step.due_on,
        v_plan.property_id,
        null
      );
      perform public.review_supply_request(v_step.id, 'accepted');
    end if;

    update public.resolution_plan_steps s
    set launched_at = v_now, updated_at = v_now
    where s.id = v_step.id;
  end loop;

  v_fresh := public.resolution_plan_baseline(
    v_host, v_plan.property_id,
    (select array_agg(distinct s.theme) from public.resolution_plan_steps s where s.plan_id = p_id));

  -- A theme added later takes the numbers of its own launch; those of the first stand.
  update public.resolution_plans p
  set status = 'launched',
      launched_by = coalesce(p.launched_by, (select auth.uid())),
      launched_at = coalesce(p.launched_at, v_now),
      baseline = case
        when p.baseline is null then v_fresh
        else jsonb_set(
               jsonb_set(p.baseline, '{12m,themes}',
                         (v_fresh #> '{12m,themes}') || (p.baseline #> '{12m,themes}')),
               '{3m,themes}', (v_fresh #> '{3m,themes}') || (p.baseline #> '{3m,themes}'))
      end,
      rev = p.rev + 1,
      updated_at = v_now
  where p.id = p_id;

  return public.resolution_plan(p_id);
end;
$function$
;
