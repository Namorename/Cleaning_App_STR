-- Manager boards (owner, 2026-11-18, CORE; docs/manager-boards.md): a manager's own boards of
-- cards beside the technicians' board in «Задания». A card is the office's own work — a call to
-- make, a project of a week — and nothing else: not a task of the technicians' board, not a
-- repair, not a cleaning; no counter of theirs sees it, and nothing lands here by itself.
--
-- Four tables: the boards; their cards in the four columns of the technicians' board; a card's
-- steps (one checklist); a card's journal — comments and short system lines (moved, due date
-- changed, step ticked). Every manager and admin of the company reads every board; only the
-- board's owner and an admin change it, its cards and their journal. No client writes a table:
-- every write is one of the functions below, which check the rights and write the system lines.
--
-- The words people type here — titles, descriptions, steps, comments — live in these tables
-- only, never in task_events, problem_events or any audit: the published privacy notice says the
-- work log holds no text people write. A system line carries codes, dates and counts, no words.
-- No retention job touches these tables (retention_keeps_work.sql). A card is never deleted: it
-- is archived or soft-deleted, and either comes back.
--
-- Additive only: four new tables and new functions; nothing that exists changes. An older phone
-- never reads them.

set local lock_timeout = '3s';

-- ===================================================================
-- Tables
-- ===================================================================

create table public.manager_boards (
  -- Minted by the client: a repeat of the first save is the same board.
  id          uuid primary key,
  host_id     uuid not null references public.hosts (id) on delete restrict,
  title       text not null
              constraint manager_boards_title_length check (char_length(btrim(title)) between 1 and 80),
  owner_id    uuid not null references public.profiles (id) on delete restrict,
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.manager_boards is
  'A manager''s board of cards (20261118200000). Read by the company''s office, changed by its '
  'owner and an admin through the board functions; archived softly, never deleted.';

create index manager_boards_host_idx on public.manager_boards (host_id, created_at);

create table public.manager_board_cards (
  -- Minted by the client: a repeat of the first save is the same card.
  id          uuid primary key,
  host_id     uuid not null references public.hosts (id) on delete restrict,
  board_id    uuid not null references public.manager_boards (id) on delete restrict,
  title       text not null
              constraint manager_board_cards_title_length check (char_length(btrim(title)) between 1 and 200),
  description text not null default ''
              constraint manager_board_cards_description_length check (char_length(description) <= 10000),
  -- The four columns of the technicians' board, by the same names (problems.statuses.*).
  column_key  text not null default 'open'
              constraint manager_board_cards_column_known
              check (column_key in ('open', 'assigned', 'in_progress', 'resolved')),
  -- One of the eight colours of the card palette (packages/shared, CARD_COLORS), or none.
  color       text
              constraint manager_board_cards_color_known
              check (color in ('blue', 'sky', 'teal', 'green', 'olive', 'violet', 'orchid', 'slate')),
  due_on      date,
  property_id bigint references public.properties (id) on delete set null,
  created_by  uuid not null references public.profiles (id) on delete restrict,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  moved_at    timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null,
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id) on delete set null,
  constraint manager_board_cards_one_shelf check (archived_at is null or deleted_at is null)
);

comment on table public.manager_board_cards is
  'A card of a manager board (20261118200000): the office''s own work, apart from tasks, repairs '
  'and cleanings. Archived or soft-deleted, never deleted.';

create index manager_board_cards_board_idx on public.manager_board_cards (board_id, column_key);
create index manager_board_cards_property_idx on public.manager_board_cards (property_id)
  where property_id is not null;

create table public.manager_board_steps (
  -- Minted by the client for a step added to a card; by the server for the steps a card is
  -- created or duplicated with.
  id         uuid primary key,
  host_id    uuid not null references public.hosts (id) on delete restrict,
  card_id    uuid not null references public.manager_board_cards (id) on delete restrict,
  body       text not null
             constraint manager_board_steps_body_length check (char_length(btrim(body)) between 1 and 500),
  sort_order integer not null,
  done_at    timestamptz,
  done_by    uuid references public.profiles (id) on delete set null,
  created_by uuid not null references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint manager_board_steps_done_said check (done_by is null or done_at is not null)
);

