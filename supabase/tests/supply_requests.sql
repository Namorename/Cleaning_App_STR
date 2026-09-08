-- Supply requests: a cleaner asks for what she works with. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- Personal: only the author and the managers see a request. Written only
-- through RPC, replayable by id, editable while nobody has picked it up.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d9000001-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.supply@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d9000002-0000-4000-8000-0000000000d2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.supply@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d9000004-0000-4000-8000-0000000000d4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.supply@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb);

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900001901, 'Flat running low', 'UTC', '15:00', '10:00');

insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900001901, 'd9000001-0000-4000-8000-0000000000d1', 'claim');

insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date) values
  ('a9000001-0000-4000-8000-000000000001', 900001901, 'cleaning', 'in_progress',
   'd9000001-0000-4000-8000-0000000000d1', current_date);

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
  v_hint   text;
  v_detail text;
begin
  execute statement;
  return 'no refusal';
exception when check_violation or insufficient_privilege then
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return v_hint || coalesce(' ' || nullif(v_detail, ''), '');
end $$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;
create or replace function pg_temp.as_maria() returns void language sql as $$
  select pg_temp.as_user('d9000001-0000-4000-8000-0000000000d1') $$;
create or replace function pg_temp.as_anna() returns void language sql as $$
  select pg_temp.as_user('d9000002-0000-4000-8000-0000000000d2') $$;
create or replace function pg_temp.as_boss() returns void language sql as $$
  select pg_temp.as_user('d9000004-0000-4000-8000-0000000000d4') $$;

create or replace function pg_temp.rid(n integer) returns uuid language sql immutable as $$
  select ('c9000001-0000-4000-8000-00000000000' || n::text)::uuid $$;
create or replace function pg_temp.request(n integer) returns public.supply_requests language sql as $$
  select r.* from public.supply_requests r where r.id = pg_temp.rid(n) $$;
create or replace function pg_temp.items(n integer) returns text language sql as $$
  select string_agg(name || ' ' || quantity::text || ' ' || unit::text
                    || coalesce(' (' || comment || ')', ''), '; ' order by sort_order)
  from public.supply_request_items where request_id = pg_temp.rid(n) $$;

-- ---------- creating ----------
select pg_temp.as_maria();
select public.save_supply_request(pg_temp.rid(1),
  '[{"name": " Средство для стёкол ", "quantity": 2, "unit": "pcs"},
    {"name": "Мешки для мусора", "quantity": 1, "unit": "pack", "comment": "60 л"}]',
  'urgent', 'Заканчивается сегодня', null, null, 'a9000001-0000-4000-8000-000000000001');
reset role; reset request.jwt.claims;

select pg_temp.check('the request is new and urgent',
  (pg_temp.request(1)).status::text || ' ' || (pg_temp.request(1)).priority::text, 'new urgent');
select pg_temp.check('the author is the caller',
  (pg_temp.request(1)).requested_by, 'd9000001-0000-4000-8000-0000000000d1'::uuid);
select pg_temp.check('the listing comes from the task',
  (pg_temp.request(1)).property_id, 900001901::bigint);
select pg_temp.check('items are stored in order, trimmed, with units and comments',
  pg_temp.items(1), 'Средство для стёкол 2.00 pcs; Мешки для мусора 1.00 pack (60 л)');

select pg_temp.as_maria();
select pg_temp.check('a request needs at least one item',
  pg_temp.refusal($q$select public.save_supply_request(pg_temp.rid(2), '[]')$q$),
  'serverErrors.supplyItemsRequired');
select pg_temp.check('an item without a name is named by its position',
  pg_temp.refusal($q$select public.save_supply_request(pg_temp.rid(2),
    '[{"name": "x", "quantity": 1}, {"name": "  ", "quantity": 1}]')$q$),
  'serverErrors.supplyItemInvalid {"index": 2}');
select pg_temp.check('a zero quantity is refused',
  pg_temp.refusal($q$select public.save_supply_request(pg_temp.rid(2), '[{"name": "x", "quantity": 0}]')$q$),
  'serverErrors.supplyItemInvalid {"index": 1}');
select pg_temp.check('an unknown unit is refused',
  pg_temp.refusal($q$select public.save_supply_request(pg_temp.rid(2),
    '[{"name": "x", "quantity": 1, "unit": "box"}]')$q$),
  'serverErrors.supplyItemInvalid {"index": 1}');
select pg_temp.check('the note has a limit',
  pg_temp.refusal($q$select public.save_supply_request(pg_temp.rid(2), '[{"name": "x", "quantity": 1}]',
    'normal', repeat('n', 2001))$q$),
  'serverErrors.supplyNoteTooLong {"limit": 2000}');
-- A general request, no listing: the unit defaults to pieces.
select public.save_supply_request(pg_temp.rid(2), '[{"name": "Перчатки", "quantity": 3}]');
reset role; reset request.jwt.claims;
select pg_temp.check('a general request has no listing and pieces by default',
  coalesce((pg_temp.request(2)).property_id::text, 'none') || ' ' || pg_temp.items(2), 'none Перчатки 3.00 pcs');

