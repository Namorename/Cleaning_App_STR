-- A category of the catalogue names the theme of its tasks, or says they are no quality issue
-- (20261115150000). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - a category takes a theme of the live catalogue only, or «не проблема качества», never both;
-- - for a task filed under a category the order is: the manager's hand, then the category (its
--   theme, or no theme at all), then — for a category with no binding — the guest's finding or
--   the dictionary, exactly as for a typed task;
-- - the themes of catalogue tasks are recomputed whole: a binding that changes or a task moved
--   to another category is followed; the hand is never touched;
-- - a task with no category is themed by the night exactly as before;
-- - the night's episodes follow: a category's theme is an episode, «no quality issue» is none;
-- - problem_theme answers what the panel shows: hand > category > what the night wrote;
-- - the recompute is the database's own: no client role may run it.
--
-- Fixture ids live in the 900118xxx range and under f118….
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('f1180000-0000-4000-8000-00000000000a', 'Category themes company');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('f1180001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maid.cthemes@test.local','x',now(),now(),
   '{"full_name":"Maid"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('f1180002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.cthemes@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'f1180000-0000-4000-8000-00000000000a'
where id::text like 'f118000_-0000-4000-8000-00000000000_';

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900118001, 'f1180000-0000-4000-8000-00000000000a', 'Themed flat', 'Europe/Prague', '15:00', '10:00');
insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900118001, 'f1180001-0000-4000-8000-000000000001', 'claim');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

-- The SQLSTATE and the constraint a statement breaks, or 'ok'.
create or replace function pg_temp.violation_of(statement text)
returns text language plpgsql as $$
declare
  v_constraint text;
begin
  execute statement;
  return 'ok';
exception when others then
  get stacked diagnostics v_constraint = constraint_name;
  return sqlstate || ':' || coalesce(nullif(v_constraint, ''), '-');
end $$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;
create or replace function pg_temp.as_maid() returns void language sql as $$
  select pg_temp.as_user('f1180001-0000-4000-8000-000000000001') $$;
create or replace function pg_temp.as_boss() returns void language sql as $$
  select pg_temp.as_user('f1180002-0000-4000-8000-000000000002') $$;
create or replace function pg_temp.as_office() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;

