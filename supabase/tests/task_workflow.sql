-- The cleaning process: templates, the snapshot a task takes of one, and the
-- cleaner's progress through it. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: a template edited later never changes a task
-- already under way; a required step holds the finish until it is done or a
-- manager releases it; every write to progress goes through the functions,
-- which are idempotent so the phone can replay them; and all of it stops at
-- the edge of the company.
--
-- The seeded template is deliberately all-optional (a soft start). To test the
-- gate this suite flips two of its steps to required from the server side;
-- the change rolls back with everything else.
--
-- Fixture ids live in the 9000014xx range; tasks have fixed uuids so the
-- checks can name them.
begin;

insert into public.hosts (id, name) values
  ('b4000000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d4000001-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.flow@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d4000002-0000-4000-8000-0000000000d2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.flow@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d4000003-0000-4000-8000-0000000000d3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.flow@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('d4000004-0000-4000-8000-0000000000d4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cleaner.b.flow@test.local','x',now(),now(),
   '{"full_name":"Cleaner B"}'::jsonb, '{"role":"cleaner"}'::jsonb);

update public.profiles set host_id = 'b4000000-0000-4000-8000-00000000000b'
where id = 'd4000004-0000-4000-8000-0000000000d4';

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900001401, 'Flat plain',    'UTC', '15:00', '10:00'),
  (900001402, 'Flat override', 'UTC', '15:00', '10:00');
insert into public.properties (id, name, timezone, check_in_time, check_out_time, parent_id) values
  (900001403, 'Unit of override', 'UTC', '15:00', '10:00', 900001402);
insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900001404, 'b4000000-0000-4000-8000-00000000000b', 'B flat', 'UTC', '15:00', '10:00');

-- The note fixture is shared with the app's Jest suite: two non-empty lines
-- once CR/LF and blank lines are dealt with.
insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date, notes) values
  ('a4000001-0000-4000-8000-000000000001', 900001401, 'cleaning', 'assigned',
   'd4000001-0000-4000-8000-0000000000d1', current_date, E'a\r\n\n b \n'),
  ('a4000001-0000-4000-8000-000000000002', 900001401, 'cleaning', 'assigned',
   'd4000001-0000-4000-8000-0000000000d1', current_date, null),
  ('a4000001-0000-4000-8000-000000000003', 900001402, 'cleaning', 'assigned',
   'd4000001-0000-4000-8000-0000000000d1', current_date, 'override'),
  ('a4000001-0000-4000-8000-000000000004', 900001403, 'cleaning', 'assigned',
   'd4000001-0000-4000-8000-0000000000d1', current_date, 'unit'),
  ('a4000001-0000-4000-8000-000000000005', 900001401, 'cleaning', 'assigned',
   'd4000002-0000-4000-8000-0000000000d2', current_date, 'annas'),
  ('a4000001-0000-4000-8000-000000000006', 900001401, 'cleaning', 'assigned',
   'd4000001-0000-4000-8000-0000000000d1', current_date, 'soft start'),
  ('a4000001-0000-4000-8000-000000000008', 900001401, 'cleaning', 'assigned',
   'd4000001-0000-4000-8000-0000000000d1', current_date, null);
insert into public.tasks (id, host_id, property_id, type, status, assignee_id, scheduled_date, notes) values
  ('a4000001-0000-4000-8000-000000000007', 'b4000000-0000-4000-8000-00000000000b',
   900001404, 'cleaning', 'assigned', 'd4000004-0000-4000-8000-0000000000d4', current_date, 'host b');

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.task(n integer)
returns public.tasks language sql as $$
  select t.* from public.tasks t
  where t.id = ('a4000001-0000-4000-8000-00000000000' || n)::uuid
$$;

create or replace function pg_temp.step(n integer, kind public.workflow_step_type)
returns public.task_steps language sql as $$
  select s.* from public.task_steps s
  where s.task_id = ('a4000001-0000-4000-8000-00000000000' || n)::uuid and s.type = kind
$$;

create or replace function pg_temp.step_count(n integer)
returns integer language sql as $$
  select count(*)::integer from public.task_steps s
  where s.task_id = ('a4000001-0000-4000-8000-00000000000' || n)::uuid
