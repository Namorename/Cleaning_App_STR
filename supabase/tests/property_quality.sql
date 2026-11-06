-- Property quality (20261106120000, docs/property-intelligence-plan.md).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - the themes: 35 codes, the dictionary's narrow theme before the wide one, a
--   word inside another word is no match;
-- - the reading's limits: nothing while it is off, a whole week or nothing, its
--   own day's ceiling apart from the model's 50, the budget counted at the worst
--   case before a call, a killed run staying counted, $5 hard;
-- - a week read twice adds nothing; a place we do not hold or a theme we do not
--   know is left out; a label finds its review by the key and leaves with it;
-- - no text and no guest in the tables: the columns are named here;
-- - the switches are a review's: a message can neither read history nor private
--   feedback;
-- - stays replace a month, a room's go to its building, the test band stays out;
-- - the nightly refresh: the dictionary's theme, a hand outranking it, a cancelled
--   problem and a rejected finding gone from the episodes, weeks folded to months;
-- - the panel's reads: a manager of the company alone, a window we know, the
--   hidden review out, the other company out, windows that fit what is stored;
-- - both jobs inactive, neither inside 03:00–04:40 UTC.
--
-- Fixture ids live in the 900063xxx range and under b63….
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('b6300000-0000-4000-8000-00000000000a', 'Host Q'),
  ('b6300000-0000-4000-8000-00000000000b', 'Host R');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b6300001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.quality@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b6300002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.quality@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b6300003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','head.quality@test.local','x',now(),now(),
   '{"full_name":"Head"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('b6300009-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','oleg.quality@test.local','x',now(),now(),
   '{"full_name":"Oleg"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'b6300000-0000-4000-8000-00000000000a'
where id in ('b6300001-0000-4000-8000-000000000001', 'b6300002-0000-4000-8000-000000000002',
             'b6300003-0000-4000-8000-000000000003');
update public.profiles set host_id = 'b6300000-0000-4000-8000-00000000000b'
where id = 'b6300009-0000-4000-8000-000000000009';

insert into public.properties (id, host_id, name, city, timezone) values
  (900063001, 'b6300000-0000-4000-8000-00000000000a', 'Quality flat', 'Praha', 'Europe/Prague'),
  (900063002, 'b6300000-0000-4000-8000-00000000000a', 'Second flat', 'Praha', 'Europe/Prague'),
  (900063010, 'b6300000-0000-4000-8000-00000000000a', 'House', 'Brno', 'Europe/Prague'),
  (900000000763, 'b6300000-0000-4000-8000-00000000000a', 'Demo', 'Praha', 'Europe/Prague'),
  (900063009, 'b6300000-0000-4000-8000-00000000000b', 'Their flat', 'Praha', 'Europe/Prague');
insert into public.properties (id, host_id, name, timezone, parent_id, hostaway_unit_id) values
  (public.property_id_for_unit(630011), 'b6300000-0000-4000-8000-00000000000a', 'House room 1',
   'Europe/Prague', 900063010, 630011);

insert into public.signal_settings (host_id, kind, min_confidence) values
  ('b6300000-0000-4000-8000-00000000000a', 'review', 0.60),
  ('b6300000-0000-4000-8000-00000000000a', 'message', 0.60)
on conflict (host_id, kind) do nothing;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

/** A statement's translated hint, or its SQLSTATE, or 'no error'. */
create or replace function pg_temp.refusal(stmt text) returns text
language plpgsql as $fn$
declare
  v_hint text;
begin
  execute stmt;
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return case when v_hint like 'serverErrors.%' then v_hint else sqlstate end;
end $fn$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $fn$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$fn$;

create or replace function pg_temp.office() returns void language sql as $fn$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true)
$fn$;

create or replace function pg_temp.host() returns uuid language sql immutable as $fn$
  select 'b6300000-0000-4000-8000-00000000000a'::uuid
$fn$;

-- The first of last month, and the Monday of a day in it: dates move with the day of the run.
create or replace function pg_temp.m() returns date language sql stable as $fn$
  select (date_trunc('month', current_date) - interval '1 month')::date
$fn$;

create or replace function pg_temp.w() returns date language sql stable as $fn$
  select date_trunc('week', (pg_temp.m() + 7)::timestamp)::date
$fn$;

create or replace function pg_temp.reserve(p_calls integer, p_start date, p_worst bigint default 1100)
returns jsonb language sql as $fn$
  select public.reserve_signal_history('hostaway', 'claude-haiku-5-5@themes-v1', p_start, p_start + 6,
                                       p_calls, p_worst, pg_temp.host())
$fn$;

create or replace function pg_temp.key(p_text text) returns text language sql immutable as $fn$
  select encode(extensions.hmac(p_text, 'test-only-quality-secret', 'sha256'), 'hex')
$fn$;

-- ---------- themes and the dictionary ----------

select pg_temp.check('35 themes', (select count(*) from public.issue_themes), 35::bigint);
select pg_temp.check('nothing is merged yet',
  (select count(*) from public.issue_themes where replaced_by is not null), 0::bigint);
select pg_temp.check('seasonal themes are named',
  (select array_agg(code order by code) from public.issue_themes where is_seasonal),
  array['air_conditioning', 'heating', 'room_temperature']);
select pg_temp.check('every dictionary pattern compiles',
  (select count(*) from public.issue_theme_words w where 'x' ~ w.pattern) >= 0, true);

select pg_temp.check('a hot water fault is hot water, not a shower',
  public.issue_theme_of_text('В душе нет горячей воды'), 'hot_water');
select pg_temp.check('a blocked drain goes before plumbing',
  public.issue_theme_of_text('Засор, течёт кран'), 'drain_toilet');
select pg_temp.check('Czech is read', public.issue_theme_of_text('Nefunguje pračka'), 'laundry_appliance');
select pg_temp.check('English is read', public.issue_theme_of_text('The WiFi is down'), 'wifi');
select pg_temp.check('capitals do not matter', public.issue_theme_of_text('ЗАМОК НЕ ЗАКРЫВАЕТСЯ'), 'lock_door');
select pg_temp.check('a screen is no tap', public.issue_theme_of_text('Разбит экран'), null::text);
select pg_temp.check('a code is no lock', public.issue_theme_of_text('Сменить код'), null::text);
select pg_temp.check('an unknown text has no theme', public.issue_theme_of_text('Просто заметка'), null::text);
select pg_temp.check('neighbours are their own noise', public.issue_theme_of_text('Шум от соседей'), 'noise_neighbours');

