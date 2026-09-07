-- The checklist of a listing, and the step that carries it into a cleaning.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: a checklist belongs to one listing and is written
-- only by a manager of its own company; a unit falls back to its parent's;
-- a task takes a copy at the moment it starts and keeps it whatever happens
-- to the checklist afterwards; every item that is not optional has to be
-- ticked before the step is done; and a required checklist holds the finish.
--
-- Fixture ids live in the 9000015xx range; tasks have fixed uuids so the
-- checks can name them. Titles are English here on purpose — the fixtures are
-- read by whoever debugs a failure, not by a cleaner.
begin;

insert into public.hosts (id, name) values
  ('b5000000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d5000001-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.list@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d5000003-0000-4000-8000-0000000000d3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.list@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('d5000004-0000-4000-8000-0000000000d4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cleaner.b.list@test.local','x',now(),now(),
   '{"full_name":"Cleaner B"}'::jsonb, '{"role":"cleaner"}'::jsonb);

update public.profiles set host_id = 'b5000000-0000-4000-8000-00000000000b'
where id = 'd5000004-0000-4000-8000-0000000000d4';

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900001501, 'Flat with checklist', 'UTC', '15:00', '10:00'),
  (900001502, 'Parent flat',         'UTC', '15:00', '10:00'),
  (900001504, 'Flat with nothing',   'UTC', '15:00', '10:00'),
  (900001505, 'Copy source',         'UTC', '15:00', '10:00'),
  (900001506, 'Flat with an empty module', 'UTC', '15:00', '10:00'),
  (900001507, 'Flat to be cleared',  'UTC', '15:00', '10:00'),
  (900001508, 'Copy target',         'UTC', '15:00', '10:00'),
  (900001510, 'Flat in three languages', 'UTC', '15:00', '10:00'),
  (900001511, 'Copy of the translated one', 'UTC', '15:00', '10:00');
insert into public.properties (id, name, timezone, check_in_time, check_out_time, parent_id) values
  (900001503, 'Unit of parent', 'UTC', '15:00', '10:00', 900001502);
insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900001509, 'b5000000-0000-4000-8000-00000000000b', 'B flat', 'UTC', '15:00', '10:00');

-- No notes anywhere: the note step is omitted at snapshot time, so the step
-- counts below are about the checklist and nothing else.
insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date) values
  ('a5000001-0000-4000-8000-000000000001', 900001501, 'cleaning', 'assigned',
   'd5000001-0000-4000-8000-0000000000d1', current_date),
  ('a5000001-0000-4000-8000-000000000002', 900001504, 'cleaning', 'assigned',
   'd5000001-0000-4000-8000-0000000000d1', current_date),
  ('a5000001-0000-4000-8000-000000000003', 900001503, 'cleaning', 'assigned',
   'd5000001-0000-4000-8000-0000000000d1', current_date),
  ('a5000001-0000-4000-8000-000000000004', 900001501, 'cleaning', 'assigned',
   'd5000001-0000-4000-8000-0000000000d1', current_date),
  ('a5000001-0000-4000-8000-000000000005', 900001510, 'cleaning', 'assigned',
   'd5000001-0000-4000-8000-0000000000d1', current_date);

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

create or replace function pg_temp.as_maria() returns void language sql as $$
  select pg_temp.as_user('d5000001-0000-4000-8000-0000000000d1')
$$;
create or replace function pg_temp.as_boss() returns void language sql as $$
  select pg_temp.as_user('d5000003-0000-4000-8000-0000000000d3')
$$;
create or replace function pg_temp.as_cleaner_b() returns void language sql as $$
  select pg_temp.as_user('d5000004-0000-4000-8000-0000000000d4')
$$;

create or replace function pg_temp.task(n integer)
returns public.tasks language sql as $$
  select t.* from public.tasks t
  where t.id = ('a5000001-0000-4000-8000-00000000000' || n)::uuid
$$;

create or replace function pg_temp.step(n integer, kind public.workflow_step_type)
returns public.task_steps language sql as $$
  select s.* from public.task_steps s
  where s.task_id = ('a5000001-0000-4000-8000-00000000000' || n)::uuid and s.type = kind
