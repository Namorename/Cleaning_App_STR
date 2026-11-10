-- The plan of resolution (20261110220000, docs/property-intelligence-plan.md §5).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - a draft reaches nobody: nothing appears for the staff before the launch;
-- - a manager alone writes, reads and launches; the tables themselves give nothing;
-- - a stale editor can neither save over nor launch; one draft to a place;
-- - a launch is one transaction: every step or none, and a refusal names each step;
-- - each kind lands where its work lives, under the step's id, and a repeat adds nothing;
-- - a step leaning on a live task makes none of its own;
-- - a plan's state follows its work, with no write of its own;
-- - what a plan makes is an answer to a theme, never a new episode of it.
--
-- Fixture ids live in the 900064xxx range and under b64….
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('b6400000-0000-4000-8000-00000000000a', 'Host P'),
  ('b6400000-0000-4000-8000-00000000000b', 'Host O');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b6400001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.plan@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b6400002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.plan@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b6400003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','head.plan@test.local','x',now(),now(),
   '{"full_name":"Head"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('b6400004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tom.plan@test.local','x',now(),now(),
   '{"full_name":"Tom"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('b6400005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gone.plan@test.local','x',now(),now(),
   '{"full_name":"Gone"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('b6400009-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','oleg.plan@test.local','x',now(),now(),
   '{"full_name":"Oleg"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'b6400000-0000-4000-8000-00000000000a'
where id in ('b6400001-0000-4000-8000-000000000001', 'b6400002-0000-4000-8000-000000000002',
             'b6400003-0000-4000-8000-000000000003', 'b6400004-0000-4000-8000-000000000004',
             'b6400005-0000-4000-8000-000000000005');
update public.profiles set host_id = 'b6400000-0000-4000-8000-00000000000b'
where id = 'b6400009-0000-4000-8000-000000000009';
update public.profiles set is_active = false where id = 'b6400005-0000-4000-8000-000000000005';

insert into public.properties (id, host_id, name, city, timezone) values
  (900064001, 'b6400000-0000-4000-8000-00000000000a', 'Plan flat', 'Praha', 'Europe/Prague'),
  (900064002, 'b6400000-0000-4000-8000-00000000000a', 'Second flat', 'Praha', 'Europe/Prague'),
  (900064003, 'b6400000-0000-4000-8000-00000000000a', 'Sold flat', 'Praha', 'Europe/Prague'),
  (900064009, 'b6400000-0000-4000-8000-00000000000b', 'Their flat', 'Praha', 'Europe/Prague');

insert into public.push_tokens (token, profile_id, host_id, platform)
values ('ExponentPushToken[plans-suite]', 'b6400003-0000-4000-8000-000000000003',
        'b6400000-0000-4000-8000-00000000000a', 'android');

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

/** The JSON a refusal carries in `detail`. */
create or replace function pg_temp.refusal_detail(stmt text) returns jsonb
language plpgsql as $fn$
declare
  v_detail text;
begin
  execute stmt;
  return null;
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail;
  return v_detail::jsonb;
end $fn$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $fn$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$fn$;

create or replace function pg_temp.boss() returns void language sql as $fn$
  select pg_temp.as_user('b6400001-0000-4000-8000-000000000001')
$fn$;

create or replace function pg_temp.office() returns void language sql as $fn$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true)
$fn$;

create or replace function pg_temp.host() returns uuid language sql immutable as $fn$
  select 'b6400000-0000-4000-8000-00000000000a'::uuid
$fn$;

/** One step of the wire format, with what a test does not care about filled in. */
create or replace function pg_temp.step(p_id text, p_kind text, p_over jsonb default '{}') returns jsonb
language sql immutable as $fn$
  select jsonb_build_object('id', p_id, 'theme', 'heating', 'kind', p_kind,
                            'title', 'Step ' || p_kind) || p_over
$fn$;

-- ---------- who may ----------

select pg_temp.as_user('b6400004-0000-4000-8000-000000000004');
select pg_temp.check('a technician cannot save a plan',
  pg_temp.refusal($q$select public.save_resolution_plan('b6410001-0000-4000-8000-000000000001', 900064001, 'x', '[]')$q$),
  'serverErrors.managerOnly');
