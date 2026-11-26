-- The office adds photos, videos and a comment to a task (owner, 2026-11-26, CORE;
-- docs/problem-additions-1126.md).
--
-- A manager or an admin (and the reception, which may do whatever a manager does
-- outside the boards, 20261119143000) adds files to an open task at any moment, and
-- a comment and files when closing it as done by hand. The journal says who added
-- what and when, and never the words.
--
-- - The files go down the media pipeline every file takes (row before file, the same
--   types, sizes and video limits, signed links, the retention sweep), under an owner
--   of their own: an ADDITION, one batch the office sends at once. Not the task's own
--   owner (problem_id): every build in the field and the panel of yesterday read the
--   report's photos by problem_id and draw whatever they get as a photo — a manager's
--   video would be a broken tile in the reporter's strip. They do not ask for
--   addition_id, so they never see these rows (CLAUDE.md: a new kind of media is a new
--   owner in the same pipeline, not a new table of files).
--
-- - A batch is written first, its files follow, and it shows once it is PUBLISHED:
--   publish_office_media in an open task, resolve_problem in the closing itself. A
--   file that never arrived is left out at that moment, by the manager's choice made
--   on the screen; a batch never published shows nowhere, and its files go with the
--   sweep after the upload window.
--
-- - The words stay in the task's conversation (chat_messages): the closing's comment
--   is a message of the task's thread, sent inside resolve_problem, so the closing and
--   its words are one transaction. The batch of a closing keeps the message's id, so
--   the closing block finds it.
--
-- - The journal: two new kinds, media_added (count, photos, videos, at, addition) and
--   comment_added (at, message) — ids, numbers and a stage, never text. Every build
--   reads a kind as any string and draws one it does not know as a neutral line
--   (apps/mobile/src/features/history/schema.ts since its first version, 09.10); the
--   panel has no journal screen, the API does not expose the journal. A comment is any
--   message of the office in a task's thread: written by a trigger, so the chat's own
--   sending path stays as it is. Its stage: 'closing' when resolve_problem sends it,
--   'closed' in a task already closed, 'open' otherwise.
--
-- - resolve_problem takes three new arguments, each defaulting to «the caller said
--   nothing» (CLAUDE.md): the panel and the phones of today, and the bulk levers,
--   close as they always have. The three-argument function is dropped in the same
--   transaction: two overloads would leave PostgREST unable to choose (PGRST203).
--
-- New table, column, policies, functions and trigger; four functions redefined
-- (resolve_problem, remove_task_media, task_media_to_purge, mark_signal_false_positive).
-- Rollback: docs/one-off-writes/problem-additions-rollback.sql.

set local lock_timeout = '3s';

-- ---------- the journal's two new kinds ----------

-- Added inside the migration's transaction: nothing here uses them before commit
-- (the functions below are plpgsql and read them when they run).
alter type public.problem_event_kind add value if not exists 'media_added';
alter type public.problem_event_kind add value if not exists 'comment_added';

-- ---------- the batch ----------

create table public.problem_additions (
  -- Made by the screen, so a retry after a lost connection replays instead of
  -- writing a second batch (as problems.id and chat_messages.id).
  id           uuid primary key,
  host_id      uuid not null references public.hosts (id) on delete restrict,
  problem_id   uuid not null references public.problems (id) on delete cascade,
  -- Who sent it: the name is read from the staff directory, as everywhere in the office.
  author_id    uuid references public.profiles (id) on delete set null,
  -- 'open': added to a task at work; 'closing': sent with its closing. Known when
  -- published; null while the files are on their way.
  stage        text constraint problem_additions_stage check (stage in ('open', 'closing')),
  -- The closing's comment: a message of the task's thread, where the text lives.
  message_id   uuid references public.chat_messages (id) on delete set null,
  created_at   timestamptz not null default now(),
  published_at timestamptz,
  constraint problem_additions_published_with_stage
    check ((stage is null) = (published_at is null))
);

comment on table public.problem_additions is
  'Photos and videos the office adds to a task at once, at work or with its closing '
  '(20261126100000). The files are task_media rows owned by the batch; the comment is '
  'a chat message of the task. Shown once published.';

