-- API v1 and the managers' boards (20261126140000; docs/api-v1.md, docs/manager-boards.md
-- «API v1»). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected (owner, 2026-11-26):
--   * boards:read is an ordinary read (it joins «read only»), boards:create_cards an operator's
--     write; a key without them reaches nothing of the boards;
--   * a key sees the boards its maker sees by the panel's rule — an admin's key every board of
--     its company, private ones included — and nothing of another company;
--   * a card's words come with door codes masked, its steps as counts, people as ids;
--   * a key limited to some properties reads the cards of its properties alone and makes a card
--     only on one of them;
--   * a card is made on a board named by its title (case and surrounding spaces aside) among the
--     live boards, through save_manager_card as the key's maker: the board's first column that is
--     not finishing unless a column is named, the board's owner its assignee, the maker its
--     author, the steps written; an unknown title is not found, a title two boards share is
--     refused with their ids, an archived board takes no card;
--   * an idempotency key replays the first answer, refuses another body, forgets a failure;
--   * only service_role executes the operations; the helpers nobody but the operations.
--
-- Fixture ids live under c1ab….
begin;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.raises(label text, stmt text, want_hint text)
returns void language plpgsql as $$
declare
  v_hint  text;
  v_state text;
begin
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
    if nullif(v_hint, '') is distinct from want_hint then
      raise exception 'FAIL % — hint %, want % (%)', label, v_hint, want_hint, v_state;
    end if;
    raise notice 'ok  %', label;
    return;
  end;
  raise exception 'FAIL % — no error, want %', label, want_hint;
end $$;

/** The detail (the API's params) of the error a statement raises; null when it does not. */
create or replace function pg_temp.detail(stmt text)
returns jsonb language plpgsql as $$
declare
  v_detail text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return nullif(v_detail, '')::jsonb;
end $$;

-- The digest the Edge Function would send for a key: a plain sha256 of a name stands in for
-- HMAC(pepper, key), as in api_v1.sql.
create or replace function pg_temp.d(t text) returns text language sql as $$
  select encode(sha256(convert_to(t, 'UTF8')), 'hex')
$$;

create or replace function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_id::text, true);
$$;

create or replace function pg_temp.host() returns uuid language sql immutable as $$
  select 'c1ab0000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.other_host() returns uuid language sql immutable as $$
  select 'c1ab0000-0000-4000-8000-00000000000b'::uuid $$;
