-- The two switches that belong to the company as a whole.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: `hosts` is readable by everyone on the staff and
-- writable by nobody — the only door is `update_host_settings`, and only a
-- manager may walk through it. A call names the switches it means and leaves
-- the rest alone, so two managers on two screens do not undo each other. And
-- the gallery starts off: a company that has never heard of the setting keeps
-- taking photographs with the camera, which is what its cleaners do today.
--
-- Fixture ids live in the d8xxxxxx / b8xxxxxx range.
begin;

insert into public.hosts (id, name) values
  ('b8000000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d8000003-0000-4000-8000-0000000000d3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.settings@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('d8000001-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.settings@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d8000009-0000-4000-8000-0000000000d9','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.b.settings@test.local','x',now(),now(),
   '{"full_name":"Boss B"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'b8000000-0000-4000-8000-00000000000b'
where id = 'd8000009-0000-4000-8000-0000000000d9';

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;

create or replace function pg_temp.as_boss() returns void language sql as $$
  select pg_temp.as_user('d8000003-0000-4000-8000-0000000000d3')
$$;
create or replace function pg_temp.as_maria() returns void language sql as $$
  select pg_temp.as_user('d8000001-0000-4000-8000-0000000000d1')
$$;
create or replace function pg_temp.as_boss_b() returns void language sql as $$
  select pg_temp.as_user('d8000009-0000-4000-8000-0000000000d9')
$$;

-- The i18n key a refusal carries, or 'no refusal' when the statement went through.
create or replace function pg_temp.refusal_hint(stmt text) returns text
language plpgsql as $$
declare v_hint text;
begin
  execute stmt;
  return 'no refusal';
exception when others then
  get stacked diagnostics v_hint = PG_EXCEPTION_HINT;
  return coalesce(v_hint, '(no hint)');
end $$;

-- The SQLSTATE, for the refusals that come from the grant rather than the code.
create or replace function pg_temp.refusal_code(stmt text) returns text
language plpgsql as $$
declare v_code text;
begin
  execute stmt;
  return 'no refusal';
exception when others then
  get stacked diagnostics v_code = RETURNED_SQLSTATE;
  return v_code;
end $$;

create or replace function pg_temp.gallery_of(h uuid) returns boolean language sql as $$
  select gallery_allowed from public.hosts where id = h
$$;

create or replace function pg_temp.parallel_of(h uuid) returns boolean language sql as $$
  select parallel_start_allowed from public.hosts where id = h
$$;

-- The company the fixtures work in — the one every profile lands in by default.
create or replace function pg_temp.host_a() returns uuid language sql as $$
  select public.default_host_id()
$$;

-- ---------- what a company gets out of the box ----------
--
-- The gallery is off, and that is not a detail of the seed: until today the
-- app has only ever offered the camera, and a migration that turned the
-- gallery on would loosen the rule for every company on the way past.

select pg_temp.check('a company starts with the gallery closed',
  pg_temp.gallery_of(pg_temp.host_a()), false);
select pg_temp.check('and a company created later starts the same way',
  pg_temp.gallery_of('b8000000-0000-4000-8000-00000000000b'), false);
select pg_temp.check('parallel starts stay on, as they were',
  pg_temp.parallel_of(pg_temp.host_a()), true);

-- ---------- who may change them ----------

select pg_temp.as_maria();

select pg_temp.check('a cleaner cannot open the gallery for herself',
  pg_temp.refusal_hint($$select public.update_host_settings(null, true)$$),
  'serverErrors.managerOnly');
select pg_temp.check('and the refusal changed nothing',
  pg_temp.gallery_of(pg_temp.host_a()), false);

select pg_temp.as_boss();

-- The RPC is the only door: the table itself is readable and not writable,
-- so a panel that tried the short way would be refused by the grant.
select pg_temp.check('not even a manager writes the table directly',
  pg_temp.refusal_code($$update public.hosts set gallery_allowed = true$$),
  '42501');

-- ---------- changing one switch ----------

select pg_temp.check('a manager opens the gallery',
  (select (public.update_host_settings(null, true)).gallery_allowed), true);
select pg_temp.check('and the other switch was not part of the question',
  pg_temp.parallel_of(pg_temp.host_a()), true);

select pg_temp.check('she turns parallel starts off',
  (select (public.update_host_settings(false, null)).parallel_start_allowed), false);
select pg_temp.check('and the gallery she opened a moment ago is still open',
  pg_temp.gallery_of(pg_temp.host_a()), true);

-- A call that names nothing is a no-op rather than a reset: the panel may
-- send a form whose switches nobody touched.
select pg_temp.check('naming nothing changes nothing',
  (select (public.update_host_settings()).gallery_allowed), true);
select pg_temp.check('neither switch, in fact',
  pg_temp.parallel_of(pg_temp.host_a()), false);

-- ---------- both at once, and again ----------

select pg_temp.check('both switches move in one call',
  (select (public.update_host_settings(true, false)).parallel_start_allowed), true);
select pg_temp.check('the gallery closed with them',
  pg_temp.gallery_of(pg_temp.host_a()), false);

select pg_temp.check('the same press twice is not a second change',
  (select (public.update_host_settings(true, false)).gallery_allowed), false);

-- ---------- one company at a time ----------

select pg_temp.as_boss_b();

select pg_temp.check('another company''s manager writes her own settings',
  (select (public.update_host_settings(null, true)).gallery_allowed), true);
select pg_temp.check('and that is the row that changed',
  pg_temp.gallery_of('b8000000-0000-4000-8000-00000000000b'), true);

-- From her seat the first company is not merely unchanged, it is not there:
-- the read policy hides it. That it is also unchanged is a question only its
-- own manager can be asked.
select pg_temp.check('the first company is not hers to see',
  pg_temp.gallery_of(pg_temp.host_a()), null::boolean);

select pg_temp.as_boss();

select pg_temp.check('and from its own seat it is untouched',
  pg_temp.gallery_of(pg_temp.host_a()), false);
select pg_temp.check('with its own switch as it was left',
  pg_temp.parallel_of(pg_temp.host_a()), true);

-- ---------- what the app reads ----------
--
-- The phone asks the table, not the function: the setting is read on every
-- capture screen, and a company row is one select away behind the policy that
-- already lets the staff see it.

select pg_temp.as_maria();

select pg_temp.check('a cleaner can read the switch she is subject to',
  (select gallery_allowed from public.hosts where id = pg_temp.host_a()), false);
select pg_temp.check('and sees exactly one company — her own',
  (select count(*)::integer from public.hosts), 1);

rollback;
