-- The office files a task under a category from the panel's «Новое задание» (CLIENT:Wagnerstays,
-- owner 2026-11-20; the core of it is report_problem's p_category_id, 20261115100000).
-- Run: npm run test:rls. Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - with a category the server, not the panel, names the task and sets its urgency: the title,
--   the priority and the flag the panel sent are not read, whoever the office caller is;
-- - the task keeps its category, and its theme follows the category's (hand > category >
--   dictionary), from the first minute and after the night's recompute;
-- - a category of the level above high files a task high with the flag;
-- - a category of another company is refused, and so is one the panel made up;
-- - without a category the office's call is exactly the one of before: its own title and urgency,
--   no category — the free-text company's form, and the form whose catalogue did not load;
-- - the call of a panel that never heard of categories (no p_category_id) is the same;
-- - the same id sent twice hands back the first row, category and all.
--
-- Fixture ids live in the 900201xxx range and under f1201….
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('f1201000-0000-4000-8000-00000000000a', 'Panel catalogue company'),
  ('f1201000-0000-4000-8000-00000000000b', 'Another company');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('f1201001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.panelcat@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('f1201002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','desk.panelcat@test.local','x',now(),now(),
   '{"full_name":"Desk"}'::jsonb, '{"role":"reception"}'::jsonb),
  ('f1201003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','admin.panelcat@test.local','x',now(),now(),
   '{"full_name":"Admin"}'::jsonb, '{"role":"admin"}'::jsonb);

update public.profiles set host_id = 'f1201000-0000-4000-8000-00000000000a'
where id::text like 'f120100_-0000-4000-8000-00000000000_';

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900201001, 'f1201000-0000-4000-8000-00000000000a', 'Panel flat', 'Europe/Prague', '15:00', '10:00');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

-- The hint a statement is refused with, or 'no refusal'.
create or replace function pg_temp.refusal(statement text)
returns text language plpgsql as $$
declare
  v_hint text;
begin
  execute statement;
  return 'no refusal';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(nullif(v_hint, ''), sqlstate);
end $$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;
create or replace function pg_temp.as_boss() returns void language sql as $$
  select pg_temp.as_user('f1201001-0000-4000-8000-000000000001') $$;
create or replace function pg_temp.as_desk() returns void language sql as $$
  select pg_temp.as_user('f1201002-0000-4000-8000-000000000002') $$;
create or replace function pg_temp.as_admin() returns void language sql as $$
  select pg_temp.as_user('f1201003-0000-4000-8000-000000000003') $$;
create or replace function pg_temp.as_office() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;