select pg_temp.check('nor read one',
  pg_temp.refusal($q$select public.resolution_plan('b6410001-0000-4000-8000-000000000001')$q$),
  'serverErrors.managerOnly');
select pg_temp.check('nor list a place''s',
  pg_temp.refusal($q$select public.property_resolution_plans(900064001)$q$), 'serverErrors.managerOnly');
select pg_temp.check('nor launch',
  pg_temp.refusal($q$select public.launch_resolution_plan('b6410001-0000-4000-8000-000000000001', 1)$q$),
  'serverErrors.managerOnly');
select pg_temp.check('the tables themselves give nothing',
  pg_temp.refusal($q$select * from public.resolution_plans$q$), '42501');
select pg_temp.as_user('b6400003-0000-4000-8000-000000000003');
select pg_temp.check('a head technician cannot plan either',
  pg_temp.refusal($q$select public.save_resolution_plan('b6410001-0000-4000-8000-000000000001', 900064001, 'x', '[]')$q$),
  'serverErrors.managerOnly');

-- ---------- the draft ----------

select pg_temp.boss();
select pg_temp.check('a title is needed',
  pg_temp.refusal($q$select public.save_resolution_plan('b6410001-0000-4000-8000-000000000001', 900064001, '  ', '[]')$q$),
  'serverErrors.planTitleInvalid');
select pg_temp.check('another company''s place takes no plan',
  pg_temp.refusal($q$select public.save_resolution_plan('b6410001-0000-4000-8000-000000000001', 900064009, 'x', '[]')$q$),
  'serverErrors.propertyNotFound');

do $$
declare
  v_plan jsonb := public.save_resolution_plan(
    'b6410001-0000-4000-8000-000000000001', 900064001, ' Heating first ',
    jsonb_build_array(
      pg_temp.step('b6420001-0000-4000-8000-000000000001', 'repair', jsonb_build_object(
        'assignee_id', 'b6400004-0000-4000-8000-000000000004', 'due_on', current_date + 2,
        'priority', 'high', 'description', 'Bleed the radiators', 'title_i18n', '{"en": "Fix it"}'::jsonb)),
      pg_temp.step('b6420002-0000-4000-8000-000000000002', 'inspection', jsonb_build_object(
        'assignee_id', 'b6400002-0000-4000-8000-000000000002', 'due_on', current_date + 3)),
      pg_temp.step('b6420003-0000-4000-8000-000000000003', 'purchase', '{"theme": "linen_towels"}'),
      pg_temp.step('b6420004-0000-4000-8000-000000000004', 'decision', '{"theme": "noise_outside"}'),
      pg_temp.step('b6420005-0000-4000-8000-000000000005', 'decision')));
begin
  perform pg_temp.check('a plan starts as a draft', v_plan ->> 'status', 'draft');
  perform pg_temp.check('its title is trimmed', v_plan ->> 'title', 'Heating first');
  perform pg_temp.check('it answers with its steps in order',
    (select array_agg(s ->> 'kind') from jsonb_array_elements(v_plan -> 'steps') s),
    array['repair', 'inspection', 'purchase', 'decision', 'decision']);
  perform pg_temp.check('a step of a draft is a draft', v_plan -> 'steps' -> 0 ->> 'state', 'draft');
  perform pg_temp.check('a step names who holds it',
    v_plan -> 'steps' -> 0 ->> 'assignee_name', 'Tom');
end $$;

select pg_temp.office();
select pg_temp.check('a draft makes no task',
  (select count(*)::integer from public.problems where host_id = pg_temp.host()), 0);
select pg_temp.check('no inspection',
  (select count(*)::integer from public.tasks where host_id = pg_temp.host()), 0);
select pg_temp.check('no request',
  (select count(*)::integer from public.supply_requests where host_id = pg_temp.host()), 0);
select pg_temp.check('and no push',
  (select count(*)::integer from raw.push_outbox where host_id = pg_temp.host()), 0);

