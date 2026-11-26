-- Rollback of 20261126120000_board_columns (docs/manager-boards.md, «Этап 4»;
-- docs/rollout/boards-dates-chats-1126.md). One statement, so `supabase db query --linked -f`
-- takes it whole; then `npx supabase migration repair --status reverted 20261126120000 --linked`.
--
-- Order: the code first (main back, the OTA republished), then this. What it does:
-- - the board functions of 20261119143000 come back byte for byte (taken from the stand before the
--   migration): manager_board_for_cards, manager_board_for_edit, manager_card_for_edit,
--   save_manager_board(uuid, text), save_manager_card(9), move_manager_card(uuid, text),
--   push_board_card_titles, save_manager_comment, save_manager_step, duplicate_manager_card; the
--   new functions go;
-- - the read policies of the four tables of boards read the whole office again;
-- - cards keep their four keys (column_key already holds the stage of each card's column); the
--   column of columns, the table of columns and the table of transfers go: a column's own name
--   and the transfers' facts are lost, an owner handed a board stays its owner;
-- - manager_boards.shared goes: every board is read by the office again, as before;
-- - queued pushes of a transfer not yet sent are dropped (older send-push skips the kind anyway);
--   the enum value board_transferred stays (Postgres does not drop one).
do $undo$
begin
  perform set_config('lock_timeout', '3s', true);
  if to_regclass('public.manager_board_columns') is null then
    raise notice '20261126120000 is not in this database: nothing to undo';
    return;
  end if;

  drop trigger if exists manager_board_cards_column on public.manager_board_cards;
  drop trigger if exists manager_boards_first_columns on public.manager_boards;
  drop trigger if exists manager_board_transfers_push on public.manager_board_transfers;

  alter policy "the office reads the company's boards" on public.manager_boards
    using ((select public.is_full_manager()) and host_id = (select public.current_host_id()));
  alter policy "the office reads the company's board cards" on public.manager_board_cards
    using ((select public.is_full_manager()) and host_id = (select public.current_host_id()));
  alter policy "the office reads the company's board steps" on public.manager_board_steps
    using ((select public.is_full_manager()) and host_id = (select public.current_host_id()));
  alter policy "the office reads the company's board journals" on public.manager_board_entries
    using ((select public.is_full_manager()) and host_id = (select public.current_host_id()));

  drop function if exists public.save_manager_board(uuid, text, boolean);
  drop function if exists public.save_manager_card(uuid, uuid, text, text, date, bigint, text, text, jsonb, uuid);
  drop function if exists public.move_manager_card(uuid, text, uuid);
  drop function if exists public.transfer_manager_board(uuid, uuid);
  drop function if exists public.push_on_board_transferred();
  drop function if exists public.push_board_titles(uuid[]);
  drop function if exists public.save_manager_board_column(uuid, uuid, text);
  drop function if exists public.order_manager_board_columns(uuid, uuid[]);
  drop function if exists public.set_manager_board_column_done(uuid, boolean);
  drop function if exists public.delete_manager_board_column(uuid, uuid);
  drop function if exists public.manager_column_for_edit(uuid);
  drop function if exists public.manager_board_cards_column();
  drop function if exists public.manager_board_relabel(uuid);
  drop function if exists public.manager_board_column_for(uuid, text);
  drop function if exists public.manager_boards_first_columns();

  execute $q$
CREATE OR REPLACE FUNCTION public.manager_board_for_cards(p_board_id uuid)
 RETURNS manager_boards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
$q$;

  execute $q$
CREATE OR REPLACE FUNCTION public.manager_board_for_edit(p_board_id uuid, p_archived_ok boolean)
 RETURNS manager_boards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
$q$;

  execute $q$
CREATE OR REPLACE FUNCTION public.manager_card_for_edit(p_card_id uuid, p_shelved_ok boolean)
 RETURNS manager_board_cards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_board_id uuid;
  v_card     public.manager_board_cards;
begin
  if not public.is_full_manager() then
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
$function$
$q$;

  execute $q$
CREATE OR REPLACE FUNCTION public.save_manager_board(p_id uuid, p_title text)
 RETURNS manager_boards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
$q$;

  execute $q$
CREATE OR REPLACE FUNCTION public.save_manager_card(p_id uuid, p_board_id uuid, p_title text, p_description text, p_due_on date, p_property_id bigint, p_color text, p_column text DEFAULT NULL::text, p_steps jsonb DEFAULT NULL::jsonb)
 RETURNS manager_board_cards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_title       text := btrim(coalesce(p_title, ''), E' \t\r\n');
  v_description text := coalesce(p_description, '');
  v_column      text := coalesce(p_column, 'open');
  v_card        public.manager_board_cards;
  v_board       public.manager_boards;
  v_known       boolean;
  v_step        jsonb;
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
$function$
$q$;

  execute $q$
CREATE OR REPLACE FUNCTION public.move_manager_card(p_id uuid, p_column text)
 RETURNS manager_board_cards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
$q$;

  execute $q$
CREATE OR REPLACE FUNCTION public.push_board_card_titles(p_card_ids uuid[])
 RETURNS TABLE(card_id uuid, card_title text, board_title text, assignee_id uuid, is_live boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select c.id, c.title, b.title, c.assignee_id,
         c.archived_at is null and c.deleted_at is null and b.archived_at is null
  from public.manager_board_cards c
  join public.manager_boards b on b.id = c.board_id
  where c.id = any (p_card_ids);
$function$
$q$;

  execute $q$
CREATE OR REPLACE FUNCTION public.save_manager_comment(p_id uuid, p_card_id uuid, p_body text)
 RETURNS manager_board_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_body  text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_card  public.manager_board_cards;
  v_entry public.manager_board_entries;
begin
  if not public.is_full_manager() then
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
$function$
$q$;

  execute $q$
CREATE OR REPLACE FUNCTION public.save_manager_step(p_id uuid, p_card_id uuid, p_body text)
 RETURNS manager_board_steps
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_body text := btrim(coalesce(p_body, ''), E' \t\r\n');
  v_card public.manager_board_cards;
  v_step public.manager_board_steps;
begin
  if not public.is_full_manager() then
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
$function$
$q$;

  execute $q$
CREATE OR REPLACE FUNCTION public.duplicate_manager_card(p_source_id uuid, p_id uuid, p_title text)
 RETURNS manager_board_cards
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    (id, host_id, board_id, title, description, column_key, color, due_on, property_id, created_by,
     assignee_id)
  values
    (p_id, v_source.host_id, v_source.board_id, v_title, v_source.description, 'open',
     v_source.color, null, v_source.property_id, (select auth.uid()),
     -- The board's owner, if they can hold a card: an active manager or admin of the company.
     (select p.id
      from public.manager_boards b
      join public.profiles p on p.id = b.owner_id
      where b.id = v_source.board_id and p.host_id = b.host_id and p.is_active
        and p.role in ('manager', 'admin')))
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
$function$
$q$;

  comment on function public.save_manager_board(uuid, text) is
    'Creates a manager board (the caller its owner) or renames it (20261118200000).';
  comment on function public.save_manager_card(uuid, uuid, text, text, date, bigint, text, text, jsonb) is
    'Creates a card of a manager board with its steps, or saves its fields (20261118200000).';
  comment on function public.move_manager_card(uuid, text) is
    'Moves a card of a manager board to another column (20261118200000).';
  revoke all on function public.save_manager_board(uuid, text) from public, anon;
  revoke all on function public.save_manager_card(uuid, uuid, text, text, date, bigint, text, text, jsonb) from public, anon;
  revoke all on function public.move_manager_card(uuid, text) from public, anon;
  grant execute on function public.save_manager_board(uuid, text) to authenticated, service_role;
  grant execute on function public.save_manager_card(uuid, uuid, text, text, date, bigint, text, text, jsonb) to authenticated, service_role;
  grant execute on function public.move_manager_card(uuid, text) to authenticated, service_role;

  drop policy if exists "the office reads the columns of the boards it sees" on public.manager_board_columns;
  drop function if exists public.manager_board_columns_readable(uuid);
  drop function if exists public.manager_card_readable(uuid, uuid);
  drop function if exists public.manager_board_visible(uuid);

  drop index if exists public.manager_board_cards_column_idx;
  alter table public.manager_board_cards drop column if exists column_id;
  drop table if exists public.manager_board_transfers;
  drop table if exists public.manager_board_columns;
  alter table public.manager_boards drop column if exists shared;

  delete from raw.push_outbox where kind = 'board_transferred' and settled_at is null;
end;
$undo$;
