-- Manager boards (20261118200000): a manager's own boards of cards, their steps and their journal.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - every manager and admin of the company reads every board, card, step and journal line; a
--   cleaner, a technician, a head technician, a switched-off manager and another company's office
--   read nothing; no client writes a table directly;
-- - only the board's owner and an admin change a board, its cards, steps and journal; another
--   manager reads only; another company's board is not found, even by its id;
-- - a card lives in one of the four columns of the technicians' board; a move leaves a system line
--   with the columns, a due date changed leaves one with the dates, a step ticked leaves one with
--   the count — never the words; the same move, date or tick leaves nothing;
-- - steps: added at creation and later, at the end; their words change; they are ticked, unticked,
--   deleted and ordered; an order that misses a step is refused;
-- - comments: their author writes, changes (marked edited) and deletes them; an admin deletes any;
--   nobody deletes a system line; empty and overlong words are refused;
-- - the eight colours and no colour; an unknown colour, column or place is refused;
-- - a card is archived or soft-deleted and comes back, on one shelf at a time, and while shelved
--   nothing else changes it; a board is archived and comes back, and while archived nothing on it
--   changes; a copy takes the steps in order and unticked, without the due date or the journal;
-- - repeats of a create (the same client id) answer the same row and add nothing;
-- - the words stay in these tables: none reach task_events, problem_events or the push outbox,
--   and the cleanings and tasks of the company are as they were.
--
-- Fixture ids live in the 900120xxx range and under b0a2d…. Dates are from current_date.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

-- ---------- helpers ----------

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

/** A statement's translated hint, or its SQLSTATE, or 'no error'. */
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

-- A call that is now allowed (20261119090000): run in a subtransaction and rolled back, so what it
-- would write does not change the rest of the suite. 'allowed', or the refusal as refusal() says it.
create or replace function pg_temp.allowed(statement text)
returns text language plpgsql as $$
declare
  v_hint text;
begin
  begin
    execute statement;
    raise exception 'pg_temp.allowed: undone';
  exception when others then
    if sqlerrm = 'pg_temp.allowed: undone' then
      return 'allowed';
    end if;
    get stacked diagnostics v_hint = pg_exception_hint;
    return case when v_hint like 'serverErrors.%' then v_hint else sqlstate end;
  end;
end $$;

create or replace function pg_temp.host() returns uuid language sql immutable as $$
  select 'b0a2d000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.other_host() returns uuid language sql immutable as $$
  select 'b0a2d000-0000-4000-8000-00000000000b'::uuid $$;