select pg_temp.check('a finding speaks by its subject',
  public.issue_theme_of_finding('repair', 'plumbing_leak'), 'plumbing');
select pg_temp.check('a finding with no subject speaks by its kind',
  public.issue_theme_of_finding('noise', 'other'), 'noise_outside');
select pg_temp.check('a wish is no complaint', public.issue_theme_of_finding('wish', 'other'), null::text);
select pg_temp.check('a summary narrows the internet down to the TV',
  public.issue_theme_refined('wifi', 'Televize nefunguje TV remote missing'), 'tv');
select pg_temp.check('a summary narrows a device down to the kettle',
  public.issue_theme_refined('appliance_other', 'Kettle does not work'), 'kettle');
select pg_temp.check('a summary narrows noise down to the neighbours',
  public.issue_theme_refined('noise_outside', 'Loud neighbours at night'), 'noise_neighbours');
select pg_temp.check('a summary never turns a theme into another family',
  public.issue_theme_refined('wifi', 'Kettle does not work'), 'wifi');

-- ---------- windows ----------

select pg_temp.check('14 days start on the Monday of their first day',
  (select from_day from public.quality_bounds('14d', '2026-11-06')), '2026-10-19'::date);
select pg_temp.check('14 days are counted in weeks',
  (select grain from public.quality_bounds('14d', '2026-11-06')), 'week');
select pg_temp.check('the window before 14 days is two weeks',
  (select prev_from from public.quality_bounds('14d', '2026-11-06')), '2026-10-05'::date);
select pg_temp.check('a month starts on a Monday too',
  (select from_day from public.quality_bounds('1m', '2026-11-06')), '2026-10-05'::date);
select pg_temp.check('three months are calendar months with the present one',
  (select from_day from public.quality_bounds('3m', '2026-11-06')), '2026-09-01'::date);
select pg_temp.check('the window before three months ends the day before',
  (select prev_to from public.quality_bounds('3m', '2026-11-06')), '2026-08-31'::date);
select pg_temp.check('twelve months never need more than twelve months',
  (select from_day from public.quality_bounds('12m', '2026-11-06')), '2025-12-01'::date);
select pg_temp.check('the window before six months has their length',
  (select prev_from from public.quality_bounds('6m', '2026-11-06')), '2025-12-01'::date);
select pg_temp.check('an unknown window is no window',
  (select count(*) from public.quality_bounds('2y', '2026-11-06')), 0::bigint);

-- ---------- switches ----------

select pg_temp.check('the reading is off by default',
  (select history_enabled from public.signal_settings
   where host_id = pg_temp.host() and kind = 'review'), false);
select pg_temp.check('the depth is twelve months by default',
  (select history_depth_months from public.signal_settings
   where host_id = pg_temp.host() and kind = 'review'), 12);
select pg_temp.check('private feedback is off by default',
  (select history_include_private from public.signal_settings
   where host_id = pg_temp.host() and kind = 'review'), false);
select pg_temp.check('the day''s ceiling is zero by default',
  (select history_daily_cap from public.signal_settings
   where host_id = pg_temp.host() and kind = 'review'), 0);
select pg_temp.check('the budget is five dollars by default',
  (select history_budget_micro_usd from public.signal_settings
   where host_id = pg_temp.host() and kind = 'review'), 5000000::bigint);

select pg_temp.check('more than five dollars takes a migration',
  pg_temp.refusal($q$update public.signal_settings set history_budget_micro_usd = 5000001
                     where host_id = 'b6300000-0000-4000-8000-00000000000a' and kind = 'review'$q$),
  '23514');
select pg_temp.check('more than twelve months takes a migration',
  pg_temp.refusal($q$update public.signal_settings set history_depth_months = 13
                     where host_id = 'b6300000-0000-4000-8000-00000000000a' and kind = 'review'$q$),
  '23514');
select pg_temp.check('a message never reads history',
  pg_temp.refusal($q$update public.signal_settings set history_enabled = true
                     where host_id = 'b6300000-0000-4000-8000-00000000000a' and kind = 'message'$q$),
  '23514');
select pg_temp.check('a message never reads private feedback',
  pg_temp.refusal($q$update public.signal_settings set history_include_private = true
                     where host_id = 'b6300000-0000-4000-8000-00000000000a' and kind = 'message'$q$),
  '23514');

-- ---------- the limits of the reading ----------

select pg_temp.check('nothing is granted while it is off',
  pg_temp.reserve(10, pg_temp.w()) ->> 'reason', 'off');

update public.signal_settings
set history_enabled = true, history_daily_cap = 100, history_budget_micro_usd = 100000,
    texts_enabled = true, texts_enabled_at = '2026-11-04 18:50:32+00'
where host_id = pg_temp.host() and kind = 'review';

select pg_temp.check('a day''s ceiling of zero or a week above it grants nothing',
  pg_temp.reserve(101, pg_temp.w()) ->> 'reason', 'daily_cap');

select pg_temp.check('a week above the budget at its worst case grants nothing',
  pg_temp.reserve(100, pg_temp.w(), 1001) ->> 'reason', 'budget');

select pg_temp.check('nothing was taken by the refusals',
  (select count(*) from raw.signal_history_runs where host_id = pg_temp.host()), 0::bigint);

do $$
declare
  v_run  bigint;
  v_done jsonb;
begin
  v_run := (pg_temp.reserve(20, pg_temp.w()) ->> 'run_id')::bigint;
  perform pg_temp.check('a whole week is granted', v_run is not null, true);
  perform pg_temp.check('the worst case is held while it runs',
    public.signal_history_spent(pg_temp.host()), 22000::bigint);
  perform pg_temp.check('a second run waits for the first',
    pg_temp.reserve(1, pg_temp.w() + 7) ->> 'reason', 'busy');

  v_done := public.complete_signal_history(v_run, '[]'::jsonb, 3000, '{"read": 20}'::jsonb);
  perform pg_temp.check('what it really cost replaces the worst case',
    public.signal_history_spent(pg_temp.host()), 3000::bigint);
  perform pg_temp.check('the calls of the day stay counted',
    (public.signal_history_state('hostaway', 'claude-haiku-5-5@themes-v1', pg_temp.host()) ->> 'calls_today')::integer,
    20);
  perform pg_temp.check('the day''s ceiling counts what was reserved',
    pg_temp.reserve(81, pg_temp.w() + 7) ->> 'reason', 'daily_cap');
end $$;

select pg_temp.check('the reading''s calls are not the model''s day',
  public.signal_model_calls_left('review', pg_temp.host()), 0);

do $$
declare
  v_run bigint;
