-- Before and after docs/one-off-writes/demo-cleanings.sql (owner's word of
-- 2026-10-10, 22:09): the demo cleaner's cleanings on the demo listing for
-- Apple's App Review. Read-only, one statement, no names, e-mails or phones:
--
--   node scripts/cloud-read.mjs docs/rollout/demo_cleanings_probe.sql
--
--   now_utc, today_prague  when the probe ran; the write stays out of 03:00-04:40 UTC.
--   demo                   the demo listing and its time zone.
--   cleaners               people linked to it: all, and the active cleaners among
--                          them (exactly one expected), her other links (0) and her
--                          push tokens (0: nothing reaches a phone).
--   office                 the active managers and admins, by id and role only: the
--                          write runs as one of them, as the panel's «Новая уборка».
--   on_demo                every task on the demo listing, by day.
--   planned                the eleven planned ids: how many exist (0 before), and the
--                          days already holding her live cleaning (skipped by the write).
--   tasks_total            every task of every company: grows by exactly the number written.
--   others                 tasks off the demo listing: count and a hash of their rows,
--                          which the write must leave as they were.
--   outbox                 push rows for the planned ids (0 expected).
with planned (id, day) as (
  values
    ('62eb1d16-7d10-4481-b13b-d031a85f6cff'::uuid, date '2026-10-11'),
    ('03b79fea-e407-43d2-a815-e5ed3b0599e3'::uuid, date '2026-10-12'),
    ('d998c04e-4aa7-45ee-8919-ac3848f8e021'::uuid, date '2026-10-13'),
    ('78cb80a3-2617-4eae-9025-6e422c05d30f'::uuid, date '2026-10-14'),
    ('003b24cd-8efe-428e-9134-2158e5fa5501'::uuid, date '2026-10-15'),
    ('b6f1b85c-5d7c-4920-a2ea-7c61374fd4c2'::uuid, date '2026-10-16'),
    ('1a3f6276-3cbf-4928-b28d-0ba21618b2f9'::uuid, date '2026-10-17'),
    ('df1702de-c693-43d1-b54d-3ba891b18456'::uuid, date '2026-10-18'),
    ('8c917d06-2f01-4a2a-8c3a-486b40419bbf'::uuid, date '2026-10-20'),
    ('9f9bfc35-de42-4443-baa5-829ac406dde8'::uuid, date '2026-10-22'),
    ('6f772181-7cf1-4caf-a565-8716bf34d228'::uuid, date '2026-10-25')
), demo_cleaner as (
  select pr.id
  from public.property_cleaners pc
  join public.profiles pr on pr.id = pc.cleaner_id
  where pc.property_id = 900000000001
    and pr.is_active
    and pr.role = 'cleaner'
)
select json_build_object(
  'now_utc', to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI'),
  'today_prague', (now() at time zone 'Europe/Prague')::date,
  'demo', (select json_build_object('id', p.id, 'status', p.status, 'timezone', p.timezone)
           from public.properties p where p.id = 900000000001),
  'cleaners', json_build_object(
    'linked', (select count(*) from public.property_cleaners pc
               where pc.property_id = 900000000001),
    'active_cleaners', (select count(*) from demo_cleaner),
    'ids', (select json_agg(dc.id) from demo_cleaner dc),
    'other_links', (select count(*) from public.property_cleaners pc
                    where pc.cleaner_id in (select id from demo_cleaner)
                      and pc.property_id <> 900000000001),
    'push_tokens', (select count(*) from public.push_tokens t
                    where t.profile_id in (select id from demo_cleaner))),
  'office', (select json_agg(json_build_object('id', pr.id, 'role', pr.role)
                             order by pr.created_at, pr.id)
             from public.profiles pr
             where pr.is_active and pr.role in ('manager', 'admin')),
  'on_demo', (select json_agg(json_build_object(
                'id', t.id, 'day', t.scheduled_date, 'type', t.type, 'status', t.status,
                'hers', t.assignee_id in (select id from demo_cleaner),
                'manual', t.reservation_id is null and t.problem_id is null,
                'from', t.time_from, 'to', t.time_to, 'planned', t.id in (select id from planned))
                order by t.scheduled_date, t.created_at)
              from public.tasks t where t.property_id = 900000000001),
  'planned', json_build_object(
    'existing', (select count(*) from public.tasks t where t.id in (select id from planned)),
    'days_taken', (select json_agg(pl.day order by pl.day) from planned pl
                   where exists (select 1 from public.tasks t
                                 where t.property_id = 900000000001
                                   and t.assignee_id in (select id from demo_cleaner)
                                   and t.scheduled_date = pl.day
                                   and t.status not in ('cancelled', 'expired')
                                   and t.id <> pl.id))),
  'tasks_total', (select count(*) from public.tasks),
  'others', (select json_build_object(
               'count', count(*),
               'hash', md5(coalesce(string_agg(row_to_json(t)::text, '|' order by t.id), '')))
             from public.tasks t where t.property_id <> 900000000001),
  'outbox', (select count(*) from raw.push_outbox o where o.task_id in (select id from planned))
) as probe;