select pg_temp.boss();
select pg_temp.check('a second draft of the place is refused',
  pg_temp.refusal($q$select public.save_resolution_plan('b6410002-0000-4000-8000-000000000002', 900064001, 'x', '[]')$q$),
  'serverErrors.planDraftExists');
select pg_temp.check('and points at the one there is',
  pg_temp.refusal_detail($q$select public.save_resolution_plan('b6410002-0000-4000-8000-000000000002', 900064001, 'x', '[]')$q$) ->> 'plan_id',
  'b6410001-0000-4000-8000-000000000001');
select pg_temp.check('a stale editor cannot save over',
  pg_temp.refusal($q$select public.save_resolution_plan('b6410001-0000-4000-8000-000000000001', 900064001, 'x', '[]', 1)$q$),
  'serverErrors.planChanged');
select pg_temp.check('an editor with no revision cannot either',
  pg_temp.refusal($q$select public.save_resolution_plan('b6410001-0000-4000-8000-000000000001', 900064001, 'x', '[]')$q$),
  'serverErrors.planChanged');

create or replace function pg_temp.bad_step(p_step jsonb) returns text language plpgsql as $fn$
begin
  return pg_temp.refusal(format(
    'select public.save_resolution_plan(%L, 900064001, %L, %L::jsonb, 2)',
    'b6410001-0000-4000-8000-000000000001', 'x', jsonb_build_array(p_step)::text));
end $fn$;

select pg_temp.check('a theme must be known',
  pg_temp.bad_step(pg_temp.step('b6420006-0000-4000-8000-000000000006', 'repair', '{"theme": "nope"}')),
  'serverErrors.planStepInvalid');
select pg_temp.check('a kind must be known',
  pg_temp.bad_step(pg_temp.step('b6420006-0000-4000-8000-000000000006', 'magic')),
  'serverErrors.planStepInvalid');
select pg_temp.check('a step needs a title',
  pg_temp.bad_step(pg_temp.step('b6420006-0000-4000-8000-000000000006', 'repair', '{"title": " "}')),
  'serverErrors.planStepInvalid');
select pg_temp.check('an id must be an id',
  pg_temp.bad_step(pg_temp.step('not-a-uuid', 'repair')), 'serverErrors.planStepInvalid');
select pg_temp.check('a translation must be one',
  pg_temp.bad_step(pg_temp.step('b6420006-0000-4000-8000-000000000006', 'repair', '{"title_i18n": {"xx": "y"}}')),
  'serverErrors.planStepInvalid');
select pg_temp.check('another company''s person cannot hold a step',
  pg_temp.bad_step(pg_temp.step('b6420006-0000-4000-8000-000000000006', 'repair',
    '{"assignee_id": "b6400009-0000-4000-8000-000000000009"}')), 'serverErrors.planStepInvalid');
select pg_temp.check('only a repair leans on a task',
  pg_temp.bad_step(pg_temp.step('b6420006-0000-4000-8000-000000000006', 'decision',
    '{"linked_problem_id": "b6430001-0000-4000-8000-000000000001"}')), 'serverErrors.planStepInvalid');

do $$
declare
  v_plan jsonb := public.save_resolution_plan(
    'b6410001-0000-4000-8000-000000000001', 900064001, 'Heating first',
    (select jsonb_agg(s - 'state') from (
       select jsonb_build_object('id', x ->> 'id', 'theme', x ->> 'theme', 'kind', x ->> 'kind',
                                 'title', x ->> 'title', 'assignee_id', x ->> 'assignee_id',
                                 'due_on', x ->> 'due_on', 'priority', x ->> 'priority',
                                 'description', x ->> 'description', 'title_i18n', x -> 'title_i18n') as s
       from jsonb_array_elements((public.resolution_plan('b6410001-0000-4000-8000-000000000001')) -> 'steps') x
       where x ->> 'id' <> 'b6420005-0000-4000-8000-000000000005') y),
    2);
begin
  perform pg_temp.check('a step left out is gone', jsonb_array_length(v_plan -> 'steps'), 4);
  perform pg_temp.check('each save moves the revision', (v_plan ->> 'rev')::integer, 3);
end $$;

