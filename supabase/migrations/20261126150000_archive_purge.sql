-- Deleting for good what is in an archive (owner, 2026-11-26, CORE; docs/manager-boards.md
-- «Удаление навсегда»).
--
-- «Админ может удалять всё из всех архивов»: an admin of the company deletes, after a question in
-- the panel, what sits in an archive — nothing live, nothing of another company:
--
-- - an archived manager board, whole: its cards in any state, their steps and journals, its
--   columns and its transfers (delete_archived_board);
-- - an archived or soft-deleted card of a manager board, with its steps and journal
--   (delete_shelved_board_card);
-- - an archived task (problems.archived_at set) with everything hanging on it
--   (delete_archived_problem): its repairs (tasks of type maintenance naming it) with their steps,
--   journals, closings, marks, take-off notes and conversations; its own journal, conversations,
--   additions, themes, facts and closing marks; the media rows of all of it AND their files.
--
-- What stays, by the foreign keys' own rule (on delete set null): a guest's finding that made the
-- task (signal_findings.problem_id — the verdict is kept), a plan's step linked to it
-- (resolution_plan_steps.linked_problem_id), a supply request made during a repair
-- (supply_requests.task_id), another task reported during a repair (problems.task_id) and a line
-- of another task's journal naming a repair (problem_events.task_id). Analytics reads the live
-- tables: it simply loses the rows. A push not yet sent about a deleted card, board or task is
-- settled as skipped by send-push and claim_push_batch (they read the subject at the send); the
-- push rows of a repair and of its conversations go with them (raw.push_outbox, on delete cascade).
--
-- The files. A file in task-media never exists without its task_media row (CLAUDE.md «строка
-- раньше файла»), clients never delete objects, and SQL cannot (storage.protect_delete). So a
-- task_media row deleted before its file was purged leaves its path in a server-only queue,
-- raw.task_media_orphans, by a trigger on the table (any delete, whatever cascade brought it), and
-- the nightly purge-task-media removes those files like any other due file: task_media_to_purge
-- answers the queued rows too, in the shape of the row that was deleted, and mark_task_media_purged
-- drops them from the queue once their files are gone. The Edge function does not change (it reads
-- only id and storage_path). A queued file is unreadable from the moment its row is gone: the
-- bucket's policies read through the row.
--
-- Rights: admin only (auth_role() = 'admin': an active admin), in the caller's company. A live
-- item is refused with an i18n key; an id that is gone — deleted already, or never the company's
-- — answers false and deletes nothing, so a repeat is harmless. API v1 has none of it (forbidden
-- data:destroy): internal in coverage.json.
--
-- Additive: one table in raw, one trigger, three functions; task_media_to_purge and
-- mark_task_media_purged keep their signatures and grants. Rollback:
-- docs/one-off-writes/archive-purge-rollback.sql (deleted data does not come back).

set local lock_timeout = '3s';

-- ---------- the files of media rows deleted for good ----------

create table raw.task_media_orphans (
  -- The deleted task_media row's id: purge-task-media marks by it.
  id           uuid primary key,
  host_id      uuid not null,
  storage_path text not null,
  -- The row as it was: task_media_to_purge answers it in the shape of task_media.
  media        jsonb not null,
  orphaned_at  timestamptz not null default now()
);

comment on table raw.task_media_orphans is
  'Files in task-media whose task_media row was deleted before they were purged: the nightly '
  'purge-task-media removes them, then the row goes (20261126150000). Server only.';

revoke all on raw.task_media_orphans from public, anon, authenticated;

/** A task_media row deleted with its file still in the bucket: its path goes to the purge. */
create function public.queue_orphaned_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into raw.task_media_orphans (id, host_id, storage_path, media)
  values (old.id, old.host_id, old.storage_path, to_jsonb(old))
  on conflict (id) do nothing;
  return null;
end;
$$;

comment on function public.queue_orphaned_media() is
  'Trigger: the file of a task_media row deleted before its purge waits in raw.task_media_orphans '
  'for purge-task-media (20261126150000).';

revoke all on function public.queue_orphaned_media() from public, anon, authenticated, service_role;

create trigger task_media_queue_orphan
  after delete on public.task_media
  for each row
  when (old.purged_at is null)
  execute function public.queue_orphaned_media();

