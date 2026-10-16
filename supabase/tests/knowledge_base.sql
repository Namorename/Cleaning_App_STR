-- The knowledge base, step 1: articles, where they show, translations and
-- versions (docs/knowledge-base-step1.md).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: an article is the company's instruction for a
-- place, and it reaches only the people the owner named (2026-10-16, decision
-- 5): a cleaner reads the articles of the places she is linked to, a
-- technician those of the places where he holds work right now, the head
-- technician and the managers read everything of their company. Only the
-- managers and the head technician write and publish. Drafts and the archive
-- stay in the office. Another company sees nothing, and nobody reads without
-- signing in. Every saved change of the text is a version, and a version can
-- be brought back.
--
-- Versions are told apart by the write that made them: one call of an RPC is
-- one version however many rows it touches. In this suite every call is its
-- own top-level statement, which is what makes it a write of its own here.
--
-- Fixture ids live in the 9000660xx range, rooms at 10000000660xx, and under
-- b66…, d66…, a66….
begin;

-- The pg_temp helpers below are created by postgres, whose new functions no
-- longer go to PUBLIC (20260926100000), and they are called as authenticated
-- too. Hand them to that role for the length of this transaction.
alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('b6600000-0000-4000-8000-00000000000a', 'KB host A'),
  ('b6600000-0000-4000-8000-00000000000b', 'KB host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d6600001-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.kb@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('d6600002-0000-4000-8000-0000000000d2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','head.kb@test.local','x',now(),now(),
   '{"full_name":"Head"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('d6600003-0000-4000-8000-0000000000d3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','linked.kb@test.local','x',now(),now(),
   '{"full_name":"Linked"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d6600004-0000-4000-8000-0000000000d4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','room.kb@test.local','x',now(),now(),
   '{"full_name":"Room"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d6600005-0000-4000-8000-0000000000d5','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','standin.kb@test.local','x',now(),now(),
   '{"full_name":"Stand-in"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d6600006-0000-4000-8000-0000000000d6','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tech.kb@test.local','x',now(),now(),
   '{"full_name":"Tech"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('d6600007-0000-4000-8000-0000000000d7','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','done.tech.kb@test.local','x',now(),now(),
   '{"full_name":"Done Tech"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('d6600008-0000-4000-8000-0000000000d8','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','off.cleaner.kb@test.local','x',now(),now(),
   '{"full_name":"Off Cleaner"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d6600009-0000-4000-8000-0000000000d9','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','off.boss.kb@test.local','x',now(),now(),
   '{"full_name":"Off Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('d6600010-0000-4000-8000-0000000000da','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.b.kb@test.local','x',now(),now(),
   '{"full_name":"Boss B"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('d6600011-0000-4000-8000-0000000000db','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cleaner.b.kb@test.local','x',now(),now(),
   '{"full_name":"Cleaner B"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d6600012-0000-4000-8000-0000000000dc','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','room.tech.kb@test.local','x',now(),now(),
   '{"full_name":"Room Tech"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('d6600013-0000-4000-8000-0000000000dd','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','paused.tech.kb@test.local','x',now(),now(),
   '{"full_name":"Paused Tech"}'::jsonb, '{"role":"tech"}'::jsonb);

update public.profiles set host_id = 'b6600000-0000-4000-8000-00000000000a'
where id::text like 'd66000%' and id not in ('d6600010-0000-4000-8000-0000000000da',
                                              'd6600011-0000-4000-8000-0000000000db');
update public.profiles set host_id = 'b6600000-0000-4000-8000-00000000000b'
where id in ('d6600010-0000-4000-8000-0000000000da', 'd6600011-0000-4000-8000-0000000000db');

-- Company A: three flats, a house of two rooms. Company B: one flat.
insert into public.properties (id, host_id, name, timezone) values
  (900066001, 'b6600000-0000-4000-8000-00000000000a', 'Flat one', 'UTC'),
  (900066002, 'b6600000-0000-4000-8000-00000000000a', 'Flat two', 'UTC'),
  (900066003, 'b6600000-0000-4000-8000-00000000000a', 'Flat three', 'UTC'),
  (900066010, 'b6600000-0000-4000-8000-00000000000a', 'The house', 'UTC'),
  (900066020, 'b6600000-0000-4000-8000-00000000000b', 'Flat of B', 'UTC');
insert into public.properties (id, host_id, hostaway_unit_id, parent_id, name, timezone) values
  (public.property_id_for_unit(66011), 'b6600000-0000-4000-8000-00000000000a', 66011, 900066010,
   'Room one', 'UTC'),
  (public.property_id_for_unit(66012), 'b6600000-0000-4000-8000-00000000000a', 66012, 900066010,
   'Room two', 'UTC'),
  -- A part (no unit): a listing of its own, which a link to the house does not open.
  (900066013, 'b6600000-0000-4000-8000-00000000000a', null, 900066010, 'Part of the house', 'UTC');

-- Linked: flat one, and the house as a whole (so both of its rooms).
-- Room: room one alone (so the house above it). Off: flat one, before she
-- is switched off. Cleaner B: the flat of B.
insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('b6600000-0000-4000-8000-00000000000a', 900066001, 'd6600003-0000-4000-8000-0000000000d3', 'claim'),
  ('b6600000-0000-4000-8000-00000000000a', 900066010, 'd6600003-0000-4000-8000-0000000000d3', 'claim'),
  ('b6600000-0000-4000-8000-00000000000a', 1000000066011, 'd6600004-0000-4000-8000-0000000000d4', 'claim'),
  ('b6600000-0000-4000-8000-00000000000a', 900066001, 'd6600008-0000-4000-8000-0000000000d8', 'claim'),
  ('b6600000-0000-4000-8000-00000000000b', 900066020, 'd6600011-0000-4000-8000-0000000000db', 'claim');