select pg_temp.as_user('b6400009-0000-4000-8000-000000000009');
select pg_temp.check('another company reads nothing',
  public.resolution_plan('b6410001-0000-4000-8000-000000000001'), null::jsonb);
select pg_temp.check('and lists nothing', public.property_resolution_plans(900064001), '[]'::jsonb);
select pg_temp.check('and cannot save over',
  pg_temp.refusal($q$select public.save_resolution_plan('b6410001-0000-4000-8000-000000000001', 900064009, 'x', '[]')$q$),
  'serverErrors.planNotFound');
select pg_temp.check('nor launch',
  pg_temp.refusal($q$select public.launch_resolution_plan('b6410001-0000-4000-8000-000000000001', 3)$q$),
  'serverErrors.planNotFound');

-- ---------- a launch refused ----------

select pg_temp.boss();
do $$
begin
  perform public.save_resolution_plan(
    'b6410003-0000-4000-8000-000000000003', 900064002, 'Refused',
    jsonb_build_array(
      pg_temp.step('b6420011-0000-4000-8000-000000000011', 'repair',
                   '{"assignee_id": "b6400005-0000-4000-8000-000000000005"}'),
      pg_temp.step('b6420012-0000-4000-8000-000000000012', 'repair',
                   '{"assignee_id": "b6400002-0000-4000-8000-000000000002"}'),
      pg_temp.step('b6420013-0000-4000-8000-000000000013', 'inspection'),
      pg_temp.step('b6420014-0000-4000-8000-000000000014', 'decision',
                   '{"assignee_id": "b6400004-0000-4000-8000-000000000004"}'),
      pg_temp.step('b6420015-0000-4000-8000-000000000015', 'repair'),
      pg_temp.step('b6420016-0000-4000-8000-000000000016', 'inspection', jsonb_build_object(
        'due_on', current_date + 1, 'title', repeat('x', 130)))));
end $$;

select pg_temp.check('a launch with a bad step is refused',
  pg_temp.refusal($q$select public.launch_resolution_plan('b6410003-0000-4000-8000-000000000003', 2)$q$),
  'serverErrors.planNotLaunchable');
select pg_temp.check('and says of each step why',
  (select jsonb_agg(x ->> 'reason') from jsonb_array_elements(pg_temp.refusal_detail(
     $q$select public.launch_resolution_plan('b6410003-0000-4000-8000-000000000003', 2)$q$) -> 'steps') x),
  '["assignee_inactive", "assignee_role", "date_missing", "assignee_role", "text_too_long"]'::jsonb);

select pg_temp.office();
select pg_temp.check('a refused launch leaves nothing',
  (select count(*)::integer from public.problems where host_id = pg_temp.host()), 0);
select pg_temp.check('and the plan a draft',
  (select status::text from public.resolution_plans where id = 'b6410003-0000-4000-8000-000000000003'),
  'draft');

select pg_temp.boss();
select pg_temp.check('a stale launch is refused',
  pg_temp.refusal($q$select public.launch_resolution_plan('b6410001-0000-4000-8000-000000000001', 2)$q$),
  'serverErrors.planChanged');
select pg_temp.check('a plan of no steps has nothing to launch',
  pg_temp.refusal($q$select public.launch_resolution_plan(
    (public.save_resolution_plan('b6410004-0000-4000-8000-000000000004', 900064003, 'Empty', '[]') ->> 'id')::uuid, 2)$q$),
  'serverErrors.planNoSteps');

select pg_temp.office();
update public.properties set status = 'archived' where id = 900064003;
select pg_temp.boss();
select pg_temp.check('an archived place takes no plan',
  pg_temp.refusal($q$select public.save_resolution_plan('b6410005-0000-4000-8000-000000000005', 900064003, 'x', '[]')$q$),
  'serverErrors.propertyNotFound');

-- ---------- the launch ----------

do $$
declare
  v_plan jsonb := public.launch_resolution_plan('b6410001-0000-4000-8000-000000000001', 3);
begin
  perform pg_temp.check('a launched plan says so', v_plan ->> 'status', 'launched');
  perform pg_temp.check('its steps are open now',
    (select array_agg(distinct s ->> 'state') from jsonb_array_elements(v_plan -> 'steps') s),
    array['open']);
  perform pg_temp.check('a second press adds nothing and is no error',
    public.launch_resolution_plan('b6410001-0000-4000-8000-000000000001', 3) ->> 'status', 'launched');
