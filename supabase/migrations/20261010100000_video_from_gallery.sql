-- A video from the gallery where the company allows the gallery (prepared the
-- night of 2026-10-10, block 6; the owner said yes in his plan of 2026-10-10,
-- block 4). Probe before and after the push: docs/rollout/gallery_video_probe.sql.
--
-- Until now add_task_media refused every video whose source was the gallery
-- (videoCameraOnly, 20261003170000), whatever hosts.gallery_allowed said, though
-- the panel's switch has always spoken of photos and videos. From here a
-- gallery video is held to exactly the rules a camera one is: the company's
-- switch (galleryNotAllowed), its size (mediaTooLarge against video_max_mb), its
-- length against the step and the company with the phone's tolerance
-- (videoTooLong), one video per step. The one rule that goes is "never from the
-- gallery". The length a gallery video declares is the one its file says (the
-- picker's metadata), checked by the phone before it registers the file.
--
-- No new argument and the same signature: the ACL and the generated types of the
-- RPC stay. The body is that of 20261003170000 but for the removed block and one
-- comment. A phone on 1.1.0 or 1.2.0 never sends a gallery video, so nothing it
-- sends changes meaning; the key videoCameraOnly stays in the locales for a
-- server that still refuses.

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
  v_video_sec integer;
  v_video_mb  integer;
begin
  select m.* into v_media
  from public.task_media m
  where m.id = p_id and m.host_id = public.current_host_id();
  if found then
    -- One owner or no answer: a null on either side is not a match.
    if (v_media.step_id = p_step_id) is not true
       or v_media.created_by is distinct from (select auth.uid()) then
      raise exception 'Media not found'
        using errcode = 'check_violation', hint = 'serverErrors.mediaNotFound';
    end if;
    return v_media;
  end if;

  v_step := public.task_step_for_update(p_step_id, true);

  -- The lookup above ran before this lock. A call with the same id that was
  -- writing while we waited has committed by now and its row is visible only
  -- from here on: ask once more, or the limit below would be charged for a
  -- file that is our own (preflight 2026-09-19, seen on a video step).
  if exists (select 1 from public.task_media m where m.id = p_id) then
    return public.task_media_written_meanwhile(p_id, p_step_id, null);
  end if;

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

  -- The gallery switch, enforced where it can actually hold: for photos and,
  -- since 20261010100000, for videos alike. Until now it only hid a button,
  -- which stops nobody who has an older build in her hand.
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
    -- The company's limits (20261003170000): what its plan stores, and what
    -- the phone gives the camera. A step may ask for less, never for more.
    select h.video_max_sec, h.video_max_mb into v_video_sec, v_video_mb
    from public.hosts h
    where h.id = v_step.host_id;

    -- Megabytes of 1 000 000 bytes, as the plan's sums are counted.
    if p_byte_size > v_video_mb * 1000000 then
      raise exception 'The video is larger than % MB', v_video_mb
        using errcode = 'check_violation',
              hint = 'serverErrors.mediaTooLarge',
              detail = jsonb_build_object('limit_mb', v_video_mb)::text;
    end if;

    if p_duration_sec is null or p_duration_sec <= 0 then
      raise exception 'Video duration is missing'
        using errcode = 'check_violation', hint = 'serverErrors.videoDurationMissing';
    end if;
    -- The phone measures the length with its own timer while the camera stops
    -- itself at the limit: a second over is the timer, not a longer video.
    v_limit := least(coalesce(v_step.max_video_sec, v_video_sec), v_video_sec);
    if p_duration_sec > v_limit + public.task_media_video_tolerance_sec() then
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
  on conflict (id) do nothing
  returning * into v_media;
  if found then
    return v_media;
  end if;

  -- A replay of this very call got its row in between the lookup and the
  -- insert: that row is the answer, under the checks the lookup applies.
  return public.task_media_written_meanwhile(p_id, p_step_id, null);
end;
$$;
