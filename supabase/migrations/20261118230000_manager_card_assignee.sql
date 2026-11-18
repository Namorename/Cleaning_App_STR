-- The assignee of a manager board card (owner, 2026-11-18, CORE; docs/manager-boards.md, stage 2).
--
-- A card gets an optional assignee: an active manager or admin of the company (the people who read
-- the boards). A new card — made, or copied — is its board owner's. The owner and an admin assign,
-- reassign and clear it (set_manager_card_assignee); the assignee then works on that card as they
-- do — its fields and due date, its steps, its journal, its column — but not on the board: renaming
-- or archiving the board, archiving, deleting, returning or copying the card, and the assignment
-- itself stay the owner's and an admin's.
--
-- A change of assignee leaves a system line in the card's journal with the two people's ids, never
-- a name; its trigger tells the new assignee by one push («Вам назначена карточка», the board and
-- the card), unless they assigned it to themselves. The push's row carries the card's id only:
-- send-push reads the two titles when it sends (push_board_card_titles, service_role only), so the
-- words stay in the boards' tables.
--
-- Additive: a nullable column, a widened check of the journal's kinds, a push kind, three functions
-- and a trigger; three function bodies change (the rights of a card's work, and the assignee of a
-- new card). An
-- older phone never reads the column; the boards' phone of OTA 23 skips a journal kind it does not
-- know.

set local lock_timeout = '3s';

alter table public.manager_board_cards
  add column assignee_id uuid references public.profiles (id) on delete set null;

comment on column public.manager_board_cards.assignee_id is
  'Who works on the card: an active manager or admin of the company, or nobody (20261118230000).';

create index manager_board_cards_assignee_idx on public.manager_board_cards (assignee_id)
  where assignee_id is not null;

-- The journal's lines gain the change of assignee: {"from": uuid | null, "to": uuid | null}.
alter table public.manager_board_entries
  drop constraint manager_board_entries_kind_known,
  add constraint manager_board_entries_kind_known
    check (kind in ('comment', 'moved', 'due_changed', 'step_done', 'assignee_changed'));

-- Beside the work's kinds, before problem_new, which sits right before the conversation (head_tech_push.sql).
alter type public.push_kind add value if not exists 'board_card_assigned' before 'problem_new';

-- The rights of a card's work and the assignee of a new card: three bodies of 20261118200000.

create or replace function public.manager_card_for_edit(p_card_id uuid, p_shelved_ok boolean)
returns public.manager_board_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_board_id uuid;
  v_board    public.manager_boards;
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

  if p_shelved_ok then
    -- A card's shelf and its copy are the board's: its owner and an admin.
    perform public.manager_board_for_edit(v_board_id, false);
  else
    select b.* into v_board
    from public.manager_boards b
    where b.id = v_board_id
    for share;
    if v_board.archived_at is not null then
      raise exception 'Board % is archived', v_board_id
        using errcode = 'check_violation', hint = 'serverErrors.boardArchived';
    end if;
  end if;

  select c.* into v_card
  from public.manager_board_cards c
  where c.id = p_card_id
  for update;

  -- The work on a card — its fields, its steps, its journal, its column — is also its
  -- assignee's (20261118230000); the board itself stays its owner's and an admin's.
  if not p_shelved_ok
     and v_board.owner_id is distinct from (select auth.uid())
     and public.auth_role() is distinct from 'admin'
     and v_card.assignee_id is distinct from (select auth.uid()) then
    raise exception 'Only the owner of board %, its assignee or an admin may change card %', v_board_id, p_card_id
      using errcode = 'insufficient_privilege', hint = 'serverErrors.boardNotYours';
  end if;
  if (v_card.archived_at is not null or v_card.deleted_at is not null) and not p_shelved_ok then
    raise exception 'Card % is archived or deleted', p_card_id
      using errcode = 'check_violation', hint = 'serverErrors.boardCardShelved';
  end if;
  return v_card;
end;
$$;

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
$$;

/**
 * Assigns a card to an active manager or admin of the company, or clears it (null). The board's
 * owner and an admin; never on an archived board or a shelved card. A change leaves a line in the
 * journal; the line's trigger tells the new assignee (push_on_card_assigned). The same assignee
 * again changes nothing.
 */
