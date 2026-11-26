-- The office adds photos, videos and a comment to a task (owner, 2026-11-26; 20261126100000).
-- Run: npm run test:rls. Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - only the office adds: a manager, an admin, the reception; a technician, the head technician,
--   a cleaner and another company's manager are refused;
-- - a file is held to the types and sizes every file is, a video to the company's own limits,
--   a batch to ten files, a task to being open (not closed, cancelled or archived);
-- - an open task's batch shows once published, with the files that arrived — a file that did not
--   is left out by the manager's choice, and a batch with nothing arrived is refused;
-- - whoever reads the task reads the batch and its files (the reporter, the technician at work);
--   a cleaner with nothing to do with the task and another company do not; the readers of today,
--   which ask for problem_id, never meet the office's files;
-- - closing as before: the call of today's screens is exactly what it was;
-- - closing with a comment, with files, with both: one transaction — the words in the task's
--   thread, the files shown at the closing, the journal's lines; a refused closing keeps none of it;
--   a replay adds nothing; a closing whose files all failed still closes;
-- - the journal: media_added (count, photos, videos, at, addition) and comment_added (at, message)
--   — never the words; an office message in an open task, in a closed one, at the closing;
-- - a published file is not taken back; the sweep takes a batch's files with its task's, and those
--   of a batch never shown after the upload window.
--
-- Fixture ids live in the 900261xxx range and under f1261….
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('f1261000-0000-4000-8000-00000000000a', 'Additions company'),
  ('f1261000-0000-4000-8000-00000000000b', 'Another company');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
select ('f12610' || n || '-0000-4000-8000-0000000000' || n)::uuid,
       '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'add' || n || '@test.local', 'x', now(), now(),
       jsonb_build_object('full_name', name), jsonb_build_object('role', role)
from (values ('01', 'Boss', 'manager'), ('02', 'Desk', 'reception'), ('03', 'Admin', 'admin'),
             ('04', 'Reporter', 'cleaner'), ('05', 'Fixer', 'tech'), ('06', 'Head', 'head_tech'),
             ('07', 'Stranger', 'cleaner'), ('08', 'Elsewhere', 'manager'))
     as people(n, name, role);

update public.profiles set host_id = 'f1261000-0000-4000-8000-00000000000a'
where id::text like 'f12610__-0000-4000-8000-0000000000__' and id::text <> 'f1261008-0000-4000-8000-000000000008';
update public.profiles set host_id = 'f1261000-0000-4000-8000-00000000000b'
where id = 'f1261008-0000-4000-8000-000000000008';

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time) values
  (900261001, 'f1261000-0000-4000-8000-00000000000a', 'Additions flat', 'Europe/Prague', '15:00', '10:00');

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