-- ---------- rewriting while new ----------
select pg_temp.as_maria();
select public.save_supply_request(pg_temp.rid(1),
  '[{"name": "Средство для стёкол", "quantity": 3, "unit": "l"}]', 'normal', null);
reset role; reset request.jwt.claims;
select pg_temp.check('a save while new replaces the items wholesale',
  pg_temp.items(1), 'Средство для стёкол 3.00 l');
select pg_temp.check('and the header',
  (pg_temp.request(1)).priority::text || ' ' || coalesce((pg_temp.request(1)).note, 'no note'), 'normal no note');

select pg_temp.as_anna();
select pg_temp.check('a colleague replaying the id is told nothing',
  pg_temp.refusal($q$select public.save_supply_request(pg_temp.rid(1), '[{"name": "x", "quantity": 1}]')$q$),
  'serverErrors.supplyNotFound');
select pg_temp.check('a colleague sees no requests',
  (select count(*)::int from public.supply_requests), 0);
select pg_temp.check('nor their items',
  (select count(*)::int from public.supply_request_items), 0);
select pg_temp.check('withdrawing someone else''s request does nothing',
  public.delete_supply_request(pg_temp.rid(1)), false);
reset role; reset request.jwt.claims;

select pg_temp.as_maria();
select pg_temp.check('the author sees both requests',
  (select count(*)::int from public.supply_requests), 2);
select pg_temp.check('with their items',
  (select count(*)::int from public.supply_request_items), 2);
select pg_temp.check('the author withdraws a new request',
  public.delete_supply_request(pg_temp.rid(2)), true);
reset role; reset request.jwt.claims;
select pg_temp.check('the withdrawn request and its items are gone',
  (select count(*)::int from public.supply_request_items where request_id = pg_temp.rid(2)), 0);

-- ---------- the manager processes it ----------
select pg_temp.as_maria();
select pg_temp.check('a cleaner cannot review',
  pg_temp.refusal($q$select public.review_supply_request(pg_temp.rid(1), 'accepted')$q$),
  'serverErrors.managerOnly');
reset role; reset request.jwt.claims;

select pg_temp.as_boss();
select pg_temp.check('the manager sees every request',
  (select count(*)::int from public.supply_requests), 1);
select pg_temp.check('a request cannot skip to ordered',
  pg_temp.refusal($q$select public.review_supply_request(pg_temp.rid(1), 'ordered')$q$),
  'serverErrors.supplyTransitionInvalid {"to": "ordered", "from": "new"}');
select pg_temp.check('a rejection needs a reason',
  pg_temp.refusal($q$select public.review_supply_request(pg_temp.rid(1), 'rejected')$q$),
  'serverErrors.reasonRequired');
select public.review_supply_request(pg_temp.rid(1), 'accepted');
reset role; reset request.jwt.claims;
select pg_temp.check('accepting stamps the reviewer',
  (pg_temp.request(1)).status::text || ' ' || ((pg_temp.request(1)).reviewed_by = 'd9000004-0000-4000-8000-0000000000d4')::text,
  'accepted true');

select pg_temp.as_maria();
select pg_temp.check('once accepted the author can no longer edit',
  pg_temp.refusal($q$select public.save_supply_request(pg_temp.rid(1), '[{"name": "x", "quantity": 1}]')$q$),
  'serverErrors.supplyNotEditable');
select pg_temp.check('nor withdraw',
  pg_temp.refusal($q$select public.delete_supply_request(pg_temp.rid(1))$q$),
  'serverErrors.supplyNotEditable');
select pg_temp.check('but still sees it',
  (select status::text from public.supply_requests where id = pg_temp.rid(1)), 'accepted');
reset role; reset request.jwt.claims;

select pg_temp.as_boss();
select public.review_supply_request(pg_temp.rid(1), 'ordered');
select public.review_supply_request(pg_temp.rid(1), 'fulfilled');
select public.review_supply_request(pg_temp.rid(1), 'fulfilled');
select pg_temp.check('a fulfilled request is closed for good',
  pg_temp.refusal($q$select public.review_supply_request(pg_temp.rid(1), 'rejected', 'x')$q$),
  'serverErrors.supplyTransitionInvalid {"to": "rejected", "from": "fulfilled"}');
reset role; reset request.jwt.claims;
select pg_temp.check('fulfilling stamps the moment',
  ((pg_temp.request(1)).fulfilled_at is not null), true);

select pg_temp.as_maria();
select public.save_supply_request(pg_temp.rid(3), '[{"name": "Швабра", "quantity": 1}]', 'normal', null, current_date + 3);
select pg_temp.as_boss();
select public.review_supply_request(pg_temp.rid(3), 'rejected', '  Швабры есть на складе  ');
reset role; reset request.jwt.claims;
select pg_temp.check('a rejection keeps its reason for the author',
  (pg_temp.request(3)).status::text || ' ' || (pg_temp.request(3)).reject_reason,
  'rejected Швабры есть на складе');
select pg_temp.check('the needed-by date is kept',
  (pg_temp.request(3)).needed_by, current_date + 3);

rollback;