begin
  v_run := (pg_temp.reserve(10, pg_temp.w() + 7) ->> 'run_id')::bigint;
  -- The platform kills it: an old running row, never finished.
  update raw.signal_history_runs set started_at = now() - interval '1 hour' where id = v_run;
  perform pg_temp.check('a killed run stays counted at its reservation',
    public.signal_history_spent(pg_temp.host()), 14000::bigint);
  perform pg_temp.check('a killed run does not hold the next one',
    pg_temp.reserve(1, pg_temp.w() + 7) ? 'run_id', true);
end $$;

update raw.signal_history_runs set status = 'failed', finished_at = now(), spent_micro_usd = 0
where host_id = pg_temp.host() and reserved_calls = 1;

-- ---------- a week of labels ----------

insert into public.guest_signals (id, host_id, provider, kind, external_key, external_listing_id,
                                  property_id, channel, rating, category_ratings, departure_date,
                                  submitted_at, stay_exact, is_hidden)
values
  ('b6310001-0000-4000-8000-000000000001', pg_temp.host(), 'hostaway', 'review', pg_temp.key('a'),
   '900063001', 900063001, 'airbnb', 6, '{"cleanliness": 6}', pg_temp.m(), (pg_temp.m() + 8)::timestamptz, false, false),
  ('b6310002-0000-4000-8000-000000000002', pg_temp.host(), 'hostaway', 'review', pg_temp.key('b'),
   '900063001', 900063001, 'booking', 10, '{"cleanliness": 10}', pg_temp.m(), (pg_temp.m() + 8)::timestamptz, false, false),
  ('b6310003-0000-4000-8000-000000000003', pg_temp.host(), 'hostaway', 'review', pg_temp.key('c'),
   '900063001', 900063001, 'airbnb', 2, '{}', pg_temp.m(), (pg_temp.m() + 8)::timestamptz, false, true),
  ('b6310004-0000-4000-8000-000000000004', pg_temp.host(), 'hostaway', 'review', pg_temp.key('d'),
   '900063002', 900063002, 'airbnb', 8, '{"cleanliness": 8}', pg_temp.m(), (pg_temp.m() + 8)::timestamptz, false, false);

create or replace function pg_temp.labels() returns jsonb language sql as $fn$
  select jsonb_build_array(
    jsonb_build_object('external_listing_id', '900063001', 'external_key', pg_temp.key('a'),
                       'theme', 'noise_outside', 'severity', 'normal', 'confidence', 0.9,
                       'channel', 'airbnb', 'departure_date', pg_temp.m() + 7),
    jsonb_build_object('external_listing_id', '900063001', 'external_key', pg_temp.key('a'),
                       'theme', 'wifi', 'severity', 'low', 'confidence', 0.8,
                       'channel', 'airbnb', 'departure_date', pg_temp.m() + 7),
    jsonb_build_object('external_listing_id', '900063001', 'external_key', pg_temp.key('c'),
                       'theme', 'smell', 'severity', 'normal', 'confidence', 0.9,
                       'channel', 'airbnb', 'departure_date', pg_temp.m() + 7),
    jsonb_build_object('external_listing_id', '900063009', 'external_key', pg_temp.key('e'),
                       'theme', 'wifi', 'severity', 'normal', 'confidence', 0.9,
                       'channel', 'airbnb', 'departure_date', pg_temp.m() + 7),
    jsonb_build_object('external_listing_id', '900000000763', 'external_key', pg_temp.key('f'),
                       'theme', 'wifi', 'severity', 'normal', 'confidence', 0.9,
                       'channel', 'airbnb', 'departure_date', pg_temp.m() + 7),
    jsonb_build_object('external_listing_id', '900063001', 'external_key', pg_temp.key('g'),
                       'theme', 'no_such_theme', 'severity', 'normal', 'confidence', 0.9,
                       'channel', 'airbnb', 'departure_date', pg_temp.m() + 7))
$fn$;

do $$
declare
  v_run bigint;
  v_res jsonb;
begin
  update raw.signal_history_runs set status = 'failed', finished_at = now(), spent_micro_usd = 0
  where host_id = pg_temp.host() and status = 'running';
  -- The week closed empty above: the labels come on a week reopened as a wipe reopens it.
  update raw.signal_history_runs set status = 'failed'
  where host_id = pg_temp.host() and status = 'done';
  v_run := (pg_temp.reserve(6, pg_temp.w()) ->> 'run_id')::bigint;
  v_res := public.complete_signal_history(v_run, pg_temp.labels(), 1200,
                                          '{"weeks_total": 49, "weeks_left": 47}'::jsonb);
  perform pg_temp.check('three labels are stored', (v_res ->> 'labels')::integer, 3);
  perform pg_temp.check('another company''s, the test band and an unknown theme are left out',
    (v_res ->> 'labels_left_out')::integer, 3);
  perform pg_temp.check('a label finds its review by the key',
    (select signal_id from public.issue_facts where theme = 'noise_outside' and host_id = pg_temp.host()),
    'b6310001-0000-4000-8000-000000000001'::uuid);
  perform pg_temp.check('a label keeps the month the guest left in',
    (select month from public.issue_facts where theme = 'noise_outside' and host_id = pg_temp.host()),
    pg_temp.m());
  perform pg_temp.check('a label of a young stay keeps its Monday',
    (select week from public.issue_facts where theme = 'noise_outside' and host_id = pg_temp.host())
      is not distinct from
    pg_temp.w(), true);

  perform pg_temp.check('a closed week is not paid for twice',
    pg_temp.reserve(6, pg_temp.w()) ->> 'reason', 'closed');
  perform pg_temp.check('another version may read the same week',
    public.reserve_signal_history('hostaway', 'claude-haiku-5-5@themes-v2', pg_temp.w(), pg_temp.w() + 6,
                                  0, 1100, pg_temp.host()) ->> 'granted', 'true');
  update raw.signal_history_runs set status = 'failed', finished_at = now(), spent_micro_usd = 0
  where host_id = pg_temp.host() and status = 'running';

  -- A wipe opens the week again.
  update raw.signal_history_runs set status = 'failed'
  where host_id = pg_temp.host() and status = 'done' and slice_start = pg_temp.w();
  v_run := (pg_temp.reserve(6, pg_temp.w()) ->> 'run_id')::bigint;
  v_res := public.complete_signal_history(v_run, pg_temp.labels(), 1200, '{}'::jsonb);
  perform pg_temp.check('a week read twice adds nothing',
    (select count(*) from public.issue_facts where host_id = pg_temp.host()), 3::bigint);
  perform pg_temp.check('a finished run cannot be finished again',
    pg_temp.refusal(format('select public.complete_signal_history(%s, %L::jsonb, 0)', v_run, '[]')),
    '22023');