$$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;

create or replace function pg_temp.as_maria() returns void language sql as $$
  select pg_temp.as_user('d4000001-0000-4000-8000-0000000000d1')
$$;
create or replace function pg_temp.as_anna() returns void language sql as $$
  select pg_temp.as_user('d4000002-0000-4000-8000-0000000000d2')
$$;
create or replace function pg_temp.as_boss() returns void language sql as $$
  select pg_temp.as_user('d4000003-0000-4000-8000-0000000000d3')
$$;
create or replace function pg_temp.as_cleaner_b() returns void language sql as $$
  select pg_temp.as_user('d4000004-0000-4000-8000-0000000000d4')
$$;

create or replace function pg_temp.seed_template() returns uuid language sql as $$
  select t.id from public.workflow_templates t
  where t.host_id = public.default_host_id() and t.scope = 'cleaning' and t.property_id is null
$$;

-- ---------- the seed ----------
select pg_temp.check('the company has one default cleaning template',
  (select count(*)::int from public.workflow_templates
   where host_id = public.default_host_id() and scope = 'cleaning'), 1);
select pg_temp.check('the seeded template has three steps',
  (select count(*)::int from public.workflow_steps where template_id = pg_temp.seed_template()), 3);
select pg_temp.check('every seeded step is optional — a soft start',
  (select count(*)::int from public.workflow_steps
   where template_id = pg_temp.seed_template() and required), 0);
select pg_temp.check('the default template applies to a listing with no override of its own',
  public.resolve_workflow_template(900001401, 'cleaning'), pg_temp.seed_template());

-- ---------- soft start: steps are shown, nothing is enforced ----------
select pg_temp.as_maria();
update public.tasks set status = 'in_progress' where id = (pg_temp.task(6)).id;
reset role; reset request.jwt.claims;
select pg_temp.check('starting a task takes a snapshot of the template',
  pg_temp.step_count(6), 3);

select pg_temp.as_maria();
update public.tasks set status = 'done' where id = (pg_temp.task(6)).id;
reset role; reset request.jwt.claims;
select pg_temp.check('with every step optional the task finishes without touching them',
  (pg_temp.task(6)).status::text, 'done');

-- ---------- from here on, two steps are required ----------
update public.workflow_steps
set required = true
where template_id = pg_temp.seed_template() and type in ('task_note', 'confirmation');

-- A listing with a process of its own, and a template for the other company.
insert into public.workflow_templates (id, scope, property_id, name) values
  ('c4000000-0000-4000-8000-000000000001', 'cleaning', 900001402, 'Override');
insert into public.workflow_steps (id, template_id, sort_order, type, required, title) values
  ('c4000000-0000-4000-8000-000000000011', 'c4000000-0000-4000-8000-000000000001',
   1, 'confirmation', false, 'Only step');

insert into public.workflow_templates (id, host_id, scope, name) values
  ('c4000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-00000000000b', 'cleaning', 'B process');
insert into public.workflow_steps (template_id, host_id, sort_order, type, required) values
  ('c4000000-0000-4000-8000-000000000002', 'b4000000-0000-4000-8000-00000000000b', 1, 'confirmation', false);

-- ---------- the snapshot ----------
select pg_temp.as_maria();
update public.tasks set status = 'in_progress' where id = (pg_temp.task(1)).id;
update public.tasks set status = 'in_progress' where id = (pg_temp.task(2)).id;
reset role; reset request.jwt.claims;

select pg_temp.check('a task with a note gets all three steps', pg_temp.step_count(1), 3);
select pg_temp.check('the note step carries the text of the task note',
  (pg_temp.step(1, 'task_note')).instructions, E'a\r\n\n b \n');
select pg_temp.check('the note step is required, as the template says',
  (pg_temp.step(1, 'task_note')).required, true);
select pg_temp.check('the comment step stays optional',
  (pg_temp.step(1, 'cleaner_comment')).required, false);
select pg_temp.check('a task without a note has no note step', pg_temp.step_count(2), 2);
select pg_temp.check('and the missing one is the note step',
  (select count(*)::int from public.task_steps
   where task_id = (pg_temp.task(2)).id and type = 'task_note'), 0);

