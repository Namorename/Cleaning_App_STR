-- «Критическая» wherever a manager sets the urgency of a new task (20261115140000).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - a guest's suggestion approved, or a task added to a guest's card by hand, files the level
--   above high when the manager says so (p_critical): priority 'high' with the flag; what the
--   model proposed (signal_findings.urgency) stays as the model gave it;
-- - a caller that says nothing of it (the panel of before, PostgREST without p_critical) files
--   exactly as before, and p_critical false says no more than silence;
-- - a plan step takes 'critical' on the wire, keeps it as high with the flag, answers it beside
--   priority, and files it on the task when the plan is launched; 'high' stays high;
-- - the table holds the rule whoever writes: a step is critical only over high;
-- - the scale an older reader parses keeps three values; the new signatures are the staff's
--   alone, the old ones are gone.
--
-- Fixture ids live in the 900117xxx range and under f117….
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('f1170000-0000-4000-8000-00000000000a', 'Manager critical company');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('f1170001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.mcritical@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'f1170000-0000-4000-8000-00000000000a'
where id = 'f1170001-0000-4000-8000-000000000001';

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900117001, 'f1170000-0000-4000-8000-00000000000a', 'Reviewed flat', 'Europe/Prague', '15:00', '10:00'),
  (900117002, 'f1170000-0000-4000-8000-00000000000a', 'Planned flat', 'Europe/Prague', '15:00', '10:00');

insert into public.reservations (id, host_id, property_id, arrival_date, departure_date, status,
                                 guest_name, is_block)
values (900117101, 'f1170000-0000-4000-8000-00000000000a', 900117001, current_date - 6,
        current_date - 3, 'new', 'Synthetic Guest', false);

insert into public.signal_settings (host_id, kind, tasks_enabled)
values ('f1170000-0000-4000-8000-00000000000a', 'review', true);

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

/** A statement's translated hint, or its SQLSTATE, or 'no error'. */
create or replace function pg_temp.refusal(statement text)
returns text language plpgsql as $$
declare
  v_hint text;
begin
  execute statement;
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return case when v_hint like 'serverErrors.%' then v_hint else sqlstate end;
end $$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;
create or replace function pg_temp.as_boss() returns void language sql as $$
  select pg_temp.as_user('f1170001-0000-4000-8000-000000000001') $$;
create or replace function pg_temp.as_office() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;

