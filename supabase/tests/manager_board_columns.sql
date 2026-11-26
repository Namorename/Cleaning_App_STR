-- Manager boards, stage 4 (20261126120000): who sees a board, its own columns, handing it over.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected (owner, 2026-11-26):
-- - a board is its owner's alone unless shared; an older client's create (no visibility said)
--   makes it its owner's alone, with the four columns of the technicians' board;
-- - a board not shared: another manager reads nothing of it (board, cards, steps, journal,
--   columns) and reaches nothing by its id; an admin sees and changes it; a cleaner, a technician,
--   a head technician and reception see no board at all;
-- - a card on it given to another manager: he reads and works that card (fields, column, steps,
--   journal) and reads the board's columns, not the board or its other cards; he does not shelve,
--   copy or reassign it;
-- - columns: the owner and an admin add, rename, order, mark finishing and delete; a title of
--   1..40, up to 12; the last stays; a column with cards is deleted only with a column to move
--   them to, each with a «moved» line; the four keys follow the columns, and an older client moves
--   and makes cards by them without a loss;
-- - handing over: the owner or an admin, to an active manager or admin of the company only; one
--   transfer row with no words and one push to the new owner; the old owner of a board not shared
--   loses it but keeps the card given to him; a new card is the new owner's.
--
-- Fixture ids live under b0a3c…. Dates are from current_date.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.refusal(statement text)
returns text language plpgsql as $$
declare
  v_hint text;
begin
  execute statement;
  return 'allowed';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return case when v_hint like 'serverErrors.%' then v_hint else sqlstate end;
end $$;

create or replace function pg_temp.host() returns uuid language sql immutable as $$
  select 'b0a3c000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.other_host() returns uuid language sql immutable as $$
  select 'b0a3c000-0000-4000-8000-00000000000b'::uuid $$;