comment on table public.manager_board_steps is
  'A step of a manager board card: one checklist per card (20261118200000).';

create index manager_board_steps_card_idx on public.manager_board_steps (card_id, sort_order);

create table public.manager_board_entries (
  -- Minted by the client for a comment; by the server for a system line.
  id         uuid primary key,
  host_id    uuid not null references public.hosts (id) on delete restrict,
  card_id    uuid not null references public.manager_board_cards (id) on delete restrict,
  -- 'comment' carries the words; the system lines carry facts only:
  --   moved        {"from": column, "to": column}
  --   due_changed  {"from": date | null, "to": date | null}
  --   step_done    {"done": n, "total": m}
  kind       text not null
             constraint manager_board_entries_kind_known
             check (kind in ('comment', 'moved', 'due_changed', 'step_done')),
  body       text
             constraint manager_board_entries_body_length check (char_length(btrim(body)) between 1 and 4000),
  facts      jsonb not null default '{}'::jsonb
             constraint manager_board_entries_facts_object check (jsonb_typeof(facts) = 'object'),
  author_id  uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  edited_at  timestamptz,
  constraint manager_board_entries_words_are_comments check ((kind = 'comment') = (body is not null)),
  constraint manager_board_entries_edits_are_comments check (edited_at is null or kind = 'comment')
);

comment on table public.manager_board_entries is
  'The journal of a manager board card (20261118200000): comments, which their author edits and '
  'deletes, and system lines of codes and dates. Never the work log''s.';

create index manager_board_entries_card_idx on public.manager_board_entries (card_id, created_at, id);

-- Read by the company's office; written by the functions below and nobody else.
alter table public.manager_boards enable row level security;
alter table public.manager_board_cards enable row level security;
alter table public.manager_board_steps enable row level security;
alter table public.manager_board_entries enable row level security;

revoke all on public.manager_boards, public.manager_board_cards, public.manager_board_steps,
              public.manager_board_entries
  from public, anon, authenticated, service_role;
grant select on public.manager_boards, public.manager_board_cards, public.manager_board_steps,
                public.manager_board_entries
  to authenticated, service_role;

create policy "the office reads the company's boards"
  on public.manager_boards for select
  to authenticated
  using ((select public.is_manager()) and host_id = (select public.current_host_id()));

create policy "the office reads the company's board cards"
  on public.manager_board_cards for select
  to authenticated
  using ((select public.is_manager()) and host_id = (select public.current_host_id()));

create policy "the office reads the company's board steps"
  on public.manager_board_steps for select
  to authenticated
  using ((select public.is_manager()) and host_id = (select public.current_host_id()));

create policy "the office reads the company's board journals"
  on public.manager_board_entries for select
  to authenticated
  using ((select public.is_manager()) and host_id = (select public.current_host_id()));

-- ===================================================================
-- The rights, in one place
-- ===================================================================

/**
 * The board the caller may change, locked against an archive meanwhile: a manager or an admin
 * of its company, its owner or an admin. An archived board is changed by nothing but its
 * return, unless the caller says it may be archived. Internal.
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
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select b.* into v_board
  from public.manager_boards b
  where b.id = p_board_id
    and b.host_id = public.current_host_id()
  for share;

  if not found then
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

comment on function public.manager_board_for_edit(uuid, boolean) is
  'Internal: the board the caller may change, or the refusal (20261118200000).';

/**
 * The card the caller may change, locked: its board as manager_board_for_edit has it (never
 * archived), the card itself on the board — not archived and not deleted, unless the caller
 * says it may be shelved (a return, a duplicate). Internal.
 */