create or replace function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('b0a2d0' || lpad(n::text, 2, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.boss()   returns uuid language sql immutable as $$ select pg_temp.uid(1) $$;
create or replace function pg_temp.ina()    returns uuid language sql immutable as $$ select pg_temp.uid(2) $$;
create or replace function pg_temp.ada()    returns uuid language sql immutable as $$ select pg_temp.uid(3) $$;
create or replace function pg_temp.anna()   returns uuid language sql immutable as $$ select pg_temp.uid(4) $$;
create or replace function pg_temp.hector() returns uuid language sql immutable as $$ select pg_temp.uid(5) $$;
create or replace function pg_temp.tom()    returns uuid language sql immutable as $$ select pg_temp.uid(6) $$;
create or replace function pg_temp.olga()   returns uuid language sql immutable as $$ select pg_temp.uid(7) $$;
create or replace function pg_temp.dora()   returns uuid language sql immutable as $$ select pg_temp.uid(8) $$;

create or replace function pg_temp.who(person uuid) returns text language sql immutable as $$
  select case person
    when pg_temp.boss() then 'boss' when pg_temp.ina() then 'ina' when pg_temp.ada() then 'ada'
    when pg_temp.anna() then 'anna' when pg_temp.hector() then 'hector' when pg_temp.tom() then 'tom'
    when pg_temp.olga() then 'olga' when pg_temp.dora() then 'dora'
    else coalesce(person::text, '-') end $$;

create or replace function pg_temp.as_user(person uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', '{"sub":"' || person || '","role":"authenticated"}', true)
$$;
create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;

create or replace function pg_temp.bid(n integer) returns uuid language sql immutable as $$
  select ('b0a2d100-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.cid(n integer) returns uuid language sql immutable as $$
  select ('b0a2d200-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.sid(n integer) returns uuid language sql immutable as $$
  select ('b0a2d300-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.eid(n integer) returns uuid language sql immutable as $$
  select ('b0a2d400-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

/** What one person reads of the four tables: "boards cards steps entries". */
create or replace function pg_temp.reads(person uuid) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_user(person);
  select (select count(*) from public.manager_boards)::text || ' '
         || (select count(*) from public.manager_board_cards)::text || ' '
         || (select count(*) from public.manager_board_steps)::text || ' '
         || (select count(*) from public.manager_board_entries)::text
  into v;
  perform pg_temp.as_server();
  return v;
end $$;

/** A card's steps in order: "words✓|words". */
create or replace function pg_temp.steps(p_card uuid) returns text language sql as $$
  select coalesce(string_agg(s.body || case when s.done_at is not null then '✓' else '' end, '|'
                             order by s.sort_order), '')
  from public.manager_board_steps s where s.card_id = p_card $$;

/** A card's journal, oldest first: "kind facts author" or "comment words author[ edited]". */
create or replace function pg_temp.journal(p_card uuid) returns text[] language sql as $$
  select coalesce(array_agg(
           case when e.kind = 'comment'
                then 'comment ' || e.body || ' ' || pg_temp.who(e.author_id)
                     || case when e.edited_at is not null then ' edited' else '' end
                else e.kind || ' ' || e.facts::text || ' ' || pg_temp.who(e.author_id) end
           order by e.created_at, e.id), '{}')
  from public.manager_board_entries e where e.card_id = p_card $$;

create or replace function pg_temp.lines(p_card uuid, p_kind text) returns integer language sql as $$
  select count(*)::integer from public.manager_board_entries e where e.card_id = p_card and e.kind = p_kind $$;

/** "column color due-offset place shelf" of a card. */
create or replace function pg_temp.card(p_card uuid) returns text language sql as $$
  select c.column_key || ' ' || coalesce(c.color, '-') || ' '
         || coalesce((c.due_on - current_date)::text, '-') || ' '
         || coalesce((c.property_id - 900120000)::text, '-') || ' '
         || case when c.archived_at is not null then 'archived'
                 when c.deleted_at is not null then 'deleted' else 'active' end
  from public.manager_board_cards c where c.id = p_card $$;

-- ---------- fixtures ----------

insert into public.hosts (id, name) values
  (pg_temp.host(), 'Boards company'),
  (pg_temp.other_host(), 'Boards elsewhere');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
select pg_temp.uid(u.n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       lower(u.name) || '.boards1118@test.local', 'x', now(), now(),
       jsonb_build_object('full_name', u.name), jsonb_build_object('role', u.role)
from (values (1, 'Boss', 'manager'), (2, 'Ina', 'manager'), (3, 'Ada', 'admin'),
             (4, 'Anna', 'cleaner'), (5, 'Hector', 'head_tech'), (6, 'Tom', 'tech'),
             (7, 'Olga', 'manager'), (8, 'Dora', 'manager')) u(n, name, role);

update public.profiles
set host_id = case when id = pg_temp.olga() then pg_temp.other_host() else pg_temp.host() end
where id in (select pg_temp.uid(n) from generate_series(1, 8) n);

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time)
values (900120001, pg_temp.host(), 'Boards flat', 'UTC', '15:00', '10:00'),
       (900120009, pg_temp.other_host(), 'Elsewhere flat', 'UTC', '15:00', '10:00');

-- What the rest of the company's work looked like before any board: nothing here may change it.
create temp table work_before as
select (select count(*) from public.tasks where host_id = pg_temp.host()) as tasks,
       (select count(*) from public.problems where host_id = pg_temp.host()) as problems,
       (select count(*) from public.task_events e join public.tasks t on t.id = e.task_id
        where t.host_id = pg_temp.host()) as task_events,
       (select count(*) from public.problem_events e join public.problems p on p.id = e.problem_id
        where p.host_id = pg_temp.host()) as problem_events,
       (select count(*) from raw.push_outbox where host_id = pg_temp.host()) as pushes;

-- ===========================================================================
-- 1. Boards: who creates, who renames
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('1.1 a manager creates a board; she owns it; the title is trimmed',
  (select b.title || ' ' || pg_temp.who(b.owner_id) || ' ' || (b.archived_at is null)::text
   from public.save_manager_board(pg_temp.bid(1), '  Owner projects  ') b),
  'Owner projects boss true');
select pg_temp.check('1.2 a repeat of the create answers the same board',
  (select pg_temp.who(b.owner_id) from public.save_manager_board(pg_temp.bid(1), 'Owner projects') b), 'boss');
select pg_temp.as_server();
select pg_temp.check('1.3 one board, in her company',
  (select count(*)::text || ' ' || bool_and(host_id = pg_temp.host())::text
   from public.manager_boards where id = pg_temp.bid(1)), '1 true');

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('1.4 a board needs a title',
  pg_temp.refusal($q$ select public.save_manager_board(pg_temp.bid(2), '   ') $q$), 'serverErrors.boardTitleInvalid');
select pg_temp.check('1.5 a title of 81 characters is refused',
  pg_temp.refusal(format('select public.save_manager_board(%L, %L)', pg_temp.bid(2), repeat('x', 81))),
  'serverErrors.boardTitleInvalid');
select pg_temp.check('1.6 the owner renames her board',
  (select title from public.save_manager_board(pg_temp.bid(1), 'Projects')), 'Projects');

select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('1.7 another manager may not rename it',
  pg_temp.refusal($q$ select public.save_manager_board(pg_temp.bid(1), 'Mine now') $q$), 'serverErrors.boardNotYours');
select pg_temp.check('1.8 another manager creates a board of her own',
  (select pg_temp.who(owner_id) from public.save_manager_board(pg_temp.bid(2), 'Ina board')), 'ina');

select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('1.9 an admin renames anybody''s board, the owner stays',
  (select title || ' ' || pg_temp.who(owner_id) from public.save_manager_board(pg_temp.bid(1), 'Projects 2026')),
  'Projects 2026 boss');
select pg_temp.check('1.10 an admin creates a board',
  (select pg_temp.who(owner_id) from public.save_manager_board(pg_temp.bid(3), 'Admin board')), 'ada');

select pg_temp.as_user(pg_temp.olga());
select pg_temp.check('1.11 another company''s manager does not find the board, even by its id',
  pg_temp.refusal($q$ select public.save_manager_board(pg_temp.bid(1), 'Taken') $q$), 'serverErrors.boardNotFound');
select pg_temp.as_server();
select pg_temp.check('1.12 and its title is as it was',
  (select title || ' ' || host_id::text from public.manager_boards where id = pg_temp.bid(1)),
  'Projects 2026 ' || pg_temp.host()::text);

select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('1.13 a cleaner creates nothing',
  pg_temp.refusal($q$ select public.save_manager_board(pg_temp.bid(9), 'x') $q$), 'serverErrors.managerOnly');
select pg_temp.as_user(pg_temp.hector());
select pg_temp.check('1.14 nor a head technician',
  pg_temp.refusal($q$ select public.save_manager_board(pg_temp.bid(9), 'x') $q$), 'serverErrors.managerOnly');
select pg_temp.as_user(pg_temp.tom());
select pg_temp.check('1.15 nor a technician',
  pg_temp.refusal($q$ select public.save_manager_board(pg_temp.bid(9), 'x') $q$), 'serverErrors.managerOnly');
select pg_temp.as_server();

select pg_temp.check('1.16 anon may call no board function',
  (select bool_or(has_function_privilege('anon', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like '%manager_board%' or p.proname like '%manager_card%'
                                   or p.proname like '%manager_step%' or p.proname like '%manager_comment%')),
  false);
select pg_temp.check('1.17 the internal helpers are nobody''s to call',
  (select bool_or(has_function_privilege('authenticated', p.oid, 'execute'))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('manager_board_for_edit', 'manager_card_for_edit', 'manager_board_column',
                       'manager_step_card')),
  false);

-- ===========================================================================
-- 2. Cards: create with steps, the fields, the refusals
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('2.1 a card with its steps, a colour, a due date and a place',
  (select pg_temp.card(c.id) from public.save_manager_card(
     pg_temp.cid(1), pg_temp.bid(1), ' Renovate flat ', 'See https://example.invalid/plan', current_date + 3,
     900120001, 'blue', null, '[" Call the plumber ", "Buy tiles", "Book the painter"]') c),
  'open blue 3 1 active');
select pg_temp.check('2.2 the steps are in order, trimmed, unticked',
  pg_temp.steps(pg_temp.cid(1)), 'Call the plumber|Buy tiles|Book the painter');
select pg_temp.check('2.3 a repeat of the create answers the same card and adds no step',
  (select c.title || ' ' || (select count(*) from public.manager_board_steps s where s.card_id = c.id)::text
   from public.save_manager_card(pg_temp.cid(1), pg_temp.bid(1), 'Renovate flat', 'See https://example.invalid/plan',
                                 current_date + 3, 900120001, 'blue', 'open', '["Call the plumber", "Buy tiles", "Book the painter"]') c),
  'Renovate flat 3');
select pg_temp.check('2.4 a card goes to the column it was added in',
  (select pg_temp.card(c.id) from public.save_manager_card(
     pg_temp.cid(2), pg_temp.bid(1), 'Quick one', null, null, null, null, 'in_progress') c),
  'in_progress - - - active');
select pg_temp.check('2.5 a new card says nothing in its journal',
  cardinality(pg_temp.journal(pg_temp.cid(1))), 0);

select pg_temp.check('2.6 every colour of the palette is taken, and no colour',
  (select string_agg(c.color, ',' order by k.n)
   from unnest(array['blue', 'sky', 'teal', 'green', 'olive', 'violet', 'orchid', 'slate']) with ordinality k(color, n),
        lateral public.save_manager_card(pg_temp.cid(10 + k.n::integer), pg_temp.bid(1), 'Colour ' || k.color, '',
                                         null, null, k.color) c),
  'blue,sky,teal,green,olive,violet,orchid,slate');
select pg_temp.check('2.7 an unknown colour is refused',
  pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(3), pg_temp.bid(1), 'x', '', null, null, 'red') $q$),
  'serverErrors.boardColorUnknown');
select pg_temp.check('2.8 an unknown column is refused',
  pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(3), pg_temp.bid(1), 'x', '', null, null, null, 'cancelled') $q$),
  'serverErrors.boardColumnUnknown');
select pg_temp.check('2.9 another company''s place is refused',
  pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(3), pg_temp.bid(1), 'x', '', null, 900120009, null) $q$),
  'serverErrors.propertyNotFound');
select pg_temp.check('2.10 a card needs a title',
  pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(3), pg_temp.bid(1), ' ', '', null, null, null) $q$),
  'serverErrors.boardCardTitleInvalid');
