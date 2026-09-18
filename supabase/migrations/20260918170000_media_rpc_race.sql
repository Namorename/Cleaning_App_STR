-- The idempotency race in the phone-keyed media writes of a cleaning.
--
-- add_task_media and add_problem_media are replayable by an id the phone made
-- up: look the row up, hand it back if it is there, insert it otherwise. Two
-- calls with the same id at the same moment both miss the lookup, one insert
-- wins, and the other gets a bare 23505 from the primary key -- no hint, so
-- the apps cannot translate it, and the caller that lost was the honest
-- replay the design promises to serve.
--
-- Fixed in one form: `insert ... on conflict (id) do nothing returning *`,
-- and when nothing comes back, the row is read again under the same host and
-- author checks the lookup at the top applies. open_thread (20260918120000)
-- already does this. The two chat writes with the same shape (send_message,
-- add_message_media) get the same fix in 20260918190000, with the chat
-- schema they belong to: this migration ships on its own and earlier, so
-- that the live path of a cleaning's photos can be watched for a day before
-- the chat follows (owner's decision, 2026-09-18).
--
-- The bodies below are those of 20260917110100; what changes is the insert,
-- the tail after it, and one more lookup right after the row lock -- the
-- point where a concurrent writer's row first becomes visible.

/**
 * The row a replayed media write lost the race to: written by this same
 * caller, under this same host, for this same step or problem -- or a
 * refusal that says nothing more than the lookup at the top of each RPC
 * would have. A row of any other owner (a chat message's, once the chat
 * ships) has neither and is refused the same way.
 *
 * Internal: called from the security definer RPCs only.
 */
create or replace function public.task_media_written_meanwhile(
  p_id         uuid,
  p_step_id    uuid,
  p_problem_id uuid
)
returns public.task_media
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.task_media;
begin
  select m.* into v_media
  from public.task_media m
  where m.id = p_id and m.host_id = public.current_host_id();

  if not found
     or v_media.created_by is distinct from (select auth.uid())
     or v_media.step_id    is distinct from p_step_id
     or v_media.problem_id is distinct from p_problem_id then
    raise exception 'Media not found'
      using errcode = 'check_violation', hint = 'serverErrors.mediaNotFound';
  end if;

  return v_media;
end;
$$;

revoke all on function public.task_media_written_meanwhile(uuid, uuid, uuid)
  from public, anon, authenticated;

-- ---------- add_task_media ----------

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

-- ---------- add_problem_media ----------

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

  -- The lookup above ran before this lock; see add_task_media.
  if exists (select 1 from public.task_media m where m.id = p_id) then
    return public.task_media_written_meanwhile(p_id, null, p_problem_id);
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
  on conflict (id) do nothing
  returning * into v_media;
  if found then
    return v_media;
  end if;

  -- A replay of this very call got its row in between the lookup and the
  -- insert: that row is the answer, under the checks the lookup applies.
  return public.task_media_written_meanwhile(p_id, null, p_problem_id);
end;
$$;