-- Stand-in: a cleaning on flat two, not linked to it. Tech: a repair on flat
-- two he holds now, and a cancelled one on flat one. Done tech: a repair on
-- flat three, finished.
insert into public.tasks (host_id, property_id, type, status, assignee_id, scheduled_date) values
  ('b6600000-0000-4000-8000-00000000000a', 900066002, 'cleaning', 'assigned',
   'd6600005-0000-4000-8000-0000000000d5', current_date),
  ('b6600000-0000-4000-8000-00000000000a', 900066002, 'maintenance', 'accepted',
   'd6600006-0000-4000-8000-0000000000d6', current_date),
  ('b6600000-0000-4000-8000-00000000000a', 900066001, 'maintenance', 'cancelled',
   'd6600006-0000-4000-8000-0000000000d6', current_date),
  ('b6600000-0000-4000-8000-00000000000a', 900066003, 'maintenance', 'done',
   'd6600007-0000-4000-8000-0000000000d7', current_date - 1),
  -- Room tech: in progress in room one, blocked on flat two.
  ('b6600000-0000-4000-8000-00000000000a', public.property_id_for_unit(66011), 'maintenance',
   'in_progress', 'd6600012-0000-4000-8000-0000000000dc', current_date),
  ('b6600000-0000-4000-8000-00000000000a', 900066002, 'maintenance', 'blocked',
   'd6600012-0000-4000-8000-0000000000dc', current_date),
  -- Paused tech: paused on flat three, an expired one on flat one.
  ('b6600000-0000-4000-8000-00000000000a', 900066003, 'maintenance', 'paused',
   'd6600013-0000-4000-8000-0000000000dd', current_date),
  ('b6600000-0000-4000-8000-00000000000a', 900066001, 'maintenance', 'expired',
   'd6600013-0000-4000-8000-0000000000dd', current_date - 2);

update public.profiles set is_active = false
where id in ('d6600008-0000-4000-8000-0000000000d8', 'd6600009-0000-4000-8000-0000000000d9');

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

-- Back to postgres, and nobody's claims: reset role keeps request.jwt.claims,
-- and a write after it would run as the person tested last.
create or replace function pg_temp.as_owner() returns void language sql as $fn$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '{}', true)
$fn$;

-- The SQLSTATE of a refusal and the i18n key the server put in its hint.
-- Postgres's own hints ("Grant the required privileges …") are not ours.
create or replace function pg_temp.refusal(stmt text) returns text
language plpgsql as $fn$
declare
  v_hint text;
begin
  execute stmt;
  return 'no refusal';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return SQLSTATE || case when v_hint like 'serverErrors.%' then ' ' || v_hint else '' end;
end $fn$;

-- What the caller reads, by title, in one fixed order.
create or replace function pg_temp.titles() returns text language sql as $fn$
  select coalesce(string_agg(title, ', ' order by title collate "C"), '')
  from public.kb_articles
$fn$;

create or replace function pg_temp.save(
  p_id uuid, p_title text, p_body text, p_scope text, p_places bigint[],
  p_translations jsonb default '{}', p_language text default 'en'
) returns void language sql as $fn$
  select null::void from public.save_kb_article(
    p_id => p_id, p_language => p_language::public.app_language, p_title => p_title,
    p_body => p_body, p_translations => p_translations,
    p_scope => p_scope::public.kb_scope, p_property_ids => p_places)
$fn$;

create or replace function pg_temp.publish(p_id uuid) returns void language sql as $fn$
  select null::void from public.set_kb_article_status(p_id, 'published')
$fn$;

-- ---------- the tables and who may touch them ----------

select pg_temp.check('the four tables of the knowledge base keep row level security',
  (select count(*)::int from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relrowsecurity
     and c.relname in ('kb_articles', 'kb_article_targets',
                       'kb_article_translations', 'kb_article_revisions')), 4);

select pg_temp.check('a signed-in client reads them and writes none of them',
  (select coalesce(string_agg(t || ' ' || p, ', ' order by t, p), '')
   from unnest(array['kb_articles', 'kb_article_targets',
                     'kb_article_translations', 'kb_article_revisions']) t
   cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'TRIGGER']) p
   where has_table_privilege('authenticated', 'public.' || t, p)), '');

select pg_temp.check('anon holds nothing on them',
  (select count(*)::int
   from unnest(array['kb_articles', 'kb_article_targets',
                     'kb_article_translations', 'kb_article_revisions']) t
   where has_table_privilege('anon', 'public.' || t, 'SELECT,INSERT,UPDATE,DELETE')), 0);

