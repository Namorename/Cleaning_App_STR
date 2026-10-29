-- A video is held to the company's numbers of now (20261023100000,
-- docs/video-limits-1023.md). Run: npm run test:rls. Rolls back; the database
-- stays clean.
--
-- What is being protected: on 22.10 the company went to 180 s / 140 MB while
-- 25 started cleanings kept the 90 or 120 s their step had copied from the
-- process at the start, and add_task_media took the smaller. Now:
--   - an unfinished cleaning takes a video by the company's length of the
--     moment, whatever its step copied, raised or lowered;
--   - the size is the company's of the moment, as before;
--   - a finished step, and a cleaning done, are left as they were;
--   - a cleaning that starts copies no length, so the builds in the field,
--     which take min(copy ?? company, company), agree with the server;
--   - the process's own box changes nothing any more;
--   - the signatures and the grants are those of before.
--
-- Fixture ids live in the 9000370xx range and under b37….
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

insert into public.hosts (id, name) values ('b3700000-0000-4000-8000-00000000000a', 'Host L');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b3700001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.live@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b3700005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.live@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb);
update public.profiles set host_id = 'b3700000-0000-4000-8000-00000000000a'
where id in ('b3700001-0000-4000-8000-000000000001', 'b3700005-0000-4000-8000-000000000005');

insert into public.properties (id, host_id, name, timezone) values
  (900037001, 'b3700000-0000-4000-8000-00000000000a', 'Flat with copies', 'UTC');

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
  select pg_temp.as_user('b3700001-0000-4000-8000-000000000001') $fn$;
create or replace function pg_temp.as_anna() returns void language sql as $fn$
  select pg_temp.as_user('b3700005-0000-4000-8000-000000000005') $fn$;

