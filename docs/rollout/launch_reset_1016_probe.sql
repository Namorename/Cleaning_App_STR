-- Launch reset of 2026-10-16 (docs/launch-reset-2026-10-16.md): what each table holds and what the
-- reset would delete. Run before every pass and keep the answer in the plan's log.
--   node scripts/cloud-read.mjs docs/rollout/launch_reset_1016_probe.sql
-- Counts only, no personal fields. The sets here are the ones the passes in docs/one-off-writes/
-- delete; a change to one is a change to both.
--   bound   2026-10-15 00:00 Europe/Prague (every listing is Prague or Berlin, so local dates compare as dates)
--   demo    listing 900000000001 with everything on it
--   keep    the one active manager whose e-mail is wagnerstays@gmail.com; every other account goes
with b as (
  select date '2026-10-15' as bound, 900000000001::bigint as demo
),
keep as (
  select p.id from public.profiles p join auth.users u on u.id = p.id
  where lower(u.email) = 'wagnerstays@gmail.com' and p.role = 'manager' and p.is_active
),
gone_people as (
  select u.id from auth.users u where u.id not in (select id from keep)
),
gone_res as (
  select r.id from public.reservations r, b where r.departure_date < b.bound or r.property_id = b.demo
),
gone_tasks as (
  select t.id from public.tasks t, b
  where t.scheduled_date < b.bound or t.property_id = b.demo or t.problem_id is not null
),
gone_threads as (
  select c.id from public.chat_threads c
  where c.task_id in (select id from gone_tasks) or c.problem_id is not null
     or c.profile_id in (select id from gone_people)
),
gone_messages as (
  select m.id from public.chat_messages m where m.thread_id in (select id from gone_threads)
),
gone_media as (
  select m.* from public.task_media m
  where m.task_id in (select id from gone_tasks) or m.problem_id is not null
     or m.message_id in (select id from gone_messages)
),
staying_tasks as (
  select t.* from public.tasks t where t.id not in (select id from gone_tasks)
)
select jsonb_build_object(
  'tasks', (select jsonb_build_object(
      'now', count(*),
      'before_bound', count(*) filter (where t.scheduled_date < b.bound),
      'demo', count(*) filter (where t.property_id = b.demo),
      'demo_after_bound', count(*) filter (where t.property_id = b.demo and t.scheduled_date >= b.bound),
      'repairs', count(*) filter (where t.problem_id is not null),
      'repairs_after_bound', count(*) filter (where t.problem_id is not null and t.scheduled_date >= b.bound),
      'gone', count(*) filter (where t.id in (select id from gone_tasks)),
      'stay', count(*) filter (where t.id not in (select id from gone_tasks)))
    from public.tasks t, b),
  'tasks_gone_by_status', (select jsonb_object_agg(s, n) from (
      select t.status::text as s, count(*) as n from public.tasks t where t.id in (select id from gone_tasks) group by 1) x),
  'tasks_gone_by_type', (select jsonb_object_agg(s, n) from (
      select t.type::text as s, count(*) as n from public.tasks t where t.id in (select id from gone_tasks) group by 1) x),
  'tasks_stay_by_status', (select jsonb_object_agg(s, n) from (
      select t.status::text as s, count(*) as n from staying_tasks t group by 1) x),
  'tasks_stay_by_type', (select jsonb_object_agg(s, n) from (
      select t.type::text as s, count(*) as n from staying_tasks t group by 1) x),
  'tasks_stay_without_reservation', (select count(*) from staying_tasks t where t.reservation_id is null),
  'tasks_stay_by_a_person', (select count(*) from staying_tasks t where t.created_by is not null),
  'tasks_stay_assigned_to_gone', (select jsonb_object_agg(s, n) from (
      select t.status::text as s, count(*) as n from staying_tasks t
      where t.assignee_id in (select id from gone_people) group by 1) x),
  'tasks_stay_completed_or_created_by_gone', (select count(*) from staying_tasks t
      where t.completed_by in (select id from gone_people) or t.created_by in (select id from gone_people)),
  'tasks_stay_worked', (select jsonb_build_object(
      'started_or_done', count(*) filter (where t.status in ('in_progress', 'paused', 'blocked', 'done')),
      'with_steps', count(*) filter (where exists (select 1 from public.task_steps s where s.task_id = t.id)),
      'with_media', count(*) filter (where exists (select 1 from public.task_media m where m.task_id = t.id)))
    from staying_tasks t),
  'tasks_stay_on_gone_reservation', (select count(*) from staying_tasks t where t.reservation_id in (select id from gone_res)),
  'tasks_gone_on_staying_reservation', (select jsonb_object_agg(s, n) from (
      select t.type::text || ':' || t.status::text as s, count(*) as n from public.tasks t
      where t.id in (select id from gone_tasks) and t.reservation_id is not null
        and t.reservation_id not in (select id from gone_res) group by 1) x),
  'owed_again_after_delete', (select count(*) from public.reservations r, b
      where r.departure_date >= b.bound and r.id not in (select id from gone_res)
        and exists (select 1 from public.tasks t where t.reservation_id = r.id and t.type = 'cleaning'
                      and t.id in (select id from gone_tasks))
        and not exists (select 1 from staying_tasks t where t.reservation_id = r.id and t.type = 'cleaning')),
  'reservations', (select jsonb_build_object(
      'now', count(*),
      'ended_before_bound', count(*) filter (where r.departure_date < b.bound),
      'crossing_bound', count(*) filter (where r.arrival_date < b.bound and r.departure_date >= b.bound),
      'future', count(*) filter (where r.arrival_date >= b.bound),
      'blocks_ended_before', count(*) filter (where r.departure_date < b.bound and r.is_block),
      'on_demo', count(*) filter (where r.property_id = b.demo),
      'gone', count(*) filter (where r.id in (select id from gone_res)),
      'min_departure', min(r.departure_date), 'max_departure', max(r.departure_date))
    from public.reservations r, b),
  'reservation_units', (select jsonb_build_object('now', count(*),
      'gone', count(*) filter (where u.reservation_id in (select id from gone_res)))
    from public.reservation_units u),
  'raw_hostaway_reservations', (select jsonb_build_object('now', count(*),
      'same_ids_as_gone', count(*) filter (where h.id in (select id from gone_res)),
      'not_in_public', count(*) filter (where h.id not in (select id from public.reservations)))
    from raw.hostaway_reservations h),
  'task_steps', (select jsonb_build_object('now', count(*),
      'gone', count(*) filter (where s.task_id in (select id from gone_tasks)))
    from public.task_steps s),
  'task_events', (select jsonb_build_object('now', count(*),
      'gone', count(*) filter (where e.task_id in (select id from gone_tasks)),
      'demo', count(*) filter (where e.task_id in (select id from public.tasks where property_id = 900000000001)),
      'stay_actor_gone', count(*) filter (where e.task_id not in (select id from gone_tasks)
                                            and e.actor_id in (select id from gone_people)),
      'first_at', min(e.at), 'last_at', max(e.at))
    from public.task_events e),
  'problems', (select jsonb_build_object('now', count(*),
      'by_status', (select jsonb_object_agg(s, n) from (select status::text s, count(*) n from public.problems group by 1) x))
    from public.problems),
  'problem_events', (select count(*) from public.problem_events),
  'supply_requests', (select count(*) from public.supply_requests),
  'supply_request_items', (select count(*) from public.supply_request_items),
  'chat_threads', (select jsonb_build_object('now', count(*),
      'gone', count(*) filter (where c.id in (select id from gone_threads)),
      'gone_by_kind', (select jsonb_object_agg(k, n) from (
          select kind::text k, count(*) n from public.chat_threads where id in (select id from gone_threads) group by 1) x))
    from public.chat_threads c),
  'chat_messages', (select jsonb_build_object('now', count(*),
      'gone', count(*) filter (where m.id in (select id from gone_messages)))
    from public.chat_messages m),
  'chat_reads', (select jsonb_build_object('now', count(*),
      'gone', count(*) filter (where r.thread_id in (select id from gone_threads)
                                  or r.profile_id in (select id from gone_people)))
    from public.chat_reads r),
  'task_media', (select jsonb_build_object('now', count(*),
      'gone', (select count(*) from gone_media),
      'gone_by_owner', (select jsonb_object_agg(k, n) from (
          select case when message_id is not null then 'message' when problem_id is not null then 'problem'
                      else 'task' end || ':' || kind::text as k, count(*) n from gone_media group by 1) x),
      'gone_with_live_file', (select count(*) from gone_media g
          where exists (select 1 from storage.objects o where o.bucket_id = 'task-media' and o.name = g.storage_path)),
      'gone_already_deleted_at', (select count(*) from gone_media where deleted_at is not null),
      'gone_already_purged', (select count(*) from gone_media where purged_at is not null))
    from public.task_media),
  'storage_objects', (select jsonb_build_object('now', count(*),
      'bytes', sum((o.metadata->>'size')::bigint),
      'of_gone_rows', count(*) filter (where o.name in (select storage_path from gone_media)),
      'bytes_of_gone_rows', sum((o.metadata->>'size')::bigint) filter (where o.name in (select storage_path from gone_media)),
      'without_any_row', count(*) filter (where not exists (select 1 from public.task_media m where m.storage_path = o.name)))
    from storage.objects o where o.bucket_id = 'task-media'),
  'push_tokens', (select jsonb_build_object('now', count(*),
      'gone', count(*) filter (where t.profile_id in (select id from gone_people)))
    from public.push_tokens t),
  'push_preferences', (select jsonb_build_object('now', count(*),
      'gone', count(*) filter (where p.profile_id in (select id from gone_people)))
    from public.push_preferences p),
  'push_outbox', (select jsonb_build_object('now', count(*),
      'gone', count(*) filter (where o.task_id in (select id from gone_tasks) or o.thread_id in (select id from gone_threads)
                                  or o.recipient_id in (select id from gone_people)),
      'unsettled', count(*) filter (where o.settled_at is null))
    from raw.push_outbox o),
  'push_tickets', (select jsonb_build_object('now', count(*),
      'gone', count(*) filter (where t.recipient_id in (select id from gone_people)))
    from raw.push_tickets t),
  'property_cleaners', (select jsonb_build_object('now', count(*),
      'gone', count(*) filter (where pc.cleaner_id in (select id from gone_people) or pc.property_id = 900000000001))
    from public.property_cleaners pc),
  'properties', (select jsonb_build_object('now', count(*),
      'by_status', (select jsonb_object_agg(s, n) from (select status::text s, count(*) n from public.properties group by 1) x),
      'demo', count(*) filter (where id = 900000000001),
      'in_test_band', count(*) filter (where id between 900000000000 and 999999999999),
      'named_hotel', count(*) filter (where lower(name) = 'hotel'),
      'hotel_id_taken', count(*) filter (where id = 800000000001),
      'demo_children', count(*) filter (where parent_id = 900000000001))
    from public.properties),
  'demo_property_rows', jsonb_build_object(
      'workflow_templates', (select count(*) from public.workflow_templates where property_id = 900000000001),
      'checklist_modules', (select count(*) from public.checklist_modules where property_id = 900000000001),
      'internal_notes', (select count(*) from public.property_internal_notes where property_id = 900000000001),
      'problems', (select count(*) from public.problems where property_id = 900000000001),
      'supply_requests', (select count(*) from public.supply_requests where property_id = 900000000001)),
  'profiles', (select jsonb_build_object('now', count(*),
      'by_role_active', (select jsonb_object_agg(s, n) from (
          select role::text || ':' || case when is_active then 'active' else 'off' end s, count(*) n
          from public.profiles group by 1) x),
      'keep', (select count(*) from keep),
      'gone', (select count(*) from gone_people))
    from public.profiles),
  'auth', jsonb_build_object(
      'users', (select count(*) from auth.users),
      'users_gone', (select count(*) from auth.users where id in (select id from gone_people)),
      'identities_gone', (select count(*) from auth.identities where user_id in (select id from gone_people)),
      'sessions_gone', (select count(*) from auth.sessions where user_id in (select id from gone_people)),
      'refresh_tokens_gone', (select count(*) from auth.refresh_tokens where user_id in (select id::text from gone_people)),
      'sessions_keep', (select count(*) from auth.sessions where user_id in (select id from keep))),
  'raw_webhook_events', (select jsonb_object_agg(s, n) from (
      select status::text s, count(*) n from raw.webhook_events group by 1) x),
  'hosts', (select count(*) from public.hosts)
) as r;
