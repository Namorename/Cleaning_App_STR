-- The plan of resolution (docs/property-intelligence-plan.md §5, stage 4): steps gathered by theme
-- for one place. While it is a draft nobody sees it but the office; only the manager's launch
-- makes anything appear on the staff's screens, and a suggestion never does.
--
-- A step is one of four kinds, and each lands where that work already lives:
--   repair      a task on the board (problems, source 'plan') and its assignment;
--   inspection  an inspection in «Уборки» (save_task);
--   purchase    an accepted supply request (save_supply_request, review_supply_request);
--   decision    nothing: the step is its own record, closed by the office.
-- The id of what a launch makes is the step's id, so a repeat finds the same row.
--
-- What is not stored: «done». A plan is done when every step of it is closed, and a step's state
-- lives where its work lives. A task reopened brings the plan back to work with no write here.
-- The panel reads and writes through these functions; the tables have no client grants.

alter type public.problem_source add value if not exists 'plan';

create type public.plan_status as enum ('draft', 'launched', 'cancelled');
create type public.plan_step_kind as enum ('repair', 'inspection', 'purchase', 'decision');

create table public.resolution_plans (
  -- Minted by the client: a repeat of the first save is the same plan.
  id           uuid primary key,
  host_id      uuid not null references public.hosts (id) on delete restrict,
  property_id  bigint not null references public.properties (id) on delete restrict,
  title        text not null check (char_length(btrim(title)) between 1 and 200),
  status       public.plan_status not null default 'draft',
  -- A stale editor can neither save over nor launch what it has not seen.
  rev          integer not null default 1,
  -- The themes' numbers on the day of the launch, for the effect.
  baseline     jsonb,
  created_by   uuid not null references public.profiles (id) on delete restrict,
  launched_by  uuid references public.profiles (id) on delete set null,
  launched_at  timestamptz,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint resolution_plans_launch_said check ((status = 'draft') = (launched_at is null)),
  constraint resolution_plans_cancel_said check ((status = 'cancelled') = (cancelled_at is not null))
);

comment on table public.resolution_plans is
  'A manager''s plan for a place, by theme. Nothing reaches the staff before its launch.';

create unique index resolution_plans_one_draft on public.resolution_plans (property_id)
  where status = 'draft';
create index resolution_plans_place_idx on public.resolution_plans (host_id, property_id, created_at desc);

create table public.resolution_plan_steps (
  -- Minted by the client, and the id of the task, inspection or request a launch makes.
  id                uuid primary key,
  plan_id           uuid not null references public.resolution_plans (id) on delete cascade,
  host_id           uuid not null references public.hosts (id) on delete restrict,
  theme             text not null references public.issue_themes (code) on delete restrict,
  kind              public.plan_step_kind not null,
  title             text not null check (char_length(btrim(title)) between 1 and 200),
  title_i18n        jsonb not null default '{}'::jsonb check (jsonb_typeof(title_i18n) = 'object'),
  description       text check (description is null or char_length(description) <= 2000),
  assignee_id       uuid references public.profiles (id) on delete set null,
  due_on            date,
  priority          public.problem_priority not null default 'normal',
  sort_order        integer not null,
  -- A task already at work on this theme: the step leans on it and makes nothing.
  linked_problem_id uuid references public.problems (id) on delete set null,
  -- Null while the step is a draft, on a plan launched or not.
  launched_at       timestamptz,
  -- A decision is closed here; the other kinds close where they live.
  decided_at        timestamptz,
  decided_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint resolution_plan_steps_link_is_a_repair check (linked_problem_id is null or kind = 'repair'),
  constraint resolution_plan_steps_decided_is_a_decision check (decided_at is null or kind = 'decision')
);

comment on table public.resolution_plan_steps is
  'A step of a plan: what is to be done about a theme, by whom and by when.';

create index resolution_plan_steps_plan_idx on public.resolution_plan_steps (plan_id, sort_order);
create index resolution_plan_steps_linked_idx on public.resolution_plan_steps (linked_problem_id)
  where linked_problem_id is not null;
create index resolution_plan_steps_assignee_idx on public.resolution_plan_steps (assignee_id)
  where assignee_id is not null;