create or replace function pg_temp.host() returns uuid language sql immutable as $$
  select 'f1180000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.cid(n integer) returns uuid language sql immutable as $$
  select ('f1180200-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.pid(n integer) returns uuid language sql immutable as $$
  select ('f1180301-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;

-- A task's stored theme as theme:source:detector, or null when it has none.
create or replace function pg_temp.theme_of(n integer) returns text language sql as $$
  select t.theme || ':' || t.source || ':' || t.detector
  from public.problem_themes t where t.problem_id = pg_temp.pid(n) $$;
-- The night's episodes of a task, as theme:detector.
create or replace function pg_temp.episodes_of(n integer) returns text language sql as $$
  select string_agg(f.theme || ':' || f.detector, ',' order by f.theme)
  from public.issue_facts f where f.problem_id = pg_temp.pid(n) and f.origin = 'stream' $$;

-- The catalogue, unbound at first, as the client's categories are today.
--   1 a name the dictionary reads as lock_door, to be bound to checkin_access;
--   2 a name the dictionary reads as linen_towels, to be «no quality issue»;
--   3 a name the dictionary reads as hot_water, left unbound;
--   4 to be bound to wifi;
--   5 a name the dictionary does not read, left unbound.
insert into public.problem_categories (id, host_id, name, priority, sort_order) values
  (pg_temp.cid(1), pg_temp.host(), 'Замок и ключи', 'normal', 1),
  (pg_temp.cid(2), pg_temp.host(), 'Постельное бельё', 'normal', 2),
  (pg_temp.cid(3), pg_temp.host(), 'Горячая вода', 'high', 3),
  (pg_temp.cid(4), pg_temp.host(), 'Wi-Fi', 'normal', 4),
  (pg_temp.cid(5), pg_temp.host(), 'Прочее', 'low', 5);

-- ---------- 1. the catalogue names a theme, or none ----------

select pg_temp.check('a category binds nothing by default',
  (select count(*)::integer from public.problem_categories
   where host_id = pg_temp.host() and (theme is not null or not_quality)),
  0);
select pg_temp.check('a category may take a theme of the catalogue',
  pg_temp.violation_of(format('update public.problem_categories set theme = %L where id = %L',
                              'checkin_access', pg_temp.cid(1))),
  'ok');
select pg_temp.check('an unknown theme is refused',
  pg_temp.violation_of(format('update public.problem_categories set theme = %L where id = %L',
                              'no_such_theme', pg_temp.cid(5))),
  '23503:problem_categories_theme_fkey');
select pg_temp.check('a category may say «no quality issue»',
  pg_temp.violation_of(format('update public.problem_categories set not_quality = true where id = %L',
                              pg_temp.cid(2))),
  'ok');
select pg_temp.check('a theme and «no quality issue» together are refused',
  pg_temp.violation_of(format('update public.problem_categories set theme = %L where id = %L',
                              'linen_towels', pg_temp.cid(2))),
  '23514:problem_categories_theme_or_not_quality');
update public.problem_categories set theme = 'wifi' where id = pg_temp.cid(4);

-- ---------- 2. tasks filed under the categories, and typed ones ----------

select pg_temp.as_maid();
select public.report_problem(pg_temp.pid(1), 'x', null, 'normal', 900118001, null, p_category_id => pg_temp.cid(1));
select public.report_problem(pg_temp.pid(2), 'x', null, 'normal', 900118001, null, p_category_id => pg_temp.cid(2));
select public.report_problem(pg_temp.pid(3), 'x', null, 'normal', 900118001, null, p_category_id => pg_temp.cid(3));
-- Typed, the title the same as category 3's name.
select public.report_problem(pg_temp.pid(4), 'Горячая вода', null, 'normal', 900118001);
select public.report_problem(pg_temp.pid(5), 'x', null, 'normal', 900118001, null, p_category_id => pg_temp.cid(1));
select public.report_problem(pg_temp.pid(6), 'x', null, 'normal', 900118001, null, p_category_id => pg_temp.cid(2));
select public.report_problem(pg_temp.pid(7), 'x', null, 'normal', 900118001, null, p_category_id => pg_temp.cid(3));
select public.report_problem(pg_temp.pid(8), 'x', null, 'normal', 900118001, null, p_category_id => pg_temp.cid(5));
-- Typed, with a theme the night wrote long ago.
select public.report_problem(pg_temp.pid(9), 'Пульт от телевизора', null, 'normal', 900118001);
select public.report_problem(pg_temp.pid(10), 'x', null, 'normal', 900118001, null, p_category_id => pg_temp.cid(4));
select public.report_problem(pg_temp.pid(11), 'x', null, 'normal', 900118001, null, p_category_id => pg_temp.cid(5));
select pg_temp.as_office();

select pg_temp.check('a task under a category is named by it, and keeps it',
  (select title || ':' || (category_id = pg_temp.cid(3))::text from public.problems where id = pg_temp.pid(3)),
  'Горячая вода:true');

-- What stood before the bindings: the night of before wrote a theme for a typed task and, from
-- the dictionary, a wrong one for task 10, now under a category bound to wifi.
insert into public.problem_themes (problem_id, theme, source, detector, updated_at) values
  (pg_temp.pid(9), 'tv', 'dict', 'dict-v1', '2026-01-01 00:00+00'),
  (pg_temp.pid(10), 'smell', 'dict', 'dict-v1', '2026-01-01 00:00+00');
-- A hand written straight into the table on a «no quality issue» task.
insert into public.problem_themes (problem_id, theme, source, detector) values
  (pg_temp.pid(6), 'smell', 'manual', 'manual');

-- A guest's finding the manager linked to task 11 as the same fault.
insert into public.guest_signals (id, host_id, provider, kind, external_key, external_listing_id,
                                  property_id, channel, rating, departure_date, submitted_at, stay_exact)
values ('f1180020-0000-4000-8000-000000000001', pg_temp.host(), 'hostaway', 'review', repeat('e8', 32),
        '900118001', 900118001, 'airbnb', 7, current_date - 3, now() - interval '1 day', false);
insert into public.signal_findings (id, host_id, signal_id, property_id, kind, subject, summary,
                                    summary_i18n, confidence, detector, status, decided_mode,
                                    problem_id, decided_at)
values ('f1180030-0000-4000-8000-000000000001', pg_temp.host(), 'f1180020-0000-4000-8000-000000000001',
        900118001, 'repair', 'hot_water', 'hot_water', '{}', 0.9, 'claude-haiku-5-5@themes-v1',
        'duplicate', 'manager', pg_temp.pid(11), now());

-- The manager's hand on task 5, the panel's way.
select pg_temp.as_boss();
select pg_temp.check('a manager sets a theme by hand on a task under a category',
  public.set_problem_theme(pg_temp.pid(5), 'tv'), '{"theme": "tv", "source": "manual"}'::jsonb);

-- ---------- 3. what the panel shows, from the first minute ----------

select pg_temp.check('a task under a bound category shows its theme before any night',
  public.problem_theme(pg_temp.pid(1)), '{"theme": "checkin_access", "source": "category"}'::jsonb);
select pg_temp.check('the category outranks what the night wrote before the binding',
  public.problem_theme(pg_temp.pid(10)), '{"theme": "wifi", "source": "category"}'::jsonb);
select pg_temp.check('«no quality issue» shows no theme, said by the category',
  public.problem_theme(pg_temp.pid(2)),
  '{"theme": null, "source": "category", "not_quality": true}'::jsonb);
select pg_temp.check('the hand outranks the category',
  public.problem_theme(pg_temp.pid(5)), '{"theme": "tv", "source": "manual"}'::jsonb);
select pg_temp.check('the hand outranks «no quality issue» too',
  public.problem_theme(pg_temp.pid(6)), '{"theme": "smell", "source": "manual"}'::jsonb);
select pg_temp.check('an unbound category with nothing stored shows nothing yet',
  public.problem_theme(pg_temp.pid(3)), null::jsonb);
select pg_temp.check('a typed task shows what the night wrote, as before',
  public.problem_theme(pg_temp.pid(9)), '{"theme": "tv", "source": "dict"}'::jsonb);
select pg_temp.check('no client role may recompute the themes',
  pg_temp.violation_of(format('select public.refresh_category_themes(%L)', pg_temp.host())),
  '42501:-');
select pg_temp.as_office();
select pg_temp.check('the recompute is closed to authenticated',
  has_function_privilege('authenticated', 'public.refresh_category_themes(uuid)', 'execute'), false);
select pg_temp.check('and to anon',
  has_function_privilege('anon', 'public.refresh_category_themes(uuid)', 'execute'), false);

-- ---------- 4. the recompute of the catalogue tasks ----------

select pg_temp.check('the recompute counts the themes it wrote: 1, 3, 7, 10 and 11',
  public.refresh_category_themes(pg_temp.host()), 5);

select pg_temp.check('a bound category gives its theme, said by the category',
  pg_temp.theme_of(1), 'checkin_access:category:category');
select pg_temp.check('what the night wrote before the binding gives way to the category',
  pg_temp.theme_of(10), 'wifi:category:category');
select pg_temp.check('«no quality issue» leaves no row, though the dictionary would read one',
  pg_temp.theme_of(2), null::text);
select pg_temp.check('an unbound category is read by the dictionary',
  pg_temp.theme_of(3), 'hot_water:dict:dict-v1');
select pg_temp.check('an unbound category the dictionary does not read stays without a theme',
  pg_temp.theme_of(8), null::text);
select pg_temp.check('an unbound category takes the guest''s finding first, as before',
  pg_temp.theme_of(11), 'hot_water:signal:claude-haiku-5-5@themes-v1');
select pg_temp.check('the hand set on the panel survives the recompute',
  pg_temp.theme_of(5), 'tv:manual:manual');
select pg_temp.check('and the hand written straight in',
  pg_temp.theme_of(6), 'smell:manual:manual');
select pg_temp.check('a typed task with no theme is untouched by it',
  pg_temp.theme_of(4), null::text);
select pg_temp.check('a typed task with a theme keeps it, untouched',
  (select pg_temp.theme_of(9) || ':' || (t.updated_at = '2026-01-01 00:00+00')::text
   from public.problem_themes t where t.problem_id = pg_temp.pid(9)),
  'tv:dict:dict-v1:true');

-- ---------- 5. the night ----------

select public.refresh_property_quality(pg_temp.host());

select pg_temp.check('a typed task is themed by the dictionary, as before',
  pg_temp.theme_of(4), 'hot_water:dict:dict-v1');
select pg_temp.check('exactly as the task under an unbound category of the same name',
  pg_temp.theme_of(4), pg_temp.theme_of(3));
select pg_temp.check('the night''s own pass skips the catalogue: «no quality issue» stays without a theme',
  pg_temp.theme_of(2), null::text);
select pg_temp.check('the night keeps the category''s theme',
  pg_temp.theme_of(1), 'checkin_access:category:category');
select pg_temp.check('and the hands',
  (pg_temp.theme_of(5), pg_temp.theme_of(6)), ('tv:manual:manual'::text, 'smell:manual:manual'::text));
select pg_temp.check('and the typed task''s old theme',
  pg_temp.theme_of(9), 'tv:dict:dict-v1');

select pg_temp.check('a task under a bound category is an episode of its theme',
  (select string_agg(f.theme || ':' || f.detector || ':' || f.layer::text, ',')
   from public.issue_facts f
   where f.problem_id = pg_temp.pid(1) and f.origin = 'stream' and f.host_id = pg_temp.host()),
  'checkin_access:category:staff_report');
select pg_temp.check('a «no quality issue» task is no episode',
  (select count(*)::integer from public.issue_facts where problem_id = pg_temp.pid(2)), 0);
select pg_temp.check('unless a hand gave it a theme',
  pg_temp.episodes_of(6), 'smell:manual');
select pg_temp.check('an unbound category''s task is an episode of the dictionary''s theme',
  pg_temp.episodes_of(3), 'hot_water:dict-v1');
select pg_temp.check('a typed task is an episode as before',
  pg_temp.episodes_of(4), 'hot_water:dict-v1');

-- ---------- 6. a task moves, a binding changes ----------

update public.problems set category_id = pg_temp.cid(4) where id = pg_temp.pid(7);
update public.problems set category_id = pg_temp.cid(2) where id = pg_temp.pid(1);
update public.problem_categories set theme = 'plumbing' where id = pg_temp.cid(3);

select pg_temp.as_boss();
select pg_temp.check('a task moved to a «no quality issue» category shows so at once',
  public.problem_theme(pg_temp.pid(1)),
  '{"theme": null, "source": "category", "not_quality": true}'::jsonb);
select pg_temp.as_office();

select public.refresh_category_themes(pg_temp.host());
select pg_temp.check('a task moved to a bound category takes its theme',
  pg_temp.theme_of(7), 'wifi:category:category');
select pg_temp.check('a task moved to «no quality issue» loses its theme',
  pg_temp.theme_of(1), null::text);
select pg_temp.check('a category bound later turns its tasks from the dictionary to it',
  pg_temp.theme_of(3), 'plumbing:category:category');
select pg_temp.check('the hand still stands',
  pg_temp.theme_of(5), 'tv:manual:manual');

select public.refresh_property_quality(pg_temp.host());
select pg_temp.check('the night''s episodes follow the move',
  (pg_temp.episodes_of(7), pg_temp.episodes_of(1)), ('wifi:category'::text, null::text));
select pg_temp.check('and the new binding',
  pg_temp.episodes_of(3), 'plumbing:category');

-- ---------- 7. the source of a theme ----------

select pg_temp.check('a theme may be said by a category',
  pg_temp.violation_of(format(
    'insert into public.problem_themes (problem_id, theme, source, detector) values (%L, %L, %L, %L)',
    pg_temp.pid(8), 'other', 'category', 'category')),
  'ok');
select pg_temp.check('an unknown source is refused',
  pg_temp.violation_of(format(
    'insert into public.problem_themes (problem_id, theme, source, detector) values (%L, %L, %L, %L)',
    pg_temp.pid(2), 'other', 'robot', 'robot')),
  '23514:problem_themes_source_check');

rollback;
