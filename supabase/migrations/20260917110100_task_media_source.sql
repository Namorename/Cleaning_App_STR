-- What the app said about where a file came from.
--
-- The column is `not null default 'unknown'`, and the default is the whole
-- point: rows written before it existed said nothing, and nothing must stay
-- nothing. Filling them in with 'camera' would have been three rows of
-- convenience bought with exactly the lie this column exists to prevent — the
-- gallery switch has no history, so "it was never on" cannot be shown, only
-- assumed.
--
-- The writers take the source as their LAST argument, defaulting to null. Not
-- to 'camera': PostgREST resolves a call by argument names, so a build that
-- has not been updated lands in this same function having said nothing, and a
-- flattering default would turn its silence into a claim.
--
-- Nobody can change `source` after the fact: `authenticated` holds only SELECT
-- on task_media, and no RPC updates it. The idempotent branch is untouched on
-- purpose — a repeat call with the same id returns the row as it stands, so a
-- second call cannot rewrite 'gallery' into 'camera'.

alter table public.task_media
  add column source public.media_source not null default 'unknown';

comment on column public.task_media.source is
  'What the app said about where the file came from. A declaration, not a proof: the server cannot see the camera. ''unknown'' means the app did not say — an older build.';

-- A new argument makes a NEW function, not a replacement: `create or replace`
-- matches on the argument list, so without these two lines the nine-argument
-- version stays behind and every positional call becomes ambiguous — which is
-- exactly how this landed the first time it was written.
drop function if exists public.add_task_media(
  uuid, uuid, public.media_kind, text, integer, integer, integer, numeric, timestamptz);
drop function if exists public.add_problem_media(
  uuid, uuid, text, integer, integer, integer, timestamptz);

create or replace function public.add_task_media(
  p_id              uuid,
  p_step_id         uuid,
  p_kind            public.media_kind,
  p_mime_type       text,
  p_byte_size       integer,
  p_width           integer default null,
  p_height          integer default null,
  p_duration_sec    numeric default null,
  p_device_taken_at timestamptz default null,
  p_source          public.media_source default null
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

  -- The gallery switch, enforced where it can actually hold. Until now it only
  -- hid a button, which stops nobody who has an older build in her hand.
  if p_source = 'gallery'
     and not coalesce((select h.gallery_allowed from public.hosts h
                       where h.id = v_step.host_id), false) then
    raise exception 'The gallery is not allowed for this company'
      using errcode = 'check_violation', hint = 'serverErrors.galleryNotAllowed';
  end if;

  -- A company that has opened the gallery cannot accept an undeclared file:
  -- a build that says nothing is then the one way in that does not even have
  -- to lie. Turning the switch on therefore waits until the field has the
  -- build that speaks — which is what the README says to do.
  if p_source is null
     and coalesce((select h.gallery_allowed from public.hosts h
                   where h.id = v_step.host_id), false) then
    raise exception 'Media source is missing'
      using errcode = 'check_violation', hint = 'serverErrors.mediaSourceMissing';
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
    width, height, duration_sec, device_taken_at, created_by, source
  ) values (
    p_id, v_step.host_id, v_step.task_id, p_step_id, p_kind,
    v_step.host_id::text || '/' || v_step.task_id::text || '/' || p_id::text || '.' || v_extension,
    lower(p_mime_type), p_byte_size, p_width, p_height,
    case when p_kind = 'video' then p_duration_sec end,
    p_device_taken_at, (select auth.uid()), coalesce(p_source, 'unknown')
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
  p_device_taken_at timestamptz default null,
  p_source          public.media_source default null
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

  -- The gallery switch, enforced where it can actually hold. Until now it only
  -- hid a button, which stops nobody who has an older build in her hand.
  if p_source = 'gallery'
     and not coalesce((select h.gallery_allowed from public.hosts h
                       where h.id = v_problem.host_id), false) then
    raise exception 'The gallery is not allowed for this company'
      using errcode = 'check_violation', hint = 'serverErrors.galleryNotAllowed';
  end if;

  -- A company that has opened the gallery cannot accept an undeclared file:
  -- a build that says nothing is then the one way in that does not even have
  -- to lie. Turning the switch on therefore waits until the field has the
  -- build that speaks — which is what the README says to do.
  if p_source is null
     and coalesce((select h.gallery_allowed from public.hosts h
                   where h.id = v_problem.host_id), false) then
    raise exception 'Media source is missing'
      using errcode = 'check_violation', hint = 'serverErrors.mediaSourceMissing';
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
    width, height, device_taken_at, created_by, source
  ) values (
    p_id, v_problem.host_id, p_problem_id, 'photo',
    v_problem.host_id::text || '/problems/' || p_problem_id::text || '/' || p_id::text || '.' || v_extension,
    lower(p_mime_type), p_byte_size, p_width, p_height, p_device_taken_at,
    (select auth.uid()), coalesce(p_source, 'unknown')
  )
  returning * into v_media;

  return v_media;
end;
$$;


revoke all on function public.add_task_media(
  uuid, uuid, public.media_kind, text, integer, integer, integer, numeric, timestamptz,
  public.media_source) from public, anon;
grant execute on function public.add_task_media(
  uuid, uuid, public.media_kind, text, integer, integer, integer, numeric, timestamptz,
  public.media_source) to authenticated, service_role;

revoke all on function public.add_problem_media(
  uuid, uuid, text, integer, integer, integer, timestamptz, public.media_source)
  from public, anon;
grant execute on function public.add_problem_media(
  uuid, uuid, text, integer, integer, integer, timestamptz, public.media_source)
  to authenticated, service_role;