select pg_temp.check('2.11 a description over 10000 characters is refused',
  pg_temp.refusal(format('select public.save_manager_card(%L, %L, %L, %L, null, null, null)',
                         pg_temp.cid(3), pg_temp.bid(1), 'x', repeat('y', 10001))),
  'serverErrors.boardCardDescriptionTooLong');
select pg_temp.check('2.12 steps must be an array of words',
  array[pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(3), pg_temp.bid(1), 'x', '', null, null, null, null, '{"a": 1}') $q$),
        pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(3), pg_temp.bid(1), 'x', '', null, null, null, null, '["ok", "  "]') $q$),
        pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(3), pg_temp.bid(1), 'x', '', null, null, null, null, '[1]') $q$)],
  array['serverErrors.boardStepInvalid', 'serverErrors.boardStepInvalid', 'serverErrors.boardStepInvalid']);
select pg_temp.check('2.13 a card holds up to 100 steps',
  pg_temp.refusal(format('select public.save_manager_card(%L, %L, %L, %L, null, null, null, null, %L)',
                         pg_temp.cid(3), pg_temp.bid(1), 'x', '',
                         (select jsonb_agg('step ' || n) from generate_series(1, 101) n))),
  'serverErrors.boardTooManySteps');
select pg_temp.as_server();
select pg_temp.check('2.14 nothing refused was written',
  (select count(*) from public.manager_board_cards where id = pg_temp.cid(3)), 0::bigint);

select pg_temp.as_user(pg_temp.ina());
-- Since 20261119090000 every manager works on the cards of every board (manager_boards_office.sql).
select pg_temp.check('2.15 another manager adds a card to the board too',
  pg_temp.allowed($q$ select public.save_manager_card(pg_temp.cid(3), pg_temp.bid(1), 'x', '', null, null, null, 'open') $q$),
  'allowed');
select pg_temp.check('2.16 and changes one',
  pg_temp.allowed($q$ select public.save_manager_card(pg_temp.cid(1), pg_temp.bid(1), 'Hers', '', null, null, null) $q$),
  'allowed');
select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('2.17 an admin adds a card to anybody''s board',
  (select pg_temp.who(created_by) from public.save_manager_card(pg_temp.cid(4), pg_temp.bid(1), 'Admin card', '', null, null, 'teal')),
  'ada');
select pg_temp.as_user(pg_temp.olga());
select pg_temp.check('2.18 another company does not find the card',
  pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(1), pg_temp.bid(1), 'x', '', null, null, null) $q$),
  'serverErrors.boardCardNotFound');
select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('2.19 a cleaner changes no card',
  pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(1), pg_temp.bid(1), 'x', '', null, null, null) $q$),
  'serverErrors.managerOnly');

-- ===========================================================================
-- 3. Columns and moves
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('3.1 the owner moves a card to another column',
  (select column_key from public.move_manager_card(pg_temp.cid(1), 'in_progress')), 'in_progress');
select pg_temp.check('3.2 the same column again changes nothing',
  (select column_key from public.move_manager_card(pg_temp.cid(1), 'in_progress')), 'in_progress');
select pg_temp.check('3.3 every column is a column',
  (select string_agg(m.column_key, ',' order by k.n)
   from unnest(array['assigned', 'resolved', 'open', 'in_progress']) with ordinality k(col, n),
        lateral public.move_manager_card(pg_temp.cid(2), k.col) m),
  'assigned,resolved,open,in_progress');
select pg_temp.check('3.4 an unknown column is refused',
  pg_temp.refusal($q$ select public.move_manager_card(pg_temp.cid(1), 'done') $q$), 'serverErrors.boardColumnUnknown');
select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('3.5 another manager moves a card too',
  pg_temp.allowed($q$ select public.move_manager_card(pg_temp.cid(1), 'resolved') $q$), 'allowed');
select pg_temp.as_user(pg_temp.hector());
select pg_temp.check('3.6 nor a head technician',
  pg_temp.refusal($q$ select public.move_manager_card(pg_temp.cid(1), 'resolved') $q$), 'serverErrors.managerOnly');
