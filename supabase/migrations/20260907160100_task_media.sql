-- F8. Photos and videos of a cleaning: the rows, the bucket, and the steps
-- that ask for them.
--
-- A photo is two things — a file in Storage and a row that says whose it is,
-- which step it answers and whether it has actually arrived. The row comes
-- first: `add_task_media` creates it with the path the file has to land on,
-- the phone uploads to exactly that path (the bucket policy checks the row),
-- and `confirm_task_media` marks the row uploaded once the object exists.
-- Three idempotent calls, so a phone that lost signal halfway can replay the
-- whole chain on the next launch without inventing a duplicate.
--
-- The step is completed the same way as any other, through
-- `complete_task_step`; for a media step the answer is not what the phone
-- sends but what the table holds — the ids of the uploaded, not removed media
-- of that step, in the order they were taken. The validator then applies the
-- step's limits to that list: photos between min_photos and max_photos, one
-- video no longer than max_video_sec. A step with a file still on its way is
-- refused rather than completed short, because a report with a photo missing
-- reads as a photo never taken.
--
-- Media never live in task_steps.payload (the comment there promised this):
-- the file has a life of its own — retention purges it after 90 days, see
-- 20260907160200 — while the step's record of "three photos were taken" is
-- kept.
--
-- Limits the manager did not set fall back to constants below: at least one
-- photo, at most ten, one video of at most thirty seconds (ROADMAP: 720p /
-- 30 s). A step that asks for nothing is not a step.

-- ---------- constants ----------

create or replace function public.task_media_max_photos()
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$ select 10 $$;

create or replace function public.task_media_max_video_sec()
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$ select 30 $$;

/** Upper bound on one file, by kind. The bucket enforces the larger of the two. */
create or replace function public.task_media_max_bytes(p_kind public.media_kind)
returns integer
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_kind when 'photo' then 20 * 1024 * 1024 else 150 * 1024 * 1024 end
$$;

/**
 * The file extension for a MIME type this bucket accepts, or null.
 *
 * The list is the bucket's `allowed_mime_types` in code form; keep the two
 * together. JPEG and WebP are what the phone produces after compression, MP4
 * and QuickTime are what its camera records.
 */
create or replace function public.task_media_extension(p_mime_type text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case lower(p_mime_type)
    when 'image/jpeg'      then 'jpg'
    when 'image/webp'      then 'webp'
    when 'video/mp4'       then 'mp4'
    when 'video/quicktime' then 'mov'
  end
$$;

revoke all on function public.task_media_max_photos() from public, anon;
revoke all on function public.task_media_max_video_sec() from public, anon;
revoke all on function public.task_media_max_bytes(public.media_kind) from public, anon;
revoke all on function public.task_media_extension(text) from public, anon;
grant execute on function public.task_media_max_photos() to authenticated, service_role;
grant execute on function public.task_media_max_video_sec() to authenticated, service_role;
grant execute on function public.task_media_max_bytes(public.media_kind) to authenticated, service_role;
grant execute on function public.task_media_extension(text) to authenticated, service_role;

-- ---------- the table ----------

create table public.task_media (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid not null references public.hosts(id) on delete restrict,
  task_id         uuid not null references public.tasks(id) on delete cascade,
  step_id         uuid not null references public.task_steps(id) on delete cascade,
  kind            public.media_kind not null,
  -- Where the file is in the task-media bucket: host/task/id.ext. Fixed at
  -- creation so the upload policy can check it against this row.
  storage_path    text not null unique,
  mime_type       text not null,
  byte_size       integer not null check (byte_size > 0),
  width           smallint check (width is null or width > 0),
  height          smallint check (height is null or height > 0),
  duration_sec    numeric(6, 1) check (duration_sec is null or duration_sec > 0),
  -- The phone's clock when it was taken; ordering within a step follows it.
  device_taken_at timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null,
  -- Stamped once the object is confirmed to exist in the bucket.
  uploaded_at     timestamptz,
  -- The cleaner took it back before completing the step. The file, if any,
  -- is purged with the rest.
  deleted_at      timestamptz,
  -- Retention removed the file; the row stays as the record that it existed.
  purged_at       timestamptz,
  check (kind = 'video' or duration_sec is null),
  check (kind = 'photo' or duration_sec is not null),
  check (public.task_media_extension(mime_type) is not null)
);

comment on table public.task_media is
  'A photo or video answering a task step. The row is created before the upload and confirmed after it; written only through the task media functions.';
comment on column public.task_media.storage_path is
  'Object key in the task-media bucket: <host_id>/<task_id>/<id>.<ext>. The upload policy admits exactly this path.';
comment on column public.task_media.uploaded_at is
  'Set by confirm_task_media once the object exists. Null means the file is still on its way — or never arrived.';
comment on column public.task_media.purged_at is
  'Retention deleted the file. The row is kept so the step still says what was taken.';

create index task_media_step_idx on public.task_media (step_id)
  where deleted_at is null;
create index task_media_task_idx on public.task_media (host_id, task_id);
-- What retention walks: files not yet removed.
create index task_media_purge_idx on public.task_media (task_id)
  where purged_at is null;

-- ---------- access ----------

-- Read by the people who may read the step; written only through the
-- functions below. Stated as revoke + grant, the form 20260907150000 settled
-- on, and listed in the table_grants suite.
revoke all on public.task_media from anon, authenticated;
grant select on public.task_media to authenticated;

alter table public.task_media enable row level security;

create policy "assignee reads media of own tasks"
  on public.task_media for select
  to authenticated
  using (host_id = public.current_host_id()
         and public.is_active_user()
         and exists (select 1 from public.tasks t
                     where t.id = task_id and t.assignee_id = (select auth.uid())));

create policy "managers read all task media"
  on public.task_media for select
  to authenticated
  using (public.is_manager() and host_id = public.current_host_id());

-- ---------- the bucket ----------

-- Private: every read goes through a signed URL or the policy below. The
-- size limit is the video bound; photos are bounded tighter by add_task_media.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-media', 'task-media', false, 150 * 1024 * 1024,
        array['image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime'])
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/**
 * May the caller put a file at this path?
 *
 * Only onto a row she created herself that is still waiting for its file.
 * Definer, because the policy has to see the row whoever is asking — and the
 * row's own policies say nothing about writes.
 */
