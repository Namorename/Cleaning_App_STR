-- API v1 reads the managers' boards and adds cards to them (owner, 2026-11-26, CORE;
-- docs/api-v1.md, docs/manager-boards.md «API v1»).
--
-- The owner's word of 2026-11-26: the boards, their columns and their cards are read through the
-- API and the MCP server, and a new card is made on a board named by its title. Nothing else of
-- the boards is written there; until now they were internal by his word of 2026-11-18.
--
-- Rights are the panel's. A key acts as the admin who made it (a key works while its maker is an
-- active admin of the company, api_key_state), and an admin sees every board of the company —
-- shared or not, archived too. The reads apply the panel's rule (manager_board_visible) with the
-- key's maker in place of the caller (api_board_visible); the write goes through
-- save_manager_card as him (api_act_as), so the board's lock, its archive rule, the column check,
-- the first assignee (the board's owner) and the steps are the panel's own.
--
-- What is read: board titles and column names as they are (names the office gave them, which a
-- card is filed under by title); card titles and descriptions with door codes masked as a task's
-- are (api_mask_codes, text_masked); steps as counts; people as ids. No journal: comments stay in
-- the panel.
--
-- A key limited to some properties reads the boards and their columns (they belong to no
-- property, as the staff and the settings do) and only the cards of its properties; it makes a
-- card only on one of them.
--
-- Additive: two scopes, four helpers and three api_v1_* functions; no table, column, policy or
-- grant on a table changes.

set local lock_timeout = '3s';

-- The scope registry (packages/shared/src/api/registry.json); the parity test compares this block
-- with it (20261028100000).
-- api-scopes:begin
insert into public.api_scopes (id, scope_group, action, sensitivity, status, operator) values
  ('boards:read', 'boards', 'read', 'normal', 'exposed', false),
  ('boards:create_cards', 'boards', 'write', 'normal', 'exposed', true)
on conflict (id) do update
  set scope_group = excluded.scope_group,
      action      = excluded.action,
      sensitivity = excluded.sensitivity,
      status      = excluded.status,
      operator    = excluded.operator;
-- api-scopes:end

-- ---------- helpers ----------

/**
 * Whether the key's maker sees the board, by the panel's rule (manager_board_visible): the board
 * is the company's and shared, his own, or he is an active admin. A working key's maker is an
 * active admin, so today that is every board of the company.
 */
create function public.api_board_visible(p_ctx public.api_context, p_board public.manager_boards)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_board.host_id = p_ctx.host_id
     and (p_board.shared
          or p_board.owner_id = p_ctx.owner_id
          or exists (select 1 from public.profiles pr
                     where pr.id = p_ctx.owner_id and pr.host_id = p_ctx.host_id
                       and pr.is_active and pr.role = 'admin'))
$$;

comment on function public.api_board_visible(public.api_context, public.manager_boards) is
  'API plumbing: whether the key''s maker sees a manager board, by the panel''s rule (20261126140000).';

/**
 * A column's name in the API: the title people gave it, or for a preset column nobody renamed its
 * preset key (open, assigned, in_progress, resolved), which the panel shows in the reader's
 * language.
 */
create function public.api_board_column_name(p_column public.manager_board_columns)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_column.title, p_column.preset)
$$;

comment on function public.api_board_column_name(public.manager_board_columns) is
  'API plumbing: a board column''s name — its title, or its preset key (20261126140000).';

/** A board in the API: its title, owner, visibility, archive and its live columns in order. */
create function public.api_board_json(p_board public.manager_boards)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_board.id,
    'title', p_board.title,
    'owner_id', p_board.owner_id,
    'shared', p_board.shared,
    'archived', p_board.archived_at is not null,
    'archived_at', public.api_ts(p_board.archived_at),
    'created_at', public.api_ts(p_board.created_at),
    'updated_at', public.api_ts(p_board.updated_at),
    'columns', coalesce((
      select jsonb_agg(jsonb_build_object(
                         'id', col.id,
                         'name', public.api_board_column_name(col),
                         'preset', col.preset,
                         'position', col.position,
                         'is_done', col.is_done,
                         'stage', col.legacy_key)
                       order by col.position, col.created_at, col.id)
      from public.manager_board_columns col
      where col.board_id = p_board.id and col.deleted_at is null), '[]'::jsonb))
$$;