select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('3.7 an admin moves it',
  (select column_key from public.move_manager_card(pg_temp.cid(1), 'assigned')), 'assigned');
select pg_temp.as_server();
select pg_temp.check('3.8 each move left one line with its columns and who; the repeat none',
  pg_temp.journal(pg_temp.cid(1)),
  array['moved {"to": "in_progress", "from": "open"} boss',
        'moved {"to": "assigned", "from": "in_progress"} ada']);
select pg_temp.check('3.9 a move stamps the card',
  (select moved_at >= created_at from public.manager_board_cards where id = pg_temp.cid(1)), true);

-- ===========================================================================
-- 4. The due date and the fields
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('4.1 a new due date, colour and no place',
  (select pg_temp.card(c.id) from public.save_manager_card(
     pg_temp.cid(1), pg_temp.bid(1), 'Renovate flat', 'See https://example.invalid/plan', current_date + 5,
     null, 'green') c),
  'assigned green 5 - active');
select pg_temp.check('4.2 a call that says a column is a repeat of the create: the card as it stands',
  (select c.board_id = pg_temp.bid(1) and c.column_key = 'assigned'
          and pg_temp.steps(c.id) = 'Call the plumber|Buy tiles|Book the painter'
   from public.save_manager_card(pg_temp.cid(1), pg_temp.bid(2), 'Renovate flat', 'See https://example.invalid/plan',
                                 current_date + 5, null, 'green', 'resolved', '["one more"]') c),
  true);
select pg_temp.check('4.3 the due date taken away',
  (select pg_temp.card(c.id) from public.save_manager_card(
     pg_temp.cid(1), pg_temp.bid(1), 'Renovate flat', 'See https://example.invalid/plan', null, null, 'green') c),
  'assigned green - - active');
select pg_temp.as_server();
select pg_temp.check('4.4 each change of the due date is a line, from and to; the same date none',
  (select array_agg(e.facts::text order by e.created_at, e.id) from public.manager_board_entries e
   where e.card_id = pg_temp.cid(1) and e.kind = 'due_changed'),
  array[jsonb_build_object('from', current_date + 3, 'to', current_date + 5)::text,
        jsonb_build_object('from', current_date + 5, 'to', null)::text]);

-- ===========================================================================
-- 5. Steps and progress
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('5.1 a step added later goes to the end',
  (select s.sort_order from public.save_manager_step(pg_temp.sid(1), pg_temp.cid(1), ' Clean up ') s), 4);
select pg_temp.check('5.2 a repeat of the add answers the same step',
  (select s.body || ' ' || (select count(*) from public.manager_board_steps x where x.card_id = pg_temp.cid(1))::text
   from public.save_manager_step(pg_temp.sid(1), pg_temp.cid(1), 'Clean up') s),
  'Clean up 4');
select pg_temp.check('5.3 its words change',
  (select s.body from public.save_manager_step(pg_temp.sid(1), null, 'Clean up and air') s), 'Clean up and air');
select pg_temp.check('5.4 a step needs words',
  pg_temp.refusal($q$ select public.save_manager_step(pg_temp.sid(2), pg_temp.cid(1), '  ') $q$),
  'serverErrors.boardStepInvalid');
select pg_temp.check('5.5 a tick',
  (select s.done_at is not null and s.done_by = pg_temp.boss()
   from public.set_manager_step_done(pg_temp.sid(1), true) s), true);
select pg_temp.check('5.6 a second tick changes nothing',
  (select s.done_at is not null from public.set_manager_step_done(pg_temp.sid(1), true) s), true);
select pg_temp.check('5.7 progress, as a board reads it',
  (select count(*) filter (where done_at is not null)::text || '/' || count(*)::text
   from public.manager_board_steps where card_id = pg_temp.cid(1)), '1/4');
select pg_temp.check('5.8 an untick',
  (select s.done_at is null and s.done_by is null from public.set_manager_step_done(pg_temp.sid(1), false) s), true);
select pg_temp.check('5.9 ticked again',
  (select s.done_at is not null from public.set_manager_step_done(pg_temp.sid(1), true) s), true);
select pg_temp.check('5.10 and another',
  (select s.done_at is not null from public.set_manager_step_done(
     (select id from public.manager_board_steps where card_id = pg_temp.cid(1) and sort_order = 1), true) s), true);
select pg_temp.as_server();
select pg_temp.check('5.11 a tick is a line with the count; an untick and a repeat are none',
  (select array_agg(e.facts::text order by e.created_at, e.id) from public.manager_board_entries e
   where e.card_id = pg_temp.cid(1) and e.kind = 'step_done'),
  array['{"done": 1, "total": 4}', '{"done": 1, "total": 4}', '{"done": 2, "total": 4}']);
select pg_temp.check('5.12 no line carries the words of a step',
  (select count(*) from public.manager_board_entries e
   where e.card_id = pg_temp.cid(1) and e.kind <> 'comment'
     and (e.body is not null or e.facts::text ~ '(plumber|tiles|painter|Clean)')), 0::bigint);

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('5.13 an order that misses a step is refused',
  pg_temp.refusal(format('select public.order_manager_steps(%L, %L::uuid[])', pg_temp.cid(1),
    (select array_agg(id order by sort_order) from public.manager_board_steps where card_id = pg_temp.cid(1) and sort_order < 4))),
  'serverErrors.taskChangedMeanwhile');
select pg_temp.check('5.14 an order naming a step twice is refused',
  pg_temp.refusal(format('select public.order_manager_steps(%L, %L::uuid[])', pg_temp.cid(1),
    (select array_agg(id order by sort_order) || array[pg_temp.sid(1)]
     from public.manager_board_steps where card_id = pg_temp.cid(1)))),
  'serverErrors.taskChangedMeanwhile');
select public.order_manager_steps(pg_temp.cid(1),
  (select array_agg(id order by sort_order desc) from public.manager_board_steps where card_id = pg_temp.cid(1)));
select pg_temp.check('5.15 a new order',
  pg_temp.steps(pg_temp.cid(1)), 'Clean up and air✓|Book the painter|Buy tiles|Call the plumber✓');
select public.delete_manager_step((select id from public.manager_board_steps
                                   where card_id = pg_temp.cid(1) and body = 'Buy tiles'));
select pg_temp.check('5.16 a step deleted',
  pg_temp.steps(pg_temp.cid(1)), 'Clean up and air✓|Book the painter|Call the plumber✓');