create or replace function pg_temp.host() returns uuid language sql immutable as $$
  select 'f1170000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.gid() returns uuid language sql immutable as $$
  select 'f1170020-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.fid(n integer) returns uuid language sql immutable as $$
  select ('f1170030-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.plan() returns uuid language sql immutable as $$
  select 'f1170040-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.sid(n integer) returns uuid language sql immutable as $$
  select ('f1170050-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;

-- What a reader that knows three levels gets, and what a new one adds.
create or replace function pg_temp.level(p_problem uuid) returns text language sql as $$
  select p.priority::text || case when p.critical then '+critical' else '' end
  from public.problems p where p.id = p_problem $$;
-- The task a finding filed, by its level.
create or replace function pg_temp.filed(n integer) returns text language sql as $$
  select pg_temp.level(f.problem_id) from public.signal_findings f where f.id = pg_temp.fid(n) $$;
-- The finding a manager added by hand to the guest's card, by its subject.
create or replace function pg_temp.added(p_subject text) returns public.signal_findings
language sql as $$
  select f.* from public.signal_findings f
  where f.signal_id = pg_temp.gid() and f.subject = p_subject $$;

/** One step of the wire format, with what a test does not care about filled in. */
create or replace function pg_temp.step(n integer, p_kind text, p_theme text, p_over jsonb default '{}')
returns jsonb language sql immutable as $$
  select jsonb_build_object('id', pg_temp.sid(n), 'theme', p_theme, 'kind', p_kind,
                            'title', 'Step ' || n) || p_over $$;
-- A step as stored, and as resolution_plan answers it.
create or replace function pg_temp.stored(n integer) returns text language sql as $$
  select s.priority::text || ':' || s.critical::text
  from public.resolution_plan_steps s where s.id = pg_temp.sid(n) $$;
create or replace function pg_temp.answered(n integer) returns text language sql as $$
  select (s ->> 'priority') || ':' || (s ->> 'critical')
  from jsonb_array_elements(public.resolution_plan(pg_temp.plan()) -> 'steps') s
  where (s ->> 'id')::uuid = pg_temp.sid(n) $$;

-- A guest's review of the flat with four suggestions the model made, each of its own urgency.
insert into public.guest_signals (id, host_id, provider, kind, external_key, external_id,
                                  external_listing_id, property_id, external_reservation_id,
                                  reservation_id, channel, rating, arrival_date, departure_date,
                                  submitted_at, stay_exact)
values (pg_temp.gid(), pg_temp.host(), 'hostaway', 'review', repeat('e1', 32), '881701',
        '900117001', 900117001, '900117101', 900117101, 'airbnb', 6, current_date - 6,
        current_date - 3, now() - interval '1 day', true);

insert into public.signal_findings (id, host_id, signal_id, property_id, kind, subject, urgency,
                                    summary, summary_i18n, confidence, detector, evidence_source)
values
  (pg_temp.fid(1), pg_temp.host(), pg_temp.gid(), 900117001, 'repair', 'hot_water', 'normal',
   'hot_water', '{}', 0.9, 'claude-haiku-5-5@themes-v1', 'public'),
  (pg_temp.fid(2), pg_temp.host(), pg_temp.gid(), 900117001, 'repair', 'heating', 'normal',
   'heating', '{}', 0.9, 'claude-haiku-5-5@themes-v1', 'public'),
  (pg_temp.fid(3), pg_temp.host(), pg_temp.gid(), 900117001, 'repair', 'electric', 'high',
   'electric', '{}', 0.9, 'claude-haiku-5-5@themes-v1', 'public'),
  (pg_temp.fid(4), pg_temp.host(), pg_temp.gid(), 900117001, 'repair', 'plumbing_leak', 'low',
   'plumbing_leak', '{}', 0.9, 'claude-haiku-5-5@themes-v1', 'public');

-- ---------- 1. the scale and the signatures ----------

select pg_temp.check('problem_priority still has exactly the three values an older reader parses',
  enum_range(null::public.problem_priority)::text[], array['low', 'normal', 'high']);
select pg_temp.check('approve_signal_finding has one signature, the new one',
  (select string_agg(p.oid::regprocedure::text, '; ')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'approve_signal_finding'),
  'approve_signal_finding(uuid,text,problem_priority,uuid,text,uuid,date,boolean)');
select pg_temp.check('add_signal_finding too',
  (select string_agg(p.oid::regprocedure::text, '; ')
   from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'add_signal_finding'),
  'add_signal_finding(uuid,signal_finding_kind,text,text,problem_priority,text,uuid,date,boolean)');
select pg_temp.check('the staff may call the new approve_signal_finding',
  has_function_privilege('authenticated',
    'public.approve_signal_finding(uuid,text,public.problem_priority,uuid,text,uuid,date,boolean)',
    'execute'),
  true);
select pg_temp.check('anon may not',
  has_function_privilege('anon',
    'public.approve_signal_finding(uuid,text,public.problem_priority,uuid,text,uuid,date,boolean)',
    'execute'),
  false);
select pg_temp.check('the staff may call the new add_signal_finding',
  has_function_privilege('authenticated',
    'public.add_signal_finding(uuid,public.signal_finding_kind,text,text,public.problem_priority,text,uuid,date,boolean)',
    'execute'),
  true);
select pg_temp.check('anon may not',
  has_function_privilege('anon',
    'public.add_signal_finding(uuid,public.signal_finding_kind,text,text,public.problem_priority,text,uuid,date,boolean)',
    'execute'),
  false);
select pg_temp.check('nor may PUBLIC call either of them',
  (select bool_or(a.grantee = 0)
   from pg_proc p, aclexplode(p.proacl) a
   where p.oid in ('public.approve_signal_finding(uuid,text,public.problem_priority,uuid,text,uuid,date,boolean)'::regprocedure,
                   'public.add_signal_finding(uuid,public.signal_finding_kind,text,text,public.problem_priority,text,uuid,date,boolean)'::regprocedure)),
  false);
select pg_temp.check('a plan step''s level above high is a boolean that is never null',
  (select (data_type, is_nullable, column_default) from information_schema.columns
   where table_schema = 'public' and table_name = 'resolution_plan_steps' and column_name = 'critical'),
  ('boolean'::information_schema.character_data, 'NO'::information_schema.yes_or_no,
   'false'::information_schema.character_data));

-- ---------- 2. approving what the model suggested ----------

select pg_temp.as_boss();
-- The new panel: «Критическая» chosen, whatever priority it also sends.
select public.approve_signal_finding(pg_temp.fid(1), 'Нет горячей воды', p_priority => 'low',
                                     p_critical => true);
-- The panel of before: named arguments, no p_critical.
select public.approve_signal_finding(p_finding_id => pg_temp.fid(2), p_title => 'Холодные батареи',
                                     p_priority => 'high');
-- The new panel with the flag off and no priority of its own.
select public.approve_signal_finding(pg_temp.fid(3), 'Искрит розетка', p_critical => false);
-- Nothing said at all.
select public.approve_signal_finding(pg_temp.fid(4), 'Течёт под раковиной');
select pg_temp.as_office();

select pg_temp.check('p_critical files the level above high, whatever p_priority said',
  pg_temp.filed(1), 'high+critical');
select pg_temp.check('the finding keeps the urgency the model gave it',
  (select urgency::text from public.signal_findings where id = pg_temp.fid(1)), 'normal');
select pg_temp.check('and is a task now',
  (select status::text from public.signal_findings where id = pg_temp.fid(1)), 'task_created');
select pg_temp.check('the panel of before files high as high, not critical',
  pg_temp.filed(2), 'high');
select pg_temp.check('and leaves the model''s urgency as it was too',
  (select urgency::text from public.signal_findings where id = pg_temp.fid(2)), 'normal');
select pg_temp.check('p_critical false says no more than silence: the model''s urgency',
  pg_temp.filed(3), 'high');
select pg_temp.check('silence files the model''s urgency, as before',
  pg_temp.filed(4), 'low');

select pg_temp.as_boss();
select public.approve_signal_finding(pg_temp.fid(1), 'x', p_priority => 'low', p_critical => false);
select pg_temp.as_office();
select pg_temp.check('a repeat after a lost answer leaves the task as it was filed',
  pg_temp.filed(1), 'high+critical');

-- ---------- 3. a task added to the guest's card by hand ----------

select pg_temp.as_boss();
select public.add_signal_finding(p_signal_id => pg_temp.gid(), p_kind => 'repair',
                                 p_subject => 'drain_toilet', p_title => 'Засор в ванной',
                                 p_priority => 'low', p_critical => true);
-- The panel of before: no p_critical.
select public.add_signal_finding(p_signal_id => pg_temp.gid(), p_kind => 'access',
                                 p_subject => 'lock_door', p_title => 'Замок заедает',
                                 p_priority => 'high');
select pg_temp.as_office();

select pg_temp.check('a task added by hand with p_critical is high with the flag',
  pg_temp.level((pg_temp.added('drain_toilet')).problem_id), 'high+critical');
select pg_temp.check('the manager''s own finding says high: the manager''s choice as an older reader reads it',
  ((pg_temp.added('drain_toilet')).urgency::text, (pg_temp.added('drain_toilet')).detector),
  ('high'::text, 'manual'::text));
select pg_temp.check('the panel of before adds high as high, not critical',
  pg_temp.level((pg_temp.added('lock_door')).problem_id), 'high');
select pg_temp.check('every critical task of the company reads high to an older reader',
  (select bool_and(priority = 'high') from public.problems where host_id = pg_temp.host() and critical),
  true);

-- ---------- 4. the steps of a plan ----------

select pg_temp.as_boss();
select pg_temp.check('a plan is saved with a step of each level',
  jsonb_array_length(public.save_resolution_plan(pg_temp.plan(), 900117002, 'Critical first',
    jsonb_build_array(
      pg_temp.step(1, 'repair', 'plumbing', '{"priority": "critical"}'),
      -- The panel of before sends three levels: 'high' is all it knows.
      pg_temp.step(2, 'repair', 'heating', '{"priority": "high"}'),
      pg_temp.step(3, 'repair', 'wifi'),
      pg_temp.step(4, 'purchase', 'linen_towels', '{"priority": "critical"}'))) -> 'steps'),
  4);
select pg_temp.as_office();

select pg_temp.check('a step of the level critical is stored high with the flag',
  pg_temp.stored(1), 'high:true');
select pg_temp.check('a step saved high, as the panel of before sends it, stays not critical',
  pg_temp.stored(2), 'high:false');
select pg_temp.check('a step that says nothing is normal, as before',
  pg_temp.stored(3), 'normal:false');
select pg_temp.check('a purchase takes the level too',
  pg_temp.stored(4), 'high:true');

select pg_temp.as_boss();
select pg_temp.check('the plan answers critical beside priority',
  pg_temp.answered(1), 'high:true');
select pg_temp.check('and false for a high step',
  pg_temp.answered(2), 'high:false');
select pg_temp.check('and for a normal one',
  pg_temp.answered(3), 'normal:false');
select pg_temp.check('a level the scale does not know is refused',
  pg_temp.refusal(format('select public.save_resolution_plan(%L, 900117002, %L, %L::jsonb, %s)',
    pg_temp.plan(), 'Critical first',
    jsonb_build_array(pg_temp.step(5, 'repair', 'tv', '{"priority": "urgent"}'))::text,
    (public.resolution_plan(pg_temp.plan()) ->> 'rev'))),
  'serverErrors.planStepInvalid');

-- A second save raises the normal step to critical, a third lowers it again.
select public.save_resolution_plan(pg_temp.plan(), 900117002, 'Critical first',
  jsonb_build_array(
    pg_temp.step(1, 'repair', 'plumbing', '{"priority": "critical"}'),
    pg_temp.step(2, 'repair', 'heating', '{"priority": "high"}'),
    pg_temp.step(3, 'repair', 'wifi', '{"priority": "critical"}'),
    pg_temp.step(4, 'purchase', 'linen_towels', '{"priority": "critical"}')),
  (public.resolution_plan(pg_temp.plan()) ->> 'rev')::integer);
select pg_temp.check('a step raised to critical on a later save takes the flag',
  pg_temp.answered(3), 'high:true');
select public.save_resolution_plan(pg_temp.plan(), 900117002, 'Critical first',
  jsonb_build_array(
    pg_temp.step(1, 'repair', 'plumbing', '{"priority": "critical"}'),
    pg_temp.step(2, 'repair', 'heating', '{"priority": "high"}'),
    pg_temp.step(3, 'repair', 'wifi', '{"priority": "normal"}'),
    pg_temp.step(4, 'purchase', 'linen_towels', '{"priority": "critical"}')),
  (public.resolution_plan(pg_temp.plan()) ->> 'rev')::integer);
select pg_temp.check('and lowered to normal it loses the flag, no check trips',
  pg_temp.answered(3), 'normal:false');
select pg_temp.as_office();

select pg_temp.check('the table refuses a critical step below high, whoever writes',
  pg_temp.violation_of(format('update public.resolution_plan_steps set priority = %L where id = %L',
                              'normal', pg_temp.sid(1))),
  '23514:resolution_plan_steps_critical_is_high');
select pg_temp.check('the refused write left the step as it was',
  pg_temp.stored(1), 'high:true');
select pg_temp.check('a new step critical below high is refused too',
  pg_temp.violation_of(format(
    'insert into public.resolution_plan_steps (id, plan_id, host_id, theme, kind, title, priority, critical, sort_order)
     values (%L, %L, %L, %L, %L, %L, %L, true, 9)',
    pg_temp.sid(9), pg_temp.plan(), pg_temp.host(), 'tv', 'repair', 'Step 9', 'low')),
  '23514:resolution_plan_steps_critical_is_high');

-- ---------- 5. the launch ----------

select pg_temp.as_boss();
select public.launch_resolution_plan(pg_temp.plan(),
                                     (public.resolution_plan(pg_temp.plan()) ->> 'rev')::integer);
select pg_temp.as_office();

select pg_temp.check('the launch files a critical step''s task high with the flag',
  (pg_temp.level(pg_temp.sid(1)),
   (select source::text from public.problems where id = pg_temp.sid(1))),
  ('high+critical'::text, 'plan'::text));
select pg_temp.check('a high step''s task is high alone',
  pg_temp.level(pg_temp.sid(2)), 'high');
select pg_temp.check('a normal step''s task is normal',
  pg_temp.level(pg_temp.sid(3)), 'normal');
select pg_temp.check('a critical purchase asks urgently, as a high one does',
  (select priority::text from public.supply_requests where id = pg_temp.sid(4)), 'urgent');

select pg_temp.as_boss();
select pg_temp.check('a launched plan still answers its step critical',
  pg_temp.answered(1), 'high:true');
select pg_temp.as_office();

rollback;