alter table public.resolution_plans enable row level security;
alter table public.resolution_plan_steps enable row level security;
revoke all on public.resolution_plans, public.resolution_plan_steps from public, anon, authenticated;

-- ===================================================================
-- Reading
-- ===================================================================

/** Each step of a plan with its state, read from where its work lives. Internal. */
create or replace function public.resolution_step_states(p_plan_id uuid)
returns table (step_id uuid, state text, work_status text, closed_at timestamptz)
language sql
stable
set search_path = ''
as $$
  select x.id, x.state, x.work_status, case when x.state = 'closed' then x.closed_at end
  from (
    select s.id,
           case
             when s.launched_at is null then 'draft'
             when s.kind = 'decision' then case when s.decided_at is null then 'open' else 'closed' end
             when s.kind = 'repair' then
               case when pr.id is null or pr.status in ('resolved', 'cancelled') then 'closed' else 'open' end
             when s.kind = 'inspection' then
               case when t.id is null or t.status in ('done', 'cancelled', 'expired') then 'closed' else 'open' end
             else
               case when r.id is null or r.status in ('fulfilled', 'rejected') then 'closed' else 'open' end
           end as state,
           coalesce(pr.status::text, t.status::text, r.status::text) as work_status,
           case s.kind
             when 'decision' then s.decided_at
             when 'repair' then coalesce(pr.resolved_at, pr.cancelled_at)
             when 'inspection' then coalesce(t.completed_at, t.updated_at)
             else coalesce(r.fulfilled_at, r.reviewed_at)
           end as closed_at
    from public.resolution_plan_steps s
    left join public.problems pr on s.kind = 'repair' and pr.id = coalesce(s.linked_problem_id, s.id)
    left join public.tasks t on s.kind = 'inspection' and t.id = s.id
    left join public.supply_requests r on s.kind = 'purchase' and r.id = s.id
    where s.plan_id = p_plan_id
  ) x
$$;

/** The plan with its steps, as the panel shows it. Null when it is not the company's. */
create or replace function public.resolution_plan(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
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
$$;

/** The plans of a place, newest first, with how far each has come. */
create or replace function public.property_resolution_plans(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'Plans are for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', p.id,
             'title', p.title,
             'status', case when p.status = 'launched' and n.total > 0 and n.total = n.closed
                            then 'done' else p.status::text end,
             'rev', p.rev,
             'created_at', p.created_at,
             'launched_at', p.launched_at,
             'steps_total', n.total,
             'steps_closed', n.closed,
             'themes', n.themes
           ) order by p.created_at desc)
    from public.resolution_plans p
    cross join lateral (
      select count(*) as total,
             count(*) filter (where x.state = 'closed') as closed,
             coalesce(jsonb_agg(distinct s.theme), '[]'::jsonb) as themes
      from public.resolution_plan_steps s
      join public.resolution_step_states(p.id) x on x.step_id = s.id
      where s.plan_id = p.id
    ) n
    where p.host_id = public.current_host_id() and p.property_id = p_property_id
  ), '[]'::jsonb);
end;
$$;

/** Live tasks of a place with their themes: what a draft may lean on instead of making its own. */
create or replace function public.resolution_plan_place_work(p_property_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'Plans are for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'problem_id', pr.id,
             'title', pr.title,
             'status', pr.status,
             'theme', t.theme
           ) order by pr.created_at desc)
    from public.problems pr
    join public.problem_themes t on t.problem_id = pr.id
    join public.properties l on l.id = pr.property_id
    where pr.host_id = public.current_host_id()
      and coalesce(l.parent_id, l.id) = p_property_id
      and pr.status not in ('resolved', 'cancelled')
      and pr.archived_at is null
  ), '[]'::jsonb);
end;
$$;

-- ===================================================================
-- The draft
-- ===================================================================

/**
 * Saves a plan's draft steps whole. On a launched plan the steps sent are the new ones: what has
 * been launched is out of reach here. p_rev is what the editor last read; null for a new plan.
 */