end $$;

select pg_temp.office();
select pg_temp.check('a repair is a task under the step''s id',
  (select title || ':' || source::text || ':' || priority::text from public.problems
   where id = 'b6420001-0000-4000-8000-000000000001'), 'Step repair:plan:high');
select pg_temp.check('its translation travels with it',
  (select title_i18n ->> 'en' from public.problems where id = 'b6420001-0000-4000-8000-000000000001'), 'Fix it');
select pg_temp.check('its theme is the plan''s, by hand',
  (select theme || ':' || source from public.problem_themes
   where problem_id = 'b6420001-0000-4000-8000-000000000001'), 'heating:manual');
select pg_temp.check('its technician has the work, on the day',
  (select assignee_id::text || ':' || (scheduled_date = current_date + 2)::text from public.tasks
   where problem_id = 'b6420001-0000-4000-8000-000000000001' and type = 'maintenance'),
  'b6400004-0000-4000-8000-000000000004:true');
select pg_temp.check('an inspection stands in the cleanings under the step''s id',
  (select type::text || ':' || title || ':' || assignee_id::text from public.tasks
   where id = 'b6420002-0000-4000-8000-000000000002'),
  'inspection:Step inspection:b6400002-0000-4000-8000-000000000002');
select pg_temp.check('a purchase is an accepted request',
  (select status::text from public.supply_requests where id = 'b6420003-0000-4000-8000-000000000003'),
  'accepted');
select pg_temp.check('with its one line',
  (select name || ':' || quantity::integer from public.supply_request_items
   where request_id = 'b6420003-0000-4000-8000-000000000003'), 'Step purchase:1');
select pg_temp.check('a decision makes nothing',
  (select count(*)::integer from public.problems where id = 'b6420004-0000-4000-8000-000000000004')
  + (select count(*)::integer from public.tasks where id = 'b6420004-0000-4000-8000-000000000004'), 0);
select pg_temp.check('the numbers of the day are kept',
  (select baseline ? 'on' and baseline ? '12m' and baseline ? '3m' from public.resolution_plans
   where id = 'b6410001-0000-4000-8000-000000000001'), true);
select pg_temp.check('a repair tells the head technician once',
  (select count(*)::integer from raw.push_outbox
   where host_id = pg_temp.host() and kind = 'problem_new'
     and recipient_id = 'b6400003-0000-4000-8000-000000000003'), 1);

do $$
begin
  perform public.refresh_property_quality(pg_temp.host());
  perform pg_temp.check('what a plan makes is no new episode of its theme',
    (select count(*)::integer from public.issue_facts
     where problem_id = 'b6420001-0000-4000-8000-000000000001'), 0);
  perform pg_temp.check('and the night keeps its theme',
    (select source from public.problem_themes
     where problem_id = 'b6420001-0000-4000-8000-000000000001'), 'manual');
end $$;

-- ---------- a step leaning on a task ----------

select pg_temp.office();
insert into public.problems (id, host_id, reported_by, title, property_id, priority, status)
values ('b6430001-0000-4000-8000-000000000001', pg_temp.host(), 'b6400002-0000-4000-8000-000000000002',
        'Не работает Wi-Fi', 900064002, 'normal', 'open');
insert into public.problem_themes (problem_id, theme, source, detector)
values ('b6430001-0000-4000-8000-000000000001', 'wifi', 'dict', 'dict-v1');

select pg_temp.boss();
select pg_temp.check('a step leans on a task of its own place alone',
  pg_temp.refusal(format('select public.save_resolution_plan(%L, 900064001, %L, %L::jsonb)',
    'b6410007-0000-4000-8000-000000000007', 'x',
    jsonb_build_array(pg_temp.step('b6420041-0000-4000-8000-000000000041', 'repair',
      '{"linked_problem_id": "b6430001-0000-4000-8000-000000000001"}'))::text)),
  'serverErrors.planStepInvalid');
