-- A person's own order of the board tabs (20261126160000_board_tab_order). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: the order is the person's alone — she reads and writes her own row and
-- nobody else's, straight into the table or through save_board_tab_order alike; two people's
-- orders do not touch; a switched-off account keeps no order; only a list of tabs is stored.
--
-- Every value below is synthetic. Fixture ids live in the b7a0… uuids.
begin;

-- The helpers below run as a person too (rolled back with the rest).
alter default privileges for role postgres grant execute on functions to authenticated;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

insert into public.hosts (id, name) values
  ('b7a00000-0000-4000-8000-00000000000a', 'Tab order co'),
  ('b7a00000-0000-4000-8000-00000000000b', 'Other co');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b7a00001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'anna.tabs@test.local', 'x', now(), now(), '{"full_name":"Anna"}', '{"role":"manager"}'),
  ('b7a00002-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'boris.tabs@test.local', 'x', now(), now(), '{"full_name":"Boris"}', '{"role":"admin"}'),
  ('b7a00003-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'off.tabs@test.local', 'x', now(), now(), '{"full_name":"Off"}', '{"role":"manager"}'),
  ('b7a00004-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'away.tabs@test.local', 'x', now(), now(), '{"full_name":"Away"}', '{"role":"manager"}');

update public.profiles set host_id = 'b7a00000-0000-4000-8000-00000000000a'
where id in ('b7a00001-0000-4000-8000-000000000001', 'b7a00002-0000-4000-8000-000000000002',
             'b7a00003-0000-4000-8000-000000000003');
update public.profiles set host_id = 'b7a00000-0000-4000-8000-00000000000b'
where id = 'b7a00004-0000-4000-8000-000000000004';
update public.profiles set is_active = false where id = 'b7a00003-0000-4000-8000-000000000003';

create function pg_temp.as_person(p_id uuid) returns void language plpgsql as $fn$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_id, 'role', 'authenticated')::text, true);
end $fn$;

create function pg_temp.as_office() returns void language plpgsql as $fn$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '{}', true);
end $fn$;

-- What the table holds, read past RLS.
create function pg_temp.stored(p_id uuid) returns text[] language sql as $fn$
  select o.tab_ids from public.board_tab_orders o where o.profile_id = p_id
$fn$;

-- ---------- Anna saves her order and reads it back ----------
select pg_temp.as_person('b7a00001-0000-4000-8000-000000000001');
select pg_temp.check('1 save_board_tab_order answers the order it saved',
  public.save_board_tab_order(array['mine', 'b7a0b000-0000-4000-8000-000000000001', 'tech']),
  array['mine', 'b7a0b000-0000-4000-8000-000000000001', 'tech']);
select pg_temp.check('2 she reads her order back',
  (select tab_ids from public.board_tab_orders), array['mine', 'b7a0b000-0000-4000-8000-000000000001', 'tech']);
select pg_temp.check('3 a second save replaces it: still one row',
  public.save_board_tab_order(array['tech', 'mine']), array['tech', 'mine']);
select pg_temp.check('4 one row, hers, in her company',
  (select count(*)::text || ' ' || min(host_id::text) from public.board_tab_orders),
  '1 b7a00000-0000-4000-8000-00000000000a');

-- ---------- Boris: his own order, independent of hers ----------
select pg_temp.as_person('b7a00002-0000-4000-8000-000000000002');
select pg_temp.check('5 a colleague without a row reads nothing — not hers',
  (select count(*) from public.board_tab_orders), 0::bigint);
select pg_temp.check('6 he saves his own',
  public.save_board_tab_order(array['b7a0b000-0000-4000-8000-000000000002', 'tech', 'mine']),
  array['b7a0b000-0000-4000-8000-000000000002', 'tech', 'mine']);
select pg_temp.check('7 and sees only his',
  (select array_agg(profile_id::text) from public.board_tab_orders), array['b7a00002-0000-4000-8000-000000000002']);

-- He may not change hers: an update of her row touches nothing.
update public.board_tab_orders set tab_ids = array['mine']
where profile_id = 'b7a00001-0000-4000-8000-000000000001';

-- Nor write a row in her name.
do $$
begin
  insert into public.board_tab_orders (profile_id, tab_ids)
  values ('b7a00004-0000-4000-8000-000000000004', array['tech']);
  raise exception 'FAIL a person wrote a row in another person''s name';
exception when insufficient_privilege then
  raise notice 'ok  8 a row in another person''s name is refused';
end $$;

-- Nor move his own row into another company.
do $$
begin
  update public.board_tab_orders set host_id = 'b7a00000-0000-4000-8000-00000000000b'
  where profile_id = 'b7a00002-0000-4000-8000-000000000002';
  raise exception 'FAIL a person moved her order into another company';
exception when insufficient_privilege then
  raise notice 'ok  9 his row stays in his company';
end $$;