select pg_temp.check('the three writes are a signed-in client''s to call, not anon''s',
  (select string_agg(r || ' ' || f || ' ' || has_function_privilege(r, f, 'execute'), ', '
                     order by r, f)
   from unnest(array['anon', 'authenticated']) r
   cross join unnest(array[
     'public.save_kb_article(uuid, public.app_language, text, text, jsonb, public.kb_scope, bigint[], timestamptz)',
     'public.set_kb_article_status(uuid, public.kb_status)',
     'public.restore_kb_revision(uuid, integer, timestamptz)']) f),
  'anon public.restore_kb_revision(uuid, integer, timestamptz) false, '
  || 'anon public.save_kb_article(uuid, public.app_language, text, text, jsonb, public.kb_scope, bigint[], timestamptz) false, '
  || 'anon public.set_kb_article_status(uuid, public.kb_status) false, '
  || 'authenticated public.restore_kb_revision(uuid, integer, timestamptz) true, '
  || 'authenticated public.save_kb_article(uuid, public.app_language, text, text, jsonb, public.kb_scope, bigint[], timestamptz) true, '
  || 'authenticated public.set_kb_article_status(uuid, public.kb_status) true');

select pg_temp.check('the readers'' rules run inside every policy, for every reader',
  (select coalesce(string_agg(r || ' ' || f, ', ' order by r, f), '')
   from unnest(array['authenticated', 'service_role']) r
   cross join unnest(array['public.kb_reader_property_ids()', 'public.kb_staff_article_ids()']) f
   where not has_function_privilege(r, f, 'execute')), '');

select pg_temp.check('and are nobody''s from outside',
  (select coalesce(string_agg(f, ', ' order by f), '')
   from unnest(array['public.kb_reader_property_ids()', 'public.kb_staff_article_ids()']) f
   where has_function_privilege('anon', f, 'execute')), '');

-- What keeps the versions and what the writes are built of runs inside the
-- triggers and the three RPCs; called from outside, it would skip their gate.
create temp table kb_internals (name text primary key);
insert into kb_internals values
  ('kb_snapshot'), ('kb_articles_version'), ('kb_articles_snapshot'), ('kb_translations_version'),
  ('kb_article_for_writer'), ('kb_checked_translations'), ('kb_write_translations'),
  ('kb_assert_publishable');

select pg_temp.check('the internals are no client''s to call',
  (select coalesce(string_agg(r || ' ' || p.oid::regprocedure::text, ', ' order by 1), '')
   from pg_proc p
   cross join unnest(array['anon', 'authenticated']) r
   where p.pronamespace = 'public'::regnamespace
     and p.proname in (select name from kb_internals)
     and has_function_privilege(r, p.oid, 'execute')), '');

select pg_temp.check('and all eight of them exist',
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in (select name from kb_internals)), 8);

-- ---------- the manager writes the articles ----------

select pg_temp.as_user('d6600001-0000-4000-8000-0000000000d1');

select pg_temp.save('a6600001-0000-4000-8000-0000000000a1', 'company', 'For everybody.',
                    'company', '{}', '{"ru": {"title": "компания", "body": "Для всех."}}');
select pg_temp.save('a6600002-0000-4000-8000-0000000000a2', 'f1', 'The boiler is in the hall.',
                    'properties', '{900066001}', '{"cs": {"title": "f1 cs", "body": "Kotel."}}');
select pg_temp.save('a6600003-0000-4000-8000-0000000000a3', 'f2', 'The fuse box.',
                    'properties', '{900066002}');
select pg_temp.save('a6600004-0000-4000-8000-0000000000a4', 'f3', 'The water tap.',
                    'properties', '{900066003}');
select pg_temp.save('a6600005-0000-4000-8000-0000000000a5', 'building', 'The bins are outside.',
                    'building', '{900066010}');
select pg_temp.save('a6600006-0000-4000-8000-0000000000a6', 'r2', 'Room two has a sofa bed.',
                    'properties', '{1000000066012}');
select pg_temp.save('a6600007-0000-4000-8000-0000000000a7', 'multi f1 f3', 'Both have a dryer.',
                    'properties', '{900066001,900066003}');
select pg_temp.save('a6600008-0000-4000-8000-0000000000a8', 'draft f1', 'Not ready.',
                    'properties', '{900066001}', '{"ru": {"title": "черновик", "body": "Нет."}}');
select pg_temp.save('a6600009-0000-4000-8000-0000000000a9', 'archived company', 'Old rules.',
                    'company', '{}');

select pg_temp.check('a new article is a draft of the writer''s company',
  (select string_agg(distinct status::text || ' ' || host_id::text, ', ')
   from public.kb_articles where id::text like 'a66000%'),
  'draft b6600000-0000-4000-8000-00000000000a');

select pg_temp.check('and says who wrote it',
  (select count(*)::int from public.kb_articles
   where id::text like 'a66000%' and created_by = 'd6600001-0000-4000-8000-0000000000d1'
     and updated_by = 'd6600001-0000-4000-8000-0000000000d1'), 9);

select pg_temp.publish(id) from public.kb_articles
where id in ('a6600001-0000-4000-8000-0000000000a1', 'a6600002-0000-4000-8000-0000000000a2',
             'a6600003-0000-4000-8000-0000000000a3', 'a6600004-0000-4000-8000-0000000000a4',
             'a6600005-0000-4000-8000-0000000000a5', 'a6600006-0000-4000-8000-0000000000a6',
             'a6600007-0000-4000-8000-0000000000a7', 'a6600009-0000-4000-8000-0000000000a9');
select null::void from public.set_kb_article_status('a6600009-0000-4000-8000-0000000000a9', 'archived');