create or replace function pg_temp.host() returns uuid language sql immutable as $$
  select 'f1201000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.cid(n integer) returns uuid language sql immutable as $$
  select ('f1201200-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.pid(n integer) returns uuid language sql immutable as $$
  select ('f1201300-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.problem(n integer) returns public.problems language sql as $$
  select p.* from public.problems p where p.id = pg_temp.pid(n) $$;
-- What the task is filed as: title, priority, critical, whether it carries category n.
create or replace function pg_temp.filed(n integer, category integer) returns text language sql as $$
  select p.title || ':' || p.priority::text || ':' || p.critical::text || ':'
         || coalesce((p.category_id = pg_temp.cid(category))::text, 'none')
  from public.problems p where p.id = pg_temp.pid(n) $$;

-- The company reports by catalogue, as the client does.
update public.hosts set problem_report_mode = 'catalog' where id = pg_temp.host();

-- The catalogue, after the client's: one of each level, one bound to a theme, one archived.
insert into public.problem_categories (id, host_id, name, name_i18n, synonyms, priority, critical,
                                       sort_order, archived_at) values
  (pg_temp.cid(1), pg_temp.host(), 'Затопление', '{"en": "Flooding", "cs": "Zatopení"}',
   '{потоп}', 'high', true, 1, null),
  (pg_temp.cid(2), pg_temp.host(), 'Wi-Fi', '{"en": "Wi-Fi", "cs": "Wi-Fi"}',
   '{вайфай}', 'high', false, 2, null),
  (pg_temp.cid(3), pg_temp.host(), 'Мебель', '{"en": "Furniture", "cs": "Nábytek"}',
   '{стул}', 'normal', false, 3, null),
  (pg_temp.cid(4), pg_temp.host(), 'Декор', '{}', '{}', 'low', false, 4, null),
  (pg_temp.cid(5), pg_temp.host(), 'Старое', '{}', '{}', 'normal', false, 5, now());
insert into public.problem_categories (id, host_id, name, priority, sort_order) values
  (pg_temp.cid(9), 'f1201000-0000-4000-8000-00000000000b', 'Чужая', 'high', 1);
update public.problem_categories set theme = 'wifi' where id = pg_temp.cid(2);

-- ---------- 1. the panel files under a category: the server decides ----------

-- The panel sends the category's name and level; a panel that lies is not read either.
select pg_temp.as_boss();
select public.report_problem(pg_temp.pid(1), 'Затопление', 'Вода из-под ванны', 'high',
                             900201001, null, true, pg_temp.cid(1));
select public.report_problem(pg_temp.pid(2), 'Something else', null, 'low',
                             900201001, null, false, pg_temp.cid(2));
select public.report_problem(pg_temp.pid(3), 'Затопление', null, 'high',
                             900201001, null, true, pg_temp.cid(4));
select pg_temp.as_office();

select pg_temp.check('a critical category files the task high with the flag, under its name',
  pg_temp.filed(1, 1), 'Затопление:high:true:true');
select pg_temp.check('the description stays the manager''s own words',
  (pg_temp.problem(1)).description, 'Вода из-под ванны');
select pg_temp.check('the title and the level the panel sent are not read',
  pg_temp.filed(2, 2), 'Wi-Fi:high:false:true');
select pg_temp.check('a panel that says critical for a low category files it low',
  pg_temp.filed(3, 4), 'Декор:low:false:true');
select pg_temp.check('the task carries the category''s translations',
  (pg_temp.problem(1)).title_i18n, '{"en": "Flooding", "cs": "Zatopení"}'::jsonb);
select pg_temp.check('a category with no translations leaves none',
  (pg_temp.problem(3)).title_i18n, null::jsonb);
select pg_temp.check('the task is the manager''s report, on the listing chosen',
  ((pg_temp.problem(1)).reported_by, (pg_temp.problem(1)).property_id),
  ('f1201001-0000-4000-8000-000000000001'::uuid, 900201001::bigint));

-- The reception and the admin, from the same form: the same rule.
select pg_temp.as_desk();
select public.report_problem(pg_temp.pid(4), 'x', null, 'low', 900201001, null, null, pg_temp.cid(3));
select pg_temp.as_admin();
select public.report_problem(pg_temp.pid(5), 'x', null, 'low', null, null, null, pg_temp.cid(1));
select pg_temp.as_office();
select pg_temp.check('the reception files under a category the same way',
  pg_temp.filed(4, 3), 'Мебель:normal:false:true');
select pg_temp.check('a task of no listing may be filed under a category too',
  (pg_temp.filed(5, 1), (pg_temp.problem(5)).property_id),
  ('Затопление:high:true:true'::text, null::bigint));

-- ---------- 2. the theme follows the category ----------

select pg_temp.as_boss();
select pg_temp.check('a task under a bound category shows its theme from the first minute',
  public.problem_theme(pg_temp.pid(2)), '{"theme": "wifi", "source": "category"}'::jsonb);
select pg_temp.as_office();
select public.refresh_category_themes(pg_temp.host());
select pg_temp.check('the night stores the category''s theme',
  (select t.theme || ':' || t.source from public.problem_themes t where t.problem_id = pg_temp.pid(2)),
  'wifi:category');
select pg_temp.as_boss();
select pg_temp.check('the manager''s hand outranks the category',
  public.set_problem_theme(pg_temp.pid(2), 'tv'), '{"theme": "tv", "source": "manual"}'::jsonb);
select pg_temp.check('and stays the theme shown',
  public.problem_theme(pg_temp.pid(2)), '{"theme": "tv", "source": "manual"}'::jsonb);
select pg_temp.as_office();
select public.refresh_category_themes(pg_temp.host());
select pg_temp.check('the night never touches the hand',
  (select t.theme || ':' || t.source from public.problem_themes t where t.problem_id = pg_temp.pid(2)),
  'tv:manual');

-- ---------- 3. what the server refuses ----------

select pg_temp.as_boss();
select pg_temp.check('a category of another company is refused',
  pg_temp.refusal(format('select public.report_problem(%L, %L, null, %L, 900201001, null, null, %L)',
                         pg_temp.pid(6), 'x', 'normal', pg_temp.cid(9))),
  'serverErrors.problemCategoryNotFound');
select pg_temp.check('a category nobody made is refused',
  pg_temp.refusal(format('select public.report_problem(%L, %L, null, %L, 900201001, null, null, %L)',
                         pg_temp.pid(6), 'x', 'normal', 'f1201299-0000-4000-8000-000000000099')),
  'serverErrors.problemCategoryNotFound');
select pg_temp.as_office();
select pg_temp.check('nothing was filed by the refused calls',
  (select count(*)::int from public.problems where id = pg_temp.pid(6)), 0);

-- ---------- 4. without a category: as before ----------

-- The form of a free-text company, and the form whose catalogue did not load: a typed title and
-- the level the manager chose, critical included.
select pg_temp.as_boss();
select public.report_problem(pg_temp.pid(7), '  Не закрывается окно  ', 'Спальня', 'high',
                             900201001, null, true, null);
-- A panel that never heard of categories: no p_category_id at all, no p_critical either.
select public.report_problem(p_id => pg_temp.pid(8), p_title => 'Скрипит дверь',
                             p_description => null, p_priority => 'low',
                             p_property_id => 900201001);
select pg_temp.as_office();
select pg_temp.check('a typed task keeps the manager''s title and level, with no category',
  ((pg_temp.problem(7)).title, (pg_temp.problem(7)).priority::text, (pg_temp.problem(7)).critical,
   (pg_temp.problem(7)).category_id, (pg_temp.problem(7)).title_i18n),
  ('Не закрывается окно'::text, 'high'::text, true, null::uuid, null::jsonb));
select pg_temp.check('the call of a panel without categories is the call of before',
  pg_temp.filed(8, 1), 'Скрипит дверь:low:false:none');
select pg_temp.as_boss();
select pg_temp.check('a typed task gets no theme from a category',
  public.problem_theme(pg_temp.pid(7)), null::jsonb);

-- ---------- 5. a press repeated after a lost answer ----------

select pg_temp.check('the same id hands back the first row, category and all',
  (select r.title || ':' || r.priority::text || ':' || (r.category_id = pg_temp.cid(1))::text
   from public.report_problem(pg_temp.pid(1), 'Другое', null, 'low', 900201001, null, false,
                              pg_temp.cid(3)) r),
  'Затопление:high:true');
select pg_temp.as_office();
select pg_temp.check('and files nothing new',
  (select count(*)::int from public.problems where id::text like 'f1201300-%'), 7);

rollback;
