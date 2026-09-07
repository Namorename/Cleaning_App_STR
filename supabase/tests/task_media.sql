-- Photos and videos of a cleaning, and the steps that ask for them.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: a media row is created only by the assignee of a
-- task in progress, on a step of the matching type, within the step's limits;
-- a file counts only once it is confirmed to be in the bucket; the step is
-- completed from what the table holds, never from what the phone claims; a
-- completed step keeps its media until reopened; the bucket admits exactly
-- the path a pending row is waiting for; everyone reads what they may read
-- of the step and nothing across the company line; and retention hands the
-- purge job the right rows.
--
-- Fixture ids live in the 9000016xx range; tasks and media have fixed uuids
-- so the checks can name them.
begin;

insert into public.hosts (id, name) values
  ('b6000000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('d6000001-0000-4000-8000-0000000000d1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','maria.media@test.local','x',now(),now(),
   '{"full_name":"Maria"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d6000002-0000-4000-8000-0000000000d2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.media@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('d6000003-0000-4000-8000-0000000000d3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.media@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('d6000004-0000-4000-8000-0000000000d4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','cleaner.b.media@test.local','x',now(),now(),
   '{"full_name":"Cleaner B"}'::jsonb, '{"role":"cleaner"}'::jsonb);

update public.profiles set host_id = 'b6000000-0000-4000-8000-00000000000b'
where id = 'd6000004-0000-4000-8000-0000000000d4';

insert into public.properties (id, name, timezone, check_in_time, check_out_time) values
  (900001601, 'Flat with cameras', 'UTC', '15:00', '10:00');

insert into public.tasks (id, property_id, type, status, assignee_id, scheduled_date) values
  ('a6000001-0000-4000-8000-000000000001', 900001601, 'cleaning', 'assigned',
   'd6000001-0000-4000-8000-0000000000d1', current_date),
  ('a6000001-0000-4000-8000-000000000002', 900001601, 'cleaning', 'assigned',
   'd6000001-0000-4000-8000-0000000000d1', current_date),
  ('a6000001-0000-4000-8000-000000000003', 900001601, 'cleaning', 'assigned',
   'd6000002-0000-4000-8000-0000000000d2', current_date);

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

/** Run a statement expecting a refusal; returns the hint and detail it came with. */
create or replace function pg_temp.refusal(statement text)
returns text language plpgsql as $$
declare
  v_hint   text;
  v_detail text;
begin
  execute statement;
  return 'no refusal';
exception when check_violation then
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  return v_hint || coalesce(' ' || nullif(v_detail, ''), '');
end $$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;
create or replace function pg_temp.as_maria() returns void language sql as $$
  select pg_temp.as_user('d6000001-0000-4000-8000-0000000000d1')
$$;
create or replace function pg_temp.as_anna() returns void language sql as $$
  select pg_temp.as_user('d6000002-0000-4000-8000-0000000000d2')
$$;
create or replace function pg_temp.as_boss() returns void language sql as $$
  select pg_temp.as_user('d6000003-0000-4000-8000-0000000000d3')
$$;
create or replace function pg_temp.as_cleaner_b() returns void language sql as $$
  select pg_temp.as_user('d6000004-0000-4000-8000-0000000000d4')
$$;

create or replace function pg_temp.task(n integer)
returns public.tasks language sql as $$
  select t.* from public.tasks t
  where t.id = ('a6000001-0000-4000-8000-00000000000' || n)::uuid
$$;

create or replace function pg_temp.step(n integer, kind public.workflow_step_type)
returns public.task_steps language sql as $$
  select s.* from public.task_steps s
  where s.task_id = ('a6000001-0000-4000-8000-00000000000' || n)::uuid and s.type = kind
$$;

create or replace function pg_temp.media(n integer)
returns public.task_media language sql as $$
  select m.* from public.task_media m
  where m.id = ('e6000001-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

create or replace function pg_temp.media_id(n integer)
returns uuid language sql as $$
  select ('e6000001-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid
$$;

/** What the phone does between add and confirm, done by hand. */
create or replace function pg_temp.upload(n integer) returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner, owner_id)
  select 'task-media', m.storage_path, m.created_by, m.created_by::text
  from public.task_media m where m.id = pg_temp.media_id(n)
$$;

-- ---------- the process ----------
--
-- A listing override: photos before (required, one to two), a video (optional,
-- thirty seconds), photos after (required, limits left to the defaults), and
-- a confirmation to have a step that is not about media.
select pg_temp.as_boss();
select public.save_workflow_template($json${
  "scope": "cleaning", "property_id": 900001601, "name": "With cameras",
  "steps": [
    {"type": "photos_before", "required": true, "min_photos": 1, "max_photos": 2},
    {"type": "video", "required": false, "max_video_sec": 30},
    {"type": "photos_after", "required": true},
    {"type": "confirmation", "required": false, "title": "Lights off"}
  ]}$json$);
reset role; reset request.jwt.claims;

select pg_temp.check('the media steps are live in this build',
  (select count(*)::int from unnest(public.workflow_supported_step_types()) t
   where t in ('photos_before', 'photos_after', 'video')), 3);

select pg_temp.as_maria();
update public.tasks set status = 'in_progress' where id = (pg_temp.task(1)).id;
update public.tasks set status = 'in_progress' where id = (pg_temp.task(2)).id;
reset role; reset request.jwt.claims;

select pg_temp.check('the snapshot carries the media steps',
  (select count(*)::int from public.task_steps where task_id = (pg_temp.task(1)).id), 4);
select pg_temp.check('with their limits',
  (pg_temp.step(1, 'photos_before')).max_photos, 2::smallint);

-- ---------- registering a photo ----------
select pg_temp.as_maria();
select public.add_task_media(pg_temp.media_id(1), (pg_temp.step(1, 'photos_before')).id,
  'photo', 'image/jpeg', 1200000, 1600, 1200, null, now());
reset role; reset request.jwt.claims;

select pg_temp.check('the row knows where its file goes',
  (pg_temp.media(1)).storage_path,
  (pg_temp.media(1)).host_id::text || '/' || (pg_temp.task(1)).id::text || '/'
    || pg_temp.media_id(1)::text || '.jpg');
select pg_temp.check('and waits for it',
  (pg_temp.media(1)).uploaded_at is null, true);
select pg_temp.check('and remembers who took it',
  (pg_temp.media(1)).created_by, 'd6000001-0000-4000-8000-0000000000d1'::uuid);

select pg_temp.as_maria();
select pg_temp.check('registering the same id again returns the same row',
  (public.add_task_media(pg_temp.media_id(1), (pg_temp.step(1, 'photos_before')).id,
     'photo', 'image/jpeg', 1200000)).storage_path,
  (pg_temp.media(1)).storage_path);
select pg_temp.check('and does not add a second one',
  (select count(*)::int from public.task_media
   where step_id = (pg_temp.step(1, 'photos_before')).id), 1);

-- ---------- what is refused ----------
select pg_temp.check('a type the bucket does not take',
  pg_temp.refusal($q$select public.add_task_media(pg_temp.media_id(90),
    (pg_temp.step(1, 'photos_before')).id, 'photo', 'image/gif', 1000)$q$),
  'serverErrors.mediaTypeInvalid');
select pg_temp.check('a photo with a video type',
  pg_temp.refusal($q$select public.add_task_media(pg_temp.media_id(90),
    (pg_temp.step(1, 'photos_before')).id, 'photo', 'video/mp4', 1000)$q$),
  'serverErrors.mediaTypeInvalid');
select pg_temp.check('a video on a photo step',
  pg_temp.refusal($q$select public.add_task_media(pg_temp.media_id(90),
    (pg_temp.step(1, 'photos_before')).id, 'video', 'video/mp4', 1000, null, null, 10)$q$),
  'serverErrors.mediaKindMismatch');
select pg_temp.check('a photo heavier than the bound',
  pg_temp.refusal($q$select public.add_task_media(pg_temp.media_id(90),
    (pg_temp.step(1, 'photos_before')).id, 'photo', 'image/jpeg', 21 * 1024 * 1024)$q$),
  'serverErrors.mediaTooLarge {"limit_mb": 20}');

select public.add_task_media(pg_temp.media_id(2), (pg_temp.step(1, 'photos_before')).id,
  'photo', 'image/webp', 800000, 1600, 1200, null, now());
select pg_temp.check('a third photo where the step allows two',
  pg_temp.refusal($q$select public.add_task_media(pg_temp.media_id(3),
    (pg_temp.step(1, 'photos_before')).id, 'photo', 'image/jpeg', 1000)$q$),
  'serverErrors.mediaLimitReached {"limit": 2}');
reset role; reset request.jwt.claims;

select pg_temp.as_anna();
select pg_temp.check('another cleaner cannot add to her step',
  pg_temp.refusal($q$select public.add_task_media(pg_temp.media_id(90),
    (pg_temp.step(1, 'photos_before')).id, 'photo', 'image/jpeg', 1000)$q$),
  'serverErrors.stepNotFound');
select pg_temp.check('nor confirm her photo',
  pg_temp.refusal($q$select public.confirm_task_media(pg_temp.media_id(1))$q$),
  'serverErrors.mediaNotFound');
select pg_temp.check('nor remove it',
  pg_temp.refusal($q$select public.remove_task_media(pg_temp.media_id(1))$q$),
  'serverErrors.mediaNotFound');
reset role; reset request.jwt.claims;

-- ---------- the file has to arrive ----------
select pg_temp.as_maria();
select pg_temp.check('a step with files on their way is not completed',
  pg_temp.refusal($q$select public.complete_task_step((pg_temp.step(1, 'photos_before')).id)$q$),
  'serverErrors.mediaUploadPending {"count": 2}');
select pg_temp.check('confirming before the object exists is refused',
  pg_temp.refusal($q$select public.confirm_task_media(pg_temp.media_id(1))$q$),
  'serverErrors.mediaNotUploaded');
reset role; reset request.jwt.claims;

select pg_temp.upload(1);
select pg_temp.as_maria();
select public.confirm_task_media(pg_temp.media_id(1));
reset role; reset request.jwt.claims;
select pg_temp.check('once it does, the row is confirmed',
  (pg_temp.media(1)).uploaded_at is not null, true);

select pg_temp.as_maria();
select pg_temp.check('confirming again changes nothing',
  (public.confirm_task_media(pg_temp.media_id(1))).uploaded_at, (pg_temp.media(1)).uploaded_at);

-- ---------- taking one back, completing, reopening ----------
select public.remove_task_media(pg_temp.media_id(2));
select pg_temp.check('a removed photo is marked, not deleted',
  (pg_temp.media(2)).deleted_at is not null, true);
select pg_temp.check('removing it again is harmless',
  (public.remove_task_media(pg_temp.media_id(2))).deleted_at, (pg_temp.media(2)).deleted_at);

select public.complete_task_step((pg_temp.step(1, 'photos_before')).id);
select pg_temp.check('the step answers with the confirmed media',
  (pg_temp.step(1, 'photos_before')).payload,
  jsonb_build_object('media_ids', jsonb_build_array(pg_temp.media_id(1))));
select pg_temp.check('whatever the phone sent as payload',
  (public.complete_task_step((pg_temp.step(1, 'photos_before')).id,
     '{"media_ids": ["not-mine"]}'::jsonb)).payload,
  jsonb_build_object('media_ids', jsonb_build_array(pg_temp.media_id(1))));

select pg_temp.check('a completed step keeps its media',
  pg_temp.refusal($q$select public.remove_task_media(pg_temp.media_id(1))$q$),
  'serverErrors.stepCompleted');
select pg_temp.check('and takes no more',
  pg_temp.refusal($q$select public.add_task_media(pg_temp.media_id(3),
    (pg_temp.step(1, 'photos_before')).id, 'photo', 'image/jpeg', 1000)$q$),
  'serverErrors.stepCompleted');

select public.reopen_task_step((pg_temp.step(1, 'photos_before')).id);
select public.remove_task_media(pg_temp.media_id(1));
select pg_temp.check('with every photo taken back the step cannot be completed',
  pg_temp.refusal($q$select public.complete_task_step((pg_temp.step(1, 'photos_before')).id)$q$),
  'serverErrors.photosMissing {"min": 1}');

select public.add_task_media(pg_temp.media_id(3), (pg_temp.step(1, 'photos_before')).id,
  'photo', 'image/jpeg', 900000, 1600, 1200, null, now() - interval '1 minute');
select public.add_task_media(pg_temp.media_id(4), (pg_temp.step(1, 'photos_before')).id,
  'photo', 'image/jpeg', 900000, 1600, 1200, null, now());
reset role; reset request.jwt.claims;
select pg_temp.upload(3);
select pg_temp.upload(4);
select pg_temp.as_maria();
select public.confirm_task_media(pg_temp.media_id(3));
select public.confirm_task_media(pg_temp.media_id(4));
select public.complete_task_step((pg_temp.step(1, 'photos_before')).id);
select pg_temp.check('the answer lists the photos in the order they were taken',
  (pg_temp.step(1, 'photos_before')).payload->'media_ids',
  jsonb_build_array(pg_temp.media_id(3), pg_temp.media_id(4)));

-- ---------- defaults where the manager set nothing ----------
select pg_temp.check('a photo step with no minimum still asks for one photo',
  pg_temp.refusal($q$select public.complete_task_step((pg_temp.step(1, 'photos_after')).id)$q$),
  'serverErrors.photosMissing {"min": 1}');

-- ---------- video ----------
select pg_temp.check('a video step asks for a video',
  pg_temp.refusal($q$select public.complete_task_step((pg_temp.step(1, 'video')).id)$q$),
  'serverErrors.videoMissing');
select pg_temp.check('a video without a duration',
  pg_temp.refusal($q$select public.add_task_media(pg_temp.media_id(90),
    (pg_temp.step(1, 'video')).id, 'video', 'video/mp4', 5000000)$q$),
  'serverErrors.videoDurationMissing');
select pg_temp.check('a video longer than the step allows',
  pg_temp.refusal($q$select public.add_task_media(pg_temp.media_id(90),
    (pg_temp.step(1, 'video')).id, 'video', 'video/mp4', 5000000, null, null, 45)$q$),
  'serverErrors.videoTooLong {"limit": 30}');
select public.add_task_media(pg_temp.media_id(5), (pg_temp.step(1, 'video')).id,
  'video', 'video/quicktime', 5000000, 1280, 720, 20.5, now());
select pg_temp.check('one video per step',
  pg_temp.refusal($q$select public.add_task_media(pg_temp.media_id(90),
    (pg_temp.step(1, 'video')).id, 'video', 'video/mp4', 5000000, null, null, 10)$q$),
  'serverErrors.mediaLimitReached {"limit": 1}');
reset role; reset request.jwt.claims;
select pg_temp.check('the video keeps its length',
  (pg_temp.media(5)).duration_sec, 20.5::numeric);
select pg_temp.upload(5);
select pg_temp.as_maria();
select public.confirm_task_media(pg_temp.media_id(5));
select public.complete_task_step((pg_temp.step(1, 'video')).id);
select pg_temp.check('the video step answers with its one video',
  (pg_temp.step(1, 'video')).payload->'media_ids', jsonb_build_array(pg_temp.media_id(5)));

-- ---------- the finish gate ----------
select pg_temp.check('the required photo step holds the finish',
  pg_temp.refusal($q$update public.tasks set status = 'done' where id = (pg_temp.task(1)).id$q$),
  'serverErrors.requiredStepsLeft {"count": 1}');
select public.add_task_media(pg_temp.media_id(6), (pg_temp.step(1, 'photos_after')).id,
  'photo', 'image/jpeg', 700000, 1600, 1200, null, now());
reset role; reset request.jwt.claims;
select pg_temp.upload(6);
select pg_temp.as_maria();
select public.confirm_task_media(pg_temp.media_id(6));
select public.complete_task_step((pg_temp.step(1, 'photos_after')).id);
update public.tasks set status = 'done' where id = (pg_temp.task(1)).id;
reset role; reset request.jwt.claims;
select pg_temp.check('with the photos in, the task finishes',
  (pg_temp.task(1)).status::text, 'done');

-- ---------- who reads what ----------
select pg_temp.as_maria();
select pg_temp.check('the assignee reads the media of her task',
  (select count(*)::int from public.task_media where task_id = (pg_temp.task(1)).id), 6);
select pg_temp.as_anna();
select pg_temp.check('another cleaner reads none of it',
  (select count(*)::int from public.task_media where task_id = (pg_temp.task(1)).id), 0);
select pg_temp.as_boss();
select pg_temp.check('the manager reads all of it',
  (select count(*)::int from public.task_media where task_id = (pg_temp.task(1)).id), 6);
select pg_temp.as_cleaner_b();
select pg_temp.check('and another company reads nothing',
  (select count(*)::int from public.task_media), 0);
reset role; reset request.jwt.claims;

select pg_temp.check('nobody writes the table directly',
  has_table_privilege('authenticated', 'public.task_media', 'INSERT'), false);
select pg_temp.check('anon reads nothing',
  has_table_privilege('anon', 'public.task_media', 'SELECT'), false);
select pg_temp.check('anon cannot register media',
  has_function_privilege('anon',
    'public.add_task_media(uuid, uuid, public.media_kind, text, integer, integer, integer, numeric, timestamptz)',
    'execute'), false);
select pg_temp.check('the phone has no say in retention',
  has_function_privilege('authenticated', 'public.task_media_to_purge(integer)', 'execute'), false);

-- ---------- the bucket ----------
select pg_temp.check('the bucket exists and is private',
  (select public from storage.buckets where id = 'task-media'), false);

select pg_temp.as_maria();
select public.add_task_media(pg_temp.media_id(7), (pg_temp.step(2, 'photos_before')).id,
  'photo', 'image/jpeg', 700000, 1600, 1200, null, now());
insert into storage.objects (bucket_id, name, owner, owner_id)
values ('task-media', (pg_temp.media(7)).storage_path,
        'd6000001-0000-4000-8000-0000000000d1', 'd6000001-0000-4000-8000-0000000000d1');
select pg_temp.check('the cleaner uploads onto the path her row is waiting for',
  (select count(*)::int from storage.objects where name = (pg_temp.media(7)).storage_path), 1);
reset role; reset request.jwt.claims;

select pg_temp.as_maria();
do $$
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('task-media', (pg_temp.media(7)).host_id::text || '/elsewhere.jpg',
          'd6000001-0000-4000-8000-0000000000d1');
  raise exception 'FAIL a path no row is waiting for was accepted';
exception when insufficient_privilege then
  raise notice 'ok  a path no row is waiting for is refused';
end $$;
do $$
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('task-media', (pg_temp.media(7)).storage_path, 'd6000001-0000-4000-8000-0000000000d1');
  raise exception 'FAIL the same path was accepted twice';
exception when unique_violation or insufficient_privilege then
  raise notice 'ok  the same path is not accepted twice';
end $$;
reset role; reset request.jwt.claims;

select pg_temp.as_maria();
select public.add_task_media(pg_temp.media_id(8), (pg_temp.step(2, 'photos_before')).id,
  'photo', 'image/jpeg', 700000, 1600, 1200, null, now());
reset role; reset request.jwt.claims;
select pg_temp.as_anna();
do $$
begin
  insert into storage.objects (bucket_id, name, owner)
  values ('task-media', (pg_temp.media(8)).storage_path, 'd6000002-0000-4000-8000-0000000000d2');
  raise exception 'FAIL another cleaner uploaded onto her path';
exception when insufficient_privilege then
  raise notice 'ok  another cleaner cannot upload onto her path';
end $$;
select pg_temp.check('another cleaner does not see her file',
  (select count(*)::int from storage.objects where name = (pg_temp.media(7)).storage_path), 0);
select pg_temp.as_boss();
select pg_temp.check('the manager sees the file',
  (select count(*)::int from storage.objects where name = (pg_temp.media(7)).storage_path), 1);
reset role; reset request.jwt.claims;

-- ---------- retention ----------
select pg_temp.check('the files taken back are due at once',
  (select array_agg(id order by created_at) from public.task_media_to_purge(100)),
  array[pg_temp.media_id(1), pg_temp.media_id(2)]);
select pg_temp.check('marking them purged reports the count',
  public.mark_task_media_purged(array[pg_temp.media_id(1), pg_temp.media_id(2)]), 2);
select pg_temp.check('and they are not offered again',
  (select count(*)::int from public.task_media_to_purge(100)), 0);
select pg_temp.check('nor marked twice',
  public.mark_task_media_purged(array[pg_temp.media_id(1)]), 0);

update public.tasks set completed_at = now() - interval '89 days' where id = (pg_temp.task(1)).id;
select pg_temp.check('a task closed 89 days ago keeps its files',
  (select count(*)::int from public.task_media_to_purge(100)), 0);
update public.tasks set completed_at = now() - interval '91 days' where id = (pg_temp.task(1)).id;
select pg_temp.check('at 91 days they are due',
  (select count(*)::int from public.task_media_to_purge(100)), 4);
select pg_temp.check('in batches of the size asked for',
  (select count(*)::int from public.task_media_to_purge(3)), 3);
select pg_temp.check('a task still open keeps its files however old',
  (select count(*)::int from public.task_media_to_purge(100)
   where task_id = (pg_temp.task(2)).id), 0);

rollback;