create or replace function public.can_upload_task_media(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.task_media m
    where m.storage_path = p_path
      and m.created_by = (select auth.uid())
      and m.uploaded_at is null
      and m.deleted_at is null
      and m.purged_at is null
  )
$$;

/**
 * May the caller read the file at this path?
 *
 * Whoever may read the row may read the file: the question is put to
 * task_media under the caller's own policies (invoker, not definer).
 */
create or replace function public.can_read_task_media(p_path text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.task_media m where m.storage_path = p_path)
$$;

revoke all on function public.can_upload_task_media(text) from public, anon;
revoke all on function public.can_read_task_media(text) from public, anon;
grant execute on function public.can_upload_task_media(text) to authenticated, service_role;
grant execute on function public.can_read_task_media(text) to authenticated, service_role;

create policy "cleaner uploads the file her row is waiting for"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'task-media' and public.can_upload_task_media(name));

create policy "task media is read by whoever reads its row"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'task-media' and public.can_read_task_media(name));

-- No update or delete for clients: a file, once confirmed, is evidence. The
-- purge job removes files as service_role.

-- ---------- writing media ----------

/**
 * Register a photo or video about to be uploaded and get its path.
 *
 * The id comes from the phone so the call can be replayed: a second call with
 * the same id returns the same row. The step is locked for the duration
 * (task_step_for_update), which is what makes the count against max_photos
 * safe when two uploads race.
 */
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
      using errcode = 'check_violation', hint = 'serverErrors.mediaTypeInvalid';
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

/**
 * Mark a file as arrived.
 *
 * Checks the object really is in the bucket rather than trusting the phone:
 * an upload that failed after the request was sent would otherwise count as
 * evidence. Idempotent — a confirmed row is returned as it is.
 */
create or replace function public.confirm_task_media(p_id uuid)
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
  where m.id = p_id
    and m.host_id = public.current_host_id()
    and m.created_by = (select auth.uid())
  for update;

  if not found then
    raise exception 'Media not found'
      using errcode = 'check_violation', hint = 'serverErrors.mediaNotFound';
  end if;

  if v_media.uploaded_at is not null or v_media.deleted_at is not null then
    return v_media;
  end if;

  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'task-media' and o.name = v_media.storage_path) then
    raise exception 'The file has not arrived in storage'
      using errcode = 'check_violation', hint = 'serverErrors.mediaNotUploaded';
  end if;

  update public.task_media m
  set uploaded_at = now()
  where m.id = p_id
  returning m.* into v_media;

  return v_media;
end;
$$;

/**
 * Take a photo or video back, while the step is still open.
 *
 * Soft: the row is marked and the file left to the purge job. A completed
 * step keeps its media until it is reopened — the answer and the evidence
 * change together or not at all.
 */
