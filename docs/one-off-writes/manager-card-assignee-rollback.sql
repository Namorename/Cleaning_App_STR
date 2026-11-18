-- Rollback of 20261118230000_manager_card_assignee (stage 2 of docs/manager-boards.md). A WRITE to
-- the cloud: only on the owner's word, never in 03:00–04:40 UTC, in the reverse order of the rollout
-- (docs/rollout/manager-card-assignee-1118.md): OTA republish of the previous groups, git revert
-- and the panel, send-push of before, the data's undo (manager-cards-owner-assignee-rollback.sql),
-- then this; last `npx supabase migration repair --status reverted 20261118230000 --linked`.
--
--   npx supabase db query --linked -f docs/one-off-writes/manager-card-assignee-rollback.sql
--
-- What it does: the three function bodies of 20261118200000 come back (the rights of a card's work
-- are the owner's and an admin's again, a new card has no assignee); set_manager_card_assignee,
-- push_board_card_titles and the journal's push trigger (push_on_card_assigned) go; the journal's lines «assignee changed» go (codes and ids, no words —
-- the check of the journal's kinds cannot come back with them in it); the column goes with the
-- assignments. The push kind board_card_assigned stays in the enum (a value cannot be dropped): a
-- send-push of before sets such a row aside as skipped.
--
-- One statement (the CLI's db query takes one): a do block with the bodies as dynamic SQL.
do $rollback$
begin
  perform set_config('lock_timeout', '3s', true);

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'manager_board_cards' and column_name = 'assignee_id'
  ) then
    raise exception 'Migration 20261118230000 is not in this database: nothing to roll back';
  end if;

  execute $fn$
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
  $fn$;

  execute $fn$
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
  $fn$;

  execute $fn$
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
  $fn$;

  drop trigger manager_board_entries_push_assigned on public.manager_board_entries;
  drop function public.push_on_card_assigned();
  drop function public.set_manager_card_assignee(uuid, uuid);
  drop function public.push_board_card_titles(uuid[]);

  delete from public.manager_board_entries e where e.kind = 'assignee_changed';
  alter table public.manager_board_entries
    drop constraint manager_board_entries_kind_known,
    add constraint manager_board_entries_kind_known
      check (kind in ('comment', 'moved', 'due_changed', 'step_done'));

  alter table public.manager_board_cards drop column assignee_id;
end;
$rollback$;