comment on function public.api_board_json(public.manager_boards) is
  'API plumbing: what a manager board looks like in the API, with its live columns (20261126140000).';

/** A card in the API: its words with codes masked, its column, its steps as counts. */
create function public.api_board_card_json(p_card public.manager_board_cards)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_card.id,
    'board_id', p_card.board_id,
    'column_id', p_card.column_id,
    'column_name', (select public.api_board_column_name(col)
                    from public.manager_board_columns col where col.id = p_card.column_id),
    'stage', p_card.column_key,
    'title', public.api_mask_codes(p_card.title),
    'description', nullif(public.api_mask_codes(p_card.description), ''),
    'text_masked', public.api_mask_codes(p_card.title) is distinct from p_card.title
                   or public.api_mask_codes(p_card.description) is distinct from p_card.description,
    'due_on', p_card.due_on,
    'color', p_card.color,
    'property_id', p_card.property_id,
    'assignee_id', p_card.assignee_id,
    'created_by', p_card.created_by,
    'steps_done', steps.done,
    'steps_total', steps.total,
    'archived', p_card.archived_at is not null,
    'deleted', p_card.deleted_at is not null,
    'moved_at', public.api_ts(p_card.moved_at),
    'archived_at', public.api_ts(p_card.archived_at),
    'deleted_at', public.api_ts(p_card.deleted_at),
    'created_at', public.api_ts(p_card.created_at),
    'updated_at', public.api_ts(p_card.updated_at))
  from (select (count(*) filter (where s.done_at is not null))::integer as done,
               count(*)::integer as total
        from public.manager_board_steps s
        where s.card_id = p_card.id) steps
$$;

comment on function public.api_board_card_json(public.manager_board_cards) is
  'API plumbing: what a manager board card looks like in the API (20261126140000).';

-- ---------- reads ----------

/**
 * GET /v1/boards — the boards the key's maker sees, oldest first; archived ones only when asked;
 * `title` finds a board by its title, whatever the case and the spaces around it.
 */
create function public.api_v1_list_boards(
  p_digest           text,
  p_title            text default null,
  p_include_archived boolean default false,
  p_after_created    timestamptz default null,
  p_after_id         uuid default null,
  p_limit            integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'boards:read');
begin
  return (
    -- _sort: created_at at full precision, for the cursor; the function strips it.
    select coalesce(jsonb_agg(public.api_board_json(b) || jsonb_build_object('_sort', b.created_at)
                              order by b.created_at, b.id), '[]'::jsonb)
    from (select mb.* from public.manager_boards mb
          where mb.host_id = v_ctx.host_id
            and public.api_board_visible(v_ctx, mb)
            and (coalesce(p_include_archived, false) or mb.archived_at is null)
            and (p_title is null
                 or lower(btrim(mb.title, E' \t\r\n')) = lower(btrim(p_title, E' \t\r\n')))
            and (p_after_id is null or (mb.created_at, mb.id) > (p_after_created, p_after_id))
          order by mb.created_at, mb.id
          limit least(greatest(p_limit, 1), 200) + 1) b);
end;
$$;

comment on function public.api_v1_list_boards(text, text, boolean, timestamptz, uuid, integer) is
  'API v1 listBoards: the manager boards the key''s maker sees, with their columns (20261126140000).';

/**
 * GET /v1/boards/{id}/cards — the cards of a board the key's maker sees, oldest first; archived and
 * deleted ones only when asked. A key limited to some properties reads the cards of its
 * properties alone. A board of another company, or one he does not see, is not found.
 */
