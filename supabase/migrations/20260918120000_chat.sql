-- F29 layer 1: a conversation about a subject, and one without.
--
-- Until now a manager could say something to a cleaner in three ways and none
-- of them answered back: a note on the listing, a note on the task, and
-- WhatsApp outside the system. The cleaner's only reply was a phone call. A
-- breakage travelled from her to a technician through two tables and not one
-- line of text between the people involved.
--
-- A thread belongs to exactly one subject: a task, a problem, or a member of
-- staff. The XOR is shaped after task_media_one_owner (20260908130100), which
-- is the same idea for the same reason.
--
-- The pair "problem + its repair" has ONE subject and it is the problem. A
-- maintenance task carrying problem_id draws its problem's thread rather than
-- opening one of its own: tasks_one_fix_per_problem permits a cancelled
-- attempt to be replaced, and the conversation must survive that replacement
-- and be waiting for the second technician. The substitution lives in
-- open_thread and nowhere else -- a manual maintenance task without a problem
-- must still have a thread of its own, and a rule restated in the panel, in
-- the phone and in a future notifier is units finding 6.1 word for word.
--
-- Who may read a thread is who may read its subject. That is not the narrow
-- reading and it is deliberate: the task policies are wider than assignment on
-- purpose (a cleaner covers for a colleague without asking the office), and a
-- narrow thread would also leave a manager's note on an UNCLAIMED task with no
-- reader at all -- which is the very case the feature exists for.

create type public.chat_thread_kind as enum ('task', 'problem', 'direct');

comment on type public.chat_thread_kind is
  'What a conversation is about: a job, a breakage, or the member of staff herself.';

create or replace function public.chat_body_max_length()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 4000 $$;

create or replace function public.chat_max_photos()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 4 $$;

revoke all on function public.chat_body_max_length() from public, anon;
revoke all on function public.chat_max_photos() from public, anon;
grant execute on function public.chat_body_max_length() to authenticated, service_role;
grant execute on function public.chat_max_photos() to authenticated, service_role;

-- ---------- the thread ----------

create table public.chat_threads (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid not null default public.default_host_id()
                    references public.hosts(id) on delete restrict,
  kind            public.chat_thread_kind not null,
  task_id         uuid   references public.tasks(id)    on delete cascade,
  problem_id      uuid   references public.problems(id) on delete cascade,
  profile_id      uuid   references public.profiles(id) on delete cascade,
  created_at      timestamptz not null default now(),
  -- Denormalised by the trigger below. "Is there something new for me" is then
  -- a comparison of two dates and no aggregation at all. Never written by hand.
  last_message_at timestamptz,
  last_author_id  uuid references public.profiles(id) on delete set null,
  message_count   integer not null default 0,
  constraint chat_threads_one_subject check (
       (kind = 'task'    and task_id    is not null and problem_id is null and profile_id is null)
    or (kind = 'problem' and problem_id is not null and task_id    is null and profile_id is null)
    or (kind = 'direct'  and profile_id is not null and task_id    is null and problem_id is null))
);

comment on table public.chat_threads is
  'A conversation about a subject: a task, a problem, or a member of staff. A maintenance task that fixes a problem has no thread of its own -- it draws the problem''s (see open_thread).';

create unique index chat_threads_task_idx    on public.chat_threads (task_id)    where task_id    is not null;
create unique index chat_threads_problem_idx on public.chat_threads (problem_id) where problem_id is not null;
create unique index chat_threads_direct_idx  on public.chat_threads (host_id, profile_id) where profile_id is not null;
-- `desc nulls last`, not bare `desc`. In Postgres DESC implies NULLS FIRST,
-- and a list of conversations wants the never-used ones at the BOTTOM: the
-- natural `order by last_message_at desc nulls last` cannot use a bare DESC
-- index at all. Measured on 1500 threads, the difference was 57x.
create index        chat_threads_host_idx    on public.chat_threads (host_id, last_message_at desc nulls last);

-- Dismissing somebody walks this and the one on chat_messages below.
-- Without them it is a sequential scan of the whole transcript.
create index chat_threads_author_idx on public.chat_threads (last_author_id) where last_author_id is not null;

-- ---------- the message ----------

create table public.chat_messages (
  id             uuid primary key,
  host_id        uuid not null default public.default_host_id()
                   references public.hosts(id) on delete restrict,
  thread_id      uuid not null references public.chat_threads(id) on delete cascade,
  author_id      uuid references public.profiles(id) on delete set null,
  -- The name and the role AS THEY WERE. The phone cannot read anyone else's
  -- profile row -- the policies give it its own and nothing more -- so without
  -- these two columns it has nothing to sign a message with. It is also a
  -- transcript: renaming or dismissing somebody does not rewrite what she said.
  author_name    text,
  author_role    public.app_role not null,
  body           text not null default '',
  -- How many files the author DECLARED. The row is written first and the files
  -- follow, exactly as a problem report's photos do, so a message with no words
  -- has to say in advance that pictures are coming -- otherwise an empty bubble
  -- under the word "here" is a legal row. Read it as a declaration, never as
  -- proof, the same way task_media.source is read.
  media_expected smallint not null default 0,
  created_at     timestamptz not null default now(),
  check (length(body) <= public.chat_body_max_length()),
  check (media_expected between 0 and public.chat_max_photos()),
  check (length(btrim(body)) > 0 or media_expected > 0)
);