select pg_temp.check('5.17 a step already gone changes nothing',
  pg_temp.refusal($q$ select public.delete_manager_step('b0a2d300-0000-4000-8000-000000000999') $q$), 'no error');
select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('5.18 another manager ticks, writes, orders and deletes steps too',
  array[pg_temp.allowed($q$ select public.set_manager_step_done(pg_temp.sid(1), false) $q$),
        pg_temp.allowed($q$ select public.save_manager_step(pg_temp.sid(1), null, 'Mine') $q$),
        pg_temp.allowed($q$ select public.save_manager_step(pg_temp.sid(3), pg_temp.cid(1), 'Mine') $q$),
        pg_temp.allowed($q$ select public.delete_manager_step(pg_temp.sid(1)) $q$),
        pg_temp.allowed(format('select public.order_manager_steps(%L, %L::uuid[])', pg_temp.cid(1),
          (select array_agg(id) from public.manager_board_steps where card_id = pg_temp.cid(1))))],
  array['allowed', 'allowed', 'allowed', 'allowed', 'allowed']);
select pg_temp.as_user(pg_temp.olga());
select pg_temp.check('5.19 another company does not find the step',
  pg_temp.refusal($q$ select public.set_manager_step_done(pg_temp.sid(1), false) $q$), 'serverErrors.boardStepNotFound');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('5.20 a card holds up to 100 steps, added one by one too',
  (select pg_temp.refusal(format('select public.save_manager_step(%L, %L, %L)', pg_temp.sid(4), pg_temp.cid(5), 'one too many'))
   from public.save_manager_card(pg_temp.cid(5), pg_temp.bid(1), 'Long list', '', null, null, null, null,
                                 (select jsonb_agg('step ' || n) from generate_series(1, 100) n))),
  'serverErrors.boardTooManySteps');

-- ===========================================================================
-- 6. The journal: comments
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('6.1 the owner writes a comment, trimmed, with her name and the time',
  (select e.body || ' ' || pg_temp.who(e.author_id) || ' ' || (e.created_at <= clock_timestamp())::text
          || ' ' || (e.edited_at is null)::text
   from public.save_manager_comment(pg_temp.eid(1), pg_temp.cid(1), '  Plumber comes Tuesday  ') e),
  'Plumber comes Tuesday boss true true');
select pg_temp.check('6.2 a repeat answers the same comment, not edited',
  (select (e.edited_at is null)::text || ' ' || pg_temp.lines(pg_temp.cid(1), 'comment')::text
   from public.save_manager_comment(pg_temp.eid(1), pg_temp.cid(1), 'Plumber comes Tuesday') e),
  'true 1');
select pg_temp.check('6.3 she changes it: marked edited',
  (select e.body || ' ' || (e.edited_at is not null)::text
   from public.save_manager_comment(pg_temp.eid(1), null, 'Plumber comes Wednesday') e),
  'Plumber comes Wednesday true');
select pg_temp.check('6.4 an empty comment is refused',
  pg_temp.refusal($q$ select public.save_manager_comment(pg_temp.eid(2), pg_temp.cid(1), ' ') $q$),
  'serverErrors.commentEmpty');
select pg_temp.check('6.5 a comment over 4000 characters is refused',
  pg_temp.refusal(format('select public.save_manager_comment(%L, %L, %L)', pg_temp.eid(2), pg_temp.cid(1), repeat('z', 4001))),
  'serverErrors.commentTooLong');
select pg_temp.check('6.6 a long journal: as many comments as she likes',
  (select count(*) from generate_series(1, 30) n,
          lateral public.save_manager_comment(
            ('b0a2d400-0000-4000-8000-' || lpad((100 + n)::text, 12, '0'))::uuid, pg_temp.cid(1), 'Day ' || n) e),
  30::bigint);

select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('6.7 an admin writes on anybody''s card',
  (select pg_temp.who(author_id) from public.save_manager_comment(pg_temp.eid(3), pg_temp.cid(1), 'Admin note')), 'ada');
select pg_temp.check('6.8 an admin changes no one else''s comment',
  pg_temp.refusal($q$ select public.save_manager_comment(pg_temp.eid(1), null, 'Rewritten') $q$),
  'serverErrors.boardCommentNotYours');

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('6.9 the owner changes no admin''s comment, nor deletes it',
  array[pg_temp.refusal($q$ select public.save_manager_comment(pg_temp.eid(3), null, 'Rewritten') $q$),
        pg_temp.refusal($q$ select public.delete_manager_comment(pg_temp.eid(3)) $q$)],
  array['serverErrors.boardCommentNotYours', 'serverErrors.boardCommentNotYours']);
select pg_temp.check('6.10 nobody deletes a system line',
  pg_temp.refusal(format('select public.delete_manager_comment(%L)',
    (select id from public.manager_board_entries where card_id = pg_temp.cid(1) and kind = 'moved' limit 1))),
  'serverErrors.boardCommentNotYours');
select pg_temp.check('6.11 a system line is not a comment to change',
  pg_temp.refusal(format('select public.save_manager_comment(%L, %L, %L)',
    (select id from public.manager_board_entries where card_id = pg_temp.cid(1) and kind = 'moved' limit 1),
    null, 'words')),
  'serverErrors.boardCommentNotYours');

select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('6.12 another manager writes on the card too, but deletes no comment not hers',
  array[pg_temp.allowed($q$ select public.save_manager_comment(pg_temp.eid(4), pg_temp.cid(1), 'Hello') $q$),
        pg_temp.allowed($q$ select public.delete_manager_comment(pg_temp.eid(1)) $q$)],
  array['allowed', 'serverErrors.boardCommentNotYours']);

select pg_temp.as_user(pg_temp.boss());
select public.delete_manager_comment(pg_temp.eid(1));
select pg_temp.check('6.13 the author deletes her comment; a second delete changes nothing',
  pg_temp.refusal($q$ select public.delete_manager_comment(pg_temp.eid(1)) $q$)
    || ' ' || (select count(*) from public.manager_board_entries where id = pg_temp.eid(1))::text,
  'no error 0');
select public.save_manager_comment(pg_temp.eid(5), pg_temp.cid(1), 'Boss wrote this');
select pg_temp.as_user(pg_temp.ada());
select public.delete_manager_comment(pg_temp.eid(5));
select pg_temp.as_server();
select pg_temp.check('6.14 an admin deletes anybody''s comment',
  (select count(*) from public.manager_board_entries where id = pg_temp.eid(5)), 0::bigint);