-- Snapshot is idempotent: a manager pausing and resuming does not duplicate.
select pg_temp.as_boss();
update public.tasks set status = 'paused' where id = (pg_temp.task(2)).id;
update public.tasks set status = 'in_progress' where id = (pg_temp.task(2)).id;
reset role; reset request.jwt.claims;
select pg_temp.check('resuming a paused task keeps its steps as they are', pg_temp.step_count(2), 2);

-- ---------- the template moves on, the task does not ----------
update public.workflow_steps set title = 'Changed later'
where template_id = pg_temp.seed_template() and type = 'confirmation';
delete from public.workflow_steps
where template_id = pg_temp.seed_template() and type = 'cleaner_comment';

select pg_temp.check('editing the template does not rename a step already snapshotted',
  (pg_temp.step(1, 'confirmation')).title, 'Финальная проверка');
select pg_temp.check('deleting a template step leaves the task step in place',
  pg_temp.step_count(1), 3);
select pg_temp.check('the deleted step just loses its link to the template',
  (pg_temp.step(1, 'cleaner_comment')).template_step_id, null::uuid);

-- ---------- a listing with its own process ----------
select pg_temp.as_maria();
update public.tasks set status = 'in_progress' where id = (pg_temp.task(3)).id;
update public.tasks set status = 'in_progress' where id = (pg_temp.task(4)).id;
reset role; reset request.jwt.claims;

select pg_temp.check('a listing override replaces the default entirely', pg_temp.step_count(3), 1);
select pg_temp.check('the override step is the one snapshotted',
  (pg_temp.step(3, 'confirmation')).template_step_id,
  'c4000000-0000-4000-8000-000000000011'::uuid);
select pg_temp.check('a unit inherits the process of its parent listing', pg_temp.step_count(4), 1);
select pg_temp.check('from the same template step',
  (pg_temp.step(4, 'confirmation')).template_step_id,
  'c4000000-0000-4000-8000-000000000011'::uuid);

-- ---------- the gate ----------
do $$
declare
  v_message text;
begin
  perform pg_temp.as_maria();
  update public.tasks set status = 'done' where id = (pg_temp.task(1)).id;
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a task was finished with required steps open';
exception when check_violation then
  get stacked diagnostics v_message = message_text;
  reset role; reset request.jwt.claims;
  if v_message not like '%: 2' then
    raise exception 'FAIL the gate does not say how many steps remain: %', v_message;
  end if;
  raise notice 'ok  the finish is refused while two required steps are open, and says so';
end $$;
select pg_temp.check('the refused task is still in progress',
  (pg_temp.task(1)).status::text, 'in_progress');

-- ---------- completing a step ----------
do $$
begin
  perform pg_temp.as_maria();
  perform public.complete_task_step((pg_temp.step(1, 'task_note')).id, '{"checked_lines":[0]}'::jsonb);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a note step was completed with a line unticked';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a note step needs every line ticked';
end $$;

select pg_temp.as_maria();
select public.complete_task_step((pg_temp.step(1, 'task_note')).id,
  '{"checked_lines":[1,0,1]}'::jsonb, '2026-09-05 10:00+00');
reset role; reset request.jwt.claims;
select pg_temp.check('a fully ticked note step is completed, stamped by the server',
  (pg_temp.step(1, 'task_note')).completed_at, now());
select pg_temp.check('the completion records who did it',
  (pg_temp.step(1, 'task_note')).completed_by, 'd4000001-0000-4000-8000-0000000000d1'::uuid);
select pg_temp.check('what the phone said about the time is kept separately',
  (pg_temp.step(1, 'task_note')).device_completed_at, '2026-09-05 10:00+00'::timestamptz);
select pg_temp.check('the answer is stored normalised',
  (pg_temp.step(1, 'task_note')).payload, '{"checked_lines":[0,1]}'::jsonb);
select pg_temp.check('opening is implied by completing',
  (pg_temp.step(1, 'task_note')).started_at, now());

-- ---------- replaying a completion changes nothing ----------
update public.task_steps set completed_at = now() - interval '1 hour'
where id = (pg_temp.step(1, 'task_note')).id;