comment on column public.chat_messages.id is
  'Made on the phone, so a retry after a lost connection is a replay and not a duplicate. Same contract as problems.id.';

create index chat_messages_thread_idx on public.chat_messages (thread_id, created_at, id);
create index chat_messages_author_idx on public.chat_messages (author_id) where author_id is not null;

-- ---------- the read marker ----------

create table public.chat_reads (
  thread_id    uuid not null references public.chat_threads(id) on delete cascade,
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  host_id      uuid not null default public.default_host_id()
                 references public.hosts(id) on delete restrict,
  last_read_at timestamptz not null,
  updated_at   timestamptz not null default now(),
  primary key (thread_id, profile_id)
);

comment on table public.chat_reads is
  'How far each reader has got. A marker on the reader rather than a flag on the message: a work thread has several readers and they cannot even be enumerated -- the audience is derived from the subject''s row security, not stored.';

create index chat_reads_profile_idx on public.chat_reads (profile_id, host_id);

-- ---------- the one place the rule is written ----------

/**
 * Does the caller take part in the conversation about this subject?
 *
 * security definer, and the predicate is SPELLED OUT rather than delegated to
 * the policies on tasks and problems. Delegation would be a hole: a
 * `security invoker` function called from inside a `security definer` one runs
 * as the definer, applies no row security and answers yes to everything. The
 * can_read_task_media trick (20260907160100:203) holds only because a POLICY
 * calls it, and a policy expression is evaluated as the caller.
 *
 * Everything inside is derived from the JWT instead -- auth.uid() reads a GUC
 * and nesting definers does not change it -- so the function is equally safe
 * called from a policy and from an RPC. Both do call it, so they cannot drift.
 *
 * is_manager() comes first in every branch on purpose: for a manager neither
 * cleans_property nor task_is_beyond_horizon is evaluated at all.
 */
