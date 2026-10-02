-- Baseline for F11 before its db push (docs/f11-plan.md, «9. Выкат по шагам»). Read-only, one
-- statement, counts only — no names, no addresses:
--
--   node scripts/cloud-read.mjs docs/rollout/f11_probe.sql
--
-- What it tells the rollout:
--   head          20260927120000 before the push; the five F11 files follow it.
--   people        active people by role: who the triggers will write rows for once they register
--                 a phone (nobody has a token before build 1.1.0).
--   accepted      tasks already in status accepted: F11 М2 changes who may write it; a non-zero
--                 count before the push means the old guard let some through.
--   week          open tasks in the next seven days by status: what a first push run could name.
--   chat          messages of the last seven days: the chat trigger's rate.
--   bookings      bookings whose status changed in the last seven days: the booking trigger's rate.
--   cron_jobs     seven before the push, ten after.
select jsonb_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'people', (select jsonb_object_agg(r.role, r.n)
             from (select coalesce(u.raw_app_meta_data ->> 'role', '(none)') as role, count(*) as n
                   from public.profiles p
                   join auth.users u on u.id = p.id
                   where p.is_active
                   group by 1) r),
  'accepted', (select count(*) from public.tasks t where t.status = 'accepted'),
  'week', (select jsonb_object_agg(w.status, w.n)
           from (select t.status::text as status, count(*) as n
                 from public.tasks t
                 where t.scheduled_date between current_date and current_date + 7
                   and t.status not in ('done', 'cancelled', 'expired')
                 group by 1) w),
  'chat', (select count(*) from public.chat_messages m where m.created_at > now() - interval '7 days'),
  'bookings', (select count(*) from public.reservations r where r.updated_at > now() - interval '7 days'),
  'cron_jobs', (select count(*) from cron.job)
) as probe;