select pg_temp.check('published, drafted and archived as asked',
  (select string_agg(title || '=' || status::text, ', ' order by title collate "C")
   from public.kb_articles where id::text like 'a66000%'),
  'archived company=archived, building=published, company=published, draft f1=draft, '
  || 'f1=published, f2=published, f3=published, multi f1 f3=published, r2=published');

select pg_temp.check('a published article says when',
  (select count(*)::int from public.kb_articles
   where id::text like 'a66000%' and status = 'published' and published_at is not null), 7);

-- Company B writes one of its own.
select pg_temp.as_user('d6600010-0000-4000-8000-0000000000da');
select pg_temp.save('a6600010-0000-4000-8000-0000000000aa', 'company of B', 'B rules.',
                    'company', '{}');
select pg_temp.publish('a6600010-0000-4000-8000-0000000000aa');

-- ---------- who reads what ----------

select pg_temp.as_user('d6600001-0000-4000-8000-0000000000d1');
select pg_temp.check('the manager reads every article of the company, drafts and archive too',
  pg_temp.titles(),
  'archived company, building, company, draft f1, f1, f2, f3, multi f1 f3, r2');
select pg_temp.check('with every place and translation',
  (select count(*)::int from public.kb_article_targets) || ' '
  || (select count(*)::int from public.kb_article_translations), '8 3');
select pg_temp.check('and every version',
  (select count(*)::int from public.kb_article_revisions), 9);

select pg_temp.as_user('d6600002-0000-4000-8000-0000000000d2');
select pg_temp.check('the head technician reads all of it as well',
  pg_temp.titles(),
  'archived company, building, company, draft f1, f1, f2, f3, multi f1 f3, r2');
select pg_temp.check('places, translations and versions included',
  (select count(*)::int from public.kb_article_targets) || ' '
  || (select count(*)::int from public.kb_article_translations) || ' '
  || (select count(*)::int from public.kb_article_revisions), '8 3 9');

select pg_temp.as_user('d6600003-0000-4000-8000-0000000000d3');
select pg_temp.check('a cleaner linked to a flat and to a house reads the company''s, the flat''s, the house''s and its rooms''',
  pg_temp.titles(), 'building, company, f1, multi f1 f3, r2');
select pg_temp.check('of the places of an article, only her own',
  (select string_agg(property_id::text, ', ' order by property_id) from public.kb_article_targets),
  '900066001, 900066001, 900066010, 1000000066012');
select pg_temp.check('the translation of a published article, not of a draft',
  (select string_agg(title, ', ' order by title collate "C") from public.kb_article_translations),
  'f1 cs, компания');
select pg_temp.check('and no version of anything',
  (select count(*)::int from public.kb_article_revisions), 0);

select pg_temp.as_user('d6600004-0000-4000-8000-0000000000d4');
select pg_temp.check('a cleaner linked to one room reads the house above it, not the other room',
  pg_temp.titles(), 'building, company');

select pg_temp.as_user('d6600005-0000-4000-8000-0000000000d5');
select pg_temp.check('a cleaner on a stand-in shift, not linked, reads the company''s alone',
  pg_temp.titles(), 'company');

select pg_temp.as_user('d6600006-0000-4000-8000-0000000000d6');
select pg_temp.check('a technician reads the place of the work he holds, not of a cancelled one',
  pg_temp.titles(), 'company, f2');
select pg_temp.check('its place and the company''s translation',
  (select count(*)::int from public.kb_article_targets) || ' '
  || (select string_agg(title, ', ') from public.kb_article_translations), '1 компания');

select pg_temp.as_user('d6600007-0000-4000-8000-0000000000d7');
select pg_temp.check('a technician whose work there is done reads the company''s alone',
  pg_temp.titles(), 'company');

select pg_temp.as_user('d6600012-0000-4000-8000-0000000000dc');
select pg_temp.check('work in progress in a room opens the house above it; blocked work counts as held',
  pg_temp.titles(), 'building, company, f2');

select pg_temp.as_user('d6600013-0000-4000-8000-0000000000dd');
select pg_temp.check('paused work counts as held; expired work does not',
  pg_temp.titles(), 'company, f3, multi f1 f3');

select pg_temp.as_user('d6600003-0000-4000-8000-0000000000d3');
select pg_temp.check('a link to a house opens its rooms, not a part of it',
  (select string_agg(x::text, ', ' order by x) from public.kb_reader_property_ids() as x),
  '900066001, 900066010, 1000000066011, 1000000066012');

select pg_temp.as_user('d6600008-0000-4000-8000-0000000000d8');
select pg_temp.check('a cleaner switched off reads nothing',
  pg_temp.titles() || '|' || (select count(*)::int from public.kb_article_translations), '|0');

select pg_temp.as_user('d6600009-0000-4000-8000-0000000000d9');
select pg_temp.check('a manager switched off reads nothing',
  pg_temp.titles() || '|' || (select count(*)::int from public.kb_article_revisions), '|0');

select pg_temp.as_user('d6600011-0000-4000-8000-0000000000db');
select pg_temp.check('a cleaner of another company reads her company''s only',
  pg_temp.titles(), 'company of B');

select pg_temp.as_user('d6600010-0000-4000-8000-0000000000da');
select pg_temp.check('a manager of another company too',
  pg_temp.titles() || '|' || (select count(*)::int from public.kb_article_targets)
  || '|' || (select count(*)::int from public.kb_article_revisions), 'company of B|0|1');

