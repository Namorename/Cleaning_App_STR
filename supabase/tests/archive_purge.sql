-- Deleting for good from the archives (20261126150000).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected (owner, 2026-11-26):
-- - only an active admin deletes for good; a manager, the reception, a technician, the head
--   technician, a cleaner and a switched-off admin are refused with a key, and nothing goes;
-- - only what is in an archive: a live task, a live board and a card on its board are refused;
-- - another company's id is not found (false), and a repeat is harmless (false);
-- - an archived task goes with everything hanging on it — its repair, the repair's steps, media,
--   journal, closing, marks, take-off note, conversation and push rows; its own journal,
--   conversation, media, additions, themes, facts and marks — and nothing else of the company
--   changes but the links that point at it from outside, which become null (a supply request,
--   another task reported during the repair, a plan's step); the cleaning it was reported during
--   stays;
-- - the files of the deleted media rows stay in the bucket, queued for purge-task-media (a row
--   already purged queues nothing), until the purge removes them and the queue forgets them;
-- - an archived board goes whole (cards in any state, steps, journals, columns, transfers); an
--   archived or deleted card goes with its steps and journal; the rest of the boards stays.
--
-- Fixture ids live under ab26…, properties 900262601–2.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

-- The hint a statement is refused with, its answer as text, or the sqlstate.
create or replace function pg_temp.answer(statement text)
returns text language plpgsql as $$
declare
  v_hint text;
  v      text;
begin
  execute statement into v;
  return coalesce(v, 'null');
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return case when v_hint like 'serverErrors.%' then v_hint else sqlstate end;
end $$;

create or replace function pg_temp.host() returns uuid language sql immutable as $$
  select 'ab260000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.other_host() returns uuid language sql immutable as $$
  select 'ab260000-0000-4000-8000-00000000000b'::uuid $$;
create or replace function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('ab2600' || lpad(n::text, 2, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.ada()    returns uuid language sql immutable as $$ select pg_temp.uid(1) $$;
create or replace function pg_temp.boss()   returns uuid language sql immutable as $$ select pg_temp.uid(2) $$;
create or replace function pg_temp.rita()   returns uuid language sql immutable as $$ select pg_temp.uid(3) $$;
create or replace function pg_temp.tom()    returns uuid language sql immutable as $$ select pg_temp.uid(4) $$;
create or replace function pg_temp.anna()   returns uuid language sql immutable as $$ select pg_temp.uid(5) $$;
create or replace function pg_temp.hector() returns uuid language sql immutable as $$ select pg_temp.uid(6) $$;
create or replace function pg_temp.otto()   returns uuid language sql immutable as $$ select pg_temp.uid(7) $$;
create or replace function pg_temp.gone_admin() returns uuid language sql immutable as $$ select pg_temp.uid(8) $$;
-- Ids by kind: 1 problems, 2 tasks, 3 steps, 4 media, 5 threads, 6 messages, 7 additions,
-- 8 boards, 9 cards, a everything else.
create or replace function pg_temp.id(kind text, n integer) returns uuid language sql immutable as $$
  select ('ab26' || kind || '000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.as_user(person uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', '{"sub":"' || person || '","role":"authenticated"}', true) $$;
create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;

/** A delete for good by the person given: true, false, or the refusal's key. */
create or replace function pg_temp.purge(person uuid, fn text, target uuid) returns text
language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_user(person);
  v := pg_temp.answer(format('select public.%I(%L)::text', fn, target));
  perform pg_temp.as_server();
  return v;
end $$;

-- ---------- every row of the company, to see what goes and what changes ----------

create temp table snaps (label text, tbl text, key text, body jsonb);

create or replace function pg_temp.take(p_label text) returns void language plpgsql as $$
declare
  t text;
begin
  delete from snaps where label = p_label;
  foreach t in array array[
    'public.tasks', 'public.task_steps', 'public.task_media', 'public.task_events',
    'public.task_closings', 'public.closing_marks', 'public.task_off_notes', 'public.problems',
    'public.problem_events', 'public.problem_additions', 'public.issue_facts',
    'public.chat_threads', 'public.chat_messages', 'public.supply_requests',
    'public.resolution_plans', 'public.resolution_plan_steps', 'public.manager_boards',
    'public.manager_board_cards', 'public.manager_board_steps', 'public.manager_board_entries',
    'public.manager_board_columns', 'public.manager_board_transfers', 'raw.push_outbox']
  loop
    execute format(
      'insert into snaps select %L, %L, coalesce(to_jsonb(x) ->> ''id'', to_jsonb(x) ->> ''task_id''), to_jsonb(x)
       from %s x where x.host_id = %L', p_label, t, t, pg_temp.host());
  end loop;
  insert into snaps
  select p_label, 'public.problem_themes', x.problem_id || '/' || x.theme, to_jsonb(x)
  from public.problem_themes x join public.problems p on p.id = x.problem_id
  where p.host_id = pg_temp.host();
  insert into snaps
  select p_label, 'public.chat_reads', x.thread_id || '/' || x.profile_id, to_jsonb(x)
  from public.chat_reads x join public.chat_threads th on th.id = x.thread_id
  where th.host_id = pg_temp.host();
  insert into snaps
  select p_label, 'storage.objects', x.name, jsonb_build_object('name', x.name)
  from storage.objects x
  where x.bucket_id = 'task-media' and x.name like pg_temp.host() || '/%';
end $$;

-- The rows a delete is to take, by table: filled from a snapshot before it.
create temp table subtree (tbl text, key text);

/** Rows of snapshot a missing from snapshot b, by table — or of the subtree, when asked. */
create or replace function pg_temp.gone(a text, b text, in_subtree boolean) returns text language sql as $$
  select coalesce(string_agg(tbl || ' ' || n, ', ' order by tbl), '-')
  from (select x.tbl, count(*) n
        from snaps x
        where x.label = a
          and not exists (select 1 from snaps y where y.label = b and y.tbl = x.tbl and y.key = x.key)
          and exists (select 1 from subtree s where s.tbl = x.tbl and s.key = x.key) = in_subtree
        group by x.tbl) g $$;

create or replace function pg_temp.changed(a text, b text) returns text language sql as $$
  select coalesce(string_agg(x.tbl || ' ' || x.key, ', ' order by x.tbl, x.key), '-')
  from snaps x join snaps y on y.label = b and y.tbl = x.tbl and y.key = x.key
  where x.label = a and x.body <> y.body $$;

create or replace function pg_temp.added(a text, b text) returns bigint language sql as $$
  select count(*) from snaps y
  where y.label = b
    and not exists (select 1 from snaps x where x.label = a and x.tbl = y.tbl and x.key = y.key) $$;

-- ---------- fixtures ----------

insert into public.hosts (id, name) values
  (pg_temp.host(), 'Purge company'), (pg_temp.other_host(), 'Purge elsewhere');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
select pg_temp.uid(u.n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       lower(u.name) || '.purge1126@test.local', 'x', now(), now(),
       jsonb_build_object('full_name', u.name), jsonb_build_object('role', u.role)
from (values (1, 'Ada', 'admin'), (2, 'Boss', 'manager'), (3, 'Rita', 'reception'),
             (4, 'Tom', 'tech'), (5, 'Anna', 'cleaner'), (6, 'Hector', 'head_tech'),
             (7, 'Otto', 'admin'), (8, 'Gone', 'admin')) u(n, name, role);
update public.profiles
set host_id = case when id = pg_temp.otto() then pg_temp.other_host() else pg_temp.host() end
where id in (select pg_temp.uid(n) from generate_series(1, 8) n);
update public.profiles set is_active = false where id = pg_temp.gone_admin();

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900262601, pg_temp.host(), 'Purge flat', 'UTC', '15:00', '10:00'),
  (900262602, pg_temp.other_host(), 'Elsewhere flat', 'UTC', '15:00', '10:00');

-- The cleaning task 1 was reported during: it is not the task's, and it stays.
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date)
values (pg_temp.id('2', 1), pg_temp.host(), 900262601, 'cleaning', 'unassigned', current_date - 30);

-- Task 1, the one to delete; task 2, live; task 3, reported by the technician during task 1's
-- repair (it points at the repair from outside).
insert into public.problems (id, host_id, property_id, reported_by, title, status, task_id) values
  (pg_temp.id('1', 1), pg_temp.host(), 900262601, pg_temp.anna(), 'Purge leak', 'open', pg_temp.id('2', 1)),
  (pg_temp.id('1', 2), pg_temp.host(), 900262601, pg_temp.anna(), 'Live leak', 'open', null);

select pg_temp.as_user(pg_temp.boss());
select public.assign_problem(pg_temp.id('1', 1), pg_temp.tom(), current_date);
select public.assign_problem(pg_temp.id('1', 2), pg_temp.tom(), current_date);
select pg_temp.as_server();

-- The repair of task 1: the one assign_problem made, its id kept for the checks below.
create temp table fx as select t.id as repair from public.tasks t where t.problem_id = pg_temp.id('1', 1);
create or replace function pg_temp.repair() returns uuid language sql stable as $fn$ select repair from fx $fn$;

insert into public.problems (id, host_id, property_id, reported_by, title, status, task_id) values
  (pg_temp.id('1', 3), pg_temp.host(), 900262601, pg_temp.tom(), 'Found at the repair', 'open',
   pg_temp.repair());

-- The repair's step with a photo, its conversation with a photo, its journal, closing, mark and
-- take-off note.
insert into public.task_steps (id, task_id, host_id, sort_order, type, required)
values (pg_temp.id('3', 1), pg_temp.repair(), pg_temp.host(), 90, 'photos_before', false);
insert into public.chat_threads (id, host_id, kind, task_id) values
  (pg_temp.id('5', 1), pg_temp.host(), 'task', pg_temp.repair());
insert into public.chat_threads (id, host_id, kind, problem_id) values
  (pg_temp.id('5', 2), pg_temp.host(), 'problem', pg_temp.id('1', 1));
insert into public.chat_messages (id, host_id, thread_id, author_id, author_role, body) values
  (pg_temp.id('6', 1), pg_temp.host(), pg_temp.id('5', 1), pg_temp.tom(), 'tech', 'Synthetic note'),
  (pg_temp.id('6', 2), pg_temp.host(), pg_temp.id('5', 2), pg_temp.boss(), 'manager', 'Synthetic closing');
insert into public.chat_reads (thread_id, profile_id, last_read_at) values
  (pg_temp.id('5', 1), pg_temp.boss(), now()), (pg_temp.id('5', 2), pg_temp.tom(), now());
insert into public.task_events (host_id, task_id, kind) values (pg_temp.host(), pg_temp.repair(), 'started');
insert into public.task_closings (task_id, host_id) values (pg_temp.repair(), pg_temp.host());
insert into public.task_off_notes (host_id, task_id, kind, reason)
values (pg_temp.host(), pg_temp.repair(), 'interrupted', 'Synthetic reason');
insert into public.closing_marks (host_id, task_id, person_id, marked_by)
values (pg_temp.host(), pg_temp.repair(), pg_temp.tom(), pg_temp.boss());
-- Push rows of the repair and of its conversation, as the server queues them.
insert into raw.push_outbox (host_id, recipient_id, kind, task_id, thread_id, collapse_key, send_after, expire_at)
values (pg_temp.host(), pg_temp.tom(), 'cleaning_assigned', pg_temp.repair(), null,
        'task:' || pg_temp.repair(), now(), now() + interval '1 day'),
       (pg_temp.host(), pg_temp.boss(), 'chat_message', null, pg_temp.id('5', 1),
        'thread:' || pg_temp.id('5', 1), now(), now() + interval '1 day');

-- What hangs on task 1 itself: an addition with its file, a theme, a fact, a mark.
insert into public.problem_additions (id, host_id, problem_id, author_id, stage, message_id, published_at)
values (pg_temp.id('7', 1), pg_temp.host(), pg_temp.id('1', 1), pg_temp.boss(), 'closing',
        pg_temp.id('6', 2), now());
insert into public.problem_themes (problem_id, theme, source, detector)
values (pg_temp.id('1', 1), (select min(code) from public.issue_themes), 'manual', 'manual');
insert into public.issue_facts (host_id, property_id, theme, layer, month, origin, detector, problem_id)
values (pg_temp.host(), 900262601, (select min(code) from public.issue_themes), 'staff_report',
        date_trunc('month', current_date)::date, 'stream', 'purge-test', pg_temp.id('1', 1));
insert into public.closing_marks (host_id, problem_id, person_id, marked_by)
values (pg_temp.host(), pg_temp.id('1', 1), pg_temp.tom(), pg_temp.boss());

-- Five files: the step's, the repair conversation's, the report's, the addition's, and one of the
-- report's already purged. The first four are in the bucket; the purged one is not.
insert into public.task_media (id, host_id, task_id, step_id, problem_id, message_id, addition_id,
                               kind, storage_path, mime_type, byte_size, created_by, uploaded_at, purged_at)
select pg_temp.id('4', m.n), pg_temp.host(), m.task_id, m.step_id, m.problem_id, m.message_id,
       m.addition_id, 'photo', pg_temp.host() || '/purge/' || m.n || '.jpg', 'image/jpeg', 1000,
       pg_temp.boss(), now(), m.purged_at
from (values
  (1, pg_temp.repair(), pg_temp.id('3', 1), null::uuid, null::uuid, null::uuid, null::timestamptz),
  (2, null, null, null, pg_temp.id('6', 1), null, null),
  (3, null, null, pg_temp.id('1', 1), null, null, null),
  (4, null, null, null, null, pg_temp.id('7', 1), null),
  (5, null, null, pg_temp.id('1', 1), null, null, now() - interval '1 day')
) m(n, task_id, step_id, problem_id, message_id, addition_id, purged_at);
insert into storage.objects (bucket_id, name, owner, owner_id)
select 'task-media', m.storage_path, pg_temp.boss(), pg_temp.boss()::text
from public.task_media m where m.id in (select pg_temp.id('4', n) from generate_series(1, 4) n);
-- Task 2's file, live.
insert into public.task_media (id, host_id, problem_id, kind, storage_path, mime_type, byte_size, created_by)
values (pg_temp.id('4', 6), pg_temp.host(), pg_temp.id('1', 2), 'photo',
        pg_temp.host() || '/purge/6.jpg', 'image/jpeg', 1000, pg_temp.anna());

-- The links from outside: a supply request made during the repair, a plan's step on task 1.
insert into public.supply_requests (id, host_id, property_id, requested_by, task_id)
values (pg_temp.id('a', 1), pg_temp.host(), 900262601, pg_temp.tom(), pg_temp.repair());
insert into public.resolution_plans (id, host_id, property_id, title, created_by)
values (pg_temp.id('a', 2), pg_temp.host(), 900262601, 'Synthetic plan', pg_temp.boss());
insert into public.resolution_plan_steps (id, plan_id, host_id, theme, kind, title, sort_order, linked_problem_id)
values (pg_temp.id('a', 3), pg_temp.id('a', 2), pg_temp.host(), (select min(code) from public.issue_themes),
        'repair', 'Synthetic step', 1, pg_temp.id('1', 1));

-- Task 1 to the archive, as the panel does it (its repair is cancelled with it).
select pg_temp.as_user(pg_temp.boss());
select public.archive_problem(pg_temp.id('1', 1));
select pg_temp.as_server();

-- Another company's archived task.
insert into public.problems (id, host_id, property_id, reported_by, title, status, archived_at)
values (pg_temp.id('1', 4), pg_temp.other_host(), 900262602, pg_temp.otto(), 'Elsewhere', 'open', now());

-- Boards: 1 archived, whole (a card on it and one archived, steps, journals, a column of its
-- own, a transfer); 2 live, with an archived, a deleted and a live card; 3 archived, elsewhere.
insert into public.manager_boards (id, host_id, title, owner_id, shared) values
  (pg_temp.id('8', 1), pg_temp.host(), 'Old projects', pg_temp.boss(), true),
  (pg_temp.id('8', 2), pg_temp.host(), 'Projects', pg_temp.boss(), true),
  (pg_temp.id('8', 3), pg_temp.other_host(), 'Elsewhere', pg_temp.otto(), true);
insert into public.manager_board_columns (id, host_id, board_id, title, position, legacy_key, created_by)
values (pg_temp.id('a', 10), pg_temp.host(), pg_temp.id('8', 1), 'Waiting', 5, 'in_progress', pg_temp.boss());
insert into public.manager_board_cards (id, host_id, board_id, title, column_key, created_by,
                                        archived_at, deleted_at)
select pg_temp.id('9', c.n), c.host, pg_temp.id('8', c.board), 'Card ' || c.n, 'open', pg_temp.boss(),
       c.archived_at, c.deleted_at
from (values (1, 1, pg_temp.host(), null::timestamptz, null::timestamptz),
             (2, 1, pg_temp.host(), now(), null),
             (3, 2, pg_temp.host(), now(), null),
             (4, 2, pg_temp.host(), null, now()),
             (5, 2, pg_temp.host(), null, null),
             (6, 3, pg_temp.other_host(), now(), null)) c(n, board, host, archived_at, deleted_at);
insert into public.manager_board_steps (id, host_id, card_id, body, sort_order, created_by)
select pg_temp.id('a', 20 + n), case when n = 6 then pg_temp.other_host() else pg_temp.host() end,
       pg_temp.id('9', n), 'Step ' || n, 1, pg_temp.boss()
from generate_series(1, 6) n;
insert into public.manager_board_entries (id, host_id, card_id, kind, body, author_id)
select pg_temp.id('a', 30 + n), case when n = 6 then pg_temp.other_host() else pg_temp.host() end,
       pg_temp.id('9', n), 'comment', 'Comment ' || n, pg_temp.boss()
from generate_series(1, 6) n;
insert into public.manager_board_transfers (id, host_id, board_id, from_id, to_id, by_id)
values (pg_temp.id('a', 40), pg_temp.host(), pg_temp.id('8', 1), pg_temp.boss(), pg_temp.ada(), pg_temp.boss());
update public.manager_boards set archived_at = now(), archived_by = pg_temp.boss()
where id in (pg_temp.id('8', 1), pg_temp.id('8', 3));

select pg_temp.check('0 the fixtures: task 1 archived, its repair cancelled, task 2 live',
  (select string_agg(p.title || ':' || (p.archived_at is not null) || ':' ||
                     coalesce((select t.status::text from public.tasks t where t.problem_id = p.id), '-'),
                     ', ' order by p.id)
   from public.problems p where p.id in (pg_temp.id('1', 1), pg_temp.id('1', 2))),
  'Purge leak:true:cancelled, Live leak:false:assigned');

select pg_temp.take('start');

-- ===========================================================================
-- 1. Only an active admin
-- ===========================================================================

select pg_temp.check('1.1 nobody but an active admin deletes a task for good',
  (select string_agg(pg_temp.purge(p, 'delete_archived_problem', pg_temp.id('1', 1)), ' ' order by p)
   from unnest(array[pg_temp.boss(), pg_temp.rita(), pg_temp.tom(), pg_temp.anna(), pg_temp.hector(),
                     pg_temp.gone_admin()]) p),
  repeat('serverErrors.archivePurgeAdminOnly ', 5) || 'serverErrors.archivePurgeAdminOnly');
select pg_temp.check('1.2 nor a board',
  (select string_agg(pg_temp.purge(p, 'delete_archived_board', pg_temp.id('8', 1)), ' ' order by p)
   from unnest(array[pg_temp.boss(), pg_temp.rita(), pg_temp.tom(), pg_temp.anna(), pg_temp.hector(),
                     pg_temp.gone_admin()]) p),
  repeat('serverErrors.archivePurgeAdminOnly ', 5) || 'serverErrors.archivePurgeAdminOnly');
select pg_temp.check('1.3 nor a card',
  (select string_agg(pg_temp.purge(p, 'delete_shelved_board_card', pg_temp.id('9', 3)), ' ' order by p)
   from unnest(array[pg_temp.boss(), pg_temp.rita(), pg_temp.tom(), pg_temp.anna(), pg_temp.hector(),
                     pg_temp.gone_admin()]) p),
  repeat('serverErrors.archivePurgeAdminOnly ', 5) || 'serverErrors.archivePurgeAdminOnly');

select pg_temp.check('1.4 anon may not call them, the server''s role neither; a signed-in person may',
  (select string_agg(r || ':' || has_function_privilege(r, f, 'EXECUTE'), ' ' order by f, r)
   from unnest(array['public.delete_archived_problem(uuid)', 'public.delete_archived_board(uuid)',
                     'public.delete_shelved_board_card(uuid)']) f
   cross join unnest(array['anon', 'authenticated', 'service_role']) r),
  'anon:false authenticated:true service_role:false anon:false authenticated:true service_role:false '
  'anon:false authenticated:true service_role:false');
select pg_temp.check('1.5 the queue''s trigger is nobody''s to call',
  has_function_privilege('authenticated', 'public.queue_orphaned_media()', 'EXECUTE')
  or has_function_privilege('anon', 'public.queue_orphaned_media()', 'EXECUTE'), false);

-- ===========================================================================
-- 2. Only what is in an archive, only of the company
-- ===========================================================================

select pg_temp.check('2.1 a live task, a live board and a card on its board are refused',
  array[pg_temp.purge(pg_temp.ada(), 'delete_archived_problem', pg_temp.id('1', 2)),
        pg_temp.purge(pg_temp.ada(), 'delete_archived_board', pg_temp.id('8', 2)),
        pg_temp.purge(pg_temp.ada(), 'delete_shelved_board_card', pg_temp.id('9', 5)),
        pg_temp.purge(pg_temp.ada(), 'delete_shelved_board_card', pg_temp.id('9', 1))],
  array['serverErrors.problemNotArchived', 'serverErrors.boardNotArchived',
        'serverErrors.boardCardNotShelved', 'serverErrors.boardCardNotShelved']);
select pg_temp.check('2.2 another company''s archive is not found',
  array[pg_temp.purge(pg_temp.ada(), 'delete_archived_problem', pg_temp.id('1', 4)),
        pg_temp.purge(pg_temp.ada(), 'delete_archived_board', pg_temp.id('8', 3)),
        pg_temp.purge(pg_temp.ada(), 'delete_shelved_board_card', pg_temp.id('9', 6)),
        pg_temp.purge(pg_temp.otto(), 'delete_archived_problem', pg_temp.id('1', 1)),
        pg_temp.purge(pg_temp.otto(), 'delete_archived_board', pg_temp.id('8', 1)),
        pg_temp.purge(pg_temp.otto(), 'delete_shelved_board_card', pg_temp.id('9', 3))],
  array['false', 'false', 'false', 'false', 'false', 'false']);
select pg_temp.check('2.3 an id nobody has, and none at all, are not found',
  array[pg_temp.purge(pg_temp.ada(), 'delete_archived_problem', pg_temp.id('1', 99)),
        pg_temp.purge(pg_temp.ada(), 'delete_archived_board', null)],
  array['false', 'false']);
select pg_temp.check('2.4 the other company keeps its task, board and card',
  (select count(*) from public.problems where id = pg_temp.id('1', 4))
  + (select count(*) from public.manager_boards where id = pg_temp.id('8', 3))
  + (select count(*) from public.manager_board_cards where id = pg_temp.id('9', 6)), 3::bigint);

select pg_temp.take('refused');
select pg_temp.check('2.5 every refusal and every miss changed nothing of the company',
  pg_temp.gone('start', 'refused', false) || ' | ' || pg_temp.changed('start', 'refused')
  || ' | ' || pg_temp.added('start', 'refused'),
  '- | - | 0');

-- ===========================================================================
-- 3. An archived task, with everything on it
-- ===========================================================================

insert into subtree
select s.tbl, s.key
from snaps s
where s.label = 'refused'
  and ((s.tbl = 'public.problems' and s.body ->> 'id' = pg_temp.id('1', 1)::text)
    or (s.tbl = 'public.tasks' and s.body ->> 'id' = pg_temp.repair()::text)
    or (s.tbl in ('public.task_steps', 'public.task_events', 'public.task_closings', 'public.task_off_notes')
        and s.body ->> 'task_id' = pg_temp.repair()::text)
    or (s.tbl = 'public.closing_marks'
        and (s.body ->> 'task_id' = pg_temp.repair()::text or s.body ->> 'problem_id' = pg_temp.id('1', 1)::text))
    or (s.tbl in ('public.problem_events', 'public.problem_additions', 'public.issue_facts', 'public.problem_themes')
        and s.body ->> 'problem_id' = pg_temp.id('1', 1)::text)
    or (s.tbl = 'public.chat_threads' and s.body ->> 'id' in (pg_temp.id('5', 1)::text, pg_temp.id('5', 2)::text))
    or (s.tbl in ('public.chat_messages', 'public.chat_reads')
        and s.body ->> 'thread_id' in (pg_temp.id('5', 1)::text, pg_temp.id('5', 2)::text))
    or (s.tbl = 'public.task_media' and s.body ->> 'id' in (select pg_temp.id('4', n)::text from generate_series(1, 5) n))
    or (s.tbl = 'raw.push_outbox'
        and (s.body ->> 'task_id' = pg_temp.repair()::text
             or s.body ->> 'thread_id' in (pg_temp.id('5', 1)::text, pg_temp.id('5', 2)::text))));

select pg_temp.check('3.0 the fixtures reach every table that hangs on a task',
  (select string_agg(distinct tbl, ' ' order by tbl) from subtree),
  'public.chat_messages public.chat_reads public.chat_threads public.closing_marks public.issue_facts '
  'public.problem_additions public.problem_events public.problem_themes public.problems public.task_closings '
  'public.task_events public.task_media public.task_off_notes public.task_steps public.tasks raw.push_outbox');

select pg_temp.check('3.1 an admin deletes the archived task for good',
  pg_temp.purge(pg_temp.ada(), 'delete_archived_problem', pg_temp.id('1', 1)), 'true');

select pg_temp.take('task gone');
select pg_temp.check('3.2 every row hanging on it is gone',
  (select count(*) from subtree s
   where exists (select 1 from snaps y where y.label = 'task gone' and y.tbl = s.tbl and y.key = s.key)),
  0::bigint);
select pg_temp.check('3.3 and nothing else of the company is',
  pg_temp.gone('refused', 'task gone', false), '-');
select pg_temp.check('3.4 the links from outside became null, nothing else changed',
  pg_temp.changed('refused', 'task gone'),
  'public.problems ' || pg_temp.id('1', 3) || ', public.resolution_plan_steps ' || pg_temp.id('a', 3)
  || ', public.supply_requests ' || pg_temp.id('a', 1));
select pg_temp.check('3.5 they keep themselves: the request, the task found at the repair, the plan''s step',
  (select (task_id is null)::text from public.supply_requests where id = pg_temp.id('a', 1)) || ' '
  || (select (task_id is null)::text || ':' || status from public.problems where id = pg_temp.id('1', 3)) || ' '
  || (select (linked_problem_id is null)::text from public.resolution_plan_steps where id = pg_temp.id('a', 3)),
  'true true:open true');
select pg_temp.check('3.6 the cleaning it was reported during stays',
  (select count(*) from public.tasks where id = pg_temp.id('2', 1)), 1::bigint);
select pg_temp.check('3.7 nothing new was written', pg_temp.added('refused', 'task gone'), 0::bigint);
select pg_temp.check('3.8 a repeat is harmless',
  pg_temp.purge(pg_temp.ada(), 'delete_archived_problem', pg_temp.id('1', 1)), 'false');

-- ===========================================================================
-- 4. Its files: queued for the purge, not orphaned
-- ===========================================================================

select pg_temp.check('4.1 the four files not yet purged wait in the queue, the purged one does not',
  (select string_agg(right(q.id::text, 1) || ':' || q.storage_path, ' ' order by q.id)
   from raw.task_media_orphans q where q.host_id = pg_temp.host()),
  (select string_agg(n || ':' || pg_temp.host() || '/purge/' || n || '.jpg', ' ' order by n)
   from generate_series(1, 4) n));
select pg_temp.check('4.2 their files are still in the bucket (no client and no SQL deletes objects)',
  (select count(*) from storage.objects
   where bucket_id = 'task-media' and name like pg_temp.host() || '/purge/%'), 4::bigint);
select pg_temp.check('4.3 the queued row is the media row as it was',
  (select (r).kind::text || ' ' || (r).mime_type || ' ' || (r).byte_size || ' ' || ((r).step_id = pg_temp.id('3', 1))
   from (select jsonb_populate_record(null::public.task_media, q.media) r
         from raw.task_media_orphans q where q.id = pg_temp.id('4', 1)) x),
  'photo image/jpeg 1000 true');
select pg_temp.check('4.4 the purge''s list names them, path by path',
  (select string_agg(right(m.id::text, 1) || ':' || m.storage_path, ' ' order by m.id)
   from public.task_media_to_purge(10000) m where m.host_id = pg_temp.host()),
  (select string_agg(n || ':' || pg_temp.host() || '/purge/' || n || '.jpg', ' ' order by n)
   from generate_series(1, 4) n));

-- A line whose path a live row holds (it cannot happen: paths are unique) is never the purge's.
insert into raw.task_media_orphans (id, host_id, storage_path, media)
values (pg_temp.id('4', 9), pg_temp.host(), pg_temp.host() || '/purge/6.jpg',
        jsonb_build_object('id', pg_temp.id('4', 9), 'storage_path', pg_temp.host() || '/purge/6.jpg'));
select pg_temp.check('4.5 a path a live row holds is not offered',
  (select count(*) from public.task_media_to_purge(10000) m where m.storage_path = pg_temp.host() || '/purge/6.jpg'),
  0::bigint);
delete from raw.task_media_orphans where id = pg_temp.id('4', 9);

-- purge-task-media: removes the files (the Storage API), then marks what it removed.
select pg_temp.check('4.6 the purge settles them',
  public.mark_task_media_purged(array(select pg_temp.id('4', n) from generate_series(1, 4) n)), 4);
select pg_temp.check('4.7 and the queue forgets them',
  (select count(*) from raw.task_media_orphans where host_id = pg_temp.host()), 0::bigint);
select pg_temp.check('4.8 a second purge finds nothing of them',
  (select count(*) from public.task_media_to_purge(10000) m where m.host_id = pg_temp.host()
     and m.storage_path like pg_temp.host() || '/purge/%'), 0::bigint);
select pg_temp.check('4.9 task 2''s live file is not queued',
  (select count(*) from raw.task_media_orphans where storage_path = pg_temp.host() || '/purge/6.jpg'), 0::bigint);

-- ===========================================================================
-- 5. Boards and cards
-- ===========================================================================

delete from subtree;
select pg_temp.take('before boards');
insert into subtree
select s.tbl, s.key
from snaps s
where s.label = 'before boards'
  and ((s.tbl = 'public.manager_boards' and s.body ->> 'id' = pg_temp.id('8', 1)::text)
    or (s.tbl in ('public.manager_board_cards', 'public.manager_board_columns', 'public.manager_board_transfers')
        and s.body ->> 'board_id' = pg_temp.id('8', 1)::text)
    or (s.tbl = 'public.manager_board_cards' and s.body ->> 'id' in (pg_temp.id('9', 3)::text, pg_temp.id('9', 4)::text))
    or (s.tbl in ('public.manager_board_steps', 'public.manager_board_entries')
        and s.body ->> 'card_id' in (select pg_temp.id('9', n)::text from generate_series(1, 4) n)));

select pg_temp.check('5.0 the fixtures reach every table of a board',
  (select string_agg(tbl || ' ' || n, ', ' order by tbl)
   from (select tbl, count(*) n from subtree group by tbl) x),
  'public.manager_board_cards 4, public.manager_board_columns 5, public.manager_board_entries 4, '
  'public.manager_board_steps 4, public.manager_board_transfers 1, public.manager_boards 1');

select pg_temp.check('5.1 an admin deletes an archived card and a deleted one',
  array[pg_temp.purge(pg_temp.ada(), 'delete_shelved_board_card', pg_temp.id('9', 3)),
        pg_temp.purge(pg_temp.ada(), 'delete_shelved_board_card', pg_temp.id('9', 4))],
  array['true', 'true']);
select pg_temp.check('5.2 and the archived board, whole',
  pg_temp.purge(pg_temp.ada(), 'delete_archived_board', pg_temp.id('8', 1)), 'true');
select pg_temp.check('5.3 repeats are harmless',
  array[pg_temp.purge(pg_temp.ada(), 'delete_shelved_board_card', pg_temp.id('9', 3)),
        pg_temp.purge(pg_temp.ada(), 'delete_archived_board', pg_temp.id('8', 1)),
        pg_temp.purge(pg_temp.ada(), 'delete_shelved_board_card', pg_temp.id('9', 2))],
  array['false', 'false', 'false']);

select pg_temp.take('boards gone');
select pg_temp.check('5.4 every row of them is gone',
  (select count(*) from subtree s
   where exists (select 1 from snaps y where y.label = 'boards gone' and y.tbl = s.tbl and y.key = s.key)),
  0::bigint);
select pg_temp.check('5.5 and nothing else of the company changed',
  pg_temp.gone('before boards', 'boards gone', false) || ' | ' || pg_temp.changed('before boards', 'boards gone')
  || ' | ' || pg_temp.added('before boards', 'boards gone'),
  '- | - | 0');
select pg_temp.check('5.6 the live board keeps its live card, its step, its journal and its columns',
  (select count(*) from public.manager_board_cards where board_id = pg_temp.id('8', 2)) || ' '
  || (select count(*) from public.manager_board_steps where card_id = pg_temp.id('9', 5)) || ' '
  || (select count(*) from public.manager_board_entries where card_id = pg_temp.id('9', 5)) || ' '
  || (select count(*) from public.manager_board_columns where board_id = pg_temp.id('8', 2)),
  '1 1 1 4');

rollback;