$$;

create or replace function pg_temp.step_count(n integer)
returns integer language sql as $$
  select count(*)::integer from public.task_steps s
  where s.task_id = ('a5000001-0000-4000-8000-00000000000' || n)::uuid
$$;

/** The id of one checklist item, as text — the shape the payload speaks. */
create or replace function pg_temp.item(p_property bigint, p_title text)
returns text language sql as $$
  select i.id::text
  from public.checklist_items i
  join public.checklist_modules m on m.id = i.module_id
  where m.property_id = p_property and i.title = p_title
$$;

create or replace function pg_temp.module_count(p_property bigint)
returns integer language sql as $$
  select count(*)::integer from public.checklist_modules m where m.property_id = p_property
$$;

create or replace function pg_temp.item_count(p_property bigint)
returns integer language sql as $$
  select count(*)::integer
  from public.checklist_items i
  join public.checklist_modules m on m.id = i.module_id
  where m.property_id = p_property
$$;

create or replace function pg_temp.seed_template() returns uuid language sql as $$
  select t.id from public.workflow_templates t
  where t.host_id = public.default_host_id() and t.scope = 'cleaning' and t.property_id is null
$$;

-- The process gains a checklist step. The seeded template is left alone by
-- the migration on purpose (the owner adds it when checklists are filled in),
-- so the suite adds it here.
insert into public.workflow_steps (id, template_id, sort_order, type, required) values
  ('c5000000-0000-4000-8000-000000000011', pg_temp.seed_template(), 4, 'checklist', false);

-- ---------- the type is live now ----------
select pg_temp.check('the app can complete a checklist step',
  'checklist' = any (public.workflow_supported_step_types()), true);

-- ---------- saving a checklist ----------
do $$
declare
  v_hint text;
begin
  perform pg_temp.as_maria();
  perform public.save_property_checklist(900001501, '[]'::jsonb);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a cleaner saved a checklist';
exception when insufficient_privilege then
  get stacked diagnostics v_hint = pg_exception_hint;
  reset role; reset request.jwt.claims;
  if v_hint is distinct from 'serverErrors.managerOnly' then
    raise exception 'FAIL the refusal does not name its translation key: %', v_hint;
  end if;
  raise notice 'ok  a cleaner cannot save a checklist, and the refusal carries a key';
end $$;

select pg_temp.as_boss();
select public.save_property_checklist(900001501, $json$[
  {"title": "Bathroom", "items": [
    {"title": "Mirror"},
    {"title": "Towels"}
  ]},
  {"title": "Kitchen", "items": [
    {"title": "Stove"},
    {"title": "Balcony box", "is_optional": true}
  ]}
]$json$::jsonb);
reset role; reset request.jwt.claims;

select pg_temp.check('the checklist has both modules', pg_temp.module_count(900001501), 2);
select pg_temp.check('and all four items', pg_temp.item_count(900001501), 4);
select pg_temp.check('the array order is the order on screen',
  (select m.title from public.checklist_modules m
   where m.property_id = 900001501 and m.sort_order = 1), 'Bathroom');
select pg_temp.check('an item is required unless it says otherwise',
  (select i.is_optional from public.checklist_items i
   join public.checklist_modules m on m.id = i.module_id
   where m.property_id = 900001501 and i.title = 'Mirror'), false);
select pg_temp.check('and optional when it does',
  (select i.is_optional from public.checklist_items i
   join public.checklist_modules m on m.id = i.module_id
   where m.property_id = 900001501 and i.title = 'Balcony box'), true);