create or replace function pg_temp.person(n integer) returns uuid language sql immutable as $$
  select ('f12610' || lpad(n::text, 2, '0') || '-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.as_person(n integer) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || pg_temp.person(n) || '","role":"authenticated"}', true) $$;
create or replace function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;

create or replace function pg_temp.pid(n integer) returns uuid language sql immutable as $$
  select ('f1261100-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.aid(n integer) returns uuid language sql immutable as $$
  select ('f1261200-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.mid(n integer) returns uuid language sql immutable as $$
  select ('f1261300-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function pg_temp.cid(n integer) returns uuid language sql immutable as $$
  select ('f1261400-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;

-- A photo of 1 kB into batch a of task p, as the office's screen registers it.
create or replace function pg_temp.photo(m integer, a integer, p integer) returns public.task_media
language sql as $$
  select public.add_office_media(pg_temp.mid(m), pg_temp.aid(a), pg_temp.pid(p), 'photo',
                                 'image/jpeg', 1000, 800, 600, null, now(), 'gallery') $$;
-- A video of 30 s.
create or replace function pg_temp.video(m integer, a integer, p integer) returns public.task_media
language sql as $$
  select public.add_office_media(pg_temp.mid(m), pg_temp.aid(a), pg_temp.pid(p), 'video',
                                 'video/mp4', 5000000, null, null, 30, now(), 'camera') $$;
-- The file arrives in storage (as postgres: the bucket's policy is the pipeline's own test).
create or replace function pg_temp.arrive(n integer) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id)
  select 'task-media', f.storage_path, f.created_by, f.created_by::text
  from public.task_media f where f.id = pg_temp.mid(n) $$;

create or replace function pg_temp.events(p integer, k text) returns bigint language sql as $$
  select count(*) from public.problem_events e
  where e.problem_id = pg_temp.pid(p) and e.kind::text = k $$;
create or replace function pg_temp.event(p integer, k text) returns jsonb language sql as $$
  select e.params from public.problem_events e
  where e.problem_id = pg_temp.pid(p) and e.kind::text = k
  order by e.id desc limit 1 $$;

-- ---------- fixtures: the reporter's tasks, one at work with the technician ----------

-- The reporter cleans the flat: that is what lets her report on it.
insert into public.property_cleaners (property_id, cleaner_id) values (900261001, pg_temp.person(4));

select pg_temp.as_person(4);
select public.report_problem(pg_temp.pid(n), 'Task ' || n, null, 'normal', 900261001)
from generate_series(1, 9) n;

select pg_temp.as_person(1);
select public.assign_problem(pg_temp.pid(1), pg_temp.person(5), current_date);

-- ---------- 1. only the office adds ----------

select pg_temp.as_person(5);
select pg_temp.check('1a the technician may not add',
  pg_temp.refusal($q$select pg_temp.photo(90, 90, 1)$q$), 'serverErrors.managerOnly');
select pg_temp.as_person(6);
select pg_temp.check('1b the head technician may not add',
  pg_temp.refusal($q$select pg_temp.photo(90, 90, 1)$q$), 'serverErrors.managerOnly');
select pg_temp.as_person(4);
select pg_temp.check('1c the reporter may not add',
  pg_temp.refusal($q$select pg_temp.photo(90, 90, 1)$q$), 'serverErrors.managerOnly');
select pg_temp.as_person(8);
select pg_temp.check('1d another company''s manager does not find the task',
  pg_temp.refusal($q$select pg_temp.photo(90, 90, 1)$q$), 'serverErrors.problemNotFound');
select pg_temp.as_person(2);
select pg_temp.check('1e the reception adds',
  (pg_temp.photo(20, 20, 3)).addition_id, pg_temp.aid(20));
select pg_temp.as_person(3);
select pg_temp.check('1f the admin adds',
  (pg_temp.photo(21, 21, 3)).addition_id, pg_temp.aid(21));
select pg_temp.as_postgres();
select pg_temp.check('1g nothing was written by the refused',
  (select count(*) from public.problem_additions where id = pg_temp.aid(90)), 0::bigint);

-- ---------- 2. a file is held to the pipeline's rules ----------

select pg_temp.as_person(1);
select pg_temp.check('2a a photo must be a picture',
  pg_temp.refusal($q$select public.add_office_media(pg_temp.mid(91), pg_temp.aid(9), pg_temp.pid(9),
    'photo', 'application/pdf', 1000)$q$), 'serverErrors.mediaTypeInvalid');
select pg_temp.check('2b a video says how long it is',
  pg_temp.refusal($q$select public.add_office_media(pg_temp.mid(91), pg_temp.aid(9), pg_temp.pid(9),
    'video', 'video/mp4', 1000)$q$), 'serverErrors.videoDurationMissing');
select pg_temp.check('2c a video longer than the company allows',
  pg_temp.refusal($q$select public.add_office_media(pg_temp.mid(91), pg_temp.aid(9), pg_temp.pid(9),
    'video', 'video/mp4', 1000, null, null, 600)$q$), 'serverErrors.videoTooLong');
select pg_temp.check('2d a photo larger than every photo may be',
  pg_temp.refusal($q$select public.add_office_media(pg_temp.mid(91), pg_temp.aid(9), pg_temp.pid(9),
    'photo', 'image/jpeg', 30000000)$q$), 'serverErrors.mediaTooLarge');
select pg_temp.check('2e a video larger than the company''s plan stores',
  pg_temp.refusal($q$select public.add_office_media(pg_temp.mid(91), pg_temp.aid(9), pg_temp.pid(9),
    'video', 'video/mp4', 150000000, null, null, 30)$q$), 'serverErrors.mediaTooLarge');
select pg_temp.photo(60 + n, 9, 9) from generate_series(0, 9) n;
select pg_temp.check('2f a batch takes ten files and no more',
  pg_temp.refusal($q$select pg_temp.photo(70, 9, 9)$q$), 'serverErrors.mediaLimitReached');
select pg_temp.check('2g the same file again is a replay, not a second row',
  (pg_temp.photo(60, 9, 9)).id, pg_temp.mid(60));
select pg_temp.check('2h a replay under another batch is refused',
  pg_temp.refusal($q$select pg_temp.photo(60, 8, 9)$q$), 'serverErrors.mediaNotFound');
select pg_temp.check('2i the file goes to a path of the office''s own under the task',
  (select storage_path like '%/problems/' || pg_temp.pid(9) || '/office/' || pg_temp.mid(60) || '.jpg'
   from public.task_media where id = pg_temp.mid(60)), true);

-- ---------- 3. an open task: register, arrive, confirm, publish ----------

select pg_temp.as_person(1);
select pg_temp.photo(1, 1, 1);
select pg_temp.video(2, 1, 1);
select pg_temp.as_postgres();
select pg_temp.arrive(1);
select pg_temp.arrive(2);
select pg_temp.as_person(1);
select public.confirm_task_media(pg_temp.mid(1));
select public.confirm_task_media(pg_temp.mid(2));

select pg_temp.as_person(4);
select pg_temp.check('3a the batch on its way shows to nobody but the office',
  (select count(*) from public.problem_additions where id = pg_temp.aid(1))
  + (select count(*) from public.task_media where addition_id = pg_temp.aid(1)), 0::bigint);

select pg_temp.as_person(1);
select pg_temp.check('3b published: at work, now',
  (select stage || ':' || (published_at is not null)::text
   from public.publish_office_media(pg_temp.aid(1))), 'open:true');
select pg_temp.check('3c the journal says what was added, in numbers',
  pg_temp.event(1, 'media_added'),
  jsonb_build_object('count', 2, 'photos', 1, 'videos', 1, 'at', 'open', 'addition', pg_temp.aid(1)));
select pg_temp.check('3d the journal names the manager',
  (select actor_id from public.problem_events
   where problem_id = pg_temp.pid(1) and kind = 'media_added'), pg_temp.person(1));
select pg_temp.check('3e published again: the same batch, no second line',
  (select (public.publish_office_media(pg_temp.aid(1))).id = pg_temp.aid(1))
  and pg_temp.events(1, 'media_added') = 1, true);
select pg_temp.check('3f published files are not taken back',
  pg_temp.refusal($q$select public.remove_task_media(pg_temp.mid(1))$q$),
  'serverErrors.additionPublished');
select pg_temp.check('3g the batch takes no more files',
  pg_temp.refusal($q$select pg_temp.photo(3, 1, 1)$q$), 'serverErrors.additionPublished');

-- ---------- 4. whoever reads the task reads the batch ----------

select pg_temp.as_person(4);
select pg_temp.check('4a the reporter reads the batch and both files',
  (select count(*) from public.task_media m join public.problem_additions a on a.id = m.addition_id
   where a.problem_id = pg_temp.pid(1)), 2::bigint);
select pg_temp.check('4b and may open the file',
  public.can_read_task_media((select storage_path from public.task_media where id = pg_temp.mid(2))),
  true);
select pg_temp.check('4c the readers of today, by problem_id, never meet the office''s files',
  (select count(*) from public.task_media where problem_id = pg_temp.pid(1)), 0::bigint);
select pg_temp.as_person(5);
select pg_temp.check('4d the technician at work reads them',
  (select count(*) from public.task_media m join public.problem_additions a on a.id = m.addition_id
   where a.problem_id = pg_temp.pid(1)), 2::bigint);
select pg_temp.as_person(7);
select pg_temp.check('4e a cleaner with nothing to do with the task reads nothing',
  (select count(*) from public.problem_additions where problem_id = pg_temp.pid(1))
  + (select count(*) from public.task_media where id in (pg_temp.mid(1), pg_temp.mid(2))), 0::bigint);
select pg_temp.check('4f nor opens the file',
  public.can_read_task_media(
    (select m.storage_path from public.task_media m where m.id = pg_temp.mid(2))), false);
select pg_temp.as_person(8);
select pg_temp.check('4g another company reads nothing',
  (select count(*) from public.problem_additions)
  + (select count(*) from public.task_media where id in (pg_temp.mid(1), pg_temp.mid(2))), 0::bigint);

-- ---------- 5. a file that failed, and a batch with nothing arrived ----------

select pg_temp.as_person(1);
select pg_temp.photo(4, 2, 2);
select pg_temp.photo(5, 2, 2);
select pg_temp.as_postgres();
select pg_temp.arrive(4);
select pg_temp.as_person(1);
select public.confirm_task_media(pg_temp.mid(4));
select public.publish_office_media(pg_temp.aid(2));
select pg_temp.check('5a the file that never arrived is left out',
  (select (deleted_at is not null)::text from public.task_media where id = pg_temp.mid(5)), 'true');
select pg_temp.check('5b the journal counts what was added',
  (pg_temp.event(2, 'media_added') ->> 'count')::integer, 1);

select pg_temp.photo(6, 3, 2);
select pg_temp.check('5c a batch with nothing arrived is refused',
  pg_temp.refusal($q$select public.publish_office_media(pg_temp.aid(3))$q$),
  'serverErrors.additionEmpty');
select pg_temp.check('5d and shows nowhere, not even to its author',
  (select count(*) from public.problem_additions where id = pg_temp.aid(3)), 0::bigint);
select pg_temp.as_postgres();
select pg_temp.check('5e it stays on its way',
  (select published_at is null from public.problem_additions where id = pg_temp.aid(3)), true);
select pg_temp.as_person(1);
select pg_temp.check('5e its file may still be taken back',
  (select deleted_at is not null from public.remove_task_media(pg_temp.mid(6))), true);
select pg_temp.as_person(2);
select pg_temp.check('5f somebody else''s batch is not published',
  pg_temp.refusal($q$select public.publish_office_media(pg_temp.aid(2))$q$),
  'serverErrors.additionNotFound');

-- ---------- 6. comments: the office's messages in the task's thread ----------

select pg_temp.as_person(1);
select public.send_message(pg_temp.cid(1), 'Синтетический комментарий', null, pg_temp.pid(1));
select pg_temp.check('6a the office''s comment in an open task',
  pg_temp.event(1, 'comment_added'),
  jsonb_build_object('at', 'open', 'message', pg_temp.cid(1)));
select pg_temp.as_person(5);
select public.send_message(pg_temp.cid(2), 'Синтетический ответ', null, pg_temp.pid(1));
select pg_temp.as_person(4);
select public.send_message(pg_temp.cid(3), 'Синтетический вопрос', null, pg_temp.pid(1));
select pg_temp.as_postgres();
select pg_temp.check('6b the technician''s and the reporter''s messages are not the office''s',
  pg_temp.events(1, 'comment_added'), 1::bigint);

-- ---------- 7. closing as before ----------

select pg_temp.as_person(1);
select public.resolve_problem(p_id => pg_temp.pid(4), p_alone => true);
select pg_temp.check('7a the call of today''s screens closes as it did',
  (select status::text || ':' || closed_how from public.problems where id = pg_temp.pid(4)),
  'resolved:manager_self');
select pg_temp.check('7b and adds nothing',
  (select count(*) from public.problem_additions where problem_id = pg_temp.pid(4))
  + pg_temp.events(4, 'media_added') + pg_temp.events(4, 'comment_added'), 0::bigint);
select public.resolve_problem(pg_temp.pid(5));
select pg_temp.check('7c the oldest call, the task alone, closes too',
  (select status::text from public.problems where id = pg_temp.pid(5)), 'resolved');

-- ---------- 8. closing with a comment, with files, with both ----------

select public.resolve_problem(p_id => pg_temp.pid(6), p_alone => true, p_addition_id => pg_temp.aid(6),
                              p_comment_id => pg_temp.cid(6), p_comment => '  Готово, кран заменён  ');
select pg_temp.check('8a with a comment: closed',
  (select status::text from public.problems where id = pg_temp.pid(6)), 'resolved');
select pg_temp.check('8b the words are a message of the task''s thread, trimmed',
  (select m.body from public.chat_messages m join public.chat_threads t on t.id = m.thread_id
   where m.id = pg_temp.cid(6) and t.problem_id = pg_temp.pid(6)), 'Готово, кран заменён');
select pg_temp.check('8c the closing''s batch keeps the message',
  (select stage || ':' || (message_id = pg_temp.cid(6))::text
   from public.problem_additions where id = pg_temp.aid(6)), 'closing:true');
select pg_temp.check('8d the journal: a comment at the closing, and no files',
  pg_temp.event(6, 'comment_added') = jsonb_build_object('at', 'closing', 'message', pg_temp.cid(6))
  and pg_temp.events(6, 'media_added') = 0, true);

select pg_temp.photo(7, 7, 7);
select pg_temp.as_postgres();
select pg_temp.arrive(7);
select pg_temp.as_person(1);
select public.confirm_task_media(pg_temp.mid(7));
select public.resolve_problem(p_id => pg_temp.pid(7), p_completed_by => pg_temp.person(5),
                              p_addition_id => pg_temp.aid(7));
select pg_temp.check('8e with files: closed in the technician''s name',
  (select status::text || ':' || completed_by::text from public.problems where id = pg_temp.pid(7)),
  'resolved:' || pg_temp.person(5));
select pg_temp.check('8f the journal: files at the closing, and no comment',
  pg_temp.event(7, 'media_added') = jsonb_build_object('count', 1, 'photos', 1, 'videos', 0,
                                                       'at', 'closing', 'addition', pg_temp.aid(7))
  and pg_temp.events(7, 'comment_added') = 0, true);

select pg_temp.photo(8, 8, 8);
select pg_temp.video(9, 8, 8);
select pg_temp.as_postgres();
select pg_temp.arrive(8);
select pg_temp.as_person(1);
select public.confirm_task_media(pg_temp.mid(8));
select public.resolve_problem(p_id => pg_temp.pid(8), p_alone => true, p_addition_id => pg_temp.aid(8),
                              p_comment_id => pg_temp.cid(8), p_comment => 'Синтетика');
select pg_temp.check('8g with both and a video that failed: the photo and the words',
  (pg_temp.event(8, 'media_added') ->> 'count') || ':' || (pg_temp.event(8, 'comment_added') ->> 'at')
  || ':' || (select (deleted_at is not null)::text from public.task_media where id = pg_temp.mid(9)),
  '1:closing:true');
select public.resolve_problem(p_id => pg_temp.pid(8), p_alone => true, p_addition_id => pg_temp.aid(8),
                              p_comment_id => pg_temp.cid(8), p_comment => 'Синтетика');
select pg_temp.check('8h the same closing again adds nothing',
  pg_temp.events(8, 'media_added') || ':' || pg_temp.events(8, 'comment_added') || ':'
  || (select count(*) from public.chat_messages where id = pg_temp.cid(8)), '1:1:1');

select pg_temp.check('8i the journal of every addition holds no words',
  (select bool_and(not (e.params::text ~ '(Синтетика|кран|Готово)')
                   and (select array_agg(k order by k) from jsonb_object_keys(e.params) k)
                       <@ array['addition', 'at', 'count', 'message', 'photos', 'videos'])
   from public.problem_events e
   where e.kind::text in ('media_added', 'comment_added')
     and e.problem_id in (select pg_temp.pid(n) from generate_series(1, 9) n)), true);

-- A closing refused keeps none of it.
select pg_temp.check('8j a refused closing is refused',
  pg_temp.refusal($q$select public.resolve_problem(p_id => pg_temp.pid(3),
    p_completed_by => pg_temp.person(5), p_alone => true, p_addition_id => pg_temp.aid(30),
    p_comment_id => pg_temp.cid(30), p_comment => 'Не сохранится')$q$),
  'serverErrors.problemCompleterInvalid');
select pg_temp.as_postgres();
select pg_temp.check('8k and leaves no words, no batch, no line',
  (select count(*) from public.chat_messages where id = pg_temp.cid(30))
  + (select count(*) from public.problem_additions where id = pg_temp.aid(30))
  + pg_temp.events(3, 'comment_added')
  + (select count(*) from public.problems where id = pg_temp.pid(3) and status <> 'open'), 0::bigint);
select pg_temp.as_person(1);
select pg_temp.check('8l words without the screen''s id are refused',
  pg_temp.refusal($q$select public.resolve_problem(p_id => pg_temp.pid(3), p_alone => true,
    p_addition_id => pg_temp.aid(31), p_comment => 'Без id')$q$),
  'serverErrors.closingAdditionInvalid');

-- Every file failed and there are no words: the manager chose to close without them.
select pg_temp.photo(10, 32, 3);
select public.resolve_problem(p_id => pg_temp.pid(3), p_alone => true, p_addition_id => pg_temp.aid(32));
select pg_temp.check('8m a closing whose files all failed still closes',
  (select status::text from public.problems where id = pg_temp.pid(3)), 'resolved');
select pg_temp.as_postgres();
select pg_temp.check('8n its batch shows nowhere and the journal names no files',
  (select published_at is null from public.problem_additions where id = pg_temp.aid(32))
  and pg_temp.events(3, 'media_added') = 0, true);

select pg_temp.as_person(5);
select pg_temp.check('8o the technician may not close with words',
  pg_temp.refusal($q$select public.resolve_problem(p_id => pg_temp.pid(2), p_alone => true,
    p_addition_id => pg_temp.aid(33), p_comment_id => pg_temp.cid(33), p_comment => 'x')$q$),
  'serverErrors.managerOnly');

-- ---------- 9. a closed task, and one archived ----------

select pg_temp.as_person(1);
select pg_temp.check('9a a closed task takes no more files',
  pg_temp.refusal($q$select pg_temp.photo(11, 40, 4)$q$), 'serverErrors.problemNotOpen');
select public.send_message(pg_temp.cid(9), 'После закрытия', null, pg_temp.pid(4));
select pg_temp.check('9b the office''s comment in a closed task says so',
  pg_temp.event(4, 'comment_added') ->> 'at', 'closed');
select public.archive_problem(pg_temp.pid(2));
select pg_temp.check('9c an archived task takes no more files',
  pg_temp.refusal($q$select pg_temp.photo(12, 41, 2)$q$), 'serverErrors.problemNotOpen');

-- ---------- 10. the retention sweep ----------

select pg_temp.as_postgres();
-- The batch on its way since yesterday and more (its files never published).
update public.task_media set created_at = now() - interval '25 hours'
where addition_id = pg_temp.aid(20);
-- A task closed 91 days ago, with a published batch.
update public.problems set resolved_at = now() - interval '91 days' where id = pg_temp.pid(7);
select pg_temp.check('10a the sweep takes a batch''s files with its task''s',
  (select count(*) from public.task_media_to_purge(10000) m where m.id = pg_temp.mid(7)), 1::bigint);
select pg_temp.check('10b and those of a batch never shown, after the upload window',
  (select count(*) from public.task_media_to_purge(10000) m where m.id = pg_temp.mid(20)), 1::bigint);
select pg_temp.check('10c but not the files of a task at work',
  (select count(*) from public.task_media_to_purge(10000) m
   where m.id in (pg_temp.mid(1), pg_temp.mid(2), pg_temp.mid(21))), 0::bigint);

rollback;