select pg_temp.check('a place''s live work is offered with its theme',
  public.resolution_plan_place_work(900064002) -> 0 ->> 'theme', 'wifi');

do $$
declare
  v_saved jsonb := public.save_resolution_plan(
    'b6410003-0000-4000-8000-000000000003', 900064002, 'Wi-Fi',
    jsonb_build_array(pg_temp.step('b6420021-0000-4000-8000-000000000021', 'repair', jsonb_build_object(
      'theme', 'wifi', 'linked_problem_id', 'b6430001-0000-4000-8000-000000000001'))),
    2);
  v_plan jsonb := public.launch_resolution_plan('b6410003-0000-4000-8000-000000000003',
                                                (v_saved ->> 'rev')::integer);
begin
  perform pg_temp.check('the step follows the task it leans on',
    v_plan -> 'steps' -> 0 ->> 'work_status', 'open');
end $$;

select pg_temp.office();
select pg_temp.check('and made none of its own',
  (select count(*)::integer from public.problems where id = 'b6420021-0000-4000-8000-000000000021'), 0);

-- ---------- a plan follows its work ----------

select pg_temp.boss();
do $$
declare
  v_plan jsonb;
begin
  perform public.resolve_problem('b6430001-0000-4000-8000-000000000001');
  v_plan := public.resolution_plan('b6410003-0000-4000-8000-000000000003');
  perform pg_temp.check('its work closed, a plan is done', v_plan ->> 'status', 'done');
  perform pg_temp.check('from the day the last step closed',
    (v_plan ->> 'closed_at') is not null, true);
  perform pg_temp.check('the list of the place says so too',
    public.property_resolution_plans(900064002) -> 0 ->> 'status', 'done');

  perform public.reopen_problem('b6430001-0000-4000-8000-000000000001');
  perform pg_temp.check('a task reopened brings the plan back to work',
    public.resolution_plan('b6410003-0000-4000-8000-000000000003') ->> 'status', 'launched');
  perform public.resolve_problem('b6430001-0000-4000-8000-000000000001');
end $$;

select pg_temp.office();
update public.problems set status = 'open', resolved_at = null, archived_at = now()
where id = 'b6430001-0000-4000-8000-000000000001';
select pg_temp.boss();
select pg_temp.check('a task archived unfinished closes its step',
  public.resolution_plan('b6410003-0000-4000-8000-000000000003') ->> 'status', 'done');
select pg_temp.check('and says that nothing was done',
  public.resolution_plan('b6410003-0000-4000-8000-000000000003') -> 'steps' -> 0 ->> 'work_status', 'archived');
select pg_temp.office();
update public.problems set status = 'resolved', resolved_at = now(), archived_at = null
where id = 'b6430001-0000-4000-8000-000000000001';
select pg_temp.boss();

select pg_temp.check('a repair is closed where it lives, not here',
  pg_temp.refusal($q$select public.set_resolution_step_decided('b6420001-0000-4000-8000-000000000001', true)$q$),
  'serverErrors.planStepInvalid');

do $$
declare
  v_plan jsonb := public.set_resolution_step_decided('b6420004-0000-4000-8000-000000000004', true);
begin
  perform pg_temp.check('a decision is closed by the office',
    (select s ->> 'state' from jsonb_array_elements(v_plan -> 'steps') s
     where s ->> 'id' = 'b6420004-0000-4000-8000-000000000004'), 'closed');
  v_plan := public.set_resolution_step_decided('b6420004-0000-4000-8000-000000000004', false);
  perform pg_temp.check('and can be taken back',
    (select s ->> 'state' from jsonb_array_elements(v_plan -> 'steps') s
     where s ->> 'id' = 'b6420004-0000-4000-8000-000000000004'), 'open');
end $$;

-- ---------- new steps on a launched plan ----------

do $$
declare
  v_rev  integer := (public.resolution_plan('b6410001-0000-4000-8000-000000000001') ->> 'rev')::integer;
  v_plan jsonb := public.save_resolution_plan(
    'b6410001-0000-4000-8000-000000000001', 900064001, 'Heating first',
    jsonb_build_array(pg_temp.step('b6420031-0000-4000-8000-000000000031', 'repair', '{"theme": "smell"}')), v_rev);