end $$;

select pg_temp.check('the week is closed for its version',
  (public.signal_history_state('hostaway', 'claude-haiku-5-5@themes-v1', pg_temp.host())
     -> 'reviews_done') @> jsonb_build_array(pg_temp.w()), true);
select pg_temp.check('a week that failed is counted for two days',
  (public.signal_history_state('hostaway', 'claude-haiku-5-5@themes-v1', pg_temp.host())
     -> 'reviews_stuck' ->> (pg_temp.w() + 7)::text)::integer >= 1, true);
select pg_temp.check('a listing we work is readable',
  public.signal_history_readable('hostaway', array['900063001', '900063002'], pg_temp.host()),
  array['900063001', '900063002']);
update public.properties set status = 'archived' where id = 900063002;
select pg_temp.check('an archived, a foreign and a test listing are not',
  public.signal_history_readable('hostaway', array['900063001', '900063002', '900063009', '900000000763', 'x'],
                                 pg_temp.host()),
  array['900063001']);
update public.properties set status = 'active' where id = 900063002;
select pg_temp.check('another version has closed nothing',
  (public.signal_history_state('hostaway', 'claude-haiku-5-5@themes-v2', pg_temp.host())
     -> 'reviews_done'), '[]'::jsonb);
select pg_temp.check('the line is the texts'' line, as a Prague day',
  public.signal_history_state('hostaway', 'claude-haiku-5-5@themes-v1', pg_temp.host()) ->> 'line',
  '2026-11-04');

select pg_temp.check('no column of an episode can hold a guest or a text',
  (select array_agg(column_name::text order by ordinal_position) from information_schema.columns
   where table_schema = 'public' and table_name = 'issue_facts'),
  array['id', 'host_id', 'property_id', 'theme', 'layer', 'severity', 'confidence', 'month', 'week',
        'channel', 'signal_id', 'problem_id', 'finding_id', 'origin', 'history_slice', 'detector',
        'created_at']);
select pg_temp.check('a history label needs its week of reading',
  pg_temp.refusal(format($q$insert into public.issue_facts (host_id, property_id, theme, layer, month,
                                                            origin, detector)
                            values (%L, 900063001, 'wifi', 'guest_review', '2026-10-01', 'history', 'x-1')$q$,
                         pg_temp.host())),
  '23514');

-- ---------- stays ----------

select pg_temp.check('a month of stays is stored by listing and channel',
  public.replace_property_month_stays('hostaway', pg_temp.m(), jsonb_build_array(
    jsonb_build_object('external_listing_id', '900063001', 'channel', 'airbnb', 'stays', 30, 'nights', 80),
    jsonb_build_object('external_listing_id', '900063001', 'channel', 'booking', 'stays', 10, 'nights', 20),
    jsonb_build_object('external_listing_id', '900063002', 'channel', 'airbnb', 'stays', 5, 'nights', 9),
    jsonb_build_object('external_listing_id', '900000000763', 'channel', 'airbnb', 'stays', 9, 'nights', 9),
    jsonb_build_object('external_listing_id', '900063009', 'channel', 'airbnb', 'stays', 9, 'nights', 9)
  ), pg_temp.host()), 3);
select pg_temp.check('the same month again replaces it',
  public.replace_property_month_stays('hostaway', pg_temp.m(), jsonb_build_array(
    jsonb_build_object('external_listing_id', '900063001', 'channel', 'airbnb', 'stays', 31, 'nights', 81),
    jsonb_build_object('external_listing_id', '900063001', 'channel', 'booking', 'stays', 10, 'nights', 20),
    jsonb_build_object('external_listing_id', '900063002', 'channel', 'airbnb', 'stays', 5, 'nights', 9)
  ), pg_temp.host()), 3);
select pg_temp.check('nothing doubled',
  (select sum(stays) from public.property_month_stats where host_id = pg_temp.host()), 46::bigint);
select pg_temp.check('a month starts on its first day',
  pg_temp.refusal($q$select public.replace_property_month_stays('hostaway', '2026-10-02', '[]'::jsonb,
                     'b6300000-0000-4000-8000-00000000000a')$q$),
  '22023');
select pg_temp.check('stays cost nothing',
  public.signal_history_state('hostaway', 'claude-haiku-5-5@themes-v1', pg_temp.host())
    -> 'stays_done' ? pg_temp.m()::text, true);

-- ---------- the nightly refresh ----------

insert into public.problems (id, host_id, reported_by, title, description, property_id, priority,
                             status, created_at, task_id, resolved_at, cancelled_at)
values
  ('b6320001-0000-4000-8000-000000000001', pg_temp.host(), 'b6300002-0000-4000-8000-000000000002',
   'Не работает Wi-Fi', null, 900063001, 'normal', 'open', now() - interval '3 days', null, null, null),
  ('b6320002-0000-4000-8000-000000000002', pg_temp.host(), 'b6300002-0000-4000-8000-000000000002',
   'Просто заметка', null, 900063001, 'normal', 'open', now() - interval '3 days', null, null, null),
  ('b6320003-0000-4000-8000-000000000003', pg_temp.host(), 'b6300002-0000-4000-8000-000000000002',
   'Сломан чайник', null, 900063001, 'normal', 'cancelled', now() - interval '3 days', null, null, now()),
  ('b6320004-0000-4000-8000-000000000004', pg_temp.host(), 'b6300002-0000-4000-8000-000000000002',
   'Сломан замок', null, public.property_id_for_unit(630011), 'high', 'resolved',
   now() - interval '200 days', null, now() - interval '150 days', null);

insert into public.signal_findings (id, host_id, signal_id, property_id, kind, subject, summary,
                                    summary_i18n, detector, status, confidence, urgency, reject_reason)
values
  ('b6330001-0000-4000-8000-000000000001', pg_temp.host(), 'b6310002-0000-4000-8000-000000000002',
   900063001, 'repair', 'hot_water', 'x', '{}', 'claude-haiku-5-5@prompt-v1', 'candidate', 0.9, 'normal', null),
  ('b6330002-0000-4000-8000-000000000002', pg_temp.host(), 'b6310002-0000-4000-8000-000000000002',
   900063001, 'repair', 'heating', 'x', '{}', 'claude-haiku-5-5@prompt-v1', 'rejected', 0.9, 'normal', 'false_positive'),
  ('b6330003-0000-4000-8000-000000000003', pg_temp.host(), 'b6310002-0000-4000-8000-000000000002',
   900063001, 'wish', 'other', 'x', '{}', 'claude-haiku-5-5@prompt-v1', 'no_task', 0.9, 'normal', null);

