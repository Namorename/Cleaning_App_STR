-- Manager boards: who sees a board, its own columns, and handing it over (owner, 2026-11-26,
-- CORE; docs/manager-boards.md, «Этап 4»).
--
-- Visibility. A board is either its owner's alone or shared with the other managers
-- (manager_boards.shared). A new board is its owner's alone unless its maker says otherwise; the
-- owner and an admin change that later. An admin sees every board. A board not shared is not
-- read by another manager at all — not in a list, not by its id — and no function reaches it for
-- him. One exception: a card on such a board given to another manager is read and worked by him
-- (its fields, column, steps and journal), the board itself and its other cards are not; its
-- columns are read so the card can stand and move in one. A shared board keeps the rules of
-- 20261119090000.
--
-- Existing boards keep being shared when this migration runs (the column's first default is
-- true); the owner's one-off write docs/one-off-writes/manager-boards-private.sql makes them
-- their owners' alone afterwards, with its rollback. New boards default to their owner's alone.
--
-- Columns. Every board has its own columns (manager_board_columns): a new board gets the four of
-- the technicians' board, by the same names — a column made that way carries its preset key and
-- no title of its own, so each person reads its name in their language — and its owner and an
-- admin add, rename, order, mark as finishing and delete columns. Up to 12 live columns, a title
-- of 1..40 characters; the last column is never deleted; a column holding cards is deleted only
-- with a column the cards move to, each with the usual «moved» line in its journal. A deleted
-- column stays as a row (deleted_at), so the journal still names it.
--
-- The four keys stay. Older phones and panels read a card's column_key and move cards by the four
-- keys; manager_board_cards.column_key keeps one of them, the stage of the card's column:
-- a finishing column is 'resolved'; of the other live columns in order, the first is 'open', the
-- last (of two or more) 'in_progress', any between 'assigned'. A board of the four presets reads
-- exactly as before. A move or a new card by a key lands in the board's first column of that stage,
-- else the nearest stage; a move to the stage the card already stands in changes nothing. A trigger
-- keeps column_key and column_id agreeing on every insert and update, whatever function wrote it.
--
-- Handing a board over. Its owner or an admin hands it to another active manager or admin of the
-- company (transfer_manager_board): he becomes its owner; cards, their assignees and the board's
-- visibility stay as they are, and a new card is the new owner's by the rule of 20261118230000.
-- The fact — who, to whom, by whom, when — is a row of manager_board_transfers, no words; its
-- trigger sends the new owner one push (board_transferred), send-push reads the board's title
-- when it sends (push_board_titles).
--
-- Words: titles of columns live in manager_board_columns, of boards in manager_boards; the journal
-- and the push queue carry ids, codes and counts only.
--
-- Additive: a column of boards (default true for what exists), a table of columns filled for every
-- board (four presets each, cards bound by their key), a column of cards, a table of transfers, a
-- push kind; the four read policies narrow; three functions gain an argument with the default
-- «nothing said» (save_manager_board, save_manager_card, move_manager_card); new functions for
-- columns and the transfer.

set local lock_timeout = '3s';

-- ===================================================================
-- Visibility
-- ===================================================================

alter table public.manager_boards add column shared boolean not null default true;
-- What exists keeps being read by the office; a board made from now on is its owner's alone.
alter table public.manager_boards alter column shared set default false;

comment on column public.manager_boards.shared is
  'Read by the other managers of the company too (true), or by its owner and the admins alone (20261126120000).';

-- ===================================================================
-- Columns
-- ===================================================================

create table public.manager_board_columns (
  -- Minted by the client for a column it adds; by the server for a board's first four.
  id          uuid primary key,
  host_id     uuid not null references public.hosts (id) on delete restrict,
  board_id    uuid not null references public.manager_boards (id) on delete restrict,
  -- The name people gave it; null for a preset column nobody renamed, read in the reader's
  -- language from its preset (problems.statuses.*).
  title       text
              constraint manager_board_columns_title_length
              check (title is null or char_length(btrim(title)) between 1 and 40),
  preset      text
              constraint manager_board_columns_preset_known
              check (preset in ('open', 'assigned', 'in_progress', 'resolved')),
  position    integer not null,
  is_done     boolean not null default false,
  -- The stage older clients read the card by (see the head of this file), kept by the server.
  legacy_key  text not null
              constraint manager_board_columns_legacy_known
              check (legacy_key in ('open', 'assigned', 'in_progress', 'resolved')),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id) on delete set null,
  constraint manager_board_columns_named check (title is not null or preset is not null)
);

comment on table public.manager_board_columns is
  'The columns of a manager board, in order, some finishing (20261126120000). Changed by the '
  'board''s owner and an admin through the column functions; deleted softly.';

create index manager_board_columns_board_idx on public.manager_board_columns (board_id, position)
  where deleted_at is null;

/**
 * A new board's columns: the four of the technicians' board, the last finishing, whoever inserts
 * the board (save_manager_board, a one-off write).
 */
create function public.manager_boards_first_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.manager_board_columns
    (id, host_id, board_id, title, preset, position, is_done, legacy_key, created_by)
  select gen_random_uuid(), new.host_id, new.id, null, k.key, k.n, k.key = 'resolved', k.key,
         new.owner_id
  from (values ('open', 1), ('assigned', 2), ('in_progress', 3), ('resolved', 4)) k(key, n);
  return null;
end;
$$;

comment on function public.manager_boards_first_columns() is
  'Trigger: a new manager board gets the four columns of the technicians'' board (20261126120000).';

-- Every board as it stands: the four columns of the technicians' board, its cards in them by key.
insert into public.manager_board_columns
  (id, host_id, board_id, title, preset, position, is_done, legacy_key, created_by, created_at,
   updated_at)