create index problem_additions_problem_idx
  on public.problem_additions (problem_id, created_at, id);
-- Dismissing somebody and deleting a message set these to null: without the indexes
-- each would read the whole table.
create index problem_additions_author_idx
  on public.problem_additions (author_id) where author_id is not null;
create index problem_additions_message_idx
  on public.problem_additions (message_id) where message_id is not null;

alter table public.problem_additions enable row level security;
revoke all on public.problem_additions from public, anon, authenticated, service_role;
grant select on public.problem_additions to authenticated, service_role;

-- Whoever reads the task reads what the office added to it — the rule of the task's
-- own photos (20260908130100). problems' own policies decide inside the exists.
create policy "staff read additions of tasks they read"
  on public.problem_additions for select
  to authenticated
  using (published_at is not null
         and host_id = public.current_host_id()
         and public.is_active_user()
         and exists (select 1 from public.problems p
                     where p.id = problem_additions.problem_id));

-- ---------- the files' owner ----------

alter table public.task_media
  add column addition_id uuid references public.problem_additions (id) on delete cascade;

comment on column public.task_media.addition_id is
  'The office''s batch the file belongs to (20261126100000); its fourth owner.';

create index task_media_addition_idx
  on public.task_media (addition_id) where addition_id is not null;

alter table public.task_media drop constraint task_media_one_owner;
alter table public.task_media add constraint task_media_one_owner check (
     (task_id is not null and step_id is not null
      and problem_id is null and message_id is null and addition_id is null)
  or (problem_id is not null
      and task_id is null and step_id is null and message_id is null and addition_id is null)
  or (message_id is not null
      and task_id is null and step_id is null and problem_id is null and addition_id is null)
  or (addition_id is not null
      and task_id is null and step_id is null and problem_id is null and message_id is null));

-- The file of a published batch, to whoever reads the batch (its policy above). The
-- managers' policy (all media of the company) covers the office as before.
create policy "addition media is read by whoever reads the addition"
  on public.task_media for select
  to authenticated
  using (addition_id is not null
         and host_id = public.current_host_id()
         and public.is_active_user()
         and exists (select 1 from public.problem_additions a
                     where a.id = task_media.addition_id));

-- ---------- limits ----------

-- How many files one batch takes. The screens say the same (packages/shared).
create or replace function public.problem_addition_max_files()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 10 $$;

revoke all on function public.problem_addition_max_files() from public, anon;
grant execute on function public.problem_addition_max_files() to authenticated, service_role;

-- ---------- a file of a batch ----------

/**
 * Register one file of the office's batch and learn the one path it may go to.
 *
 * Replayable by id, like every register of the pipeline. The batch is written by its
 * first file. Only the office, only an open task (not resolved, not cancelled, not
 * archived), the types and sizes every file is held to, a video to the company's own
 * length and size. The gallery switch is the cleaners' (a proof taken on the spot) and
 * does not apply to the office, which can only pick files in the panel; the source is
 * still recorded as declared.
 */