insert into public.problem_themes (problem_id, theme, source, detector)
values ('b6320002-0000-4000-8000-000000000002', 'smell', 'manual', 'manual');

do $$
declare
  v_res jsonb;
  v_updated timestamptz := (select updated_at from public.problems
                            where id = 'b6320001-0000-4000-8000-000000000001');
begin
  v_res := public.refresh_property_quality(pg_temp.host());
  perform pg_temp.check('the dictionary themes what it can',
    (select theme from public.problem_themes where problem_id = 'b6320001-0000-4000-8000-000000000001'),
    'wifi');
  perform pg_temp.check('the dictionary says where it came from',
    (select source || ':' || detector from public.problem_themes
     where problem_id = 'b6320001-0000-4000-8000-000000000001'), 'dict:dict-v1');
  perform pg_temp.check('a hand outranks the dictionary',
    (select source from public.problem_themes where problem_id = 'b6320002-0000-4000-8000-000000000002'),
    'manual');
  perform pg_temp.check('a problem is not touched by its theme',
    (select updated_at from public.problems where id = 'b6320001-0000-4000-8000-000000000001'), v_updated);
  perform pg_temp.check('a staff report is an episode of its own',
    (select layer::text from public.issue_facts where problem_id = 'b6320001-0000-4000-8000-000000000001'),
    'staff_report');
  perform pg_temp.check('a cancelled problem is no episode',
    (select count(*) from public.issue_facts where problem_id = 'b6320003-0000-4000-8000-000000000003'),
    0::bigint);
  perform pg_temp.check('a room''s episode goes to its building',
    (select property_id from public.issue_facts where problem_id = 'b6320004-0000-4000-8000-000000000004'),
    900063010::bigint);
  perform pg_temp.check('an old problem keeps its month, not its week',
    (select week from public.issue_facts where problem_id = 'b6320004-0000-4000-8000-000000000004'),
    null::date);
  perform pg_temp.check('a finding becomes a guest episode',
    (select theme from public.issue_facts where finding_id = 'b6330001-0000-4000-8000-000000000001'),
    'hot_water');
  perform pg_temp.check('a rejected finding is no episode',
    (select count(*) from public.issue_facts where finding_id = 'b6330002-0000-4000-8000-000000000002'),
    0::bigint);
  perform pg_temp.check('a wish is no episode',
    (select count(*) from public.issue_facts where finding_id = 'b6330003-0000-4000-8000-000000000003'),
    0::bigint);

  perform public.refresh_property_quality(pg_temp.host());
  perform pg_temp.check('the refresh repeated adds nothing',
    (select count(*) from public.issue_facts where host_id = pg_temp.host() and origin = 'stream'),
    (v_res ->> 'facts')::bigint);
  perform pg_temp.check('the labels of the reading survive the refresh',
    (select count(*) from public.issue_facts where host_id = pg_temp.host() and origin = 'history'),
    3::bigint);
end $$;

-- A week older than 90 days gives way to its month.
update public.issue_facts set week = date_trunc('week', (current_date - 120)::timestamp)::date
where problem_id = 'b6320001-0000-4000-8000-000000000001';
update public.issue_facts set week = date_trunc('week', (current_date - 120)::timestamp)::date
where host_id = pg_temp.host() and origin = 'history' and theme = 'wifi';
select public.refresh_property_quality(pg_temp.host());
select pg_temp.check('an old week is folded',
  (select week from public.issue_facts
   where host_id = pg_temp.host() and origin = 'history' and theme = 'wifi'), null::date);

-- ---------- what the panel reads ----------

select pg_temp.as_user('b6300002-0000-4000-8000-000000000002');
select pg_temp.check('a cleaner has no overview',
  pg_temp.refusal($q$select public.quality_overview('12m')$q$), 'serverErrors.managerOnly');
select pg_temp.check('a cleaner has no card',
  pg_temp.refusal($q$select public.quality_place(900063001, '12m')$q$), 'serverErrors.managerOnly');
select pg_temp.check('a cleaner reads no episode',
  pg_temp.refusal('select * from public.issue_facts'), '42501');
select pg_temp.check('a cleaner reads no stays',
  pg_temp.refusal('select * from public.property_month_stats'), '42501');
select pg_temp.check('a cleaner reads no theme of a problem',
  pg_temp.refusal('select * from public.problem_themes'), '42501');

select pg_temp.as_user('b6300003-0000-4000-8000-000000000003');
select pg_temp.check('a head technician has no overview',
  pg_temp.refusal($q$select public.quality_overview('12m')$q$), 'serverErrors.managerOnly');

select pg_temp.as_user('b6300001-0000-4000-8000-000000000001');
select pg_temp.check('a manager writes nothing directly',
  pg_temp.refusal($q$delete from public.issue_facts$q$), '42501');
select pg_temp.check('a manager cannot reserve',
  pg_temp.refusal($q$select public.reserve_signal_history('hostaway', 'x-1', '2026-10-05', '2026-10-11', 1, 1)$q$),
  '42501');
select pg_temp.check('a manager cannot ask what is readable',
  pg_temp.refusal($q$select public.signal_history_readable('hostaway', array['1'])$q$), '42501');
select pg_temp.check('a manager cannot refresh',
  pg_temp.refusal($q$select public.refresh_property_quality()$q$), '42501');
select pg_temp.check('a window must be known',
  pg_temp.refusal($q$select public.quality_overview('2y')$q$), 'serverErrors.qualityWindowInvalid');
select pg_temp.check('an internal reader is closed',
  pg_temp.refusal($q$select public.quality_bounds('12m', current_date)$q$), '42501');

do $$
declare
  v_all   jsonb := public.quality_overview('12m');
  v_place jsonb;
  v_theme jsonb;
