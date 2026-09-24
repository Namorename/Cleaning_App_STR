-- The conversation. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: what people say to each other about flats guests are
-- staying in. A thread is readable by whoever may read its SUBJECT and by
-- nobody else, a company never sees another company's word, and every line is
-- written through an idempotent RPC so a lost connection replays instead of
-- duplicating.
--
-- The audience is deliberately the subject's audience and not the assignee's.
-- A cleaner covers for a colleague without asking the office, and a manager
-- writing on an UNCLAIMED task must have a reader — otherwise the main case
-- the feature exists for has nobody in it.
--
-- Fixture ids live in the 9000020xx range.
begin;

insert into public.hosts (id, name) values
  ('c7000000-0000-4000-8000-00000000000c', 'Host C'),
  ('d7000000-0000-4000-8000-00000000000d', 'Host D');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('c7000001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.c@test.local','x',now(),now(),
   '{"full_name":"Boss C"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('c7000002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.c@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('c7000003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bara.c@test.local','x',now(),now(),
   '{"full_name":"Bara"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('c7000004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tomas.c@test.local','x',now(),now(),
   '{"full_name":"Tomas"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('c7000005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','gone.c@test.local','x',now(),now(),
   '{"full_name":"Gone"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('c7000006-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','petr.c@test.local','x',now(),now(),
   '{"full_name":"Petr"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('d7000001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.d@test.local','x',now(),now(),
   '{"full_name":"Anna D"}'::jsonb, '{"role":"cleaner"}'::jsonb);

update public.profiles set host_id = 'c7000000-0000-4000-8000-00000000000c'
where id in ('c7000001-0000-4000-8000-000000000001',
             'c7000002-0000-4000-8000-000000000002',
             'c7000003-0000-4000-8000-000000000003',
             'c7000004-0000-4000-8000-000000000004',
             'c7000005-0000-4000-8000-000000000005',
             'c7000006-0000-4000-8000-000000000006');
update public.profiles set host_id = 'd7000000-0000-4000-8000-00000000000d'
where id = 'd7000001-0000-4000-8000-000000000001';

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900002001, 'c7000000-0000-4000-8000-00000000000c', 'Anna flat', 'UTC', '15:00', '10:00'),
  (900002002, 'c7000000-0000-4000-8000-00000000000c', 'Other flat', 'UTC', '15:00', '10:00'),
  (900002003, 'd7000000-0000-4000-8000-00000000000d', 'Host D flat', 'UTC', '15:00', '10:00');

-- Anna works the first flat; Bara works the second. Neither is linked to the
-- other, which is what makes "a colleague's listing" testable.
insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('c7000000-0000-4000-8000-00000000000c', 900002001,
   'c7000002-0000-4000-8000-000000000002', 'claim'),
  ('c7000000-0000-4000-8000-00000000000c', 900002002,
   'c7000003-0000-4000-8000-000000000003', 'claim');

insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id, notes)
values
  -- Assigned to Anna, on her own listing.
  ('e7000001-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-00000000000c',
   900002001, 'cleaning', 'assigned', current_date, 'c7000002-0000-4000-8000-000000000002', 'annas'),
  -- Free, on Anna's listing: this is the one a manager writes on in advance.
  ('e7000001-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-00000000000c',
   900002001, 'cleaning', 'unassigned', current_date, null, 'free'),
  -- Beyond the horizon (seven days) — invisible to a cleaner, visible to the office.
  ('e7000001-0000-4000-8000-000000000003', 'c7000000-0000-4000-8000-00000000000c',
   900002001, 'cleaning', 'unassigned', current_date + 30, null, 'far'),
  -- A manual repair with no problem behind it: it keeps a thread of its own.
  ('e7000001-0000-4000-8000-000000000004', 'c7000000-0000-4000-8000-00000000000c',
   900002001, 'maintenance', 'assigned', current_date, 'c7000004-0000-4000-8000-000000000004', 'manual fix'),
  -- Another company's work.
  ('e7000001-0000-4000-8000-000000000009', 'd7000000-0000-4000-8000-00000000000d',
   900002003, 'cleaning', 'assigned', current_date, 'd7000001-0000-4000-8000-000000000001', 'theirs');

insert into public.problems (id, host_id, property_id, reported_by, title) values
  ('f7000001-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-00000000000c',
   900002001, 'c7000002-0000-4000-8000-000000000002', 'Tap leaks'),
  ('f7000001-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-00000000000c',
   900002002, 'c7000003-0000-4000-8000-000000000003', 'Window stuck');

-- The repair of the first problem, held by the technician.
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id, problem_id)
values ('e7000001-0000-4000-8000-000000000005', 'c7000000-0000-4000-8000-00000000000c',
        900002001, 'maintenance', 'assigned', current_date,
        'c7000004-0000-4000-8000-000000000004', 'f7000001-0000-4000-8000-000000000001');

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

create or replace function pg_temp.as_boss()  returns void language sql as $fn$
  select pg_temp.as_user('c7000001-0000-4000-8000-000000000001') $fn$;
create or replace function pg_temp.as_anna()  returns void language sql as $fn$
  select pg_temp.as_user('c7000002-0000-4000-8000-000000000002') $fn$;
create or replace function pg_temp.as_bara()  returns void language sql as $fn$
  select pg_temp.as_user('c7000003-0000-4000-8000-000000000003') $fn$;
create or replace function pg_temp.as_tomas() returns void language sql as $fn$
  select pg_temp.as_user('c7000004-0000-4000-8000-000000000004') $fn$;
create or replace function pg_temp.as_petr()  returns void language sql as $fn$
  select pg_temp.as_user('c7000006-0000-4000-8000-000000000006') $fn$;
create or replace function pg_temp.as_gone()  returns void language sql as $fn$
  select pg_temp.as_user('c7000005-0000-4000-8000-000000000005') $fn$;
create or replace function pg_temp.as_other_host() returns void language sql as $fn$
  select pg_temp.as_user('d7000001-0000-4000-8000-000000000001') $fn$;

/** The i18n key a refusal carries, or 'no refusal' when the statement went through. */
create or replace function pg_temp.refusal_hint(stmt text) returns text
language plpgsql as $fn$
declare v_hint text;
begin
  execute stmt;
  return 'no refusal';
exception when others then
  get stacked diagnostics v_hint = PG_EXCEPTION_HINT;
  return coalesce(v_hint, '(no hint)');
end $fn$;

