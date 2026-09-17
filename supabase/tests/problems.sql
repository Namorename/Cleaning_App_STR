-- Problems: reported from the field, fixed as maintenance tasks. Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- The report is the cleaner's; the fix is a task the manager hands to a
-- technician; the problem's status follows that task. Photos ride on the
-- task media pipeline with a problem as their owner.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d8000001-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.problems@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d8000002-0000-4000-8000-0000000000d2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.problems@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d8000003-0000-4000-8000-0000000000d3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tech.problems@test.local','x',now(),now(),
   '{"full_name":"Tech"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('d8000004-0000-4000-8000-0000000000d4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.problems@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb);

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900001801, 'Flat with a leak',        'UTC', '15:00', '10:00'),
  (900001802, 'Flat she does not clean', 'UTC', '15:00', '10:00');

insert into public.property_cleaners (property_id, cleaner_id, mode) values
  (900001801, 'd8000001-0000-4000-8000-0000000000d1', 'claim');

insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date) values
  ('a8000001-0000-4000-8000-000000000001', 900001801, 'cleaning', 'in_progress',
   'd8000001-0000-4000-8000-0000000000d1', current_date);

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.refusal(statement text)
returns text language plpgsql as $$
declare
  v_hint   text;
  v_detail text;
begin
  execute statement;
  return 'no refusal';
exception when check_violation or insufficient_privilege then
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return v_hint || coalesce(' ' || nullif(v_detail, ''), '');
end $$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;
create or replace function pg_temp.as_maria() returns void language sql as $$
  select pg_temp.as_user('d8000001-0000-4000-8000-0000000000d1') $$;
create or replace function pg_temp.as_anna() returns void language sql as $$
  select pg_temp.as_user('d8000002-0000-4000-8000-0000000000d2') $$;
create or replace function pg_temp.as_tech() returns void language sql as $$
  select pg_temp.as_user('d8000003-0000-4000-8000-0000000000d3') $$;
create or replace function pg_temp.as_boss() returns void language sql as $$
  select pg_temp.as_user('d8000004-0000-4000-8000-0000000000d4') $$;

create or replace function pg_temp.pid(n integer) returns uuid language sql immutable as $$
  select ('c8000001-0000-4000-8000-00000000000' || n::text)::uuid $$;
create or replace function pg_temp.mid(n integer) returns uuid language sql immutable as $$
  select ('e8000001-0000-4000-8000-00000000000' || n::text)::uuid $$;
create or replace function pg_temp.problem(n integer) returns public.problems language sql as $$
  select p.* from public.problems p where p.id = pg_temp.pid(n) $$;
create or replace function pg_temp.fix_task(n integer) returns public.tasks language sql as $$
  select t.* from public.tasks t
  where t.problem_id = pg_temp.pid(n) and t.status not in ('cancelled', 'expired')
  order by t.created_at desc limit 1 $$;

-- ---------- reporting ----------
select pg_temp.as_maria();
select public.report_problem(pg_temp.pid(1), '  Кран течёт  ', 'Под раковиной лужа', 'high',
  null, 'a8000001-0000-4000-8000-000000000001');
select public.report_problem(pg_temp.pid(1), 'Кран течёт', 'replayed', 'low',
  null, 'a8000001-0000-4000-8000-000000000001');
reset role; reset request.jwt.claims;

select pg_temp.check('the report is stored with a trimmed title',
  (pg_temp.problem(1)).title, 'Кран течёт');
select pg_temp.check('the report is open',
  (pg_temp.problem(1)).status::text, 'open');
select pg_temp.check('the listing comes from the task',
  (pg_temp.problem(1)).property_id, 900001801::bigint);
select pg_temp.check('the reporter is the caller, not a parameter',
  (pg_temp.problem(1)).reported_by, 'd8000001-0000-4000-8000-0000000000d1'::uuid);
select pg_temp.check('a replay returns the row unchanged',
  (pg_temp.problem(1)).description, 'Под раковиной лужа');
select pg_temp.check('a replay does not duplicate',
  (select count(*)::int from public.problems where id = pg_temp.pid(1)), 1);

select pg_temp.as_anna();
select pg_temp.check('another cleaner replaying the id is told nothing',
  pg_temp.refusal($q$select public.report_problem(pg_temp.pid(1), 'x')$q$),
  'serverErrors.problemNotFound');