create or replace function public.manager_card_for_edit(p_card_id uuid, p_shelved_ok boolean)
returns public.manager_board_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board_id uuid;
  v_card     public.manager_board_cards;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select c.board_id into v_board_id
  from public.manager_board_cards c
  where c.id = p_card_id
    and c.host_id = public.current_host_id();

  if not found then
    raise exception 'Card % not found', p_card_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardCardNotFound';
  end if;

  perform public.manager_board_for_edit(v_board_id, false);

  select c.* into v_card
  from public.manager_board_cards c
  where c.id = p_card_id
  for update;

  if (v_card.archived_at is not null or v_card.deleted_at is not null) and not p_shelved_ok then
    raise exception 'Card % is archived or deleted', p_card_id
      using errcode = 'check_violation', hint = 'serverErrors.boardCardShelved';
  end if;
  return v_card;
end;
$$;

comment on function public.manager_card_for_edit(uuid, boolean) is
  'Internal: the card the caller may change, or the refusal (20261118200000).';

/** A column of the board, or the refusal. Internal. */
create or replace function public.manager_board_column(p_column text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_column is null or p_column not in ('open', 'assigned', 'in_progress', 'resolved') then
    raise exception 'Unknown column %', p_column
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.boardColumnUnknown';
  end if;
  return p_column;
end;
$$;

comment on function public.manager_board_column(text) is
  'Internal: a column of a manager board, or the refusal (20261118200000).';

-- ===================================================================
-- Boards
-- ===================================================================

/**
 * Creates the board with the client's id, its owner the caller, or renames it. A repeat of the
 * first save answers the same board. Any manager or admin creates one; the owner and an admin
 * rename it.
 */
create or replace function public.save_manager_board(p_id uuid, p_title text)
returns public.manager_boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''), E' \t\r\n');
  v_board public.manager_boards;
begin
  if not public.is_manager() then
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
  insert into public.manager_boards (id, host_id, title, owner_id)
  values (p_id, public.current_host_id(), v_title, (select auth.uid()))
  on conflict (id) do nothing;

  -- The row is written below: taken for update first, so two saves of one board queue rather
  -- than each holding the share the other's update waits for.
  perform 1 from public.manager_boards b
  where b.id = p_id and b.host_id = public.current_host_id()
  for update;
  v_board := public.manager_board_for_edit(p_id, false);
  if v_board.title is distinct from v_title then
    update public.manager_boards b
    set title = v_title, updated_at = now()
    where b.id = p_id
    returning b.* into v_board;
  end if;
  return v_board;
end;
$$;

comment on function public.save_manager_board(uuid, text) is
  'Creates a manager board (the caller its owner) or renames it (20261118200000).';

/** Archives the board, or brings it back. The owner and an admin. A repeat changes nothing. */
create or replace function public.set_manager_board_archived(p_id uuid, p_archived boolean)
returns public.manager_boards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board public.manager_boards;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  -- Taken for update before the rights' share: two archives of one board queue (see above).
  perform 1 from public.manager_boards b
  where b.id = p_id and b.host_id = public.current_host_id()
  for update;
  v_board := public.manager_board_for_edit(p_id, true);
  if coalesce(p_archived, false) = (v_board.archived_at is not null) then
    return v_board;
  end if;

  update public.manager_boards b
  set archived_at = case when p_archived then now() end,
      archived_by = case when p_archived then (select auth.uid()) end,
      updated_at  = now()
  where b.id = p_id
  returning b.* into v_board;
  return v_board;
end;
$$;

comment on function public.set_manager_board_archived(uuid, boolean) is
  'Archives a manager board or returns it (20261118200000).';

-- ===================================================================
-- Cards
-- ===================================================================

