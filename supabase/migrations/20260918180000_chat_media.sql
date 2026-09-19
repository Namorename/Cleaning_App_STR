-- F29 layer 5: a photo in a message, through the task media pipeline.
--
-- A media row now belongs to exactly one of THREE owners: a task step, a
-- problem, or a chat message. The move is the one 20260908130100 made when it
-- added the second owner, and for the same reason: the bucket policy admits a
-- file only onto the path its row is waiting for, confirmation checks the
-- object, signed reads go through the row, retention walks the row -- none of
-- it cares which owner the row has. A separate table for chat photos would
-- have needed all of that a second time (CLAUDE.md: a new kind of media is a
-- new owner in the same pipeline, not a new table).
--
-- Path: <host_id>/chat/<thread_id>/<media_id>.<ext>. The thread is the unit of
-- retention and the only folder an operator could make sense of.
--
-- Photos only. A step asks for a video because the step declared
-- max_video_sec; in a conversation there is nobody to declare it, and 150 MB
-- over a mobile connection is a bill. At most chat_max_photos() per message --
-- and never more than the message DECLARED in media_expected: the declaration
-- was made so that a wordless row could say pictures are coming, and a picture
-- the row did not announce is a picture nobody asked for.
--
-- The gallery switch (20260917110100) is NOT enforced here. It exists so that a
-- step's evidence is taken on the spot; a photo in a conversation is not
-- evidence of a step, and the office attaches from a browser that has no
-- camera at all -- with the switch off by default, enforcing it would have
-- shut the panel out. `source` is still recorded as the declaration it is.

alter table public.task_media
  add column message_id uuid references public.chat_messages(id) on delete cascade;

comment on column public.task_media.message_id is
  'Set on a photo attached to a chat message; task_id, step_id and problem_id are null then.';

comment on column public.task_media.storage_path is
  'Object key in the task-media bucket: <host_id>/<task_id>/<id>.<ext> for a step, <host_id>/problems/<problem_id>/<id>.<ext> for a problem, <host_id>/chat/<thread_id>/<id>.<ext> for a message. The upload policy admits exactly this path.';

alter table public.task_media
  drop constraint task_media_one_owner,
  add constraint task_media_one_owner check (
    (task_id is not null and step_id is not null and problem_id is null and message_id is null)
    or (problem_id is not null and task_id is null and step_id is null and message_id is null)
    or (message_id is not null and task_id is null and step_id is null and problem_id is null)
  );

create index task_media_message_idx on public.task_media (message_id)
  where message_id is not null and deleted_at is null;

-- Whoever may read the message reads its photos. The subquery runs under the
-- caller's own policies on chat_messages, which in turn defer to chat_threads
-- and so to chat_participates -- the one place the rule is written.
--
-- host_id = current_host_id() is not a second copy of what the subquery
-- already proves. It is what keeps host_id in the scan condition of
-- task_media_task_idx: every policy on this table carries the test, so the
-- planner lifts it out of the OR as a common factor. Drop it here and it
-- leaves the factored part, and the index reads every task screen makes lose
-- their leading column.
--
-- A step's or a problem's row does not pay for this branch. The EXISTS is a
-- SubPlan, the planner tests the cheap `message_id IS NOT NULL` ahead of it,
-- and the branch is already false when the subquery would run -- `never
-- executed` in the plan, and 164 buffers on the phone's fetchTaskMedia over
-- 20 000 rows both with this policy and without it. Measured, not promised:
-- what order the tests inside a branch are taken in is the planner's choice.
--
-- THE NAME IS PART OF THE DESIGN, and that is why it begins with a word the
-- feature does not need. Permissive policies are folded into one OR, and the
-- branches come out ordered by policy NAME, DESCENDING. "chat message ..."
-- therefore sorts behind "managers read all task media", the manager's cheap
-- branch is taken first, and a manager reading a thread never reaches the
-- EXISTS below: 983 buffers instead of 2383 on a thread of 20 messages with
-- 40 photos, 11 049 instead of 37 929 on 220 messages with 840 photos.
--
-- NONE OF THAT IS CONTRACTED. No documentation promises that policy names
-- order the branches; it is an artefact of how the planner assembles them,
-- checked here on PostgreSQL 17.6. After an upgrade it can go away in
-- silence -- the reads stay correct and merely get dearer, and nothing turns
-- red on its own. Two things guard against that: the check in
-- supabase/tests/chat.sql that reads the Filter text of the plan and fails
-- when is_manager() is no longer ahead of the message branch, and the standing
-- item in F13 Hardening (docs/ROADMAP.md) to measure again after every
-- Postgres upgrade. How to look: docs/chat-plan.md, "Эксплуатация выката".
create policy "chat message media is read by whoever reads the message"
  on public.task_media for select to authenticated
  using (message_id is not null
         and host_id = public.current_host_id()
         and public.is_active_user()
         and exists (select 1 from public.chat_messages cm where cm.id = task_media.message_id));

-- ---------- registering a photo on a message ----------

/**
 * Register a photo of a message and learn where it has to go. Replayable.
 *
 * Only the author, only while she still takes part in the thread -- access
 * follows the subject, not authorship, so a technician taken off a repair
 * cannot keep adding to what she wrote about it. Only photos, at most as many
 * as the message declared. Path: host/chat/thread/id.ext.
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
  returning * into v_media;

  return v_media;
end;
$$;

revoke all on function public.add_message_media(
  uuid, uuid, text, integer, integer, integer, timestamptz, public.media_source)
  from public, anon;
grant execute on function public.add_message_media(
  uuid, uuid, text, integer, integer, integer, timestamptz, public.media_source)
  to authenticated, service_role;

-- ---------- taking a photo back: now for any of the three owners ----------

/**
 * Changed from 20260908130100: a photo on a message is taken back only while
 * its file has not arrived -- the upload failed and the author gave up. Once
 * confirmed it is part of what was said, and a message is not edited.
 */
create or replace function public.remove_task_media(p_id uuid)
returns public.task_media
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_media   public.task_media;
  v_step    public.task_steps;
  v_status  public.problem_status;
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

  if v_media.message_id is not null then
    if v_media.uploaded_at is not null then
      raise exception 'The photo is part of a sent message and cannot be taken back'
        using errcode = 'check_violation', hint = 'serverErrors.messageMediaSent';
    end if;
  elsif v_media.problem_id is not null then
    select p.status into v_status from public.problems p where p.id = v_media.problem_id for update;
    if v_status <> 'open' then
      raise exception 'Problem is % and its photos can no longer change', v_status
        using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
    end if;
  else
    v_step := public.task_step_for_update(v_media.step_id, true);
    if v_step.completed_at is not null then
      raise exception 'The step is completed; reopen it to change its media'
        using errcode = 'check_violation', hint = 'serverErrors.stepCompleted';
    end if;
  end if;

  update public.task_media m
  set deleted_at = now()
  where m.id = p_id
  returning m.* into v_media;

  return v_media;
end;
$$;

-- ---------- retention: a thread ages with its subject ----------

/**
 * Changed from 20260908130100: photos in a thread about a task or a problem
 * are due when that task or problem has been closed longer than the retention
 * period -- the same clock as the subject's own files. Photos in a direct
 * thread have no subject to close and are due when the message itself is
 * older than the retention period.
 *
 * The thread's subject is joined through coalesce so a step's, a problem's
 * and a message's row all land on the same two branches below.
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
                 < now() - make_interval(days => public.task_media_retention_days())))
  order by m.created_at, m.id
  limit greatest(coalesce(p_limit, 200), 1)
$$;