create or replace function public.save_resolution_plan(
  p_id          uuid,
  p_property_id bigint,
  p_title       text,
  p_steps       jsonb,
  p_rev         integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      v_prio  := coalesce(nullif(v_step ->> 'priority', ''), 'normal')::public.problem_priority;
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
           and not exists (select 1 from public.problems pr where pr.id = v_link and pr.host_id = v_host))
       or exists (select 1 from public.resolution_plan_steps s
                  where s.id = v_id and (s.plan_id <> p_id or s.launched_at is not null)) then
      raise exception 'Step % is not valid', v_index
        using errcode = 'check_violation',
              hint = 'serverErrors.planStepInvalid',
              detail = jsonb_build_object('index', v_index)::text;
    end if;

    insert into public.resolution_plan_steps (id, plan_id, host_id, theme, kind, title, title_i18n,
                                              description, assignee_id, due_on, priority, sort_order,
                                              linked_problem_id)
    values (v_id, p_id, v_host, v_theme, v_kind, v_text, v_i18n, v_notes, v_who, v_due, v_prio,
            v_index, v_link)
    on conflict (id) do update
    set theme = excluded.theme, kind = excluded.kind, title = excluded.title,
        title_i18n = excluded.title_i18n, description = excluded.description,
        assignee_id = excluded.assignee_id, due_on = excluded.due_on, priority = excluded.priority,
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
$$;

