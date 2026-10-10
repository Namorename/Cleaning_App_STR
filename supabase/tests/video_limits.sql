-- The company's video limits (docs/tech-plan.md, 7.1 and 7.2; owner's
-- decisions 10 and 12 of 2026-10-01). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: three numbers in hosts — the length, the video
-- bitrate, the size of a file — with defaults of the free plan (120 s, 2000
-- kbit/s, 45 MB) and bounds a typo cannot pass; every person of the company
-- reads them, only a manager writes them, and the old panel's call leaves
-- them alone. add_task_media holds a video to them: from the gallery only
-- where the company opened the gallery (20261010100000),
-- no larger than the company allows, no longer than the step or the company
-- allows with a small tolerance — and a phone on 1.1.0, which sends exactly
-- today's arguments, is held by the new rules without changing anything.
-- Photos are as they were.
--
-- Fixture ids live in the 9000350xx range and under b35….
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values
  ('b3500000-0000-4000-8000-00000000000a', 'Host V'),
  ('b3500000-0000-4000-8000-00000000000b', 'Host O');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b3500001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.video@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b3500005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.video@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b3500009-0000-4000-8000-000000000009','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','olga.video@test.local','x',now(),now(),
   '{"full_name":"Olga"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'b3500000-0000-4000-8000-00000000000a'
where id in ('b3500001-0000-4000-8000-000000000001', 'b3500005-0000-4000-8000-000000000005');
update public.profiles set host_id = 'b3500000-0000-4000-8000-00000000000b'
where id = 'b3500009-0000-4000-8000-000000000009';

insert into public.properties (id, host_id, name, timezone) values
  (900035001, 'b3500000-0000-4000-8000-00000000000a', 'Flat with a camera', 'UTC');

-- Anna's cleaning, under way, with a photo step and video steps: one with no
-- length of its own, one of thirty seconds, one asking for more than the
-- company allows.
insert into public.tasks (id, host_id, property_id, type, status, assignee_id, scheduled_date) values
  ('b3502001-0000-4000-8000-000000000001', 'b3500000-0000-4000-8000-00000000000a', 900035001,
   'cleaning', 'in_progress', 'b3500005-0000-4000-8000-000000000005', current_date);