create or replace function public.set_manager_card_assignee(p_id uuid, p_assignee_id uuid)
returns public.manager_board_cards
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_card  public.manager_board_cards := public.manager_card_for_edit(p_id, true);
  v_from  uuid;
begin
  if v_card.archived_at is not null or v_card.deleted_at is not null then
    raise exception 'Card % is archived or deleted', p_id
      using errcode = 'check_violation', hint = 'serverErrors.boardCardShelved';
  end if;
  -- A repeat first: the card as it stands, even if its assignee can no longer be given one.
  if v_card.assignee_id is not distinct from p_assignee_id then
    return v_card;
  end if;
  if p_assignee_id is not null and not exists (
    select 1 from public.profiles p
    where p.id = p_assignee_id
      and p.host_id = v_card.host_id
      and p.is_active
      and p.role in ('manager', 'admin')
  ) then
    raise exception 'Person % cannot be assigned a card', p_assignee_id
      using errcode = 'check_violation', hint = 'serverErrors.boardAssigneeInvalid';
  end if;
  v_from := v_card.assignee_id;

  update public.manager_board_cards c
  set assignee_id = p_assignee_id, updated_at = now()
  where c.id = v_card.id
  returning c.* into v_card;

  insert into public.manager_board_entries (id, host_id, card_id, kind, facts, author_id)
  values (gen_random_uuid(), v_card.host_id, v_card.id, 'assignee_changed',
          jsonb_build_object('from', v_from, 'to', p_assignee_id), (select auth.uid()));
  return v_card;
end;
$$;

comment on function public.set_manager_card_assignee(uuid, uuid) is
  'Assigns a card of a manager board, or clears it; a journal line and one push (20261118230000).';

revoke all on function public.set_manager_card_assignee(uuid, uuid) from public, anon;
grant execute on function public.set_manager_card_assignee(uuid, uuid) to authenticated;

/**
 * «Вам назначена карточка»: the line «assignee changed» queues one push to the new assignee, unless
 * nobody is (cleared) or they gave it to themselves. The row carries the card's id only — send-push
 * reads the titles when it sends. A trigger, as every push of the work: no client calls into raw.
 */
create or replace function public.push_on_card_assigned()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_to    uuid := (new.facts ->> 'to')::uuid;
  v_after timestamptz;
begin
  if v_to is null or v_to is not distinct from new.author_id then
    return null;
  end if;
  v_after := public.push_send_after(false);
  insert into raw.push_outbox (host_id, recipient_id, kind, collapse_key, params, urgent,
                               send_after, expire_at)
  values (new.host_id, v_to, 'board_card_assigned', 'card:' || new.card_id,
          jsonb_build_object('card_id', new.card_id), false, v_after,
          v_after + public.push_lifetime());
  return null;
end;
$$;

comment on function public.push_on_card_assigned() is
  'Queues «a card assigned to you» for the new assignee of a manager board card (20261118230000).';

revoke all on function public.push_on_card_assigned() from public, anon, authenticated;

create trigger manager_board_entries_push_assigned
  after insert on public.manager_board_entries
  for each row
  when (new.kind = 'assignee_changed')
  execute function public.push_on_card_assigned();

/**
 * The words of a card-assigned push, read by send-push when it sends (never stored with the push):
 * each card's title and its board's, for the ids asked — and whether the push is still news: who
 * holds the card now, and whether it is on a live board, not archived or deleted. A push queued at
 * night and sent in the morning about a card given to somebody else since is not sent. A card not
 * found is left out.
 */
create or replace function public.push_board_card_titles(p_card_ids uuid[])
returns table (card_id uuid, card_title text, board_title text, assignee_id uuid, is_live boolean)
language sql
stable
set search_path = ''
as $$
  select c.id, c.title, b.title, c.assignee_id,
         c.archived_at is null and c.deleted_at is null and b.archived_at is null
  from public.manager_board_cards c
  join public.manager_boards b on b.id = c.board_id
  where c.id = any (p_card_ids);
$$;

comment on function public.push_board_card_titles(uuid[]) is
  'The card and board titles of a card-assigned push, for send-push at the send (20261118230000).';

revoke all on function public.push_board_card_titles(uuid[]) from public, anon, authenticated;
grant execute on function public.push_board_card_titles(uuid[]) to service_role;