select pg_temp.as_maria();
select public.complete_task_step((pg_temp.step(1, 'task_note')).id, '{"checked_lines":[0,1]}'::jsonb);
reset role; reset request.jwt.claims;
select pg_temp.check('a replayed completion keeps the first stamp',
  (pg_temp.step(1, 'task_note')).completed_at, now() - interval '1 hour');

-- ---------- reopening ----------
select pg_temp.as_maria();
select public.reopen_task_step((pg_temp.step(1, 'task_note')).id);
reset role; reset request.jwt.claims;
select pg_temp.check('a reopened step is no longer completed',
  (pg_temp.step(1, 'task_note')).completed_at, null::timestamptz);
select pg_temp.check('but keeps its answer as a draft',
  (pg_temp.step(1, 'task_note')).payload, '{"checked_lines":[0,1]}'::jsonb);

do $$
begin
  perform pg_temp.as_maria();
  update public.tasks set status = 'done' where id = (pg_temp.task(1)).id;
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a task was finished after its step was reopened';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  reopening a required step closes the gate again';
end $$;

-- ---------- skipping ----------
select pg_temp.as_maria();
select public.skip_task_step((pg_temp.step(1, 'cleaner_comment')).id, 'nothing to add');
reset role; reset request.jwt.claims;
select pg_temp.check('an optional step can be skipped',
  (pg_temp.step(1, 'cleaner_comment')).skipped_at, now());
select pg_temp.check('with the reason kept',
  (pg_temp.step(1, 'cleaner_comment')).skip_reason, 'nothing to add');

do $$
begin
  perform pg_temp.as_maria();
  perform public.skip_task_step((pg_temp.step(1, 'confirmation')).id);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a required step was skipped';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a required step cannot be skipped';
end $$;

-- ---------- the manager releases a step ----------
do $$
begin
  perform pg_temp.as_boss();
  perform public.waive_task_step((pg_temp.step(1, 'task_note')).id, '   ');
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a step was waived without a reason';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a waiver needs a reason';
end $$;

do $$
begin
  perform pg_temp.as_boss();
  perform public.waive_task_step((pg_temp.step(1, 'cleaner_comment')).id, 'why');
  reset role; reset request.jwt.claims;
  raise exception 'FAIL an optional step was waived';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  only a required step can be waived';
end $$;

do $$
begin
  perform pg_temp.as_maria();
  perform public.waive_task_step((pg_temp.step(1, 'task_note')).id, 'let me through');
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a cleaner waived her own step';
exception when insufficient_privilege then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a cleaner cannot waive a step';
end $$;

select pg_temp.as_boss();
select public.waive_task_step((pg_temp.step(1, 'task_note')).id, 'the note was outdated');
reset role; reset request.jwt.claims;
select pg_temp.check('a manager waives a required step with a reason',
  (pg_temp.step(1, 'task_note')).waive_reason, 'the note was outdated');
select pg_temp.check('and is recorded as the one who did',
  (pg_temp.step(1, 'task_note')).waived_by, 'd4000003-0000-4000-8000-0000000000d3'::uuid);

select pg_temp.as_maria();
select public.complete_task_step((pg_temp.step(1, 'confirmation')).id, '{}'::jsonb);
update public.tasks set status = 'done' where id = (pg_temp.task(1)).id;
reset role; reset request.jwt.claims;
select pg_temp.check('with the rest completed and the waiver in place the task finishes',
  (pg_temp.task(1)).status::text, 'done');

-- ---------- history is closed ----------
do $$
begin
  perform pg_temp.as_maria();
  perform public.complete_task_step((pg_temp.step(1, 'cleaner_comment')).id, '{"text":"late"}'::jsonb);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a step of a finished task was completed';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a step of a finished task cannot be touched';
end $$;

-- ---------- a colleague's task ----------
do $$
begin
  perform pg_temp.as_anna();
  perform public.complete_task_step((pg_temp.step(2, 'confirmation')).id, '{}'::jsonb);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a cleaner completed a colleague step';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a cleaner cannot complete a colleague step';
end $$;

select pg_temp.as_anna();
select pg_temp.check('a cleaner does not even see a colleague steps',
  (select count(*)::int from public.task_steps where task_id = (pg_temp.task(2)).id), 0);
