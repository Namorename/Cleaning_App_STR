-- The office's own note on a property.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: properties.internal_notes was marked "Office only.
-- Never leaves the manager panel" and yet any active cleaner could read it
-- through the API — row security filters rows, and a cleaner reads the
-- property row. The note now lives in a table of its own that only a manager
-- of the property's company reads or writes (docs/window3-plan.md, «А»).
--
-- Fixture ids live in the 9000025xx range.
begin;

insert into public.hosts (id, name) values
  ('b2500000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d2500003-0000-4000-8000-0000000000d3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.notes@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('d2500001-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.notes@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d2500002-0000-4000-8000-0000000000d2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tech.notes@test.local','x',now(),now(),
   '{"full_name":"Tech"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('d2500004-0000-4000-8000-0000000000d4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','former.boss.notes@test.local','x',now(),now(),
   '{"full_name":"Former Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('d2500009-0000-4000-8000-0000000000d9','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.b.notes@test.local','x',now(),now(),
   '{"full_name":"Boss B"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'b2500000-0000-4000-8000-00000000000b'
where id = 'd2500009-0000-4000-8000-0000000000d9';
update public.profiles set is_active = false
where id = 'd2500004-0000-4000-8000-0000000000d4';

insert into public.properties (id, host_id, name, timezone) values
  (900002501, default, 'Flat with an owner', 'UTC'),
  (900002502, 'b2500000-0000-4000-8000-00000000000b', 'Flat of host B', 'UTC'),
  (900002503, default, 'Flat without a note', 'UTC');

-- Maria cleans this flat and the technician repairs in it: the two people
-- closest to it, and the two the note must still never reach.
insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900002501, 'd2500001-0000-4000-8000-0000000000d1', 'auto');
insert into public.tasks (property_id, type, status, assignee_id, scheduled_date) values
  (900002501, 'maintenance', 'assigned', 'd2500002-0000-4000-8000-0000000000d2', current_date);

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $fn$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$fn$;

create or replace function pg_temp.refusal_state(stmt text) returns text
language plpgsql as $fn$
begin
  execute stmt;
  return 'no refusal';
exception when others then
  return SQLSTATE;
end $fn$;

-- A plain insert, as a POST without upsert would send it: this is what the
-- policy's WITH CHECK decides alone. An upsert onto an existing note is
-- refused earlier, by USING on the conflicting row.
create or replace function pg_temp.insert_state(p bigint) returns text language sql as $fn$
  select pg_temp.refusal_state(format(
    'insert into public.property_internal_notes (property_id, notes) values (%s, %L)',
    p, 'slipped in'))
$fn$;

-- What the panel sends: property_id and the text, never the company. The
-- company comes from the column default — the writer's own.
create or replace function pg_temp.upsert_note(p bigint, n text) returns void
language sql as $fn$
  insert into public.property_internal_notes (property_id, notes) values (p, n)
  on conflict (property_id) do update set notes = excluded.notes
$fn$;

create or replace function pg_temp.note_of(p bigint) returns text language sql as $fn$
  select notes from public.property_internal_notes where property_id = p
$fn$;

-- ---------- the column is gone from the property row ----------

select pg_temp.check('properties no longer carries an office note',
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'properties'
     and column_name = 'internal_notes'), 0);

-- ---------- a manager of the company ----------

select pg_temp.as_user('d2500003-0000-4000-8000-0000000000d3');

select pg_temp.upsert_note(900002501, 'Owner is picky about the towels');
select pg_temp.check('a manager writes the note',
  pg_temp.note_of(900002501), 'Owner is picky about the towels');

select pg_temp.upsert_note(900002501, 'Owner checks the balcony');
select pg_temp.check('and rewrites it in place',
  pg_temp.note_of(900002501), 'Owner checks the balcony');
select pg_temp.check('one note per property',
  (select count(*)::int from public.property_internal_notes where property_id = 900002501), 1);

select pg_temp.check('a blank note is not a note',
  pg_temp.refusal_state($$select pg_temp.upsert_note(900002501, '   ')$$), '23514');

-- ---------- everybody else in the company ----------

select pg_temp.as_user('d2500001-0000-4000-8000-0000000000d1');
select pg_temp.check('the cleaner of the flat does not see the note',
  (select count(*)::int from public.property_internal_notes), 0);
select pg_temp.check('and cannot write one',
  pg_temp.refusal_state($$select pg_temp.upsert_note(900002501, 'I was here')$$), '42501');
select pg_temp.check('not even on a flat that has none yet',
  pg_temp.insert_state(900002503), '42501');

update public.property_internal_notes set notes = 'overwritten' where property_id = 900002501;
delete from public.property_internal_notes where property_id = 900002501;

select pg_temp.as_user('d2500002-0000-4000-8000-0000000000d2');
select pg_temp.check('the technician repairing it does not see the note',
  (select count(*)::int from public.property_internal_notes), 0);
select pg_temp.check('and cannot write one',
  pg_temp.insert_state(900002503), '42501');

select pg_temp.as_user('d2500004-0000-4000-8000-0000000000d4');
select pg_temp.check('a deactivated manager does not see it',
  (select count(*)::int from public.property_internal_notes), 0);
select pg_temp.check('nor write one',
  pg_temp.insert_state(900002503), '42501');

select pg_temp.as_user('d2500003-0000-4000-8000-0000000000d3');
select pg_temp.check('and nothing the others tried reached the note',
  pg_temp.note_of(900002501), 'Owner checks the balcony');

-- ---------- another company ----------

select pg_temp.as_user('d2500009-0000-4000-8000-0000000000d9');
select pg_temp.check('a manager of another company does not see it',
  (select count(*)::int from public.property_internal_notes where property_id = 900002501), 0);
select pg_temp.check('and cannot put a note on a flat that is not hers',
  pg_temp.refusal_state($$select pg_temp.upsert_note(900002501, 'mine now')$$) <> 'no refusal',
  true);

select pg_temp.upsert_note(900002502, 'Host B keeps its own notes');
select pg_temp.check('she writes on her own flat without naming her company',
  pg_temp.note_of(900002502), 'Host B keeps its own notes');

-- ---------- clearing and deleting ----------

select pg_temp.as_user('d2500003-0000-4000-8000-0000000000d3');
delete from public.property_internal_notes where property_id = 900002501;
select pg_temp.check('clearing the note removes the row',
  (select count(*)::int from public.property_internal_notes where property_id = 900002501), 0);

reset role; reset request.jwt.claims;
insert into public.property_internal_notes (property_id, host_id, notes)
select id, host_id, 'written just before the flat left' from public.properties
where id = 900002501;
delete from public.tasks where property_id = 900002501;
delete from public.properties where id = 900002501;
select pg_temp.check('the note goes with its property',
  (select count(*)::int from public.property_internal_notes where property_id = 900002501), 0);

rollback;
