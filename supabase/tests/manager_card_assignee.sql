-- The assignee of a manager board card (20261118230000).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - a new card — made by the owner or an admin, or copied — is the board owner's;
-- - the owner and an admin assign, reassign and clear; an active manager or admin of the company
--   only; the same person again changes nothing; never on an archived board or a shelved card;
-- - a change leaves one journal line with the two ids and no words, and one push to the new
--   assignee whose row carries the card's id only — none when they assigned it to themselves;
-- - the assignee works on that card (fields, due date, column, steps, comments) and on nothing
--   else: not the board, not the card's shelf or copy, not its assignment, not other cards; taken
--   off the card, the assignee loses it;
-- - a save of the fields in the shape of before leaves the assignee where it is.
--
-- Fixture ids live under b0a2e…. Dates are from current_date.
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
  select 'b0a2e000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.other_host() returns uuid language sql immutable as $$
  select 'b0a2e000-0000-4000-8000-00000000000b'::uuid $$;
create or replace function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('b0a2e0' || lpad(n::text, 2, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.boss() returns uuid language sql immutable as $$ select pg_temp.uid(1) $$;
create or replace function pg_temp.ina()  returns uuid language sql immutable as $$ select pg_temp.uid(2) $$;
create or replace function pg_temp.ada()  returns uuid language sql immutable as $$ select pg_temp.uid(3) $$;
create or replace function pg_temp.anna() returns uuid language sql immutable as $$ select pg_temp.uid(4) $$;
create or replace function pg_temp.dora() returns uuid language sql immutable as $$ select pg_temp.uid(5) $$;
create or replace function pg_temp.olga() returns uuid language sql immutable as $$ select pg_temp.uid(6) $$;
create or replace function pg_temp.who(person uuid) returns text language sql immutable as $$
  select case person
    when pg_temp.boss() then 'boss' when pg_temp.ina() then 'ina' when pg_temp.ada() then 'ada'
    when pg_temp.anna() then 'anna' when pg_temp.dora() then 'dora' when pg_temp.olga() then 'olga'
    else coalesce(person::text, '-') end $$;
create or replace function pg_temp.as_user(person uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', '{"sub":"' || person || '","role":"authenticated"}', true) $$;
create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;

create or replace function pg_temp.board() returns uuid language sql immutable as $$
  select 'b0a2e100-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.cid(n integer) returns uuid language sql immutable as $$
  select ('b0a2e200-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

create or replace function pg_temp.assignee(p_card uuid) returns text language sql as $$
  select pg_temp.who(c.assignee_id) from public.manager_board_cards c where c.id = p_card $$;
create or replace function pg_temp.lines(p_card uuid) returns text[] language sql as $$
  select coalesce(array_agg(pg_temp.who((e.facts ->> 'from')::uuid) || '>' || pg_temp.who((e.facts ->> 'to')::uuid)
                            || ' by ' || pg_temp.who(e.author_id) order by e.created_at, e.id), '{}')
  from public.manager_board_entries e where e.card_id = p_card and e.kind = 'assignee_changed' $$;
create or replace function pg_temp.pushes() returns text[] language sql as $$
  select coalesce(array_agg(pg_temp.who(o.recipient_id) || ' ' || o.kind::text || ' ' || o.params::text
                            order by o.id), '{}')
  from raw.push_outbox o where o.host_id = pg_temp.host() $$;

-- ---------- fixtures ----------

insert into public.hosts (id, name) values
  (pg_temp.host(), 'Assignee company'), (pg_temp.other_host(), 'Assignee elsewhere');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
select pg_temp.uid(u.n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       lower(u.name) || '.assignee1118@test.local', 'x', now(), now(),
       jsonb_build_object('full_name', u.name), jsonb_build_object('role', u.role)
from (values (1, 'Boss', 'manager'), (2, 'Ina', 'manager'), (3, 'Ada', 'admin'),
             (4, 'Anna', 'cleaner'), (5, 'Dora', 'manager'), (6, 'Olga', 'manager')) u(n, name, role);
update public.profiles
set host_id = case when id = pg_temp.olga() then pg_temp.other_host() else pg_temp.host() end
where id in (select pg_temp.uid(n) from generate_series(1, 6) n);
update public.profiles set is_active = false where id = pg_temp.dora();

select pg_temp.as_user(pg_temp.boss());
select public.save_manager_board(pg_temp.board(), 'Projects');
select public.save_manager_card(pg_temp.cid(1), pg_temp.board(), 'Bathroom', '', null, null, null, 'open');
select pg_temp.as_user(pg_temp.ada());
select public.save_manager_card(pg_temp.cid(2), pg_temp.board(), 'Admin made', '', null, null, null, 'open');
select pg_temp.as_user(pg_temp.boss());
select public.duplicate_manager_card(pg_temp.cid(1), pg_temp.cid(3), 'Bathroom (copy)');

-- ===========================================================================
-- 1. Who a card is first
-- ===========================================================================

select pg_temp.as_server();
select pg_temp.check('1.1 a card made by the owner, one made by an admin and a copy are the owner''s',
  array[pg_temp.assignee(pg_temp.cid(1)), pg_temp.assignee(pg_temp.cid(2)), pg_temp.assignee(pg_temp.cid(3))],
  array['boss', 'boss', 'boss']);
select pg_temp.check('1.2 and none of that is a journal line or a push',
  (select count(*) from public.manager_board_entries where kind = 'assignee_changed') + cardinality(pg_temp.pushes()),
  0::bigint);

-- ===========================================================================
-- 2. Assigning
-- ===========================================================================

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('2.1 the owner gives a card to another manager',
  (select pg_temp.who(c.assignee_id) from public.set_manager_card_assignee(pg_temp.cid(1), pg_temp.ina()) c), 'ina');
select pg_temp.as_server();
select pg_temp.check('2.2 one journal line with the two ids and who', pg_temp.lines(pg_temp.cid(1)), array['boss>ina by boss']);
select pg_temp.check('2.3 one push to her, the card''s id its only parameter',
  pg_temp.pushes(), array['ina board_card_assigned ' || jsonb_build_object('card_id', pg_temp.cid(1))::text]);
select pg_temp.check('2.4 the push folds by the card',
  (select collapse_key from raw.push_outbox where host_id = pg_temp.host()), 'card:' || pg_temp.cid(1));
select pg_temp.check('2.5 a journal line carries no words, only the two ids',
  (select bool_and(body is null and (select count(*) from jsonb_object_keys(facts)) = 2)
   from public.manager_board_entries where kind = 'assignee_changed'), true);

select pg_temp.as_user(pg_temp.boss());
select public.set_manager_card_assignee(pg_temp.cid(1), pg_temp.ina());
select pg_temp.as_server();
select pg_temp.check('2.6 the same person again changes nothing: no line, no push',
  cardinality(pg_temp.lines(pg_temp.cid(1))) || ' ' || cardinality(pg_temp.pushes()), '1 1');

select pg_temp.as_user(pg_temp.boss());
select public.set_manager_card_assignee(pg_temp.cid(2), null);
select public.set_manager_card_assignee(pg_temp.cid(2), pg_temp.boss());
select pg_temp.as_server();
select pg_temp.check('2.7 cleared and given back to himself: two lines, and no push to himself',
  pg_temp.lines(pg_temp.cid(2)) || array[cardinality(pg_temp.pushes())::text],
  array['boss>- by boss', '->boss by boss', '1']);

select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('2.8 an admin assigns on anybody''s board',
  (select pg_temp.who(c.assignee_id) from public.set_manager_card_assignee(pg_temp.cid(3), pg_temp.ina()) c), 'ina');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('2.9 only an active manager or admin of the company is assigned',
  array[pg_temp.refusal($q$ select public.set_manager_card_assignee(pg_temp.cid(1), pg_temp.anna()) $q$),
        pg_temp.refusal($q$ select public.set_manager_card_assignee(pg_temp.cid(1), pg_temp.dora()) $q$),
        pg_temp.refusal($q$ select public.set_manager_card_assignee(pg_temp.cid(1), pg_temp.olga()) $q$),
        pg_temp.refusal($q$ select public.set_manager_card_assignee(pg_temp.cid(1), 'b0a2e0ff-0000-4000-8000-0000000000ff') $q$)],
  array['serverErrors.boardAssigneeInvalid', 'serverErrors.boardAssigneeInvalid',
        'serverErrors.boardAssigneeInvalid', 'serverErrors.boardAssigneeInvalid']);

-- ===========================================================================
-- 3. What the assignee may do, and may not
-- ===========================================================================

select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('3.1 the assignee changes the fields and the due date, moves it, adds and ticks a step, writes',
  array[pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(1), pg_temp.board(), 'Bathroom, tiles', 'notes', current_date + 2, null, 'teal') $q$),
        pg_temp.refusal($q$ select public.move_manager_card(pg_temp.cid(1), 'in_progress') $q$),
        pg_temp.refusal($q$ select public.save_manager_step('b0a2e300-0000-4000-8000-000000000001', pg_temp.cid(1), 'Buy tiles') $q$),
        pg_temp.refusal($q$ select public.set_manager_step_done('b0a2e300-0000-4000-8000-000000000001', true) $q$),
        pg_temp.refusal($q$ select public.save_manager_comment('b0a2e400-0000-4000-8000-000000000001', pg_temp.cid(1), 'Tiles bought') $q$),
        pg_temp.refusal($q$ select public.save_manager_comment('b0a2e400-0000-4000-8000-000000000001', null, 'Tiles bought, fitted') $q$)],
  array['no error', 'no error', 'no error', 'no error', 'no error', 'no error']);
select pg_temp.check('3.2 but not the board, the card''s shelf, its copy, its assignment, a new card or another card',
  array[pg_temp.refusal($q$ select public.save_manager_board(pg_temp.board(), 'Mine') $q$),
        pg_temp.refusal($q$ select public.set_manager_board_archived(pg_temp.board(), true) $q$),
        pg_temp.refusal($q$ select public.set_manager_card_state(pg_temp.cid(1), 'archived') $q$),
        pg_temp.refusal($q$ select public.duplicate_manager_card(pg_temp.cid(1), pg_temp.cid(9), 'x') $q$),
        pg_temp.refusal($q$ select public.set_manager_card_assignee(pg_temp.cid(1), pg_temp.ada()) $q$),
        pg_temp.refusal($q$ select public.save_manager_card(pg_temp.cid(8), pg_temp.board(), 'x', '', null, null, null, 'open') $q$),
        pg_temp.refusal($q$ select public.move_manager_card(pg_temp.cid(2), 'resolved') $q$)],
  array['serverErrors.boardNotYours', 'serverErrors.boardNotYours', 'serverErrors.boardNotYours',
        'serverErrors.boardNotYours', 'serverErrors.boardNotYours', 'serverErrors.boardNotYours',
        'serverErrors.boardNotYours']);
select pg_temp.as_server();
select pg_temp.check('3.3 her work is the card''s, with her name on it',
  (select c.title || ' ' || c.column_key || ' ' || (c.due_on - current_date)::text from public.manager_board_cards c where c.id = pg_temp.cid(1))
  || ' ' || (select pg_temp.who(author_id) from public.manager_board_entries where id = 'b0a2e400-0000-4000-8000-000000000001'),
  'Bathroom, tiles in_progress 2 ina');
select pg_temp.check('3.4 a save of the fields leaves the assignee where it is',
  pg_temp.assignee(pg_temp.cid(1)), 'ina');

select pg_temp.as_user(pg_temp.boss());
select public.set_manager_card_assignee(pg_temp.cid(1), pg_temp.ada());
select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('3.5 taken off the card, she works on it no more',
  pg_temp.refusal($q$ select public.move_manager_card(pg_temp.cid(1), 'resolved') $q$), 'serverErrors.boardNotYours');
select pg_temp.as_server();
select pg_temp.check('3.6 the admin she was replaced by heard of it',
  (pg_temp.pushes())[cardinality(pg_temp.pushes())], 'ada board_card_assigned ' || jsonb_build_object('card_id', pg_temp.cid(1))::text);

-- ===========================================================================
-- 4. Strangers, shelves, an archived board
-- ===========================================================================

select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('4.1 a cleaner assigns nothing',
  pg_temp.refusal($q$ select public.set_manager_card_assignee(pg_temp.cid(1), pg_temp.anna()) $q$), 'serverErrors.managerOnly');
select pg_temp.as_user(pg_temp.olga());
select pg_temp.check('4.2 another company finds no card',
  pg_temp.refusal($q$ select public.set_manager_card_assignee(pg_temp.cid(1), pg_temp.olga()) $q$), 'serverErrors.boardCardNotFound');
select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('4.3 another manager assigns nothing on a board not hers',
  pg_temp.refusal($q$ select public.set_manager_card_assignee(pg_temp.cid(2), pg_temp.ina()) $q$), 'serverErrors.boardNotYours');
select pg_temp.as_user(pg_temp.boss());
select public.set_manager_card_state(pg_temp.cid(2), 'archived');
select pg_temp.check('4.4 a shelved card is not assigned',
  pg_temp.refusal($q$ select public.set_manager_card_assignee(pg_temp.cid(2), pg_temp.ina()) $q$), 'serverErrors.boardCardShelved');
select public.set_manager_board_archived(pg_temp.board(), true);
select pg_temp.as_user(pg_temp.ina());
select pg_temp.check('4.5 on an archived board the assignee works on nothing',
  pg_temp.refusal($q$ select public.save_manager_comment('b0a2e400-0000-4000-8000-000000000009', pg_temp.cid(3), 'x') $q$), 'serverErrors.boardArchived');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('4.6 and nobody assigns',
  pg_temp.refusal($q$ select public.set_manager_card_assignee(pg_temp.cid(3), pg_temp.boss()) $q$), 'serverErrors.boardArchived');
select pg_temp.as_server();
select pg_temp.check('4.7 anon may not call it',
  has_function_privilege('anon', 'public.set_manager_card_assignee(uuid, uuid)', 'execute'), false);
select pg_temp.check('4.8 no word of a card reached the push outbox',
  (select count(*) from raw.push_outbox o where o::text ~ '(Bathroom|Projects|Tiles|Admin made)'), 0::bigint);

select pg_temp.check('4.9 the titles of a push are read by the sender alone',
  array[has_function_privilege('authenticated', 'public.push_board_card_titles(uuid[])', 'execute'),
        has_function_privilege('anon', 'public.push_board_card_titles(uuid[])', 'execute'),
        has_function_privilege('service_role', 'public.push_board_card_titles(uuid[])', 'execute')],
  array[false, false, true]);
select pg_temp.check('4.10 and read as they are now, a card unknown left out',
  (select array_agg(t.card_title || ' / ' || t.board_title)
   from public.push_board_card_titles(array[pg_temp.cid(1), 'b0a2e2ff-0000-4000-8000-0000000000ff'::uuid]) t),
  array['Bathroom, tiles / Projects']);

rollback;
