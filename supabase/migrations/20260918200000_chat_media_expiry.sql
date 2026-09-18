-- F29 layer 5: a photo of a message that never arrived expires.
--
-- The receiver draws a registered row without a file as a grey "photo on its
-- way" tile (docs/chat-plan.md, layer 5): that is what the server knows for
-- certain. But a phone lost in a drawer would leave that tile in place until
-- the thread's subject has been closed for the retention period -- forever in
-- a direct thread. The row is registered only while there is signal, so the
-- gap between "registered" and "uploaded" is seconds, or an app killed
-- mid-upload and opened again; a day is generous.
--
-- Decided on the server, in one place, rather than as a threshold in two
-- clients: the nightly purge (20260907160200, 04:30) marks such a row
-- purged_at, both apps read task_media with `purged_at is null`, and the
-- sender's retry meets one answer along the whole chain --
-- serverErrors.messageMediaExpired from add_message_media and from
-- confirm_task_media, while the bucket policy (can_upload_task_media,
-- `purged_at is null`) refuses the file as it always did. A day's threshold
-- plus a sweep once a day means the tile lives 24 to 48 hours.
--
-- remove_task_media is untouched: an expired row still has uploaded_at null,
-- so the author may take it back, which is the one thing left to do with it.

/** How long a photo of a message may wait for its file before it expires. */
create or replace function public.chat_media_upload_window()
returns interval language sql immutable parallel safe set search_path = ''
as $$ select interval '24 hours' $$;

revoke all on function public.chat_media_upload_window() from public, anon;
grant execute on function public.chat_media_upload_window() to authenticated, service_role;

-- ---------- retention: the fourth branch ----------

/**
 * Changed from 20260918180000: a photo of a message whose file has not
 * arrived within chat_media_upload_window() is due as well. Only a message's
 * photo: a step's row without a file waits for the step's task to close, as
 * before -- the cleaner is still on the spot and may well finish the upload.
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
  left join public.chat_messages cm on cm.id = m.message_id
  left join public.chat_threads  th on th.id = cm.thread_id
  left join public.tasks    t on t.id = coalesce(m.task_id, th.task_id)
  left join public.problems p on p.id = coalesce(m.problem_id, th.problem_id)
  where m.purged_at is null
    and (m.deleted_at is not null
         or (t.status in ('done', 'cancelled', 'expired')
             and coalesce(t.completed_at, t.updated_at)
                 < now() - make_interval(days => public.task_media_retention_days()))
         or (p.status in ('resolved', 'cancelled')
             and coalesce(p.resolved_at, p.cancelled_at, p.updated_at)
                 < now() - make_interval(days => public.task_media_retention_days()))
         or (th.kind = 'direct'
             and cm.created_at
                 < now() - make_interval(days => public.task_media_retention_days()))
         or (m.message_id is not null
             and m.uploaded_at is null
             and m.created_at < now() - public.chat_media_upload_window()))
  order by m.created_at, m.id
  limit greatest(coalesce(p_limit, 200), 1)
$$;

-- ---------- registering: a replay of an expired row is told so ----------

/**
 * Changed from 20260918190000: the replay of a row the purge has already
 * marked answers messageMediaExpired instead of handing back a row whose
 * path the bucket will refuse. Otherwise as before.
 */
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
    if v_media.message_id is distinct from p_message_id
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
  return public.task_media_written_meanwhile(p_id, null, null, p_message_id);
end;
$$;

-- ---------- confirming: the same answer ----------

/**
 * Changed from 20260907160100: confirming a message's photo that expired
 * before its file arrived answers messageMediaExpired -- the same word the
 * registration gives, so the phone shows one tile for the whole chain and not
 * a different failure per link. A step's or a problem's row is confirmed as
 * before. Otherwise unchanged.
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

  if v_media.message_id is not null and v_media.purged_at is not null then
    raise exception 'The photo waited too long for its file and has expired'
      using errcode = 'check_violation', hint = 'serverErrors.messageMediaExpired';
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