/**
 * Creates a card with the client's id, or saves its fields. A new card goes to p_column
 * ('open' when none is said) with the steps p_steps names (an array of their words, in order).
 * A saved card keeps its board, its column (move_manager_card moves it) and its steps (they
 * have functions of their own): p_board_id, p_column and p_steps are read on the create only.
 * A due date that changes leaves a line in the journal.
 *
 * A call that says its column is a create, and a save of the fields never says one: a repeat of
 * a create — the card is there already — answers the card as it stands, whatever was done to it
 * since. A stale create neither undoes an edit nor stumbles on a card archived meanwhile.
 */
create or replace function public.save_manager_card(
  p_id          uuid,
  p_board_id    uuid,
  p_title       text,
  p_description text,
  p_due_on      date,
  p_property_id bigint,
  p_color       text,
  p_column      text default null,
  p_steps       jsonb default null
)
returns public.manager_board_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title       text := btrim(coalesce(p_title, ''), E' \t\r\n');
  v_description text := coalesce(p_description, '');
  v_column      text := coalesce(p_column, 'open');
  v_card        public.manager_board_cards;
  v_board       public.manager_boards;
  v_known       boolean;
  v_step        jsonb;
begin
  if not public.is_manager() then
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
  perform public.manager_board_column(v_column);
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
    v_board := public.manager_board_for_edit(p_board_id, false);
    insert into public.manager_board_cards
      (id, host_id, board_id, title, description, column_key, color, due_on, property_id, created_by)
    values
      (p_id, v_board.host_id, v_board.id, v_title, v_description, v_column, p_color, p_due_on,
       p_property_id, (select auth.uid()))
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

  if p_column is not null then
    -- A repeat of a create: the card as it stands, if it is the caller's company's.
    select c.* into v_card
    from public.manager_board_cards c
    where c.id = p_id and c.host_id = public.current_host_id();
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

comment on function public.save_manager_card(uuid, uuid, text, text, date, bigint, text, text, jsonb) is
  'Creates a card of a manager board with its steps, or saves its fields (20261118200000).';

/** Moves a card to another column, with a line in the journal. The same column changes nothing. */
create or replace function public.move_manager_card(p_id uuid, p_column text)
returns public.manager_board_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_column text := public.manager_board_column(p_column);
  v_card   public.manager_board_cards;
  v_from   text;
begin
  v_card := public.manager_card_for_edit(p_id, false);
  if v_card.column_key = v_column then
    return v_card;
  end if;
  v_from := v_card.column_key;

  update public.manager_board_cards c
  set column_key = v_column, moved_at = now(), updated_at = now()
  where c.id = v_card.id
  returning c.* into v_card;

  insert into public.manager_board_entries (id, host_id, card_id, kind, facts, author_id)
  values (gen_random_uuid(), v_card.host_id, v_card.id, 'moved',
          jsonb_build_object('from', v_from, 'to', v_column), (select auth.uid()));
  return v_card;
end;
$$;

comment on function public.move_manager_card(uuid, text) is
  'Moves a card of a manager board to another column (20261118200000).';

/**
 * Puts a card on a shelf or takes it off: 'archived', 'deleted' (soft: it stays and comes back)
 * or 'active'. A card is on one shelf at a time. The same state changes nothing.
 */
create or replace function public.set_manager_card_state(p_id uuid, p_state text)
returns public.manager_board_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.manager_board_cards;
begin
  if p_state is null or p_state not in ('active', 'archived', 'deleted') then
    raise exception 'Unknown card state %', p_state
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.unknown';
  end if;
  v_card := public.manager_card_for_edit(p_id, true);

  if (p_state = 'active' and v_card.archived_at is null and v_card.deleted_at is null)
     or (p_state = 'archived' and v_card.archived_at is not null)
     or (p_state = 'deleted' and v_card.deleted_at is not null) then
    return v_card;
  end if;

  update public.manager_board_cards c
  set archived_at = case when p_state = 'archived' then now() end,
      archived_by = case when p_state = 'archived' then (select auth.uid()) end,
      deleted_at  = case when p_state = 'deleted' then now() end,
      deleted_by  = case when p_state = 'deleted' then (select auth.uid()) end,
      updated_at  = now()
  where c.id = v_card.id
  returning c.* into v_card;
  return v_card;