begin
  perform pg_temp.check('the overview shows the company''s places, not the rooms or the demo',
    jsonb_array_length(v_all -> 'places'), 3);
  select p into v_place from jsonb_array_elements(v_all -> 'places') p where (p ->> 'id')::bigint = 900063001;
  perform pg_temp.check('stays are the months of the window',
    (v_place ->> 'stays')::integer, 41);
  perform pg_temp.check('a hidden review is not rated',
    (v_place ->> 'rating_n')::integer, 2);
  perform pg_temp.check('ratings are averaged over what is shown',
    (v_place ->> 'rating_avg')::numeric, 8.00);

  select t into v_theme from jsonb_array_elements(v_all -> 'themes') t
  where (t ->> 'property_id')::bigint = 900063001 and t ->> 'theme' = 'noise_outside';
  perform pg_temp.check('a theme counts its reviews', (v_theme ->> 'reviews')::integer, 1);
  perform pg_temp.check('a label of a hidden review is not shown',
    (select count(*) from jsonb_array_elements(v_all -> 'themes') t where t ->> 'theme' = 'smell'
       and (t ->> 'reviews')::integer > 0), 0::bigint);

  select t into v_theme from jsonb_array_elements(v_all -> 'themes') t
  where (t ->> 'property_id')::bigint = 900063001 and t ->> 'theme' = 'wifi';
  perform pg_temp.check('work on a theme is read beside it', (v_theme ->> 'open_work')::integer, 1);
  perform pg_temp.check('a staff report is counted apart', (v_theme ->> 'reported')::integer, 1);

  select t into v_theme from jsonb_array_elements(v_all -> 'themes') t
  where (t ->> 'property_id')::bigint = 900063010 and t ->> 'theme' = 'lock_door';
  perform pg_temp.check('a closed repair is read beside its theme', v_theme ->> 'closed_on' is not null, true);

  perform pg_temp.check('the overview says what the short windows cannot',
    (public.quality_overview('14d') ->> 'rating_from')::date,
    (date_trunc('month', (now() at time zone 'Europe/Prague')) - interval '2 months')::date);
  perform pg_temp.check('the reading is reported in weeks',
    (v_all -> 'history' ->> 'weeks_done')::integer, 1);
  perform pg_temp.check('the reading says how many weeks it has',
    (v_all -> 'history' ->> 'weeks_total')::integer, 49);
  perform pg_temp.check('no money reaches the panel',
    (v_all -> 'history') ? 'spent_micro_usd', false);
end $$;

do $$
declare
  v_card jsonb := public.quality_place(900063001, '12m');
begin
  perform pg_temp.check('a card names its place', v_card -> 'place' ->> 'name', 'Quality flat');
  perform pg_temp.check('a card shows channels apart',
    jsonb_array_length(v_card -> 'channels'), 2);
  perform pg_temp.check('a card sets a category beside the other places',
    (select (c ->> 'peers_n')::integer from jsonb_array_elements(v_card -> 'categories') c
     where c ->> 'key' = 'cleanliness'), 1);
  perform pg_temp.check('a card lists the months of its themes',
    jsonb_array_length(v_card -> 'months') > 0, true);
  perform pg_temp.check('a room is no place here', public.quality_place(public.property_id_for_unit(630011), '12m'), null::jsonb);
  perform pg_temp.check('a demo listing is no place here', public.quality_place(900000000763, '12m'), null::jsonb);
  perform pg_temp.check('another company''s place is no place here', public.quality_place(900063009, '12m'), null::jsonb);
end $$;

select pg_temp.office();
insert into public.reservations
  (id, host_id, property_id, arrival_date, departure_date, status, is_block, guest_name, check_out_time)
select 900063100 + g, pg_temp.host(), 900063001, current_date - 22, current_date - 20 + (g % 15),
       'new', false, 'Guest', '10:00'
from generate_series(1, 150) g;
insert into public.reservations
  (id, host_id, property_id, arrival_date, departure_date, status, is_block, guest_name, check_out_time)
values (900063099, pg_temp.host(), 900063001, current_date - 720, current_date - 700,
        'new', false, 'Guest', '10:00');

select pg_temp.as_user('b6300001-0000-4000-8000-000000000001');
select pg_temp.check('a stray old booking does not read as a year of bookings',
  (public.quality_overview('1m') ->> 'held_from')::date >= current_date - 20, true);
select pg_temp.check('the answer names the texts'' line',
  public.quality_overview('12m') ->> 'line', '2026-11-04');

select pg_temp.as_user('b6300009-0000-4000-8000-000000000009');
select pg_temp.check('another company has no line and no bookings',
  public.quality_overview('12m') ->> 'held_from', null::text);
select pg_temp.check('another company sees none of it',
  jsonb_array_length(public.quality_overview('12m') -> 'themes'), 0);

select pg_temp.office();

-- ---------- settled months, the reading that follows ----------

select pg_temp.check('a month is settled when its last week has been read',
  public.quality_settled_to('2026-12-06'), '2026-09-30'::date);
select pg_temp.check('the day it is, the month counts',
  public.quality_settled_to('2026-12-07'), '2026-10-31'::date);

insert into public.issue_facts (host_id, property_id, theme, layer, month, origin, history_slice, detector)
values (pg_temp.host(), 900063001, 'tv', 'guest_review', (pg_temp.m() - interval '1 month')::date,
        'history', '2026-01-05', 'x-1'),
       (pg_temp.host(), 900063001, 'tv', 'guest_review', date_trunc('month', current_date)::date,
        'history', '2026-01-05', 'x-1');
insert into public.property_month_stats (host_id, property_id, month, channel, stays, nights)
values (pg_temp.host(), 900063001, (pg_temp.m() - interval '1 month')::date, 'airbnb', 7, 9),
       (pg_temp.host(), 900063001, date_trunc('month', current_date)::date, 'airbnb', 3, 4);

select pg_temp.as_user('b6300001-0000-4000-8000-000000000001');
do $$
declare
  v_all jsonb := public.quality_overview('12m');
  v_theme jsonb;
  v_place jsonb;
begin
  select t into v_theme from jsonb_array_elements(v_all -> 'themes') t
  where (t ->> 'property_id')::bigint = 900063001 and t ->> 'theme' = 'tv';
  perform pg_temp.check('a window counts every review it holds', (v_theme ->> 'reviews')::integer, 2);
  perform pg_temp.check('a trend counts only what has all come',
    (v_theme ->> 'reviews_settled')::integer, 1);
  select p into v_place from jsonb_array_elements(v_all -> 'places') p
  where (p ->> 'id')::bigint = 900063001;
  perform pg_temp.check('stays are held back the same way',
    (v_place ->> 'stays')::integer - (v_place ->> 'stays_settled')::integer >= 3, true);
  perform pg_temp.check('the answer says up to when reviews have come',
    (v_all ->> 'settled_to')::date,
    (date_trunc('month', (now() at time zone 'Europe/Prague')::date - 36))::date - 1);
  perform pg_temp.check('the line divides two readers while the reading stops at it',
    v_all ->> 'line', '2026-11-04');
end $$;

select pg_temp.office();
update public.signal_settings set history_follow = true
where host_id = pg_temp.host() and kind = 'review';
select pg_temp.as_user('b6300001-0000-4000-8000-000000000001');
select pg_temp.check('once the reading follows, one reader stands on both sides',
  public.quality_overview('12m') ->> 'line', null::text);