create or replace function public.add_office_media(
  p_id              uuid,
  p_addition_id     uuid,
  p_problem_id      uuid,
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
  v_problem   public.problems;
  v_addition  public.problem_additions;
  v_media     public.task_media;
  v_extension text;
  v_count     integer;
  v_video_sec integer;
  v_video_mb  integer;
begin
  -- A replay: the row, if it is this caller's file of this batch.
  select m.* into v_media
  from public.task_media m
  where m.id = p_id;
  if found then
    if v_media.host_id is distinct from public.current_host_id()
       or (v_media.addition_id = p_addition_id) is not true
       or v_media.created_by is distinct from (select auth.uid()) then
      raise exception 'Media not found'
        using errcode = 'check_violation', hint = 'serverErrors.mediaNotFound';
    end if;
    return v_media;
  end if;

  -- The office only, the company's own task; locked as the dispatch levers lock it.
  v_problem := public.problem_for_manager(p_problem_id);
  if v_problem.status in ('resolved', 'cancelled') or v_problem.archived_at is not null then
    raise exception 'Problem is % and takes no more files', v_problem.status
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;

  insert into public.problem_additions (id, host_id, problem_id, author_id)
  values (p_addition_id, v_problem.host_id, v_problem.id, (select auth.uid()))
  on conflict (id) do nothing;

  select a.* into v_addition
  from public.problem_additions a
  where a.id = p_addition_id
  for update;
  if v_addition.host_id is distinct from v_problem.host_id
     or v_addition.problem_id is distinct from v_problem.id
     or v_addition.author_id is distinct from (select auth.uid()) then
    raise exception 'Addition not found'
      using errcode = 'check_violation', hint = 'serverErrors.additionNotFound';
  end if;
  if v_addition.published_at is not null then
    raise exception 'The batch is already added and takes no more files'
      using errcode = 'check_violation', hint = 'serverErrors.additionPublished';
  end if;

  v_extension := public.task_media_extension(p_mime_type);
  if p_kind is null
     or v_extension is null
     or (p_kind = 'photo' and lower(p_mime_type) not like 'image/%')
     or (p_kind = 'video' and lower(p_mime_type) not like 'video/%') then
    raise exception 'Media type % is not accepted for a %', p_mime_type, p_kind
      using errcode = 'check_violation', hint = 'serverErrors.mediaTypeInvalid';
  end if;
  if p_byte_size is null or p_byte_size <= 0 then
    raise exception 'Media size is missing'
      using errcode = 'check_violation', hint = 'serverErrors.mediaSizeMissing';
  end if;
  if p_byte_size > public.task_media_max_bytes(p_kind) then
    raise exception 'The file is larger than % bytes', public.task_media_max_bytes(p_kind)
      using errcode = 'check_violation',
            hint = 'serverErrors.mediaTooLarge',
            detail = jsonb_build_object(
              'limit_mb', public.task_media_max_bytes(p_kind) / (1024 * 1024))::text;
  end if;

  if p_kind = 'video' then
    -- The company's limits as they are now, as add_task_media holds a step's video
    -- (20261023100000).
    select h.video_max_sec, h.video_max_mb into v_video_sec, v_video_mb
    from public.hosts h
    where h.id = v_problem.host_id;

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
    if p_duration_sec > v_video_sec + public.task_media_video_tolerance_sec() then
      raise exception 'The video is longer than % seconds', v_video_sec
        using errcode = 'check_violation',
              hint = 'serverErrors.videoTooLong',
              detail = jsonb_build_object('limit', v_video_sec)::text;
    end if;
  end if;

  select count(*)::integer into v_count
  from public.task_media m
  where m.addition_id = p_addition_id and m.deleted_at is null;
  if v_count >= public.problem_addition_max_files() then
    raise exception 'The batch already holds % of at most % files',
                    v_count, public.problem_addition_max_files()
      using errcode = 'check_violation',
            hint = 'serverErrors.mediaLimitReached',
            detail = jsonb_build_object('limit', public.problem_addition_max_files())::text;
  end if;

  insert into public.task_media (
    id, host_id, addition_id, kind, storage_path, mime_type, byte_size,
    width, height, duration_sec, device_taken_at, created_by, source
  ) values (
    p_id, v_problem.host_id, p_addition_id, p_kind,
    v_problem.host_id::text || '/problems/' || v_problem.id::text || '/office/'
      || p_id::text || '.' || v_extension,
    lower(p_mime_type), p_byte_size, p_width, p_height,
    case when p_kind = 'video' then p_duration_sec end,
    p_device_taken_at, (select auth.uid()), coalesce(p_source, 'unknown')
  )
  on conflict (id) do nothing
  returning * into v_media;
  if found then
    return v_media;
  end if;

  -- A replay of this very call got its row in between: that row is the answer.
  select m.* into v_media
  from public.task_media m
  where m.id = p_id;
  if not found
     or v_media.host_id is distinct from public.current_host_id()
     or (v_media.addition_id = p_addition_id) is not true
     or v_media.created_by is distinct from (select auth.uid()) then
    raise exception 'Media not found'
      using errcode = 'check_violation', hint = 'serverErrors.mediaNotFound';
  end if;
  return v_media;
end;
$$;

comment on function public.add_office_media(uuid, uuid, uuid, public.media_kind, text, integer,
  integer, integer, numeric, timestamptz, public.media_source) is
  'Registers one file of the office''s batch on an open task (20261126100000); replayable by id.';

revoke all on function public.add_office_media(uuid, uuid, uuid, public.media_kind, text,
  integer, integer, integer, numeric, timestamptz, public.media_source) from public, anon;
grant execute on function public.add_office_media(uuid, uuid, uuid, public.media_kind, text,
  integer, integer, integer, numeric, timestamptz, public.media_source)
  to authenticated, service_role;

-- ---------- publishing a batch ----------

/**
 * Show a batch: its stage and the moment, and the journal's line. Called with the
 * batch locked, by publish_office_media and by resolve_problem, never by a client.
 *
 * A file that has not arrived by now is left out — the manager chose to go on without
 * it on the screen — and goes with the sweep (deleted_at). A batch with nothing in it
 * is refused at work (nothing to add) and stays unpublished at a closing, which must
 * not fail for want of a file: the closing then goes on alone.
 */
create or replace function public.publish_problem_addition(
  p_addition_id uuid,
  p_stage       text,
  p_message_id  uuid default null
)
returns public.problem_additions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_addition public.problem_additions;
  v_photos   integer;
  v_videos   integer;
begin
  update public.task_media m
  set deleted_at = now()
  where m.addition_id = p_addition_id
    and m.uploaded_at is null
    and m.deleted_at is null;

  select count(*) filter (where m.kind = 'photo')::integer,
         count(*) filter (where m.kind = 'video')::integer
    into v_photos, v_videos
  from public.task_media m
  where m.addition_id = p_addition_id
    and m.deleted_at is null
    and m.uploaded_at is not null;

  if v_photos + v_videos = 0 and p_message_id is null then
    if p_stage = 'closing' then
      select a.* into v_addition from public.problem_additions a where a.id = p_addition_id;
      return v_addition;
    end if;
    raise exception 'None of the files has arrived'
      using errcode = 'check_violation', hint = 'serverErrors.additionEmpty';
  end if;

  update public.problem_additions a
  set stage        = p_stage,
      published_at = now(),
      message_id   = coalesce(p_message_id, a.message_id)
  where a.id = p_addition_id
  returning a.* into v_addition;

  if v_photos + v_videos > 0 then
    insert into public.problem_events (host_id, problem_id, kind, actor_id, params)
    values (v_addition.host_id, v_addition.problem_id, 'media_added', (select auth.uid()),
            jsonb_build_object('count', v_photos + v_videos, 'photos', v_photos,
                               'videos', v_videos, 'at', p_stage,
                               'addition', v_addition.id));
  end if;

  return v_addition;
end;
$$;

comment on function public.publish_problem_addition(uuid, text, uuid) is
  'Shows a batch of the office and writes its journal line (20261126100000); internal.';

revoke all on function public.publish_problem_addition(uuid, text, uuid)
  from public, anon, authenticated;

/**
 * «Добавить» in an open task: the batch shows with the files that arrived.
 * Replayable: a batch already shown is the answer.
 */
create or replace function public.publish_office_media(p_addition_id uuid)
returns public.problem_additions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_addition public.problem_additions;
  v_problem  public.problems;
begin
  select a.* into v_addition
  from public.problem_additions a
  where a.id = p_addition_id
    and a.host_id = public.current_host_id()
    and a.author_id = (select auth.uid());
  if not found then
    raise exception 'Addition not found'
      using errcode = 'check_violation', hint = 'serverErrors.additionNotFound';
  end if;

  -- The task first, then the batch: the order add_office_media locks them in.
  v_problem := public.problem_for_manager(v_addition.problem_id);
  select a.* into v_addition
  from public.problem_additions a
  where a.id = p_addition_id
  for update;

  if v_addition.published_at is not null then
    return v_addition;
  end if;
  if v_problem.status in ('resolved', 'cancelled') or v_problem.archived_at is not null then
    raise exception 'Problem is % and takes no more files', v_problem.status
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;

  return public.publish_problem_addition(p_addition_id, 'open');
end;
$$;

comment on function public.publish_office_media(uuid) is
  'Shows the office''s batch on an open task with the files that arrived (20261126100000).';

revoke all on function public.publish_office_media(uuid) from public, anon;
grant execute on function public.publish_office_media(uuid) to authenticated, service_role;

-- ---------- the closing's comment and files ----------

/**
 * The words and the files of a closing, inside resolve_problem.
 *
 * The comment is a message of the task's thread (send_message, replayable by the
 * screen's id); the trigger below writes its journal line as said at the closing. The
 * batch is written here when the closing brings words alone, so the closing block
 * finds them; a batch already shown is a replay.
 */
create or replace function public.problem_closing_addition(
  p_problem     public.problems,
  p_addition_id uuid,
  p_comment_id  uuid,
  p_comment     text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_addition public.problem_additions;
  v_message  public.chat_messages;
  v_words    text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if p_addition_id is null or (v_words is not null and p_comment_id is null) then
    raise exception 'A closing''s comment and files need the ids of the screen'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.closingAdditionInvalid';
  end if;

  insert into public.problem_additions (id, host_id, problem_id, author_id)
  values (p_addition_id, p_problem.host_id, p_problem.id, (select auth.uid()))
  on conflict (id) do nothing;

  select a.* into v_addition
  from public.problem_additions a
  where a.id = p_addition_id
  for update;
  if v_addition.host_id is distinct from p_problem.host_id
     or v_addition.problem_id is distinct from p_problem.id
     or v_addition.author_id is distinct from (select auth.uid()) then
    raise exception 'Addition not found'
      using errcode = 'check_violation', hint = 'serverErrors.additionNotFound';
  end if;
  if v_addition.published_at is not null then
    return;
  end if;

  if v_words is not null then
    perform set_config('str_ops.problem_addition', 'closing', true);
    v_message := public.send_message(p_comment_id, v_words, null, p_problem.id, null,
                                     0::smallint);
    perform set_config('str_ops.problem_addition', '', true);
  end if;

  perform public.publish_problem_addition(p_addition_id, 'closing', v_message.id);
end;
$$;

comment on function public.problem_closing_addition(public.problems, uuid, uuid, text) is
  'The comment and files of a closing by hand, inside resolve_problem (20261126100000); internal.';

revoke all on function public.problem_closing_addition(public.problems, uuid, uuid, text)
  from public, anon, authenticated;

-- ---------- resolve_problem: the old three arguments and three new ones ----------

drop function public.resolve_problem(uuid, uuid, boolean);

create or replace function public.resolve_problem(
  p_id           uuid,
  p_completed_by uuid default null,
  p_alone        boolean default null,
  -- The closing's own batch (owner, 2026-11-26); null: the caller said nothing.
  p_addition_id  uuid default null,
  -- The closing's comment and the id the screen made for its message.
  p_comment_id   uuid default null,
  p_comment      text default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
  v_how     text;
begin
  v_problem := public.problem_for_manager(p_id);

  if v_problem.status = 'cancelled' then
    raise exception 'Problem is cancelled and cannot be resolved'
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;

  -- The words and files the manager sends with the closing go in the same
  -- transaction: a closing that fails takes them with it. A replay finds them shown.
  if p_addition_id is not null or nullif(btrim(coalesce(p_comment, '')), '') is not null then
    perform public.problem_closing_addition(v_problem, p_addition_id, p_comment_id, p_comment);
  end if;

  if v_problem.status = 'resolved' then
    return v_problem;
  end if;

  if p_completed_by is not null and coalesce(p_alone, false) then
    raise exception 'Name the worker or close alone, not both'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.problemCompleterInvalid';
  end if;
  if p_completed_by is not null then
    if not exists (select 1 from public.profiles pr
                   where pr.id = p_completed_by
                     and pr.host_id = v_problem.host_id
                     and pr.role in ('tech', 'head_tech', 'cleaner')) then
      raise exception 'The worker named is not of this company''s staff'
        using errcode = 'check_violation', hint = 'serverErrors.problemCompleterInvalid';
    end if;
    v_how := 'manager_for';
  elsif coalesce(p_alone, false) then
    v_how := 'manager_self';
  end if;

  if v_how is not null then
    perform set_config('str_ops.problem_closing',
                       jsonb_build_object('problem', p_id, 'how', v_how,
                                          'completed_by', p_completed_by)::text,
                       true);
  end if;

  -- The attempt is finished first: the mirror resolves the task. The worker named is its
  -- finisher; otherwise the guard writes the manager, as it always has.
  update public.tasks t
  set status       = 'done',
      completed_by = case when v_how = 'manager_for' then p_completed_by else t.completed_by end
  where t.problem_id = p_id and t.status not in ('done', 'cancelled', 'expired');

  update public.problems p
  set status      = 'resolved',
      resolved_at = coalesce(p.resolved_at, now())
  where p.id = p_id
  returning * into v_problem;

  perform set_config('str_ops.problem_closing', '', true);
  return v_problem;
end;
$$;

comment on function public.resolve_problem(uuid, uuid, boolean, uuid, uuid, text) is
  'Closes a task as done by hand, naming who did it (20261106125000), with the '
  'manager''s comment and files of the closing (20261126100000).';

revoke all on function public.resolve_problem(uuid, uuid, boolean, uuid, uuid, text)
  from public, anon;
grant execute on function public.resolve_problem(uuid, uuid, boolean, uuid, uuid, text)
  to authenticated, service_role;

-- ---------- the journal of the office's comments ----------

/**
 * A message of the office in a task's thread is a comment the journal names: who,
 * when, the stage, the message's id — never its words. The thread of a repair is its
 * task's (open_thread), so every comment about the task lands here.
 */
create or replace function public.journal_office_comment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
  v_at      text;
begin
  select p.* into v_problem
  from public.chat_threads th
  join public.problems p on p.id = th.problem_id
  where th.id = new.thread_id;
  if not found then
    return null;
  end if;

  v_at := case
    when coalesce(current_setting('str_ops.problem_addition', true), '') = 'closing'
      then 'closing'
    when v_problem.status in ('resolved', 'cancelled') then 'closed'
    else 'open'
  end;

  insert into public.problem_events (host_id, problem_id, kind, actor_id, params)
  values (v_problem.host_id, v_problem.id, 'comment_added', new.author_id,
          jsonb_build_object('at', v_at, 'message', new.id));
  return null;
end;
$$;

comment on function public.journal_office_comment() is
  'Trigger on chat_messages: an office message in a task''s thread writes comment_added '
  'into problem_events, without its text (20261126100000).';

revoke all on function public.journal_office_comment() from public, anon, authenticated;

create trigger chat_messages_journal_office
  after insert on public.chat_messages
  for each row
  when (new.author_role in ('manager', 'admin', 'reception'))
  execute function public.journal_office_comment();

-- ---------- taking a file back ----------

-- A file of a batch may be taken back by its author until the batch shows; after that
-- it is part of the task, as a sent message's photo is.
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
  elsif v_media.addition_id is not null then
    if exists (select 1 from public.problem_additions a
               where a.id = v_media.addition_id and a.published_at is not null) then
      raise exception 'The file is added to the task and cannot be taken back'
        using errcode = 'check_violation', hint = 'serverErrors.additionPublished';
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

-- ---------- the retention sweep ----------

-- A batch's file lives as long as its task's files do: 90 days after the task closed.
-- A file of a batch never shown goes once the upload window has passed, as a message's
-- photo that never arrived.
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
  left join public.problem_additions a on a.id = m.addition_id
  left join public.tasks    t on t.id = coalesce(m.task_id, th.task_id)
  left join public.problems p on p.id = coalesce(m.problem_id, th.problem_id, a.problem_id)
  where m.purged_at is null
    and (m.deleted_at is not null
         or (t.status in ('done', 'cancelled', 'expired')
             and coalesce(t.completed_at, t.updated_at)
                 < now() - make_interval(days => public.task_media_retention_days())
             and (m.message_id is null
                  or cm.created_at < now() - make_interval(days => public.task_media_retention_days())))
         or (p.status in ('resolved', 'cancelled')
             and coalesce(p.resolved_at, p.cancelled_at, p.updated_at)
                 < now() - make_interval(days => public.task_media_retention_days())
             and (m.message_id is null
                  or cm.created_at < now() - make_interval(days => public.task_media_retention_days())))
         or (th.kind = 'direct'
             and cm.created_at
                 < now() - make_interval(days => public.task_media_retention_days()))
         or (m.message_id is not null
             and m.uploaded_at is null
             and m.created_at < now() - public.chat_media_upload_window())
         or (m.addition_id is not null
             and a.published_at is null
             and m.created_at < now() - public.chat_media_upload_window()))
  order by m.created_at, m.id
  limit greatest(coalesce(p_limit, 200), 1)
$$;

-- ---------- a guest's false task with the office's files on it ----------

-- «Удалить» a false task stays refused once anybody has worked on it; files the office
-- added are work (without this the delete would cascade them away, objects and all).
CREATE OR REPLACE FUNCTION public.mark_signal_false_positive(p_problem_id uuid, p_delete boolean DEFAULT false)
 RETURNS signal_findings
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_problem public.problems;
  v_finding public.signal_findings;
  v_action  text;
begin
  if not public.is_manager() then
    raise exception 'Only a manager decides about findings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;

  -- The signal first, then the finding, then the problem: the order of
  -- approve and reject, so a manager and the job never wait crosswise.
  perform 1 from public.guest_signals g
  where g.id = (select f.signal_id from public.signal_findings f
                where f.problem_id = p_problem_id
                  and f.host_id = public.current_host_id()
                  and (f.status = 'task_created'
                       or (f.status = 'rejected' and f.reject_reason = 'false_positive'))
                order by f.status = 'task_created' desc
                limit 1)
  for update;
  select * into v_finding from public.signal_findings f
  where f.problem_id = p_problem_id
    and f.host_id = public.current_host_id()
    and (f.status = 'task_created' or (f.status = 'rejected' and f.reject_reason = 'false_positive'))
  order by f.status = 'task_created' desc
  limit 1
  for update;
  if not found then
    raise exception 'Problem % was not made from a guest signal', p_problem_id
      using errcode = 'no_data_found', hint = 'serverErrors.signalProblemNotFromSignal';
  end if;
  if v_finding.status = 'rejected' then
    return v_finding;
  end if;

  -- The lock the dispatch levers take (20261003130000).
  select * into v_problem from public.problems
  where id = p_problem_id and host_id = public.current_host_id()
  for no key update;

  if coalesce(p_delete, false) then
    if v_problem.status <> 'open'
       or exists (select 1 from public.tasks t where t.problem_id = p_problem_id)
       or exists (select 1 from public.task_media m where m.problem_id = p_problem_id)
       or exists (select 1 from public.problem_additions a where a.problem_id = p_problem_id)
       or exists (select 1 from public.chat_threads c where c.problem_id = p_problem_id)
       or exists (select 1 from public.signal_findings f
                  where f.problem_id = p_problem_id and f.id <> v_finding.id) then
      raise exception 'Problem % has work on it; it can only be archived', p_problem_id
        using errcode = 'check_violation', hint = 'serverErrors.signalProblemHasWork';
    end if;
    v_action := 'deleted';
  else
    v_action := 'archived';
  end if;

  update public.signal_findings
  set status = 'rejected', reject_reason = 'false_positive', decided_mode = 'manager',
      decided_by = (select auth.uid()), decided_at = now()
  where id = v_finding.id;
  perform public.record_signal_feedback(v_finding.id, 'false_positive', v_action);

  if v_action = 'deleted' then
    -- The finding keeps its verdict; its link goes with the problem (on
    -- delete set null), and so do the problem's own journal rows. Its push
    -- not yet sent stays queued: claim_push_batch settles a problem_new
    -- whose problem is gone as skipped (20261003160000), and this function,
    -- callable by a manager, touches nothing in raw (table_grants.sql).
    delete from public.problems where id = p_problem_id;
  else
    -- As cancel_problem does: a repair left waiting for somebody goes too.
    update public.tasks t
    set status = 'cancelled'
    where t.problem_id = p_problem_id and t.status not in ('done', 'cancelled', 'expired');
    update public.problems
    set status       = case when status in ('open', 'assigned', 'in_progress')
                            then 'cancelled'::public.problem_status else status end,
        cancelled_at = case when status in ('open', 'assigned', 'in_progress')
                            then now() else cancelled_at end,
        archived_at  = coalesce(archived_at, now())
    where id = p_problem_id;
  end if;

  select * into v_finding from public.signal_findings where id = v_finding.id;
  return v_finding;
end;
$function$;
