-- Retention keeps the work (the owner's word of 2026-11-11: tasks pile up and are never removed).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: every retention job, run exactly as cron runs it, and the one-off strip of
-- the raw layer leave the rows of the work untouched — cleanings and tasks, their steps, journals and
-- closing history, comments (chat), task themes, plans and their steps, requests for supplies. Media
-- rows only get their purged_at mark: the files go after 90 days (purge-task-media), the rows stay.
--
-- A raw booking has no foreign key from anywhere: deleting it moves nothing. A booking's row in
-- public.reservations is never deleted by a retention job, only its guest_name cleared, so the
-- cleaning keeps its reservation_id.
--
-- Every value below is synthetic. Fixture ids live in the 900090xxx range and the fa90… uuids.
begin;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

-- ===========================================================================
-- Fixtures: an old stay with its work, all of it due for every purge there is
-- ===========================================================================

insert into public.hosts (id, name) values ('fa900000-0000-4000-8000-00000000000a', 'Keeps work co');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('fa900001-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'cleaner.kw@test.local', 'x', now(), now(), '{"full_name":"Cleaner"}', '{"role":"cleaner"}'),
  ('fa900002-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated',
   'authenticated', 'boss.kw@test.local', 'x', now(), now(), '{"full_name":"Boss"}', '{"role":"manager"}');

update public.profiles set host_id = 'fa900000-0000-4000-8000-00000000000a'
where id in ('fa900001-0000-4000-8000-000000000001', 'fa900002-0000-4000-8000-000000000002');

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time)
values (900090001, 'fa900000-0000-4000-8000-00000000000a', 'Keeps work flat', 'UTC', '15:00', '10:00');

-- A stay that ended 200 days ago: its raw copy, its name and its failed webhook event are all due.
insert into public.reservations (id, host_id, property_id, arrival_date, departure_date, status, guest_name, is_block)
values (900090011, 'fa900000-0000-4000-8000-00000000000a', 900090001, current_date - 203, current_date - 200,
        'new', 'Synthetic Guest', false);

insert into raw.hostaway_reservations (id, data, synced_at)
values (900090011, jsonb_build_object(
          'id', 900090011, 'listingMapId', 900090001, 'status', 'new',
          'arrivalDate', to_char(current_date - 203, 'YYYY-MM-DD'),
          'departureDate', to_char(current_date - 200, 'YYYY-MM-DD'),
          'guestName', 'Synthetic Guest', 'guestEmail', 'synthetic@example.invalid', 'phone', '+000',
          'guestNote', 'synthetic note', 'guestPortalUrl', 'https://example.invalid/portal',
          'doorCode', '0000', 'customFieldValues', '[]'::jsonb,
          'reservationUnit', '[{"id": 1, "listingUnitId": 1, "guestName": "Synthetic Guest"}]'::jsonb),
        now() - interval '200 days');

insert into raw.webhook_events (object_type, object_id, event_type, payload, status, received_at)
values ('reservation', 900090011, 'reservation.updated', '{}', 'failed', now() - interval '200 days');

-- Its cleaning, closed long ago, with a step, a comment thread and a media row 200 days old.
insert into public.tasks (id, host_id, property_id, reservation_id, type, status, scheduled_date, assignee_id)
values ('fa900010-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-00000000000a', 900090001, 900090011,
        'cleaning', 'assigned', current_date - 200, 'fa900001-0000-4000-8000-000000000001');
update public.tasks set status = 'in_progress' where id = 'fa900010-0000-4000-8000-000000000001';
update public.tasks set status = 'done' where id = 'fa900010-0000-4000-8000-000000000001';
update public.tasks set completed_at = now() - interval '200 days', updated_at = now() - interval '200 days'
where id = 'fa900010-0000-4000-8000-000000000001';

insert into public.task_steps (id, task_id, host_id, sort_order, type, required)
values ('fa900011-0000-4000-8000-000000000001', 'fa900010-0000-4000-8000-000000000001',
        'fa900000-0000-4000-8000-00000000000a', 1, 'photos_before', true);

insert into public.chat_threads (id, host_id, kind, task_id, last_message_at, last_author_id, message_count)
values ('fa900012-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-00000000000a', 'task',
        'fa900010-0000-4000-8000-000000000001', now() - interval '200 days',
        'fa900001-0000-4000-8000-000000000001', 1);
insert into public.chat_messages (id, host_id, thread_id, author_id, author_role, body, created_at)
values ('fa900013-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-00000000000a',
        'fa900012-0000-4000-8000-000000000001', 'fa900001-0000-4000-8000-000000000001', 'cleaner',
        'Synthetic comment', now() - interval '200 days');

insert into public.task_media (id, host_id, task_id, step_id, kind, storage_path, mime_type, byte_size,
                               created_by, created_at, uploaded_at)
values ('fa900014-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-00000000000a',
        'fa900010-0000-4000-8000-000000000001', 'fa900011-0000-4000-8000-000000000001', 'photo',
        'fa900000-0000-4000-8000-00000000000a/fa900010-0000-4000-8000-000000000001/synthetic.jpg',
        'image/jpeg', 1000, 'fa900001-0000-4000-8000-000000000001', now() - interval '200 days',
        now() - interval '200 days');

-- A task on the flat, with a theme set by hand, and a plan with a step.
insert into public.problems (id, host_id, property_id, reported_by, title, status)
values ('fa900020-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-00000000000a', 900090001,
        'fa900001-0000-4000-8000-000000000001', 'Synthetic tap', 'open');
insert into public.problem_themes (problem_id, theme, source, detector)
values ('fa900020-0000-4000-8000-000000000001', (select min(code) from public.issue_themes), 'manual', 'manual');

insert into public.resolution_plans (id, host_id, property_id, title, created_by)
values ('fa900030-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-00000000000a', 900090001,
        'Synthetic plan', 'fa900002-0000-4000-8000-000000000002');
insert into public.resolution_plan_steps (id, plan_id, host_id, theme, kind, title, sort_order)
values ('fa900031-0000-4000-8000-000000000001', 'fa900030-0000-4000-8000-000000000001', 'fa900000-0000-4000-8000-00000000000a',
        (select min(code) from public.issue_themes), 'repair', 'Synthetic step', 1);

select pg_temp.check('0 the fixtures have their journals and closing history',
  (select count(*) from public.task_events where task_id = 'fa900010-0000-4000-8000-000000000001') > 0
  and (select count(*) from public.task_closings where task_id = 'fa900010-0000-4000-8000-000000000001') = 1
  and (select count(*) from public.problem_events where problem_id = 'fa900020-0000-4000-8000-000000000001') > 0,
  true);

-- ===========================================================================
-- Every row of the work, before
-- ===========================================================================

create temp table work_tables (name text primary key);
insert into work_tables values
  ('tasks'), ('task_steps'), ('task_events'), ('task_closings'), ('closing_marks'),
  ('problems'), ('problem_events'), ('problem_themes'), ('chat_threads'), ('chat_messages'),
  ('resolution_plans'), ('resolution_plan_steps'), ('supply_requests'), ('supply_request_items');

create function pg_temp.fingerprint(p_table text) returns text language plpgsql as $fn$
declare
  v text;
begin
  execute format('select count(*) || '':'' || coalesce(md5(string_agg(t::text, ''|'' order by t::text)), ''-'') '
                 'from public.%I t', p_table) into v;
  return v;
end $fn$;

-- task_media: the purge marks purged_at and nothing else.
create function pg_temp.media_fingerprint() returns text language sql as $fn$
  select count(*) || ':' || coalesce(md5(string_agg((to_jsonb(m) - 'purged_at')::text, '|' order by m.id)), '-')
  from public.task_media m $fn$;

create temp table before_purges as
select name, pg_temp.fingerprint(name) as print from work_tables;
create temp table media_before as select pg_temp.media_fingerprint() as print;

-- ===========================================================================
-- Every retention job, as cron runs it (cron.job, 2026-11-11), and the one-off strip
-- ===========================================================================

select raw.purge_guest_data();                                                -- purge-guest-data 05:55
select public.purge_signal_stays();                                           -- purge-signal-stays 05:00
select public.purge_signal_data();                                            -- purge-signal-data 05:05
delete from raw.signal_runs where ran_at < now() - interval '180 days';       -- purge-signal-runs 05:10
select public.purge_guest_message_links();                                    -- purge-guest-message-links 05:20
delete from raw.webhook_events                                                -- purge-webhook-events 03:50
where status in ('processed', 'skipped') and received_at < now() - interval '30 days';
delete from raw.generator_runs where ran_at < now() - interval '90 days';     -- purge-generator-runs 03:45
delete from public.api_request_log where created_at < now() - interval '90 days';   -- purge-api-records 04:05
delete from public.api_rate_windows where window_start < now() - interval '1 day';
delete from public.api_idempotency where created_at < now() - interval '1 day';
select public.purge_push_history();                                           -- push-history-purge 02:40
-- purge-task-media 04:30: the Edge function removes the files of these rows, then marks them.
select public.mark_task_media_purged(array(select m.id from public.task_media_to_purge(10000) m));
-- The one-off «чистка raw» (docs/one-off-writes/guest-data-retention-backfill.sql).
update raw.hostaway_reservations h set data = raw.strip_hostaway_reservation(h.data)
where h.data is distinct from raw.strip_hostaway_reservation(h.data);
update raw.hostaway_listings l set data = raw.strip_hostaway_listing(l.data)
where l.data is distinct from raw.strip_hostaway_listing(l.data);

-- ===========================================================================
-- After: the purges did their work, and the work is as it was
-- ===========================================================================

select pg_temp.check('1 the old raw booking is gone',
  (select count(*) from raw.hostaway_reservations where id = 900090011), 0::bigint);

select pg_temp.check('2 its failed webhook event is gone',
  (select count(*) from raw.webhook_events where object_id = 900090011), 0::bigint);

select pg_temp.check('3 the booking row stays, without the guest''s name',
  (select guest_name is null and departure_date = current_date - 200
   from public.reservations where id = 900090011), true);

select pg_temp.check('4 the cleaning still points at its booking',
  (select reservation_id from public.tasks where id = 'fa900010-0000-4000-8000-000000000001'), 900090011::bigint);

select pg_temp.check('5 the media row is marked purged and stays',
  (select purged_at is not null from public.task_media where id = 'fa900014-0000-4000-8000-000000000001'), true);

select pg_temp.check('6 every row of the work is unchanged: ' || w.name,
  pg_temp.fingerprint(w.name), b.print)
from work_tables w join before_purges b using (name)
order by w.name;

select pg_temp.check('7 media rows are unchanged but for purged_at',
  pg_temp.media_fingerprint(), (select print from media_before));

select pg_temp.check('8 the task''s hand-set theme stays',
  (select source from public.problem_themes where problem_id = 'fa900020-0000-4000-8000-000000000001'), 'manual');

-- No foreign key leads from the raw layer to anything: a raw booking's delete cascades nowhere.
select pg_temp.check('9 nothing references the raw bookings or listings',
  (select count(*) from pg_constraint
   where contype = 'f' and confrelid in ('raw.hostaway_reservations'::regclass, 'raw.hostaway_listings'::regclass)),
  0::bigint);

rollback;