select pg_temp.check('6.15 the journal is in order of time: the system lines first, then the comments',
  (pg_temp.journal(pg_temp.cid(1)))[1:2],
  array['moved {"to": "in_progress", "from": "open"} boss',
        'moved {"to": "assigned", "from": "in_progress"} ada']);
select pg_temp.check('6.16 every line has its author and time',
  (select bool_and(author_id is not null and created_at is not null) from public.manager_board_entries
   where card_id = pg_temp.cid(1)), true);

-- ===========================================================================
-- 7. Reading: the office of the company, nobody else
-- ===========================================================================

select pg_temp.check('7.1 the owner, another manager and an admin read the same',
  array[pg_temp.reads(pg_temp.boss()), pg_temp.reads(pg_temp.ina())],
  array[pg_temp.reads(pg_temp.ada()), pg_temp.reads(pg_temp.ada())]);
select pg_temp.check('7.2 they read every board of the company, other people''s too',
  split_part(pg_temp.reads(pg_temp.ina()), ' ', 1), '3');
select pg_temp.check('7.3 a cleaner, a head technician, a technician and another company read nothing',
  array[pg_temp.reads(pg_temp.anna()), pg_temp.reads(pg_temp.hector()), pg_temp.reads(pg_temp.tom()),
        pg_temp.reads(pg_temp.olga())],
  array['0 0 0 0', '0 0 0 0', '0 0 0 0', '0 0 0 0']);

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('7.4 no client writes a table directly',
  array[pg_temp.refusal($q$ insert into public.manager_boards (id, host_id, title, owner_id)
                            values (pg_temp.bid(8), pg_temp.host(), 'x', pg_temp.boss()) $q$),
        pg_temp.refusal($q$ update public.manager_board_cards set title = 'x' where id = pg_temp.cid(1) $q$),
        pg_temp.refusal($q$ delete from public.manager_board_entries where card_id = pg_temp.cid(1) $q$),
        pg_temp.refusal($q$ update public.manager_board_steps set done_at = null where card_id = pg_temp.cid(1) $q$)],
  array['42501', '42501', '42501', '42501']);

-- A manager switched off (staff_disable) reads nothing and changes nothing.
select pg_temp.as_user(pg_temp.dora());
select pg_temp.check('7.5 a manager makes a board of her own',
  (select pg_temp.who(owner_id) from public.save_manager_board(pg_temp.bid(4), 'Dora board')), 'dora');
select pg_temp.as_server();
update public.profiles set is_active = false where id = pg_temp.dora();
select pg_temp.check('7.6 switched off, she reads nothing',
  pg_temp.reads(pg_temp.dora()), '0 0 0 0');
select pg_temp.as_user(pg_temp.dora());
select pg_temp.check('7.7 and changes nothing',
  pg_temp.refusal($q$ select public.save_manager_board(pg_temp.bid(4), 'Still mine') $q$), 'serverErrors.managerOnly');
select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('7.8 her board is still the admin''s to keep',
  (select title || ' ' || pg_temp.who(owner_id) from public.save_manager_board(pg_temp.bid(4), 'Dora board (kept)')),
  'Dora board (kept) dora');

-- ===========================================================================
-- 8. Shelves: archive, soft delete, the way back; a copy
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('8.1 a card archived',
  (select pg_temp.card(c.id) || ' ' || pg_temp.who(c.archived_by)
   from public.set_manager_card_state(pg_temp.cid(2), 'archived') c), 'in_progress - - - archived boss');
select pg_temp.check('8.2 while archived nothing else changes it',
  array[pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(2), pg_temp.bid(1), 'x', '', null, null, null) $q$),
        pg_temp.refusal($q$ select public.move_manager_card(pg_temp.cid(2), 'open') $q$),
        pg_temp.refusal($q$ select public.save_manager_step(pg_temp.sid(5), pg_temp.cid(2), 'x') $q$),
        pg_temp.refusal($q$ select public.save_manager_comment(pg_temp.eid(6), pg_temp.cid(2), 'x') $q$)],
  array['serverErrors.boardCardShelved', 'serverErrors.boardCardShelved', 'serverErrors.boardCardShelved',
        'serverErrors.boardCardShelved']);
select pg_temp.check('8.3 archived again changes nothing',
  (select pg_temp.card(c.id) from public.set_manager_card_state(pg_temp.cid(2), 'archived') c), 'in_progress - - - archived');
select pg_temp.check('8.4 from the archive to the bin: one shelf at a time',
  (select pg_temp.card(c.id) || ' ' || (c.archived_at is null)::text
   from public.set_manager_card_state(pg_temp.cid(2), 'deleted') c), 'in_progress - - - deleted true');
select pg_temp.check('8.5 back from the bin, in its column',
  (select pg_temp.card(c.id) || ' ' || (c.deleted_by is null)::text
   from public.set_manager_card_state(pg_temp.cid(2), 'active') c), 'in_progress - - - active true');
select pg_temp.check('8.6 an unknown state is refused',
  pg_temp.refusal($q$ select public.set_manager_card_state(pg_temp.cid(2), 'gone') $q$), 'serverErrors.unknown');
select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('8.7 another manager shelves a card too',
  pg_temp.allowed($q$ select public.set_manager_card_state(pg_temp.cid(2), 'deleted') $q$), 'allowed');

select pg_temp.as_user(pg_temp.boss());
select public.set_manager_card_state(pg_temp.cid(1), 'archived');
select pg_temp.check('8.8 a copy of an archived card: same board, first column, steps unticked in order, no date',
  (select pg_temp.card(c.id) || ' ' || c.title || ' ' || pg_temp.steps(c.id) || ' ' || pg_temp.who(c.created_by)
   from public.duplicate_manager_card(pg_temp.cid(1), pg_temp.cid(6), ' Renovate flat (copy) ') c),
  'open green - - active Renovate flat (copy) Clean up and air|Book the painter|Call the plumber boss');
select pg_temp.check('8.9 the copy has the description and an empty journal',
  (select c.description || ' ' || cardinality(pg_temp.journal(c.id))::text
   from public.manager_board_cards c where c.id = pg_temp.cid(6)),
  'See https://example.invalid/plan 0');