begin
  perform pg_temp.check('what was launched is out of a save''s reach',
    jsonb_array_length(v_plan -> 'steps'), 5);
  perform pg_temp.check('the new step is a draft on a launched plan',
    (select s ->> 'state' from jsonb_array_elements(v_plan -> 'steps') s
     where s ->> 'id' = 'b6420031-0000-4000-8000-000000000031'), 'draft');
end $$;

select pg_temp.office();
select pg_temp.check('and reaches nobody yet',
  (select count(*)::integer from public.problems where id = 'b6420031-0000-4000-8000-000000000031'), 0);

insert into public.issue_facts (host_id, property_id, theme, layer, month, origin, detector)
values (pg_temp.host(), 900064001, 'smell', 'staff_report', date_trunc('month', current_date)::date,
        'stream', 'dict-v1');

select pg_temp.boss();
do $$
declare
  v_rev  integer := (public.resolution_plan('b6410001-0000-4000-8000-000000000001') ->> 'rev')::integer;
begin
  perform public.launch_resolution_plan('b6410001-0000-4000-8000-000000000001', v_rev);
end $$;

select pg_temp.office();
select pg_temp.check('a second launch makes the new step alone',
  (select count(*)::integer from public.problems where host_id = pg_temp.host() and source = 'plan'), 2);