-- Saving again with the ids: reorder, rename, drop one item.
select pg_temp.as_boss();
select public.save_property_checklist(900001501, (
  select jsonb_build_array(
    jsonb_build_object(
      'id', (select m.id from public.checklist_modules m
             where m.property_id = 900001501 and m.title = 'Kitchen'),
      'title', 'Kitchen',
      'items', jsonb_build_array(
        jsonb_build_object('id', pg_temp.item(900001501, 'Stove')::uuid, 'title', 'Stove')
      )),
    jsonb_build_object(
      'id', (select m.id from public.checklist_modules m
             where m.property_id = 900001501 and m.title = 'Bathroom'),
      'title', 'Bathroom, renamed',
      'items', jsonb_build_array(
        jsonb_build_object('id', pg_temp.item(900001501, 'Mirror')::uuid, 'title', 'Mirror'),
        jsonb_build_object('id', pg_temp.item(900001501, 'Towels')::uuid, 'title', 'Towels'),
        jsonb_build_object('title', 'Floor')
      ))
  )
));
reset role; reset request.jwt.claims;

select pg_temp.check('a module kept its id and moved to the front',
  (select m.title from public.checklist_modules m
   where m.property_id = 900001501 and m.sort_order = 1), 'Kitchen');
select pg_temp.check('a module can be renamed in place',
  (select m.title from public.checklist_modules m
   where m.property_id = 900001501 and m.sort_order = 2), 'Bathroom, renamed');
select pg_temp.check('an item missing from the array is deleted',
  (select count(*)::int from public.checklist_items i
   join public.checklist_modules m on m.id = i.module_id
   where m.property_id = 900001501 and i.title = 'Balcony box'), 0);
select pg_temp.check('an item without an id is created',
  (select count(*)::int from public.checklist_items i
   join public.checklist_modules m on m.id = i.module_id
   where m.property_id = 900001501 and i.title = 'Floor'), 1);
select pg_temp.check('the listing now has four items again', pg_temp.item_count(900001501), 4);

-- An empty array clears the checklist, modules and items together.
select pg_temp.as_boss();
select public.save_property_checklist(900001507,
  '[{"title": "Only module", "items": [{"title": "Only item"}]}]'::jsonb);
select public.save_property_checklist(900001507, '[]'::jsonb);
reset role; reset request.jwt.claims;
select pg_temp.check('an empty array clears the checklist', pg_temp.module_count(900001507), 0);
select pg_temp.check('and takes the items with it', pg_temp.item_count(900001507), 0);

do $$
begin
  perform pg_temp.as_boss();
  perform public.save_property_checklist(900001509, '[]'::jsonb);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a manager saved a checklist of another company';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a listing of another company is not found';
end $$;

-- ---------- which listing a checklist comes from ----------
select pg_temp.as_boss();
select public.save_property_checklist(900001502,
  '[{"title": "Whole flat", "items": [{"title": "Hallway"}]}]'::jsonb);
select public.save_property_checklist(900001505, $json$[
  {"title": "Source module", "items": [{"title": "Source one"}, {"title": "Source two"}]}
]$json$::jsonb);
select public.save_property_checklist(900001506, '[{"title": "Empty module", "items": []}]'::jsonb);
reset role; reset request.jwt.claims;

select pg_temp.check('a listing with a checklist of its own uses it',
  public.resolve_checklist_property(900001501), 900001501::bigint);
select pg_temp.check('a unit falls back to its parent',
  public.resolve_checklist_property(900001503), 900001502::bigint);
select pg_temp.check('a listing with nothing has no checklist',
  public.resolve_checklist_property(900001504), null::bigint);
select pg_temp.check('a module with no items is not a checklist',
  public.resolve_checklist_property(900001506), null::bigint);
select pg_temp.check('and its snapshot is empty',
  jsonb_array_length(public.property_checklist_snapshot(900001506)->'modules'), 0);
select pg_temp.check('a snapshot carries the modules',
  jsonb_array_length(public.property_checklist_snapshot(900001501)->'modules'), 2);

-- ---------- copying a checklist from another listing ----------
do $$
begin
  perform pg_temp.as_maria();
  perform public.copy_property_checklist(900001505, 900001508);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a cleaner copied a checklist';
exception when insufficient_privilege then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a cleaner cannot copy a checklist';
end $$;

select pg_temp.as_boss();
select public.copy_property_checklist(900001505, 900001508);
reset role; reset request.jwt.claims;

select pg_temp.check('the copy has the same modules', pg_temp.module_count(900001508), 1);
select pg_temp.check('and the same items', pg_temp.item_count(900001508), 2);
select pg_temp.check('with the titles of the source',
  (select m.title from public.checklist_modules m where m.property_id = 900001508), 'Source module');