-- As anon the pg_temp helpers are out of reach too, so the refusals are
-- caught in place.
select pg_temp.as_owner();
set local role anon;
do $$
begin
  perform count(*) from public.kb_articles;
  raise exception 'FAIL anon read the articles';
exception when insufficient_privilege then
  raise notice 'ok  nobody reads without signing in';
end $$;
do $$
begin
  perform public.set_kb_article_status('a6600001-0000-4000-8000-0000000000a1', 'draft');
  raise exception 'FAIL anon called a write';
exception when insufficient_privilege then
  raise notice 'ok  nor calls a write';
end $$;
reset role;
select pg_temp.as_owner();

-- ---------- who writes ----------

select pg_temp.as_user('d6600003-0000-4000-8000-0000000000d3');
select pg_temp.check('a cleaner does not write an article',
  pg_temp.refusal($$select pg_temp.save('a6600020-0000-4000-8000-0000000000b0', 'mine', 'x', 'company', '{}')$$),
  '42501 serverErrors.managerOrHeadTechOnly');

select pg_temp.as_user('d6600006-0000-4000-8000-0000000000d6');
select pg_temp.check('a technician does not publish one',
  pg_temp.refusal($$select pg_temp.publish('a6600008-0000-4000-8000-0000000000a8')$$),
  '42501 serverErrors.managerOrHeadTechOnly');
select pg_temp.check('nor brings a version back',
  pg_temp.refusal($$select public.restore_kb_revision('a6600002-0000-4000-8000-0000000000a2', 1)$$),
  '42501 serverErrors.managerOrHeadTechOnly');

select pg_temp.as_user('d6600009-0000-4000-8000-0000000000d9');
select pg_temp.check('a manager switched off writes nothing',
  pg_temp.refusal($$select pg_temp.save('a6600021-0000-4000-8000-0000000000b1', 'late', 'x', 'company', '{}')$$),
  '42501 serverErrors.managerOrHeadTechOnly');

select pg_temp.as_user('d6600001-0000-4000-8000-0000000000d1');
select pg_temp.check('the manager writes no table directly: an article',
  pg_temp.refusal($$insert into public.kb_articles (id, host_id, language, title) values ('a6600022-0000-4000-8000-0000000000b2', 'b6600000-0000-4000-8000-00000000000a', 'en', 'direct')$$),
  '42501');
select pg_temp.check('a version',
  pg_temp.refusal($$update public.kb_article_revisions set title = 'rewritten'$$), '42501');
select pg_temp.check('a place',
  pg_temp.refusal($$delete from public.kb_article_targets$$), '42501');

-- The head technician writes and publishes, and the technician of the flat
-- reads it at once.
select pg_temp.as_user('d6600002-0000-4000-8000-0000000000d2');
select pg_temp.save('a6600011-0000-4000-8000-0000000000ab', 'head note', 'Valve under the sink.',
                    'properties', '{900066002}');
select pg_temp.publish('a6600011-0000-4000-8000-0000000000ab');
select pg_temp.check('the head technician''s article is his and published',
  (select status::text || ' ' || created_by::text from public.kb_articles
   where id = 'a6600011-0000-4000-8000-0000000000ab'),
  'published d6600002-0000-4000-8000-0000000000d2');

select pg_temp.as_user('d6600006-0000-4000-8000-0000000000d6');
select pg_temp.check('and the technician of the flat reads it',
  pg_temp.titles(), 'company, f2, head note');

-- Company B's manager reaches nothing of company A.
select pg_temp.as_user('d6600010-0000-4000-8000-0000000000da');
select pg_temp.check('another company''s article cannot be written over by its id',
  pg_temp.refusal($$select pg_temp.save('a6600002-0000-4000-8000-0000000000a2', 'taken', 'x', 'company', '{}')$$),
  '23514 serverErrors.kbArticleNotFound');
select pg_temp.check('nor published or archived',
  pg_temp.refusal($$select public.set_kb_article_status('a6600008-0000-4000-8000-0000000000a8', 'archived')$$),
  '23514 serverErrors.kbArticleNotFound');
select pg_temp.check('nor its version brought back',
  pg_temp.refusal($$select public.restore_kb_revision('a6600002-0000-4000-8000-0000000000a2', 1)$$),
  '23514 serverErrors.kbArticleNotFound');
select pg_temp.check('and its places are not hers to name',
  pg_temp.refusal($$select pg_temp.save('a6600023-0000-4000-8000-0000000000b3', 'b', 'x', 'properties', '{900066001}')$$),
  '23514 serverErrors.propertyNotFound');

select pg_temp.as_owner();
select pg_temp.check('company A''s article is as it was',
  (select title from public.kb_articles where id = 'a6600002-0000-4000-8000-0000000000a2'), 'f1');

-- ---------- what an article must be ----------

select pg_temp.as_user('d6600001-0000-4000-8000-0000000000d1');

select pg_temp.check('a title is required',
  pg_temp.refusal($$select pg_temp.save('a6600030-0000-4000-8000-0000000000c0', '   ', 'x', 'company', '{}')$$),
  '23514 serverErrors.kbTitleRequired');
select pg_temp.check('of 200 characters at most',
  pg_temp.refusal(format('select pg_temp.save(%L, %L, %L, %L, %L)',
    'a6600030-0000-4000-8000-0000000000c0', repeat('t', 201), 'x', 'company', '{}')),
  '23514 serverErrors.kbTitleTooLong');