select pg_temp.check('a theme added later has its numbers kept too',
  (select (baseline #>> '{12m,themes,smell,reported}')::integer from public.resolution_plans
   where id = 'b6410001-0000-4000-8000-000000000001'), 1);
select pg_temp.check('and the first launch keeps its day',
  (select baseline ->> 'on' from public.resolution_plans
   where id = 'b6410001-0000-4000-8000-000000000001'), (now() at time zone 'Europe/Prague')::date::text);

-- ---------- what followed (20261110230000) ----------

select pg_temp.boss();
select pg_temp.check('a plan at work has no effect to show',
  public.resolution_plan_effect('b6410001-0000-4000-8000-000000000001'), null::jsonb);

select pg_temp.office();
update public.problems set resolved_at = now() - interval '30 days', created_at = now() - interval '45 days'
where id = 'b6430001-0000-4000-8000-000000000001';
update public.resolution_plans
set baseline = jsonb_build_object('on', current_date - 40,
                                  '12m', jsonb_build_object('stays', 120, 'themes',
                                    jsonb_build_object('wifi', jsonb_build_object(
                                      'reviews', 6, 'found', 1, 'reported', 0))))
where id = 'b6410003-0000-4000-8000-000000000003';
insert into public.issue_facts (host_id, property_id, theme, layer, month, week, origin, detector)
values
  (pg_temp.host(), 900064002, 'wifi', 'staff_report', date_trunc('month', current_date)::date,
   date_trunc('week', current_date)::date, 'stream', 'dict-v1'),
  (pg_temp.host(), 900064002, 'wifi', 'staff_report', date_trunc('month', current_date - 60)::date,
   date_trunc('week', current_date - 60)::date, 'stream', 'dict-v1');
insert into public.issue_facts (host_id, property_id, theme, layer, month, origin, detector)
values (pg_temp.host(), 900064002, 'wifi', 'found_at_work',
        date_trunc('month', (now() - interval '30 days') at time zone 'Europe/Prague')::date, 'stream', 'dict-v1');
insert into public.reservations
  (id, host_id, property_id, arrival_date, departure_date, status, is_block, guest_name, check_out_time)
select 900064100 + g, pg_temp.host(), 900064002, current_date - 12, current_date - 10, 'new', false,
       'Guest', '10:00'
from generate_series(1, 3) g;
insert into public.problems (id, host_id, reported_by, title, property_id, priority, status)
values ('b6430002-0000-4000-8000-000000000002', pg_temp.host(), 'b6400002-0000-4000-8000-000000000002',
        'Снова Wi-Fi', 900064002, 'normal', 'open');
insert into public.problem_themes (problem_id, theme, source, detector)
values ('b6430002-0000-4000-8000-000000000002', 'wifi', 'dict', 'dict-v1');

select pg_temp.as_user('b6400004-0000-4000-8000-000000000004');
select pg_temp.check('only a manager reads what followed',
  pg_temp.refusal($q$select public.resolution_plan_effect('b6410003-0000-4000-8000-000000000003')$q$),
  'serverErrors.managerOnly');

select pg_temp.boss();
do $$
declare
  v_effect jsonb := public.resolution_plan_effect('b6410003-0000-4000-8000-000000000003');
  v_theme  jsonb := v_effect -> 'themes' -> 0;
begin
  perform pg_temp.check('it starts on the day the last step closed',
    (v_effect ->> 'closed_on')::date, ((now() - interval '30 days') at time zone 'Europe/Prague')::date);
  perform pg_temp.check('stays are counted from there', (v_effect ->> 'stays_after')::integer, 3);
  perform pg_temp.check('the number of the launch stands beside them',
    (v_effect ->> 'stays_before')::integer, 120);
  perform pg_temp.check('the theme of the plan, before', (v_theme -> 'before' ->> 'reviews')::integer, 6);
  perform pg_temp.check('an episode after the close counts, one before it does not',
    (v_theme -> 'after' ->> 'reported')::integer, 1);
  perform pg_temp.check('an episode folded to its month counts as after in the month of the close',
    (v_theme -> 'after' ->> 'found')::integer, 1);
  perform pg_temp.check('new tasks stand on their own line', (v_theme ->> 'work_after')::integer, 1);
  perform pg_temp.check('a theme out of season has no last year', v_theme -> 'last_year', 'null'::jsonb);
end $$;

select pg_temp.as_user('b6400009-0000-4000-8000-000000000009');
select pg_temp.check('another company reads nothing of it',
  public.resolution_plan_effect('b6410003-0000-4000-8000-000000000003'), null::jsonb);

-- ---------- ends ----------

select pg_temp.boss();
select pg_temp.check('a launched plan cannot be deleted',
  pg_temp.refusal($q$select public.delete_resolution_plan('b6410001-0000-4000-8000-000000000001', 1)$q$),
  'serverErrors.planNotDraft');

do $$
declare
  v_rev  integer := (public.resolution_plan('b6410001-0000-4000-8000-000000000001') ->> 'rev')::integer;
  v_plan jsonb := public.cancel_resolution_plan('b6410001-0000-4000-8000-000000000001', v_rev);
begin
  perform pg_temp.check('a cancelled plan says so', v_plan ->> 'status', 'cancelled');
  perform pg_temp.check('a repeat is no error',
    public.cancel_resolution_plan('b6410001-0000-4000-8000-000000000001', v_rev) ->> 'status', 'cancelled');
end $$;
select pg_temp.office();
select pg_temp.check('what it made stays',
  (select count(*)::integer from public.problems p
   where p.id = 'b6420001-0000-4000-8000-000000000001' and p.status <> 'cancelled'), 1);
select pg_temp.boss();
select pg_temp.check('a cancelled plan takes nothing more',
  pg_temp.refusal($q$select public.save_resolution_plan('b6410001-0000-4000-8000-000000000001', 900064001, 'x', '[]', 99)$q$),
  'serverErrors.planClosed');
select pg_temp.check('nor launches',
  pg_temp.refusal($q$select public.launch_resolution_plan('b6410001-0000-4000-8000-000000000001', 99)$q$),
  'serverErrors.planClosed');

do $$
declare
  v_saved jsonb := public.save_resolution_plan(
    'b6410006-0000-4000-8000-000000000006', 900064001, 'Second thoughts', '[]');
begin
  perform pg_temp.check('a draft cannot be cancelled',
    pg_temp.refusal(format('select public.cancel_resolution_plan(%L, %s)', v_saved ->> 'id', v_saved ->> 'rev')),
    'serverErrors.planNotLaunched');
  perform public.delete_resolution_plan('b6410006-0000-4000-8000-000000000006', (v_saved ->> 'rev')::integer);
  perform pg_temp.check('a draft is deleted without a trace',
    public.resolution_plan('b6410006-0000-4000-8000-000000000006'), null::jsonb);
end $$;

rollback;