create function public.api_v1_list_board_cards(
  p_digest           text,
  p_board_id         uuid,
  p_column_id        uuid default null,
  p_assignee_id      uuid default null,
  p_property_id      bigint default null,
  p_include_archived boolean default false,
  p_updated_since    timestamptz default null,
  p_after_created    timestamptz default null,
  p_after_id         uuid default null,
  p_limit            integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx   public.api_context := public.api_authorize(p_digest, 'boards:read');
  v_board public.manager_boards;
begin
  select mb.* into v_board
  from public.manager_boards mb
  where mb.id = p_board_id and mb.host_id = v_ctx.host_id;
  if not found or not public.api_board_visible(v_ctx, v_board) then
    perform public.api_not_found('Board');
  end if;

  return (
    select coalesce(jsonb_agg(public.api_board_card_json(c) || jsonb_build_object('_sort', c.created_at)
                              order by c.created_at, c.id), '[]'::jsonb)
    from (select bc.* from public.manager_board_cards bc
          where bc.board_id = v_board.id
            and bc.host_id = v_ctx.host_id
            and (v_ctx.allowed is null or public.api_allows_property(v_ctx, bc.property_id))
            and (coalesce(p_include_archived, false) or (bc.archived_at is null and bc.deleted_at is null))
            and (p_column_id is null or bc.column_id = p_column_id)
            and (p_assignee_id is null or bc.assignee_id = p_assignee_id)
            and (p_property_id is null or bc.property_id = p_property_id)
            -- A card changes with its steps and its column's name too (steps_done, steps_total,
            -- column_name), which do not touch the card's own updated_at.
            and (p_updated_since is null
                 or bc.updated_at >= p_updated_since
                 or exists (select 1 from public.manager_board_steps s
                            where s.card_id = bc.id and s.updated_at >= p_updated_since)
                 or exists (select 1 from public.manager_board_columns col
                            where col.id = bc.column_id and col.updated_at >= p_updated_since))
            and (p_after_id is null or (bc.created_at, bc.id) > (p_after_created, p_after_id))
          order by bc.created_at, bc.id
          limit least(greatest(p_limit, 1), 200) + 1) c);
end;
$$;

comment on function public.api_v1_list_board_cards(text, uuid, uuid, uuid, bigint, boolean, timestamptz,
                                                    timestamptz, uuid, integer) is
  'API v1 listBoardCards: the cards of a manager board the key''s maker sees (20261126140000).';

-- ---------- the write ----------

/**
 * POST /v1/board-cards — a card on a board named by its id or by its title, written by
 * save_manager_card as the key's maker.
 *
 * The board: `board_id`, or `board_title` — the one live board the maker sees whose title it is,
 * whatever the case and the spaces around it; none is not found, several are refused with their
 * ids. The column: `column_id`, or `column_name` — the board's one live column of that name
 * (a title, or a preset key); neither puts the card in the board's first column that is not a
 * finishing one, as the panel's new card. The card's assignee is the board's owner, as in the
 * panel; its author is the key's maker.
 */