end;
$$;

comment on function public.set_manager_card_state(uuid, text) is
  'Archives, soft-deletes or returns a card of a manager board (20261118200000).';

/**
 * A copy of a card under the client's id and title, for a project that comes back: the same
 * board, description, place and colour, its steps in order and unticked, in the first column,
 * with no due date and an empty journal. A shelved card is copied too. A repeat answers the copy.
 */
create or replace function public.duplicate_manager_card(p_source_id uuid, p_id uuid, p_title text)
returns public.manager_board_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title  text := btrim(coalesce(p_title, ''), E' \t\r\n');
  v_source public.manager_board_cards;
  v_card   public.manager_board_cards;
begin
  if char_length(v_title) not between 1 and 200 then
    raise exception 'A card needs a title of up to 200 characters'
      using errcode = 'check_violation', hint = 'serverErrors.boardCardTitleInvalid',
            detail = jsonb_build_object('max', 200)::text;
  end if;
  v_source := public.manager_card_for_edit(p_source_id, true);

  insert into public.manager_board_cards
    (id, host_id, board_id, title, description, column_key, color, due_on, property_id, created_by)
  values
    (p_id, v_source.host_id, v_source.board_id, v_title, v_source.description, 'open',
     v_source.color, null, v_source.property_id, (select auth.uid()))
  on conflict (id) do nothing
  returning * into v_card;

  if v_card.id is null then
    -- A repeat: the copy made the first time, if it is the caller's company's.
    select c.* into v_card
    from public.manager_board_cards c
    where c.id = p_id and c.host_id = v_source.host_id;
    if not found then
      raise exception 'Card % not found', p_id
        using errcode = 'no_data_found', hint = 'serverErrors.boardCardNotFound';
    end if;
    return v_card;
  end if;

  insert into public.manager_board_steps (id, host_id, card_id, body, sort_order, created_by)
  select gen_random_uuid(), v_card.host_id, v_card.id, s.body,
         row_number() over (order by s.sort_order, s.created_at, s.id)::integer,
         (select auth.uid())
  from public.manager_board_steps s
  where s.card_id = v_source.id;
  return v_card;
end;
$$;

comment on function public.duplicate_manager_card(uuid, uuid, text) is
  'Copies a card of a manager board with its steps, unticked (20261118200000).';

-- ===================================================================
-- Steps
-- ===================================================================

/** A step's card, locked for a change, or the refusal: no step of the caller's company. Internal. */
create or replace function public.manager_step_card(p_step_id uuid)
returns public.manager_board_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card_id uuid;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  select s.card_id into v_card_id
  from public.manager_board_steps s
  where s.id = p_step_id and s.host_id = public.current_host_id();
  if not found then
    raise exception 'Step % not found', p_step_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardStepNotFound';
  end if;
  return public.manager_card_for_edit(v_card_id, false);
end;
$$;

comment on function public.manager_step_card(uuid) is
  'Internal: the card of a step the caller may change, or the refusal (20261118200000).';

/**
 * Adds a step with the client's id at the end of the card's list (p_card_id names the card), or
 * changes its words (p_card_id null). A repeat of the add answers the step as it stands.
 */