select pg_temp.check('the copied items are new rows, not the source rows',
  (select count(*)::int from public.checklist_items i
   join public.checklist_modules m on m.id = i.module_id
   where m.property_id = 900001508
     and i.id::text = pg_temp.item(900001505, 'Source one')), 0);

-- Independent from now on.
select pg_temp.as_boss();
select public.save_property_checklist(900001505,
  '[{"title": "Source module, rewritten", "items": [{"title": "Something else"}]}]'::jsonb);
reset role; reset request.jwt.claims;
select pg_temp.check('rewriting the source leaves the copy alone',
  (select m.title from public.checklist_modules m where m.property_id = 900001508), 'Source module');
select pg_temp.check('and keeps its items', pg_temp.item_count(900001508), 2);

-- Copying again replaces whatever the target had.
select pg_temp.as_boss();
select public.copy_property_checklist(900001505, 900001508);
reset role; reset request.jwt.claims;
select pg_temp.check('a second copy replaces the target checklist',
  (select m.title from public.checklist_modules m where m.property_id = 900001508),
  'Source module, rewritten');
select pg_temp.check('and does not add to it', pg_temp.item_count(900001508), 1);

do $$
begin
  perform pg_temp.as_boss();
  perform public.copy_property_checklist(900001504, 900001508);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a checklist was copied from a listing that has none';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a listing with no checklist of its own cannot be a source';
end $$;

do $$
begin
  perform pg_temp.as_boss();
  perform public.copy_property_checklist(900001505, 900001505);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a checklist was copied onto itself';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a listing cannot copy from itself';
end $$;

-- ---------- the snapshot a task takes ----------
select pg_temp.as_maria();
update public.tasks set status = 'in_progress' where id = (pg_temp.task(1)).id;
update public.tasks set status = 'in_progress' where id = (pg_temp.task(2)).id;
update public.tasks set status = 'in_progress' where id = (pg_temp.task(3)).id;
reset role; reset request.jwt.claims;

select pg_temp.check('a task on a listing with a checklist gets the step', pg_temp.step_count(1), 3);
select pg_temp.check('the step carries both modules',
  jsonb_array_length((pg_temp.step(1, 'checklist')).config->'modules'), 2);
select pg_temp.check('and the items of the first one',
  jsonb_array_length((pg_temp.step(1, 'checklist')).config->'modules'->0->'items'), 1);
select pg_temp.check('the step remembers where it came from',
  (pg_temp.step(1, 'checklist')).template_step_id,
  'c5000000-0000-4000-8000-000000000011'::uuid);
select pg_temp.check('a listing with no checklist gets no checklist step',
  (select count(*)::int from public.task_steps
   where task_id = (pg_temp.task(2)).id and type = 'checklist'), 0);
select pg_temp.check('and keeps the rest of the process', pg_temp.step_count(2), 2);
select pg_temp.check('a unit takes the checklist of its parent',
  (pg_temp.step(3, 'checklist')).config->'modules'->0->>'title', 'Whole flat');

-- The checklist moves on; the cleaning under way does not.
select pg_temp.as_boss();
select public.save_property_checklist(900001501,
  '[{"title": "Everything changed", "items": [{"title": "New item"}]}]'::jsonb);
reset role; reset request.jwt.claims;
select pg_temp.check('rewriting the checklist does not touch a task already started',
  jsonb_array_length((pg_temp.step(1, 'checklist')).config->'modules'), 2);
select pg_temp.check('the task still shows what it was started with',
  (pg_temp.step(1, 'checklist')).config->'modules'->1->>'title', 'Bathroom, renamed');

-- ---------- ticking the items ----------
--
-- The task's own snapshot is the authority, so the ids come out of the step's
-- config, not out of the tables the manager has just rewritten.
create or replace function pg_temp.snapshot_item(n integer, p_title text)
returns text language sql as $$
  select item.value->>'id'
  from public.task_steps s,
       jsonb_array_elements(s.config->'modules') as module,
       jsonb_array_elements(module.value->'items') as item
  where s.task_id = ('a5000001-0000-4000-8000-00000000000' || n)::uuid
    and s.type = 'checklist'
    and item.value->>'title' = p_title