select pg_temp.office();
update public.signal_settings set history_enabled = false
where host_id = pg_temp.host() and kind = 'review';
select pg_temp.as_user('b6300001-0000-4000-8000-000000000001');
select pg_temp.check('a reading switched off follows nothing, whatever its switch says',
  public.quality_overview('12m') ->> 'line', '2026-11-04');
select pg_temp.office();
update public.signal_settings set history_enabled = true, history_follow = false
where host_id = pg_temp.host() and kind = 'review';
select pg_temp.check('the state tells the run whether it follows',
  public.signal_history_state('hostaway', 'claude-haiku-5-5@themes-v1', pg_temp.host()) ->> 'follow', 'false');
select pg_temp.check('a message never follows',
  pg_temp.refusal($q$update public.signal_settings set history_follow = true
                     where host_id = 'b6300000-0000-4000-8000-00000000000a' and kind = 'message'$q$),
  '23514');

-- A review the reading labelled speaks through its labels, not through its finding too.
insert into public.issue_facts (host_id, property_id, theme, layer, month, signal_id, origin, history_slice, detector)
values (pg_temp.host(), 900063001, 'hot_water', 'guest_review', pg_temp.m(),
        'b6310002-0000-4000-8000-000000000002', 'history', '2026-01-12', 'x-1');
select public.refresh_property_quality(pg_temp.host());
select pg_temp.check('a labelled review leaves no episode from its finding',
  (select count(*) from public.issue_facts where finding_id = 'b6330001-0000-4000-8000-000000000001'),
  0::bigint);

-- It need not wait for the night: labelling a week takes the finding's episode away at once.
delete from public.issue_facts where signal_id = 'b6310002-0000-4000-8000-000000000002' and origin = 'history';
select public.refresh_property_quality(pg_temp.host());
select pg_temp.check('a finding speaks while nothing labelled its review',
  (select count(*) from public.issue_facts where finding_id = 'b6330001-0000-4000-8000-000000000001'),
  1::bigint);
do $$
declare
  v_run bigint;
begin
  update raw.signal_history_runs set status = 'failed', finished_at = now(), spent_micro_usd = 0
  where host_id = pg_temp.host() and status = 'running';
  update public.signal_settings set history_daily_cap = 1000, history_budget_micro_usd = 5000000
  where host_id = pg_temp.host() and kind = 'review';
  v_run := (pg_temp.reserve(1, pg_temp.w() + 21) ->> 'run_id')::bigint;
  perform public.complete_signal_history(v_run, jsonb_build_array(
    jsonb_build_object('external_listing_id', '900063001', 'external_key', pg_temp.key('b'),
                       'theme', 'hot_water', 'severity', 'normal', 'confidence', 0.9,
                       'channel', 'booking', 'departure_date', pg_temp.m() + 7)), 100, '{}'::jsonb);
  perform pg_temp.check('a week labelled takes the finding away at once',
    (select count(*) from public.issue_facts where finding_id = 'b6330001-0000-4000-8000-000000000001'),
    0::bigint);
end $$;

-- ---------- problem areas ----------

delete from public.issue_facts where host_id = pg_temp.host();
delete from public.property_month_stats where host_id = pg_temp.host();
insert into public.property_month_stats (host_id, property_id, month, channel, stays, nights)
values (pg_temp.host(), 900063001, pg_temp.m(), 'airbnb', 40, 80),
       (pg_temp.host(), 900063002, pg_temp.m(), 'airbnb', 10, 20),
       (pg_temp.host(), 900063010, pg_temp.m(), 'airbnb', 40, 80);

create or replace function pg_temp.fact(p_place bigint, p_theme text, p_layer public.issue_layer, p_n integer)
returns void language sql as $fn$
  insert into public.issue_facts (host_id, property_id, theme, layer, month, origin, history_slice, detector)
  select pg_temp.host(), p_place, p_theme, p_layer, pg_temp.m(), 'history', '2026-01-19', 'x-1'
  from generate_series(1, p_n)
$fn$;

select public.refresh_quality_areas(pg_temp.host());
select pg_temp.as_user('b6300001-0000-4000-8000-000000000001');
select pg_temp.check('a night with nothing standing out is still a night that counted',
  (public.quality_areas('3m') ->> 'computed_on')::date, (now() at time zone 'Europe/Prague')::date);
select pg_temp.office();

-- Stands out: three here, nothing elsewhere.
select pg_temp.fact(900063001, 'smell', 'guest_review', 3);
-- One episode is a single case.
select pg_temp.fact(900063001, 'wifi', 'guest_review', 1);
-- Too few stays, however many episodes.
select pg_temp.fact(900063002, 'parking', 'guest_review', 4);
-- As common everywhere: nothing stands out.
select pg_temp.fact(900063001, 'tv', 'guest_review', 5);
select pg_temp.fact(900063010, 'tv', 'guest_review', 5);
-- A place in two areas, one of them by staff.
select pg_temp.fact(900063010, 'lock_door', 'found_at_work', 2);
select pg_temp.fact(900063010, 'lock_door', 'staff_report', 1);
select pg_temp.fact(900063010, 'pests', 'guest_review', 2);

create or replace function pg_temp.members(p_window text) returns text language sql as $fn$
  select coalesce(string_agg(property_id || ':' || theme || ':' || basis, ' ' order by theme, property_id), '')
  from public.quality_area_members
  where host_id = pg_temp.host() and window_code = p_window
$fn$;

select public.refresh_quality_areas(pg_temp.host());
select pg_temp.check('an area holds who stands out, by whom, and a place may stand in two',
  pg_temp.members('3m'), '900063010:lock_door:staff 900063010:pests:guest 900063001:smell:guest');
select pg_temp.check('a window with its own numbers has its own areas',
  pg_temp.members('12m'), pg_temp.members('3m'));
select pg_temp.check('a window without enough stays or episodes has none',
  pg_temp.members('14d'), '');

-- The only place with stays has nothing to stand out from.
update public.property_month_stats set stays = 0, nights = 0
where host_id = pg_temp.host() and property_id <> 900063001;
select public.refresh_quality_areas(pg_temp.host());
select pg_temp.check('a place alone with stays stands in no area',
  pg_temp.members('3m'), '');
update public.property_month_stats set stays = 10, nights = 20
where host_id = pg_temp.host() and property_id = 900063002;
update public.property_month_stats set stays = 40, nights = 80
where host_id = pg_temp.host() and property_id = 900063010;
select public.refresh_quality_areas(pg_temp.host());