select pg_temp.check('a text of 20 000 at most',
  pg_temp.refusal(format('select pg_temp.save(%L, %L, %L, %L, %L)',
    'a6600030-0000-4000-8000-0000000000c0', 'long', repeat('b', 20001), 'company', '{}')),
  '23514 serverErrors.kbBodyTooLong');
select pg_temp.check('translations are an object',
  pg_temp.refusal($$select pg_temp.save('a6600030-0000-4000-8000-0000000000c0', 't', 'x', 'company', '{}', '[]')$$),
  '23514 serverErrors.translationsInvalid');
select pg_temp.check('in a language the apps speak',
  pg_temp.refusal($$select pg_temp.save('a6600030-0000-4000-8000-0000000000c0', 't', 'x', 'company', '{}', '{"de": {"title": "t", "body": ""}}')$$),
  '23514 serverErrors.translationsInvalid');
select pg_temp.check('other than the one it is written in',
  pg_temp.refusal($$select pg_temp.save('a6600030-0000-4000-8000-0000000000c0', 't', 'x', 'company', '{}', '{"en": {"title": "t", "body": ""}}')$$),
  '23514 serverErrors.translationsInvalid');
select pg_temp.check('a translation with a text has a title',
  pg_temp.refusal($$select pg_temp.save('a6600030-0000-4000-8000-0000000000c0', 't', 'x', 'company', '{}', '{"cs": {"title": " ", "body": "text"}}')$$),
  '23514 serverErrors.kbTranslationTitleMissing');
select pg_temp.check('and its title is of 200 characters at most',
  pg_temp.refusal(format('select pg_temp.save(%L, %L, %L, %L, %L, %L)',
    'a6600030-0000-4000-8000-0000000000c0', 't', 'x', 'company', '{}',
    jsonb_build_object('cs', jsonb_build_object('title', repeat('t', 201), 'body', '')))),
  '23514 serverErrors.kbTitleTooLong');
select pg_temp.check('the whole company names no place',
  pg_temp.refusal($$select pg_temp.save('a6600030-0000-4000-8000-0000000000c0', 't', 'x', 'company', '{900066001}')$$),
  '23514 serverErrors.kbTargetsInvalid');
select pg_temp.check('a house is a house: not a flat',
  pg_temp.refusal($$select pg_temp.save('a6600030-0000-4000-8000-0000000000c0', 't', 'x', 'building', '{900066001}')$$),
  '23514 serverErrors.kbBuildingInvalid');
select pg_temp.check('not a room',
  pg_temp.refusal($$select pg_temp.save('a6600030-0000-4000-8000-0000000000c0', 't', 'x', 'building', '{1000000066011}')$$),
  '23514 serverErrors.kbBuildingInvalid');
select pg_temp.check('and one at a time',
  pg_temp.refusal($$select pg_temp.save('a6600030-0000-4000-8000-0000000000c0', 't', 'x', 'building', '{900066010,900066001}')$$),
  '23514 serverErrors.kbBuildingInvalid');
select pg_temp.check('a place of another company is not found',
  pg_temp.refusal($$select pg_temp.save('a6600030-0000-4000-8000-0000000000c0', 't', 'x', 'properties', '{900066020}')$$),
  '23514 serverErrors.propertyNotFound');
select pg_temp.check('nothing was written by the refusals',
  (select count(*)::int from public.kb_articles where id = 'a6600030-0000-4000-8000-0000000000c0'), 0);

-- A draft may wait for its places and its text; publishing may not.
select pg_temp.save('a6600031-0000-4000-8000-0000000000c1', 'no places yet', 'Text.', 'properties', '{}');
select pg_temp.check('a draft without places is kept',
  (select count(*)::int from public.kb_articles where id = 'a6600031-0000-4000-8000-0000000000c1'), 1);
select pg_temp.check('but is not published',
  pg_temp.refusal($$select pg_temp.publish('a6600031-0000-4000-8000-0000000000c1')$$),
  '23514 serverErrors.kbTargetsMissing');
select pg_temp.save('a6600032-0000-4000-8000-0000000000c2', 'no text yet', '  ', 'company', '{}',
                    '{"cs": {"title": "", "body": ""}}');
select pg_temp.check('nor is an article without a text',
  pg_temp.refusal($$select pg_temp.publish('a6600032-0000-4000-8000-0000000000c2')$$),
  '23514 serverErrors.kbBodyRequired');
select pg_temp.check('an empty translation is no translation',
  (select count(*)::int from public.kb_article_translations
   where article_id = 'a6600032-0000-4000-8000-0000000000c2'), 0);
select pg_temp.check('a published article keeps a place',
  pg_temp.refusal($$select pg_temp.save('a6600003-0000-4000-8000-0000000000a3', 'f2', 'The fuse box.', 'properties', '{}')$$),
  '23514 serverErrors.kbTargetsMissing');
select pg_temp.check('and a text',
  pg_temp.refusal($$select pg_temp.save('a6600003-0000-4000-8000-0000000000a3', 'f2', '', 'properties', '{900066002}')$$),
  '23514 serverErrors.kbBodyRequired');
select pg_temp.check('an unknown article has no status to set',
  pg_temp.refusal($$select public.set_kb_article_status('a66000ff-0000-4000-8000-0000000000ff', 'published')$$),
  '23514 serverErrors.kbArticleNotFound');