$$;

do $$
declare
  v_hint    text;
  v_message text;
begin
  perform pg_temp.as_maria();
  perform public.complete_task_step((pg_temp.step(1, 'checklist')).id,
    jsonb_build_object('checked_item_ids',
      jsonb_build_array(pg_temp.snapshot_item(1, 'Mirror'))));
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a checklist was completed with required items left';
exception when check_violation then
  get stacked diagnostics v_hint = pg_exception_hint, v_message = message_text;
  reset role; reset request.jwt.claims;
  if v_hint is distinct from 'serverErrors.checklistItemsLeft' then
    raise exception 'FAIL the refusal does not name its translation key: %', v_hint;
  end if;
  -- The message itself is for the log, and stays English whoever is reading.
  if v_message !~ '^[[:ascii:]]+$' then
    raise exception 'FAIL the message is not English: %', v_message;
  end if;
  raise notice 'ok  a checklist with required items left over is refused, with a key';
end $$;

do $$
begin
  perform pg_temp.as_maria();
  perform public.complete_task_step((pg_temp.step(1, 'checklist')).id, '{}'::jsonb);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a checklist was completed with no answer at all';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a checklist step needs an answer';
end $$;

-- Every required item, one unknown id, one duplicate. The unknown id is
-- dropped rather than refused: an item deleted while the phone was offline
-- must not jam the queue.
select pg_temp.as_maria();
select public.complete_task_step((pg_temp.step(1, 'checklist')).id,
  jsonb_build_object('checked_item_ids', jsonb_build_array(
    pg_temp.snapshot_item(1, 'Stove'),
    pg_temp.snapshot_item(1, 'Mirror'),
    pg_temp.snapshot_item(1, 'Mirror'),
    pg_temp.snapshot_item(1, 'Towels'),
    pg_temp.snapshot_item(1, 'Floor'),
    '00000000-0000-4000-8000-000000000000'
  )));
reset role; reset request.jwt.claims;

select pg_temp.check('every required item ticked completes the step',
  (pg_temp.step(1, 'checklist')).completed_at is not null, true);
select pg_temp.check('the answer keeps one entry per item',
  jsonb_array_length((pg_temp.step(1, 'checklist')).payload->'checked_item_ids'), 4);
select pg_temp.check('an id that is not in the snapshot is dropped',
  (pg_temp.step(1, 'checklist')).payload->'checked_item_ids' @>
    '["00000000-0000-4000-8000-000000000000"]'::jsonb, false);
select pg_temp.check('the cleaner is recorded',
  (pg_temp.step(1, 'checklist')).completed_by,
  'd5000001-0000-4000-8000-0000000000d1'::uuid);

-- Replaying the same action from the offline queue changes nothing.
select pg_temp.as_maria();
select public.complete_task_step((pg_temp.step(1, 'checklist')).id,
  jsonb_build_object('checked_item_ids', jsonb_build_array(pg_temp.snapshot_item(1, 'Stove'))));
reset role; reset request.jwt.claims;
select pg_temp.check('replaying complete keeps the answer that was recorded',
  jsonb_array_length((pg_temp.step(1, 'checklist')).payload->'checked_item_ids'), 4);

-- An optional item may be left alone.
select pg_temp.as_maria();
select public.reopen_task_step((pg_temp.step(3, 'checklist')).id);
select public.complete_task_step((pg_temp.step(3, 'checklist')).id,
  jsonb_build_object('checked_item_ids',
    jsonb_build_array(pg_temp.snapshot_item(3, 'Hallway'))));
reset role; reset request.jwt.claims;
select pg_temp.check('a checklist with every required item ticked is done',
  (pg_temp.step(3, 'checklist')).completed_at is not null, true);

-- ---------- a required checklist holds the finish ----------
update public.workflow_steps set required = true
where id = 'c5000000-0000-4000-8000-000000000011';

