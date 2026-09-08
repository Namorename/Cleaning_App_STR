-- F9: problems reported from the field, fixed as maintenance tasks.
--
-- A problem is the report: what is broken, where, how urgent, with photos
-- (20260908130100). The fix is an ordinary task of type 'maintenance' that
-- points back through tasks.problem_id, so the technician walks the same
-- machinery a cleaner does — a template of scope 'problem', a snapshot of
-- steps at start, media, the finish gate — and the problem's status follows
-- the task by trigger. Assignee, date and time therefore live on the task
-- and nowhere else.
--
-- Cleaners write only through RPC. The report is idempotent by a
-- client-generated id: a retry after a lost connection returns the row
-- instead of a duplicate, the same shape as add_task_media.

create type public.problem_priority as enum ('low', 'normal', 'high');
create type public.problem_status as enum ('open', 'assigned', 'in_progress', 'resolved', 'cancelled');

comment on type public.problem_status is
  'open = nobody holds it; assigned/in_progress/resolved follow the fix task; cancelled = closed without a fix.';

create or replace function public.problem_title_max_length()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 200 $$;

create or replace function public.problem_description_max_length()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 4000 $$;

revoke all on function public.problem_title_max_length() from public, anon;
revoke all on function public.problem_description_max_length() from public, anon;
grant execute on function public.problem_title_max_length() to authenticated, service_role;
grant execute on function public.problem_description_max_length() to authenticated, service_role;

-- ---------- the table ----------

create table public.problems (
  id            uuid primary key,
  host_id       uuid not null default public.default_host_id()
                  references public.hosts(id) on delete restrict,
  -- Optional on purpose: a manager may log a problem with no flat to pin it
  -- to. A problem reported from a task always has the task's listing.
  property_id   bigint references public.properties(id) on delete set null,
  -- The cleaning during which it was found, for context. Never required.
  task_id       uuid references public.tasks(id) on delete set null,
  reported_by   uuid not null references public.profiles(id) on delete restrict,
  title         text not null,
  description   text,
  priority      public.problem_priority not null default 'normal',
  status        public.problem_status not null default 'open',
  resolved_at   timestamptz,
  cancelled_at  timestamptz,
  cancel_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (length(btrim(title)) between 1 and 200),
  check (description is null or length(description) <= 4000),
  check (cancel_reason is null or length(cancel_reason) <= 1000)
);

comment on table public.problems is
  'Something broken, reported from the field. The fix is a maintenance task pointing back through tasks.problem_id.';

create index problems_host_status_idx on public.problems (host_id, status, created_at desc);
create index problems_reported_by_idx on public.problems (reported_by);
create index problems_property_idx on public.problems (property_id) where property_id is not null;

create trigger problems_touch
  before update on public.problems
  for each row execute function public.touch_updated_at();

-- The fix task. One live task per problem; a cancelled or expired attempt
-- makes room for the next one, and stays as history.
alter table public.tasks
  add column problem_id uuid references public.problems(id) on delete set null;

comment on column public.tasks.problem_id is
  'Set on a maintenance task that fixes a reported problem. The problem''s status follows this task.';

create unique index tasks_one_fix_per_problem
  on public.tasks (problem_id)
  where problem_id is not null and status not in ('cancelled', 'expired');

-- ---------- grants and row policies ----------

revoke all on public.problems from anon, authenticated;
grant select on public.problems to authenticated;
grant select, insert, update, delete on public.problems to service_role;

alter table public.problems enable row level security;

create policy "reporter reads own problems"
  on public.problems for select to authenticated
  using (reported_by = (select auth.uid())
         and host_id = public.current_host_id()
         and public.is_active_user());

-- The technician holding the fix task reads the report it came from.
create policy "fixer reads problems of own tasks"
  on public.problems for select to authenticated
  using (host_id = public.current_host_id()
         and public.is_active_user()
         and exists (select 1 from public.tasks t
                     where t.problem_id = problems.id
                       and t.assignee_id = (select auth.uid())));

create policy "managers read all problems"
  on public.problems for select to authenticated
  using (public.is_manager() and host_id = public.current_host_id());

create policy "managers write problems"
  on public.problems for all to authenticated
  using (public.is_manager() and host_id = public.current_host_id())
  with check (public.is_manager() and host_id = public.current_host_id());

-- ---------- the status follows the fix task ----------

/**
 * A maintenance task's status, read as the problem's.
 *
 * A cancelled or expired attempt puts the problem back on the board as open
 * rather than closing it: the flat is still broken. A problem the manager
 * has cancelled stays cancelled whatever its task does.
 */
create or replace function public.mirror_problem_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.problem_status;
begin
  if new.problem_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = new.status
     and old.problem_id is not distinct from new.problem_id then
    return new;
  end if;

  v_status := case new.status
    when 'assigned'    then 'assigned'
    when 'accepted'    then 'assigned'
    when 'in_progress' then 'in_progress'
    when 'paused'      then 'in_progress'
    when 'blocked'     then 'in_progress'
    when 'done'        then 'resolved'
    else 'open'
  end;

  update public.problems p
  set status      = v_status,
      resolved_at = case when v_status = 'resolved'
                         then coalesce(p.resolved_at, new.completed_at, now()) end
  where p.id = new.problem_id
    and p.status <> 'cancelled'
    and p.status <> v_status;

  return new;