create or replace function public.remove_task_media(p_id uuid)
returns public.task_media
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media public.task_media;
  v_step  public.task_steps;
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

  v_step := public.task_step_for_update(v_media.step_id, true);

  if v_step.completed_at is not null then
    raise exception 'The step is completed; reopen it to change its media'
      using errcode = 'check_violation', hint = 'serverErrors.stepCompleted';
  end if;

  update public.task_media m
  set deleted_at = now()
  where m.id = p_id
  returning m.* into v_media;

  return v_media;
end;
$$;

revoke all on function public.add_task_media(uuid, uuid, public.media_kind, text, integer, integer, integer, numeric, timestamptz)
  from public, anon;
revoke all on function public.confirm_task_media(uuid) from public, anon;
revoke all on function public.remove_task_media(uuid) from public, anon;
grant execute on function public.add_task_media(uuid, uuid, public.media_kind, text, integer, integer, integer, numeric, timestamptz)
  to authenticated, service_role;
grant execute on function public.confirm_task_media(uuid) to authenticated, service_role;
grant execute on function public.remove_task_media(uuid) to authenticated, service_role;

-- ---------- the steps come alive ----------

create or replace function public.workflow_supported_step_types()
returns public.workflow_step_type[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array['task_note', 'cleaner_comment', 'confirmation', 'checklist',
               'photos_before', 'photos_after', 'video']::public.workflow_step_type[]
$$;

/**
 * Check an answer against its step type and return it normalised.
 *
 * As 20260907120100, plus the media steps. For those the payload is built by
 * complete_task_step from the table (`media_ids`, uploaded and not removed)
 * and the step's limits arrive in the config, so this function stays a pure
 * check of shape against limits.
 */
create or replace function public.validate_task_step_payload(
  p_type         public.workflow_step_type,
  p_instructions text,
  p_config       jsonb,
  p_payload      jsonb
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text    text;
  v_lines   integer;
  v_checked integer[];
  v_wanted  integer[];
  v_known   text[];
  v_needed  text[];
  v_ticked  text[];
  v_count   integer;
  v_min     integer;
  v_max     integer;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Step payload must be an object'
      using errcode = 'check_violation', hint = 'serverErrors.stepPayloadInvalid';
  end if;

  case p_type
    when 'confirmation' then
      return '{}'::jsonb;

    when 'cleaner_comment' then
      v_text := btrim(coalesce(p_payload->>'text', ''));
      if v_text = '' then
        raise exception 'The comment is empty'
          using errcode = 'check_violation', hint = 'serverErrors.commentEmpty';
      end if;
      if length(v_text) > 4000 then
        raise exception 'The comment is longer than 4000 characters'
          using errcode = 'check_violation',
                hint = 'serverErrors.commentTooLong',
                detail = jsonb_build_object('limit', 4000)::text;
      end if;
      return jsonb_build_object('text', v_text);

    when 'task_note' then
      v_lines := public.task_note_line_count(p_instructions);
      if jsonb_typeof(p_payload->'checked_lines') <> 'array' then
        raise exception 'Not every line of the note is ticked'
          using errcode = 'check_violation', hint = 'serverErrors.noteLinesLeft';
      end if;
      select array_agg(distinct (line.value)::integer order by (line.value)::integer)
        into v_checked
      from jsonb_array_elements_text(p_payload->'checked_lines') as line;
      select array_agg(i) into v_wanted from generate_series(0, v_lines - 1) as i;
      if v_checked is distinct from v_wanted then
        raise exception 'Not every line of the note is ticked'
          using errcode = 'check_violation', hint = 'serverErrors.noteLinesLeft';
      end if;
      return jsonb_build_object('checked_lines', to_jsonb(coalesce(v_checked, '{}'::integer[])));

    when 'checklist' then
      if jsonb_typeof(p_payload->'checked_item_ids') <> 'array' then
        raise exception 'Not every required item is ticked'
          using errcode = 'check_violation', hint = 'serverErrors.checklistItemsLeft';
      end if;

      select array_agg(item.value->>'id'),
             array_agg(item.value->>'id')
               filter (where not coalesce((item.value->>'is_optional')::boolean, false))
        into v_known, v_needed
      from jsonb_array_elements(coalesce(p_config->'modules', '[]'::jsonb)) as module,
           jsonb_array_elements(coalesce(module.value->'items', '[]'::jsonb)) as item;

      select array_agg(distinct ticked.value order by ticked.value)
        into v_ticked
      from jsonb_array_elements_text(p_payload->'checked_item_ids') as ticked
      where ticked.value = any (coalesce(v_known, '{}'::text[]));

      if not (coalesce(v_needed, '{}'::text[]) <@ coalesce(v_ticked, '{}'::text[])) then
        raise exception 'Not every required item is ticked'
          using errcode = 'check_violation', hint = 'serverErrors.checklistItemsLeft';
      end if;

      return jsonb_build_object('checked_item_ids', to_jsonb(coalesce(v_ticked, '{}'::text[])));

    when 'photos_before', 'photos_after' then
      v_count := case when jsonb_typeof(p_payload->'media_ids') = 'array'
                      then jsonb_array_length(p_payload->'media_ids') else 0 end;
      v_min := coalesce((p_config->>'min_photos')::integer, 1);
      v_max := coalesce((p_config->>'max_photos')::integer, public.task_media_max_photos());
      if v_count < v_min then
        raise exception 'The step asks for at least % photos, % taken', v_min, v_count
          using errcode = 'check_violation',
                hint = 'serverErrors.photosMissing',
                detail = jsonb_build_object('min', v_min)::text;
      end if;
      if v_count > v_max then
        raise exception 'The step allows at most % photos, % taken', v_max, v_count
          using errcode = 'check_violation',
                hint = 'serverErrors.photosTooMany',
                detail = jsonb_build_object('limit', v_max)::text;
      end if;
      return jsonb_build_object('media_ids', p_payload->'media_ids');

    when 'video' then
      v_count := case when jsonb_typeof(p_payload->'media_ids') = 'array'
                      then jsonb_array_length(p_payload->'media_ids') else 0 end;
      if v_count = 0 then
        raise exception 'The step asks for a video'
          using errcode = 'check_violation', hint = 'serverErrors.videoMissing';
      end if;
      if v_count > 1 then
        raise exception 'The step allows one video, % recorded', v_count
          using errcode = 'check_violation',
                hint = 'serverErrors.mediaLimitReached',
                detail = jsonb_build_object('limit', 1)::text;
      end if;
      return jsonb_build_object('media_ids', p_payload->'media_ids');

    else
      raise exception 'This build cannot complete a step of this type'
        using errcode = 'check_violation', hint = 'serverErrors.stepTypeUnsupported';
  end case;
end;
$$;

/**
 * Complete a step.
 *
 * As 20260907120100, except that a media step answers with what the table
 * holds rather than with what the phone sends: the phone's payload is ignored
 * for those, the uploaded media of the step become `media_ids`, and a file
 * still on its way holds the step.
 */
create or replace function public.complete_task_step(
  p_step_id             uuid,
  p_payload             jsonb default '{}'::jsonb,
  p_device_completed_at timestamptz default null
)
returns public.task_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step    public.task_steps;
  v_input   jsonb;
  v_config  jsonb;
  v_payload jsonb;
  v_pending integer;
  v_media   jsonb;
begin
  v_step := public.task_step_for_update(p_step_id, true);

  if v_step.completed_at is not null then
    return v_step;
  end if;

  if not (v_step.type = any (public.workflow_supported_step_types())) then
    raise exception 'This build cannot complete a step of this type'
      using errcode = 'check_violation', hint = 'serverErrors.stepTypeUnsupported';
  end if;

  if v_step.type in ('photos_before', 'photos_after', 'video') then
    select count(*) filter (where m.uploaded_at is null),
           coalesce(jsonb_agg(m.id order by coalesce(m.device_taken_at, m.created_at), m.id)
                    filter (where m.uploaded_at is not null), '[]'::jsonb)
      into v_pending, v_media
    from public.task_media m
    where m.step_id = v_step.id and m.deleted_at is null;

    if v_pending > 0 then
      raise exception '% files of this step have not finished uploading', v_pending
        using errcode = 'check_violation',
              hint = 'serverErrors.mediaUploadPending',
              detail = jsonb_build_object('count', v_pending)::text;
    end if;

    v_input  := jsonb_build_object('media_ids', v_media);
    v_config := v_step.config || jsonb_build_object(
      'min_photos', v_step.min_photos, 'max_photos', v_step.max_photos);
  else
    v_input  := coalesce(p_payload, '{}'::jsonb);
    v_config := v_step.config;
  end if;

  v_payload := public.validate_task_step_payload(
    v_step.type, v_step.instructions, v_config, v_input);

  update public.task_steps s
  set started_at          = coalesce(s.started_at, now()),
      completed_at        = now(),
      completed_by        = (select auth.uid()),
      device_completed_at = p_device_completed_at,
      payload             = v_payload,
      skipped_at          = null,
      skip_reason         = null
  where s.id = p_step_id
  returning s.* into v_step;

  return v_step;
end;
$$;

comment on column public.task_steps.payload is
  'The answer, shaped per type: task_note {checked_lines:[…]}, cleaner_comment {text}, confirmation {}, checklist {checked_item_ids:[…]}, photos_*/video {media_ids:[…]} — the rows live in task_media.';