select pg_temp.as_maria();
update public.tasks set status = 'in_progress' where id = (pg_temp.task(4)).id;
reset role; reset request.jwt.claims;
select pg_temp.check('the snapshot copies the requirement',
  (pg_temp.step(4, 'checklist')).required, true);

do $$
begin
  perform pg_temp.as_maria();
  update public.tasks set status = 'done' where id = (pg_temp.task(4)).id;
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a task finished with a required checklist open';
exception when check_violation then
  reset role; reset request.jwt.claims;
  raise notice 'ok  a required checklist holds the finish';
end $$;

select pg_temp.as_maria();
select public.complete_task_step((pg_temp.step(4, 'checklist')).id,
  jsonb_build_object('checked_item_ids', (
    select jsonb_agg(item.value->>'id')
    from public.task_steps s,
         jsonb_array_elements(s.config->'modules') as module,
         jsonb_array_elements(module.value->'items') as item
    where s.id = (pg_temp.step(4, 'checklist')).id
  )));
update public.tasks set status = 'done' where id = (pg_temp.task(4)).id;
reset role; reset request.jwt.claims;
select pg_temp.check('with the checklist done the task finishes',
  (pg_temp.task(4)).status::text, 'done');

-- ---------- who may read and write ----------
insert into public.checklist_modules (id, host_id, property_id, title, sort_order) values
  ('c5000000-0000-4000-8000-0000000000b1', 'b5000000-0000-4000-8000-00000000000b',
   900001509, 'B module', 1);
insert into public.checklist_items (host_id, module_id, title, sort_order) values
  ('b5000000-0000-4000-8000-00000000000b', 'c5000000-0000-4000-8000-0000000000b1',
   'B item', 1);

select pg_temp.as_maria();
select pg_temp.check('a cleaner reads the checklists of her own company',
  (select count(*)::int from public.checklist_modules where property_id = 900001501) > 0, true);
select pg_temp.check('and none of another company',
  (select count(*)::int from public.checklist_modules where property_id = 900001509), 0);
select pg_temp.check('the items of another company are invisible too',
  (select count(*)::int from public.checklist_items i
   where i.module_id = 'c5000000-0000-4000-8000-0000000000b1'), 0);
reset role; reset request.jwt.claims;

select pg_temp.check('nobody writes the tables directly',
  has_table_privilege('authenticated', 'public.checklist_modules', 'INSERT'), false);
select pg_temp.check('not the items either',
  has_table_privilege('authenticated', 'public.checklist_items', 'UPDATE'), false);
select pg_temp.check('anon reads nothing',
  has_table_privilege('anon', 'public.checklist_modules', 'SELECT'), false);
select pg_temp.check('anon cannot save a checklist',
  has_function_privilege('anon', 'public.save_property_checklist(bigint, jsonb)', 'execute'), false);
select pg_temp.check('anon cannot copy one',
  has_function_privilege('anon', 'public.copy_property_checklist(bigint, bigint)', 'execute'), false);
select pg_temp.check('a signed-in user may call save — the function checks the role itself',
  has_function_privilege('authenticated', 'public.save_property_checklist(bigint, jsonb)', 'execute'), true);
select pg_temp.check('the payload validator stays private',
  has_function_privilege('authenticated',
    'public.validate_task_step_payload(public.workflow_step_type, text, jsonb, jsonb)', 'execute'), false);

-- ---------- names in more than one language ----------
--
-- The manager writes a name in the company's own language and may add it in
-- the others; a language nobody translated falls back to what she wrote. The
-- app does the choosing (features/steps/schema.ts), so what the database owes
-- it is every language, in the snapshot as well as in the table.

select pg_temp.as_boss();
select public.save_property_checklist(900001510, $json$[
  {"title": "Bathroom",
   "title_i18n": {"ru": "Ванная", "cs": "Koupelna"},
   "items": [
     {"title": "Mirror", "title_i18n": {"ru": "Зеркало"}},
     {"title": "Towels"}
   ]}
]$json$::jsonb);
reset role; reset request.jwt.claims;

select pg_temp.check('a module keeps its translations',
  (select m.title_i18n->>'cs' from public.checklist_modules m
   where m.property_id = 900001510), 'Koupelna');
