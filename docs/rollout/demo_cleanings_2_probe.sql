-- Before and after docs/one-off-writes/demo-cleanings-2.sql (owner's word of
-- 2026-10-14, 21:35): the demo cleaner's cleanings on the demo listing for
-- Apple's App Review. Read-only, one statement, no names, e-mails or phones:
--
--   node scripts/cloud-read.mjs docs/rollout/demo_cleanings_2_probe.sql
--
--   now_utc, today_prague  when the probe ran; the write stays out of 03:00-04:40 UTC.
--   demo                   the demo listing and its time zone.
--   cleaners               people linked to it: all, and the active cleaners among
--                          them (exactly one expected), her other links (0) and her
--                          push tokens.
--   office                 the active managers and admins, by id and role only: the
--                          write runs as one of them, as the panel's «Новая уборка».
--   on_demo                every task on the demo listing, by day.
--   planned                the fourteen planned ids: how many exist (0 before), and
--                          the days already holding her live job (skipped by the write).
--   tasks_total            every task of every company: grows by exactly the number written.
--   others                 tasks off the demo listing: count and a hash of their rows,
--                          which the write must leave as they were.
--   outbox                 push rows for the planned ids, by kind, whether they are
--                          the demo cleaner's, and when they go (only hers expected,
--                          only inside her week).
with planned (id, day) as (
  values
    ('00336c33-a83c-4787-800c-61d36125eba8'::uuid, date '2026-10-19'),
    ('6f39851a-23cb-4269-9a3e-5a16916f0480'::uuid, date '2026-10-20'),
    ('86211dbe-775d-41a7-b088-bba1ec989d93'::uuid, date '2026-10-21'),
    ('ee98e92e-9d2e-4c10-88e1-93938a3cb581'::uuid, date '2026-10-22'),
    ('b4343dcf-9ebb-4f13-bbbf-a2b411d1fe7f'::uuid, date '2026-10-23'),
    ('23007aed-ba00-454d-bf6f-987a0d7dd2ab'::uuid, date '2026-10-24'),
    ('066f65d3-c5c2-4654-9b65-cf2d50d6c0e6'::uuid, date '2026-10-25'),
    ('9202ba83-301e-4c0c-b979-47d48342d0e4'::uuid, date '2026-10-26'),
    ('73b04a47-e16d-439f-a721-39e289d49a65'::uuid, date '2026-10-27'),
    ('fc56b4b4-0a3f-45c0-9939-d9e028281174'::uuid, date '2026-10-28'),
    ('4211dbaf-7331-4c7b-963b-5491a3b145f9'::uuid, date '2026-10-29'),
    ('b2256db8-7220-4bbf-beef-bb1272a8551b'::uuid, date '2026-10-30'),
    ('bc4c1e7a-e900-44fc-b968-bbc1243ebb04'::uuid, date '2026-10-31'),
    ('d1335385-96f2-4816-bc21-bbd5efacd2ae'::uuid, date '2026-11-01')
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
  'outbox', (select coalesce(json_agg(json_build_object(
               'kind', o.kind, 'day', pl.day,
               'hers', o.recipient_id in (select id from demo_cleaner),
               'send_after', o.send_after, 'outcome', o.outcome)
               order by pl.day, o.kind), '[]'::json)
             from raw.push_outbox o
             join planned pl on pl.id = o.task_id)
) as probe;