reset role; reset request.jwt.claims;

select pg_temp.as_maria();
select pg_temp.check('the assignee sees her own steps',
  (select count(*)::int from public.task_steps where task_id = (pg_temp.task(2)).id), 2);
reset role; reset request.jwt.claims;

-- ---------- opening ----------
select pg_temp.as_maria();
select public.open_task_step((pg_temp.step(2, 'confirmation')).id);
reset role; reset request.jwt.claims;
select pg_temp.check('opening a step stamps when it was first opened',
  (pg_temp.step(2, 'confirmation')).started_at, now());

update public.task_steps set started_at = now() - interval '1 hour'
where id = (pg_temp.step(2, 'confirmation')).id;
select pg_temp.as_maria();
select public.open_task_step((pg_temp.step(2, 'confirmation')).id);
reset role; reset request.jwt.claims;
select pg_temp.check('opening again keeps the first opening',
  (pg_temp.step(2, 'confirmation')).started_at, now() - interval '1 hour');

-- ---------- the comment step ----------
do $$
begin
  perform pg_temp.as_maria();
  perform public.complete_task_step((pg_temp.step(2, 'cleaner_comment')).id, '{"text":"   "}'::jsonb);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL an empty comment was accepted';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  an empty comment is refused';
end $$;

select pg_temp.as_maria();
select public.complete_task_step((pg_temp.step(2, 'cleaner_comment')).id, '{"text":"  all good  "}'::jsonb);
reset role; reset request.jwt.claims;
select pg_temp.check('a comment is stored trimmed',
  (pg_temp.step(2, 'cleaner_comment')).payload, '{"text":"all good"}'::jsonb);

-- ---------- a manager may finish past the gate ----------
select pg_temp.as_maria();
update public.tasks set status = 'in_progress' where id = (pg_temp.task(8)).id;
reset role; reset request.jwt.claims;
select pg_temp.check('the later task snapshots the template as it is now', pg_temp.step_count(8), 1);

select pg_temp.as_boss();
update public.tasks set status = 'done' where id = (pg_temp.task(8)).id;
reset role; reset request.jwt.claims;
select pg_temp.check('a manager finishes a task with a required step still open',
  (pg_temp.task(8)).status::text, 'done');
select pg_temp.check('and the open step stays visible for what it is',
  (pg_temp.step(8, 'confirmation')).completed_at, null::timestamptz);

-- ---------- the other company ----------
select pg_temp.as_cleaner_b();
update public.tasks set status = 'in_progress' where id = (pg_temp.task(7)).id;
select pg_temp.check('the other company sees only its own templates',
  (select count(*)::int from public.workflow_templates), 1);
select pg_temp.check('and none of the first company steps',
  (select count(*)::int from public.task_steps where task_id = (pg_temp.task(1)).id), 0);
reset role; reset request.jwt.claims;
select pg_temp.check('a task of the other company follows the other company template',
  (select t.host_id from public.workflow_steps s
   join public.workflow_templates t on t.id = s.template_id
   where s.id = (pg_temp.step(7, 'confirmation')).template_step_id),
  'b4000000-0000-4000-8000-00000000000b'::uuid);

select pg_temp.as_boss();
select pg_temp.check('a manager sees the templates of her own company only',
  (select count(*)::int from public.workflow_templates), 2);
reset role; reset request.jwt.claims;

do $$
begin
  perform pg_temp.as_boss();
  perform public.save_workflow_template(jsonb_build_object(
    'scope', 'cleaning', 'property_id', 900001404, 'name', 'Smuggled',
    'steps', '[]'::jsonb));
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a manager created a template for a listing of another company';
exception when foreign_key_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a template cannot point at a listing of another company';
end $$;

do $$
begin
  perform pg_temp.as_maria();
  insert into public.task_steps (task_id, sort_order, type, required)
  values ((pg_temp.task(2)).id, 99, 'confirmation', false);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a cleaner wrote task_steps directly';
exception when insufficient_privilege then
  reset role; reset request.jwt.claims;
  raise notice 'ok  task_steps cannot be written directly';