create or replace function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('c1ab00' || lpad(n::text, 2, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.ada() returns uuid language sql immutable as $$ select pg_temp.uid(1) $$;
create or replace function pg_temp.mia() returns uuid language sql immutable as $$ select pg_temp.uid(2) $$;
create or replace function pg_temp.max() returns uuid language sql immutable as $$ select pg_temp.uid(3) $$;
create or replace function pg_temp.bob() returns uuid language sql immutable as $$ select pg_temp.uid(4) $$;
create or replace function pg_temp.bid(n integer) returns uuid language sql immutable as $$
  select ('c1ab0100-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.cid(n integer) returns uuid language sql immutable as $$
  select ('c1ab0200-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.kid(n integer) returns uuid language sql immutable as $$
  select ('c1ab0300-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

/** A board's live column by its name (title, or preset key). */
create or replace function pg_temp.col(board uuid, name text) returns uuid language sql as $$
  select c.id from public.manager_board_columns c
  where c.board_id = board and c.deleted_at is null and coalesce(c.title, c.preset) = name $$;

/** createBoardCard as the Edge Function calls it: the body's fields as arguments. */
create or replace function pg_temp.card(k text, idem text, body jsonb) returns jsonb language sql as $$
  select public.api_v1_create_board_card(
    p_digest          => pg_temp.d(k),
    p_idempotency_key => idem,
    p_request_hash    => encode(sha256(convert_to(body::text, 'UTF8')), 'hex'),
    p_title           => body ->> 'title',
    p_board_id        => (body ->> 'board_id')::uuid,
    p_board_title     => body ->> 'board_title',
    p_column_id       => (body ->> 'column_id')::uuid,
    p_column_name     => body ->> 'column_name',
    p_description     => body ->> 'description',
    p_due_on          => (body ->> 'due_on')::date,
    p_property_id     => (body ->> 'property_id')::bigint,
    p_color           => body ->> 'color',
    p_steps           => body -> 'steps')
$$;

/** The titles of what a list answered, in its order. */
create or replace function pg_temp.titles(list jsonb) returns text language sql as $$
  select coalesce(string_agg(x ->> 'title', '|' order by n), '') from jsonb_array_elements(list) with ordinality t(x, n)
$$;

-- ---------- fixtures ----------

insert into public.hosts (id, name) values
  (pg_temp.host(), 'Boards API company'), (pg_temp.other_host(), 'Boards API elsewhere');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
select pg_temp.uid(u.n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       lower(u.name) || '.apiboards1126@test.local', 'x', now(), now(),
       jsonb_build_object('full_name', u.name), jsonb_build_object('role', u.role)
from (values (1, 'Ada', 'admin'), (2, 'Mia', 'manager'), (3, 'Max', 'manager'),
             (4, 'Bob', 'admin')) u(n, name, role);
update public.profiles
set host_id = case when id = pg_temp.bob() then pg_temp.other_host() else pg_temp.host() end
where id in (select pg_temp.uid(n) from generate_series(1, 4) n);

insert into public.properties (id, host_id, name, timezone) values
  (900286001, pg_temp.host(), 'Boards House', 'Europe/Prague'),
  (900286002, pg_temp.host(), 'Boards Flat', 'Europe/Prague'),
  (900286901, pg_temp.other_host(), 'Elsewhere Flat', 'Europe/Prague');

do $fixtures$
begin
  -- Mia's boards: one shared, one her own alone, two whose titles differ only by case, one archived.
  perform pg_temp.as_user(pg_temp.mia());
  perform public.save_manager_board(pg_temp.bid(1), 'Renovation', true);
  perform public.save_manager_board(pg_temp.bid(2), 'Private plans', false);
  perform public.save_manager_board(pg_temp.bid(3), 'Kitchen', true);
  perform public.save_manager_board(pg_temp.bid(4), 'KITCHEN', true);
  perform public.save_manager_board(pg_temp.bid(5), 'Old stuff', true);
  perform public.set_manager_board_archived(pg_temp.bid(5), true);
  -- Two columns of her own on Renovation: one named, one that clashes with the preset «open».
  perform public.save_manager_board_column(pg_temp.kid(1), pg_temp.bid(1), 'Waiting for parts');
  perform public.save_manager_board_column(pg_temp.kid(2), pg_temp.bid(1), 'OPEN');

  perform public.save_manager_card(pg_temp.cid(1), pg_temp.bid(1), 'Paint the hall', 'Two coats', null,
                                   900286001, 'blue', 'open', '["Buy paint", "Paint"]'::jsonb);
  perform public.save_manager_card(pg_temp.cid(2), pg_temp.bid(1), 'Lockbox code 4821', '', null,
                                   900286002, null, 'open', null);
  perform public.save_manager_card(pg_temp.cid(3), pg_temp.bid(1), 'Office chairs', '', '2026-12-01',
                                   null, null, 'open', null);
  perform public.save_manager_card(pg_temp.cid(4), pg_temp.bid(1), 'Archived one', '', null,
                                   900286001, null, 'open', null);
  perform public.save_manager_card(pg_temp.cid(5), pg_temp.bid(1), 'Deleted one', '', null,
                                   900286001, null, 'open', null);
  perform public.set_manager_card_state(pg_temp.cid(4), 'archived');
  perform public.set_manager_card_state(pg_temp.cid(5), 'deleted');
  perform public.set_manager_step_done(
    (select s.id from public.manager_board_steps s where s.card_id = pg_temp.cid(1) and s.sort_order = 1), true);
  perform public.save_manager_card(pg_temp.cid(6), pg_temp.bid(2), 'Secret plan', '', null,
                                   null, null, 'open', null);

  perform pg_temp.as_user(pg_temp.bob());
  perform public.save_manager_board(pg_temp.bid(9), 'Renovation', true);
  perform public.save_manager_card(pg_temp.cid(9), pg_temp.bid(9), 'Elsewhere card', '', null,
                                   null, null, 'open', null);
end;
$fixtures$;

-- Keys: all made by Ada (an active admin of the company) but Bob's.
select (public.create_api_key(pg_temp.ada(), 'Full', 'woom_bfulAAA',
          pg_temp.d('key-full'), 'full', '{}', null, null, 'Full')) ->> 'id' as k_full \gset
select (public.create_api_key(pg_temp.ada(), 'Read', 'woom_breaAAA',
          pg_temp.d('key-read'), 'read_only')) ->> 'id' as k_read \gset
select (public.create_api_key(pg_temp.ada(), 'Operator', 'woom_bopeAAA',
          pg_temp.d('key-oper'), 'operator')) ->> 'id' as k_oper \gset
select (public.create_api_key(pg_temp.ada(), 'Tasks only', 'woom_btasAAA',
          pg_temp.d('key-tasks'), 'custom', '{tasks:read}')) ->> 'id' as k_tasks \gset
select (public.create_api_key(pg_temp.ada(), 'Boards only', 'woom_bbrdAAA',
          pg_temp.d('key-bread'), 'custom', '{boards:read}')) ->> 'id' as k_bread \gset
select (public.create_api_key(pg_temp.ada(), 'One house', 'woom_bhouAAA',
          pg_temp.d('key-house'), 'operator', '{}', '{900286001}')) ->> 'id' as k_house \gset
select (public.create_api_key(pg_temp.bob(), 'B', 'woom_bbobAAA',
          pg_temp.d('key-b'), 'full', '{}', null, null, 'B')) ->> 'id' as k_b \gset

-- ===========================================================================
-- 1. Scopes
-- ===========================================================================

select pg_temp.check('read only reads the boards and writes nothing on them',
  (select ('boards:read' = any(s))::text || ' ' || ('boards:create_cards' = any(s))::text
   from public.api_effective_scopes('read_only', '{}') s),
  'true false');

select pg_temp.check('operator reads the boards and adds cards',
  (select ('boards:read' = any(s))::text || ' ' || ('boards:create_cards' = any(s))::text
   from public.api_effective_scopes('operator', '{}') s),
  'true true');

select pg_temp.check('both scopes are ordinary, exposed, in the group boards',
  (select string_agg(id || ':' || scope_group || ':' || sensitivity || ':' || status || ':' || operator, ' '
                     order by id)
   from public.api_scopes where scope_group = 'boards'),
  'boards:create_cards:boards:normal:exposed:true boards:read:boards:normal:exposed:false');

select pg_temp.raises('a key without boards:read lists no board',
  format('select public.api_v1_list_boards(%L)', pg_temp.d('key-tasks')), 'api:insufficient-scope');

select pg_temp.raises('a key without boards:read lists no card',
  format('select public.api_v1_list_board_cards(%L, %L)', pg_temp.d('key-tasks'), pg_temp.bid(1)),
  'api:insufficient-scope');

select pg_temp.raises('a reading key makes no card',
  $$select pg_temp.card('key-read', 's-1', '{"title": "T", "board_title": "Renovation"}')$$,
  'api:insufficient-scope');

select pg_temp.raises('boards:read alone makes no card',
  $$select pg_temp.card('key-bread', 's-2', '{"title": "T", "board_title": "Renovation"}')$$,
  'api:insufficient-scope');

-- ===========================================================================
-- 2. listBoards
-- ===========================================================================

select pg_temp.check('an admin''s key sees every live board of its company, private ones too, oldest first',
  pg_temp.titles(public.api_v1_list_boards(pg_temp.d('key-full'))),
  'Renovation|Private plans|Kitchen|KITCHEN');

select pg_temp.check('a private board says so',
  (select b ->> 'shared' from jsonb_array_elements(public.api_v1_list_boards(pg_temp.d('key-read'))) b
   where b ->> 'id' = pg_temp.bid(2)::text),
  'false');

select pg_temp.check('archived boards only when asked',
  pg_temp.titles(public.api_v1_list_boards(pg_temp.d('key-full'), p_include_archived => true)),
  'Renovation|Private plans|Kitchen|KITCHEN|Old stuff');

select pg_temp.check('a title finds a board whatever its case and surrounding spaces',
  pg_temp.titles(public.api_v1_list_boards(pg_temp.d('key-full'), p_title => '  kitchen ')),
  'Kitchen|KITCHEN');

select pg_temp.check('another company''s board of the same title is not listed',
  (select string_agg(b ->> 'id', ',')
   from jsonb_array_elements(public.api_v1_list_boards(pg_temp.d('key-full'), p_title => 'renovation')) b),
  pg_temp.bid(1)::text);

select pg_temp.check('the other company lists its own board alone',
  (select string_agg(b ->> 'id', ',')
   from jsonb_array_elements(public.api_v1_list_boards(pg_temp.d('key-b'), p_include_archived => true)) b),
  pg_temp.bid(9)::text);

select pg_temp.check('a page is one longer than the limit, for the cursor; the sort key rides along',
  (select jsonb_array_length(l)::text || ' ' || (l -> 0 ? '_sort')::text
   from public.api_v1_list_boards(pg_temp.d('key-full'), p_limit => 1) l),
  '2 true');

select pg_temp.check('the cursor leads on from the last item',
  pg_temp.titles(public.api_v1_list_boards(pg_temp.d('key-full'),
    p_after_created => (select created_at from public.manager_boards where id = pg_temp.bid(2)),
    p_after_id => pg_temp.bid(2))),
  'Kitchen|KITCHEN');

select pg_temp.check('a board''s live columns in order: names (a preset''s is its key), finishing, stages',
  (select string_agg((c ->> 'name') || ':' || (c ->> 'stage')
                     || case when (c ->> 'is_done')::boolean then ':done' else '' end, ' | ' order by n)
   from jsonb_array_elements(public.api_v1_list_boards(pg_temp.d('key-full'), p_title => 'Renovation')) b,
        jsonb_array_elements(b -> 'columns') with ordinality t(c, n)),
  'open:open | assigned:assigned | in_progress:assigned | resolved:resolved:done | Waiting for parts:assigned | OPEN:in_progress');

select pg_temp.check('a column says its preset, a column of the office''s own none',
  (select string_agg(coalesce(c ->> 'preset', '-'), ',' order by n)
   from jsonb_array_elements(public.api_v1_list_boards(pg_temp.d('key-full'), p_title => 'Renovation')) b,
        jsonb_array_elements(b -> 'columns') with ordinality t(c, n)),
  'open,assigned,in_progress,resolved,-,-');

-- The panel's rule, with a manager in the maker's place: shared and his own, not another's private.
select pg_temp.check('the visibility rule is the panel''s: a manager sees shared boards and his own only',
  (select string_agg(b.title, '|' order by b.id)
   from public.manager_boards b
   where public.api_board_visible(
           (null, pg_temp.host(), pg_temp.max(), null, '{}')::public.api_context, b)),
  'Renovation|Kitchen|KITCHEN|Old stuff');

select pg_temp.check('… and his own private board too',
  (select public.api_board_visible((null, pg_temp.host(), pg_temp.mia(), null, '{}')::public.api_context, b)
   from public.manager_boards b where b.id = pg_temp.bid(2)),
  true);

-- ===========================================================================
-- 3. listBoardCards
-- ===========================================================================

select pg_temp.check('a board''s live cards, oldest first',
  pg_temp.titles(public.api_v1_list_board_cards(pg_temp.d('key-full'), pg_temp.bid(1))),
  'Paint the hall|Lockbox|Office chairs');

select pg_temp.check('archived and deleted cards only when asked, and they say so',
  (select string_agg((c ->> 'title') || ':' || (c ->> 'archived') || ':' || (c ->> 'deleted'), ' ' order by n)
   from jsonb_array_elements(public.api_v1_list_board_cards(pg_temp.d('key-full'), pg_temp.bid(1),
                                                            p_include_archived => true)) with ordinality t(c, n)
   where c ->> 'title' like '%one'),
  'Archived one:true:false Deleted one:false:true');

select pg_temp.check('a door code in a card''s title is masked, and the card says so',
  (select (c ->> 'text_masked') || ' ' || (c::text like '%4821%')::text
   from jsonb_array_elements(public.api_v1_list_board_cards(pg_temp.d('key-full'), pg_temp.bid(1))) c
   where c ->> 'id' = pg_temp.cid(2)::text),
  'true false');

select pg_temp.check('a card: its column, stage, words, steps as counts, people as ids',
  (select concat_ws(' | ', c ->> 'column_name', c ->> 'stage', c ->> 'description', c ->> 'color',
                    c ->> 'property_id', c ->> 'steps_done', c ->> 'steps_total',
                    (c ->> 'assignee_id' = pg_temp.mia()::text)::text,
                    (c ->> 'created_by' = pg_temp.mia()::text)::text, c ->> 'text_masked')
   from jsonb_array_elements(public.api_v1_list_board_cards(pg_temp.d('key-full'), pg_temp.bid(1))) c
   where c ->> 'id' = pg_temp.cid(1)::text),
  'open | open | Two coats | blue | 900286001 | 1 | 2 | true | true | false');

select pg_temp.check('an empty description is null; a due day is a day',
  (select coalesce(c ->> 'description', 'null') || ' ' || (c ->> 'due_on')
   from jsonb_array_elements(public.api_v1_list_board_cards(pg_temp.d('key-full'), pg_temp.bid(1))) c
   where c ->> 'id' = pg_temp.cid(3)::text),
  'null 2026-12-01');

select pg_temp.check('a card names no person and carries no step''s words',
  (select bool_or(c::text like '%Mia%' or c::text like '%Buy paint%')
   from jsonb_array_elements(public.api_v1_list_board_cards(pg_temp.d('key-full'), pg_temp.bid(1))) c),
  false);

select pg_temp.check('a private board''s cards are read by an admin''s key',
  pg_temp.titles(public.api_v1_list_board_cards(pg_temp.d('key-read'), pg_temp.bid(2))),
  'Secret plan');

select pg_temp.check('filters: a column',
  pg_temp.titles(public.api_v1_list_board_cards(pg_temp.d('key-full'), pg_temp.bid(1),
                                                p_column_id => pg_temp.col(pg_temp.bid(1), 'open'))),
  'Paint the hall|Lockbox|Office chairs');

select pg_temp.check('filters: a property',
  pg_temp.titles(public.api_v1_list_board_cards(pg_temp.d('key-full'), pg_temp.bid(1),
                                                p_property_id => 900286002)),
  'Lockbox');

select pg_temp.check('a key limited to one property reads that property''s cards alone',
  pg_temp.titles(public.api_v1_list_board_cards(pg_temp.d('key-house'), pg_temp.bid(1),
                                                p_include_archived => true)),
  'Paint the hall|Archived one|Deleted one');

select pg_temp.check('… while it lists the boards and their columns',
  (select count(*)::int from jsonb_array_elements(public.api_v1_list_boards(pg_temp.d('key-house')))),
  4);

select pg_temp.raises('another company''s board is not found',
  format('select public.api_v1_list_board_cards(%L, %L)', pg_temp.d('key-b'), pg_temp.bid(1)),
  'api:not-found');

select pg_temp.raises('an unknown board is not found',
  format('select public.api_v1_list_board_cards(%L, %L)', pg_temp.d('key-full'), pg_temp.cid(1)),
  'api:not-found');

-- ===========================================================================
-- 4. createBoardCard
-- ===========================================================================

select pg_temp.card('key-oper', 'c-1',
  '{"title": "Order tiles", "board_title": "  renovation ", "description": "Two boxes",
    "due_on": "2026-12-04", "steps": ["Measure", "Ask for a quote"]}') as made \gset

select pg_temp.check('a card is made on the board named by its title, answered 201 and not a replay',
  (select concat_ws(' ', :'made'::jsonb ->> 'status', :'made'::jsonb ->> 'replayed',
                    (:'made'::jsonb -> 'body' ->> 'board_id' = pg_temp.bid(1)::text)::text)),
  '201 false true');

select pg_temp.check('… in the board''s first column that is not finishing, with its steps',
  (select concat_ws(' ', b ->> 'column_name', b ->> 'stage', b ->> 'steps_done', b ->> 'steps_total',
                    b ->> 'due_on', b ->> 'description')
   from (select :'made'::jsonb -> 'body' as b) x),
  'open open 0 2 2026-12-04 Two boxes');

select pg_temp.check('… written as the key''s maker, given to the board''s owner, as in the panel',
  (select (c.created_by = pg_temp.ada())::text || ' ' || (c.assignee_id = pg_temp.mia())::text || ' '
          || (c.column_id = pg_temp.col(pg_temp.bid(1), 'open'))::text
   from public.manager_board_cards c where c.id = (:'made'::jsonb -> 'body' ->> 'id')::uuid),
  'true true true');

select pg_temp.check('… its steps in order, and no line in its journal',
  (select string_agg(s.body, ',' order by s.sort_order) || ' '
          || (select count(*) from public.manager_board_entries e
              where e.card_id = (:'made'::jsonb -> 'body' ->> 'id')::uuid)
   from public.manager_board_steps s where s.card_id = (:'made'::jsonb -> 'body' ->> 'id')::uuid),
  'Measure,Ask for a quote 0');

select pg_temp.check('the same request again is the first answer, replayed; no second card',
  (select (r ->> 'replayed') || ' ' || ((r -> 'body' ->> 'id') = (:'made'::jsonb -> 'body' ->> 'id'))::text
          || ' ' || (select count(*) from public.manager_board_cards where title = 'Order tiles')
   from pg_temp.card('key-oper', 'c-1',
     '{"title": "Order tiles", "board_title": "  renovation ", "description": "Two boxes",
       "due_on": "2026-12-04", "steps": ["Measure", "Ask for a quote"]}') r),
  'true true 1');

select pg_temp.raises('the same idempotency key with another body is refused',
  $$select pg_temp.card('key-oper', 'c-1', '{"title": "Other", "board_title": "Renovation"}')$$,
  'api:idempotency-key-reused');

select pg_temp.check('a column named by its title, whatever the case',
  (select (pg_temp.card('key-oper', 'c-2',
            '{"title": "Wait", "board_title": "Renovation", "column_name": "waiting FOR parts"}')
           -> 'body' ->> 'column_id') = pg_temp.kid(1)::text),
  true);

select pg_temp.check('a preset column named by its key',
  (select (pg_temp.card('key-oper', 'c-3',
            '{"title": "Doing", "board_title": "Renovation", "column_name": "in_progress"}')
           -> 'body' ->> 'column_id') = pg_temp.col(pg_temp.bid(1), 'in_progress')::text),
  true);

select pg_temp.check('a column named by its id',
  (select (pg_temp.card('key-oper', 'c-4',
            format('{"title": "Done", "board_id": "%s", "column_id": "%s"}', pg_temp.bid(1),
                   pg_temp.col(pg_temp.bid(1), 'resolved'))::jsonb)
           -> 'body' ->> 'stage')),
  'resolved');

select pg_temp.check('a column name two columns share is refused with both ids',
  (select (d ->> 'reason') || ' ' || jsonb_array_length(d -> 'column_ids')
   from pg_temp.detail($$select pg_temp.card('key-oper', 'c-5',
          '{"title": "T", "board_title": "Renovation", "column_name": "open"}')$$) d),
  'column-name-ambiguous 2');

select pg_temp.raises('… as rejected',
  $$select pg_temp.card('key-oper', 'c-5', '{"title": "T", "board_title": "Renovation", "column_name": "open"}')$$,
  'api:rejected');

select pg_temp.check('an unknown column name is not found, and says why',
  (select d ->> 'reason'
   from pg_temp.detail($$select pg_temp.card('key-oper', 'c-6',
          '{"title": "T", "board_title": "Renovation", "column_name": "Nope"}')$$) d),
  'column-name-unknown');

select pg_temp.raises('a column of another board is refused by the panel''s function',
  format($$select pg_temp.card('key-oper', 'c-7', '{"title": "T", "board_title": "Renovation", "column_id": "%s"}')$$,
         pg_temp.col(pg_temp.bid(3), 'open')),
  'serverErrors.boardColumnNotFound');

select pg_temp.raises('a column by id and by name at once is a bad request',
  format($$select pg_temp.card('key-oper', 'c-8',
           '{"title": "T", "board_title": "Renovation", "column_id": "%s", "column_name": "open"}')$$,
         pg_temp.col(pg_temp.bid(1), 'open')),
  'api:invalid-request');

select pg_temp.check('a title two live boards share is refused with both ids',
  (select (d ->> 'reason') || ' ' || (d -> 'board_ids' = jsonb_build_array(pg_temp.bid(3), pg_temp.bid(4)))::text
   from pg_temp.detail($$select pg_temp.card('key-oper', 'c-9', '{"title": "T", "board_title": "kitchen"}')$$) d),
  'board-title-ambiguous true');

select pg_temp.raises('… as rejected',
  $$select pg_temp.card('key-oper', 'c-9', '{"title": "T", "board_title": "kitchen"}')$$,
  'api:rejected');

select pg_temp.check('… while by its id a board of that title takes the card',
  (select pg_temp.card('key-oper', 'c-10', format('{"title": "Tiles", "board_id": "%s"}', pg_temp.bid(4))::jsonb)
          -> 'body' ->> 'board_id'),
  pg_temp.bid(4)::text);

select pg_temp.check('an unknown title is not found, and says why',
  (select d ->> 'reason'
   from pg_temp.detail($$select pg_temp.card('key-oper', 'c-11', '{"title": "T", "board_title": "Nowhere"}')$$) d),
  'board-title-unknown');

select pg_temp.raises('… as not found',
  $$select pg_temp.card('key-oper', 'c-11', '{"title": "T", "board_title": "Nowhere"}')$$,
  'api:not-found');

select pg_temp.raises('an archived board is not found by its title',
  $$select pg_temp.card('key-oper', 'c-12', '{"title": "T", "board_title": "Old stuff"}')$$,
  'api:not-found');

select pg_temp.raises('an archived board named by its id takes no card',
  format($$select pg_temp.card('key-oper', 'c-13', '{"title": "T", "board_id": "%s"}')$$, pg_temp.bid(5)),
  'serverErrors.boardArchived');

select pg_temp.raises('neither a board id nor a title is a bad request',
  $$select pg_temp.card('key-oper', 'c-14', '{"title": "T"}')$$,
  'api:invalid-request');

select pg_temp.raises('both a board id and a title is a bad request',
  format($$select pg_temp.card('key-oper', 'c-15', '{"title": "T", "board_id": "%s", "board_title": "Renovation"}')$$,
         pg_temp.bid(1)),
  'api:invalid-request');

select pg_temp.check('a private board takes a card from an admin''s key, by its title',
  (select pg_temp.card('key-oper', 'c-16', '{"title": "Plan B", "board_title": "private PLANS"}')
          -> 'body' ->> 'board_id'),
  pg_temp.bid(2)::text);

select pg_temp.raises('another company''s board by its id is not found',
  format($$select pg_temp.card('key-oper', 'c-17', '{"title": "T", "board_id": "%s"}')$$, pg_temp.bid(9)),
  'api:not-found');

select pg_temp.check('the other company''s key, by the same title, writes on its own board',
  (select pg_temp.card('key-b', 'c-18', '{"title": "Theirs", "board_title": "Renovation"}')
          -> 'body' ->> 'board_id'),
  pg_temp.bid(9)::text);

select pg_temp.raises('a key limited to one property writes on no other',
  $$select pg_temp.card('key-house', 'c-19', '{"title": "T", "board_title": "Renovation", "property_id": 900286002}')$$,
  'api:property-not-allowed');

select pg_temp.raises('… nor a card of no property',
  $$select pg_temp.card('key-house', 'c-20', '{"title": "T", "board_title": "Renovation"}')$$,
  'api:property-not-allowed');

select pg_temp.check('… and writes on its own',
  (select pg_temp.card('key-house', 'c-21', '{"title": "House card", "board_title": "Renovation", "property_id": 900286001}')
          -> 'body' ->> 'property_id'),
  '900286001');

select pg_temp.raises('a title of spaces is the panel''s refusal',
  $$select pg_temp.card('key-oper', 'c-22', '{"title": "   ", "board_title": "Renovation"}')$$,
  'serverErrors.boardCardTitleInvalid');

select pg_temp.raises('a step of spaces is the panel''s refusal',
  $$select pg_temp.card('key-oper', 'c-23', '{"title": "T", "board_title": "Renovation", "steps": ["ok", " "]}')$$,
  'serverErrors.boardStepInvalid');

select pg_temp.raises('a property of another company is not found',
  $$select pg_temp.card('key-oper', 'c-24', '{"title": "T", "board_title": "Renovation", "property_id": 900286901}')$$,
  'serverErrors.propertyNotFound');

select pg_temp.check('a failed request leaves no idempotency key behind',
  (select count(*)::int from public.api_idempotency i
   where i.key_id = :'k_oper'::uuid and i.idem_key in ('c-5', 'c-9', 'c-11', 'c-13', 'c-22', 'c-24')),
  0);

select pg_temp.card('key-oper', 'c-25', '{"title": "Door 7731 sticks", "board_title": "Renovation"}')
  as coded \gset

select pg_temp.check('a code typed into a new card is masked in the answer, kept in the card',
  (select (:'coded'::jsonb -> 'body' ->> 'text_masked') || ' ' || (:'coded' like '%7731%')::text || ' '
          || (select c.title from public.manager_board_cards c
              where c.id = (:'coded'::jsonb -> 'body' ->> 'id')::uuid)),
  'true false Door 7731 sticks');

-- ===========================================================================
-- 5. Who may call what
-- ===========================================================================

select pg_temp.check('only service_role executes the operations; nobody the helpers',
  (select string_agg(f || ':' || r || ':' || has_function_privilege(r, f, 'execute')::text, ' ' order by f, r)
   from unnest(array[
          'public.api_v1_list_boards(text, text, boolean, timestamptz, uuid, integer)',
          'public.api_v1_list_board_cards(text, uuid, uuid, uuid, bigint, boolean, timestamptz, timestamptz, uuid, integer)',
          'public.api_v1_create_board_card(text, text, text, text, uuid, text, uuid, text, text, date, bigint, text, jsonb)',
          'public.api_board_visible(public.api_context, public.manager_boards)',
          'public.api_board_json(public.manager_boards)',
          'public.api_board_card_json(public.manager_board_cards)',
          'public.api_board_column_name(public.manager_board_columns)']) f,
        unnest(array['anon', 'authenticated', 'service_role']) r
   where has_function_privilege(r, f, 'execute') is distinct from (r = 'service_role' and f like 'public.api\_v1\_%')),
  null);

rollback;