select pg_temp.check('8.10 a repeat answers the copy and adds no step',
  (select (select count(*) from public.manager_board_steps where card_id = c.id)::text
   from public.duplicate_manager_card(pg_temp.cid(1), pg_temp.cid(6), 'Renovate flat (copy)') c), '3');
select pg_temp.check('8.11 the original stays archived, its steps as they were',
  pg_temp.card(pg_temp.cid(1)) || ' ' || pg_temp.steps(pg_temp.cid(1)),
  'assigned green - - archived Clean up and air✓|Book the painter|Call the plumber✓');
select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('8.12 another manager copies a card too',
  pg_temp.allowed($q$ select public.duplicate_manager_card(pg_temp.cid(6), pg_temp.cid(7), 'x') $q$),
  'allowed');

-- A board archived and back.
select pg_temp.check('8.13 another manager archives no board',
  pg_temp.refusal($q$ select public.set_manager_board_archived(pg_temp.bid(1), true) $q$), 'serverErrors.boardNotYours');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('8.14 the owner archives her board',
  (select (archived_at is not null)::text || ' ' || pg_temp.who(archived_by)
   from public.set_manager_board_archived(pg_temp.bid(1), true)), 'true boss');
select pg_temp.check('8.15 while archived nothing on it changes',
  array[pg_temp.refusal($q$ select public.save_manager_board(pg_temp.bid(1), 'x') $q$),
        pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(8), pg_temp.bid(1), 'x', '', null, null, null) $q$),
        pg_temp.refusal($q$ select public.move_manager_card(pg_temp.cid(6), 'resolved') $q$),
        pg_temp.refusal($q$ select public.set_manager_card_state(pg_temp.cid(1), 'active') $q$),
        pg_temp.refusal($q$ select public.save_manager_comment(pg_temp.eid(7), pg_temp.cid(6), 'x') $q$)],
  array['serverErrors.boardArchived', 'serverErrors.boardArchived', 'serverErrors.boardArchived',
        'serverErrors.boardArchived', 'serverErrors.boardArchived']);
select pg_temp.check('8.16 an archived board is still read',
  split_part(pg_temp.reads(pg_temp.ina()), ' ', 1), '4');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('8.17 and comes back',
  (select (archived_at is null)::text || ' ' || (archived_by is null)::text
   from public.set_manager_board_archived(pg_temp.bid(1), false)), 'true true');
select pg_temp.check('8.18 a card comes back from the archive',
  (select pg_temp.card(c.id) from public.set_manager_card_state(pg_temp.cid(1), 'active') c), 'assigned green - - active');
select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('8.19 an admin archives anybody''s board',
  (select (archived_at is not null)::text from public.set_manager_board_archived(pg_temp.bid(2), true)), 'true');

-- ===========================================================================
-- 9. Apart from the rest of the work, and the words where they belong
-- ===========================================================================

select pg_temp.as_server();
select pg_temp.check('9.1 the company''s cleanings, tasks, their journals and the pushes are as they were',
  (select row(w.tasks, w.problems, w.task_events, w.problem_events, w.pushes)::text from work_before w),
  row((select count(*) from public.tasks where host_id = pg_temp.host()),
      (select count(*) from public.problems where host_id = pg_temp.host()),
      (select count(*) from public.task_events e join public.tasks t on t.id = e.task_id
       where t.host_id = pg_temp.host()),
      (select count(*) from public.problem_events e join public.problems p on p.id = e.problem_id
       where p.host_id = pg_temp.host()),
      (select count(*) from raw.push_outbox where host_id = pg_temp.host()))::text);
select pg_temp.check('9.2 no word of a card, a step or a comment is in the work log or the push outbox',
  (select count(*) from public.task_events e where e::text ~ '(Renovate|plumber|Tuesday|Wednesday|Admin note)')
  + (select count(*) from public.problem_events e where e::text ~ '(Renovate|plumber|Tuesday|Wednesday|Admin note)')
  + (select count(*) from raw.push_outbox o where o::text ~ '(Renovate|plumber|Tuesday|Wednesday|Admin note)'),
  0::bigint);
select pg_temp.check('9.3 a system line never has words',
  (select count(*) from public.manager_board_entries where kind <> 'comment' and body is not null), 0::bigint);
-- One trigger only (20261118230000): the line «assignee changed» queues a push to the new assignee,
-- carrying the card's id and nothing it says (push_on_card_assigned reads no title, body or words).
select pg_temp.check('9.4 the tables have no trigger that could write anywhere else, but the assignment push',
  (select coalesce(string_agg(t.tgname || ' ' || p.proname, ', ' order by t.tgname), '')
   from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     and t.tgrelid in ('public.manager_boards'::regclass, 'public.manager_board_cards'::regclass,
                       'public.manager_board_steps'::regclass, 'public.manager_board_entries'::regclass)),
  'manager_board_entries_push_assigned push_on_card_assigned');
select pg_temp.check('9.4b and that push reads no words of the boards',
  (select p.prosrc ~ '\m(title|body|description)\M' from pg_proc p
   where p.oid = 'public.push_on_card_assigned()'::regprocedure), false);
select pg_temp.check('9.5 a system line names only columns, dates and counts',
  (select bool_and(case e.kind
                     when 'moved' then e.facts ?& array['from', 'to']
                     when 'due_changed' then e.facts ?& array['from', 'to']
                     when 'step_done' then e.facts ?& array['done', 'total']
                   end
                   and (select count(*) from jsonb_object_keys(e.facts)) = 2)
   from public.manager_board_entries e where e.kind <> 'comment'), true);

-- ===========================================================================
-- 10. Repeats that come late, blank words, no id, strangers, a role taken away
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select public.save_manager_card(pg_temp.cid(20), pg_temp.bid(1), 'Late repeat', '', current_date + 1, null, null, 'open');
select public.save_manager_card(pg_temp.cid(20), pg_temp.bid(1), 'Late repeat', '', current_date + 9, null, 'olive');
select pg_temp.check('10.1 a create repeated after an edit answers the card as it stands, and undoes nothing',
  (select pg_temp.card(c.id) || ' ' || pg_temp.lines(c.id, 'due_changed')::text
   from public.save_manager_card(pg_temp.cid(20), pg_temp.bid(1), 'Late repeat', '', current_date + 1, null, null, 'open') c),
  'open olive 9 - active 1');
select public.save_manager_step(pg_temp.sid(20), pg_temp.cid(20), 'first words');
select public.save_manager_step(pg_temp.sid(20), null, 'second words');
select pg_temp.check('10.2 an add of a step repeated after a change of its words keeps the new words',
  (select s.body from public.save_manager_step(pg_temp.sid(20), pg_temp.cid(20), 'first words') s), 'second words');
