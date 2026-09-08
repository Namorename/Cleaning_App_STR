-- F9: photos on a problem report, through the task media pipeline.
--
-- A media row now belongs to exactly one of two owners: a task step, as
-- before, or a problem. Everything downstream — the bucket policy that
-- admits a file only onto the path its row is waiting for, confirmation,
-- signed reads, retention — works from the row and does not care which.
-- The report's photos are evidence in the same sense a step's are, so they
-- live in the same table under the same rules.

alter table public.task_media
  alter column task_id drop not null,
  alter column step_id drop not null,
  add column problem_id uuid references public.problems(id) on delete cascade,
  add constraint task_media_one_owner check (
    (task_id is not null and step_id is not null and problem_id is null)
    or (problem_id is not null and task_id is null and step_id is null)
  );

comment on column public.task_media.problem_id is
  'Set on a photo attached to a problem report; task_id and step_id are null then.';

create index task_media_problem_idx on public.task_media (problem_id)
  where problem_id is not null and deleted_at is null;

create or replace function public.problem_max_photos()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 4 $$;

revoke all on function public.problem_max_photos() from public, anon;
grant execute on function public.problem_max_photos() to authenticated, service_role;

-- Whoever may read the problem reads its photos: the reporter, the
-- technician holding the fix, the managers. The subquery runs under the
-- caller's own row policies on problems, so this policy repeats nothing.
create policy "problem media is read by whoever reads the problem"
  on public.task_media for select to authenticated
  using (problem_id is not null
         and host_id = public.current_host_id()
         and public.is_active_user()
         and exists (select 1 from public.problems p where p.id = task_media.problem_id));

-- ---------- registering a photo on a report ----------

/**
 * Register a photo of a problem and learn where it has to go. Replayable.
 *
 * Only the reporter, only while the problem is open, only photos, at most
 * problem_max_photos() of them. Path: host/problems/problem/id.ext.
 */
create or replace function public.add_problem_media(
  p_id              uuid,
  p_problem_id      uuid,
  p_mime_type       text,
  p_byte_size       integer,
  p_width           integer default null,
  p_height          integer default null,
  p_device_taken_at timestamptz default null
)
returns public.task_media
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem   public.problems;
  v_media     public.task_media;
  v_extension text;
  v_count     integer;
begin
  select m.* into v_media
  from public.task_media m
  where m.id = p_id and m.host_id = public.current_host_id();
  if found then
    if v_media.problem_id is distinct from p_problem_id
       or v_media.created_by is distinct from (select auth.uid()) then
      raise exception 'Media not found'
        using errcode = 'check_violation', hint = 'serverErrors.mediaNotFound';
    end if;
    return v_media;
  end if;

  select p.* into v_problem
  from public.problems p
  where p.id = p_problem_id
    and p.host_id = public.current_host_id()
    and p.reported_by = (select auth.uid())
  for update;
  if not found then
    raise exception 'Problem not found'
      using errcode = 'check_violation', hint = 'serverErrors.problemNotFound';
  end if;
  if v_problem.status <> 'open' then
    raise exception 'Problem is % and its photos can no longer change', v_problem.status
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;

  v_extension := public.task_media_extension(p_mime_type);
  if v_extension is null or lower(p_mime_type) not like 'image/%' then
    raise exception 'Media type % is not accepted for a photo', p_mime_type
      using errcode = 'check_violation', hint = 'serverErrors.mediaTypeInvalid';
  end if;
  if p_byte_size is null or p_byte_size <= 0 then
    raise exception 'Media size is missing'
      using errcode = 'check_violation', hint = 'serverErrors.mediaTypeInvalid';
  end if;
  if p_byte_size > public.task_media_max_bytes('photo') then
    raise exception 'The file is larger than % bytes', public.task_media_max_bytes('photo')
      using errcode = 'check_violation',
            hint = 'serverErrors.mediaTooLarge',
            detail = jsonb_build_object(
              'limit_mb', public.task_media_max_bytes('photo') / (1024 * 1024))::text;
  end if;

  select count(*)::integer into v_count
  from public.task_media m
  where m.problem_id = p_problem_id and m.deleted_at is null;
  if v_count >= public.problem_max_photos() then
    raise exception 'The problem already holds % of at most % photos', v_count, public.problem_max_photos()
      using errcode = 'check_violation',
            hint = 'serverErrors.mediaLimitReached',
            detail = jsonb_build_object('limit', public.problem_max_photos())::text;
  end if;

  insert into public.task_media (
    id, host_id, problem_id, kind, storage_path, mime_type, byte_size,
    width, height, device_taken_at, created_by
  ) values (
    p_id, v_problem.host_id, p_problem_id, 'photo',
    v_problem.host_id::text || '/problems/' || p_problem_id::text || '/' || p_id::text || '.' || v_extension,
    lower(p_mime_type), p_byte_size, p_width, p_height, p_device_taken_at, (select auth.uid())
  )
  returning * into v_media;

  return v_media;
end;
$$;

revoke all on function public.add_problem_media(uuid, uuid, text, integer, integer, integer, timestamptz)
  from public, anon;
grant execute on function public.add_problem_media(uuid, uuid, text, integer, integer, integer, timestamptz)
  to authenticated, service_role;

-- ---------- taking a photo back: now for either owner ----------

/**
 * Changed from 20260907160100: a photo on a problem is taken back while
 * the problem is open; a photo on a step while the step is open, as before.
 */
create or replace function public.remove_task_media(p_id uuid)
returns public.task_media
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media   public.task_media;
  v_step    public.task_steps;
  v_status  public.problem_status;
begin
  select m.* into v_media
  from public.task_media m
  where m.id = p_id
    and m.host_id = public.current_host_id()
    and m.created_by = (select auth.uid())
  for update;

  if not found then
    raise exception 'Media not found'
      using errcode = 'check_violation', hint = 'serverErrors.mediaNotFound';
  end if;

  if v_media.deleted_at is not null then
    return v_media;
  end if;

  if v_media.problem_id is not null then
    select p.status into v_status from public.problems p where p.id = v_media.problem_id for update;
    if v_status <> 'open' then
      raise exception 'Problem is % and its photos can no longer change', v_status
        using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
    end if;
  else
    v_step := public.task_step_for_update(v_media.step_id, true);
    if v_step.completed_at is not null then
      raise exception 'The step is completed; reopen it to change its media'
        using errcode = 'check_violation', hint = 'serverErrors.stepCompleted';
    end if;
  end if;

  update public.task_media m
  set deleted_at = now()
  where m.id = p_id
  returning m.* into v_media;

  return v_media;
end;
$$;

-- ---------- retention: a closed problem ages like a closed task ----------

/**
 * Changed from 20260907160200: photos of a problem resolved or cancelled
 * longer ago than the retention period are due, on the same clock as the
 * files of a closed task.
 */
create or replace function public.task_media_to_purge(p_limit integer default 200)
returns setof public.task_media
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
  from public.task_media m
  left join public.tasks t on t.id = m.task_id
  left join public.problems p on p.id = m.problem_id
  where m.purged_at is null
    and (m.deleted_at is not null
         or (t.status in ('done', 'cancelled', 'expired')
             and coalesce(t.completed_at, t.updated_at)
                 < now() - make_interval(days => public.task_media_retention_days()))
         or (p.status in ('resolved', 'cancelled')
             and coalesce(p.resolved_at, p.cancelled_at, p.updated_at)
                 < now() - make_interval(days => public.task_media_retention_days())))
  order by m.created_at, m.id
  limit greatest(coalesce(p_limit, 200), 1)
$$;
