-- The idempotency race in the two phone-keyed chat writes.
--
-- send_message and add_message_media look their row up by the id the phone
-- made up and insert it when it is not there; two calls with the same id at
-- the same moment give the loser a bare 23505. Until the chat this was a
-- theoretical race: a phone replays one mutation at a time. The photo chain
-- of F29 layer 5 (docs/chat-plan.md) makes it real -- the same send_message
-- runs from the text queue and from each photo's queue at once.
--
-- The same form 20260918170000 gave add_task_media and add_problem_media:
-- `insert ... on conflict (id) do nothing returning *`, and when nothing
-- comes back, the row is read again under the same host and author checks
-- the lookup at the top applies, plus one more lookup right after the row
-- lock, where a concurrent writer's row first becomes visible. The message
-- row's owner check lives in chat_media_written_meanwhile rather than in
-- task_media_written_meanwhile: that helper shipped before the chat and
-- knows only steps and problems.
--
-- The bodies below are those of 20260924100000 (add_message_media) and
-- 20260918120000 (send_message); only the insert and the tail after it change.

/**
 * The row a replayed chat photo write lost the race to: written by this same
 * author, under this same host, for this same message -- or a refusal that
 * says nothing more than the lookup at the top of add_message_media would.
 * The chat's twin of task_media_written_meanwhile, which shipped before the
 * chat and knows only steps and problems.
 *
 * Internal: called from the security definer RPC only.
 */
create or replace function public.chat_media_written_meanwhile(p_id uuid, p_message_id uuid)
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
     or v_media.message_id is distinct from p_message_id
     or v_media.created_by is distinct from (select auth.uid()) then
    raise exception 'Media not found'
      using errcode = 'check_violation', hint = 'serverErrors.mediaNotFound';
  end if;

  return v_media;
end;
$$;

revoke all on function public.chat_media_written_meanwhile(uuid, uuid)
  from public, anon, authenticated;

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
    if v_media.message_id is distinct from p_message_id
       or v_media.created_by is distinct from (select auth.uid()) then
      raise exception 'Media not found'
        using errcode = 'check_violation', hint = 'serverErrors.mediaNotFound';
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

-- ---------- send_message ----------

create or replace function public.send_message(
  p_id             uuid,
  p_body           text,
  p_task_id        uuid default null,
  p_problem_id     uuid default null,
  p_profile_id     uuid default null,
  p_media_expected smallint default 0
)
returns public.chat_messages
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_message public.chat_messages;
  v_thread  public.chat_threads;
  v_body    text := coalesce(p_body, '');
  v_count   smallint := coalesce(p_media_expected, 0);
begin
  -- Looked up by id ALONE. Scoped by host it would miss a row written under
  -- another tenant and fall through to the insert, where the primary key raises
  -- a bare duplicate-key error carrying no key the apps could translate.
  select m.* into v_message
  from public.chat_messages m
  where m.id = p_id;
  if found then
    if v_message.host_id is distinct from public.current_host_id()
       or v_message.author_id is distinct from (select auth.uid()) then
      raise exception 'Message not found'
        using errcode = 'check_violation', hint = 'serverErrors.messageNotFound';
    end if;
    return v_message;
  end if;

  if length(v_body) > public.chat_body_max_length() then
    raise exception 'The message is too long'
      using errcode = 'check_violation',
            hint = 'serverErrors.messageTooLong',
            detail = jsonb_build_object('limit', public.chat_body_max_length())::text;
  end if;

  if v_count < 0 or v_count > public.chat_max_photos() then
    raise exception 'Too many photos declared'
      using errcode = 'check_violation',
            hint = 'serverErrors.messagePhotoLimit',
            detail = jsonb_build_object('limit', public.chat_max_photos())::text;
  end if;

  if length(btrim(v_body)) = 0 and v_count = 0 then
    raise exception 'The message says nothing'
      using errcode = 'check_violation', hint = 'serverErrors.messageEmpty';
  end if;

  v_thread := public.open_thread(p_task_id, p_problem_id, p_profile_id);

  insert into public.chat_messages (
    id, host_id, thread_id, author_id, author_name, author_role, body, media_expected
  )
  select p_id, v_thread.host_id, v_thread.id, pr.id, pr.full_name, pr.role, v_body, v_count
  from public.profiles pr
  where pr.id = (select auth.uid())
  on conflict (id) do nothing
  returning * into v_message;

  if not found then
    -- A replay of this very call got its row in between the lookup and the
    -- insert (the text queue and a photo's queue both say the same message,
    -- docs/chat-plan.md layer 5). The winner has also moved the read marker.
    select m.* into v_message
    from public.chat_messages m
    where m.id = p_id;
    if not found
       or v_message.host_id is distinct from public.current_host_id()
       or v_message.author_id is distinct from (select auth.uid()) then
      raise exception 'Message not found'
        using errcode = 'check_violation', hint = 'serverErrors.messageNotFound';
    end if;
    return v_message;
  end if;

  insert into public.chat_reads (thread_id, profile_id, host_id, last_read_at)
  values (v_thread.id, (select auth.uid()), v_thread.host_id, v_message.created_at)
  on conflict (thread_id, profile_id) do update
    set last_read_at = greatest(public.chat_reads.last_read_at, excluded.last_read_at),
        updated_at   = now();

  return v_message;
end;
$$;