select public.save_manager_comment(pg_temp.eid(20), pg_temp.cid(20), 'v1');
select public.save_manager_comment(pg_temp.eid(20), null, 'v2');
select pg_temp.check('10.3 a comment repeated after its author changed it keeps the change',
  (select e.body || ' ' || (e.edited_at is not null)::text
   from public.save_manager_comment(pg_temp.eid(20), pg_temp.cid(20), 'v1') e), 'v2 true');
select public.set_manager_card_state(pg_temp.cid(20), 'archived');
select pg_temp.check('10.4 a create, a step and a comment repeated after the card was archived answer, not refuse',
  array[pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(20), pg_temp.bid(1), 'Late repeat', '', null, null, null, 'open') $q$),
        pg_temp.refusal($q$ select public.save_manager_step(pg_temp.sid(20), pg_temp.cid(20), 'first words') $q$),
        pg_temp.refusal($q$ select public.save_manager_comment(pg_temp.eid(20), pg_temp.cid(20), 'v1') $q$)],
  array['no error', 'no error', 'no error']);
select pg_temp.check('10.5 and the card is still archived',
  pg_temp.card(pg_temp.cid(20)), 'open olive 9 - archived');
select pg_temp.check('10.6 a change of words names no card: an unknown step or comment is not found',
  array[pg_temp.refusal($q$ select public.save_manager_step(pg_temp.sid(21), null, 'x') $q$),
        pg_temp.refusal($q$ select public.save_manager_comment(pg_temp.eid(21), null, 'x') $q$)],
  array['serverErrors.boardStepNotFound', 'serverErrors.boardCommentNotYours']);

select pg_temp.check('10.7 words of tabs, spaces and line breaks are no words',
  array[pg_temp.refusal(format('select public.save_manager_board(%L, %L)', pg_temp.bid(21), E'\n\t ')),
        pg_temp.refusal(format('select public.save_manager_card(%L, %L, %L, %L, null, null, null, %L)', pg_temp.cid(21), pg_temp.bid(1), E'\t', '', 'open')),
        pg_temp.refusal(format('select public.save_manager_card(%L, %L, %L, %L, null, null, null, %L, %L)', pg_temp.cid(21), pg_temp.bid(1), 'x', '', 'open', '["\r\n"]')),
        pg_temp.refusal(format('select public.save_manager_step(%L, %L, %L)', pg_temp.sid(21), pg_temp.cid(1), E'\n')),
        pg_temp.refusal(format('select public.save_manager_comment(%L, %L, %L)', pg_temp.eid(21), pg_temp.cid(1), E'\r\n'))],
  array['serverErrors.boardTitleInvalid', 'serverErrors.boardCardTitleInvalid', 'serverErrors.boardStepInvalid',
        'serverErrors.boardStepInvalid', 'serverErrors.commentEmpty']);
select pg_temp.check('10.8 no id is refused with a key, not a bare constraint',
  array[pg_temp.refusal($q$ select public.save_manager_board(null, 'x') $q$),
        pg_temp.refusal($q$ select public.save_manager_card(null, pg_temp.bid(1), 'x', '', null, null, null) $q$),
        pg_temp.refusal($q$ select public.save_manager_step(null, pg_temp.cid(1), 'x') $q$),
        pg_temp.refusal($q$ select public.save_manager_comment(null, pg_temp.cid(1), 'x') $q$)],
  array['serverErrors.unknown', 'serverErrors.unknown', 'serverErrors.unknown', 'serverErrors.unknown']);

select pg_temp.as_user(pg_temp.olga());
select pg_temp.check('10.9 another company finds none of it, by any function',
  array[pg_temp.refusal($q$ select public.save_manager_comment(pg_temp.eid(3), null, 'x') $q$),
        pg_temp.refusal($q$ select public.save_manager_comment(pg_temp.eid(3), pg_temp.cid(1), 'x') $q$),
        pg_temp.refusal($q$ select public.move_manager_card(pg_temp.cid(1), 'resolved') $q$),
        pg_temp.refusal($q$ select public.set_manager_card_state(pg_temp.cid(1), 'deleted') $q$),
        pg_temp.refusal($q$ select public.set_manager_board_archived(pg_temp.bid(1), true) $q$),
        pg_temp.refusal($q$ select public.duplicate_manager_card(pg_temp.cid(1), pg_temp.cid(22), 'x') $q$),
        pg_temp.refusal($q$ select public.order_manager_steps(pg_temp.cid(1), '{}') $q$),
        pg_temp.refusal($q$ select public.save_manager_step(pg_temp.sid(20), null, 'x') $q$),
        pg_temp.refusal($q$ select public.save_manager_step(pg_temp.sid(20), pg_temp.cid(1), 'x') $q$),
        pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(20), pg_temp.bid(1), 'x', '', null, null, null, 'open') $q$)],
  array['serverErrors.boardCommentNotYours', 'serverErrors.boardCardNotFound', 'serverErrors.boardCardNotFound',
        'serverErrors.boardCardNotFound', 'serverErrors.boardNotFound', 'serverErrors.boardCardNotFound',
        'serverErrors.boardCardNotFound', 'serverErrors.boardStepNotFound', 'serverErrors.boardStepNotFound',
        'serverErrors.boardCardNotFound']);
select public.delete_manager_comment(pg_temp.eid(3));
select pg_temp.as_server();
select pg_temp.check('10.10 a delete from another company leaves the comment where it is',
  (select count(*) from public.manager_board_entries where id = pg_temp.eid(3)), 1::bigint);

update public.profiles set role = 'manager' where id = pg_temp.ada();
select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('10.11 an admin made a manager changes another''s board no more',
  pg_temp.refusal($q$ select public.save_manager_board(pg_temp.bid(1), 'x') $q$), 'serverErrors.boardNotYours');
select pg_temp.as_server();
update public.profiles set role = 'cleaner' where id = pg_temp.boss();
select pg_temp.check('10.12 a manager made a cleaner reads nothing, her own board neither',
  pg_temp.reads(pg_temp.boss()), '0 0 0 0');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('10.13 and changes nothing',
  pg_temp.refusal($q$ select public.save_manager_board(pg_temp.bid(1), 'x') $q$), 'serverErrors.managerOnly');

rollback;