end;
$$;

create trigger tasks_mirror_problem
  after insert or update of status, problem_id on public.tasks
  for each row execute function public.mirror_problem_status();

-- ---------- validation shared by the writes ----------

create or replace function public.validate_problem_text(p_title text, p_description text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    raise exception 'A problem needs a title'
      using errcode = 'check_violation', hint = 'serverErrors.problemTitleRequired';
  end if;
  if length(btrim(p_title)) > public.problem_title_max_length() then
    raise exception 'The title is longer than % characters', public.problem_title_max_length()
      using errcode = 'check_violation',
            hint = 'serverErrors.problemTitleTooLong',
            detail = jsonb_build_object('limit', public.problem_title_max_length())::text;
  end if;
  if length(coalesce(p_description, '')) > public.problem_description_max_length() then
    raise exception 'The description is longer than % characters',
      public.problem_description_max_length()
      using errcode = 'check_violation',
            hint = 'serverErrors.problemDescriptionTooLong',
            detail = jsonb_build_object('limit', public.problem_description_max_length())::text;
  end if;
end;
$$;

/**
 * The listing a report belongs to, and whether the caller may report there.
 *
 * From a task: the task's listing, and the caller must see the task (hers,
 * on her listings, or she is a manager). From a listing: the caller must
 * clean it or be a manager. Neither: no listing.
 */
create or replace function public.resolve_report_property(p_property_id bigint, p_task_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_property bigint;
begin
  if p_task_id is not null then
    select t.property_id into v_property
    from public.tasks t
    where t.id = p_task_id
      and t.host_id = public.current_host_id()
      and (t.assignee_id = (select auth.uid())
           or public.cleans_property(t.property_id)
           or public.is_manager());
    if not found then
      raise exception 'Task not found'
        using errcode = 'check_violation', hint = 'serverErrors.taskNotFound';
    end if;
    return v_property;
  end if;

  if p_property_id is not null then
    if not exists (select 1 from public.properties pr
                   where pr.id = p_property_id
                     and pr.host_id = public.current_host_id()
                     and (public.cleans_property(pr.id) or public.is_manager())) then
      raise exception 'Property not found'
        using errcode = 'check_violation', hint = 'serverErrors.propertyNotFound';
    end if;
    return p_property_id;
  end if;

  return null;
end;
$$;

revoke all on function public.validate_problem_text(text, text) from public, anon, authenticated;
revoke all on function public.resolve_report_property(bigint, uuid) from public, anon, authenticated;

-- ---------- the cleaner's side ----------

/**
 * Report a problem. Replayable: the same id returns the same row.
 */
create or replace function public.report_problem(
  p_id          uuid,
  p_title       text,
  p_description text default null,
  p_priority    public.problem_priority default 'normal',
  p_property_id bigint default null,
  p_task_id     uuid default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem  public.problems;
  v_property bigint;
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
    id, host_id, property_id, task_id, reported_by, title, description, priority
  ) values (
    p_id, public.current_host_id(), v_property, p_task_id, (select auth.uid()),
    btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_priority, 'normal')
  )
  returning * into v_problem;

  return v_problem;
end;
$$;

/** The reporter corrects her own report while nobody has picked it up. */
create or replace function public.update_problem(
  p_id          uuid,
  p_title       text,
  p_description text default null,
  p_priority    public.problem_priority default 'normal'
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
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
      priority    = coalesce(p_priority, 'normal')
  where p.id = p_id
  returning * into v_problem;

  return v_problem;
end;
$$;

-- ---------- the manager's side (the web panel of F10; tested here) ----------

create or replace function public.problem_for_manager(p_id uuid)
returns public.problems
language plpgsql
set search_path = ''
as $$
declare
  v_problem public.problems;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select p.* into v_problem
  from public.problems p
  where p.id = p_id and p.host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Problem not found'
      using errcode = 'check_violation', hint = 'serverErrors.problemNotFound';
  end if;

  return v_problem;
end;
$$;

revoke all on function public.problem_for_manager(uuid) from public, anon, authenticated;

/**
 * Hand the problem to a technician: the fix task is created, or moved when
 * one is already open. The task starts as 'assigned'; the problem follows.
 */
create or replace function public.assign_problem(
  p_id             uuid,
  p_assignee_id    uuid,
  p_scheduled_date date default null,
  p_time_from      time default null,
  p_time_to        time default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
  v_task_id uuid;
  v_date    date;
begin
  v_problem := public.problem_for_manager(p_id);

  if v_problem.status in ('resolved', 'cancelled') then
    raise exception 'Problem is % and cannot be assigned', v_problem.status
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;
  if v_problem.property_id is null then
    raise exception 'A problem without a listing cannot be scheduled'
      using errcode = 'check_violation', hint = 'serverErrors.problemNoProperty';
  end if;
  if not exists (select 1 from public.profiles pr
                 where pr.id = p_assignee_id
                   and pr.host_id = v_problem.host_id
                   and pr.is_active) then
    raise exception 'Assignee is not an active member of this company'
      using errcode = 'check_violation', hint = 'serverErrors.problemAssigneeInvalid';
  end if;

  v_date := coalesce(
    p_scheduled_date,
    (select (now() at time zone pr.timezone)::date
     from public.properties pr where pr.id = v_problem.property_id));

  select t.id into v_task_id
  from public.tasks t
  where t.problem_id = p_id and t.status not in ('done', 'cancelled', 'expired')
  for update;

  if found then
    update public.tasks t
    set assignee_id    = p_assignee_id,
        status         = case when t.status = 'unassigned' then 'assigned' else t.status end,
        scheduled_date = v_date,
        time_from      = p_time_from,
        time_to        = p_time_to
    where t.id = v_task_id;
  else
    insert into public.tasks (
      host_id, property_id, type, status, priority, assignee_id,
      scheduled_date, time_from, time_to, notes, problem_id
    ) values (
      v_problem.host_id, v_problem.property_id, 'maintenance', 'assigned', 0, p_assignee_id,
      v_date, p_time_from, p_time_to, v_problem.description, p_id
    );
  end if;

  select p.* into v_problem from public.problems p where p.id = p_id;
  return v_problem;
end;
$$;

/** Close the problem without a fix; a live fix task is cancelled with it. */
create or replace function public.cancel_problem(p_id uuid, p_reason text default null)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
begin
  v_problem := public.problem_for_manager(p_id);

  if v_problem.status = 'cancelled' then
    return v_problem;
  end if;
  if v_problem.status = 'resolved' then
    raise exception 'Problem is resolved and cannot be cancelled'
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;

  update public.problems p
  set status        = 'cancelled',
      cancelled_at  = now(),
      cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where p.id = p_id
  returning * into v_problem;

  update public.tasks t
  set status = 'cancelled'
  where t.problem_id = p_id and t.status not in ('done', 'cancelled', 'expired');

  return v_problem;
end;
$$;

/** Close the problem as fixed by hand; a live fix task is finished with it. */
create or replace function public.resolve_problem(p_id uuid)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
begin
  v_problem := public.problem_for_manager(p_id);

  if v_problem.status = 'resolved' then
    return v_problem;
  end if;
  if v_problem.status = 'cancelled' then
    raise exception 'Problem is cancelled and cannot be resolved'
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;

  -- The task is finished first: the mirror stamps the problem. Without a
  -- task the stamp is written here.
  update public.tasks t
  set status = 'done'
  where t.problem_id = p_id and t.status not in ('done', 'cancelled', 'expired');

  update public.problems p
  set status      = 'resolved',
      resolved_at = coalesce(p.resolved_at, now())
  where p.id = p_id
  returning * into v_problem;

  return v_problem;
end;
$$;

revoke all on function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid)
  from public, anon;
revoke all on function public.update_problem(uuid, text, text, public.problem_priority) from public, anon;
revoke all on function public.assign_problem(uuid, uuid, date, time, time) from public, anon;
revoke all on function public.cancel_problem(uuid, text) from public, anon;
revoke all on function public.resolve_problem(uuid) from public, anon;
grant execute on function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid)
  to authenticated, service_role;
grant execute on function public.update_problem(uuid, text, text, public.problem_priority)
  to authenticated, service_role;
grant execute on function public.assign_problem(uuid, uuid, date, time, time) to authenticated, service_role;
grant execute on function public.cancel_problem(uuid, text) to authenticated, service_role;
grant execute on function public.resolve_problem(uuid) to authenticated, service_role;

-- ---------- the default fix process ----------

-- §8.3 of the spec, as the original ships it: photos of the problem, what
-- was done, photos after. The task_note step shows the technician the
-- report's description; it is left out of the snapshot when there is none.
with template as (
  insert into public.workflow_templates (scope, name)
  values ('problem', 'Устранение проблемы')
  returning id, host_id
)
insert into public.workflow_steps (
  template_id, host_id, sort_order, type, required, title, title_i18n, min_photos, max_photos
)
select template.id, template.host_id, step.sort_order, step.type, step.required,
       step.title, step.title_i18n, step.min_photos, step.max_photos
from template,
     (values
       (1, 'photos_before'::public.workflow_step_type, true, 'Фото проблемы',
        '{"en": "Photos of the problem", "cs": "Fotky problému"}'::jsonb, 1, 4),
       (2, 'task_note'::public.workflow_step_type, false, null, '{}'::jsonb, null, null),
       (3, 'cleaner_comment'::public.workflow_step_type, true, 'Что было сделано?',
        '{"en": "What was done?", "cs": "Co bylo uděláno?"}'::jsonb, null, null),
       (4, 'photos_after'::public.workflow_step_type, true, 'Фото после',
        '{"en": "Photos after", "cs": "Fotky po opravě"}'::jsonb, 1, 4)
     ) as step(sort_order, type, required, title, title_i18n, min_photos, max_photos);