create or replace function public.chat_participates(
  p_kind       public.chat_thread_kind,
  p_task_id    uuid,
  p_problem_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $fn$
  -- The caller is read ONCE. A policy calls this, so it runs per row of
  -- chat_threads; the first draft asked is_active_user(), current_host_id() and
  -- is_manager() separately, and each is its own definer call into profiles.
  -- Measured on 1500 threads that was 0.8 ms a row for a manager and 3.9 ms for
  -- a cleaner: a list whose cost grows with the company rather than with what
  -- the reader can actually see.
  with me as (
    select p.id, p.host_id, (p.role in ('manager', 'admin')) as is_manager
    from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  )
  select coalesce((
    select case p_kind
      when 'task' then exists (
        select 1 from public.tasks t
        where t.id = p_task_id
          and t.host_id = me.host_id
          and (me.is_manager
               or (not public.task_is_beyond_horizon(t.property_id, t.scheduled_date)
                   and (t.assignee_id = me.id
                        or public.cleans_property(t.property_id)))))
      when 'problem' then exists (
        select 1 from public.problems pb
        where pb.id = p_problem_id
          and pb.host_id = me.host_id
          and (me.is_manager
               or (pb.archived_at is null
                   and (pb.reported_by = me.id
                        -- The horizon belongs here too, and it is the one place
                        -- being a definer changes the answer. The policy this arm
                        -- reproduces, "fixer reads problems of own tasks", is a
                        -- POLICY expression: its exists() on tasks is row
                        -- filtered as the caller, and the task policies hide a
                        -- repair scheduled past the horizon even from its own
                        -- assignee. Here the same exists() runs as the owner and
                        -- would see it -- leaving a conversation readable whose
                        -- subject is not.
                        or exists (select 1 from public.tasks t
                                   where t.problem_id = pb.id
                                     and t.assignee_id = me.id
                                     -- A cancelled attempt takes the
                                     -- conversation with it (20260918110000).
                                     -- 'done' stays in: whoever finished the
                                     -- repair is still the person to ask.
                                     and t.status not in ('cancelled', 'expired')
                                     and not public.task_is_beyond_horizon(
                                           t.property_id, t.scheduled_date))))))
      when 'direct' then
        exists (select 1 from public.profiles pr
                where pr.id = p_profile_id
                  and pr.host_id = me.host_id
                  -- Field staff only. The company inbox is the office talking to
                  -- whoever goes to the flat; a thread whose subject is a manager
                  -- would be read by every other manager of the host, which is a
                  -- group chat and not an inbox. Manager to manager is out of
                  -- scope (docs/chat-plan.md).
                  and pr.role in ('cleaner', 'tech'))
        -- `pr.is_active` is deliberately NOT tested. Dismissing somebody must not
        -- delete the company's own record of what was said to her: the office
        -- keeps the inbox, and she loses it through `me` above, which requires
        -- the CALLER to be active.
        and (p_profile_id = me.id or me.is_manager)
    end
    from me
  ), false)
  -- coalesce, not a bare case. An unknown kind, or no active profile for the
  -- caller, must answer NO -- and `if not <null>` does not fire, so a null would
  -- walk straight through the gates in open_thread and mark_thread_read.
$fn$;

comment on function public.chat_participates(public.chat_thread_kind, uuid, uuid, uuid) is
  'The audience of a thread is the audience of its subject. The only statement of that rule; the policies and the RPCs both call it.';

revoke all on function public.chat_participates(public.chat_thread_kind, uuid, uuid, uuid)
  from public, anon;
grant execute on function public.chat_participates(public.chat_thread_kind, uuid, uuid, uuid)
  to authenticated, service_role;

-- ---------- the tail of a thread ----------

create or replace function public.chat_touch_thread()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_threads th
  set last_message_at = greatest(coalesce(th.last_message_at, new.created_at), new.created_at),
      -- Guarded like the date beside it: a row that arrives out of order must
      -- not overwrite the name of whoever actually spoke last.
      last_author_id  = case
                          when new.created_at >= coalesce(th.last_message_at, new.created_at)
                          then new.author_id
                          else th.last_author_id
                        end,
      message_count   = th.message_count + 1
  where th.id = new.thread_id;
  return new;
end;
$$;

revoke all on function public.chat_touch_thread() from public, anon;

create trigger chat_messages_touch_thread
  after insert on public.chat_messages
  for each row execute function public.chat_touch_thread();

-- ---------- grants and policies ----------

revoke all on public.chat_threads, public.chat_messages, public.chat_reads
  from anon, authenticated;
grant select on public.chat_threads, public.chat_messages, public.chat_reads
  to authenticated;
grant select, insert, update, delete
  on public.chat_threads, public.chat_messages, public.chat_reads to service_role;

alter table public.chat_threads  enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads    enable row level security;

create policy "staff read threads of subjects they take part in"
  on public.chat_threads for select to authenticated
  using (host_id = public.current_host_id()
         and public.chat_participates(kind, task_id, problem_id, profile_id));

-- Delegation is safe HERE: a policy expression is evaluated as the caller, so
-- the policies on chat_threads are what answer this exists(). The same trick
-- as "problem media is read by whoever reads the problem".
create policy "staff read messages of threads they read"
  on public.chat_messages for select to authenticated
  using (host_id = public.current_host_id()
         and exists (select 1 from public.chat_threads th where th.id = thread_id));

create policy "staff read own read marks"
  on public.chat_reads for select to authenticated
  using (profile_id = (select auth.uid())
         and host_id = public.current_host_id()
         and public.is_active_user());

-- A manager reads the markers as a receipt. "Read at 09:14" is the answer that
-- stands in for a delivery notice until F11 gives us a real one.
create policy "managers read all read marks"
  on public.chat_reads for select to authenticated
  using (public.is_manager() and host_id = public.current_host_id());

-- ---------- opening a thread ----------

/**
 * Find or open the thread of a subject. Replayable: the same subject answers
 * with the same row.
 *
 * Exactly one of the three arguments is given. A maintenance task that fixes a
 * problem gets the PROBLEM's thread: the subject of the conversation is the
 * breakage, and a cancelled repair must not take the conversation with it.
 *
 * A thread the caller may not read is reported as not found rather than as
 * forbidden -- someone else's conversation should not be distinguishable from
 * one that does not exist.
 */
create or replace function public.open_thread(
  p_task_id    uuid default null,
  p_problem_id uuid default null,
  p_profile_id uuid default null
)
returns public.chat_threads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind       public.chat_thread_kind;
  v_task_id    uuid := p_task_id;
  v_problem_id uuid := p_problem_id;
  v_thread     public.chat_threads;
  v_given      integer;
begin
  v_given := (case when p_task_id is null then 0 else 1 end)
           + (case when p_problem_id is null then 0 else 1 end)
           + (case when p_profile_id is null then 0 else 1 end);
  if v_given <> 1 then
    raise exception 'A thread is about exactly one subject'
      using errcode = 'check_violation', hint = 'serverErrors.threadSubjectInvalid';
  end if;

  if v_task_id is not null then
    -- The repair of a breakage speaks in the breakage's thread.
    select t.problem_id into v_problem_id
    from public.tasks t
    where t.id = v_task_id and t.host_id = public.current_host_id();
    if v_problem_id is not null then
      v_task_id := null;
    end if;
  end if;

  v_kind := case
    when v_task_id    is not null then 'task'
    when v_problem_id is not null then 'problem'
    else 'direct'
  end;

  if not public.chat_participates(v_kind, v_task_id, v_problem_id, p_profile_id) then
    raise exception 'Thread not found'
      using errcode = 'check_violation', hint = 'serverErrors.threadNotFound';
  end if;

  select th.* into v_thread
  from public.chat_threads th
  where th.host_id = public.current_host_id()
    and th.kind = v_kind
    and th.task_id    is not distinct from v_task_id
    and th.problem_id is not distinct from v_problem_id
    and th.profile_id is not distinct from p_profile_id;
  if found then
    return v_thread;
  end if;

  -- Two managers opening the same card at once both reach here; the partial
  -- unique indexes decide, and the loser re-reads rather than failing.
  insert into public.chat_threads (host_id, kind, task_id, problem_id, profile_id)
  values (public.current_host_id(), v_kind, v_task_id, v_problem_id, p_profile_id)
  on conflict do nothing
  returning * into v_thread;
  if found then
    return v_thread;
  end if;

  select th.* into v_thread
  from public.chat_threads th
  where th.host_id = public.current_host_id()
    and th.kind = v_kind
    and th.task_id    is not distinct from v_task_id
    and th.problem_id is not distinct from v_problem_id
    and th.profile_id is not distinct from p_profile_id;

  -- A composite variable that was never assigned is a ROW OF NULLS, not null,
  -- so a caller would cheerfully build a message on top of it. If we reach here
  -- with nothing, say so.
  if v_thread.id is null then
    raise exception 'Thread not found'
      using errcode = 'check_violation', hint = 'serverErrors.threadNotFound';
  end if;

  return v_thread;
end;
$$;

revoke all on function public.open_thread(uuid, uuid, uuid) from public, anon;
grant execute on function public.open_thread(uuid, uuid, uuid) to authenticated, service_role;

-- ---------- saying something ----------

/**
 * Say something. Replayable: the same id answers with the same row.
 *
 * Sending is also reading. Without moving the author's own marker the formula
 * "newer than my marker and not written by me" gets the sequence
 * me -> her -> me wrong: the last author is me again, and her message is lost
 * behind my own. With the marker moved, unread is a plain comparison of two
 * dates.
 */
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
  returning * into v_message;

  insert into public.chat_reads (thread_id, profile_id, host_id, last_read_at)
  values (v_thread.id, (select auth.uid()), v_thread.host_id, v_message.created_at)
  on conflict (thread_id, profile_id) do update
    set last_read_at = greatest(public.chat_reads.last_read_at, excluded.last_read_at),
        updated_at   = now();

  return v_message;
end;
$$;

revoke all on function public.send_message(uuid, text, uuid, uuid, uuid, smallint)
  from public, anon;
grant execute on function public.send_message(uuid, text, uuid, uuid, uuid, smallint)
  to authenticated, service_role;

-- ---------- marking read ----------

/**
 * Mark read up to a point. The marker never walks backwards.
 *
 * The caller passes the timestamp of the newest message it actually DREW, so
 * opening a thread marks read what was shown rather than everything that
 * exists. `greatest` makes a late replay harmless: it can never un-read.
 */
create or replace function public.mark_thread_read(
  p_thread_id uuid,
  p_up_to     timestamptz default null
)
returns public.chat_reads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread public.chat_threads;
  v_mark   public.chat_reads;
  v_up_to  timestamptz;
begin
  select th.* into v_thread
  from public.chat_threads th
  where th.id = p_thread_id and th.host_id = public.current_host_id();
  if not found
     or not public.chat_participates(v_thread.kind, v_thread.task_id,
                                     v_thread.problem_id, v_thread.profile_id) then
    raise exception 'Thread not found'
      using errcode = 'check_violation', hint = 'serverErrors.threadNotFound';
  end if;

  v_up_to := least(coalesce(p_up_to, now()), now());

  insert into public.chat_reads (thread_id, profile_id, host_id, last_read_at)
  values (v_thread.id, (select auth.uid()), v_thread.host_id, v_up_to)
  on conflict (thread_id, profile_id) do update
    set last_read_at = greatest(public.chat_reads.last_read_at, excluded.last_read_at),
        updated_at   = now()
  returning * into v_mark;

  return v_mark;
end;
$$;

revoke all on function public.mark_thread_read(uuid, timestamptz) from public, anon;
grant execute on function public.mark_thread_read(uuid, timestamptz)
  to authenticated, service_role;
