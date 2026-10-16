-- Launch reset of 2026-10-16, stage 2, pass 2: the rows, in one transaction
-- (docs/launch-reset-2026-10-16.md; the owner's decisions of 2026-10-16).
--
-- What goes: every cleaning dated before 2026-10-15 (Prague) with its steps, media rows, chat,
-- journal and push queue; every problem with its repairs, journal, media rows and chat; every
-- supply request; the demo listing 900000000001 with its cleanings and links; every booking that
-- ended before 2026-10-15 with its rooms (and its raw copy, c_drop_raw_bookings); every account
-- but the one manager wagnerstays@gmail.com, with their links, devices, push queue and direct chats.
-- What stays: bookings from 2026-10-15 on and their cleanings, taken off the people who go;
-- listings, templates, checklists, the company, raw.generator_runs, raw.webhook_events.
--
-- Gates, each rolls the whole pass back: not exactly one kept manager; a media row of the reset
-- that pass 1 has not purged; staying work started by a person who goes; any count after the
-- deletes that is not what the plan says.
--
-- Triggers are not switched off. Under `db query` there is no auth.uid(), so the guards on tasks
-- return at once; the push triggers return at once because no device token is left (step 1);
-- deleting a booking only nulls tasks.reservation_id, which no journal trigger watches; the
-- journal entries this pass itself writes (staying cleanings taken off a person) are removed at
-- the end when c_drop_reset_events is true.
--
-- Run with the owner's word, after pass 1 is checked, outside 03:00–04:40 UTC:
--   npx supabase db query --linked -f docs/one-off-writes/launch-reset-1016-pass2.sql
-- Then: node scripts/cloud-read.mjs docs/rollout/launch_reset_1016_after.sql
do $$
declare
  c_bound      constant date   := date '2026-10-15';
  c_demo       constant bigint := 900000000001;
  c_keep_email constant text   := 'wagnerstays@gmail.com';
  -- The owner's choices (plan, «Вопросы»); the values are the plan's recommendation.
  c_drop_raw_bookings  constant boolean := true;
  c_drop_reset_events  constant boolean := true;
  v_started timestamptz := clock_timestamp();
  v_keep    uuid;
  v_gone    uuid[];
  v_n       bigint;
  v_log     text := '';
begin
  perform set_config('lock_timeout', '20s', true);

  -- 0. Gates.
  select u.id into strict v_keep
  from auth.users u join public.profiles p on p.id = u.id
  where lower(u.email) = c_keep_email and p.role = 'manager' and p.is_active;

  select coalesce(array_agg(u.id), '{}') into v_gone from auth.users u where u.id <> v_keep;

  create temp table reset_gone_tasks on commit drop as
    select t.id from public.tasks t
    where t.scheduled_date < c_bound or t.property_id = c_demo or t.problem_id is not null;

  if exists (
    select 1 from public.task_media m
    where m.purged_at is null
      and (m.problem_id is not null
           or m.task_id in (select id from reset_gone_tasks)
           or m.message_id in (select cm.id
                               from public.chat_messages cm
                               join public.chat_threads ct on ct.id = cm.thread_id
                               where ct.problem_id is not null
                                  or ct.profile_id = any (v_gone)
                                  or ct.task_id in (select id from reset_gone_tasks)))
  ) then
    raise exception 'a media row of the reset still has its file: run pass 1 and wait for purged_at';
  end if;

  if exists (
    select 1 from public.tasks t
    where t.assignee_id = any (v_gone)
      and t.status in ('in_progress', 'paused', 'blocked')
      and t.id not in (select id from reset_gone_tasks)
  ) then
    raise exception 'a staying task is started by a person who goes: settle it in the panel first';
  end if;

  -- 1. No push from here on: the push triggers return when no device token exists.
  delete from public.push_tokens where profile_id = any (v_gone);
  get diagnostics v_n = row_count; v_log := v_log || format(' push_tokens=%s', v_n);

  -- 2. Supply requests (their items cascade).
  delete from public.supply_requests;
  get diagnostics v_n = row_count; v_log := v_log || format(' supply_requests=%s', v_n);

  -- 3. Repairs before their problems: tasks.problem_id is ON DELETE SET NULL, and a repair
  --    without its problem would look like a manual job.
  delete from public.tasks where problem_id is not null;
  get diagnostics v_n = row_count; v_log := v_log || format(' repairs=%s', v_n);

  -- 4. Problems (journal, media rows, chat threads cascade).
  delete from public.problems;
  get diagnostics v_n = row_count; v_log := v_log || format(' problems=%s', v_n);

  -- 5. Cleanings before the bound and on the demo listing (steps, media rows, chat threads,
  --    task_events, push queue cascade).
  delete from public.tasks where id in (select id from reset_gone_tasks);
  get diagnostics v_n = row_count; v_log := v_log || format(' tasks=%s', v_n);

  -- 6. The demo listing (links, templates, checklists, notes, bookings cascade).
  delete from public.properties where id = c_demo;
  get diagnostics v_n = row_count; v_log := v_log || format(' demo_listing=%s', v_n);

  -- 7. Staying cleanings held by people who go are taken off them. Closed ones keep their status.
  update public.tasks set assignee_id = null
   where assignee_id = any (v_gone) and status in ('done', 'cancelled', 'expired');
  get diagnostics v_n = row_count; v_log := v_log || format(' taken_off_closed=%s', v_n);
  update public.tasks set assignee_id = null, status = 'unassigned'
   where assignee_id = any (v_gone) and status in ('assigned', 'accepted');
  get diagnostics v_n = row_count; v_log := v_log || format(' taken_off_live=%s', v_n);

  -- 8. Bookings that ended before the bound (rooms cascade; no staying task points at them).
  --    The raw copy mirrors public.reservations row for row (the probe's raw_without_booking is
  --    0 before the pass), so a raw row without its booking is exactly one deleted here.
  delete from public.reservations where departure_date < c_bound or property_id = c_demo;
  get diagnostics v_n = row_count; v_log := v_log || format(' bookings=%s', v_n);
  if c_drop_raw_bookings then
    delete from raw.hostaway_reservations h
     where not exists (select 1 from public.reservations r where r.id = h.id);
    get diagnostics v_n = row_count; v_log := v_log || format(' raw_bookings=%s', v_n);
  end if;

  -- 9. Accounts: profiles cascade from auth.users, and with them links, push preferences,
  --    push queue and tickets, direct chats, read marks; authorship columns become null.
  delete from auth.users where id = any (v_gone);
  get diagnostics v_n = row_count; v_log := v_log || format(' accounts=%s', v_n);

  -- 10. The journal entries this pass wrote in step 7.
  if c_drop_reset_events then
    delete from public.task_events e
     where e.at >= v_started and e.kind = 'unassigned'
       and e.params->>'from' = any (v_gone::text[]);
    get diagnostics v_n = row_count; v_log := v_log || format(' reset_events=%s', v_n);
  end if;

  -- 11. Checks.
  if exists (select 1 from public.tasks where scheduled_date < c_bound or problem_id is not null
                                           or property_id = c_demo) then
    raise exception 'tasks of the reset remain';
  end if;
  if exists (select 1 from public.problems) or exists (select 1 from public.supply_requests) then
    raise exception 'problems or supply requests remain';
  end if;
  if exists (select 1 from public.reservations where departure_date < c_bound) then
    raise exception 'bookings that ended before the bound remain';
  end if;
  if exists (select 1 from public.properties where id = c_demo) then
    raise exception 'the demo listing remains';
  end if;
  if (select count(*) from auth.users) <> 1 or (select count(*) from public.profiles) <> 1
     or not exists (select 1 from public.profiles where id = v_keep and is_active) then
    raise exception 'accounts: expected exactly the kept manager';
  end if;
  if exists (select 1 from public.property_cleaners) then
    raise exception 'links remain';
  end if;
  if exists (select 1 from public.tasks t
             where t.assignee_id is not null
               and not exists (select 1 from public.profiles p where p.id = t.assignee_id)) then
    raise exception 'a task points at a deleted person';
  end if;

  raise notice 'launch reset pass 2 done:%', v_log;
end
$$;