insert into public.task_steps (id, task_id, host_id, sort_order, type, required, max_video_sec)
select ('b3504001-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid,
       'b3502001-0000-4000-8000-000000000001', 'b3500000-0000-4000-8000-00000000000a', n,
       case when n = 1 then 'photos_before' else 'video' end::public.workflow_step_type, false,
       case when n = 10 then 30 when n = 11 then 300 end
from generate_series(1, 11) n;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

/** The i18n key and parameters of a refusal, its SQLSTATE without a key, or 'no refusal'. */
create or replace function pg_temp.refusal(stmt text) returns text
language plpgsql as $fn$
declare
  v_hint   text;
  v_detail text;
begin
  execute stmt;
  return 'no refusal';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  if v_hint is null or v_hint not like 'serverErrors.%' then
    return sqlstate;
  end if;
  return v_hint || coalesce(' ' || nullif(v_detail, ''), '');
end $fn$;

create or replace function pg_temp.as_user(sub text) returns void language sql as $fn$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$fn$;
create or replace function pg_temp.as_boss() returns void language sql as $fn$
  select pg_temp.as_user('b3500001-0000-4000-8000-000000000001') $fn$;
create or replace function pg_temp.as_anna() returns void language sql as $fn$
  select pg_temp.as_user('b3500005-0000-4000-8000-000000000005') $fn$;
create or replace function pg_temp.as_olga() returns void language sql as $fn$
  select pg_temp.as_user('b3500009-0000-4000-8000-000000000009') $fn$;

create or replace function pg_temp.step(n integer) returns uuid language sql immutable as $fn$
  select ('b3504001-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $fn$;
create or replace function pg_temp.mid(n integer) returns uuid language sql immutable as $fn$
  select ('b3505001-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $fn$;

-- A video the way build 1.1.0 registers one: every argument it sends today,
-- by name, and nothing else.
create or replace function pg_temp.video(n integer, step integer, bytes integer, seconds numeric,
                                         source text default 'camera')
returns text language sql as $fn$
  select pg_temp.refusal(format(
    'select public.add_task_media(p_id => %L, p_step_id => %L, p_kind => %L, '
    'p_mime_type => %L, p_byte_size => %s, p_width => 1280, p_height => 720, '
    'p_duration_sec => %s, p_device_taken_at => now(), p_source => %s)',
    pg_temp.mid(n), pg_temp.step(step), 'video', 'video/mp4', bytes, seconds,
    coalesce(quote_literal(source), 'null')))
$fn$;

-- ---------------------------------------------------------------------------
--  The three numbers
-- ---------------------------------------------------------------------------

select pg_temp.check('a company starts on the free plan: two minutes, 2 Mbit/s, 45 MB',
  (select array[video_max_sec, video_bitrate_kbps, video_max_mb] from public.hosts
   where id = 'b3500000-0000-4000-8000-00000000000a'),
  array[120, 2000, 45]);
select pg_temp.check('a length outside 10 s to 10 min is no setting',
  pg_temp.refusal($q$update public.hosts set video_max_sec = 5
                     where id = 'b3500000-0000-4000-8000-00000000000a'$q$), '23514');
select pg_temp.check('nor a bitrate outside 500 to 20 000 kbit/s',
  pg_temp.refusal($q$update public.hosts set video_bitrate_kbps = 100000
                     where id = 'b3500000-0000-4000-8000-00000000000a'$q$), '23514');
select pg_temp.check('nor a file over what the bucket holds',
  pg_temp.refusal($q$update public.hosts set video_max_mb = 500
                     where id = 'b3500000-0000-4000-8000-00000000000a'$q$), '23514');

select pg_temp.as_anna();
select pg_temp.check('the phone reads them where it reads whether the gallery is allowed',
  (select array[video_max_sec, video_bitrate_kbps, video_max_mb]
   from public.hosts where gallery_allowed is not null),
  array[120, 2000, 45]);
select pg_temp.check('and a cleaner does not set them',
  pg_temp.refusal($q$select public.update_host_settings(p_video_max_sec => 180)$q$),
  'serverErrors.managerOnly');

select pg_temp.as_boss();
select public.update_host_settings(p_video_max_sec => 180, p_video_bitrate_kbps => 4500,
                                   p_video_max_mb => 140);
select pg_temp.check('the manager switches the company to Pro in one call',
  (select array[video_max_sec, video_bitrate_kbps, video_max_mb] from public.hosts),
  array[180, 4500, 140]);
-- The panel of today sends one switch at a time, and nothing about video.
select public.update_host_settings(p_gallery_allowed => true);
select public.update_host_settings(p_parallel_start_allowed => false);
select pg_temp.check('the old panel''s call leaves the video alone',
  (select array[video_max_sec, video_bitrate_kbps, video_max_mb] from public.hosts),
  array[180, 4500, 140]);
select pg_temp.check('a length out of bounds is refused with the bounds',
  pg_temp.refusal($q$select public.update_host_settings(p_video_max_sec => 5)$q$),
  'serverErrors.videoSettingOutOfRange {"max": 600, "min": 10, "field": "video_max_sec"}');
select pg_temp.check('so is a bitrate',
  pg_temp.refusal($q$select public.update_host_settings(p_video_bitrate_kbps => 100)$q$),
  'serverErrors.videoSettingOutOfRange {"max": 20000, "min": 500, "field": "video_bitrate_kbps"}');
select pg_temp.check('and a size',
  pg_temp.refusal($q$select public.update_host_settings(p_video_max_mb => 151)$q$),
  'serverErrors.videoSettingOutOfRange {"max": 150, "min": 5, "field": "video_max_mb"}');
select pg_temp.check('a refused call changes nothing',
  (select array[video_max_sec, video_bitrate_kbps, video_max_mb] from public.hosts),
  array[180, 4500, 140]);
-- Back to the free plan, and the gallery open for photos.
select public.update_host_settings(p_video_max_sec => 120, p_video_bitrate_kbps => 2000,
                                   p_video_max_mb => 45);

select pg_temp.as_olga();
select pg_temp.check('another company''s manager writes only her own',
  (select array[video_max_sec, video_max_mb]
   from public.update_host_settings(p_video_max_sec => 60, p_video_max_mb => 20)),
  array[60, 20]);
reset role; reset request.jwt.claims;
select pg_temp.check('and ours is untouched',
  (select array[video_max_sec, video_max_mb] from public.hosts
   where id = 'b3500000-0000-4000-8000-00000000000a'),
  array[120, 45]);

-- ---------------------------------------------------------------------------
--  A video from the field
-- ---------------------------------------------------------------------------

select pg_temp.as_anna();
select pg_temp.check('a camera video inside the limits goes in, as 1.1.0 sends it',
  pg_temp.video(1, 2, 30000000, 100), 'no refusal');
select pg_temp.check('a video from the gallery goes in where the company opened the gallery',
  pg_temp.video(13, 7, 30000000, 100, 'gallery'), 'no refusal');
select pg_temp.check('and is recorded as from the gallery',
  (select source::text from public.task_media where id = pg_temp.mid(13)), 'gallery');
select pg_temp.check('held to the company''s length like a camera one',
  pg_temp.video(14, 8, 30000000, 123, 'gallery'), 'serverErrors.videoTooLong {"limit": 120}');
select pg_temp.check('and to its size',
  pg_temp.video(16, 8, 45000001, 100, 'gallery'), 'serverErrors.mediaTooLarge {"limit_mb": 45}');
select pg_temp.check('while a photo from it still does: photos are as they were',
  pg_temp.refusal(format(
    'select public.add_task_media(p_id => %L, p_step_id => %L, p_kind => %L, '
    'p_mime_type => %L, p_byte_size => 400000, p_source => %L)',
    pg_temp.mid(12), pg_temp.step(1), 'photo', 'image/jpeg', 'gallery')),
  'no refusal');
select pg_temp.check('nor one larger than the company allows',
  pg_temp.video(3, 3, 45000001, 100), 'serverErrors.mediaTooLarge {"limit_mb": 45}');
select pg_temp.check('nor one longer than the company allows',
  pg_temp.video(4, 3, 30000000, 123), 'serverErrors.videoTooLong {"limit": 120}');
select pg_temp.check('but a second over is the phone''s timer, not a longer video',
  pg_temp.video(5, 3, 30000000, 121.5), 'no refusal');
select pg_temp.check('a step''s own shorter length still holds',
  pg_temp.video(6, 10, 5000000, 33), 'serverErrors.videoTooLong {"limit": 30}');
select pg_temp.check('with the same tolerance',
  pg_temp.video(7, 10, 5000000, 31), 'no refusal');
select pg_temp.check('a step asking for more than the company allows gets the company''s',
  pg_temp.video(8, 11, 30000000, 150), 'serverErrors.videoTooLong {"limit": 120}');
-- With the gallery closed, a build that does not say where a file came from
-- is taken as before; with it open, such a file is refused as before
-- (mediaSourceMissing, supabase/tests/task_media.sql).
select pg_temp.as_boss();
select public.update_host_settings(p_gallery_allowed => false);
select pg_temp.as_anna();
select pg_temp.check('a build that says nothing of the source is taken as before',
  pg_temp.video(9, 4, 30000000, 60, null), 'no refusal');
select pg_temp.check('and recorded as unknown',
  (select source::text from public.task_media where id = pg_temp.mid(9)), 'unknown');
select pg_temp.check('while a video from the gallery is refused once the gallery is closed',
  pg_temp.video(15, 9, 30000000, 60, 'gallery'), 'serverErrors.galleryNotAllowed');

-- On Pro, the same phone sends longer and larger files with no build and no OTA.
select pg_temp.as_boss();
select public.update_host_settings(p_video_max_sec => 180, p_video_max_mb => 140);
select pg_temp.as_anna();
select pg_temp.check('on Pro a three-minute, 100 MB video goes in',
  pg_temp.video(10, 5, 100000000, 175), 'no refusal');
select pg_temp.check('and the bucket''s own bound still holds above the company''s',
  pg_temp.video(11, 6, 160000000, 100), 'serverErrors.mediaTooLarge {"limit_mb": 150}');

reset role; reset request.jwt.claims;

select pg_temp.check('the tolerance is a named constant every reader may call',
  array[public.task_media_video_tolerance_sec()::text,
        has_function_privilege('authenticated', 'public.task_media_video_tolerance_sec()', 'EXECUTE')::text,
        has_function_privilege('anon', 'public.task_media_video_tolerance_sec()', 'EXECUTE')::text],
  array['2', 'true', 'false']);
select pg_temp.check('the settings call is the manager''s, never anon''s',
  array[has_function_privilege('authenticated',
          'public.update_host_settings(boolean, boolean, integer, integer, integer)', 'EXECUTE'),
        has_function_privilege('anon',
          'public.update_host_settings(boolean, boolean, integer, integer, integer)', 'EXECUTE')],
  array[true, false]);
select pg_temp.check('and there is one of it: the old panel''s call finds no second',
  (select count(*)::int from pg_proc where proname = 'update_host_settings'
   and pronamespace = 'public'::regnamespace), 1);

rollback;
