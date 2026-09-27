-- Before the push of 20260927120000_pinned_rooms. Read-only, one statement,
-- catalog and counts:
--
--   node scripts/cloud-read.mjs docs/rollout/pinned_rooms_probe.sql
--
-- Expected:
--   head               20260926160000.
--   pinned_rooms       false — the column is not there yet.
--   reservation_rooms  false — nor the function.
--   moved              0 — only a panel that sends p_expected_date records a
--                      move, and it ships after this migration. Any other
--                      number: those moves get the booking's rooms as they are
--                      at the push (the migration's backfill) — read them
--                      before pushing, it is not a stop by itself.
--   rooms_bookings     informational: live bookings of several rooms with a
--                      cleaning nobody has started — the ones whose moves the
--                      new rule reaches.
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload
  union all
  select 2, 'pinned_rooms',
         to_jsonb(exists (select 1 from pg_attribute a
                          where a.attrelid = 'public.tasks'::regclass
                            and a.attname = 'pinned_rooms' and not a.attisdropped))
  union all
  select 3, 'reservation_rooms',
         to_jsonb(exists (select 1 from pg_proc p
                          where p.pronamespace = 'public'::regnamespace
                            and p.proname = 'reservation_rooms'))
  union all
  select 4, 'moved',
         to_jsonb((select count(*) from public.tasks t where t.pinned_departure is not null))
  union all
  select 5, 'rooms_bookings',
         to_jsonb((select count(distinct t.reservation_id)
                   from public.tasks t
                   where t.type = 'cleaning'
                     and t.status in ('unassigned', 'assigned', 'accepted')
                     and (select count(*) from public.reservation_units ru
                          where ru.reservation_id = t.reservation_id) > 1))
) t order by ord