select pg_temp.check('a report on a task she cannot see is refused',
  pg_temp.refusal($q$select public.report_problem(pg_temp.pid(2), 'x', null, 'normal', null,
                    'a8000001-0000-4000-8000-000000000001')$q$),
  'serverErrors.taskNotFound');
select pg_temp.check('a report on a listing she does not clean is refused',
  pg_temp.refusal($q$select public.report_problem(pg_temp.pid(2), 'x', null, 'normal', 900001802)$q$),
  'serverErrors.propertyNotFound');
reset role; reset request.jwt.claims;

select pg_temp.as_maria();
select pg_temp.check('a report needs a title',
  pg_temp.refusal($q$select public.report_problem(pg_temp.pid(2), '   ')$q$),
  'serverErrors.problemTitleRequired');
select pg_temp.check('a title has a limit, and the limit is named',
  pg_temp.refusal($q$select public.report_problem(pg_temp.pid(2), repeat('x', 201))$q$),
  'serverErrors.problemTitleTooLong {"limit": 200}');
select pg_temp.check('a description has a limit too',
  pg_temp.refusal($q$select public.report_problem(pg_temp.pid(2), 'x', repeat('y', 4001))$q$),
  'serverErrors.problemDescriptionTooLong {"limit": 4000}');
-- A report from her listing without a task: allowed, no task, no photos yet.
select public.report_problem(pg_temp.pid(2), 'Лампочка в коридоре', null, 'low', 900001801);
-- A general report with no listing at all.
select public.report_problem(pg_temp.pid(3), 'Сломалась тележка');
reset role; reset request.jwt.claims;

select pg_temp.check('a report without a task or listing has no listing',
  (pg_temp.problem(3)).property_id, null::bigint);

-- ---------- who sees what ----------
select pg_temp.as_maria();
select pg_temp.check('the reporter sees her reports',
  (select count(*)::int from public.problems), 3);
select pg_temp.as_anna();
select pg_temp.check('a colleague sees none of them',
  (select count(*)::int from public.problems), 0);
select pg_temp.as_tech();
select pg_temp.check('a technician sees nothing before being assigned',
  (select count(*)::int from public.problems), 0);
select pg_temp.as_boss();
select pg_temp.check('the manager sees them all',
  (select count(*)::int from public.problems), 3);
reset role; reset request.jwt.claims;

-- ---------- correcting the report ----------
select pg_temp.as_maria();
select public.update_problem(pg_temp.pid(1), 'Кран течёт сильно', 'Под раковиной лужа, капает', 'high');
select pg_temp.as_anna();
select pg_temp.check('a colleague cannot edit her report',
  pg_temp.refusal($q$select public.update_problem(pg_temp.pid(1), 'x')$q$),
  'serverErrors.problemNotFound');
reset role; reset request.jwt.claims;
select pg_temp.check('the reporter edits her open report',
  (pg_temp.problem(1)).title, 'Кран течёт сильно');

-- ---------- photos ----------
create or replace function pg_temp.upload(n integer) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id)
  select 'task-media', m.storage_path, m.created_by, m.created_by::text
  from public.task_media m where m.id = pg_temp.mid(n)
$$;

select pg_temp.as_maria();
select public.add_problem_media(pg_temp.mid(1), pg_temp.pid(1), 'image/jpeg', 500000, 1600, 1200, now());
select public.add_problem_media(pg_temp.mid(1), pg_temp.pid(1), 'image/jpeg', 500000, 1600, 1200, now());
select public.add_problem_media(pg_temp.mid(2), pg_temp.pid(1), 'image/jpeg', 500000, 1600, 1200, now());
select public.add_problem_media(pg_temp.mid(3), pg_temp.pid(1), 'image/webp', 500000, 1600, 1200, now());
select public.add_problem_media(pg_temp.mid(4), pg_temp.pid(1), 'image/jpeg', 500000, 1600, 1200, now());
select pg_temp.check('a fifth photo is refused, with the limit',
  pg_temp.refusal($q$select public.add_problem_media(pg_temp.mid(5), pg_temp.pid(1), 'image/jpeg', 1000)$q$),
  'serverErrors.mediaLimitReached {"limit": 4}');
