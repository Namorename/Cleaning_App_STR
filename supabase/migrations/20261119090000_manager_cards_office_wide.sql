-- The cards of the manager boards are the whole office's (owner, 2026-11-19, CORE;
-- docs/manager-boards.md, stage 3).
--
-- Until now a board's cards and journal were changed by the board's owner and an admin (and, since
-- 20261118230000, a card's assignee). From here every active manager and admin of the company works
-- on the cards of every board that is not archived: makes them, edits them, moves them between the
-- columns, archives, deletes and returns them, copies them, assigns them, ticks and edits their
-- steps, writes comments. The board itself — renaming it, archiving it and bringing it back — stays
-- its owner's and an admin's (manager_board_for_edit, untouched). A comment is still changed by its
-- author alone and deleted by its author or an admin; the journal's system lines are still the
-- server's. A cleaner, a technician, a person switched off and another company reach nothing, as
-- before: is_manager() reads the role of an active profile, and every card is looked up within the
-- caller's company.
--
-- The assignee keeps everything else of 20261118230000 (the column, the push, the journal line, the
-- default of a new card); their own right to work on the card is now everybody's in the office, so
-- the clause that granted it goes.
--
-- Only opens rights: no table, column, value or grant changes. Two function bodies change
-- (manager_card_for_edit, save_manager_card) and one helper is added (manager_board_for_cards).

set local lock_timeout = '3s';

/**
 * The board whose cards are worked on: any manager or admin of the company, on a board that is not
 * archived (20261119090000). Locks the board for share, as the board's own helper does, so the
 * order of locks — board, then card — stays the same everywhere.
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
  if v_board.archived_at is not null then
    raise exception 'Board % is archived', p_board_id
      using errcode = 'check_violation', hint = 'serverErrors.boardArchived';
  end if;
  return v_board;
end;
$$;

comment on function public.manager_board_for_cards(uuid) is
  'The board whose cards are worked on: any manager or admin of the company, a live board (20261119090000).';

revoke all on function public.manager_board_for_cards(uuid) from public, anon, authenticated, service_role;

/**
 * The card being worked on: any manager or admin of the company, on a live board. A shelved card
 * (archived or deleted) only where the caller says so — its shelf and its copy.
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

  -- Every manager and admin of the company, on a board that is not archived (20261119090000).
  perform public.manager_board_for_cards(v_board_id);

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

-- A new card is made by any manager or admin of the company (the rest of the body as 20261118230000).
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
    -- Any manager or admin of the company makes a card on a live board (20261119090000).
    v_board := public.manager_board_for_cards(p_board_id);
    insert into public.manager_board_cards
      (id, host_id, board_id, title, description, column_key, color, due_on, property_id, created_by,
       assignee_id)
    values
      (p_id, v_board.host_id, v_board.id, v_title, v_description, v_column, p_color, p_due_on,
       p_property_id, (select auth.uid()),
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