select pg_temp.as_user('b6300001-0000-4000-8000-000000000001');
do $$
declare
  v_areas jsonb := public.quality_areas('3m');
begin
  perform pg_temp.check('the panel reads the members of a window',
    jsonb_array_length(v_areas -> 'members'), 3);
  perform pg_temp.check('a member carries its name and its numbers',
    (select m ->> 'name' || ':' || (m ->> 'episodes') || ':' || (m ->> 'stays')
     from jsonb_array_elements(v_areas -> 'members') m where m ->> 'theme' = 'smell'),
    'Quality flat:3:40');
  perform pg_temp.check('the answer says when the areas were counted',
    (v_areas ->> 'computed_on')::date, (now() at time zone 'Europe/Prague')::date);
end $$;
select pg_temp.check('a window must be known here too',
  pg_temp.refusal($q$select public.quality_areas('2y')$q$), 'serverErrors.qualityWindowInvalid');
select pg_temp.check('a manager reads no member directly',
  pg_temp.refusal('select * from public.quality_area_members'), '42501');

select pg_temp.as_user('b6300002-0000-4000-8000-000000000002');
select pg_temp.check('a cleaner has no areas',
  pg_temp.refusal($q$select public.quality_areas('3m')$q$), 'serverErrors.managerOnly');
select pg_temp.as_user('b6300009-0000-4000-8000-000000000009');
select pg_temp.check('another company has no areas of ours',
  jsonb_array_length(public.quality_areas('3m') -> 'members'), 0);

select pg_temp.office();
update public.properties set status = 'archived' where id = 900063001;
select pg_temp.as_user('b6300001-0000-4000-8000-000000000001');
select pg_temp.check('an archived place leaves its area',
  jsonb_array_length(public.quality_areas('3m') -> 'members'), 2);
select pg_temp.office();
update public.properties set status = 'active' where id = 900063001;
select pg_temp.check('the nightly job counts the areas',
  (public.refresh_property_quality(pg_temp.host()) ->> 'area_members')::integer >= 0, true);
select pg_temp.check('the city is no grouping here by default',
  (select quality_city_groups from public.hosts where id = pg_temp.host()), false);

-- ---------- the manager's hand on a task's theme (20261106140000) ----------

select pg_temp.as_user('b6300002-0000-4000-8000-000000000002');
select pg_temp.check('only a manager reads the theme of a task',
  pg_temp.refusal($q$select public.problem_theme('b6320001-0000-4000-8000-000000000001')$q$),
  'serverErrors.managerOnly');
select pg_temp.check('only a manager sets it',
  pg_temp.refusal($q$select public.set_problem_theme('b6320001-0000-4000-8000-000000000001', 'tv')$q$),
  'serverErrors.managerOnly');

select pg_temp.as_user('b6300009-0000-4000-8000-000000000009');
select pg_temp.check('another company''s task reads as nothing',
  public.problem_theme('b6320001-0000-4000-8000-000000000001'), null::jsonb);
select pg_temp.check('another company''s task cannot be set',
  pg_temp.refusal($q$select public.set_problem_theme('b6320001-0000-4000-8000-000000000001', 'tv')$q$),
  'serverErrors.problemNotFound');

select pg_temp.as_user('b6300001-0000-4000-8000-000000000001');
select pg_temp.check('the theme of a task says where it came from',
  public.problem_theme('b6320001-0000-4000-8000-000000000001'),
  '{"theme": "wifi", "source": "dict"}'::jsonb);
select pg_temp.check('an unknown task is refused',
  pg_temp.refusal($q$select public.set_problem_theme('b6329999-0000-4000-8000-000000000009', 'tv')$q$),
  'serverErrors.problemNotFound');
select pg_temp.check('an unknown theme is refused',
  pg_temp.refusal($q$select public.set_problem_theme('b6320001-0000-4000-8000-000000000001', 'nope')$q$),
  'serverErrors.problemThemeUnknown');
select pg_temp.check('a hand replaces the dictionary',
  public.set_problem_theme('b6320001-0000-4000-8000-000000000001', 'tv'),
  '{"theme": "tv", "source": "manual"}'::jsonb);

select pg_temp.office();
select pg_temp.check('the episode follows the hand at once',
  (select theme || ':' || detector from public.issue_facts
   where problem_id = 'b6320001-0000-4000-8000-000000000001'), 'tv:manual');
do $$
begin
  perform public.refresh_property_quality(pg_temp.host());
  perform pg_temp.check('the night keeps the hand',
    (select theme || ':' || source from public.problem_themes
     where problem_id = 'b6320001-0000-4000-8000-000000000001'), 'tv:manual');
  perform pg_temp.check('and its episode',
    (select theme from public.issue_facts where problem_id = 'b6320001-0000-4000-8000-000000000001'), 'tv');
end $$;

select pg_temp.as_user('b6300001-0000-4000-8000-000000000001');
select pg_temp.check('a hand taken away leaves no theme until the night',
  public.set_problem_theme('b6320001-0000-4000-8000-000000000001', null), null::jsonb);

select pg_temp.office();
select pg_temp.check('and no episode',
  (select count(*)::integer from public.issue_facts
   where problem_id = 'b6320001-0000-4000-8000-000000000001'), 0);
do $$
begin
  perform public.refresh_property_quality(pg_temp.host());
  perform pg_temp.check('the dictionary speaks again at night',
    (select theme || ':' || source from public.problem_themes
     where problem_id = 'b6320001-0000-4000-8000-000000000001'), 'wifi:dict');
end $$;

select pg_temp.as_user('b6300001-0000-4000-8000-000000000001');
select pg_temp.check('taking away what no hand wrote changes nothing',
  public.set_problem_theme('b6320001-0000-4000-8000-000000000001', null),
  '{"theme": "wifi", "source": "dict"}'::jsonb);
select pg_temp.office();

-- ---------- jobs ----------

select pg_temp.check('both jobs exist and are inactive',
  (select array_agg(jobname::text order by jobname) from cron.job
   where jobname in ('refresh-property-quality', 'read-signal-history-tick') and not active),
  array['read-signal-history-tick', 'refresh-property-quality']);
select pg_temp.check('the nightly job stays out of 03:00–04:40 UTC',
  (select schedule from cron.job where jobname = 'refresh-property-quality'), '40 6 * * *');
select pg_temp.check('the reading stays out of 03:00–04:40 UTC',
  (select schedule from cron.job where jobname = 'read-signal-history-tick'), '*/10 7-21 * * *');

rollback;