select pg_temp.check('a video is not a photo',
  pg_temp.refusal($q$select public.add_problem_media(pg_temp.mid(5), pg_temp.pid(2), 'video/mp4', 1000)$q$),
  'serverErrors.mediaTypeInvalid');
select pg_temp.check('the path names the problem, not a task',
  (select storage_path from public.task_media where id = pg_temp.mid(1)),
  (pg_temp.problem(1)).host_id::text || '/problems/' || pg_temp.pid(1)::text || '/' || pg_temp.mid(1)::text || '.jpg');
select pg_temp.check('a replay returns the same row',
  (select count(*)::int from public.task_media where problem_id = pg_temp.pid(1)), 4);
select pg_temp.check('confirming before the file arrived is refused',
  pg_temp.refusal($q$select public.confirm_task_media(pg_temp.mid(1))$q$),
  'serverErrors.mediaNotUploaded');
select pg_temp.upload(1);
select public.confirm_task_media(pg_temp.mid(1));
select pg_temp.check('the file is confirmed once it is there',
  (select uploaded_at is not null from public.task_media where id = pg_temp.mid(1)), true);
select public.remove_task_media(pg_temp.mid(4));
select pg_temp.check('a photo can be taken back while the problem is open',
  (select deleted_at is not null from public.task_media where id = pg_temp.mid(4)), true);
reset role; reset request.jwt.claims;

select pg_temp.as_anna();
select pg_temp.check('a colleague cannot add photos to her report',
  pg_temp.refusal($q$select public.add_problem_media(pg_temp.mid(6), pg_temp.pid(1), 'image/jpeg', 1000)$q$),
  'serverErrors.problemNotFound');
select pg_temp.check('a colleague does not see the photos',
  (select count(*)::int from public.task_media where problem_id = pg_temp.pid(1)), 0);
do $$
begin
  -- The row is hidden from her, so the path is spelled out by hand.
  insert into storage.objects (bucket_id, name, owner)
  values ('task-media',
          public.default_host_id()::text || '/problems/' || pg_temp.pid(1)::text
            || '/' || pg_temp.mid(2)::text || '.jpg',
          'd8000002-0000-4000-8000-0000000000d2');
  raise exception 'FAIL a colleague uploaded onto her path';
exception when insufficient_privilege then
  raise notice 'ok  a colleague cannot upload onto her path';
end $$;
reset role; reset request.jwt.claims;

-- ---------- the manager hands it over ----------
select pg_temp.as_maria();
select pg_temp.check('a cleaner cannot assign',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(1), 'd8000003-0000-4000-8000-0000000000d3')$q$),
  'serverErrors.managerOnly');
reset role; reset request.jwt.claims;

select pg_temp.as_boss();
select pg_temp.check('a problem without a listing cannot be scheduled',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(3), 'd8000003-0000-4000-8000-0000000000d3')$q$),
  'serverErrors.problemNoProperty');
select pg_temp.check('the assignee must be an active member',
  pg_temp.refusal($q$select public.assign_problem(pg_temp.pid(1), 'd8000009-0000-4000-8000-0000000000d9')$q$),
  'serverErrors.problemAssigneeInvalid');
select public.assign_problem(pg_temp.pid(1), 'd8000003-0000-4000-8000-0000000000d3', current_date, null, '12:00');
reset role; reset request.jwt.claims;

select pg_temp.check('assigning creates a maintenance task',
  (pg_temp.fix_task(1)).type::text, 'maintenance');
select pg_temp.check('the task is assigned to the technician',
  (pg_temp.fix_task(1)).assignee_id, 'd8000003-0000-4000-8000-0000000000d3'::uuid);
select pg_temp.check('the task carries the description as its note',
  (pg_temp.fix_task(1)).notes, 'Под раковиной лужа, капает');
select pg_temp.check('the problem follows the task: assigned',
  (pg_temp.problem(1)).status::text, 'assigned');

select pg_temp.as_boss();
select public.assign_problem(pg_temp.pid(1), 'd8000002-0000-4000-8000-0000000000d2', current_date);
select public.assign_problem(pg_temp.pid(1), 'd8000003-0000-4000-8000-0000000000d3', current_date);
reset role; reset request.jwt.claims;
select pg_temp.check('reassigning moves the same task instead of adding one',
  (select count(*)::int from public.tasks where problem_id = pg_temp.pid(1)), 1);