create or replace function public.save_manager_step(p_id uuid, p_card_id uuid, p_body text)
returns public.manager_board_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_card public.manager_board_cards;
  v_step public.manager_board_steps;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if p_id is null then
    raise exception 'A step needs an id' using errcode = 'invalid_parameter_value', hint = 'serverErrors.unknown';
  end if;
  if char_length(v_body) not between 1 and 500 then
    raise exception 'A step needs words, up to 500 characters'
      using errcode = 'check_violation', hint = 'serverErrors.boardStepInvalid',
            detail = jsonb_build_object('max', 500)::text;
  end if;

  if exists (select 1 from public.manager_board_steps s where s.id = p_id) then
    if p_card_id is not null then
      -- A repeat of an add (an add names its card, a change of words does not): the step as it
      -- stands, whatever was done to it since, if it is the caller's company's.
      select s.* into v_step
      from public.manager_board_steps s
      where s.id = p_id and s.host_id = public.current_host_id();
      if not found then
        raise exception 'Step % not found', p_id
          using errcode = 'no_data_found', hint = 'serverErrors.boardStepNotFound';
      end if;
      return v_step;
    end if;
    v_card := public.manager_step_card(p_id);
  else
    if p_card_id is null then
      raise exception 'Step % not found', p_id
        using errcode = 'no_data_found', hint = 'serverErrors.boardStepNotFound';
    end if;
    v_card := public.manager_card_for_edit(p_card_id, false);
    if (select count(*) from public.manager_board_steps s where s.card_id = v_card.id) >= 100 then
      raise exception 'A card holds up to 100 steps'
        using errcode = 'check_violation', hint = 'serverErrors.boardTooManySteps',
              detail = jsonb_build_object('max', 100)::text;
    end if;
    insert into public.manager_board_steps (id, host_id, card_id, body, sort_order, created_by)
    values (p_id, v_card.host_id, v_card.id, v_body,
            coalesce((select max(s.sort_order) from public.manager_board_steps s
                      where s.card_id = v_card.id), 0) + 1,
            (select auth.uid()))
    on conflict (id) do nothing
    returning * into v_step;
    if v_step.id is null then
      -- Added meanwhile by a repeat: that step, as it stands.
      select s.* into v_step
      from public.manager_board_steps s
      where s.id = p_id and s.host_id = v_card.host_id;
      if not found then
        raise exception 'Step % not found', p_id
          using errcode = 'no_data_found', hint = 'serverErrors.boardStepNotFound';
      end if;
    end if;
    return v_step;
  end if;

  select s.* into v_step
  from public.manager_board_steps s
  where s.id = p_id and s.card_id = v_card.id
  for update;
  if not found then
    raise exception 'Step % not found', p_id
      using errcode = 'no_data_found', hint = 'serverErrors.boardStepNotFound';
  end if;

  if v_step.body is distinct from v_body then
    update public.manager_board_steps s
    set body = v_body, updated_at = now()
    where s.id = v_step.id
    returning s.* into v_step;
  end if;
  return v_step;
end;
$$;

comment on function public.save_manager_step(uuid, uuid, text) is
  'Adds a step to a card of a manager board, or changes its words (20261118200000).';

/**
 * Ticks a step or unticks it. A tick leaves a line in the journal with the count, never the
 * step's words; an untick leaves none. The same state changes nothing.
 */
create or replace function public.set_manager_step_done(p_id uuid, p_done boolean)
returns public.manager_board_steps
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.manager_board_cards := public.manager_step_card(p_id);
  v_step public.manager_board_steps;
begin
  select s.* into v_step from public.manager_board_steps s where s.id = p_id for update;
  if coalesce(p_done, false) = (v_step.done_at is not null) then
    return v_step;
  end if;

  update public.manager_board_steps s
  set done_at    = case when p_done then now() end,
      done_by    = case when p_done then (select auth.uid()) end,
      updated_at = now()
  where s.id = v_step.id
  returning s.* into v_step;

  if p_done then
    insert into public.manager_board_entries (id, host_id, card_id, kind, facts, author_id)
    select gen_random_uuid(), v_card.host_id, v_card.id, 'step_done',
           jsonb_build_object('done', count(*) filter (where s.done_at is not null),
                              'total', count(*)),
           (select auth.uid())
    from public.manager_board_steps s
    where s.card_id = v_card.id;
  end if;
  return v_step;
end;
$$;

comment on function public.set_manager_step_done(uuid, boolean) is
  'Ticks or unticks a step of a manager board card (20261118200000).';