/** The SQLSTATE a refusal carries, or 'no refusal' when the statement went through. */
create or replace function pg_temp.refusal_state(stmt text) returns text
language plpgsql as $fn$
begin
  execute stmt;
  return 'no refusal';
exception when others then
  return SQLSTATE;
end $fn$;

/** How many threads this caller can see at all. */
create or replace function pg_temp.threads_seen() returns integer language sql as $fn$
  select count(*)::int from public.chat_threads
$fn$;

/** How many messages this caller can see at all. */
create or replace function pg_temp.messages_seen() returns integer language sql as $fn$
  select count(*)::int from public.chat_messages
$fn$;

-- ---------------------------------------------------------------------------
--  Nothing is written by hand
-- ---------------------------------------------------------------------------

select pg_temp.as_anna();

-- 42501 is "insufficient privilege": the client role holds SELECT and nothing
-- else on all three tables, so the refusal happens before any policy is even
-- consulted. Everything a person says goes through send_message.
select pg_temp.check('a cleaner cannot insert a message directly',
  pg_temp.refusal_state($stmt$
    insert into public.chat_messages (id, thread_id, author_role, body)
    values (gen_random_uuid(), gen_random_uuid(), 'cleaner', 'smuggled')
  $stmt$), '42501');

select pg_temp.check('nor open a thread directly',
  pg_temp.refusal_state($stmt$
    insert into public.chat_threads (kind, task_id)
    values ('task', 'e7000001-0000-4000-8000-000000000001')
  $stmt$), '42501');

select pg_temp.check('nor move a read marker by hand',
  pg_temp.refusal_state($stmt$
    update public.chat_reads set last_read_at = now()
  $stmt$), '42501');

-- ---------------------------------------------------------------------------
--  A thread is about exactly one thing
-- ---------------------------------------------------------------------------

select pg_temp.check('a thread with no subject is refused',
  pg_temp.refusal_hint($stmt$ select public.open_thread() $stmt$),
  'serverErrors.threadSubjectInvalid');

select pg_temp.check('a thread with two subjects is refused',
  pg_temp.refusal_hint($stmt$
    select public.open_thread('e7000001-0000-4000-8000-000000000001',
                              'f7000001-0000-4000-8000-000000000001')
  $stmt$), 'serverErrors.threadSubjectInvalid');

-- ---------------------------------------------------------------------------
--  Saying something
-- ---------------------------------------------------------------------------

select pg_temp.as_boss();

select public.send_message(
  '17000001-0000-4000-8000-000000000001', 'Ключ в ящике 4325',
  'e7000001-0000-4000-8000-000000000001');