create or replace function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('b0a3c0' || lpad(n::text, 2, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.boss()   returns uuid language sql immutable as $$ select pg_temp.uid(1) $$;
create or replace function pg_temp.ina()    returns uuid language sql immutable as $$ select pg_temp.uid(2) $$;
create or replace function pg_temp.ada()    returns uuid language sql immutable as $$ select pg_temp.uid(3) $$;
create or replace function pg_temp.anna()   returns uuid language sql immutable as $$ select pg_temp.uid(4) $$;
create or replace function pg_temp.tom()    returns uuid language sql immutable as $$ select pg_temp.uid(5) $$;
create or replace function pg_temp.hector() returns uuid language sql immutable as $$ select pg_temp.uid(6) $$;
create or replace function pg_temp.dora()   returns uuid language sql immutable as $$ select pg_temp.uid(7) $$;
create or replace function pg_temp.olga()   returns uuid language sql immutable as $$ select pg_temp.uid(8) $$;
create or replace function pg_temp.rita()   returns uuid language sql immutable as $$ select pg_temp.uid(9) $$;
create or replace function pg_temp.max()    returns uuid language sql immutable as $$ select pg_temp.uid(10) $$;
create or replace function pg_temp.who(person uuid) returns text language sql immutable as $$
  select case person
    when pg_temp.boss() then 'boss' when pg_temp.ina() then 'ina' when pg_temp.ada() then 'ada'
    when pg_temp.max() then 'max' else coalesce(person::text, '-') end $$;
create or replace function pg_temp.as_user(person uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', '{"sub":"' || person || '","role":"authenticated"}', true) $$;
create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;

create or replace function pg_temp.bid(n integer) returns uuid language sql immutable as $$
  select ('b0a3c100-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.cid(n integer) returns uuid language sql immutable as $$
  select ('b0a3c200-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.sid(n integer) returns uuid language sql immutable as $$
  select ('b0a3c300-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.eid(n integer) returns uuid language sql immutable as $$
  select ('b0a3c400-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.kid(n integer) returns uuid language sql immutable as $$
  select ('b0a3c500-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

/** What a person reads of one board: board, cards, steps, journal lines, live columns. */
create or replace function pg_temp.reads(person uuid, board uuid) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_user(person);
  select (select count(*) from public.manager_boards where id = board) || ' ' ||
         (select count(*) from public.manager_board_cards where board_id = board) || ' ' ||
         (select count(*) from public.manager_board_steps s
          join public.manager_board_cards c on c.id = s.card_id where c.board_id = board) || ' ' ||
         (select count(*) from public.manager_board_entries e
          join public.manager_board_cards c on c.id = e.card_id where c.board_id = board) || ' ' ||
         (select count(*) from public.manager_board_columns where board_id = board and deleted_at is null)
    into v;
  perform pg_temp.as_server();
  return v;
end $$;

/** The board's live columns as «name:key[:done]» in order (a preset's name is its key). */
create or replace function pg_temp.columns(board uuid) returns text language sql as $$
  select string_agg(coalesce(col.title, col.preset) || ':' || col.legacy_key
                    || case when col.is_done then ':done' else '' end, ' | ' order by col.position)
  from public.manager_board_columns col where col.board_id = board and col.deleted_at is null $$;

/** The id of a board's live column by its name or preset. */
create or replace function pg_temp.col(board uuid, name text) returns uuid language sql as $$
  select col.id from public.manager_board_columns col
  where col.board_id = board and col.deleted_at is null and coalesce(col.title, col.preset) = name $$;

/** Where a card stands: «column name:key». */
create or replace function pg_temp.at(card uuid) returns text language sql as $$
  select coalesce(col.title, col.preset) || ':' || c.column_key
  from public.manager_board_cards c join public.manager_board_columns col on col.id = c.column_id
  where c.id = card $$;

-- ---------- fixtures ----------

insert into public.hosts (id, name) values
  (pg_temp.host(), 'Columns company'), (pg_temp.other_host(), 'Columns elsewhere');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
select pg_temp.uid(u.n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       lower(u.name) || '.columns1126@test.local', 'x', now(), now(),
       jsonb_build_object('full_name', u.name), jsonb_build_object('role', u.role)
from (values (1, 'Boss', 'manager'), (2, 'Ina', 'manager'), (3, 'Ada', 'admin'),
             (4, 'Anna', 'cleaner'), (5, 'Tom', 'tech'), (6, 'Hector', 'head_tech'),
             (7, 'Dora', 'manager'), (8, 'Olga', 'manager'), (9, 'Rita', 'reception'),
             (10, 'Max', 'manager')) u(n, name, role);
update public.profiles
set host_id = case when id = pg_temp.olga() then pg_temp.other_host() else pg_temp.host() end
where id in (select pg_temp.uid(n) from generate_series(1, 10) n);
update public.profiles set is_active = false where id = pg_temp.dora();

-- ===========================================================================
-- 1. Visibility: a new board, an older client's call
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('1.1 an older client''s create (no visibility said) makes a board its owner''s alone',
  (select b.shared::text || ' ' || pg_temp.who(b.owner_id) from public.save_manager_board(pg_temp.bid(1), 'Private') b),
  'false boss');
select pg_temp.check('1.2 with the four columns of the technicians'' board, the last finishing',
  pg_temp.columns(pg_temp.bid(1)), 'open:open | assigned:assigned | in_progress:in_progress | resolved:resolved:done');
select pg_temp.check('1.3 a board made shared is shared',
  (select b.shared from public.save_manager_board(pg_temp.bid(2), 'Shared', true) b), true);
select pg_temp.check('1.4 a rename that says nothing of visibility leaves it',
  (select b.title || ' ' || b.shared::text from public.save_manager_board(pg_temp.bid(2), 'Shared board') b),
  'Shared board true');

select public.save_manager_card(pg_temp.cid(1), pg_temp.bid(1), 'Hidden card', 'plan', current_date + 2, null, null, 'open', '["Step one"]');
select public.save_manager_card(pg_temp.cid(2), pg_temp.bid(1), 'Card for Ina', '', null, null, null, 'in_progress');
select public.save_manager_comment(pg_temp.eid(1), pg_temp.cid(1), 'Boss note');
select public.save_manager_card(pg_temp.cid(3), pg_temp.bid(2), 'Open card', '', null, null, null, 'open');
select pg_temp.as_server();

select pg_temp.check('1.5 the owner reads her board not shared whole',
  pg_temp.reads(pg_temp.boss(), pg_temp.bid(1)), '1 2 1 1 4');
select pg_temp.check('1.6 another manager reads nothing of it',
  pg_temp.reads(pg_temp.ina(), pg_temp.bid(1)), '0 0 0 0 0');
select pg_temp.check('1.7 an admin reads it whole',
  pg_temp.reads(pg_temp.ada(), pg_temp.bid(1)), '1 2 1 1 4');
select pg_temp.check('1.8 a cleaner, a technician, a head technician and reception read no board',
  array[pg_temp.reads(pg_temp.anna(), pg_temp.bid(2)), pg_temp.reads(pg_temp.tom(), pg_temp.bid(2)),
        pg_temp.reads(pg_temp.hector(), pg_temp.bid(2)), pg_temp.reads(pg_temp.rita(), pg_temp.bid(2))],
  array['0 0 0 0 0', '0 0 0 0 0', '0 0 0 0 0', '0 0 0 0 0']);
select pg_temp.check('1.9 another manager reads the shared board as before',
  pg_temp.reads(pg_temp.ina(), pg_temp.bid(2)), '1 1 0 0 4');

select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('1.10 another manager reaches nothing of the board not shared, by any id',
  array[pg_temp.refusal(format('select public.save_manager_card(%L, %L, ''x'', '''', null, null, null, ''open'')', pg_temp.cid(90), pg_temp.bid(1))),
        pg_temp.refusal(format('select public.save_manager_card(%L, %L, ''x'', '''', null, null, null)', pg_temp.cid(1), pg_temp.bid(1))),
        pg_temp.refusal(format('select public.move_manager_card(%L, ''resolved'')', pg_temp.cid(1))),
        pg_temp.refusal(format('select public.set_manager_card_state(%L, ''archived'')', pg_temp.cid(1))),
        pg_temp.refusal(format('select public.duplicate_manager_card(%L, %L, ''x'')', pg_temp.cid(1), pg_temp.cid(91))),
        pg_temp.refusal(format('select public.set_manager_card_assignee(%L, null)', pg_temp.cid(1))),
        pg_temp.refusal(format('select public.save_manager_step(%L, %L, ''x'')', pg_temp.sid(90), pg_temp.cid(1))),
        pg_temp.refusal(format('select public.save_manager_comment(%L, %L, ''x'')', pg_temp.eid(90), pg_temp.cid(1))),
        pg_temp.refusal(format('select public.save_manager_board(%L, ''Mine'')', pg_temp.bid(1))),
        pg_temp.refusal(format('select public.set_manager_board_archived(%L, true)', pg_temp.bid(1))),
        pg_temp.refusal(format('select public.transfer_manager_board(%L, %L)', pg_temp.bid(1), pg_temp.ina())),
        pg_temp.refusal(format('select public.save_manager_board_column(%L, %L, ''Mine'')', pg_temp.kid(90), pg_temp.bid(1)))],
  array['serverErrors.boardNotFound', 'serverErrors.boardCardNotFound', 'serverErrors.boardCardNotFound',
        'serverErrors.boardCardNotFound', 'serverErrors.boardCardNotFound', 'serverErrors.boardCardNotFound',
        'serverErrors.boardCardNotFound', 'serverErrors.boardCardNotFound', 'serverErrors.boardNotFound',
        'serverErrors.boardNotFound', 'serverErrors.boardNotFound', 'serverErrors.boardNotFound']);
select pg_temp.check('1.11 another manager may not make the shared board private, nor rename it',
  pg_temp.refusal(format('select public.save_manager_board(%L, ''Shared board'', false)', pg_temp.bid(2))),
  'serverErrors.boardNotYours');

select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('1.12 an admin changes who sees it',
  (select b.shared from public.save_manager_board(pg_temp.bid(1), 'Private', true) b), true);
select pg_temp.check('1.13 then the other manager reads it',
  pg_temp.reads(pg_temp.ina(), pg_temp.bid(1)), '1 2 1 1 4');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('1.14 its owner makes it hers alone again',
  (select b.shared from public.save_manager_board(pg_temp.bid(1), 'Private', false) b), false);
select pg_temp.check('1.15 and the other manager reads nothing again',
  pg_temp.reads(pg_temp.ina(), pg_temp.bid(1)), '0 0 0 0 0');

-- ===========================================================================
-- 2. A card given to another manager on a board not shared
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select public.set_manager_card_assignee(pg_temp.cid(2), pg_temp.ina());
select pg_temp.as_server();
select pg_temp.check('2.1 the assignee reads his card, its journal and the board''s columns — not the board, not the other card',
  pg_temp.reads(pg_temp.ina(), pg_temp.bid(1)), '0 1 0 1 4');

select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('2.2 he moves it, by a column',
  (select pg_temp.at(c.id) from public.move_manager_card(pg_temp.cid(2), null, pg_temp.col(pg_temp.bid(1), 'resolved')) c),
  'resolved:resolved');
select pg_temp.check('2.3 he changes its fields and writes in its journal and steps',
  array[pg_temp.refusal(format('select public.save_manager_card(%L, %L, ''Card for Ina, done'', ''x'', null, null, ''teal'')', pg_temp.cid(2), pg_temp.bid(1))),
        pg_temp.refusal(format('select public.save_manager_comment(%L, %L, ''On it'')', pg_temp.eid(2), pg_temp.cid(2))),
        pg_temp.refusal(format('select public.save_manager_step(%L, %L, ''Call'')', pg_temp.sid(2), pg_temp.cid(2)))],
  array['allowed', 'allowed', 'allowed']);
select pg_temp.check('2.4 he does not shelve, copy or reassign it, and makes no card on the board',
  array[pg_temp.refusal(format('select public.set_manager_card_state(%L, ''archived'')', pg_temp.cid(2))),
        pg_temp.refusal(format('select public.duplicate_manager_card(%L, %L, ''x'')', pg_temp.cid(2), pg_temp.cid(92))),
        pg_temp.refusal(format('select public.set_manager_card_assignee(%L, %L)', pg_temp.cid(2), pg_temp.max())),
        pg_temp.refusal(format('select public.save_manager_card(%L, %L, ''x'', '''', null, null, null, ''open'')', pg_temp.cid(93), pg_temp.bid(1)))],
  array['serverErrors.boardCardNotFound', 'serverErrors.boardCardNotFound', 'serverErrors.boardCardNotFound',
        'serverErrors.boardNotFound']);
select pg_temp.check('2.5 nor the other card, nor the board''s columns',
  array[pg_temp.refusal(format('select public.move_manager_card(%L, ''resolved'')', pg_temp.cid(1))),
        pg_temp.refusal(format('select public.save_manager_board_column(%L, %L, ''x'')', pg_temp.kid(91), pg_temp.bid(1)))],
  array['serverErrors.boardCardNotFound', 'serverErrors.boardNotFound']);

select pg_temp.as_user(pg_temp.boss());
select public.set_manager_card_assignee(pg_temp.cid(2), pg_temp.max());
select pg_temp.as_server();
select pg_temp.check('2.6 taken from him, he reads nothing of the board again',
  pg_temp.reads(pg_temp.ina(), pg_temp.bid(1)), '0 0 0 0 0');
select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('2.7 and reaches nothing',
  pg_temp.refusal(format('select public.move_manager_card(%L, ''open'')', pg_temp.cid(2))),
  'serverErrors.boardCardNotFound');

select pg_temp.as_user(pg_temp.boss());
select public.set_manager_board_archived(pg_temp.bid(1), true);
select pg_temp.as_server();
select pg_temp.check('2.8 on an archived board not shared the assignee reads nothing',
  pg_temp.reads(pg_temp.max(), pg_temp.bid(1)), '0 0 0 0 0');
select pg_temp.as_user(pg_temp.boss());
select public.set_manager_board_archived(pg_temp.bid(1), false);
select pg_temp.as_server();
select pg_temp.check('2.9 brought back, he reads his card again, with its step and four journal lines',
  pg_temp.reads(pg_temp.max(), pg_temp.bid(1)), '0 1 1 4 4');

-- ===========================================================================
-- 3. Columns
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('3.1 the owner adds a column at the end',
  (select coalesce(c.title, '') from public.save_manager_board_column(pg_temp.kid(1), pg_temp.bid(2), ' Waiting for parts ') c),
  'Waiting for parts');
select pg_temp.check('3.2 the columns and their keys',
  pg_temp.columns(pg_temp.bid(2)),
  'open:open | assigned:assigned | in_progress:assigned | resolved:resolved:done | Waiting for parts:in_progress');
select pg_temp.check('3.3 a repeat of the add answers the same column',
  (select c.title || ' ' || (select count(*) from public.manager_board_columns x where x.board_id = pg_temp.bid(2))::text
   from public.save_manager_board_column(pg_temp.kid(1), pg_temp.bid(2), 'Waiting for parts') c),
  'Waiting for parts 5');
select pg_temp.check('3.4 a card stays in its column',
  pg_temp.at(pg_temp.cid(3)), 'open:open');
select pg_temp.check('3.5 the owner renames a column, a preset one too',
  array[(select c.title from public.save_manager_board_column(pg_temp.kid(1), null, 'Parts') c),
        (select c.title from public.save_manager_board_column(pg_temp.col(pg_temp.bid(2), 'open'), null, 'Inbox') c)],
  array['Parts', 'Inbox']);
select pg_temp.check('3.6 a column needs a title, of up to 40 characters',
  array[pg_temp.refusal(format('select public.save_manager_board_column(%L, null, %L)', pg_temp.kid(1), E' \t')),
        pg_temp.refusal(format('select public.save_manager_board_column(%L, %L, %L)', pg_temp.kid(2), pg_temp.bid(2), repeat('x', 41)))],
  array['serverErrors.boardColumnTitleInvalid', 'serverErrors.boardColumnTitleInvalid']);
select pg_temp.check('3.7 the owner orders the columns; the keys follow the order',
  (select pg_temp.columns(pg_temp.bid(2))
   from public.order_manager_board_columns(pg_temp.bid(2), array[
     pg_temp.col(pg_temp.bid(2), 'Inbox'), pg_temp.col(pg_temp.bid(2), 'Parts'),
     pg_temp.col(pg_temp.bid(2), 'assigned'), pg_temp.col(pg_temp.bid(2), 'in_progress'),
     pg_temp.col(pg_temp.bid(2), 'resolved')])),
  'Inbox:open | Parts:assigned | assigned:assigned | in_progress:in_progress | resolved:resolved:done');
select pg_temp.check('3.8 an order that misses a column is refused',
  pg_temp.refusal(format('select public.order_manager_board_columns(%L, array[%L]::uuid[])',
                         pg_temp.bid(2), pg_temp.col(pg_temp.bid(2), 'Inbox'))),
  'serverErrors.taskChangedMeanwhile');
select pg_temp.check('3.9 a second finishing column; the keys follow',
  (select pg_temp.columns(pg_temp.bid(2))
   from public.set_manager_board_column_done(pg_temp.col(pg_temp.bid(2), 'in_progress'), true)),
  'Inbox:open | Parts:assigned | assigned:in_progress | in_progress:resolved:done | resolved:resolved:done');
select public.set_manager_board_column_done(pg_temp.col(pg_temp.bid(2), 'in_progress'), false);

select pg_temp.check('3.10 an empty column is deleted, and stays as a row',
  (select pg_temp.columns(pg_temp.bid(2)) || ' / ' ||
          (select count(*) from public.manager_board_columns c where c.board_id = pg_temp.bid(2))::text
   from public.delete_manager_board_column(pg_temp.col(pg_temp.bid(2), 'assigned'))),
  'Inbox:open | Parts:assigned | in_progress:in_progress | resolved:resolved:done / 5');

select public.save_manager_card(pg_temp.cid(4), pg_temp.bid(2), 'In parts', '', null, null, null, null, null, pg_temp.col(pg_temp.bid(2), 'Parts'));
select public.save_manager_card(pg_temp.cid(5), pg_temp.bid(2), 'Archived in parts', '', null, null, null, null, null, pg_temp.col(pg_temp.bid(2), 'Parts'));
select public.set_manager_card_state(pg_temp.cid(5), 'archived');
select pg_temp.check('3.11 a column with cards is not deleted without a column for them',
  pg_temp.refusal(format('select public.delete_manager_board_column(%L)', pg_temp.col(pg_temp.bid(2), 'Parts'))),
  'serverErrors.boardColumnHasCards');
select pg_temp.check('3.12 nor into itself, nor into another board''s column',
  array[pg_temp.refusal(format('select public.delete_manager_board_column(%L, %L)', pg_temp.col(pg_temp.bid(2), 'Parts'), pg_temp.col(pg_temp.bid(2), 'Parts'))),
        pg_temp.refusal(format('select public.delete_manager_board_column(%L, %L)', pg_temp.col(pg_temp.bid(2), 'Parts'), pg_temp.col(pg_temp.bid(1), 'open')))],
  array['serverErrors.boardColumnHasCards', 'serverErrors.boardColumnHasCards']);
select public.delete_manager_board_column(pg_temp.col(pg_temp.bid(2), 'Parts'), pg_temp.col(pg_temp.bid(2), 'in_progress'));
select pg_temp.check('3.13 deleted with a column: every card moves there, archived ones too, none lost',
  array[pg_temp.at(pg_temp.cid(4)), pg_temp.at(pg_temp.cid(5)),
        (select count(*)::text from public.manager_board_cards where board_id = pg_temp.bid(2))],
  array['in_progress:in_progress', 'in_progress:in_progress', '3']);
select pg_temp.check('3.14 each with a «moved» line naming both columns and keys, no words',
  (select count(*)::text || ' ' || bool_and(e.facts ?& array['from', 'to', 'from_column', 'to_column']
                                           and e.author_id = pg_temp.boss() and e.body is null)::text
   from public.manager_board_entries e
   where e.card_id in (pg_temp.cid(4), pg_temp.cid(5)) and e.kind = 'moved'),
  '2 true');
select pg_temp.check('3.15 a repeat of the delete changes nothing',
  pg_temp.refusal(format('select public.delete_manager_board_column(%L)',
    (select id from public.manager_board_columns where board_id = pg_temp.bid(2) and title = 'Parts'))),
  'allowed');

select public.delete_manager_board_column(pg_temp.col(pg_temp.bid(2), 'Inbox'), pg_temp.col(pg_temp.bid(2), 'in_progress'));
select public.delete_manager_board_column(pg_temp.col(pg_temp.bid(2), 'resolved'), pg_temp.col(pg_temp.bid(2), 'in_progress'));
select pg_temp.check('3.16 the last column stays',
  pg_temp.refusal(format('select public.delete_manager_board_column(%L)', pg_temp.col(pg_temp.bid(2), 'in_progress'))),
  'serverErrors.boardColumnLast');
select pg_temp.check('3.17 a board of one column not finishing: every card in it, key open',
  (select pg_temp.columns(pg_temp.bid(2)) || ' / ' || string_agg(distinct c.column_key, ',')
   from public.manager_board_cards c where c.board_id = pg_temp.bid(2)),
  'in_progress:open / open');

select pg_temp.check('3.18 up to 12 columns',
  (select string_agg(pg_temp.refusal(format('select public.save_manager_board_column(%L, %L, %L)',
                                            pg_temp.kid(10 + n), pg_temp.bid(2), 'Column ' || n)), ',' order by n)
   from generate_series(1, 12) n),
  'allowed,allowed,allowed,allowed,allowed,allowed,allowed,allowed,allowed,allowed,allowed,serverErrors.boardTooManyColumns');

select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('3.19 another manager changes no column of a shared board',
  array[pg_temp.refusal(format('select public.save_manager_board_column(%L, %L, ''x'')', pg_temp.kid(30), pg_temp.bid(2))),
        pg_temp.refusal(format('select public.save_manager_board_column(%L, null, ''x'')', pg_temp.kid(11))),
        pg_temp.refusal(format('select public.set_manager_board_column_done(%L, true)', pg_temp.kid(11))),
        pg_temp.refusal(format('select public.delete_manager_board_column(%L)', pg_temp.kid(11)))],
  array['serverErrors.boardNotYours', 'serverErrors.boardNotYours', 'serverErrors.boardNotYours',
        'serverErrors.boardNotYours']);
select pg_temp.check('3.20 but works on its cards in any column',
  (select pg_temp.at(c.id) from public.move_manager_card(pg_temp.cid(3), null, pg_temp.kid(11)) c),
  'Column 1:assigned');

select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('3.21 an admin changes the columns of any board',
  (select c.title from public.save_manager_board_column(pg_temp.kid(11), null, 'Admin named') c), 'Admin named');

-- ===========================================================================
-- 4. An older client on a board of its own columns
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select public.save_manager_board(pg_temp.bid(3), 'Mixed', true);
select public.save_manager_board_column(pg_temp.kid(40), pg_temp.bid(3), 'Waiting');
select public.order_manager_board_columns(pg_temp.bid(3), array[
  pg_temp.col(pg_temp.bid(3), 'open'), pg_temp.col(pg_temp.bid(3), 'assigned'),
  pg_temp.col(pg_temp.bid(3), 'in_progress'), pg_temp.kid(40), pg_temp.col(pg_temp.bid(3), 'resolved')]);
select pg_temp.check('4.1 the board: open, assigned, assigned, in_progress, resolved',
  pg_temp.columns(pg_temp.bid(3)),
  'open:open | assigned:assigned | in_progress:assigned | Waiting:in_progress | resolved:resolved:done');

select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('4.2 an older client makes a card by a key: the first column of that stage',
  (select pg_temp.at(c.id) from public.save_manager_card(pg_temp.cid(40), pg_temp.bid(3), 'Old phone', '', null, null, null, 'in_progress') c),
  'Waiting:in_progress');
select pg_temp.check('4.3 a move by a key: the first column of the stage',
  (select pg_temp.at(c.id) from public.move_manager_card(pg_temp.cid(40), 'assigned') c),
  'assigned:assigned');
select public.move_manager_card(pg_temp.cid(40), null, pg_temp.col(pg_temp.bid(3), 'in_progress'));
select pg_temp.check('4.4 a move by the key its column already stands for moves nothing and writes no line',
  (select pg_temp.at(c.id) || ' ' || (select count(*) from public.manager_board_entries e
                                      where e.card_id = pg_temp.cid(40) and e.kind = 'moved')::text
   from public.move_manager_card(pg_temp.cid(40), 'assigned') c),
  'in_progress:assigned 2');
select pg_temp.check('4.5 the older client reads one of the four keys for every card',
  (select bool_and(c.column_key in ('open', 'assigned', 'in_progress', 'resolved'))
   from public.manager_board_cards c where c.board_id in (pg_temp.bid(2), pg_temp.bid(3))), true);
select pg_temp.check('4.6 an older client''s create naming no column lands in open',
  (select pg_temp.at(c.id) from public.save_manager_card(pg_temp.cid(41), pg_temp.bid(3), 'No column', '', null, null, null) c),
  'open:open');
select pg_temp.check('4.7 an unknown key is refused, a column of another board too',
  array[pg_temp.refusal(format('select public.move_manager_card(%L, ''waiting'')', pg_temp.cid(40))),
        pg_temp.refusal(format('select public.move_manager_card(%L, null, %L)', pg_temp.cid(40), pg_temp.kid(11)))],
  array['serverErrors.boardColumnUnknown', 'serverErrors.boardColumnNotFound']);

select pg_temp.as_user(pg_temp.boss());
select public.set_manager_board_column_done(pg_temp.col(pg_temp.bid(3), 'resolved'), false);
select pg_temp.check('4.8 no finishing column: an older client''s «resolved» lands in the nearest stage',
  (select pg_temp.at(c.id) from public.move_manager_card(pg_temp.cid(41), 'resolved') c),
  'resolved:in_progress');
select pg_temp.check('4.9 a copy, written with a key only, gets the first column of its stage',
  (select pg_temp.at(c.id) from public.duplicate_manager_card(pg_temp.cid(40), pg_temp.cid(42), 'Copy') c),
  'open:open');
select pg_temp.as_server();
insert into public.manager_board_cards (id, host_id, board_id, title, column_key, created_by)
values (pg_temp.cid(43), pg_temp.host(), pg_temp.bid(3), 'Written by hand', 'in_progress', pg_temp.boss());
select pg_temp.check('4.10 a row written with a key only gets a column too',
  pg_temp.at(pg_temp.cid(43)), 'resolved:in_progress');
select pg_temp.check('4.11 a column of another board is refused even to the server',
  pg_temp.refusal(format('update public.manager_board_cards set column_id = %L where id = %L',
                         pg_temp.kid(11), pg_temp.cid(43))),
  'serverErrors.boardColumnUnknown');

-- ===========================================================================
-- 5. Handing a board over
-- ===========================================================================

delete from raw.push_outbox where host_id = pg_temp.host();

select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('5.1 another manager does not hand over a board not his, even a shared one',
  pg_temp.refusal(format('select public.transfer_manager_board(%L, %L)', pg_temp.bid(3), pg_temp.ina())),
  'serverErrors.boardNotYours');

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('5.2 not to a person switched off, reception, a technician, a head technician, a cleaner, another company or nobody',
  array[pg_temp.refusal(format('select public.transfer_manager_board(%L, %L)', pg_temp.bid(1), pg_temp.dora())),
        pg_temp.refusal(format('select public.transfer_manager_board(%L, %L)', pg_temp.bid(1), pg_temp.rita())),
        pg_temp.refusal(format('select public.transfer_manager_board(%L, %L)', pg_temp.bid(1), pg_temp.tom())),
        pg_temp.refusal(format('select public.transfer_manager_board(%L, %L)', pg_temp.bid(1), pg_temp.hector())),
        pg_temp.refusal(format('select public.transfer_manager_board(%L, %L)', pg_temp.bid(1), pg_temp.anna())),
        pg_temp.refusal(format('select public.transfer_manager_board(%L, %L)', pg_temp.bid(1), pg_temp.olga())),
        pg_temp.refusal(format('select public.transfer_manager_board(%L, null)', pg_temp.bid(1)))],
  array['serverErrors.boardTransferInvalid', 'serverErrors.boardTransferInvalid', 'serverErrors.boardTransferInvalid',
        'serverErrors.boardTransferInvalid', 'serverErrors.boardTransferInvalid', 'serverErrors.boardTransferInvalid',
        'serverErrors.boardTransferInvalid']);
select pg_temp.check('5.3 the owner hands her board not shared to another manager',
  (select pg_temp.who(b.owner_id) || ' ' || b.shared::text from public.transfer_manager_board(pg_temp.bid(1), pg_temp.ina()) b),
  'ina false');
select pg_temp.as_server();
select pg_temp.check('5.4 one transfer row: who had it, who got it, who did it — no words',
  (select string_agg(pg_temp.who(t.from_id) || '>' || pg_temp.who(t.to_id) || ' by ' || pg_temp.who(t.by_id), ',')
   from public.manager_board_transfers t where t.board_id = pg_temp.bid(1)),
  'boss>ina by boss');
select pg_temp.check('5.5 one push to the new owner, the board''s id only',
  (select string_agg(pg_temp.who(o.recipient_id) || ' ' || o.kind::text || ' ' || o.params::text
                     || ' ' || o.collapse_key, ',')
   from raw.push_outbox o where o.host_id = pg_temp.host()),
  'ina board_transferred {"board_id": "' || pg_temp.bid(1) || '"} board:' || pg_temp.bid(1));
select pg_temp.check('5.6 cards and their assignees stay as they were',
  (select string_agg(c.title || ':' || pg_temp.who(c.assignee_id), ',' order by c.title)
   from public.manager_board_cards c where c.board_id = pg_temp.bid(1)),
  'Card for Ina, done:max,Hidden card:boss');
select pg_temp.check('5.7 the old owner of a board not shared loses it, but keeps the card given to her',
  pg_temp.reads(pg_temp.boss(), pg_temp.bid(1)), '0 1 1 1 4');
select pg_temp.check('5.8 the new owner reads it whole',
  pg_temp.reads(pg_temp.ina(), pg_temp.bid(1)), '1 2 2 5 4');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('5.9 and the old owner may not hand it over again, nor rename it',
  array[pg_temp.refusal(format('select public.transfer_manager_board(%L, %L)', pg_temp.bid(1), pg_temp.boss())),
        pg_temp.refusal(format('select public.save_manager_board(%L, ''Back'')', pg_temp.bid(1)))],
  array['serverErrors.boardNotFound', 'serverErrors.boardNotFound']);

select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('5.10 a new card is the new owner''s',
  (select pg_temp.who(c.assignee_id) from public.save_manager_card(pg_temp.cid(50), pg_temp.bid(1), 'After', '', null, null, null, 'open') c),
  'ina');
select pg_temp.check('5.11 handing it to its owner again changes nothing',
  (select pg_temp.who(b.owner_id) from public.transfer_manager_board(pg_temp.bid(1), pg_temp.ina()) b),
  'ina');
select pg_temp.as_server();
select pg_temp.check('5.11a no row, no push',
  (select count(*) from public.manager_board_transfers t where t.board_id = pg_temp.bid(1))::text || ' ' ||
  (select count(*) from raw.push_outbox o where o.host_id = pg_temp.host())::text,
  '1 1');

select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('5.12 an admin hands anybody''s board over, even to herself',
  array[(select pg_temp.who(b.owner_id) from public.transfer_manager_board(pg_temp.bid(1), pg_temp.max()) b),
        (select pg_temp.who(b.owner_id) from public.transfer_manager_board(pg_temp.bid(2), pg_temp.ada()) b)],
  array['max', 'ada']);
select pg_temp.as_server();
select pg_temp.check('5.13 the new owner gets a push, an admin who took it herself none',
  (select string_agg(pg_temp.who(o.recipient_id), ',' order by o.id)
   from raw.push_outbox o where o.host_id = pg_temp.host() and o.kind = 'board_transferred'),
  'ina,max');
select pg_temp.check('5.14 the transfer and push functions read no words of the boards',
  (select bool_and(p.prosrc !~ '\m(title|body|description)\M') from pg_proc p
   where p.oid in ('public.push_on_board_transferred()'::regprocedure,
                   'public.transfer_manager_board(uuid, uuid)'::regprocedure)), true);

select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('5.15 a cleaner hands nothing over',
  pg_temp.refusal(format('select public.transfer_manager_board(%L, %L)', pg_temp.bid(3), pg_temp.anna())),
  'serverErrors.managerOnly');

-- ===========================================================================
-- 6. send-push's reads and the rights on the functions
-- ===========================================================================

select pg_temp.as_server();
select pg_temp.check('6.1 the push of a transfer reads the board''s title and owner now',
  (select t.board_title || ' ' || pg_temp.who(t.owner_id) || ' ' || t.is_live::text
   from public.push_board_titles(array[pg_temp.bid(1)]) t),
  'Private max true');
select pg_temp.check('6.2 a card given on a board not shared to somebody who does not see it: no board title',
  (select coalesce(t.board_title, '-') || ' ' || t.card_title
   from public.push_board_card_titles(array[pg_temp.cid(1)]) t),
  '- Hidden card');
select pg_temp.check('6.3 its owner''s card names the board',
  (select coalesce(t.board_title, '-') || ' ' || t.card_title
   from public.push_board_card_titles(array[pg_temp.cid(2)]) t),
  'Private Card for Ina, done');
select pg_temp.check('6.4 no client reads the titles for a push, nor a transfer row',
  array[(select bool_or(has_function_privilege(r, 'public.push_board_titles(uuid[])', 'execute'))
         from unnest(array['anon', 'authenticated']) r),
        (select bool_or(has_table_privilege(r, 'public.manager_board_transfers', 'select'))
         from unnest(array['anon', 'authenticated']) r)],
  array[false, false]);
select pg_temp.check('6.5 anon may call no new board function',
  (select bool_or(has_function_privilege('anon', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('transfer_manager_board', 'save_manager_board_column', 'order_manager_board_columns',
                       'set_manager_board_column_done', 'delete_manager_board_column', 'manager_board_visible',
                       'manager_card_readable', 'manager_board_columns_readable', 'push_board_titles')),
  false);
select pg_temp.check('6.6 no client calls the internal helpers',
  (select bool_or(has_function_privilege('authenticated', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('manager_board_column_for', 'manager_board_relabel', 'manager_column_for_edit',
                       'manager_board_cards_column', 'manager_boards_first_columns', 'push_on_board_transferred')),
  false);

rollback;
