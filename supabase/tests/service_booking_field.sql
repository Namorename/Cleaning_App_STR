-- The "#" rule as a computed field of a booking (docs/f10-plan.md, §2,
-- the owner's option a of 2026-09-26). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- The calendar reads `is_service_booking` with each booking, so a service
-- booking is drawn as a block. The rule itself stays one function,
-- is_service_booking(text) of 20260926102000; the field only hands it a row.
begin;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create temp table names (name text, want boolean);
insert into names values
  ('#Boiler - ремонт', true),
  ('  #x', true),
  (chr(160) || '#Owner', true),
  ('Guest #2', false),
  ('Jan Novák', false),
  (null, false),
  (chr(65283) || 'x', false);

select pg_temp.check(
  'the field answers what the rule answers, name by name',
  (select count(*)
     from names n
    where public.is_service_booking(
            jsonb_populate_record(null::public.reservations, jsonb_build_object('guest_name', n.name))
          ) is distinct from n.want),
  0::bigint);

-- The field is an overload of the same name. A call with a bare literal must
-- still find the text rule: an unknown argument prefers the string category.
select pg_temp.check(
  'a bare literal still reaches the text rule',
  public.is_service_booking('#Boiler'),
  true);

-- PostgREST offers a function as a column of a table when it takes that
-- table's row and writes nothing.
select pg_temp.check(
  'the field takes a booking row and writes nothing',
  (select provolatile
     from pg_proc
    where oid = 'public.is_service_booking(public.reservations)'::regprocedure),
  'i'::"char");

select pg_temp.check(
  'a manager reads it with the booking',
  has_function_privilege('authenticated', 'public.is_service_booking(public.reservations)', 'execute'),
  true);

select pg_temp.check(
  'the server can too',
  has_function_privilege('service_role', 'public.is_service_booking(public.reservations)', 'execute'),
  true);

select pg_temp.check(
  'anon cannot',
  has_function_privilege('anon', 'public.is_service_booking(public.reservations)', 'execute'),
  false);

rollback;