select pg_temp.as_maria();
select pg_temp.check('once handed over the reporter can no longer edit',
  pg_temp.refusal($q$select public.update_problem(pg_temp.pid(1), 'x')$q$),
  'serverErrors.problemNotOpen');
select pg_temp.check('nor add photos',
  pg_temp.refusal($q$select public.add_problem_media(pg_temp.mid(6), pg_temp.pid(1), 'image/jpeg', 1000)$q$),
  'serverErrors.problemNotOpen');
reset role; reset request.jwt.claims;

-- ---------- the technician's side ----------
select pg_temp.as_tech();
select pg_temp.check('the technician sees the report once assigned',
  (select count(*)::int from public.problems), 1);
select pg_temp.check('and its photos',
  (select count(*)::int from public.task_media where problem_id = pg_temp.pid(1) and deleted_at is null), 3);
select pg_temp.check('and the file itself',
  (select count(*)::int from storage.objects
   where name = (select storage_path from public.task_media where id = pg_temp.mid(1))), 1);
update public.tasks set status = 'in_progress' where id = (pg_temp.fix_task(1)).id;
reset role; reset request.jwt.claims;

select pg_temp.check('the problem follows the task: in progress',
  (pg_temp.problem(1)).status::text, 'in_progress');
select pg_temp.check('the fix process is the problem template',
  (select string_agg(type::text, ',' order by sort_order) from public.task_steps
   where task_id = (pg_temp.fix_task(1)).id),
  'photos_before,task_note,cleaner_comment,photos_after');
select pg_temp.check('the task_note step shows the report',
  (select instructions from public.task_steps
   where task_id = (pg_temp.fix_task(1)).id and type = 'task_note'),
  'Под раковиной лужа, капает');

select pg_temp.as_tech();
select pg_temp.check('the finish gate holds the required steps',
  pg_temp.refusal($q$update public.tasks set status = 'done' where id = (pg_temp.fix_task(1)).id$q$),
  'serverErrors.requiredStepsLeft {"count": 3}');
reset role; reset request.jwt.claims;

-- ---------- closing ----------
select pg_temp.as_boss();
select public.resolve_problem(pg_temp.pid(1));
select public.resolve_problem(pg_temp.pid(1));
reset role; reset request.jwt.claims;
select pg_temp.check('the manager resolves by hand: the task is done',
  (select status::text from public.tasks where problem_id = pg_temp.pid(1)), 'done');
select pg_temp.check('and the problem is resolved with a stamp',
  (pg_temp.problem(1)).status::text || ' ' || ((pg_temp.problem(1)).resolved_at is not null)::text,
  'resolved true');

select pg_temp.as_boss();
select public.assign_problem(pg_temp.pid(2), 'd8000003-0000-4000-8000-0000000000d3');
select public.cancel_problem(pg_temp.pid(2), 'Лампочку уже поменяли');
select pg_temp.check('a resolved problem cannot be cancelled',
  pg_temp.refusal($q$select public.cancel_problem(pg_temp.pid(1))$q$),
  'serverErrors.problemNotOpen');
reset role; reset request.jwt.claims;
select pg_temp.check('cancelling closes the fix task too',
  (select status::text from public.tasks where problem_id = pg_temp.pid(2)), 'cancelled');
select pg_temp.check('the problem is cancelled with the reason',
  (pg_temp.problem(2)).status::text || ' ' || (pg_temp.problem(2)).cancel_reason,
  'cancelled Лампочку уже поменяли');

-- A fix attempt that is cancelled by hand puts the problem back on the board.
select pg_temp.as_maria();
select public.report_problem(pg_temp.pid(4), 'Дверь не закрывается', null, 'normal', 900001801);
select pg_temp.as_boss();
select public.assign_problem(pg_temp.pid(4), 'd8000003-0000-4000-8000-0000000000d3');
update public.tasks set status = 'cancelled' where problem_id = pg_temp.pid(4);
reset role; reset request.jwt.claims;
select pg_temp.check('a cancelled attempt reopens the problem',
  (pg_temp.problem(4)).status::text, 'open');