select pg_temp.check('the message carries the author name as it was',
  (select author_name from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000001'), 'Boss C');

select pg_temp.check('and the role as it was',
  (select author_role::text from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000001'), 'manager');

select pg_temp.check('the thread counted it',
  (select message_count from public.chat_threads th
    where th.task_id = 'e7000001-0000-4000-8000-000000000001'), 1);

-- A replay after a lost connection is the same row, not a second one.
select public.send_message(
  '17000001-0000-4000-8000-000000000001', 'Ключ в ящике 4325',
  'e7000001-0000-4000-8000-000000000001');

select pg_temp.check('a replay does not say it twice',
  (select message_count from public.chat_threads th
    where th.task_id = 'e7000001-0000-4000-8000-000000000001'), 1);

select pg_temp.check('an empty message is refused',
  pg_temp.refusal_hint($stmt$
    select public.send_message('17000001-0000-4000-8000-00000000000e', '   ',
                               'e7000001-0000-4000-8000-000000000001')
  $stmt$), 'serverErrors.messageEmpty');

select pg_temp.check('more photos than allowed is refused',
  pg_temp.refusal_hint($stmt$
    select public.send_message('17000001-0000-4000-8000-00000000000f', '',
                               'e7000001-0000-4000-8000-000000000001',
                               null, null, 9::smallint)
  $stmt$), 'serverErrors.messagePhotoLimit');

-- A message with no words but declared photos is legal: the row comes first
-- and the files follow, exactly as a problem report's photos do.
select public.send_message('17000001-0000-4000-8000-000000000002', '',
                           'e7000001-0000-4000-8000-000000000001',
                           null, null, 2::smallint);

select pg_temp.check('a photo-only message is allowed when it says so',
  (select media_expected from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000002'), 2::smallint);

-- ---------------------------------------------------------------------------
--  Who reads a work thread
-- ---------------------------------------------------------------------------

select pg_temp.as_anna();

select pg_temp.check('the assignee reads what the office wrote on her task',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000001'), 1);

select pg_temp.as_bara();

select pg_temp.check('a cleaner of another listing does not',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000001'), 0);

-- The case the wide audience exists for: the office writes on work nobody has
-- taken, and whoever COULD take it is the one who has to read it.
select pg_temp.as_boss();
select public.send_message('17000001-0000-4000-8000-000000000003',
                           'Сантехник придёт в 14:00',
                           'e7000001-0000-4000-8000-000000000002');

select pg_temp.as_anna();
select pg_temp.check('a note left on free work has a reader before it is taken',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000003'), 1);

select pg_temp.as_bara();
select pg_temp.check('and only among those who could take it',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000003'), 0);

-- The horizon hides the far future from the field and not from the office.
select pg_temp.as_boss();
select public.send_message('17000001-0000-4000-8000-000000000004', 'Через месяц',
                           'e7000001-0000-4000-8000-000000000003');

select pg_temp.as_anna();
select pg_temp.check('work past the horizon keeps its conversation out of sight',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000004'), 0);

select pg_temp.as_boss();
select pg_temp.check('while the office reads it',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000004'), 1);

-- ---------------------------------------------------------------------------
--  The breakage and its repair share one conversation
-- ---------------------------------------------------------------------------

select pg_temp.as_anna();
select public.send_message('17000001-0000-4000-8000-000000000005',
                           'Капает под мойкой',
                           null, 'f7000001-0000-4000-8000-000000000001');

-- The technician opens HIS task and must land in the report's thread, with
-- what the cleaner already said waiting in it.
select pg_temp.as_tomas();

select pg_temp.check('the repair draws the breakage''s thread, not one of its own',
  (select (public.open_thread('e7000001-0000-4000-8000-000000000005')).problem_id),
  'f7000001-0000-4000-8000-000000000001'::uuid);

select pg_temp.check('and the technician reads what she wrote there',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000005'), 1);

-- A repair with no breakage behind it keeps a thread of its own.
select pg_temp.check('a manual repair has a thread of its own',
  (select (public.open_thread('e7000001-0000-4000-8000-000000000004')).task_id),
  'e7000001-0000-4000-8000-000000000004'::uuid);

-- A cancelled attempt must not take the conversation with it.
reset role; reset request.jwt.claims;
update public.tasks set status = 'cancelled', assignee_id = null
where id = 'e7000001-0000-4000-8000-000000000005';
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id, problem_id)
values ('e7000001-0000-4000-8000-000000000006', 'c7000000-0000-4000-8000-00000000000c',
        900002001, 'maintenance', 'assigned', current_date,
        'c7000006-0000-4000-8000-000000000006', 'f7000001-0000-4000-8000-000000000001');

select pg_temp.as_petr();
select pg_temp.check('the second technician arrives in the same conversation',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000005'), 1);

-- And the first one leaves it. A cancelled attempt is not a membership card:
-- without this he would keep reading — and, now that there is a chat, writing —
-- for ever. The report itself goes with it (20260918110000).
select pg_temp.as_tomas();
select pg_temp.check('the technician taken off the job loses the conversation',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000005'), 0);
select pg_temp.check('and the report it hangs off',
  (select count(*)::int from public.problems
    where id = 'f7000001-0000-4000-8000-000000000001'), 0);
select pg_temp.check('nor can he say anything more in it',
  pg_temp.refusal_hint($stmt$
    select public.send_message('17000001-0000-4000-8000-00000000000b', 'ещё раз',
                               null, 'f7000001-0000-4000-8000-000000000001')
  $stmt$), 'serverErrors.threadNotFound');

select pg_temp.as_bara();
select pg_temp.check('another cleaner does not read the breakage thread',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000005'), 0);

-- Archiving a report takes it away from its reporter, and the conversation
-- goes with it: the thread is readable through the subject and nothing else.
reset role; reset request.jwt.claims;
update public.problems set archived_at = now()
where id = 'f7000001-0000-4000-8000-000000000001';

select pg_temp.as_anna();
select pg_temp.check('an archived report takes its conversation from the reporter',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000005'), 0);

reset role; reset request.jwt.claims;
update public.problems set archived_at = null
where id = 'f7000001-0000-4000-8000-000000000001';

-- ---------------------------------------------------------------------------
--  The company inbox
-- ---------------------------------------------------------------------------

select pg_temp.as_anna();
select public.send_message('17000001-0000-4000-8000-000000000006',
                           'Заболела, не выйду',
                           null, null, 'c7000002-0000-4000-8000-000000000002');

select pg_temp.check('a cleaner has exactly one direct thread',
  (select count(*)::int from public.chat_threads
    where profile_id = 'c7000002-0000-4000-8000-000000000002'), 1);

select pg_temp.as_bara();
select pg_temp.check('and a colleague cannot read it',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000006'), 0);

select pg_temp.check('nor write into it',
  pg_temp.refusal_hint($stmt$
    select public.send_message('17000001-0000-4000-8000-00000000000a', 'подслушала',
                               null, null, 'c7000002-0000-4000-8000-000000000002')
  $stmt$), 'serverErrors.threadNotFound');

-- The counterpart is the office, not a person: any manager of the host reads
-- it and answers in it, so a holiday loses nothing.
select pg_temp.as_boss();
select pg_temp.check('the office reads it',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000006'), 1);

select public.send_message('17000001-0000-4000-8000-000000000007', 'Поняла, выздоравливай',
                           null, null, 'c7000002-0000-4000-8000-000000000002');

select pg_temp.check('and answers in the same one',
  (select count(*)::int from public.chat_threads
    where profile_id = 'c7000002-0000-4000-8000-000000000002'), 1);

-- ---------------------------------------------------------------------------
--  Unread is a marker on the reader
-- ---------------------------------------------------------------------------

-- Sending is reading: without this the sequence me -> her -> me loses her
-- message behind my own, because the last author is me again.
select pg_temp.check('sending moves my own marker',
  (select last_read_at is not null from public.chat_reads
    where profile_id = 'c7000001-0000-4000-8000-000000000001'
      and thread_id = (select id from public.chat_threads
                        where profile_id = 'c7000002-0000-4000-8000-000000000002')),
  true);

select pg_temp.as_anna();

select pg_temp.check('the marker does not walk backwards',
  (select (public.mark_thread_read(
             (select id from public.chat_threads
               where profile_id = 'c7000002-0000-4000-8000-000000000002'),
             timestamptz '2000-01-01')).last_read_at
          > timestamptz '2001-01-01'), true);

select pg_temp.check('and cannot be set into the future',
  (select (public.mark_thread_read(
             (select id from public.chat_threads
               where profile_id = 'c7000002-0000-4000-8000-000000000002'),
             now() + interval '1 day')).last_read_at <= now()), true);

select pg_temp.as_bara();
select pg_temp.check('a thread she does not take part in cannot be marked read',
  pg_temp.refusal_hint($stmt$
    select public.mark_thread_read(
      (select th.id from public.chat_threads th
        where th.profile_id = 'c7000002-0000-4000-8000-000000000002'))
  $stmt$), 'serverErrors.threadNotFound');

select pg_temp.as_anna();
select pg_temp.check('a cleaner reads her own marker and no one else''s',
  (select count(*)::int from public.chat_reads
    where profile_id <> 'c7000002-0000-4000-8000-000000000002'), 0);

-- ---------------------------------------------------------------------------
--  What is unread (layer 4)
-- ---------------------------------------------------------------------------

-- The tail is newer than my marker and the last word was not mine. The office
-- wrote on Anna's task and on the free one; Anna herself spoke last on the
-- breakage; her marker on the inbox was just moved to now() above.
create or replace function pg_temp.unread_task(task uuid, ids uuid[] default null) returns boolean
language sql as $fn$
  select exists (select 1 from public.chat_unread_threads(ids, null) u where u.task_id = task)
$fn$;
create or replace function pg_temp.unread_problem(problem uuid) returns boolean
language sql as $fn$
  select exists (select 1 from public.chat_unread_threads() u where u.problem_id = problem)
$fn$;

select pg_temp.as_anna();

select pg_temp.check('what the office wrote on her task is unread',
  pg_temp.unread_task('e7000001-0000-4000-8000-000000000001'), true);
select pg_temp.check('and the note on the free work she could take',
  pg_temp.unread_task('e7000001-0000-4000-8000-000000000002'), true);
select pg_temp.check('her own last word is not unread to her',
  pg_temp.unread_problem('f7000001-0000-4000-8000-000000000001'), false);
select pg_temp.check('an inbox she has just read is quiet',
  (select count(*)::int from public.chat_unread_threads() u where u.kind = 'direct'), 0);

-- The phone asks for the ids on its screen; a subject it names but may not
-- read is not in the answer, and an empty list is an empty answer.
select pg_temp.check('asked about her screen, the answer is limited to it',
  (select count(*)::int from public.chat_unread_threads(
     array['e7000001-0000-4000-8000-000000000001']::uuid[], null)), 1);
select pg_temp.check('work past the horizon is not unread even when asked for by id',
  pg_temp.unread_task('e7000001-0000-4000-8000-000000000003',
                      array['e7000001-0000-4000-8000-000000000002',
                            'e7000001-0000-4000-8000-000000000003']::uuid[]), false);
select pg_temp.check('an empty screen has nothing unread on it',
  (select count(*)::int from public.chat_unread_threads(array[]::uuid[], array[]::uuid[])), 0);

-- Reading up to the tail makes it quiet; reading up to an older message does not.
select public.mark_thread_read(
  (select id from public.chat_threads where task_id = 'e7000001-0000-4000-8000-000000000001'),
  (select max(created_at) from public.chat_messages
    where thread_id = (select id from public.chat_threads
                        where task_id = 'e7000001-0000-4000-8000-000000000001')));
select pg_temp.check('read to the tail, the task is quiet',
  pg_temp.unread_task('e7000001-0000-4000-8000-000000000001'), false);
select pg_temp.check('while the free work still waits',
  pg_temp.unread_task('e7000001-0000-4000-8000-000000000002'), true);

-- A deleted author leaves the tail with no name (`on delete set null`); the
-- word is still unread. `is distinct from`, not `<>`, is what keeps it so.
reset role; reset request.jwt.claims;
update public.chat_threads set last_author_id = null
where task_id = 'e7000001-0000-4000-8000-000000000002';
select pg_temp.as_anna();
select pg_temp.check('a message whose author is gone is still unread',
  pg_temp.unread_task('e7000001-0000-4000-8000-000000000002'), true);

select pg_temp.as_bara();
select pg_temp.check('a colleague of another listing has nothing unread there',
  pg_temp.unread_task('e7000001-0000-4000-8000-000000000002'), false);

-- The manager's short cut stays inside the company: a thread of the other
-- host's work, inserted by hand, is not the office's to see.
reset role; reset request.jwt.claims;
insert into public.chat_threads (host_id, kind, task_id, last_message_at, last_author_id, message_count)
values ('d7000000-0000-4000-8000-00000000000d', 'task', 'e7000001-0000-4000-8000-000000000009',
        now(), 'd7000001-0000-4000-8000-000000000001', 1);
select pg_temp.as_boss();
select pg_temp.check('the office never sees another company''s unread work',
  pg_temp.unread_task('e7000001-0000-4000-8000-000000000009'), false);
-- Taken out again: the other company's checks below expect its cupboard bare.
reset role; reset request.jwt.claims;
delete from public.chat_threads where task_id = 'e7000001-0000-4000-8000-000000000009';

-- The office asks without ids and gets the whole company: what Anna said on
-- the breakage, not what the office itself said last.
select pg_temp.as_boss();
select pg_temp.check('the office sees the breakage Anna wrote on',
  pg_temp.unread_problem('f7000001-0000-4000-8000-000000000001'), true);
select pg_temp.check('but not the task where the office spoke last',
  pg_temp.unread_task('e7000001-0000-4000-8000-000000000001'), false);
select pg_temp.check('nor the inbox it answered',
  (select count(*)::int from public.chat_unread_threads() u where u.kind = 'direct'), 0);

-- The office takes no short cut on an inbox: its subject must still be field
-- staff. Somebody promoted out of the field takes her inbox out of reach,
-- exactly as the policies would have it.
-- Inside one transaction every row is stamped with the same now(), so a new
-- message cannot outrun a marker; the tail is set by hand instead: Anna spoke
-- last, and the office's marker sits an hour behind.
reset role; reset request.jwt.claims;
update public.chat_threads set last_author_id = 'c7000002-0000-4000-8000-000000000002'
where profile_id = 'c7000002-0000-4000-8000-000000000002';
update public.chat_reads set last_read_at = last_read_at - interval '1 hour'
where profile_id = 'c7000001-0000-4000-8000-000000000001'
  and thread_id = (select id from public.chat_threads
                    where profile_id = 'c7000002-0000-4000-8000-000000000002');
select pg_temp.as_boss();
select pg_temp.check('with the marker behind the tail the inbox is unread for the office',
  (select count(*)::int from public.chat_unread_threads() u where u.kind = 'direct'), 1);

reset role; reset request.jwt.claims;
update public.profiles set role = 'manager' where id = 'c7000002-0000-4000-8000-000000000002';
select pg_temp.as_boss();
select pg_temp.check('an inbox whose owner was promoted is nobody''s to read, the office included',
  (select count(*)::int from public.chat_unread_threads() u where u.kind = 'direct'), 0);
reset role; reset request.jwt.claims;
update public.profiles set role = 'cleaner' where id = 'c7000002-0000-4000-8000-000000000002';

-- ---------------------------------------------------------------------------
--  The edge of the company, and of employment
-- ---------------------------------------------------------------------------

select pg_temp.as_other_host();

select pg_temp.check('another company sees no threads at all', pg_temp.threads_seen(), 0);
select pg_temp.check('nor anything unread',
  (select count(*)::int from public.chat_unread_threads()), 0);
select pg_temp.check('nor any message',                        pg_temp.messages_seen(), 0);
select pg_temp.check('nor any read marker',
  (select count(*)::int from public.chat_reads), 0);

select pg_temp.check('and cannot open a thread on our work',
  pg_temp.refusal_hint($stmt$
    select public.open_thread('e7000001-0000-4000-8000-000000000001')
  $stmt$), 'serverErrors.threadNotFound');

-- The office talks to the people who go to the flats. A thread whose subject
-- were a manager would be read by every OTHER manager of the host, which is a
-- group chat and not an inbox; manager to manager is out of scope.
select pg_temp.as_boss();
select pg_temp.check('the inbox is for field staff, not for the office itself',
  pg_temp.refusal_hint($stmt$
    select public.open_thread(null, null, 'c7000001-0000-4000-8000-000000000001')
  $stmt$), 'serverErrors.threadNotFound');

-- A repair scheduled past the horizon is hidden from its own assignee by the
-- task policies, and the problems policy inherits that through its exists().
-- The predicate is a definer and would see the hidden row unless it says so.
reset role; reset request.jwt.claims;
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id, problem_id)
values ('e7000001-0000-4000-8000-000000000007', 'c7000000-0000-4000-8000-00000000000c',
        900002002, 'maintenance', 'assigned', current_date + 30,
        'c7000004-0000-4000-8000-000000000004', 'f7000001-0000-4000-8000-000000000002');

select pg_temp.as_tomas();
select pg_temp.check('a repair past the horizon carries no conversation either',
  public.chat_participates('problem', null, 'f7000001-0000-4000-8000-000000000002', null),
  false);

-- An unknown kind, or a caller with no active profile, must answer NO. `if not
-- <null>` does not fire, so a null here would walk straight through the gates.
select pg_temp.check('the predicate never answers null',
  public.chat_participates('task', null, null, null), false);

-- Dismissing somebody must not delete the company's own record of what was
-- said to her. She loses the inbox; the office keeps it.
select pg_temp.as_gone();
select public.send_message('17000001-0000-4000-8000-000000000008', 'Ухожу',
                           null, null, 'c7000005-0000-4000-8000-000000000005');

reset role; reset request.jwt.claims;
update public.profiles set is_active = false
where id = 'c7000005-0000-4000-8000-000000000005';

select pg_temp.as_gone();
select pg_temp.check('somebody no longer employed sees nothing', pg_temp.threads_seen(), 0);
select pg_temp.check('and has nothing unread',
  (select count(*)::int from public.chat_unread_threads()), 0);

-- The short cut for managers is gated by the same is_active as everything
-- else: a dismissed manager whose token is still valid gets nothing.
reset role; reset request.jwt.claims;
update public.profiles set is_active = false
where id = 'c7000001-0000-4000-8000-000000000001';
select pg_temp.as_boss();
select pg_temp.check('a dismissed manager has nothing unread either',
  (select count(*)::int from public.chat_unread_threads()), 0);
reset role; reset request.jwt.claims;
update public.profiles set is_active = true
where id = 'c7000001-0000-4000-8000-000000000001';

select pg_temp.as_boss();
select pg_temp.check('but the office keeps her inbox',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000008'), 1);

-- ---------------------------------------------------------------------------
--  Photos in a message (layer 5)
-- ---------------------------------------------------------------------------
--
-- Message ...02 was sent by the office on Anna's task with two photos declared
-- and no words. Its thread is the unit the path is built on.

create or replace function pg_temp.task_thread() returns uuid language sql as $fn$
  select id from public.chat_threads where task_id = 'e7000001-0000-4000-8000-000000000001' $fn$;

-- Only the author registers a photo on a message: Anna reads it, but it is
-- not hers to complete.
select pg_temp.as_anna();
select pg_temp.check('a reader who is not the author cannot attach a photo',
  pg_temp.refusal_hint($stmt$
    select public.add_message_media('27000001-0000-4000-8000-000000000001',
      '17000001-0000-4000-8000-000000000002', 'image/jpeg', 500000, 1600, 1200)
  $stmt$), 'serverErrors.messageNotFound');

select pg_temp.as_boss();
select public.add_message_media('27000001-0000-4000-8000-000000000001',
  '17000001-0000-4000-8000-000000000002', 'image/jpeg', 500000, 1600, 1200, now(), 'gallery');

select pg_temp.check('the photo is registered on the message',
  (select message_id from public.task_media where id = '27000001-0000-4000-8000-000000000001'),
  '17000001-0000-4000-8000-000000000002'::uuid);
select pg_temp.check('with no other owner',
  (select task_id is null and step_id is null and problem_id is null
     from public.task_media where id = '27000001-0000-4000-8000-000000000001'), true);
select pg_temp.check('under host/chat/thread/id.ext',
  (select storage_path from public.task_media where id = '27000001-0000-4000-8000-000000000001'),
  'c7000000-0000-4000-8000-00000000000c/chat/' || pg_temp.task_thread()::text
    || '/27000001-0000-4000-8000-000000000001.jpg');
select pg_temp.check('the gallery is not refused in a conversation',
  (select source::text from public.task_media where id = '27000001-0000-4000-8000-000000000001'),
  'gallery');

-- A replay is the same row, not a second one.
select public.add_message_media('27000001-0000-4000-8000-000000000001',
  '17000001-0000-4000-8000-000000000002', 'image/jpeg', 500000, 1600, 1200);
select pg_temp.check('a replay does not register a second photo',
  (select count(*)::int from public.task_media
    where message_id = '17000001-0000-4000-8000-000000000002'), 1);

select pg_temp.check('a video is refused in a message',
  pg_temp.refusal_hint($stmt$
    select public.add_message_media('27000001-0000-4000-8000-000000000009',
      '17000001-0000-4000-8000-000000000002', 'video/mp4', 500000)
  $stmt$), 'serverErrors.mediaTypeInvalid');

select public.add_message_media('27000001-0000-4000-8000-000000000002',
  '17000001-0000-4000-8000-000000000002', 'image/jpeg', 400000, 1600, 1200);
select pg_temp.check('the message declared two photos and takes no third',
  pg_temp.refusal_hint($stmt$
    select public.add_message_media('27000001-0000-4000-8000-000000000003',
      '17000001-0000-4000-8000-000000000002', 'image/jpeg', 400000, 1600, 1200)
  $stmt$), 'serverErrors.messagePhotoLimit');

-- Message ...01 said nothing about photos, so it takes none: a picture the
-- row did not announce is a picture nobody asked for.
select pg_temp.check('a message that declared no photos takes none',
  pg_temp.refusal_hint($stmt$
    select public.add_message_media('27000001-0000-4000-8000-000000000004',
      '17000001-0000-4000-8000-000000000001', 'image/jpeg', 400000, 1600, 1200)
  $stmt$), 'serverErrors.messagePhotoLimit');

-- The file goes onto the path the row is waiting for, by the author.
insert into storage.objects (bucket_id, name, owner, owner_id)
select 'task-media', m.storage_path, m.created_by, m.created_by::text
from public.task_media m where m.id = '27000001-0000-4000-8000-000000000001';
select public.confirm_task_media('27000001-0000-4000-8000-000000000001');
select pg_temp.check('the author uploads and confirms',
  (select uploaded_at is not null from public.task_media
    where id = '27000001-0000-4000-8000-000000000001'), true);

-- Who reads the message reads its photos -- and its file.
select pg_temp.as_anna();
select pg_temp.check('the assignee sees the photos of the message she reads',
  (select count(*)::int from public.task_media
    where message_id = '17000001-0000-4000-8000-000000000002'), 2);
select pg_temp.check('and may read the file',
  public.can_read_task_media('c7000000-0000-4000-8000-00000000000c/chat/'
    || pg_temp.task_thread()::text || '/27000001-0000-4000-8000-000000000001.jpg'), true);

select pg_temp.as_bara();
select pg_temp.check('a cleaner of another listing sees no photos',
  (select count(*)::int from public.task_media
    where message_id = '17000001-0000-4000-8000-000000000002'), 0);
select pg_temp.check('and may not read the file',
  public.can_read_task_media('c7000000-0000-4000-8000-00000000000c/chat/'
    || pg_temp.task_thread()::text || '/27000001-0000-4000-8000-000000000001.jpg'), false);

select pg_temp.as_other_host();
select pg_temp.check('another company sees no photos',
  (select count(*)::int from public.task_media
    where message_id = '17000001-0000-4000-8000-000000000002'), 0);

-- The name of the chat policy buys the order of the branches, and nothing in
-- Postgres promises it (see 20260924100000_chat_media.sql). Permissive
-- policies are folded into one OR whose branches come out ordered by policy
-- name, descending, so "chat message ..." sits behind "managers read all task
-- media" and a manager reading a thread stops at the cheap branch instead of
-- running the EXISTS over chat_messages. If an upgrade ever takes that away,
-- every read stays correct and merely gets dearer -- which is exactly why it
-- has to be a test and not a measurement somebody remembers to repeat.
reset role; reset request.jwt.claims;
create or replace function pg_temp.media_policy_filter(p_task uuid) returns text
language plpgsql as $fn$
declare
  v_line text;
begin
  -- The outermost Filter is the first one printed that carries is_manager():
  -- the branches of the policy OR live there, the SubPlans come after it.
  for v_line in
    execute 'explain (costs off) select id from public.task_media where task_id = $1'
    using p_task
  loop
    if v_line like '%Filter:%' and v_line like '%is_manager()%' then
      return v_line;
    end if;
  end loop;
  return null;
end $fn$;

select pg_temp.as_boss();
select pg_temp.check('the policy OR shows both branches on one Filter',
  (select f is not null and strpos(f, 'message_id IS NOT NULL') > 0
     from (select pg_temp.media_policy_filter('e7000001-0000-4000-8000-000000000001') as f) plan),
  true);
select pg_temp.check('and is_manager() is taken before the chat branch',
  (select strpos(f, 'is_manager()') < strpos(f, 'message_id IS NOT NULL')
     from (select pg_temp.media_policy_filter('e7000001-0000-4000-8000-000000000001') as f) plan),
  true);

-- A confirmed photo is part of what was said; an unconfirmed one is a failed
-- upload the author may give up on.
select pg_temp.as_boss();
select pg_temp.check('a confirmed photo of a sent message cannot be taken back',
  pg_temp.refusal_hint($stmt$
    select public.remove_task_media('27000001-0000-4000-8000-000000000001')
  $stmt$), 'serverErrors.messageMediaSent');
select public.remove_task_media('27000001-0000-4000-8000-000000000002');
select pg_temp.check('a photo whose file never arrived can be',
  (select deleted_at is not null from public.task_media
    where id = '27000001-0000-4000-8000-000000000002'), true);
select public.add_message_media('27000001-0000-4000-8000-000000000003',
  '17000001-0000-4000-8000-000000000002', 'image/jpeg', 400000, 1600, 1200);
select pg_temp.check('and its place is free again',
  (select count(*)::int from public.task_media
    where message_id = '17000001-0000-4000-8000-000000000002' and deleted_at is null), 2);

-- Access follows the subject: the technician taken off the repair can no
-- longer complete his own message about it. By now Petr holds the repair
-- (task ...06); Tomas was taken off it above.
select pg_temp.as_petr();
select public.send_message('17000001-0000-4000-8000-000000000031', '',
                           null, 'f7000001-0000-4000-8000-000000000001',
                           null, 1::smallint);
reset role; reset request.jwt.claims;
update public.tasks set assignee_id = 'c7000004-0000-4000-8000-000000000004'
where id = 'e7000001-0000-4000-8000-000000000006';
select pg_temp.as_petr();
select pg_temp.check('a technician taken off the repair cannot attach to his own message',
  pg_temp.refusal_hint($stmt$
    select public.add_message_media('27000001-0000-4000-8000-000000000031',
      '17000001-0000-4000-8000-000000000031', 'image/jpeg', 400000)
  $stmt$), 'serverErrors.messageNotFound');
reset role; reset request.jwt.claims;
update public.tasks set assignee_id = 'c7000006-0000-4000-8000-000000000006'
where id = 'e7000001-0000-4000-8000-000000000006';

-- One owner, always.
select pg_temp.check('a row cannot belong to a message and a task at once',
  pg_temp.refusal_state($stmt$
    insert into public.task_media (id, host_id, task_id, step_id, message_id, kind,
                                   storage_path, mime_type, byte_size)
    values ('27000001-0000-4000-8000-000000000099', 'c7000000-0000-4000-8000-00000000000c',
            'e7000001-0000-4000-8000-000000000001', 'e7000001-0000-4000-8000-000000000001',
            '17000001-0000-4000-8000-000000000002', 'photo', 'x/y.jpg', 'image/jpeg', 1)
  $stmt$), '23514');

-- Retention: a thread ages with its subject.
select pg_temp.check('the photo taken back is due at once, the others are not',
  (select array_agg(id order by created_at) from public.task_media_to_purge(100)),
  array['27000001-0000-4000-8000-000000000002'::uuid]);
update public.tasks set status = 'done', completed_at = now() - interval '89 days'
where id = 'e7000001-0000-4000-8000-000000000001';
select pg_temp.check('a task closed 89 days ago keeps the photos of its thread',
  (select count(*)::int from public.task_media_to_purge(100)), 1);
update public.tasks set completed_at = now() - interval '91 days'
where id = 'e7000001-0000-4000-8000-000000000001';
-- A thread outlives the work it is about. The subject has been closed long
-- enough, but the word about it is today's: only the photo taken back is due.
select pg_temp.check('a photo of a fresh message in a long-closed thread is kept',
  (select array_agg(id order by id) from public.task_media_to_purge(100)),
  array['27000001-0000-4000-8000-000000000002'::uuid]);
update public.chat_messages set created_at = now() - interval '91 days'
where id = '17000001-0000-4000-8000-000000000002';
select pg_temp.check('at 91 days on both clocks the photos of its thread are due',
  (select array_agg(id order by id) from public.task_media_to_purge(100)),
  array['27000001-0000-4000-8000-000000000001'::uuid,
        '27000001-0000-4000-8000-000000000002'::uuid,
        '27000001-0000-4000-8000-000000000003'::uuid]);

-- A direct thread has no subject to close: its photos age with the message.
select pg_temp.as_anna();
select public.send_message('17000001-0000-4000-8000-000000000032', '',
                           null, null, 'c7000002-0000-4000-8000-000000000002', 1::smallint);
select public.add_message_media('27000001-0000-4000-8000-000000000032',
  '17000001-0000-4000-8000-000000000032', 'image/jpeg', 400000);
reset role; reset request.jwt.claims;
select pg_temp.check('a fresh photo in the inbox is kept',
  (select count(*)::int from public.task_media_to_purge(100)), 3);
update public.chat_messages set created_at = now() - interval '91 days'
where id = '17000001-0000-4000-8000-000000000032';
select pg_temp.check('a photo in the inbox older than the retention period is due',
  (select count(*)::int from public.task_media_to_purge(100)
    where id = '27000001-0000-4000-8000-000000000032'), 1);

-- A problem thread ages with the problem, and the problem's status and
-- resolved_at are the mirror's to write (20260923130000): close the current
-- attempt and let the trigger resolve it, rather than writing the problem.
-- The photo is confirmed by hand so that the upload window stays out of it.
select pg_temp.as_anna();
select public.send_message('17000001-0000-4000-8000-000000000033', '',
                           null, 'f7000001-0000-4000-8000-000000000001', null, 1::smallint);
select public.add_message_media('27000001-0000-4000-8000-000000000033',
  '17000001-0000-4000-8000-000000000033', 'image/jpeg', 400000);
reset role; reset request.jwt.claims;
update public.task_media set uploaded_at = now()
where id = '27000001-0000-4000-8000-000000000033';
update public.tasks set status = 'done', completed_at = now()
where id = 'e7000001-0000-4000-8000-000000000006';
select pg_temp.check('closing the current attempt resolves the problem',
  (select status::text || ':' || (resolved_at is not null)::text from public.problems
    where id = 'f7000001-0000-4000-8000-000000000001'), 'resolved:true');
update public.problems set resolved_at = now() - interval '91 days'
where id = 'f7000001-0000-4000-8000-000000000001';
select pg_temp.check('a fresh photo in a long-resolved problem''s thread is kept',
  (select count(*)::int from public.task_media_to_purge(100)
    where id = '27000001-0000-4000-8000-000000000033'), 0);
update public.chat_messages set created_at = now() - interval '91 days'
where id = '17000001-0000-4000-8000-000000000033';
select pg_temp.check('at 91 days on both clocks a problem thread''s photo is due',
  (select count(*)::int from public.task_media_to_purge(100)
    where id = '27000001-0000-4000-8000-000000000033'), 1);

-- ---------------------------------------------------------------------------
--  Two calls with one id at the same moment (20260924110000)
-- ---------------------------------------------------------------------------
-- One session cannot make two calls at once, so the other call is played by a
-- trigger: between the RPC's lookup (which misses) and its insert, the trigger
-- writes the very row the RPC is about to write. The RPC's own insert then
-- lands on the primary key exactly as the loser of the race does.
reset role; reset request.jwt.claims;

create function pg_temp.other_call_wins() returns trigger language plpgsql as $fn$
begin
  if pg_trigger_depth() = 1 then
    execute format('insert into %I.%I select ($1).*', tg_table_schema, tg_table_name) using new;
  end if;
  return new;
end $fn$;

create trigger race_send before insert on public.chat_messages for each row
  when (new.id = '17000001-0000-4000-8000-000000000041')
  execute function pg_temp.other_call_wins();
create trigger race_media before insert on public.task_media for each row
  when (new.id = '27000001-0000-4000-8000-000000000041')
  execute function pg_temp.other_call_wins();

select pg_temp.as_boss();
select pg_temp.check('send_message that loses the race gets the same row, not 23505',
  (select id from public.send_message('17000001-0000-4000-8000-000000000041', 'race',
     'e7000001-0000-4000-8000-000000000001', null, null, 2::smallint)),
  '17000001-0000-4000-8000-000000000041'::uuid);
select pg_temp.check('and the message was written once',
  (select count(*)::int from public.chat_messages
    where id = '17000001-0000-4000-8000-000000000041'), 1);
select pg_temp.check('and the thread counted it once',
  (select message_count from public.chat_threads where id = pg_temp.task_thread())
    = (select count(*) from public.chat_messages where thread_id = pg_temp.task_thread()),
  true);

select pg_temp.check('add_message_media that loses the race gets the same row',
  (select id from public.add_message_media('27000001-0000-4000-8000-000000000041',
     '17000001-0000-4000-8000-000000000041', 'image/jpeg', 400000)),
  '27000001-0000-4000-8000-000000000041'::uuid);
select pg_temp.check('and one row only',
  (select count(*)::int from public.task_media
    where id = '27000001-0000-4000-8000-000000000041'), 1);

-- The row written meanwhile by ANOTHER company is not the answer: the
-- re-read applies the host and author checks and refuses with a key.
select pg_temp.as_other_host();
select public.send_message('17000001-0000-4000-8000-000000000043', '',
                           null, null, 'd7000001-0000-4000-8000-000000000001', 1::smallint);
select public.add_message_media('27000001-0000-4000-8000-000000000043',
  '17000001-0000-4000-8000-000000000043', 'image/jpeg', 400000);
select pg_temp.as_boss();
select pg_temp.check('a media id taken by another company is refused with a key',
  pg_temp.refusal_hint($stmt$
    select public.add_message_media('27000001-0000-4000-8000-000000000043',
      '17000001-0000-4000-8000-000000000041', 'image/jpeg', 400000)
  $stmt$), 'serverErrors.mediaNotFound');
select pg_temp.check('a message id taken by another company likewise',
  pg_temp.refusal_hint($stmt$
    select public.send_message('17000001-0000-4000-8000-000000000043', 'mine',
      'e7000001-0000-4000-8000-000000000001')
  $stmt$), 'serverErrors.messageNotFound');

reset role; reset request.jwt.claims;
drop trigger race_send on public.chat_messages;
drop trigger race_media on public.task_media;

-- ---------------------------------------------------------------------------
--  A photo that never arrived expires (20260924120000)
-- ---------------------------------------------------------------------------
select pg_temp.as_boss();
-- In Bara's inbox: task ...01 was closed 91 days ago above, and its thread's
-- photos are due by that clock already. A direct thread ages by the message.
select public.send_message('17000001-0000-4000-8000-000000000051', 'expiry',
                           null, null, 'c7000003-0000-4000-8000-000000000003', 1::smallint);
select public.add_message_media('27000001-0000-4000-8000-000000000051',
  '17000001-0000-4000-8000-000000000051', 'image/jpeg', 400000);
reset role; reset request.jwt.claims;

update public.task_media set created_at = now() - interval '23 hours'
where id = '27000001-0000-4000-8000-000000000051';
select pg_temp.check('a photo without a file is kept within the upload window',
  (select count(*)::int from public.task_media_to_purge(100)
    where id = '27000001-0000-4000-8000-000000000051'), 0);
update public.task_media set created_at = now() - interval '25 hours'
where id = '27000001-0000-4000-8000-000000000051';
select pg_temp.check('and is due once the window has passed',
  (select count(*)::int from public.task_media_to_purge(100)
    where id = '27000001-0000-4000-8000-000000000051'), 1);

-- A confirmed photo of the same age is not: the window is about the file
-- that never came, not about the photo.
select pg_temp.as_anna();
select public.send_message('17000001-0000-4000-8000-000000000052', '',
                           null, null, 'c7000002-0000-4000-8000-000000000002', 1::smallint);
select public.add_message_media('27000001-0000-4000-8000-000000000052',
  '17000001-0000-4000-8000-000000000052', 'image/jpeg', 400000);
insert into storage.objects (bucket_id, name, owner, owner_id)
select 'task-media', m.storage_path, m.created_by, m.created_by::text
from public.task_media m where m.id = '27000001-0000-4000-8000-000000000052';
select public.confirm_task_media('27000001-0000-4000-8000-000000000052');
reset role; reset request.jwt.claims;
update public.task_media set created_at = now() - interval '25 hours'
where id = '27000001-0000-4000-8000-000000000052';
select pg_temp.check('a confirmed photo older than the window is kept',
  (select count(*)::int from public.task_media_to_purge(100)
    where id = '27000001-0000-4000-8000-000000000052'), 0);

-- The window is the chat's clock and reaches nothing else. A step's photo
-- waiting for its file is not swept by it: the cleaner is still on the spot
-- and may yet finish the upload, and her row waits for the task to close as it
-- always did.
reset role; reset request.jwt.claims;
insert into public.task_steps (id, task_id, host_id, sort_order, type, required)
values ('a7000001-0000-4000-8000-000000000001', 'e7000001-0000-4000-8000-000000000004',
        'c7000000-0000-4000-8000-00000000000c', 1, 'photos_before', true);
insert into public.task_media (id, host_id, task_id, step_id, kind, storage_path,
                               mime_type, byte_size, created_by, created_at)
values ('27000002-0000-4000-8000-000000000001', 'c7000000-0000-4000-8000-00000000000c',
        'e7000001-0000-4000-8000-000000000004', 'a7000001-0000-4000-8000-000000000001',
        'photo', 'c7000000-0000-4000-8000-00000000000c/e7000001-0000-4000-8000-000000000004/'
          || '27000002-0000-4000-8000-000000000001.jpg',
        'image/jpeg', 400000, 'c7000004-0000-4000-8000-000000000004',
        now() - interval '30 hours');
select pg_temp.check('a step photo of 30 hours without a file is not swept',
  (select count(*)::int from public.task_media_to_purge(100)
    where id = '27000002-0000-4000-8000-000000000001'), 0);
-- Nor is a problem's own photo: the window is keyed on message_id, not on the
-- absence of a step. Bara's problem is still open.
insert into public.task_media (id, host_id, problem_id, kind, storage_path,
                               mime_type, byte_size, created_by, created_at)
values ('27000002-0000-4000-8000-000000000002', 'c7000000-0000-4000-8000-00000000000c',
        'f7000001-0000-4000-8000-000000000002', 'photo',
        'c7000000-0000-4000-8000-00000000000c/problems/f7000001-0000-4000-8000-000000000002/'
          || '27000002-0000-4000-8000-000000000002.jpg',
        'image/jpeg', 400000, 'c7000003-0000-4000-8000-000000000003',
        now() - interval '30 hours');
select pg_temp.check('a problem photo of 30 hours without a file is not swept',
  (select count(*)::int from public.task_media_to_purge(100)
    where id = '27000002-0000-4000-8000-000000000002'), 0);

-- The sweep has marked it. Every link of the sender's chain now answers the
-- same word, and taking the photo back is what remains.
select public.mark_task_media_purged(array['27000001-0000-4000-8000-000000000051'::uuid]);
select pg_temp.as_boss();
select pg_temp.check('registering an expired photo again says it expired',
  pg_temp.refusal_hint($stmt$
    select public.add_message_media('27000001-0000-4000-8000-000000000051',
      '17000001-0000-4000-8000-000000000051', 'image/jpeg', 400000)
  $stmt$), 'serverErrors.messageMediaExpired');
select pg_temp.check('the bucket refuses the file',
  public.can_upload_task_media((select storage_path from public.task_media
    where id = '27000001-0000-4000-8000-000000000051')), false);
select pg_temp.check('confirming it says the same',
  pg_temp.refusal_hint($stmt$
    select public.confirm_task_media('27000001-0000-4000-8000-000000000051')
  $stmt$), 'serverErrors.messageMediaExpired');
select public.remove_task_media('27000001-0000-4000-8000-000000000051');
select pg_temp.check('and the author may take it back',
  (select deleted_at is not null from public.task_media
    where id = '27000001-0000-4000-8000-000000000051'), true);
reset role; reset request.jwt.claims;

rollback;