select pg_temp.check('nor a version to bring back',
  pg_temp.refusal($$select public.restore_kb_revision('a6600002-0000-4000-8000-0000000000a2', 7)$$),
  '23514 serverErrors.kbRevisionNotFound');

-- A save is idempotent by the id the panel minted: a retry after a lost
-- answer writes no second article and no second version.
select pg_temp.save('a6600033-0000-4000-8000-0000000000c3', 'retry', 'Same.', 'company', '{}');
select pg_temp.save('a6600033-0000-4000-8000-0000000000c3', 'retry', 'Same.', 'company', '{}');
select pg_temp.check('a retried save is one article of one version',
  (select count(*)::int || ' rev ' || max(rev) from public.kb_articles
   where id = 'a6600033-0000-4000-8000-0000000000c3') || ' / '
  || (select count(*)::int from public.kb_article_revisions
      where article_id = 'a6600033-0000-4000-8000-0000000000c3'),
  '1 rev 1 / 1');

-- ---------- versions ----------

select pg_temp.save('a6600040-0000-4000-8000-0000000000e0', 'V1', 'one', 'company', '{}',
                    '{"cs": {"title": "V1 cs", "body": "jedna"}}');
select pg_temp.check('a new article is version 1, kept with its translation',
  (select rev from public.kb_articles where id = 'a6600040-0000-4000-8000-0000000000e0') || ' '
  || (select title || '/' || body || '/' || (translations -> 'cs' ->> 'title') || '/' || language::text
      from public.kb_article_revisions
      where article_id = 'a6600040-0000-4000-8000-0000000000e0' and rev = 1),
  '1 V1/one/V1 cs/en');
select pg_temp.check('written down as the manager''s',
  (select edited_by::text from public.kb_article_revisions
   where article_id = 'a6600040-0000-4000-8000-0000000000e0' and rev = 1),
  'd6600001-0000-4000-8000-0000000000d1');

select pg_temp.save('a6600040-0000-4000-8000-0000000000e0', 'V1', 'two', 'company', '{}',
                    '{"cs": {"title": "V1 cs", "body": "jedna"}}');
select pg_temp.check('a new text is a new version, and the old one keeps its text',
  (select rev from public.kb_articles where id = 'a6600040-0000-4000-8000-0000000000e0') || ' '
  || (select string_agg(rev || '=' || body, ', ' order by rev) from public.kb_article_revisions
      where article_id = 'a6600040-0000-4000-8000-0000000000e0'),
  '2 1=one, 2=two');

select pg_temp.save('a6600040-0000-4000-8000-0000000000e0', 'V1', 'two', 'company', '{}',
                    '{"cs": {"title": "V1 cs", "body": "dva"}}');
select pg_temp.check('a new translation alone is a new version too',
  (select rev from public.kb_articles where id = 'a6600040-0000-4000-8000-0000000000e0') || ' '
  || (select translations -> 'cs' ->> 'body' from public.kb_article_revisions
      where article_id = 'a6600040-0000-4000-8000-0000000000e0' and rev = 3),
  '3 dva');

select pg_temp.save('a6600040-0000-4000-8000-0000000000e0', 'V1', 'three', 'company', '{}',
                    '{"cs": {"title": "V1 cs", "body": "tři"}, "ru": {"title": "V1 ru", "body": "три"}}');
select pg_temp.check('one save of the text and two translations is one version, not three',
  (select rev from public.kb_articles where id = 'a6600040-0000-4000-8000-0000000000e0') || ' '
  || (select count(*)::int from public.kb_article_revisions
      where article_id = 'a6600040-0000-4000-8000-0000000000e0') || ' '
  || (select body || '/' || (translations -> 'ru' ->> 'body') from public.kb_article_revisions
      where article_id = 'a6600040-0000-4000-8000-0000000000e0' and rev = 4),
  '4 4 three/три');

select pg_temp.save('a6600040-0000-4000-8000-0000000000e0', 'V1', 'three', 'properties', '{900066001}',
                    '{"cs": {"title": "V1 cs", "body": "tři"}, "ru": {"title": "V1 ru", "body": "три"}}');
select pg_temp.publish('a6600040-0000-4000-8000-0000000000e0');
select pg_temp.check('a new place or status is no new version of the text',
  (select rev from public.kb_articles where id = 'a6600040-0000-4000-8000-0000000000e0') || ' '
  || (select count(*)::int from public.kb_article_revisions
      where article_id = 'a6600040-0000-4000-8000-0000000000e0'),
  '4 4');

-- The screen says which article it showed by its updated_at, which every write
-- moves — places and status too. One transaction has one now(), so an older
-- screen is written as an older time.
select pg_temp.check('a save made from an older screen is refused',
  pg_temp.refusal($$select null::void from public.save_kb_article(
    p_id => 'a6600040-0000-4000-8000-0000000000e0', p_language => 'en', p_title => 'V1',
    p_body => 'stale', p_translations => '{}', p_scope => 'properties',
    p_property_ids => '{900066001}', p_expected_updated_at => '2000-01-01')$$),
  '23514 serverErrors.kbArticleChanged');
