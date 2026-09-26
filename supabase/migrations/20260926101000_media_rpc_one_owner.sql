-- A replayed media id is answered only for the owner it was registered for.
--
-- Found in review on 2026-09-25. Each of the three registration RPCs first
-- looks the id up and, when the row exists, hands it back as the answer to a
-- replay -- after checking that the replay names the same owner and comes
-- from the same author. The owner check was written two ways, and both let a
-- null through:
--
--   add_task_media     `v_media.step_id <> p_step_id`. A problem's or a
--                      message's photo has no step_id, the comparison is null,
--                      `null or false` is null, and the refusal does not fire:
--                      a call naming a step got back a row that belongs to a
--                      problem or a message. A call with p_step_id = null got
--                      back any row of its author.
--   add_problem_media  `v_media.problem_id is distinct from p_problem_id`.
--   add_message_media  `v_media.message_id is distinct from p_message_id`.
--                      Right when the argument is set; with the argument null
--                      the row of a step (whose problem_id and message_id are
--                      null) "matched", and came back as the answer.
--
-- Nothing crossed a person -- the lookup is scoped to the caller's company and
-- the author check still held, so the row was always her own -- but a phone
-- that sent one id for two owners was told the second registration had
-- succeeded, and its upload would have aimed at the first owner's path.
--
-- One form in all three: the row is the answer only when its owner equals the
-- argument, `(v_media.<owner>_id = p_<owner>_id) is not true` refusing
-- everything else, null included, with the key the phone already knows
-- (serverErrors.mediaNotFound). Signatures, grants and every other line are
-- unchanged; the bodies are those of 20260918170000 and 20260924120000.
-- The re-reads after the lock (task_media_written_meanwhile,
-- chat_media_written_meanwhile) are called only with an owner the RPC has
-- already found, never null, so their `is distinct from` is right as it is.
--
-- Tests: supabase/tests/task_media.sql and chat.sql, "a replayed id names the
-- owner it was registered for".


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
    -- One owner or no answer: a null on either side is not a match.
    if (v_media.problem_id = p_problem_id) is not true
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


-- ---------- add_message_media ----------

create or replace function public.add_message_media(
  p_id              uuid,
  p_message_id      uuid,
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
  v_message   public.chat_messages;
  v_thread    public.chat_threads;
  v_media     public.task_media;
  v_extension text;
  v_count     integer;
begin
  select m.* into v_media
  from public.task_media m
  where m.id = p_id and m.host_id = public.current_host_id();
  if found then
    -- One owner or no answer: a null on either side is not a match.
    if (v_media.message_id = p_message_id) is not true
       or v_media.created_by is distinct from (select auth.uid()) then
      raise exception 'Media not found'
        using errcode = 'check_violation', hint = 'serverErrors.mediaNotFound';
    end if;
    if v_media.uploaded_at is null and v_media.purged_at is not null then
      raise exception 'The photo waited too long for its file and has expired'
        using errcode = 'check_violation', hint = 'serverErrors.messageMediaExpired';
    end if;
    return v_media;
  end if;

  select m.* into v_message
  from public.chat_messages m
  where m.id = p_message_id
    and m.host_id = public.current_host_id()
    and m.author_id = (select auth.uid())
  for update;
  if not found then
    raise exception 'Message not found'
      using errcode = 'check_violation', hint = 'serverErrors.messageNotFound';
  end if;

  -- The lookup above ran before this lock; a call with the same id that was
  -- writing while we waited has committed by now: ask once more, or the
  -- declared count below would be charged for a photo that is our own.
  if exists (select 1 from public.task_media m where m.id = p_id) then
    return public.chat_media_written_meanwhile(p_id, p_message_id);
  end if;

  select th.* into v_thread
  from public.chat_threads th
  where th.id = v_message.thread_id;
  if not public.chat_participates(v_thread.kind, v_thread.task_id,
                                  v_thread.problem_id, v_thread.profile_id) then
    raise exception 'Message not found'
      using errcode = 'check_violation', hint = 'serverErrors.messageNotFound';
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
  where m.message_id = p_message_id and m.deleted_at is null;
  if v_count >= v_message.media_expected then
    raise exception 'The message declared % photos and holds % already',
      v_message.media_expected, v_count
      using errcode = 'check_violation',
            hint = 'serverErrors.messagePhotoLimit',
            detail = jsonb_build_object('limit', v_message.media_expected)::text;
  end if;

  insert into public.task_media (
    id, host_id, message_id, kind, storage_path, mime_type, byte_size,
    width, height, device_taken_at, created_by, source
  ) values (
    p_id, v_message.host_id, p_message_id, 'photo',
    v_message.host_id::text || '/chat/' || v_message.thread_id::text || '/' || p_id::text || '.' || v_extension,
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
  return public.chat_media_written_meanwhile(p_id, p_message_id);
end;
$$;