select pg_temp.as_boss();
select public.assign_problem(pg_temp.pid(4), 'd8000002-0000-4000-8000-0000000000d2');
reset role; reset request.jwt.claims;
select pg_temp.check('a second attempt gets a fresh task next to the cancelled one',
  (select string_agg(status::text, ',' order by status::text) from public.tasks where problem_id = pg_temp.pid(4)),
  'assigned,cancelled');

-- ---------- retention ----------
update public.problems set resolved_at = now() - interval '91 days' where id = pg_temp.pid(1);
select pg_temp.check('photos of a long-resolved problem are due, taken-back ones at once',
  (select array_agg(id order by created_at) from public.task_media_to_purge(100)
   where problem_id = pg_temp.pid(1)),
  array[pg_temp.mid(1), pg_temp.mid(2), pg_temp.mid(3), pg_temp.mid(4)]);
update public.problems set resolved_at = now() - interval '1 day' where id = pg_temp.pid(1);
select pg_temp.check('photos of a freshly resolved problem wait, only the taken-back one is due',
  (select array_agg(id) from public.task_media_to_purge(100) where problem_id = pg_temp.pid(1)),
  array[pg_temp.mid(4)]);

-- ---------- back to the board, and out of sight ----------
select pg_temp.as_maria();
select pg_temp.check('a cleaner cannot reopen a problem',
  pg_temp.refusal($q$select public.reopen_problem(pg_temp.pid(1))$q$),
  'serverErrors.managerOnly');
select pg_temp.check('nor archive one',
  pg_temp.refusal($q$select public.archive_problem(pg_temp.pid(1))$q$),
  'serverErrors.managerOnly');
select pg_temp.check('the reporter sees all four of her reports',
  (select count(*)::int from public.problems), 4);
reset role; reset request.jwt.claims;

select pg_temp.as_boss();
select public.reopen_problem(pg_temp.pid(1));
select public.reopen_problem(pg_temp.pid(1));
select public.reopen_problem(pg_temp.pid(2));
reset role; reset request.jwt.claims;
select pg_temp.check('a resolved problem reopens without its stamp',
  (pg_temp.problem(1)).status::text || ' ' || ((pg_temp.problem(1)).resolved_at is null)::text,
  'open true');
select pg_temp.check('the finished task stays as history, no attempt is live',
  (select string_agg(status::text, ',' order by status::text) from public.tasks where problem_id = pg_temp.pid(1)),
  'done');
select pg_temp.check('a cancelled problem reopens without its reason',
  (pg_temp.problem(2)).status::text || ' ' || coalesce((pg_temp.problem(2)).cancel_reason, '-'),
  'open -');

select pg_temp.as_boss();
select public.assign_problem(pg_temp.pid(1), 'd8000003-0000-4000-8000-0000000000d3');
reset role; reset request.jwt.claims;
select pg_temp.check('a reopened problem is handed out again next to its finished task',
  (select string_agg(status::text, ',' order by status::text) from public.tasks where problem_id = pg_temp.pid(1))
  || ' ' || (pg_temp.problem(1)).status::text,
  'assigned,done assigned');

select pg_temp.as_boss();
select public.archive_problem(pg_temp.pid(4));
select public.archive_problem(pg_temp.pid(4));
reset role; reset request.jwt.claims;
select pg_temp.check('archiving stamps the problem once',
  ((pg_temp.problem(4)).archived_at is not null), true);
select pg_temp.check('and cancels the live fix task, so the problem reads open',
  (select string_agg(status::text, ',' order by status::text) from public.tasks where problem_id = pg_temp.pid(4))
  || ' ' || (pg_temp.problem(4)).status::text,
  'cancelled,cancelled open');

select pg_temp.as_maria();
select pg_temp.check('the reporter no longer sees an archived problem',
  (select count(*)::int from public.problems), 3);
select pg_temp.as_anna();
select pg_temp.check('nor does the technician it was handed to',
  (select count(*)::int from public.problems where id = pg_temp.pid(4)), 0);
select pg_temp.as_boss();
select pg_temp.check('the manager still sees it',
  (select count(*)::int from public.problems where id = pg_temp.pid(4)), 1);
