-- A file that measured zero bytes gets its own words.
--
-- Both writers refused such a row with the hint `serverErrors.mediaTypeInvalid`
-- — the key that means "this kind of file is not accepted". A cleaner whose
-- photo had gone missing between being saved and being measured was therefore
-- told her camera produces a format nobody takes, which is not true and gives
-- her nothing to do about it. The refusal is the same; only the key it carries
-- changes, so the app can say what actually went wrong.
--
-- The bodies below are the previous ones, unchanged apart from that one line.

create or replace function public.add_task_media(
  p_id              uuid,
  p_step_id         uuid,
  p_kind            public.media_kind,
  p_mime_type       text,
  p_byte_size       integer,
  p_width           integer default null,
  p_height          integer default null,
  p_duration_sec    numeric default null,
  p_device_taken_at timestamptz default null
)
returns public.task_media
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step      public.task_steps;
  v_media     public.task_media;
  v_extension text;
  v_count     integer;
  v_limit     integer;
begin
  select m.* into v_media
  from public.task_media m
  where m.id = p_id and m.host_id = public.current_host_id();
  if found then
    if v_media.step_id <> p_step_id or v_media.created_by is distinct from (select auth.uid()) then
      raise exception 'Media not found'
        using errcode = 'check_violation', hint = 'serverErrors.mediaNotFound';
    end if;
    return v_media;
  end if;

  v_step := public.task_step_for_update(p_step_id, true);

  if v_step.completed_at is not null then
    raise exception 'The step is completed; reopen it to change its media'
      using errcode = 'check_violation', hint = 'serverErrors.stepCompleted';
  end if;

  if not ((p_kind = 'photo' and v_step.type in ('photos_before', 'photos_after'))
          or (p_kind = 'video' and v_step.type = 'video')) then
    raise exception 'A % does not belong on a % step', p_kind, v_step.type
      using errcode = 'check_violation', hint = 'serverErrors.mediaKindMismatch';
  end if;

  v_extension := public.task_media_extension(p_mime_type);
  if v_extension is null
     or (p_kind = 'photo' and lower(p_mime_type) not like 'image/%')
     or (p_kind = 'video' and lower(p_mime_type) not like 'video/%') then
    raise exception 'Media type % is not accepted for a %', p_mime_type, p_kind
      using errcode = 'check_violation', hint = 'serverErrors.mediaTypeInvalid';
  end if;

  if p_byte_size is null or p_byte_size <= 0 then
    raise exception 'Media size is missing'
      using errcode = 'check_violation', hint = 'serverErrors.mediaSizeMissing';
  end if;
  if p_byte_size > public.task_media_max_bytes(p_kind) then
    raise exception 'The file is larger than % bytes', public.task_media_max_bytes(p_kind)
      using errcode = 'check_violation',
            hint = 'serverErrors.mediaTooLarge',
            detail = jsonb_build_object(
              'limit_mb', public.task_media_max_bytes(p_kind) / (1024 * 1024))::text;
  end if;

  if p_kind = 'video' then
    if p_duration_sec is null or p_duration_sec <= 0 then
      raise exception 'Video duration is missing'
        using errcode = 'check_violation', hint = 'serverErrors.videoDurationMissing';
    end if;
    v_limit := coalesce(v_step.max_video_sec, public.task_media_max_video_sec());
    if p_duration_sec > v_limit then
      raise exception 'The video is longer than % seconds', v_limit
        using errcode = 'check_violation',
              hint = 'serverErrors.videoTooLong',
              detail = jsonb_build_object('limit', v_limit)::text;
    end if;
  end if;

  select count(*)::integer into v_count
  from public.task_media m
  where m.step_id = p_step_id and m.deleted_at is null;
  v_limit := case p_kind
    when 'video' then 1
    else coalesce(v_step.max_photos, public.task_media_max_photos())
  end;
  if v_count >= v_limit then
    raise exception 'The step already holds % of at most % files', v_count, v_limit
      using errcode = 'check_violation',
            hint = 'serverErrors.mediaLimitReached',
            detail = jsonb_build_object('limit', v_limit)::text;
  end if;

  insert into public.task_media (
    id, host_id, task_id, step_id, kind, storage_path, mime_type, byte_size,
    width, height, duration_sec, device_taken_at, created_by
  ) values (
    p_id, v_step.host_id, v_step.task_id, p_step_id, p_kind,
    v_step.host_id::text || '/' || v_step.task_id::text || '/' || p_id::text || '.' || v_extension,
    lower(p_mime_type), p_byte_size, p_width, p_height,
    case when p_kind = 'video' then p_duration_sec end,
    p_device_taken_at, (select auth.uid())
  )
  returning * into v_media;

  return v_media;
end;
$$;

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
      using errcode = 'check_violation', hint = 'serverErrors.mediaSizeMissing';
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