end $$;

do $$
begin
  perform pg_temp.as_maria();
  perform public.save_workflow_template(jsonb_build_object(
    'scope', 'cleaning', 'name', 'Mine', 'steps', '[]'::jsonb));
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a cleaner saved a template';
exception when insufficient_privilege then
  reset role; reset request.jwt.claims;
  raise notice 'ok  only a manager saves templates';
end $$;

-- ---------- saving a template ----------
select pg_temp.as_boss();
select public.save_workflow_template(jsonb_build_object(
  'id', 'c4000000-0000-4000-8000-000000000001',
  'name', 'Override v2',
  'steps', jsonb_build_array(
    jsonb_build_object('type', 'cleaner_comment', 'required', false, 'title', 'First now'),
    jsonb_build_object('id', 'c4000000-0000-4000-8000-000000000011',
                       'type', 'confirmation', 'required', true, 'title', 'Only step, renamed')
  )));
reset role; reset request.jwt.claims;

select pg_temp.check('saving renames the template',
  (select name from public.workflow_templates where id = 'c4000000-0000-4000-8000-000000000001'),
  'Override v2');
select pg_temp.check('and bumps its version',
  (select version from public.workflow_templates where id = 'c4000000-0000-4000-8000-000000000001'), 2);
select pg_temp.check('a step sent with its id keeps that id',
  (select title from public.workflow_steps where id = 'c4000000-0000-4000-8000-000000000011'),
  'Only step, renamed');
select pg_temp.check('and takes its new place in the order',
  (select sort_order::int from public.workflow_steps where id = 'c4000000-0000-4000-8000-000000000011'), 2);
select pg_temp.check('a step sent without an id is created',
  (select count(*)::int from public.workflow_steps
   where template_id = 'c4000000-0000-4000-8000-000000000001'), 2);
select pg_temp.check('the task snapshotted earlier is untouched by the save',
  (pg_temp.step(3, 'confirmation')).title, 'Only step');

do $$
begin
  perform pg_temp.as_boss();
  perform public.save_workflow_template(jsonb_build_object(
    'id', 'c4000000-0000-4000-8000-000000000001',
    'steps', jsonb_build_array(
      jsonb_build_object('type', 'checklist', 'required', true))));
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a step the app cannot complete was made required';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a step of a type the app cannot complete cannot be required';
end $$;

select pg_temp.as_boss();
select public.save_workflow_template(jsonb_build_object(
  'scope', 'cleaning', 'property_id', 900001401, 'name', 'New for plain',
  'steps', jsonb_build_array(
    jsonb_build_object('type', 'photos_before', 'required', false, 'max_photos', 3))));
reset role; reset request.jwt.claims;
select pg_temp.check('a save without an id creates the template by its natural key',
  (select count(*)::int from public.workflow_templates where property_id = 900001401), 1);
select pg_temp.check('a future step type may be present as long as it is optional',
  (select type::text from public.workflow_steps s
   join public.workflow_templates t on t.id = s.template_id
   where t.property_id = 900001401), 'photos_before');

-- ---------- a switched-off override is no override ----------
update public.workflow_templates set is_active = false
where id = 'c4000000-0000-4000-8000-000000000001';
select pg_temp.check('an inactive override falls back to the company default',
  public.resolve_workflow_template(900001402, 'cleaning'), pg_temp.seed_template());
select pg_temp.check('and so does the unit under it',
  public.resolve_workflow_template(900001403, 'cleaning'), pg_temp.seed_template());

-- ---------- a task of a kind without a process ----------
insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date) values
  ('a4000001-0000-4000-8000-000000000009', 900001401, 'maintenance', 'assigned',
   'd4000001-0000-4000-8000-0000000000d1', current_date);
select pg_temp.as_maria();
update public.tasks set status = 'in_progress' where id = (pg_temp.task(9)).id;
update public.tasks set status = 'done' where id = (pg_temp.task(9)).id;
reset role; reset request.jwt.claims;
select pg_temp.check('a task whose scope has no template gets no steps', pg_temp.step_count(9), 0);
select pg_temp.check('and finishes as it did before F16', (pg_temp.task(9)).status::text, 'done');

rollback;
