-- The cards of the manager boards are the whole office's (20261119090000).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected (owner, 2026-11-19):
-- - another manager, on a board not hers, makes, edits, moves, archives, returns, deletes, copies and
--   assigns cards, ticks and edits their steps and writes comments — for real, with her name;
-- - she does not rename, archive or bring back the board: that stays its owner's and an admin's;
-- - a comment is changed by its author alone and deleted by its author or an admin;
-- - a cleaner, a technician, a head technician, a manager switched off and another company reach
--   nothing — no write, no read;
-- - on an archived board nobody works on the cards;
-- - no word of a card reaches the work log or the push queue.
--
-- Fixture ids live under b0a2f…. Dates are from current_date.
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
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return case when v_hint like 'serverErrors.%' then v_hint else sqlstate end;
end $$;

create or replace function pg_temp.host() returns uuid language sql immutable as $$
  select 'b0a2f000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.other_host() returns uuid language sql immutable as $$
  select 'b0a2f000-0000-4000-8000-00000000000b'::uuid $$;
create or replace function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('b0a2f0' || lpad(n::text, 2, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.boss()   returns uuid language sql immutable as $$ select pg_temp.uid(1) $$;
create or replace function pg_temp.ina()    returns uuid language sql immutable as $$ select pg_temp.uid(2) $$;
create or replace function pg_temp.ada()    returns uuid language sql immutable as $$ select pg_temp.uid(3) $$;
create or replace function pg_temp.anna()   returns uuid language sql immutable as $$ select pg_temp.uid(4) $$;
create or replace function pg_temp.tom()    returns uuid language sql immutable as $$ select pg_temp.uid(5) $$;
create or replace function pg_temp.hector() returns uuid language sql immutable as $$ select pg_temp.uid(6) $$;
create or replace function pg_temp.dora()   returns uuid language sql immutable as $$ select pg_temp.uid(7) $$;
create or replace function pg_temp.olga()   returns uuid language sql immutable as $$ select pg_temp.uid(8) $$;
create or replace function pg_temp.who(person uuid) returns text language sql immutable as $$
  select case person
    when pg_temp.boss() then 'boss' when pg_temp.ina() then 'ina' when pg_temp.ada() then 'ada'
    else coalesce(person::text, '-') end $$;
create or replace function pg_temp.as_user(person uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', '{"sub":"' || person || '","role":"authenticated"}', true) $$;
create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;

create or replace function pg_temp.board() returns uuid language sql immutable as $$
  select 'b0a2f100-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.cid(n integer) returns uuid language sql immutable as $$
  select ('b0a2f200-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.sid(n integer) returns uuid language sql immutable as $$
  select ('b0a2f300-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.eid(n integer) returns uuid language sql immutable as $$
  select ('b0a2f400-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

/** What a person reads: boards, cards, steps and journal lines of the company's boards. */
create or replace function pg_temp.reads(person uuid) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_user(person);
  select (select count(*) from public.manager_boards where host_id = pg_temp.host()) || ' ' ||
         (select count(*) from public.manager_board_cards where host_id = pg_temp.host()) || ' ' ||
         (select count(*) from public.manager_board_steps where host_id = pg_temp.host()) || ' ' ||
         (select count(*) from public.manager_board_entries where host_id = pg_temp.host())
    into v;
  perform pg_temp.as_server();
  return v;
end $$;

/** Every write a person could try on the board and its first card, each with its refusal. */
create or replace function pg_temp.every_write(person uuid) returns text[] language plpgsql as $$
declare
  v text[];
begin
  perform pg_temp.as_user(person);
  v := array[
    pg_temp.refusal(format('select public.save_manager_card(%L, %L, ''x'', '''', null, null, null, ''open'')', pg_temp.cid(90), pg_temp.board())),
    pg_temp.refusal(format('select public.save_manager_card(%L, %L, ''x'', '''', null, null, null)', pg_temp.cid(1), pg_temp.board())),
    pg_temp.refusal(format('select public.move_manager_card(%L, ''resolved'')', pg_temp.cid(1))),
    pg_temp.refusal(format('select public.set_manager_card_state(%L, ''archived'')', pg_temp.cid(1))),
    pg_temp.refusal(format('select public.duplicate_manager_card(%L, %L, ''x'')', pg_temp.cid(1), pg_temp.cid(91))),
    pg_temp.refusal(format('select public.set_manager_card_assignee(%L, null)', pg_temp.cid(1))),
    pg_temp.refusal(format('select public.save_manager_step(%L, %L, ''x'')', pg_temp.sid(90), pg_temp.cid(1))),
    pg_temp.refusal(format('select public.set_manager_step_done(%L, true)', pg_temp.sid(1))),
    pg_temp.refusal(format('select public.delete_manager_step(%L)', pg_temp.sid(1))),
    pg_temp.refusal(format('select public.save_manager_comment(%L, %L, ''x'')', pg_temp.eid(90), pg_temp.cid(1))),
    pg_temp.refusal(format('select public.delete_manager_comment(%L)', pg_temp.eid(1))),
    pg_temp.refusal(format('select public.save_manager_board(%L, ''x'')', pg_temp.board())),
    pg_temp.refusal(format('select public.set_manager_board_archived(%L, true)', pg_temp.board()))];
  perform pg_temp.as_server();
  return v;
end $$;

-- ---------- fixtures ----------

insert into public.hosts (id, name) values
  (pg_temp.host(), 'Office company'), (pg_temp.other_host(), 'Office elsewhere');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
select pg_temp.uid(u.n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       lower(u.name) || '.office1119@test.local', 'x', now(), now(),
       jsonb_build_object('full_name', u.name), jsonb_build_object('role', u.role)
from (values (1, 'Boss', 'manager'), (2, 'Ina', 'manager'), (3, 'Ada', 'admin'),
             (4, 'Anna', 'cleaner'), (5, 'Tom', 'tech'), (6, 'Hector', 'head_tech'),
             (7, 'Dora', 'manager'), (8, 'Olga', 'manager')) u(n, name, role);
update public.profiles
set host_id = case when id = pg_temp.olga() then pg_temp.other_host() else pg_temp.host() end
where id in (select pg_temp.uid(n) from generate_series(1, 8) n);
update public.profiles set is_active = false where id = pg_temp.dora();

select pg_temp.as_user(pg_temp.boss());
select public.save_manager_board(pg_temp.board(), 'Boss board');
select public.save_manager_card(pg_temp.cid(1), pg_temp.board(), 'Bathroom', 'plan', null, null, 'blue', 'open', '["Tiles"]');
select public.save_manager_comment(pg_temp.eid(1), pg_temp.cid(1), 'Boss note');
select pg_temp.as_server();
update public.manager_board_steps set id = pg_temp.sid(1) where card_id = pg_temp.cid(1);

-- ===========================================================================
-- 1. Another manager on a board not hers: every card, for real
-- ===========================================================================

select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('1.1 she makes a card on the board, as herself; it is the owner''s by default',
  (select pg_temp.who(c.created_by) || ' ' || pg_temp.who(c.assignee_id)
   from public.save_manager_card(pg_temp.cid(2), pg_temp.board(), 'Call the plumber', '', null, null, null, 'open', '["Find a number"]') c),
  'ina boss');
select pg_temp.check('1.2 she edits a card of the owner''s',
  (select c.title || ' ' || c.color || ' ' || (c.due_on - current_date)::text
   from public.save_manager_card(pg_temp.cid(1), pg_temp.board(), 'Bathroom, tiles', 'plan', current_date + 3, null, 'teal') c),
  'Bathroom, tiles teal 3');
select pg_temp.check('1.3 she moves it between the columns',
  (select c.column_key from public.move_manager_card(pg_temp.cid(1), 'in_progress') c), 'in_progress');
select pg_temp.check('1.4 she adds a step, ticks it, edits its words, orders and deletes one',
  array[pg_temp.refusal(format('select public.save_manager_step(%L, %L, ''Buy grout'')', pg_temp.sid(2), pg_temp.cid(1))),
        pg_temp.refusal(format('select public.set_manager_step_done(%L, true)', pg_temp.sid(1))),
        pg_temp.refusal(format('select public.save_manager_step(%L, null, ''Tiles, white'')', pg_temp.sid(1))),
        pg_temp.refusal(format('select public.order_manager_steps(%L, array[%L, %L]::uuid[])', pg_temp.cid(1), pg_temp.sid(2), pg_temp.sid(1))),
        pg_temp.refusal(format('select public.delete_manager_step(%L)', pg_temp.sid(2)))],
  array['no error', 'no error', 'no error', 'no error', 'no error']);
-- Written, then edited: two statements, so the order is the statements' own.
select public.save_manager_comment(pg_temp.eid(2), pg_temp.cid(1), 'Ina note');
select pg_temp.check('1.5 she writes a comment and edits her own, which says «edited»',
  (select e.body || ' ' || (e.edited_at is not null)::text
   from public.save_manager_comment(pg_temp.eid(2), null, 'Ina note, fixed') e),
  'Ina note, fixed true');
select pg_temp.check('1.6 she assigns the card, to an admin',
  (select pg_temp.who(c.assignee_id) from public.set_manager_card_assignee(pg_temp.cid(1), pg_temp.ada()) c), 'ada');
select pg_temp.check('1.7 she copies it, as herself',
  (select pg_temp.who(c.created_by) || ' ' || c.title from public.duplicate_manager_card(pg_temp.cid(1), pg_temp.cid(3), 'Bathroom (copy)') c),
  'ina Bathroom (copy)');
select pg_temp.check('1.8 she archives, returns, deletes and returns a card',
  (select string_agg(x.shelf, ',' order by x.n)
   from unnest(array['archived', 'active', 'deleted', 'active']) with ordinality k(state, n),
        lateral (select k.n, case when c.deleted_at is not null then 'deleted'
                                  when c.archived_at is not null then 'archived' else 'active' end as shelf
                 from public.set_manager_card_state(pg_temp.cid(2), k.state) c) x),
  'archived,active,deleted,active');

select pg_temp.check('1.9 but she does not rename, archive or bring back the board',
  array[pg_temp.refusal(format('select public.save_manager_board(%L, ''Mine'')', pg_temp.board())),
        pg_temp.refusal(format('select public.set_manager_board_archived(%L, true)', pg_temp.board())),
        pg_temp.refusal(format('select public.set_manager_board_archived(%L, false)', pg_temp.board()))],
  array['serverErrors.boardNotYours', 'serverErrors.boardNotYours', 'serverErrors.boardNotYours']);
select pg_temp.check('1.10 nor changes or deletes the owner''s comment',
  array[pg_temp.refusal(format('select public.save_manager_comment(%L, null, ''x'')', pg_temp.eid(1))),
        pg_temp.refusal(format('select public.delete_manager_comment(%L)', pg_temp.eid(1)))],
  array['serverErrors.boardCommentNotYours', 'serverErrors.boardCommentNotYours']);

select pg_temp.as_server();
select pg_temp.check('1.11 her work is on the board under her name, the journal''s lines the server''s',
  (select string_agg(e.kind || ':' || pg_temp.who(e.author_id), ',' order by e.created_at, e.id)
   from public.manager_board_entries e where e.card_id = pg_temp.cid(1)),
  'comment:boss,due_changed:ina,moved:ina,step_done:ina,comment:ina,assignee_changed:ina');
select pg_temp.check('1.12 the admin she gave the card to hears of it',
  (select count(*) from raw.push_outbox o where o.recipient_id = pg_temp.ada() and o.kind = 'board_card_assigned'),
  1::bigint);

-- ===========================================================================
-- 2. The board's owner and an admin
-- ===========================================================================

select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('2.1 an admin deletes another''s comment',
  pg_temp.refusal(format('select public.delete_manager_comment(%L)', pg_temp.eid(2))), 'no error');
select pg_temp.check('2.2 and archives and brings back anybody''s board',
  array[pg_temp.refusal(format('select public.set_manager_board_archived(%L, true)', pg_temp.board())),
        pg_temp.refusal(format('select public.set_manager_board_archived(%L, false)', pg_temp.board()))],
  array['no error', 'no error']);
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('2.3 the owner renames her board',
  (select b.title from public.save_manager_board(pg_temp.board(), 'Boss board, renamed') b), 'Boss board, renamed');

-- ===========================================================================
-- 3. Nobody else: no write, no read
-- ===========================================================================

select pg_temp.as_server();
select pg_temp.check('3.1 a cleaner writes nothing',
  pg_temp.every_write(pg_temp.anna()), array_fill('serverErrors.managerOnly'::text, array[13]));
select pg_temp.check('3.2 nor a technician',
  pg_temp.every_write(pg_temp.tom()), array_fill('serverErrors.managerOnly'::text, array[13]));
select pg_temp.check('3.3 nor a head technician',
  pg_temp.every_write(pg_temp.hector()), array_fill('serverErrors.managerOnly'::text, array[13]));
select pg_temp.check('3.4 nor a manager switched off',
  pg_temp.every_write(pg_temp.dora()), array_fill('serverErrors.managerOnly'::text, array[13]));
-- A comment it cannot see is, to the caller, already gone: 'no error', and nothing is deleted (3.8).
select pg_temp.check('3.5 another company finds nothing to write on',
  pg_temp.every_write(pg_temp.olga()),
  array['serverErrors.boardNotFound', 'serverErrors.boardCardNotFound', 'serverErrors.boardCardNotFound',
        'serverErrors.boardCardNotFound', 'serverErrors.boardCardNotFound', 'serverErrors.boardCardNotFound',
        'serverErrors.boardCardNotFound', 'serverErrors.boardStepNotFound', 'serverErrors.boardStepNotFound',
        'serverErrors.boardCardNotFound', 'no error', 'serverErrors.boardNotFound',
        'serverErrors.boardNotFound']);
select pg_temp.check('3.6 another manager reads it all',
  pg_temp.reads(pg_temp.ina()) <> '0 0 0 0', true);
select pg_temp.check('3.7 a cleaner, a technician, a head technician, a manager switched off and another company read nothing',
  array[pg_temp.reads(pg_temp.anna()), pg_temp.reads(pg_temp.tom()), pg_temp.reads(pg_temp.hector()),
        pg_temp.reads(pg_temp.dora()), pg_temp.reads(pg_temp.olga())],
  array_fill('0 0 0 0'::text, array[5]));
select pg_temp.check('3.8 nothing refused was written, nothing refused was deleted',
  (select count(*) from public.manager_board_cards where id in (pg_temp.cid(90), pg_temp.cid(91)))
  + (select count(*) from public.manager_board_steps where id = pg_temp.sid(90))
  + (select count(*) from public.manager_board_entries where id = pg_temp.eid(90))
  + (select count(*) from public.manager_board_entries where id = pg_temp.eid(1) and body = 'Boss note') - 1
  + (select count(*) from public.manager_board_steps where id = pg_temp.sid(1)) - 1,
  0::bigint);

-- ===========================================================================
-- 4. An archived board, and the words
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select public.set_manager_board_archived(pg_temp.board(), true);
select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('4.1 on an archived board nobody works on the cards',
  array[pg_temp.refusal(format('select public.move_manager_card(%L, ''open'')', pg_temp.cid(1))),
        pg_temp.refusal(format('select public.save_manager_card(%L, %L, ''x'', '''', null, null, null, ''open'')', pg_temp.cid(92), pg_temp.board())),
        pg_temp.refusal(format('select public.save_manager_comment(%L, %L, ''x'')', pg_temp.eid(92), pg_temp.cid(1)))],
  array['serverErrors.boardArchived', 'serverErrors.boardArchived', 'serverErrors.boardArchived']);
select pg_temp.as_server();
select pg_temp.check('4.2 no word of a card reached the work log or the push queue',
  (select count(*) from public.task_events e where e::text ~ '(Bathroom|plumber|Ina note|Boss note|Tiles)')
  + (select count(*) from public.problem_events e where e::text ~ '(Bathroom|plumber|Ina note|Boss note|Tiles)')
  + (select count(*) from raw.push_outbox o where o::text ~ '(Bathroom|plumber|Ina note|Boss note|Tiles)'),
  0::bigint);
select pg_temp.check('4.3 anon may call none of the card functions',
  (select count(*) from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like '%manager_card%' or p.proname like '%manager_step%' or p.proname like '%manager_comment%'
          or p.proname like '%manager_board%')
     and has_function_privilege('anon', p.oid, 'execute')),
  0::bigint);
select pg_temp.check('4.4 nor any client the helpers',
  array[has_function_privilege('authenticated', 'public.manager_board_for_cards(uuid)', 'execute'),
        has_function_privilege('authenticated', 'public.manager_card_for_edit(uuid, boolean)', 'execute'),
        has_function_privilege('authenticated', 'public.manager_board_for_edit(uuid, boolean)', 'execute')],
  array[false, false, false]);

rollback;