select pg_temp.check('even when it changes nothing but the places',
  pg_temp.refusal($$select null::void from public.save_kb_article(
    p_id => 'a6600040-0000-4000-8000-0000000000e0', p_language => 'en', p_title => 'V1',
    p_body => 'three', p_translations => '{"cs": {"title": "V1 cs", "body": "tři"}, "ru": {"title": "V1 ru", "body": "три"}}',
    p_scope => 'properties', p_property_ids => '{900066001,900066002}',
    p_expected_updated_at => '2000-01-01')$$),
  '23514 serverErrors.kbArticleChanged');
select pg_temp.check('her own save retried after a lost answer is that save, not a conflict',
  pg_temp.refusal($$select null::void from public.save_kb_article(
    p_id => 'a6600040-0000-4000-8000-0000000000e0', p_language => 'en', p_title => 'V1',
    p_body => 'three', p_translations => '{"cs": {"title": "V1 cs", "body": "tři"}, "ru": {"title": "V1 ru", "body": "три"}}',
    p_scope => 'properties', p_property_ids => '{900066001}',
    p_expected_updated_at => '2000-01-01')$$),
  'no refusal');
select pg_temp.check('one made from the current one goes through',
  pg_temp.refusal($$select null::void from public.save_kb_article(
    p_id => 'a6600040-0000-4000-8000-0000000000e0', p_language => 'en', p_title => 'V1',
    p_body => 'three', p_translations => '{"cs": {"title": "V1 cs", "body": "tři"}, "ru": {"title": "V1 ru", "body": "три"}}',
    p_scope => 'properties', p_property_ids => '{900066001}',
    p_expected_updated_at => (select updated_at from public.kb_articles
                              where id = 'a6600040-0000-4000-8000-0000000000e0'))$$),
  'no refusal');

-- The head technician brings version 1 back: a new version with its text.
select pg_temp.as_user('d6600002-0000-4000-8000-0000000000d2');
select pg_temp.check('the same text from a colleague’s older screen is still a conflict',
  pg_temp.refusal($$select null::void from public.save_kb_article(
    p_id => 'a6600040-0000-4000-8000-0000000000e0', p_language => 'en', p_title => 'V1',
    p_body => 'three', p_translations => '{"cs": {"title": "V1 cs", "body": "tři"}, "ru": {"title": "V1 ru", "body": "три"}}',
    p_scope => 'properties', p_property_ids => '{900066001}',
    p_expected_updated_at => '2000-01-01')$$),
  '23514 serverErrors.kbArticleChanged');
select pg_temp.check('bringing back from an older screen is refused too',
  pg_temp.refusal($$select public.restore_kb_revision('a6600040-0000-4000-8000-0000000000e0', 1, '2000-01-01')$$),
  '23514 serverErrors.kbArticleChanged');
select null::void from public.restore_kb_revision('a6600040-0000-4000-8000-0000000000e0', 1,
  (select updated_at from public.kb_articles where id = 'a6600040-0000-4000-8000-0000000000e0'));
select pg_temp.check('version 1 brought back is version 5, with the text and translations of 1',
  (select rev || ' ' || title || '/' || body || '/' || status::text
   from public.kb_articles where id = 'a6600040-0000-4000-8000-0000000000e0') || ' '
  || (select string_agg(language::text || '=' || title || '/' || body, ', ' order by language)
      from public.kb_article_translations where article_id = 'a6600040-0000-4000-8000-0000000000e0'),
  '5 V1/one/published cs=V1 cs/jedna');
select pg_temp.check('written down as his',
  (select edited_by::text from public.kb_article_revisions
   where article_id = 'a6600040-0000-4000-8000-0000000000e0' and rev = 5),
  'd6600002-0000-4000-8000-0000000000d2');
select pg_temp.check('and the versions before it are as they were',
  (select string_agg(rev || '=' || body, ', ' order by rev) from public.kb_article_revisions
   where article_id = 'a6600040-0000-4000-8000-0000000000e0'),
  '1=one, 2=two, 3=two, 4=three, 5=one');

-- A published article keeps a text when a version is brought back, too.
select pg_temp.as_user('d6600001-0000-4000-8000-0000000000d1');
select pg_temp.save('a6600041-0000-4000-8000-0000000000e1', 'E', '', 'company', '{}');
select pg_temp.save('a6600041-0000-4000-8000-0000000000e1', 'E', 'Text', 'company', '{}');
select pg_temp.publish('a6600041-0000-4000-8000-0000000000e1');
select pg_temp.check('an empty version is not brought back over a published article',
  pg_temp.refusal($$select public.restore_kb_revision('a6600041-0000-4000-8000-0000000000e1', 1)$$),
  '23514 serverErrors.kbBodyRequired');

-- The trigger keeps the versions, whoever writes: a service script too.
select pg_temp.as_owner();
set local role service_role;
update public.kb_articles set body = 'by the service' where id = 'a6600040-0000-4000-8000-0000000000e0';
reset role;
select pg_temp.check('a write of service_role past the RPCs is a version as well',
  (select rev from public.kb_articles where id = 'a6600040-0000-4000-8000-0000000000e0') || ' '
  || (select body from public.kb_article_revisions
      where article_id = 'a6600040-0000-4000-8000-0000000000e0' and rev = 6),
  '6 by the service');
select pg_temp.check('and the stamp it keeps says nothing of the transaction counter',
  (select rev_stamp ~ '^[0-9a-f]{32}$' from public.kb_articles
   where id = 'a6600040-0000-4000-8000-0000000000e0'), true);

rollback;
