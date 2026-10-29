-- DRAFT — a video is held to the company's numbers of now (docs/video-limits-1023.md).
-- NOT FOR db push until the owner's word: the guard below raises first, so db push and a
-- local reset stop on it. At rollout the guard goes, the stamp is checked against the cloud
-- head (docs/rollout/remote_head.sql) and the dry run names this one file.
--
-- On 22.10 the company went to 180 s / 140 MB while 25 started cleanings kept the 90 or
-- 120 s their video step had copied from the process when they started
-- (snapshot_task_steps). add_task_media took least(step copy, company), and so did the
-- phone: a gallery video of 150 s was refused although the company allowed it. The size and
-- the bitrate were always read live; only the length had a copy.
--
-- From here the company's three numbers, as they are at the moment of the call, are the
-- only video limits of an unfinished cleaning:
--   - add_task_media: the length is hosts.video_max_sec, with the phone's tolerance as
--     before. A finished step is still refused (stepCompleted), so nothing done changes.
--   - snapshot_task_steps: a cleaning that starts writes null into task_steps.max_video_sec.
--     The builds in the field read that column and take min(copy ?? company, company): with
--     null they take the company's number too, so old and new phones agree with the server.
-- The column stays (the phones select it; dropping it would answer 42703) and the rows of
-- cleanings already started keep their copies; emptying those is a one-off write
-- (docs/one-off-writes/video-limits-1023-unstick.sql), not this migration.
-- workflow_steps.max_video_sec (the panel's video length box of a process step) is still
-- saved by the panel but enforced nowhere after this; hiding the box is the panel's change.
--
-- The builds in the field are all 1.2.0 (push tokens of 23.10), and every 1.2.0 build already
-- takes min(copy ?? company, company); the builds before 615af8e took copy ?? 30 and are
-- gone from the field.
--
-- Same signatures, so the ACLs and the generated types stay. The bodies are those of
-- 20261010100000 (add_task_media) and 20260907130000 (snapshot_task_steps) but for the
-- marked statements. Order of the rollout: this migration, then the phone over the air —
-- the phone that drops the copy must not reach a server that still applies it.
-- Rollback: docs/one-off-writes/video-limits-1023-migration-rollback.sql. Its tests are in
-- supabase/tests/draft (run there with the draft applied); at rollout they move up.

-- >>> draft guard: remove at rollout
do $$
begin
  raise exception 'Draft migration 20261023100000_video_limits_live is not for db push'
    using hint = 'docs/video-limits-1023.md: the owner''s word first, then the guard goes';
end;
$$;
-- <<< draft guard

set local lock_timeout = '3s';

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
    -- The company's limits as they are now (20261023100000): what its plan
    -- stores, and what the phone gives the camera. The step's max_video_sec
    -- is the copy it took of the process when the cleaning started and
    -- limits nothing: on 22.10 such copies held started cleanings to 90 and
    -- 120 s under the company's 180.
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
    v_limit := v_video_sec;
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

-- ---------- the copy at the start ----------

/**
 * Copy the applicable template into the task the moment it goes into progress.
 *
 * As in 20260907130000, but the video length is not copied: a video is held to
 * the company's numbers at the moment it is registered (add_task_media).
 */
create or replace function public.snapshot_task_steps()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_template  uuid;
  v_checklist jsonb;
  v_has_list  boolean := false;
begin
  if new.status <> 'in_progress' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = new.status then
    return null;
  end if;
  if exists (select 1 from public.task_steps s where s.task_id = new.id) then
    return null;
  end if;

  v_template := public.resolve_workflow_template(
    new.property_id, public.workflow_scope_for(new.type));
  if v_template is null then
    return null;
  end if;

  -- Only worth asking when the process actually has such a step.
  if exists (select 1 from public.workflow_steps s
             where s.template_id = v_template and s.type = 'checklist') then
    v_checklist := public.property_checklist_snapshot(new.property_id);
    v_has_list  := jsonb_array_length(coalesce(v_checklist->'modules', '[]'::jsonb)) > 0;
  end if;

  insert into public.task_steps (
    task_id, host_id, template_step_id, sort_order, type, required, title,
    title_i18n, instructions, instructions_i18n, min_photos, max_photos,
    max_video_sec, config
  )
  select
    new.id, new.host_id, s.id, s.sort_order, s.type, s.required, s.title,
    s.title_i18n,
    case when s.type = 'task_note' then new.notes else s.instructions end,
    case when s.type = 'task_note' then '{}'::jsonb else s.instructions_i18n end,
    s.min_photos, s.max_photos,
    -- No copy of the video length (20261023100000): a video is held to the
    -- company's number of the moment. A build that still reads the column
    -- takes the company's number for a null, as the server does.
    null,
    case when s.type = 'checklist' then v_checklist else s.config end
  from public.workflow_steps s
  where s.template_id = v_template
    and not (s.type = 'task_note' and nullif(btrim(coalesce(new.notes, '')), '') is null)
    and not (s.type = 'checklist' and not v_has_list)
  order by s.sort_order;

  return null;
end;
$$;

comment on column public.task_steps.max_video_sec is
  'Not a limit (20261023100000): the video length is hosts.video_max_sec at the moment '
  'of add_task_media. Null on steps started since; older steps keep the copy they took.';
comment on column public.workflow_steps.max_video_sec is
  'Saved by the panel, enforced nowhere since 20261023100000: a video is held to '
  'hosts.video_max_sec.';