-- A write straight into his own row is his (the same rule as the function's).
update public.board_tab_orders set tab_ids = array['tech', 'b7a0b000-0000-4000-8000-000000000002']
where profile_id = 'b7a00002-0000-4000-8000-000000000002';

select pg_temp.as_office();
select pg_temp.check('10 her order is untouched by his writes',
  pg_temp.stored('b7a00001-0000-4000-8000-000000000001'), array['tech', 'mine']);
select pg_temp.check('11 his straight write is his',
  pg_temp.stored('b7a00002-0000-4000-8000-000000000002'), array['tech', 'b7a0b000-0000-4000-8000-000000000002']);
select pg_temp.check('12 nobody wrote a row for the person in the other company',
  pg_temp.stored('b7a00004-0000-4000-8000-000000000004'), null::text[]);

-- ---------- Only a list of tabs ----------
select pg_temp.as_person('b7a00001-0000-4000-8000-000000000001');
do $$
declare
  v_list text;
  v_hint text;
begin
  foreach v_list in array array[
    '{tech,tech}',                                   -- a tab twice
    '{tech,board}',                                  -- not a tab id
    '{tech,B7A0B000-0000-4000-8000-000000000001}',   -- upper case
    '{tech,NULL}',                                   -- a hole
    '{{tech,mine},{mine,tech}}'                      -- not a list
  ] loop
    begin
      perform public.save_board_tab_order(v_list::text[]);
      raise exception 'FAIL the list % was stored', v_list;
    exception when invalid_parameter_value then
      get stacked diagnostics v_hint = pg_exception_hint;
      if v_hint <> 'serverErrors.boardTabOrderInvalid' then
        raise exception 'FAIL hint %', v_hint;
      end if;
    end;
  end loop;
  raise notice 'ok  13 a doubled, a foreign, an upper-case or an empty tab, or a table of them, is refused, with its hint';
end $$;

do $$
begin
  perform public.save_board_tab_order(null);
  raise exception 'FAIL no list was stored';
exception when invalid_parameter_value then
  raise notice 'ok  14 no list at all is refused';
end $$;

do $$
begin
  perform public.save_board_tab_order(
    array(select gen_random_uuid()::text from generate_series(1, 201)));
  raise exception 'FAIL 201 tabs were stored';
exception when invalid_parameter_value then
  raise notice 'ok  15 more than 200 tabs are refused';
end $$;

-- The table's own check holds a straight write to the same rule.
do $$
begin
  update public.board_tab_orders set tab_ids = array['mine', 'mine']
  where profile_id = 'b7a00001-0000-4000-8000-000000000001';
  raise exception 'FAIL a doubled tab was written straight into the table';
exception when check_violation then
  raise notice 'ok  16 the table refuses a doubled tab too';
end $$;

select pg_temp.check('17 an empty order is an order: the default one',
  public.save_board_tab_order(array[]::text[]), array[]::text[]);
select pg_temp.check('17a and the next save brings hers back',
  public.save_board_tab_order(array['tech', 'mine']), array['tech', 'mine']);

-- ---------- A switched-off account keeps no order ----------
select pg_temp.as_person('b7a00003-0000-4000-8000-000000000003');
do $$
declare
  v_hint text;
begin
  perform public.save_board_tab_order(array['tech']);
  raise exception 'FAIL a switched-off account saved an order';
exception when insufficient_privilege then
  get stacked diagnostics v_hint = pg_exception_hint;
  if v_hint <> 'serverErrors.notSignedIn' then
    raise exception 'FAIL hint %', v_hint;
  end if;
  raise notice 'ok  18 a switched-off account saves nothing, and is told to sign in';
end $$;

do $$
begin
  insert into public.board_tab_orders (profile_id, tab_ids)
  values ('b7a00003-0000-4000-8000-000000000003', array['tech']);
  raise exception 'FAIL a switched-off account wrote straight into the table';
exception when not_null_violation or insufficient_privilege then
  raise notice 'ok  19 nor straight into the table';
end $$;

-- Switched off after saving: the row is no longer hers to read.
select pg_temp.as_office();
update public.profiles set is_active = false where id = 'b7a00002-0000-4000-8000-000000000002';
select pg_temp.as_person('b7a00002-0000-4000-8000-000000000002');
select pg_temp.check('20 a switched-off account reads no order',
  (select count(*) from public.board_tab_orders), 0::bigint);

-- ---------- The person in the other company ----------
select pg_temp.as_office();
update public.profiles set is_active = true where id = 'b7a00002-0000-4000-8000-000000000002';
select pg_temp.as_person('b7a00004-0000-4000-8000-000000000004');
select pg_temp.check('21 a person of another company reads none of theirs',
  (select count(*) from public.board_tab_orders), 0::bigint);
select public.save_board_tab_order(array['mine']);
select pg_temp.check('22 and her own row is of her company',
  (select host_id from public.board_tab_orders), 'b7a00000-0000-4000-8000-00000000000b'::uuid);

-- ---------- The grants ----------
select pg_temp.as_office();
select pg_temp.check('23 anon may do nothing with the table or the functions',
  (select has_table_privilege('anon', 'public.board_tab_orders', 'select')
       or has_table_privilege('anon', 'public.board_tab_orders', 'insert')
       or has_function_privilege('anon', 'public.save_board_tab_order(text[])', 'execute')
       or has_function_privilege('anon', 'public.board_tab_ids_valid(text[])', 'execute')),
  false);
select pg_temp.check('24 a person may not delete a row nor empty the table',
  (select has_table_privilege('authenticated', 'public.board_tab_orders', 'delete')
       or has_table_privilege('authenticated', 'public.board_tab_orders', 'truncate')),
  false);
select pg_temp.check('25 the function runs as its caller: RLS decides for it too',
  (select prosecdef from pg_proc where oid = 'public.save_board_tab_order(text[])'::regprocedure), false);

-- A person who goes takes her order with her.
delete from auth.users where id = 'b7a00001-0000-4000-8000-000000000001';
select pg_temp.check('26 the order goes with its person',
  pg_temp.stored('b7a00001-0000-4000-8000-000000000001'), null::text[]);

rollback;