select public.unarchive_problem(pg_temp.pid(4));
select pg_temp.as_maria();
select pg_temp.check('restoring brings it back to the reporter',
  (select count(*)::int from public.problems), 4);
reset role; reset request.jwt.claims;
select pg_temp.check('with the stamp gone',
  ((pg_temp.problem(4)).archived_at is null), true);

-- ---------------------------------------------------------------------------
--  Where the app said the file came from
-- ---------------------------------------------------------------------------
--
-- `source` is a declaration, not a proof — the server cannot see a camera. So
-- what is checked here is that the declaration is recorded as made, that
-- silence is never read as "camera", and that the company's gallery switch now
-- holds on the server instead of merely hiding a button.

select pg_temp.as_maria();

select public.add_problem_media(pg_temp.mid(7), pg_temp.pid(2), 'image/jpeg', 500000);
select pg_temp.check('a build that says nothing is recorded as unknown, not as camera',
  (select source::text from public.task_media where id = pg_temp.mid(7)), 'unknown');

select public.add_problem_media(pg_temp.mid(8), pg_temp.pid(2), 'image/jpeg', 500000,
  null, null, null, 'camera');
select pg_temp.check('a file taken here says so',
  (select source::text from public.task_media where id = pg_temp.mid(8)), 'camera');

select pg_temp.check('the gallery is refused while the company keeps it shut',
  pg_temp.refusal($q$select public.add_problem_media(pg_temp.mid(9), pg_temp.pid(2),
    'image/jpeg', 500000, null, null, null, 'gallery')$q$),
  'serverErrors.galleryNotAllowed');

reset role; reset request.jwt.claims;
update public.hosts set gallery_allowed = true where id = (pg_temp.problem(1)).host_id;

select pg_temp.as_maria();
select public.add_problem_media(pg_temp.mid(9), pg_temp.pid(2), 'image/jpeg', 500000,
  null, null, null, 'gallery');
select pg_temp.check('once the company opens the gallery, a picked file is taken and says so',
  (select source::text from public.task_media where id = pg_temp.mid(9)), 'gallery');

select pg_temp.check('and a build that says nothing is refused outright, not recorded as unknown',
  pg_temp.refusal($q$select public.add_problem_media('e8000001-0000-4000-8000-00000000000a'::uuid, pg_temp.pid(2),
    'image/jpeg', 500000)$q$),
  'serverErrors.mediaSourceMissing');

-- The idempotent branch returns the row as it stands. If it did not, a second
-- call would be a way to rewrite 'gallery' into 'camera' — and the whole point
-- of the column is that nobody can.
select public.add_problem_media(pg_temp.mid(9), pg_temp.pid(2), 'image/jpeg', 500000,
  null, null, null, 'camera');
select pg_temp.check('a repeat call cannot rewrite where a file came from',
  (select source::text from public.task_media where id = pg_temp.mid(9)), 'gallery');
reset role; reset request.jwt.claims;

-- ---------------------------------------------------------------------------
--  A repair taken away takes the report with it
-- ---------------------------------------------------------------------------
--
-- `tasks_one_fix_per_problem` lets a cancelled attempt be replaced, so after a
-- second try BOTH technicians point at the problem — the one doing the work and
-- the one whose attempt was cancelled. Until 20260918110000 the second kept
-- reading the report for ever. He must not, and the conversation that hangs off
-- the report (F29) is why it stopped being a small thing.

select pg_temp.as_tech();
select pg_temp.check('the technician holding the repair reads the report',
  (select count(*)::int from public.problems where id = pg_temp.pid(1)), 1);

reset role; reset request.jwt.claims;
update public.tasks set status = 'cancelled' where problem_id = pg_temp.pid(1);

select pg_temp.as_tech();
select pg_temp.check('a cancelled attempt is not a membership card',
  (select count(*)::int from public.problems where id = pg_temp.pid(1)), 0);

-- 'done' is deliberately not in the exclusion list: whoever finished the repair
-- is still the person to ask what was actually done.
reset role; reset request.jwt.claims;
update public.tasks set status = 'done' where problem_id = pg_temp.pid(1);

select pg_temp.as_tech();
select pg_temp.check('but a finished one still is',
  (select count(*)::int from public.problems where id = pg_temp.pid(1)), 1);
reset role; reset request.jwt.claims;

rollback;