select pg_temp.check('an item keeps the languages it was given',
  (select i.title_i18n->>'ru' from public.checklist_items i
   join public.checklist_modules m on m.id = i.module_id
   where m.property_id = 900001510 and i.title = 'Mirror'), 'Зеркало');
select pg_temp.check('an item nobody translated has an empty bag, not null',
  (select i.title_i18n from public.checklist_items i
   join public.checklist_modules m on m.id = i.module_id
   where m.property_id = 900001510 and i.title = 'Towels'), '{}'::jsonb);

-- Saving again without mentioning translations keeps them: an editor that
-- knows nothing about languages must not wipe another one's work.
select pg_temp.as_boss();
select public.save_property_checklist(900001510, (
  select jsonb_build_array(jsonb_build_object(
    'id', (select m.id from public.checklist_modules m where m.property_id = 900001510),
    'title', 'Bathroom, renamed',
    'items', jsonb_build_array(
      jsonb_build_object('id', pg_temp.item(900001510, 'Mirror')::uuid, 'title', 'Mirror'),
      jsonb_build_object('id', pg_temp.item(900001510, 'Towels')::uuid, 'title', 'Towels'))))
));
reset role; reset request.jwt.claims;
select pg_temp.check('a save that says nothing about translations keeps them',
  (select m.title_i18n->>'ru' from public.checklist_modules m
   where m.property_id = 900001510), 'Ванная');
select pg_temp.check('and keeps the ones on an item it named by id',
  (select i.title_i18n->>'ru' from public.checklist_items i
   join public.checklist_modules m on m.id = i.module_id
   where m.property_id = 900001510 and i.title = 'Mirror'), 'Зеркало');

do $$
declare
  v_hint text;
begin
  perform pg_temp.as_boss();
  perform public.save_property_checklist(900001510,
    '[{"title": "X", "title_i18n": {"de": "Bad"}, "items": [{"title": "Y"}]}]'::jsonb);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL a translation was stored for a language the app cannot show';
exception when invalid_parameter_value then
  get stacked diagnostics v_hint = pg_exception_hint;
  reset role; reset request.jwt.claims;
  if v_hint is distinct from 'serverErrors.translationsInvalid' then
    raise exception 'FAIL the refusal does not name its translation key: %', v_hint;
  end if;
  raise notice 'ok  a language the app has no file for is refused';
end $$;

do $$
begin
  perform pg_temp.as_boss();
  perform public.save_property_checklist(900001510,
    '[{"title": "X", "title_i18n": {"ru": "  "}, "items": [{"title": "Y"}]}]'::jsonb);
  reset role; reset request.jwt.claims;
  raise exception 'FAIL an empty translation was stored';
exception when invalid_parameter_value then
  reset role; reset request.jwt.claims;
  raise notice 'ok  an empty translation is refused — it would read as a missing name';
end $$;

select pg_temp.check('the company says which language the plain titles are in',
  (select h.default_language::text from public.hosts h where h.id = public.default_host_id()),
  'ru');

-- Copying carries the languages across, and so does the snapshot a task takes.
select pg_temp.as_boss();
select public.copy_property_checklist(900001510, 900001511);
reset role; reset request.jwt.claims;
select pg_temp.check('a copied checklist keeps its translations',
  (select m.title_i18n->>'cs' from public.checklist_modules m
   where m.property_id = 900001511), 'Koupelna');

select pg_temp.as_maria();
update public.tasks set status = 'in_progress' where id = (pg_temp.task(5)).id;
reset role; reset request.jwt.claims;
select pg_temp.check('the snapshot carries every language of a module',
  (pg_temp.step(5, 'checklist')).config->'modules'->0->'title_i18n'->>'cs', 'Koupelna');
select pg_temp.check('and of an item',
  (pg_temp.step(5, 'checklist')).config->'modules'->0->'items'->0->'title_i18n'->>'ru',
  'Зеркало');
select pg_temp.check('an untranslated item still carries its bag',
  (pg_temp.step(5, 'checklist')).config->'modules'->0->'items'->1->>'title_i18n', '{}');

rollback;
