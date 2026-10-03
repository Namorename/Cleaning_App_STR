-- The company's video limits (docs/tech-plan.md, 7.1, 7.2 and 9; owner's
-- decisions 10 and 12 of 2026-10-01).
--
-- A video is recorded by the app's own camera, up to a limit — not a minimum —
-- and the limits come from the company's settings, so moving to Supabase Pro
-- needs no build and no OTA: the manager changes three numbers.
--
-- - hosts gains video_max_sec (120), video_bitrate_kbps (2000) and
--   video_max_mb (45): the free plan, 720p at 2 Mbit/s for two minutes, about
--   32 MB a file under the 50 MB the plan allows. Pro is 180 s, 4500 kbit/s,
--   140 MB (§9). The bounds keep a typo out: 10 s to 10 min, 500 to 20 000
--   kbit/s, 5 to 150 MB — 150 MB is under the 150 MiB the task-media bucket
--   holds, so no setting can promise a file the bucket refuses. Megabytes are
--   of 1 000 000 bytes, as the plan's sums are counted; the phone gives the
--   camera the same number of bytes.
--
-- - Read by everybody in the company, the phone where it reads whether the
--   gallery is allowed (fetchHostSettings): hosts is granted SELECT whole to
--   authenticated, and its policy gives each reader her own company. Written
--   by the manager through update_host_settings, as the other two settings
--   are: three more arguments, null meaning "not part of this call". A new
--   argument cannot be added with create or replace — that makes a second
--   function, and the panel's call by name would find two — so the old one is
--   dropped and the new one created in its place, its grants restated. The
--   panel of today, which sends one switch at a time, reaches the new one and
--   leaves the video alone. A number out of bounds is refused with the key
--   videoSettingOutOfRange and the bounds, before the CHECK would.
--
-- - add_task_media holds a video to the company: never from the gallery
--   (videoCameraOnly), whatever is allowed for photos; no larger than
--   video_max_mb (mediaTooLarge, the key the phone already knows); no longer
--   than the step's own max_video_sec or the company's length, whichever is
--   shorter, with a tolerance of two seconds for the phone's timer
--   (videoTooLong, already known). A step's max_video_sec stays; with none,
--   the company's applies — until now a constant 30 s
--   (task_media_max_video_sec, which nothing on the server reads any more).
--   The bucket's own bound of 150 MiB stays above them all. No new argument:
--   a phone on 1.1.0 sends what it sends today and is held by the new rules.
--   Same signature, so the ACL and the generated types of the RPC stay; the
--   body is that of 20260926101000 but for the three blocks above.
--
-- Adding columns with a constant default touches the catalog only; the checks
-- read hosts once (one row). The ALTER takes ACCESS EXCLUSIVE on hosts for a
-- moment; hence the lock timeout.

set local lock_timeout = '3s';

-- ---------- the three numbers ----------

alter table public.hosts
  add column video_max_sec integer not null default 120,
  add column video_bitrate_kbps integer not null default 2000,
  add column video_max_mb integer not null default 45,
  add constraint hosts_video_max_sec_range check (video_max_sec between 10 and 600),
  add constraint hosts_video_bitrate_kbps_range check (video_bitrate_kbps between 500 and 20000),
  add constraint hosts_video_max_mb_range check (video_max_mb between 5 and 150);

comment on column public.hosts.video_max_sec is
  'The longest video, in seconds: a limit, not a minimum. A step may ask for less '
  '(task_steps.max_video_sec), never for more (20261003170000).';
comment on column public.hosts.video_bitrate_kbps is
  'The bitrate the phone gives the camera for video, in kbit/s (20261003170000).';
comment on column public.hosts.video_max_mb is
  'The largest video file, in megabytes of 1 000 000 bytes: the camera stops '
  'there and add_task_media refuses more (20261003170000).';

-- How far over its limit a video may be and still be the phone's timer.
create or replace function public.task_media_video_tolerance_sec()
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$ select 2::numeric $$;