create or replace function pg_temp.task(n integer) returns uuid language sql immutable as $fn$
  select ('b3702001-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $fn$;
create or replace function pg_temp.mid(n integer) returns uuid language sql immutable as $fn$
  select ('b3705001-0000-4000-8000-0000000000' || lpad(n::text, 2, '0'))::uuid $fn$;
/** The video step of cleaning n. */
create or replace function pg_temp.step(n integer) returns uuid language sql as $fn$
  select s.id from public.task_steps s where s.task_id = pg_temp.task(n) and s.type = 'video' $fn$;

/** A video from the gallery, the way the phones of 1.2.0 register one. */
create or replace function pg_temp.video(n integer, task integer, bytes integer, seconds numeric)
returns text language sql as $fn$
  select pg_temp.refusal(format(
    'select public.add_task_media(p_id => %L, p_step_id => %L, p_kind => %L, '
    'p_mime_type => %L, p_byte_size => %s, p_width => 1280, p_height => 720, '
    'p_duration_sec => %s, p_device_taken_at => now(), p_source => %L)',
    pg_temp.mid(n), pg_temp.step(task), 'video', 'video/mp4', bytes, seconds, 'gallery'))
$fn$;

-- ---------------------------------------------------------------------------
--  Cleanings started before: their steps hold copies of 90, 120 and 300 s
-- ---------------------------------------------------------------------------

-- No process yet, so the start copies nothing and the steps are written as
-- the cleanings of 18–22.10 have them.
insert into public.tasks (id, host_id, property_id, type, status, assignee_id, scheduled_date)
select pg_temp.task(n), 'b3700000-0000-4000-8000-00000000000a', 900037001, 'cleaning',
       'in_progress', 'b3700005-0000-4000-8000-000000000005', current_date
from generate_series(1, 7) n;
insert into public.task_steps (task_id, host_id, sort_order, type, required, max_video_sec, completed_at)
select pg_temp.task(n), 'b3700000-0000-4000-8000-00000000000a', 1, 'video', true,
       case n when 1 then 90 when 2 then 120 when 3 then 300 when 4 then 120
              when 5 then 90 when 6 then 90 else 90 end,
       case when n in (6, 7) then now() end
from generate_series(1, 7) n;
-- Cleaning 7 is done; cleaning 6 has its video step done but is still under way.
update public.tasks set status = 'done' where id = pg_temp.task(7);

select pg_temp.as_boss();
select public.update_host_settings(p_gallery_allowed => true, p_video_max_sec => 180,
                                   p_video_bitrate_kbps => 2500, p_video_max_mb => 140);

select pg_temp.as_anna();
select pg_temp.check('a cleaning started under 90 s takes 150 s by the company''s 180',
  pg_temp.video(1, 1, 60000000, 150), 'no refusal');
select pg_temp.check('one started under 120 s takes the company''s 180 and its tolerance',
  pg_temp.video(2, 2, 60000000, 181.5), 'no refusal');
select pg_temp.check('a copy asking for more than the company gives no more',
  pg_temp.video(3, 3, 60000000, 200), 'serverErrors.videoTooLong {"limit": 180}');
select pg_temp.check('the size is the company''s of the moment',
  pg_temp.video(5, 5, 141000000, 60), 'serverErrors.mediaTooLarge {"limit_mb": 140}');

-- The manager lowers the length: the lower number holds at once.
select pg_temp.as_boss();
select public.update_host_settings(p_video_max_sec => 60);
select pg_temp.as_anna();
select pg_temp.check('a company that lowered its length is obeyed at once',
  pg_temp.video(4, 4, 30000000, 90), 'serverErrors.videoTooLong {"limit": 60}');
select pg_temp.as_boss();
select public.update_host_settings(p_video_max_sec => 180);

-- What is finished stays finished.
select pg_temp.as_anna();
select pg_temp.check('a finished step takes no video, whatever the company allows',
  pg_temp.video(6, 6, 30000000, 30), 'serverErrors.stepCompleted');
select pg_temp.check('nor does a cleaning that is done',
  pg_temp.video(7, 7, 30000000, 30), 'serverErrors.stepNotFound');
reset role; reset request.jwt.claims;
select pg_temp.check('and their copies are what they were',
  (select array_agg(s.max_video_sec order by s.task_id) from public.task_steps s
   where s.task_id in (pg_temp.task(6), pg_temp.task(7))),
  array[90, 90]);
select pg_temp.check('the videos that went in are the ones counted above',
  (select count(*)::int from public.task_media m where m.host_id = 'b3700000-0000-4000-8000-00000000000a'), 2);

-- ---------------------------------------------------------------------------
--  Cleanings that start now
-- ---------------------------------------------------------------------------

-- The process the manager left with 45 s in its video length box.
insert into public.workflow_templates (id, host_id, scope, name) values
  ('b3701000-0000-4000-8000-000000000001', 'b3700000-0000-4000-8000-00000000000a', 'cleaning', 'L process');
insert into public.workflow_steps (template_id, host_id, sort_order, type, required, max_video_sec) values
  ('b3701000-0000-4000-8000-000000000001', 'b3700000-0000-4000-8000-00000000000a', 1, 'video', true, 45);

insert into public.tasks (id, host_id, property_id, type, status, assignee_id, scheduled_date) values
  (pg_temp.task(8), 'b3700000-0000-4000-8000-00000000000a', 900037001, 'cleaning',
   'in_progress', 'b3700005-0000-4000-8000-000000000005', current_date);
select pg_temp.check('a cleaning that starts copies its steps, the video step among them',
  (select count(*)::int from public.task_steps where task_id = pg_temp.task(8) and type = 'video'), 1);
select pg_temp.check('but no video length',
  (select max_video_sec from public.task_steps where id = pg_temp.step(8)), null::integer);
select pg_temp.check('the rule of the 1.2.0 builds, min(copy ?? company, company), reads the company''s on it',
  (select least(coalesce(s.max_video_sec, h.video_max_sec), h.video_max_sec)
   from public.task_steps s join public.hosts h on h.id = s.host_id where s.id = pg_temp.step(8)),
  180);
select pg_temp.as_anna();
select pg_temp.check('so the process''s 45 s does not reach the new cleaning',
  pg_temp.video(8, 8, 30000000, 100), 'no refusal');
reset role; reset request.jwt.claims;

-- ---------------------------------------------------------------------------
--  The same functions, the same grants
-- ---------------------------------------------------------------------------

select pg_temp.check('one add_task_media, callable by the signed-in and not by anon',
  array[(select count(*)::int from pg_proc where proname = 'add_task_media'
         and pronamespace = 'public'::regnamespace)::text,
        has_function_privilege('authenticated',
          'public.add_task_media(uuid, uuid, public.media_kind, text, integer, integer, integer, numeric, timestamptz, public.media_source)',
          'EXECUTE')::text,
        has_function_privilege('anon',
          'public.add_task_media(uuid, uuid, public.media_kind, text, integer, integer, integer, numeric, timestamptz, public.media_source)',
          'EXECUTE')::text],
  array['1', 'true', 'false']);
select pg_temp.check('one snapshot_task_steps, still the trigger of the start',
  (select count(*)::int from pg_trigger t join pg_proc p on p.oid = t.tgfoid
   where t.tgname = 'tasks_snapshot_workflow' and p.proname = 'snapshot_task_steps'), 1);
select pg_temp.check('both still security definer with an empty search_path',
  (select array_agg(p.proname || ':' || p.prosecdef::text || ':' || coalesce(array_to_string(p.proconfig, ','), '-')
                    order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname in ('add_task_media', 'snapshot_task_steps')),
  array['add_task_media:true:search_path=""', 'snapshot_task_steps:true:search_path=""']);

rollback;