create function public.api_v1_create_board_card(
  p_digest          text,
  p_idempotency_key text,
  p_request_hash    text,
  p_title           text,
  p_board_id        uuid default null,
  p_board_title     text default null,
  p_column_id       uuid default null,
  p_column_name     text default null,
  p_description     text default null,
  p_due_on          date default null,
  p_property_id     bigint default null,
  p_color           text default null,
  p_steps           jsonb default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ctx       public.api_context := public.api_authorize(p_digest, 'boards:create_cards');
  v_replay    jsonb;
  v_board     public.manager_boards;
  v_ids       jsonb;
  v_column_id uuid;
  v_card      public.manager_board_cards;
begin
  if (p_board_id is null) = (p_board_title is null) then
    raise exception 'Name the board by board_id or by board_title, one of the two'
      using errcode = 'invalid_parameter_value', hint = 'api:invalid-request',
            detail = jsonb_build_object('name', 'board_id')::text;
  end if;
  if p_column_id is not null and p_column_name is not null then
    raise exception 'Name the column by column_id or by column_name, not both'
      using errcode = 'invalid_parameter_value', hint = 'api:invalid-request',
            detail = jsonb_build_object('name', 'column_id')::text;
  end if;

  v_replay := public.api_idempotency_claim(v_ctx.key_id, p_idempotency_key, 'createBoardCard',
                                           p_request_hash);
  if v_replay is not null then
    return v_replay;
  end if;

  if v_ctx.allowed is not null and not public.api_allows_property(v_ctx, p_property_id) then
    raise exception 'The key may not write on property %', p_property_id
      using errcode = 'insufficient_privilege', hint = 'api:property-not-allowed',
            detail = jsonb_build_object('property_id', p_property_id)::text;
  end if;

  if p_board_id is not null then
    select mb.* into v_board
    from public.manager_boards mb
    where mb.id = p_board_id and mb.host_id = v_ctx.host_id;
    if not found or not public.api_board_visible(v_ctx, v_board) then
      perform public.api_not_found('Board');
    end if;
  else
    select coalesce(jsonb_agg(mb.id order by mb.created_at, mb.id), '[]'::jsonb) into v_ids
    from public.manager_boards mb
    where mb.host_id = v_ctx.host_id
      and mb.archived_at is null
      and public.api_board_visible(v_ctx, mb)
      and lower(btrim(mb.title, E' \t\r\n')) = lower(btrim(p_board_title, E' \t\r\n'));
    if jsonb_array_length(v_ids) = 0 then
      raise exception 'No live board has this title'
        using errcode = 'no_data_found', hint = 'api:not-found',
              detail = jsonb_build_object('reason', 'board-title-unknown')::text;
    end if;
    if jsonb_array_length(v_ids) > 1 then
      raise exception 'Several live boards have this title'
        using errcode = 'check_violation', hint = 'api:rejected',
              detail = jsonb_build_object('reason', 'board-title-ambiguous', 'board_ids', v_ids)::text;
    end if;
    select mb.* into v_board from public.manager_boards mb where mb.id = (v_ids ->> 0)::uuid;
  end if;

  if p_column_name is not null then
    select coalesce(jsonb_agg(col.id order by col.position, col.created_at, col.id), '[]'::jsonb)
      into v_ids
    from public.manager_board_columns col
    where col.board_id = v_board.id
      and col.deleted_at is null
      and lower(btrim(public.api_board_column_name(col), E' \t\r\n'))
          = lower(btrim(p_column_name, E' \t\r\n'));
    if jsonb_array_length(v_ids) = 0 then
      raise exception 'The board has no live column of this name'
        using errcode = 'no_data_found', hint = 'api:not-found',
              detail = jsonb_build_object('reason', 'column-name-unknown')::text;
    end if;
    if jsonb_array_length(v_ids) > 1 then
      raise exception 'The board has several live columns of this name'
        using errcode = 'check_violation', hint = 'api:rejected',
              detail = jsonb_build_object('reason', 'column-name-ambiguous', 'column_ids', v_ids)::text;
    end if;
    v_column_id := (v_ids ->> 0)::uuid;
  else
    -- A column of another board, or deleted, is refused by save_manager_card.
    v_column_id := coalesce(p_column_id, public.manager_board_column_for(v_board.id, 'open'));
  end if;

  perform public.api_act_as(v_ctx.owner_id);
  v_card := public.save_manager_card(
    p_id          => gen_random_uuid(),
    p_board_id    => v_board.id,
    p_title       => p_title,
    p_description => p_description,
    p_due_on      => p_due_on,
    p_property_id => p_property_id,
    p_color       => p_color,
    p_column      => null,
    p_steps       => p_steps,
    p_column_id   => v_column_id);

  return public.api_idempotency_store(v_ctx.key_id, p_idempotency_key, 201,
                                      public.api_board_card_json(v_card));
end;
$$;

comment on function public.api_v1_create_board_card(text, text, text, text, uuid, text, uuid, text, text,
                                                     date, bigint, text, jsonb) is
  'API v1 createBoardCard: a card on a manager board named by id or title, through '
  'save_manager_card as the key''s maker (20261126140000).';

-- ---------- who may call what ----------

-- The helpers are the operations' alone; the operations are the Edge Function's (service_role),
-- as every api_v1_* function (20261028100000, «who may call what»).
revoke all on function public.api_board_visible(public.api_context, public.manager_boards)
  from public, anon, authenticated, service_role;
revoke all on function public.api_board_column_name(public.manager_board_columns)
  from public, anon, authenticated, service_role;
revoke all on function public.api_board_json(public.manager_boards)
  from public, anon, authenticated, service_role;
revoke all on function public.api_board_card_json(public.manager_board_cards)
  from public, anon, authenticated, service_role;
revoke all on function public.api_v1_list_boards(text, text, boolean, timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.api_v1_list_board_cards(text, uuid, uuid, uuid, bigint, boolean, timestamptz,
                                                      timestamptz, uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.api_v1_create_board_card(text, text, text, text, uuid, text, uuid, text, text,
                                                       date, bigint, text, jsonb)
  from public, anon, authenticated, service_role;

grant execute on function public.api_v1_list_boards(text, text, boolean, timestamptz, uuid, integer)
  to service_role;
grant execute on function public.api_v1_list_board_cards(text, uuid, uuid, uuid, bigint, boolean, timestamptz,
                                                         timestamptz, uuid, integer)
  to service_role;
grant execute on function public.api_v1_create_board_card(text, text, text, text, uuid, text, uuid, text, text,
                                                          date, bigint, text, jsonb)
  to service_role;
