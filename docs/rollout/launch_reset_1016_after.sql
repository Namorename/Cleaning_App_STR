-- Launch reset of 2026-10-16 (docs/launch-reset-2026-10-16.md): the check after each pass.
--   node scripts/cloud-read.mjs docs/rollout/launch_reset_1016_after.sql
-- Counts only. Expected
--   after pass 1 (files): media.marked_unpurged 0, media.marked_files 0, storage.orphans 0;
--   after pass 2 (rows): tasks.before_bound 0, problems 0, problem_events 0, supply 0, demo 0,
--     auth_users 1, profiles 1, keep 1, links 0, push_tokens 0 (unless the kept manager has a phone),
--     chat.threads_on_gone 0, media.rows_on_gone 0, storage.objects 0 (+ files of staying rows),
--     storage.orphans 0, reservations.ended_before_bound — 0 right after, then the bookings the
--     nightly sync and webhooks bring back (pass 3), tasks.on_ended_booking 0;
--   after the Hotel insert: hotel.exists 1, never_synced true, in_analytics_test_band false,
--     bookings 0, tasks 0, links 0.
with b as (
  select date '2026-10-15' as bound, 900000000001::bigint as demo
)
select jsonb_build_object(
  'tasks', (select jsonb_build_object(
      'all', count(*),
      'before_bound', count(*) filter (where t.scheduled_date < b.bound),
      'repairs', count(*) filter (where t.problem_id is not null),
      'by_status', (select jsonb_object_agg(s, n) from (
          select status::text s, count(*) n from public.tasks group by 1) x),
      'assignee_without_profile', count(*) filter (
          where t.assignee_id is not null and not exists (select 1 from public.profiles p where p.id = t.assignee_id)),
      'on_ended_booking', count(*) filter (where t.reservation_id in (
          select r.id from public.reservations r where r.departure_date < b.bound)),
      'without_booking', count(*) filter (where t.reservation_id is null))
    from public.tasks t, b),
  'problems', (select count(*) from public.problems),
  'problem_events', (select count(*) from public.problem_events),
  'supply', (select count(*) from public.supply_requests) + (select count(*) from public.supply_request_items),
  'demo', (select count(*) from public.properties where id = 900000000001)
          + (select count(*) from public.tasks where property_id = 900000000001),
  'hotel', (select jsonb_build_object(
      'exists', count(*),
      'named_hotel_elsewhere', (select count(*) from public.properties x
                                where lower(x.name) = 'hotel' and x.id <> 800000000001),
      'status', max(h.status::text),
      'timezone', max(h.timezone),
      'never_synced', bool_and(h.synced_at is null),
      'in_analytics_test_band', bool_or(h.id between 900000000000 and 999999999999),
      'bookings', (select count(*) from public.reservations r where r.property_id = 800000000001),
      'tasks', (select count(*) from public.tasks t where t.property_id = 800000000001),
      'links', (select count(*) from public.property_cleaners c where c.property_id = 800000000001))
    from public.properties h where h.id = 800000000001),
  'reservations', (select jsonb_build_object(
      'all', count(*),
      'ended_before_bound', count(*) filter (where r.departure_date < b.bound),
      'ended_before_bound_newest_sync', max(r.synced_at) filter (where r.departure_date < b.bound),
      'raw_all', (select count(*) from raw.hostaway_reservations),
      'raw_without_booking', (select count(*) from raw.hostaway_reservations h
                              where not exists (select 1 from public.reservations x where x.id = h.id)))
    from public.reservations r, b),
  'auth_users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'keep', (select count(*) from auth.users u join public.profiles p on p.id = u.id
           where lower(u.email) = 'wagnerstays@gmail.com' and p.role = 'manager' and p.is_active),
  'links', (select count(*) from public.property_cleaners),
  'push_tokens', (select count(*) from public.push_tokens),
  'push_outbox_unsettled', (select count(*) from raw.push_outbox where settled_at is null),
  'chat', (select jsonb_build_object(
      'threads', count(*),
      'threads_on_gone', count(*) filter (where c.problem_id is not null
          or c.task_id in (select t.id from public.tasks t, b where t.scheduled_date < b.bound)),
      'messages', (select count(*) from public.chat_messages))
    from public.chat_threads c),
  'media', (select jsonb_build_object(
      'rows', count(*),
      'rows_on_gone', count(*) filter (where m.problem_id is not null
          or m.task_id in (select t.id from public.tasks t, b
                           where t.scheduled_date < b.bound or t.property_id = b.demo
                              or t.problem_id is not null)
          or m.message_id in (select cm.id from public.chat_messages cm
                              join public.chat_threads ct on ct.id = cm.thread_id
                              where ct.problem_id is not null
                                 or ct.task_id in (select t.id from public.tasks t, b
                                                   where t.scheduled_date < b.bound
                                                      or t.property_id = b.demo))),
      'marked_unpurged', count(*) filter (where m.deleted_at is not null and m.purged_at is null),
      'marked_files', count(*) filter (where m.deleted_at is not null and exists (
          select 1 from storage.objects o where o.bucket_id = 'task-media' and o.name = m.storage_path)))
    from public.task_media m),
  'storage', (select jsonb_build_object(
      'objects', count(*),
      'bytes', coalesce(sum((o.metadata->>'size')::bigint), 0),
      'orphans', count(*) filter (where not exists (
          select 1 from public.task_media m where m.storage_path = o.name)))
    from storage.objects o where o.bucket_id = 'task-media'),
  'task_events', (select jsonb_build_object(
      'all', count(*),
      'unassigned_system', count(*) filter (where e.kind = 'unassigned' and e.cause = 'system'),
      'actor_without_profile', count(*) filter (
          where e.actor_id is not null and not exists (select 1 from public.profiles p where p.id = e.actor_id)))
    from public.task_events e)
) as r;