-- As in 20261126100000, and the queue: the files of rows deleted for good, as their rows were,
-- unless a live row holds the same path (storage_path is unique: it cannot, but a file a row
-- holds is never the queue's).
create or replace function public.task_media_to_purge(p_limit integer default 200)
returns setof public.task_media
language sql
stable
security definer
set search_path = ''
as $$
  select due.*
  from (
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
    union all
    select r.*
    from raw.task_media_orphans q
    cross join lateral jsonb_populate_record(null::public.task_media, q.media) r
    where not exists (select 1 from public.task_media live where live.storage_path = q.storage_path)
  ) due
  order by due.created_at, due.id
  limit greatest(coalesce(p_limit, 200), 1)
$$;

/**
 * As in 20260907160200, and the queue: a deleted row's file is gone, so its line goes. Returns how
 * many rows it settled, marked and dropped together.
 */
create or replace function public.mark_task_media_purged(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count   integer;
  v_orphans integer;
begin
  update public.task_media m
  set purged_at = now()
  where m.id = any (p_ids) and m.purged_at is null;
  get diagnostics v_count = row_count;

  delete from raw.task_media_orphans q
  where q.id = any (p_ids);
  get diagnostics v_orphans = row_count;

  return v_count + v_orphans;
end;
$$;

-- ---------- a manager board from the archive of boards ----------

/**
 * Deletes an archived manager board for good, with every card on it (any state), their steps and
 * journals, its columns and its transfers. An admin of the company only; a live board is refused;
 * an id that is gone answers false. The board is taken for update first: the order of every write
 * of the boards is the board, then its cards.
 */
create function public.delete_archived_board(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.manager_boards;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Only an admin may delete for good'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.archivePurgeAdminOnly';
  end if;

  select b.* into v_board
  from public.manager_boards b
  where b.id = p_id and b.host_id = public.current_host_id()
  for update;
  if not found then
    return false;
  end if;
  if v_board.archived_at is null then
    raise exception 'Board % is not archived', p_id
      using errcode = 'check_violation', hint = 'serverErrors.boardNotArchived';
  end if;

  delete from public.manager_board_entries e
  using public.manager_board_cards c
  where e.card_id = c.id and c.board_id = p_id;
  delete from public.manager_board_steps s
  using public.manager_board_cards c
  where s.card_id = c.id and c.board_id = p_id;
  delete from public.manager_board_cards c where c.board_id = p_id;
  delete from public.manager_board_columns c where c.board_id = p_id;
  delete from public.manager_board_transfers t where t.board_id = p_id;
  delete from public.manager_boards b where b.id = p_id;
  return true;
end;
$$;

comment on function public.delete_archived_board(uuid) is
  'An admin deletes an archived manager board for good, with its cards, steps, journals, columns '
  'and transfers; a live board is refused, a gone id answers false (20261126150000).';

-- ---------- a card from a board's archive ----------

/**
 * Deletes for good a card of a manager board that is archived or soft-deleted, with its steps and
 * journal. An admin of the company only, on any board he sees (an admin sees all); a card on the
 * board is refused; an id that is gone answers false. The board for share, then the card for
 * update — the order of every write of the boards.
 */
create function public.delete_shelved_board_card(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board_id uuid;
  v_card     public.manager_board_cards;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Only an admin may delete for good'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.archivePurgeAdminOnly';
  end if;

  select c.board_id into v_board_id
  from public.manager_board_cards c
  where c.id = p_id and c.host_id = public.current_host_id();
  if not found then
    return false;
  end if;

  perform 1 from public.manager_boards b where b.id = v_board_id for share;
  select c.* into v_card
  from public.manager_board_cards c
  where c.id = p_id
  for update;
  if not found then
    -- Deleted while this call waited, with its board or alone.
    return false;
  end if;
  if v_card.archived_at is null and v_card.deleted_at is null then
    raise exception 'Card % is neither archived nor deleted', p_id
      using errcode = 'check_violation', hint = 'serverErrors.boardCardNotShelved';
  end if;

  delete from public.manager_board_entries e where e.card_id = p_id;
  delete from public.manager_board_steps s where s.card_id = p_id;
  delete from public.manager_board_cards c where c.id = p_id;
  return true;
end;
$$;

comment on function public.delete_shelved_board_card(uuid) is
  'An admin deletes an archived or soft-deleted manager board card for good, with its steps and '
  'journal; a card on the board is refused, a gone id answers false (20261126150000).';

-- ---------- a task from the archive of «Задания» ----------

/**
 * Deletes an archived task for good with everything hanging on it. Its repairs go first (their
 * link to the task is on delete set null, so they would stay otherwise): their steps, media,
 * journals, closings, marks, take-off notes, conversations and push rows follow by cascade, and
 * the mirror of the task's status leaves an archived task alone. Then the task: its journal,
 * conversations, media, additions, themes, facts and closing marks follow by cascade. Every media
 * row deleted before its purge queues its file (task_media_queue_orphan). An admin of the company
 * only; a task not in the archive is refused; an id that is gone answers false.
 */
create function public.delete_archived_problem(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Only an admin may delete for good'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.archivePurgeAdminOnly';
  end if;

  select p.* into v_problem
  from public.problems p
  where p.id = p_id and p.host_id = public.current_host_id()
  for update;
  if not found then
    return false;
  end if;
  if v_problem.archived_at is null then
    raise exception 'Problem % is not archived', p_id
      using errcode = 'check_violation', hint = 'serverErrors.problemNotArchived';
  end if;

  delete from public.tasks t
  where t.problem_id = p_id
    and t.host_id = v_problem.host_id
    and t.type = 'maintenance';
  delete from public.problems p where p.id = p_id;
  return true;
end;
$$;

comment on function public.delete_archived_problem(uuid) is
  'An admin deletes an archived task (problem) for good, with its repairs and everything hanging '
  'on both; files are queued for purge-task-media; a task not archived is refused, a gone id '
  'answers false (20261126150000).';

revoke all on function public.delete_archived_board(uuid) from public, anon, authenticated, service_role;
revoke all on function public.delete_shelved_board_card(uuid) from public, anon, authenticated, service_role;
revoke all on function public.delete_archived_problem(uuid) from public, anon, authenticated, service_role;
grant execute on function public.delete_archived_board(uuid) to authenticated;
grant execute on function public.delete_shelved_board_card(uuid) to authenticated;
grant execute on function public.delete_archived_problem(uuid) to authenticated;