select gen_random_uuid(), b.host_id, b.id, null, k.key, k.n, k.key = 'resolved', k.key,
       b.owner_id, b.created_at, b.created_at
from public.manager_boards b
cross join (values ('open', 1), ('assigned', 2), ('in_progress', 3), ('resolved', 4)) k(key, n);

alter table public.manager_board_cards
  add column column_id uuid references public.manager_board_columns (id) on delete restrict;

update public.manager_board_cards c
set column_id = col.id
from public.manager_board_columns col
where col.board_id = c.board_id and col.legacy_key = c.column_key;

-- Every card stands in a column: the trigger below fills it for a writer that names a key only.
alter table public.manager_board_cards alter column column_id set not null;

comment on column public.manager_board_cards.column_id is
  'The card''s column on its board (20261126120000); column_key keeps the stage of that column '
  'for older clients.';

create index manager_board_cards_column_idx on public.manager_board_cards (column_id);

create trigger manager_boards_first_columns
  after insert on public.manager_boards
  for each row execute function public.manager_boards_first_columns();

-- ===================================================================
-- Transfers
-- ===================================================================

create table public.manager_board_transfers (
  id         uuid primary key default gen_random_uuid(),
  host_id    uuid not null references public.hosts (id) on delete restrict,
  board_id   uuid not null references public.manager_boards (id) on delete restrict,
  from_id    uuid references public.profiles (id) on delete set null,
  to_id      uuid references public.profiles (id) on delete set null,
  by_id      uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

comment on table public.manager_board_transfers is
  'A manager board handed to a new owner: who had it, who got it, who did it, when — no words '
  '(20261126120000). Written by transfer_manager_board; read by the server only.';

create index manager_board_transfers_board_idx on public.manager_board_transfers (board_id, created_at);

-- Beside the card's push, before problem_new, which sits right before the conversation (head_tech_push.sql).
alter type public.push_kind add value if not exists 'board_transferred' before 'problem_new';

-- ===================================================================
-- Reading
-- ===================================================================

alter table public.manager_board_columns enable row level security;
alter table public.manager_board_transfers enable row level security;

revoke all on public.manager_board_columns, public.manager_board_transfers
  from public, anon, authenticated, service_role;
grant select on public.manager_board_columns to authenticated, service_role;
grant select on public.manager_board_transfers to service_role;

/** The board is the caller's to see: shared with the office, his own, or he is an admin. */
create function public.manager_board_visible(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.manager_boards b
    where b.id = p_board_id
      and b.host_id = public.current_host_id()
      and (b.shared or b.owner_id = (select auth.uid()) or public.auth_role() = 'admin'))
$$;

comment on function public.manager_board_visible(uuid) is
  'Whether the caller sees the board: shared, his own, or he is an admin (20261126120000). Read '
  'policies and the board functions.';

/**
 * The card is the caller's to read: its board is his to see, or the card is his and the board not
 * archived (a card given to him on a board that is not).
 */
create function public.manager_card_readable(p_board_id uuid, p_assignee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.manager_board_visible(p_board_id)
      or (p_assignee_id = (select auth.uid())
          and exists (select 1 from public.manager_boards b
                      where b.id = p_board_id and b.archived_at is null))
$$;

comment on function public.manager_card_readable(uuid, uuid) is
  'Whether the caller reads a card: its board is his to see, or the card is given to him on a live '
  'board (20261126120000). The read policies of cards, steps and journals.';

/** The board's columns are the caller's to read: the board is, or a card on it is given to him. */
create function public.manager_board_columns_readable(p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.manager_board_visible(p_board_id)
      or exists (select 1
                 from public.manager_board_cards c
                 join public.manager_boards b on b.id = c.board_id
                 where c.board_id = p_board_id
                   and c.assignee_id = (select auth.uid())
                   and b.archived_at is null)
$$;

comment on function public.manager_board_columns_readable(uuid) is
  'Whether the caller reads a board''s columns: the board is his to see, or a card on it is given '
  'to him (20261126120000).';

alter policy "the office reads the company's boards" on public.manager_boards
  using ((select public.is_full_manager()) and host_id = (select public.current_host_id())
         and (shared or owner_id = (select auth.uid()) or (select public.auth_role()) = 'admin'));
alter policy "the office reads the company's board cards" on public.manager_board_cards
  using ((select public.is_full_manager()) and host_id = (select public.current_host_id())
         and public.manager_card_readable(board_id, assignee_id));
alter policy "the office reads the company's board steps" on public.manager_board_steps
  using ((select public.is_full_manager()) and host_id = (select public.current_host_id())
         and exists (select 1 from public.manager_board_cards c
                     where c.id = card_id and public.manager_card_readable(c.board_id, c.assignee_id)));
alter policy "the office reads the company's board journals" on public.manager_board_entries
  using ((select public.is_full_manager()) and host_id = (select public.current_host_id())
         and exists (select 1 from public.manager_board_cards c
                     where c.id = card_id and public.manager_card_readable(c.board_id, c.assignee_id)));

create policy "the office reads the columns of the boards it sees"
  on public.manager_board_columns for select
  to authenticated
  using ((select public.is_full_manager()) and host_id = (select public.current_host_id())
         and public.manager_board_columns_readable(board_id));

-- ===================================================================
-- Columns and their four keys, internal
-- ===================================================================

/**
 * The column a writer that names one of the four keys means: the board's first live column of
 * that stage, else of the nearest stage (the earlier column on a tie). Never null for a board
 * with a live column. Internal.
 */
create function public.manager_board_column_for(p_board_id uuid, p_key text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select col.id
  from public.manager_board_columns col
  where col.board_id = p_board_id and col.deleted_at is null
  order by abs(array_position(array['open', 'assigned', 'in_progress', 'resolved'], col.legacy_key)
               - array_position(array['open', 'assigned', 'in_progress', 'resolved'], p_key)),
           col.position, col.created_at, col.id
  limit 1
$$;

comment on function public.manager_board_column_for(uuid, text) is
  'Internal: the column of a board one of the four keys lands in (20261126120000).';

/**
 * The four keys of a board's live columns after a change of its columns, and its cards' keys
 * with them: a finishing column is 'resolved'; of the others in order the first is 'open', the
 * last of two or more 'in_progress', any between 'assigned'. Internal.
 */
create function public.manager_board_relabel(p_board_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  with live as (
    select col.id, col.is_done,
           row_number() over (partition by col.is_done order by col.position, col.created_at, col.id) as n,
           count(*) over (partition by col.is_done) as total
    from public.manager_board_columns col
    where col.board_id = p_board_id and col.deleted_at is null
  ), keyed as (
    select live.id,
           case when live.is_done then 'resolved'
                when live.n = 1 then 'open'
                when live.n = live.total then 'in_progress'
                else 'assigned' end as key
    from live
  )
  update public.manager_board_columns col
  set legacy_key = keyed.key, updated_at = now()
  from keyed
  where col.id = keyed.id and col.legacy_key is distinct from keyed.key;

  update public.manager_board_cards c
  set column_key = col.legacy_key
  from public.manager_board_columns col
  where col.id = c.column_id and c.board_id = p_board_id and c.column_key is distinct from col.legacy_key;
end;
$$;

comment on function public.manager_board_relabel(uuid) is
  'Internal: the four keys of a board''s columns and cards after its columns change (20261126120000).';

/**
 * Keeps a card's column and key agreeing, whoever writes the row: a writer that names a key only
 * (an older client, a copy) lands in the board's column of that stage; a key that already is the
 * stage of the card's column moves nothing; a column names the key. The column must be a live
 * column of the card's board.
 */
create function public.manager_board_cards_column()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_key text;
begin
  if tg_op = 'INSERT' then
    if new.column_id is null then
      new.column_id := public.manager_board_column_for(new.board_id, new.column_key);
    end if;
  elsif new.column_id is not distinct from old.column_id
        and new.column_key is distinct from old.column_key then
    select col.legacy_key into v_key
    from public.manager_board_columns col where col.id = new.column_id;
    if v_key is distinct from new.column_key then
      new.column_id := public.manager_board_column_for(new.board_id, new.column_key);
    end if;
  end if;

  select col.legacy_key into v_key
  from public.manager_board_columns col
  where col.id = new.column_id and col.board_id = new.board_id and col.deleted_at is null;
  if not found then
    raise exception 'Column % is not a column of board %', new.column_id, new.board_id
      using errcode = 'check_violation', hint = 'serverErrors.boardColumnUnknown';
  end if;
  new.column_key := v_key;
  return new;
end;
$$;

comment on function public.manager_board_cards_column() is
  'Trigger: a manager board card''s column and its key agree (20261126120000).';

create trigger manager_board_cards_column
  before insert or update of column_id, column_key, board_id on public.manager_board_cards
  for each row execute function public.manager_board_cards_column();

/** The column a column function works on, with its board locked as manager_board_for_edit has it. */
create function public.manager_column_for_edit(p_column_id uuid)
returns public.manager_board_columns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board_id uuid;
  v_column   public.manager_board_columns;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  select col.board_id into v_board_id
  from public.manager_board_columns col
  where col.id = p_column_id and col.host_id = public.current_host_id() and col.deleted_at is null;
  if not found then
    raise exception 'Column % not found', p_column_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardColumnNotFound';
  end if;
  -- The board first, for update: column changes of one board queue whole.
  perform 1 from public.manager_boards b where b.id = v_board_id for update;
  perform public.manager_board_for_edit(v_board_id, false);
  select col.* into v_column from public.manager_board_columns col where col.id = p_column_id;
  if v_column.deleted_at is not null then
    raise exception 'Column % not found', p_column_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardColumnNotFound';
  end if;
  return v_column;
end;
$$;

comment on function public.manager_column_for_edit(uuid) is
  'Internal: the column the caller may change, its board locked (20261126120000).';

-- ===================================================================
-- The rights, after visibility
-- ===================================================================

/**
 * The board the caller works on the cards of: any manager or admin of the company who sees it
 * (shared, his own, or an admin), the board not archived. A board he does not see is not found.
 */
create or replace function public.manager_board_for_cards(p_board_id uuid)
returns public.manager_boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.manager_boards;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select b.* into v_board
  from public.manager_boards b
  where b.id = p_board_id
    and b.host_id = public.current_host_id()
  for share;

  if not found or not public.manager_board_visible(p_board_id) then
    raise exception 'Board % not found', p_board_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardNotFound';
  end if;
  if v_board.archived_at is not null then
    raise exception 'Board % is archived', p_board_id
      using errcode = 'check_violation', hint = 'serverErrors.boardArchived';
  end if;
  return v_board;
end;
$$;

/**
 * The board the caller may change, locked against an archive meanwhile: its owner or an admin. A
 * board he does not see is not found; an archived board is changed by nothing but its return,
 * unless the caller says it may be archived. Internal.
 */
create or replace function public.manager_board_for_edit(p_board_id uuid, p_archived_ok boolean)
returns public.manager_boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.manager_boards;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select b.* into v_board
  from public.manager_boards b
  where b.id = p_board_id
    and b.host_id = public.current_host_id()
  for share;

  if not found or not public.manager_board_visible(p_board_id) then
    raise exception 'Board % not found', p_board_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardNotFound';
  end if;
  if v_board.owner_id is distinct from (select auth.uid())
     and public.auth_role() is distinct from 'admin' then
    raise exception 'Only the owner of board % or an admin may change it', p_board_id
      using errcode = 'insufficient_privilege', hint = 'serverErrors.boardNotYours';
  end if;
  if v_board.archived_at is not null and not p_archived_ok then
    raise exception 'Board % is archived', p_board_id
      using errcode = 'check_violation', hint = 'serverErrors.boardArchived';
  end if;
  return v_board;
end;
$$;

/**
 * The card the caller may change, locked. On a board he sees: any manager or admin, the board not
 * archived (20261119090000). On a board he does not see: only the card's assignee, and only for
 * the work on the card — its fields, column, steps and journal (p_shelved_ok false); archiving,
 * deleting, returning, copying and assigning it (p_shelved_ok true) stay with those who see the
 * board. Not archived and not deleted, unless the caller says it may be shelved. Internal.
 */
create or replace function public.manager_card_for_edit(p_card_id uuid, p_shelved_ok boolean)
returns public.manager_board_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board_id    uuid;
  v_assignee_id uuid;
  v_archived_at timestamptz;
  v_seen        boolean;
  v_card        public.manager_board_cards;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select c.board_id, c.assignee_id into v_board_id, v_assignee_id
  from public.manager_board_cards c
  where c.id = p_card_id
    and c.host_id = public.current_host_id();

  if not found then
    raise exception 'Card % not found', p_card_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardCardNotFound';
  end if;

  v_seen := public.manager_board_visible(v_board_id);
  if v_seen then
    perform public.manager_board_for_cards(v_board_id);
  elsif v_assignee_id is not distinct from (select auth.uid()) and not p_shelved_ok then
    -- The card given to him on a board he does not see: the same lock and archive rule.
    select b.archived_at into v_archived_at
    from public.manager_boards b
    where b.id = v_board_id
    for share;
    if v_archived_at is not null then
      raise exception 'Board % is archived', v_board_id
        using errcode = 'check_violation', hint = 'serverErrors.boardArchived';
    end if;
  else
    raise exception 'Card % not found', p_card_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardCardNotFound';
  end if;

  select c.* into v_card
  from public.manager_board_cards c
  where c.id = p_card_id
  for update;

  if not v_seen and v_card.assignee_id is distinct from (select auth.uid()) then
    -- Taken from him while he waited for the lock.
    raise exception 'Card % not found', p_card_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardCardNotFound';
  end if;
  if (v_card.archived_at is not null or v_card.deleted_at is not null) and not p_shelved_ok then
    raise exception 'Card % is archived or deleted', p_card_id
      using errcode = 'check_violation', hint = 'serverErrors.boardCardShelved';
  end if;
  return v_card;
end;
$$;

-- ===================================================================
-- Boards
-- ===================================================================

drop function public.save_manager_board(uuid, text);

/**
 * Creates the board with the client's id, its owner the caller and its four columns, or renames
 * it. p_shared: null says nothing — a new board is then its owner's alone, a rename leaves it;
 * true or false makes it shared or not (on a rename, the owner's or an admin's). A repeat of the
 * first save answers the same board. Any manager or admin creates one; the owner and an admin
 * rename it.
 */
create function public.save_manager_board(p_id uuid, p_title text, p_shared boolean default null)
returns public.manager_boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''), E' \t\r\n');
  v_board public.manager_boards;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if p_id is null then
    raise exception 'A board needs an id' using errcode = 'invalid_parameter_value', hint = 'serverErrors.unknown';
  end if;
  if char_length(v_title) not between 1 and 80 then
    raise exception 'A board needs a title of up to 80 characters'
      using errcode = 'check_violation', hint = 'serverErrors.boardTitleInvalid',
            detail = jsonb_build_object('max', 80)::text;
  end if;

  -- A board of another company with this id is not found: the insert does nothing, and the
  -- rights below look in the caller's company only.
  insert into public.manager_boards (id, host_id, title, owner_id, shared)
  values (p_id, public.current_host_id(), v_title, (select auth.uid()), coalesce(p_shared, false))
  on conflict (id) do nothing
  returning * into v_board;

  if v_board.id is not null then
    -- Its four columns came with it (manager_boards_first_columns).
    return v_board;
  end if;

  -- The row is written below: taken for update first, so two saves of one board queue rather
  -- than each holding the share the other's update waits for.
  perform 1 from public.manager_boards b
  where b.id = p_id and b.host_id = public.current_host_id()
  for update;
  v_board := public.manager_board_for_edit(p_id, false);
  if v_board.title is distinct from v_title
     or (p_shared is not null and v_board.shared is distinct from p_shared) then
    update public.manager_boards b
    set title = v_title, shared = coalesce(p_shared, b.shared), updated_at = now()
    where b.id = p_id
    returning b.* into v_board;
  end if;
  return v_board;
end;
$$;

comment on function public.save_manager_board(uuid, text, boolean) is
  'Creates a manager board (its owner''s alone unless shared, four columns) or renames it and '
  'changes who sees it (20261126120000).';

/**
 * Hands the board to another active manager or admin of the company: its owner or an admin does
 * it, archived or not. He becomes the owner; nothing else changes. A row of the transfers and,
 * unless he gave it to himself, one push to him. Handing it to its owner changes nothing (a
 * repeat).
 */
create function public.transfer_manager_board(p_id uuid, p_to uuid)
returns public.manager_boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.manager_boards;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  perform 1 from public.manager_boards b
  where b.id = p_id and b.host_id = public.current_host_id()
  for update;
  v_board := public.manager_board_for_edit(p_id, true);

  if v_board.owner_id is not distinct from p_to then
    return v_board;
  end if;
  if p_to is null or not exists (
    select 1 from public.profiles p
    where p.id = p_to
      and p.host_id = v_board.host_id
      and p.is_active
      and p.role in ('manager', 'admin')
  ) then
    raise exception 'Board % cannot be handed to %', p_id, p_to
      using errcode = 'check_violation', hint = 'serverErrors.boardTransferInvalid';
  end if;

  insert into public.manager_board_transfers (host_id, board_id, from_id, to_id, by_id)
  values (v_board.host_id, v_board.id, v_board.owner_id, p_to, (select auth.uid()));

  update public.manager_boards b
  set owner_id = p_to, updated_at = now()
  where b.id = v_board.id
  returning b.* into v_board;
  return v_board;
end;
$$;

comment on function public.transfer_manager_board(uuid, uuid) is
  'Hands a manager board to another active manager or admin of the company: its owner or an '
  'admin; a transfer row and one push (20261126120000).';

/** The push of a board handed over: to its new owner, unless he handed it to himself. */
create function public.push_on_board_transferred()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_after timestamptz;
begin
  if new.to_id is null or new.to_id is not distinct from new.by_id then
    return null;
  end if;
  v_after := public.push_send_after(false);
  insert into raw.push_outbox (host_id, recipient_id, kind, collapse_key, params, urgent,
                               send_after, expire_at)
  values (new.host_id, new.to_id, 'board_transferred', 'board:' || new.board_id,
          jsonb_build_object('board_id', new.board_id), false, v_after,
          v_after + public.push_lifetime());
  return null;
end;
$$;

comment on function public.push_on_board_transferred() is
  'Trigger: one push to the new owner of a manager board (20261126120000).';

create trigger manager_board_transfers_push
  after insert on public.manager_board_transfers
  for each row execute function public.push_on_board_transferred();

/**
 * For send-push: a board's title, its owner now and whether it is live, by id — the push of a
 * transfer goes only while its recipient still owns the board. service_role only.
 */
create function public.push_board_titles(p_board_ids uuid[])
returns table (board_id uuid, board_title text, owner_id uuid, is_live boolean)
language sql
stable
set search_path = ''
as $$
  select b.id, b.title, b.owner_id, b.archived_at is null
  from public.manager_boards b
  where b.id = any (p_board_ids);
$$;

comment on function public.push_board_titles(uuid[]) is
  'send-push: the titles and owners of manager boards by id (20261126120000); service_role only.';

/**
 * For send-push, as in 20261118230000, but the board's title only for an assignee who sees the
 * board: a card given to him on a board that is not his to see names the card alone.
 */
create or replace function public.push_board_card_titles(p_card_ids uuid[])
returns table (card_id uuid, card_title text, board_title text, assignee_id uuid, is_live boolean)
language sql
stable
set search_path = ''
as $$
  select c.id, c.title,
         case when b.shared or b.owner_id = c.assignee_id
                   or exists (select 1 from public.profiles p
                              where p.id = c.assignee_id and p.role = 'admin')
              then b.title end,
         c.assignee_id,
         c.archived_at is null and c.deleted_at is null and b.archived_at is null
  from public.manager_board_cards c
  join public.manager_boards b on b.id = c.board_id
  where c.id = any (p_card_ids);
$$;

-- ===================================================================
-- Columns of a board
-- ===================================================================

/**
 * Adds a column at the end of the board (p_board_id named: the add; a repeat answers the column
 * as it stands) or renames one (p_board_id null). The board's owner or an admin, the board live.
 */
create function public.save_manager_board_column(p_id uuid, p_board_id uuid, p_title text)
returns public.manager_board_columns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title  text := btrim(coalesce(p_title, ''), E' \t\r\n');
  v_board  public.manager_boards;
  v_column public.manager_board_columns;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if p_id is null then
    raise exception 'A column needs an id' using errcode = 'invalid_parameter_value', hint = 'serverErrors.unknown';
  end if;
  if char_length(v_title) not between 1 and 40 then
    raise exception 'A column needs a title of up to 40 characters'
      using errcode = 'check_violation', hint = 'serverErrors.boardColumnTitleInvalid',
            detail = jsonb_build_object('max', 40)::text;
  end if;

  select col.* into v_column
  from public.manager_board_columns col
  where col.id = p_id and col.host_id = public.current_host_id();

  if found and p_board_id is not null then
    -- A repeat of the add: the column as it stands, if the caller may still see its board.
    if not public.manager_board_visible(v_column.board_id) then
      raise exception 'Column % not found', p_id
        using errcode = 'no_data_found', hint = 'serverErrors.boardColumnNotFound';
    end if;
    return v_column;
  end if;

  if not found then
    if p_board_id is null then
      raise exception 'Column % not found', p_id
        using errcode = 'no_data_found', hint = 'serverErrors.boardColumnNotFound';
    end if;
    perform 1 from public.manager_boards b
    where b.id = p_board_id and b.host_id = public.current_host_id()
    for update;
    v_board := public.manager_board_for_edit(p_board_id, false);
    if (select count(*) from public.manager_board_columns col
        where col.board_id = v_board.id and col.deleted_at is null) >= 12 then
      raise exception 'A board holds up to 12 columns'
        using errcode = 'check_violation', hint = 'serverErrors.boardTooManyColumns',
              detail = jsonb_build_object('max', 12)::text;
    end if;
    insert into public.manager_board_columns
      (id, host_id, board_id, title, preset, position, is_done, legacy_key, created_by)
    values
      (p_id, v_board.host_id, v_board.id, v_title, null,
       coalesce((select max(col.position) from public.manager_board_columns col
                 where col.board_id = v_board.id and col.deleted_at is null), 0) + 1,
       false, 'in_progress', (select auth.uid()))
    on conflict (id) do nothing
    returning * into v_column;
    if v_column.id is null then
      raise exception 'Column % not found', p_id
        using errcode = 'no_data_found', hint = 'serverErrors.boardColumnNotFound';
    end if;
    perform public.manager_board_relabel(v_board.id);
    select col.* into v_column from public.manager_board_columns col where col.id = p_id;
    return v_column;
  end if;

  v_column := public.manager_column_for_edit(p_id);
  if v_column.title is distinct from v_title then
    update public.manager_board_columns col
    set title = v_title, updated_at = now()
    where col.id = v_column.id
    returning col.* into v_column;
  end if;
  return v_column;
end;
$$;

comment on function public.save_manager_board_column(uuid, uuid, text) is
  'Adds a column to a manager board or renames one: its owner or an admin (20261126120000).';

/** Puts the board's live columns in the order given: every one of them, once. */
create function public.order_manager_board_columns(p_board_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.manager_boards;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  perform 1 from public.manager_boards b
  where b.id = p_board_id and b.host_id = public.current_host_id()
  for update;
  v_board := public.manager_board_for_edit(p_board_id, false);

  if (select coalesce(array_agg(col.id order by col.id), '{}')
      from public.manager_board_columns col
      where col.board_id = v_board.id and col.deleted_at is null)
     is distinct from
     (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(p_ids, '{}')) x) then
    raise exception 'The columns of board % changed meanwhile', p_board_id
      using errcode = 'check_violation', hint = 'serverErrors.taskChangedMeanwhile';
  end if;

  update public.manager_board_columns col
  set position = o.n::integer, updated_at = now()
  from unnest(p_ids) with ordinality o(id, n)
  where col.id = o.id and col.board_id = v_board.id and col.position is distinct from o.n::integer;

  perform public.manager_board_relabel(v_board.id);
end;
$$;

comment on function public.order_manager_board_columns(uuid, uuid[]) is
  'Orders the columns of a manager board: its owner or an admin (20261126120000).';

/** Marks a column finishing (its cards are done) or not. */
create function public.set_manager_board_column_done(p_id uuid, p_done boolean)
returns public.manager_board_columns
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_column public.manager_board_columns := public.manager_column_for_edit(p_id);
begin
  if p_done is null or v_column.is_done = p_done then
    return v_column;
  end if;
  update public.manager_board_columns col
  set is_done = p_done, updated_at = now()
  where col.id = v_column.id;
  perform public.manager_board_relabel(v_column.board_id);
  select col.* into v_column from public.manager_board_columns col where col.id = p_id;
  return v_column;
end;
$$;

comment on function public.set_manager_board_column_done(uuid, boolean) is
  'Marks a column of a manager board finishing or not: its owner or an admin (20261126120000).';

/**
 * Deletes a column (softly: the journal still names it). Not the board's last live column. A
 * column holding cards — any card, archived and deleted ones too — needs p_move_to, another live
 * column of the board: its cards move there first, each with a «moved» line. A column already
 * deleted: nothing (a repeat).
 */
create function public.delete_manager_board_column(p_id uuid, p_move_to uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_column public.manager_board_columns;
  v_target public.manager_board_columns;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if exists (select 1 from public.manager_board_columns col
             where col.id = p_id and col.host_id = public.current_host_id()
               and col.deleted_at is not null
               and public.manager_board_visible(col.board_id)) then
    return;
  end if;
  v_column := public.manager_column_for_edit(p_id);

  if (select count(*) from public.manager_board_columns col
      where col.board_id = v_column.board_id and col.deleted_at is null) <= 1 then
    raise exception 'The last column of board % stays', v_column.board_id
      using errcode = 'check_violation', hint = 'serverErrors.boardColumnLast';
  end if;

  if exists (select 1 from public.manager_board_cards c where c.column_id = v_column.id) then
    select col.* into v_target
    from public.manager_board_columns col
    where col.id = p_move_to and col.board_id = v_column.board_id and col.deleted_at is null
      and col.id <> v_column.id;
    if not found then
      raise exception 'Column % holds cards: name the column they move to', p_id
        using errcode = 'check_violation', hint = 'serverErrors.boardColumnHasCards',
              detail = jsonb_build_object(
                'count', (select count(*) from public.manager_board_cards c
                          where c.column_id = v_column.id))::text;
    end if;

    insert into public.manager_board_entries (id, host_id, card_id, kind, facts, author_id)
    select gen_random_uuid(), c.host_id, c.id, 'moved',
           jsonb_build_object('from', v_column.legacy_key, 'to', v_target.legacy_key,
                              'from_column', v_column.id, 'to_column', v_target.id),
           (select auth.uid())
    from public.manager_board_cards c
    where c.column_id = v_column.id;

    update public.manager_board_cards c
    set column_id = v_target.id, moved_at = now(), updated_at = now()
    where c.column_id = v_column.id;
  end if;

  update public.manager_board_columns col
  set deleted_at = now(), deleted_by = (select auth.uid()), updated_at = now()
  where col.id = v_column.id;
  perform public.manager_board_relabel(v_column.board_id);
end;
$$;

comment on function public.delete_manager_board_column(uuid, uuid) is
  'Deletes a column of a manager board, its cards moved to another first: its owner or an admin '
  '(20261126120000).';

-- ===================================================================
-- Cards: a column by id, beside the four keys
-- ===================================================================

drop function public.save_manager_card(uuid, uuid, text, text, date, bigint, text, text, jsonb);

/**
 * Creates a card or changes its fields. A create names where the card stands — p_column_id, a
 * live column of the board, or p_column, one of the four keys (an older client); naming neither
 * it lands in 'open'. A change of fields names neither, so a known card with a column named is a
 * repeat of its create and answers the card as it stands. The rest as in
 * 20261119090000: any manager or admin of the company who sees the board, on a live board; the
 * card's assignee on a board he does not see changes its fields too.
 */
create function public.save_manager_card(
  p_id          uuid,
  p_board_id    uuid,
  p_title       text,
  p_description text,
  p_due_on      date,
  p_property_id bigint,
  p_color       text,
  p_column      text default null,
  p_steps       jsonb default null,
  p_column_id   uuid default null
)
returns public.manager_board_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title       text := btrim(coalesce(p_title, ''), E' \t\r\n');
  v_description text := coalesce(p_description, '');
  v_is_create   boolean := p_column is not null or p_column_id is not null;
  v_card        public.manager_board_cards;
  v_board       public.manager_boards;
  v_known       boolean;
  v_step        jsonb;
  v_column_id   uuid;
begin
  if not public.is_full_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if p_id is null then
    raise exception 'A card needs an id' using errcode = 'invalid_parameter_value', hint = 'serverErrors.unknown';
  end if;
  if char_length(v_title) not between 1 and 200 then
    raise exception 'A card needs a title of up to 200 characters'
      using errcode = 'check_violation', hint = 'serverErrors.boardCardTitleInvalid',
            detail = jsonb_build_object('max', 200)::text;
  end if;
  if char_length(v_description) > 10000 then
    raise exception 'A description is at most 10000 characters'
      using errcode = 'check_violation', hint = 'serverErrors.boardCardDescriptionTooLong',
            detail = jsonb_build_object('max', 10000)::text;
  end if;
  if p_color is not null
     and p_color not in ('blue', 'sky', 'teal', 'green', 'olive', 'violet', 'orchid', 'slate') then
    raise exception 'Unknown card colour %', p_color
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.boardColorUnknown';
  end if;
  if p_column is not null then
    perform public.manager_board_column(p_column);
  end if;
  if p_property_id is not null and not exists (
    select 1 from public.properties p
    where p.id = p_property_id and p.host_id = public.current_host_id()
  ) then
    raise exception 'Property % not found', p_property_id
      using errcode = 'no_data_found', hint = 'serverErrors.propertyNotFound';
  end if;
  if p_steps is not null then
    if jsonb_typeof(p_steps) <> 'array' then
      raise exception 'Steps must be an array of their words'
        using errcode = 'invalid_parameter_value', hint = 'serverErrors.boardStepInvalid',
              detail = jsonb_build_object('max', 500)::text;
    end if;
    if jsonb_array_length(p_steps) > 100 then
      raise exception 'A card holds up to 100 steps'
        using errcode = 'check_violation', hint = 'serverErrors.boardTooManySteps',
              detail = jsonb_build_object('max', 100)::text;
    end if;
    for v_step in select value from jsonb_array_elements(p_steps) loop
      if jsonb_typeof(v_step) <> 'string'
         or char_length(btrim(v_step #>> '{}', E' \t\r\n')) not between 1 and 500 then
        raise exception 'A step needs words, up to 500 characters'
          using errcode = 'check_violation', hint = 'serverErrors.boardStepInvalid',
                detail = jsonb_build_object('max', 500)::text;
      end if;
    end loop;
  end if;

  select exists (select 1 from public.manager_board_cards c where c.id = p_id) into v_known;

  if not v_known then
    -- Any manager or admin of the company who sees the board makes a card on it, the board live;
    -- a create that names no column lands in 'open', as it always did.
    v_board := public.manager_board_for_cards(p_board_id);
    if p_column_id is not null then
      select col.id into v_column_id
      from public.manager_board_columns col
      where col.id = p_column_id and col.board_id = v_board.id and col.deleted_at is null;
      if not found then
        raise exception 'Column % not found', p_column_id
          using errcode = 'no_data_found', hint = 'serverErrors.boardColumnNotFound';
      end if;
    else
      v_column_id := public.manager_board_column_for(v_board.id, coalesce(p_column, 'open'));
    end if;
    insert into public.manager_board_cards
      (id, host_id, board_id, title, description, column_id, column_key, color, due_on,
       property_id, created_by, assignee_id)
    values
      (p_id, v_board.host_id, v_board.id, v_title, v_description, v_column_id,
       coalesce(p_column, 'open'), p_color, p_due_on, p_property_id, (select auth.uid()),
       -- The owner, if they can hold a card: an active manager or admin of the company.
       (select p.id from public.profiles p
        where p.id = v_board.owner_id and p.host_id = v_board.host_id and p.is_active
          and p.role in ('manager', 'admin')))
    on conflict (id) do nothing
    returning * into v_card;

    if v_card.id is not null then
      insert into public.manager_board_steps (id, host_id, card_id, body, sort_order, created_by)
      select gen_random_uuid(), v_card.host_id, v_card.id, btrim(s.body, E' \t\r\n'), s.n::integer,
             (select auth.uid())
      from jsonb_array_elements_text(coalesce(p_steps, '[]'::jsonb)) with ordinality s(body, n);
      return v_card;
    end if;
    -- Saved meanwhile by a repeat: it is a repeat of the create, below.
  end if;

  if v_is_create then
    -- A repeat of a create: the card as it stands, if the caller reads it.
    select c.* into v_card
    from public.manager_board_cards c
    where c.id = p_id and c.host_id = public.current_host_id()
      and public.manager_card_readable(c.board_id, c.assignee_id);
    if not found then
      raise exception 'Card % not found', p_id
        using errcode = 'no_data_found', hint = 'serverErrors.boardCardNotFound';
    end if;
    return v_card;
  end if;

  v_card := public.manager_card_for_edit(p_id, false);

  if v_card.due_on is distinct from p_due_on then
    insert into public.manager_board_entries (id, host_id, card_id, kind, facts, author_id)
    values (gen_random_uuid(), v_card.host_id, v_card.id, 'due_changed',
            jsonb_build_object('from', v_card.due_on, 'to', p_due_on), (select auth.uid()));
  end if;

  if (v_card.title, v_card.description, v_card.color, v_card.due_on, v_card.property_id)
     is distinct from (v_title, v_description, p_color, p_due_on, p_property_id) then
    update public.manager_board_cards c
    set title       = v_title,
        description = v_description,
        color       = p_color,
        due_on      = p_due_on,
        property_id = p_property_id,
        updated_at  = now()
    where c.id = v_card.id
    returning c.* into v_card;
  end if;
  return v_card;
end;
$$;

comment on function public.save_manager_card(uuid, uuid, text, text, date, bigint, text, text, jsonb, uuid) is
  'Creates a manager board card in a column (by id, or by one of the four keys) or changes its '
  'fields (20261126120000).';

drop function public.move_manager_card(uuid, text);

/**
 * Moves a card to a column: p_column_id, a live column of its board, or p_column, one of the four
 * keys (an older client) — a key the card's column already stands for moves nothing. A «moved»
 * line with both keys and both columns.
 */
create function public.move_manager_card(p_id uuid, p_column text default null, p_column_id uuid default null)
returns public.manager_board_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card     public.manager_board_cards;
  v_from_key text;
  v_from_id  uuid;
  v_to_id    uuid;
begin
  if p_column_id is null then
    perform public.manager_board_column(p_column);
  end if;
  v_card := public.manager_card_for_edit(p_id, false);

  if p_column_id is not null then
    select col.id into v_to_id
    from public.manager_board_columns col
    where col.id = p_column_id and col.board_id = v_card.board_id and col.deleted_at is null;
    if not found then
      raise exception 'Column % not found', p_column_id
        using errcode = 'no_data_found', hint = 'serverErrors.boardColumnNotFound';
    end if;
  elsif v_card.column_key = p_column then
    return v_card;
  else
    v_to_id := public.manager_board_column_for(v_card.board_id, p_column);
  end if;

  if v_card.column_id = v_to_id then
    return v_card;
  end if;
  v_from_key := v_card.column_key;
  v_from_id := v_card.column_id;

  update public.manager_board_cards c
  set column_id = v_to_id, moved_at = now(), updated_at = now()
  where c.id = v_card.id
  returning c.* into v_card;

  insert into public.manager_board_entries (id, host_id, card_id, kind, facts, author_id)
  values (gen_random_uuid(), v_card.host_id, v_card.id, 'moved',
          jsonb_build_object('from', v_from_key, 'to', v_card.column_key,
                             'from_column', v_from_id, 'to_column', v_card.column_id),
          (select auth.uid()));
  return v_card;
end;
$$;

comment on function public.move_manager_card(uuid, text, uuid) is
  'Moves a manager board card to a column, by id or by one of the four keys (20261126120000).';

-- ===================================================================
-- Rights on the functions
-- ===================================================================

revoke all on function public.manager_boards_first_columns() from public, anon, authenticated, service_role;
revoke all on function public.manager_board_column_for(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.manager_board_relabel(uuid) from public, anon, authenticated, service_role;
revoke all on function public.manager_board_cards_column() from public, anon, authenticated, service_role;
revoke all on function public.manager_column_for_edit(uuid) from public, anon, authenticated, service_role;
revoke all on function public.push_on_board_transferred() from public, anon, authenticated, service_role;

-- Read by the policies as the reader: the reader executes them.
revoke all on function public.manager_board_visible(uuid) from public, anon;
revoke all on function public.manager_card_readable(uuid, uuid) from public, anon;
revoke all on function public.manager_board_columns_readable(uuid) from public, anon;
grant execute on function public.manager_board_visible(uuid) to authenticated, service_role;
grant execute on function public.manager_card_readable(uuid, uuid) to authenticated, service_role;
grant execute on function public.manager_board_columns_readable(uuid) to authenticated, service_role;

revoke all on function public.push_board_titles(uuid[]) from public, anon, authenticated;
grant execute on function public.push_board_titles(uuid[]) to service_role;

revoke all on function public.save_manager_board(uuid, text, boolean) from public, anon;
revoke all on function public.transfer_manager_board(uuid, uuid) from public, anon;
revoke all on function public.save_manager_board_column(uuid, uuid, text) from public, anon;
revoke all on function public.order_manager_board_columns(uuid, uuid[]) from public, anon;
revoke all on function public.set_manager_board_column_done(uuid, boolean) from public, anon;
revoke all on function public.delete_manager_board_column(uuid, uuid) from public, anon;
revoke all on function public.save_manager_card(uuid, uuid, text, text, date, bigint, text, text, jsonb, uuid) from public, anon;
revoke all on function public.move_manager_card(uuid, text, uuid) from public, anon;

grant execute on function public.save_manager_board(uuid, text, boolean) to authenticated;
grant execute on function public.transfer_manager_board(uuid, uuid) to authenticated;
grant execute on function public.save_manager_board_column(uuid, uuid, text) to authenticated;
grant execute on function public.order_manager_board_columns(uuid, uuid[]) to authenticated;
grant execute on function public.set_manager_board_column_done(uuid, boolean) to authenticated;
grant execute on function public.delete_manager_board_column(uuid, uuid) to authenticated;
grant execute on function public.save_manager_card(uuid, uuid, text, text, date, bigint, text, text, jsonb, uuid) to authenticated;
grant execute on function public.move_manager_card(uuid, text, uuid) to authenticated;