comment on function public.task_media_video_tolerance_sec() is
  'Seconds a video may run over its limit: the phone measures with its own timer '
  'while the camera stops itself at the limit (20261003170000).';

revoke all on function public.task_media_video_tolerance_sec() from public, anon;
grant execute on function public.task_media_video_tolerance_sec() to authenticated, service_role;

-- ---------- the manager writes them ----------

drop function public.update_host_settings(boolean, boolean);

/**
 * Write the company's switches and its video limits.
 *
 * Every parameter is optional and null means "not part of this call" rather
 * than "set to null" — the columns are `not null`, and a panel sending one
 * switch must not carry an implicit answer about the others. Two managers on
 * two screens can each save the control they touched.
 *
 * Managers only, and only their own company: the row is found through
 * `current_host_id()`, never named by the caller. The video numbers are
 * checked against the bounds of the table's own checks, so a refusal names
 * them (serverErrors.videoSettingOutOfRange).
 */
create function public.update_host_settings(
  p_parallel_start_allowed boolean default null,
  p_gallery_allowed        boolean default null,
  p_video_max_sec          integer default null,
  p_video_bitrate_kbps     integer default null,
  p_video_max_mb           integer default null
)
returns public.hosts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid := public.current_host_id();
  v_row  public.hosts;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may change company settings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  -- The bounds of hosts_video_*_range.
  if p_video_max_sec is not null and p_video_max_sec not between 10 and 600 then
    raise exception 'video_max_sec % is outside 10..600', p_video_max_sec
      using errcode = 'check_violation',
            hint = 'serverErrors.videoSettingOutOfRange',
            detail = jsonb_build_object('field', 'video_max_sec', 'min', 10, 'max', 600)::text;
  end if;
  if p_video_bitrate_kbps is not null and p_video_bitrate_kbps not between 500 and 20000 then
    raise exception 'video_bitrate_kbps % is outside 500..20000', p_video_bitrate_kbps
      using errcode = 'check_violation',
            hint = 'serverErrors.videoSettingOutOfRange',
            detail = jsonb_build_object('field', 'video_bitrate_kbps', 'min', 500, 'max', 20000)::text;
  end if;
  if p_video_max_mb is not null and p_video_max_mb not between 5 and 150 then
    raise exception 'video_max_mb % is outside 5..150', p_video_max_mb
      using errcode = 'check_violation',
            hint = 'serverErrors.videoSettingOutOfRange',
            detail = jsonb_build_object('field', 'video_max_mb', 'min', 5, 'max', 150)::text;
  end if;

  update public.hosts h
  set parallel_start_allowed = coalesce(p_parallel_start_allowed, h.parallel_start_allowed),
      gallery_allowed        = coalesce(p_gallery_allowed, h.gallery_allowed),
      video_max_sec          = coalesce(p_video_max_sec, h.video_max_sec),
      video_bitrate_kbps     = coalesce(p_video_bitrate_kbps, h.video_bitrate_kbps),
      video_max_mb           = coalesce(p_video_max_mb, h.video_max_mb)
  where h.id = v_host
  returning * into v_row;

  if not found then
    raise exception 'Company % is not there', v_host
      using errcode = 'no_data_found', hint = 'serverErrors.hostNotFound';
  end if;

  return v_row;
end;
$$;

revoke all on function public.update_host_settings(boolean, boolean, integer, integer, integer)
  from public, anon;
grant execute on function public.update_host_settings(boolean, boolean, integer, integer, integer)
  to authenticated, service_role;

-- ---------- a video from the field ----------

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

  -- A video is the app's own camera, never the gallery, whatever the company
  -- allows for photos (docs/tech-plan.md 7.1, 20261003170000).
  if p_kind = 'video' and p_source = 'gallery' then
    raise exception 'A video is recorded with the app''s camera, not chosen from the gallery'
      using errcode = 'check_violation', hint = 'serverErrors.videoCameraOnly';
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