/** Deletes a step. A step already gone changes nothing. */
create or replace function public.delete_manager_step(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if not exists (select 1 from public.manager_board_steps s where s.id = p_id) then
    return;
  end if;
  perform public.manager_step_card(p_id);
  delete from public.manager_board_steps s where s.id = p_id;
end;
$$;

comment on function public.delete_manager_step(uuid) is
  'Deletes a step of a manager board card (20261118200000).';

/**
 * The card's steps in a new order: p_ids names every step of the card once. A list that does
 * not — a step added or deleted meanwhile — is refused, and the screen reads them again.
 */
create or replace function public.order_manager_steps(p_card_id uuid, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card public.manager_board_cards := public.manager_card_for_edit(p_card_id, false);
begin
  if (select coalesce(array_agg(s.id order by s.id), '{}')
      from public.manager_board_steps s where s.card_id = v_card.id)
     is distinct from
     (select coalesce(array_agg(x order by x), '{}') from unnest(coalesce(p_ids, '{}')) x) then
    raise exception 'The steps of card % changed meanwhile', p_card_id
      using errcode = 'check_violation', hint = 'serverErrors.taskChangedMeanwhile';
  end if;

  update public.manager_board_steps s
  set sort_order = o.n::integer, updated_at = now()
  from unnest(p_ids) with ordinality o(id, n)
  where s.id = o.id and s.card_id = v_card.id and s.sort_order is distinct from o.n::integer;
end;
$$;

comment on function public.order_manager_steps(uuid, uuid[]) is
  'Puts the steps of a manager board card in a new order (20261118200000).';

-- ===================================================================
-- The journal
-- ===================================================================

/**
 * Writes a comment with the client's id (p_card_id names the card), or changes its words
 * (p_card_id null) — its author only; a change marks it edited. A repeat of the write answers
 * the comment as it stands, whatever was done to it since.
 */
create or replace function public.save_manager_comment(p_id uuid, p_card_id uuid, p_body text)
returns public.manager_board_entries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_body  text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_card  public.manager_board_cards;
  v_entry public.manager_board_entries;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if p_id is null then
    raise exception 'A comment needs an id' using errcode = 'invalid_parameter_value', hint = 'serverErrors.unknown';
  end if;
  if v_body = '' then
    raise exception 'A comment needs words'
      using errcode = 'check_violation', hint = 'serverErrors.commentEmpty';
  end if;
  if char_length(v_body) > 4000 then
    raise exception 'A comment is at most 4000 characters'
      using errcode = 'check_violation', hint = 'serverErrors.commentTooLong',
            detail = jsonb_build_object('limit', 4000)::text;
  end if;

  select e.* into v_entry
  from public.manager_board_entries e
  where e.id = p_id and e.host_id = public.current_host_id();

  if found and p_card_id is not null then
    -- A repeat of a write (a write names its card, a change of words does not): the comment as
    -- it stands, whatever was done to it since.
    return v_entry;
  end if;

  if not found then
    if p_card_id is null then
      raise exception 'Comment % not found', p_id
        using errcode = 'no_data_found', hint = 'serverErrors.boardCommentNotYours';
    end if;
    v_card := public.manager_card_for_edit(p_card_id, false);
    insert into public.manager_board_entries (id, host_id, card_id, kind, body, author_id)
    values (p_id, v_card.host_id, v_card.id, 'comment', v_body, (select auth.uid()))
    on conflict (id) do nothing
    returning * into v_entry;
    if v_entry.id is null then
      -- Written meanwhile by a repeat (or another company's id): the comment as it stands.
      select e.* into v_entry
      from public.manager_board_entries e
      where e.id = p_id and e.host_id = v_card.host_id;
      if not found then
        raise exception 'Comment % not found', p_id
          using errcode = 'no_data_found', hint = 'serverErrors.boardCommentNotYours';
      end if;
    end if;
    return v_entry;
  end if;

  v_card := public.manager_card_for_edit(v_entry.card_id, false);
  if v_entry.kind <> 'comment' or v_entry.author_id is distinct from (select auth.uid()) then
    raise exception 'Only its author changes comment %', p_id
      using errcode = 'insufficient_privilege', hint = 'serverErrors.boardCommentNotYours';
  end if;

  select e.* into v_entry from public.manager_board_entries e where e.id = p_id for update;
  if v_entry.body is distinct from v_body then
    update public.manager_board_entries e
    set body = v_body, edited_at = now()
    where e.id = v_entry.id
    returning e.* into v_entry;
  end if;
  return v_entry;
end;
$$;

comment on function public.save_manager_comment(uuid, uuid, text) is
  'Writes a comment on a manager board card, or its author changes it (20261118200000).';

/**
 * Deletes a comment: its author, or an admin. The system lines stay. A comment already gone
 * changes nothing.
 */
create or replace function public.delete_manager_comment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.manager_board_entries;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select e.* into v_entry
  from public.manager_board_entries e
  where e.id = p_id and e.host_id = public.current_host_id();
  if not found then
    return;
  end if;

  perform public.manager_card_for_edit(v_entry.card_id, false);
  if v_entry.kind <> 'comment'
     or (v_entry.author_id is distinct from (select auth.uid())
         and public.auth_role() is distinct from 'admin') then
    raise exception 'Only its author or an admin deletes comment %', p_id
      using errcode = 'insufficient_privilege', hint = 'serverErrors.boardCommentNotYours';
  end if;

  delete from public.manager_board_entries e where e.id = p_id;
end;
$$;

comment on function public.delete_manager_comment(uuid) is
  'Deletes a comment of a manager board card: its author or an admin (20261118200000).';

-- ===================================================================
-- Execute rights
-- ===================================================================

revoke all on function public.manager_board_for_edit(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.manager_card_for_edit(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.manager_board_column(text) from public, anon, authenticated, service_role;
revoke all on function public.manager_step_card(uuid) from public, anon, authenticated, service_role;

revoke all on function public.save_manager_board(uuid, text) from public, anon;
revoke all on function public.set_manager_board_archived(uuid, boolean) from public, anon;
revoke all on function public.save_manager_card(uuid, uuid, text, text, date, bigint, text, text, jsonb) from public, anon;
revoke all on function public.move_manager_card(uuid, text) from public, anon;
revoke all on function public.set_manager_card_state(uuid, text) from public, anon;
revoke all on function public.duplicate_manager_card(uuid, uuid, text) from public, anon;
revoke all on function public.save_manager_step(uuid, uuid, text) from public, anon;
revoke all on function public.set_manager_step_done(uuid, boolean) from public, anon;
revoke all on function public.delete_manager_step(uuid) from public, anon;
revoke all on function public.order_manager_steps(uuid, uuid[]) from public, anon;
revoke all on function public.save_manager_comment(uuid, uuid, text) from public, anon;
revoke all on function public.delete_manager_comment(uuid) from public, anon;

grant execute on function public.save_manager_board(uuid, text) to authenticated;
grant execute on function public.set_manager_board_archived(uuid, boolean) to authenticated;
grant execute on function public.save_manager_card(uuid, uuid, text, text, date, bigint, text, text, jsonb) to authenticated;
grant execute on function public.move_manager_card(uuid, text) to authenticated;
grant execute on function public.set_manager_card_state(uuid, text) to authenticated;
grant execute on function public.duplicate_manager_card(uuid, uuid, text) to authenticated;
grant execute on function public.save_manager_step(uuid, uuid, text) to authenticated;
grant execute on function public.set_manager_step_done(uuid, boolean) to authenticated;
grant execute on function public.delete_manager_step(uuid) to authenticated;
grant execute on function public.order_manager_steps(uuid, uuid[]) to authenticated;
grant execute on function public.save_manager_comment(uuid, uuid, text) to authenticated;
grant execute on function public.delete_manager_comment(uuid) to authenticated;