/** A draft goes without a trace: nobody saw it. A launched plan is cancelled, never deleted. */
create or replace function public.delete_resolution_plan(p_id uuid, p_rev integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.resolution_plans;
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'Plans are for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select p.* into v_plan
  from public.resolution_plans p
  where p.id = p_id and p.host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Plan % not found', p_id
      using errcode = 'check_violation', hint = 'serverErrors.planNotFound';
  end if;
  if v_plan.status <> 'draft' then
    raise exception 'Plan % is not a draft', p_id
      using errcode = 'check_violation', hint = 'serverErrors.planNotDraft';
  end if;
  if p_rev is distinct from v_plan.rev then
    raise exception 'Plan % changed while it was open', p_id
      using errcode = 'check_violation', hint = 'serverErrors.planChanged';
  end if;

  delete from public.resolution_plans p where p.id = p_id;
end;
$$;

-- ===================================================================
-- The launch
-- ===================================================================

/**
 * The themes' numbers on the day of the launch, by the same reads the panel uses: twelve months
 * and the last three. Internal.
 */
create or replace function public.resolution_plan_baseline(p_host uuid, p_property bigint, p_themes text[])
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_code  text;
  v_b     record;
  v_out   jsonb := '{}'::jsonb;
begin
  foreach v_code in array array['12m', '3m'] loop
    select * into v_b from public.quality_bounds(v_code, v_today);
    v_out := v_out || jsonb_build_object(v_code, jsonb_build_object(
      'stays', (public.quality_place_rows(p_host, v_today, v_b.grain, v_b.from_day, v_b.prev_from,
                                          v_b.prev_to, v_b.from_day, v_b.prev_from, v_b.prev_to,
                                          p_property) -> 0 ->> 'stays')::integer,
      'themes', coalesce((
        select jsonb_object_agg(t ->> 'theme', jsonb_build_object(
                 'reviews', (t ->> 'reviews')::integer,
                 'found', (t ->> 'found')::integer,
                 'reported', (t ->> 'reported')::integer))
        from jsonb_array_elements(public.quality_theme_rows(p_host, v_today, v_b.grain, v_b.from_day,
                                                            v_b.prev_from, v_b.prev_to, p_property)) t
        where t ->> 'theme' = any (p_themes)
      ), '{}'::jsonb)
    ));
  end loop;
  return jsonb_build_object('on', v_today) || v_out;
end;
$$;

/**
 * Launches the steps still in draft, in one transaction: all of them or none. A refusal names each
 * step and why, in `detail`, for the panel to translate.
 */
create or replace function public.launch_resolution_plan(p_id uuid, p_rev integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host    uuid := public.current_host_id();
  v_plan    public.resolution_plans;
  v_step    public.resolution_plan_steps;
  v_refused jsonb;
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
             when s.linked_problem_id is not null and pr.status in ('resolved', 'cancelled') then 'task_closed'
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
                                   description, priority, source, source_facts)
      values (v_step.id, v_host, v_plan.property_id, (select auth.uid()), v_step.title,
              v_step.title_i18n, v_step.description, v_step.priority, 'plan',
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

  update public.resolution_plans p
  set status = 'launched',
      launched_by = coalesce(p.launched_by, (select auth.uid())),
      launched_at = coalesce(p.launched_at, v_now),
      baseline = coalesce(p.baseline, public.resolution_plan_baseline(
        v_host, p.property_id,
        (select array_agg(distinct s.theme) from public.resolution_plan_steps s where s.plan_id = p_id))),
      rev = p.rev + 1,
      updated_at = v_now
  where p.id = p_id;

  return public.resolution_plan(p_id);
end;
$$;

/** A decision taken, or taken back. The other kinds close where their work lives. */
create or replace function public.set_resolution_step_decided(p_step_id uuid, p_decided boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.resolution_plan_steps;
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'Plans are for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select s.* into v_step
  from public.resolution_plan_steps s
  where s.id = p_step_id and s.host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Step % not found', p_step_id
      using errcode = 'check_violation', hint = 'serverErrors.planNotFound';
  end if;
  if v_step.kind <> 'decision' or v_step.launched_at is null then
    raise exception 'Step % is not a launched decision', p_step_id
      using errcode = 'check_violation', hint = 'serverErrors.planStepInvalid';
  end if;

  update public.resolution_plan_steps s
  set decided_at = case when coalesce(p_decided, false) then now() end,
      decided_by = case when coalesce(p_decided, false) then (select auth.uid()) end,
      updated_at = now()
  where s.id = p_step_id;

  return public.resolution_plan(v_step.plan_id);
end;
$$;

/** The plan is closed; what it made stays, and the office decides about it one by one. */
create or replace function public.cancel_resolution_plan(p_id uuid, p_rev integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.resolution_plans;
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'Plans are for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select p.* into v_plan
  from public.resolution_plans p
  where p.id = p_id and p.host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Plan % not found', p_id
      using errcode = 'check_violation', hint = 'serverErrors.planNotFound';
  end if;
  if v_plan.status = 'cancelled' then
    return public.resolution_plan(p_id);
  end if;
  if v_plan.status = 'draft' then
    raise exception 'A draft is deleted, not cancelled'
      using errcode = 'check_violation', hint = 'serverErrors.planNotLaunched';
  end if;
  if p_rev is distinct from v_plan.rev then
    raise exception 'Plan % changed while it was open', p_id
      using errcode = 'check_violation', hint = 'serverErrors.planChanged';
  end if;

  -- A step still a draft goes: nothing of it ever reached anyone.
  delete from public.resolution_plan_steps s where s.plan_id = p_id and s.launched_at is null;

  update public.resolution_plans p
  set status = 'cancelled', cancelled_at = now(), rev = p.rev + 1, updated_at = now()
  where p.id = p_id;

  return public.resolution_plan(p_id);
end;
$$;

revoke all on function public.resolution_step_states(uuid) from public, anon, authenticated, service_role;
revoke all on function public.resolution_plan_baseline(uuid, bigint, text[]) from public, anon, authenticated, service_role;

revoke all on function public.resolution_plan(uuid) from public, anon;
revoke all on function public.property_resolution_plans(bigint) from public, anon;
revoke all on function public.resolution_plan_place_work(bigint) from public, anon;
revoke all on function public.save_resolution_plan(uuid, bigint, text, jsonb, integer) from public, anon;
revoke all on function public.delete_resolution_plan(uuid, integer) from public, anon;
revoke all on function public.launch_resolution_plan(uuid, integer) from public, anon;
revoke all on function public.set_resolution_step_decided(uuid, boolean) from public, anon;
revoke all on function public.cancel_resolution_plan(uuid, integer) from public, anon;
grant execute on function public.resolution_plan(uuid) to authenticated;
grant execute on function public.property_resolution_plans(bigint) to authenticated;
grant execute on function public.resolution_plan_place_work(bigint) to authenticated;
grant execute on function public.save_resolution_plan(uuid, bigint, text, jsonb, integer) to authenticated;
grant execute on function public.delete_resolution_plan(uuid, integer) to authenticated;
grant execute on function public.launch_resolution_plan(uuid, integer) to authenticated;
grant execute on function public.set_resolution_step_decided(uuid, boolean) to authenticated;
grant execute on function public.cancel_resolution_plan(uuid, integer) to authenticated;
