-- Pre-launch probe: the villa triple and the size of the pre-launch reset.
--
-- Read-only and counts only: no guest names, no emails or phones, no message
-- or note text. Listing ids of the known triple are business keys, not people.
-- One statement, one result set of (metric text, value jsonb):
--
--   npx supabase db query --linked -f docs/rollout/prelaunch_probe.sql
--
-- Written 2026-09-23 for docs/f10-plan.md (question 4 of stage 7) and
-- docs/launch-reset.md (the dry run's table list).

with
day0 as (select (now() at time zone 'Europe/Prague')::date as today),
triple as (
  select * from (values (571441::bigint, 'villa'), (566761::bigint, 'part'), (566769::bigint, 'part'))
    as t(id, role)
),
villa_live as (
  select r.id, r.arrival_date, r.departure_date
  from public.reservations r
  where r.property_id = 571441
    and (r.status in ('new', 'modified') or r.is_block)
),
part_overlap as (
  -- every reservation row on a part that overlaps a live villa booking
  select p.property_id, p.id, p.status, p.is_block, p.channel_id
  from public.reservations p
  join villa_live v
    on p.arrival_date < v.departure_date and p.departure_date > v.arrival_date
  where p.property_id in (566761, 566769)
)
select metric, value from (

  select 1 as ord, 'v1_triple_rows'::text as metric,
         (select jsonb_object_agg(t.id::text, jsonb_build_object(
                   'role', t.role,
                   'exists', p.id is not null,
                   'status', p.status,
                   'parent_id_set', p.parent_id is not null,
                   'is_room', p.hostaway_unit_id is not null,
                   'reservations', (select count(*) from public.reservations r where r.property_id = t.id),
                   'live_reservations', (select count(*) from public.reservations r
                                         where r.property_id = t.id
                                           and (r.status in ('new', 'modified') or r.is_block))))
          from triple t
          left join public.properties p on p.id = t.id) as value

  union all
  select 2, 'v2_parts_during_villa_bookings',
         -- how Hostaway closes the parts while the villa is let: block rows,
         -- ordinary rows, or nothing at all
         jsonb_build_object(
           'villa_live_bookings', (select count(*) from villa_live),
           'villa_live_bookings_with_any_part_row',
             (select count(*) from villa_live v
              where exists (select 1 from public.reservations p
                            where p.property_id in (566761, 566769)
                              and p.arrival_date < v.departure_date
                              and p.departure_date > v.arrival_date)),
           'part_rows_overlapping_by_kind',
             (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb)
              from (select property_id || '/' || status || '/block=' || is_block
                           || '/channel=' || coalesce(channel_id::text, 'null') as k,
                           count(*) as n
                    from part_overlap group by 1) x),
           'cleanings_on_overlapping_part_rows',
             (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb)
              from (select t.status::text as s, count(*) as n
                    from public.tasks t
                    where t.reservation_id in (select id from part_overlap)
                    group by 1) x))

  union all
  select 3, 'v3_cleanings_on_blocks_anywhere',
         -- the generator must never make a cleaning for a block (is_block)
         (select jsonb_build_object(
                   'block_reservations', (select count(*) from public.reservations where is_block),
                   'cleanings_on_blocks', count(*),
                   'cleanings_on_blocks_by_status',
                     (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb)
                      from (select t2.status::text as s, count(*) as n
                            from public.tasks t2
                            join public.reservations r2 on r2.id = t2.reservation_id
                            where r2.is_block and t2.type = 'cleaning'
                            group by 1) y))
          from public.tasks t
          join public.reservations r on r.id = t.reservation_id
          where r.is_block and t.type = 'cleaning')

  union all
  select 4, 'v4_own_checklists_and_processes',
         (select jsonb_object_agg(t.id::text, jsonb_build_object(
                   'checklist_modules', (select count(*) from public.checklist_modules m
                                         where m.property_id = t.id),
                   'checklist_items', (select count(*) from public.checklist_items i
                                       join public.checklist_modules m on m.id = i.module_id
                                       where m.property_id = t.id),
                   'own_workflow_templates', (select coalesce(jsonb_object_agg(w.scope::text, w.is_active), '{}'::jsonb)
                                              from public.workflow_templates w
                                              where w.property_id = t.id)))
          from triple t)

  -- ------------------------------------------------------------ reset sizing
  union all
  select 10, 'r1_tasks',
         (select jsonb_build_object(
                   'total', count(*),
                   'before_today', count(*) filter (where t.scheduled_date < d.today),
                   'before_today_by_status',
                     (select jsonb_object_agg(s, n) from (
                        select t2.status::text as s, count(*) as n
                        from public.tasks t2 cross join day0 d2
                        where t2.scheduled_date < d2.today group by 1) x),
                   'before_today_by_type',
                     (select jsonb_object_agg(s, n) from (
                        select t2.type::text as s, count(*) as n
                        from public.tasks t2 cross join day0 d2
                        where t2.scheduled_date < d2.today group by 1) x),
                   'today_or_later_live',
                     count(*) filter (where t.scheduled_date >= d.today
                                        and t.status not in ('done', 'cancelled', 'expired')),
                   'repairs_all', count(*) filter (where t.problem_id is not null),
                   'manual_all', count(*) filter (where t.reservation_id is null and t.problem_id is null))
          from public.tasks t cross join day0 d)

  union all
  select 11, 'r2_task_children',
         (select jsonb_build_object(
                   'task_steps', (select count(*) from public.task_steps),
                   'task_steps_of_past_tasks',
                     (select count(*) from public.task_steps s join public.tasks t on t.id = s.task_id
                      cross join day0 d where t.scheduled_date < d.today),
                   'task_media_rows', (select count(*) from public.task_media),
                   'task_media_by_owner',
                     (select jsonb_build_object(
                               'task', count(*) filter (where m.task_id is not null),
                               'problem', count(*) filter (where m.problem_id is not null),
                               'uploaded', count(*) filter (where m.uploaded_at is not null),
                               'purged', count(*) filter (where m.purged_at is not null),
                               'bytes_declared', coalesce(sum(m.byte_size), 0))
                      from public.task_media m),
                   'task_media_of_past_tasks',
                     (select count(*) from public.task_media m join public.tasks t on t.id = m.task_id
                      cross join day0 d where t.scheduled_date < d.today),
                   'storage_objects_task_media',
                     (select jsonb_build_object('objects', count(*),
                                                'bytes', coalesce(sum((o.metadata ->> 'size')::bigint), 0))
                      from storage.objects o where o.bucket_id = 'task-media'),
                   'storage_objects_without_row',
                     (select count(*) from storage.objects o
                      where o.bucket_id = 'task-media'
                        and not exists (select 1 from public.task_media m where m.storage_path = o.name))))

  union all
  select 12, 'r3_chat',
         (select jsonb_build_object(
                   'threads_by_kind', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
                                         select kind::text as k, count(*) as n
                                         from public.chat_threads group by 1) x),
                   'threads_on_past_tasks',
                     (select count(*) from public.chat_threads c join public.tasks t on t.id = c.task_id
                      cross join day0 d where t.scheduled_date < d.today),
                   'messages', (select count(*) from public.chat_messages)))

  union all
  select 13, 'r4_problems_and_supplies',
         (select jsonb_build_object(
                   'problems_by_status', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (
                                            select status::text as s, count(*) as n
                                            from public.problems group by 1) x),
                   'problems_archived', (select count(*) from public.problems where archived_at is not null),
                   'problems_from_a_task', (select count(*) from public.problems where task_id is not null),
                   'supply_requests_by_status', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (
                                                   select status::text as s, count(*) as n
                                                   from public.supply_requests group by 1) x),
                   'supply_requests_from_a_task', (select count(*) from public.supply_requests where task_id is not null)))

  union all
  select 14, 'r5_raw_layer',
         (select jsonb_build_object(
                   'webhook_events', (select count(*) from raw.webhook_events),
                   'webhook_events_by_status', (select coalesce(jsonb_object_agg(s, n), '{}'::jsonb) from (
                                                  select status::text as s, count(*) as n
                                                  from raw.webhook_events group by 1) x),
                   'webhook_events_first', (select min(received_at)::date from raw.webhook_events),
                   'webhook_events_last', (select max(received_at)::date from raw.webhook_events),
                   'hostaway_reservations', (select count(*) from raw.hostaway_reservations),
                   'hostaway_listings', (select count(*) from raw.hostaway_listings),
                   'generator_runs', (select count(*) from raw.generator_runs),
                   'cron_jobs', (select coalesce(jsonb_agg(jobname order by jobname), '[]'::jsonb) from cron.job)))

  union all
  select 15, 'r6_people',
         (select jsonb_build_object(
                   'profiles_by_role_active', (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (
                                                 select role::text || '/' || case when is_active then 'active' else 'off' end as k,
                                                        count(*) as n
                                                 from public.profiles group by 1) x),
                   'auth_users', (select count(*) from auth.users),
                   'profiles_on_example_domain', (select count(*) from public.profiles where email ilike '%@example.com'),
                   'property_cleaner_links', (select count(*) from public.property_cleaners)))

) m
order by ord;
