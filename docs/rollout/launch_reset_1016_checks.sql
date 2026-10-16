-- Launch reset of 2026-10-16 (docs/launch-reset-2026-10-16.md): the gates before pass 2.
--   node scripts/cloud-read.mjs docs/rollout/launch_reset_1016_checks.sql
-- Flags and counts only. What the plan expects:
--   keep_count 1; keep.confirmed, keep.has_password true; keep.signed_in true once the owner has
--   signed in with that account (the plan asks for it before pass 2); keep.banned false;
--   postgres_can_delete_auth_users true (pass 2 deletes the accounts inside its transaction);
--   cron: sync-reservations-daily, process-webhook-events and purge-task-media-daily active.
-- webhooks_last_30d says how many bookings that had already ended were brought back by a webhook:
-- after the reset each such booking comes back into public.reservations (docs/launch-reset-2026-10-16.md, «Синк»).
select jsonb_build_object(
  'keep_count', (select count(*) from auth.users u join public.profiles p on p.id = u.id
                 where lower(u.email) = 'wagnerstays@gmail.com' and p.role = 'manager' and p.is_active),
  'keep', (select jsonb_build_object(
      'confirmed', u.email_confirmed_at is not null,
      'has_password', coalesce(u.encrypted_password, '') <> '',
      'signed_in', u.last_sign_in_at is not null,
      'sessions', (select count(*) from auth.sessions s where s.user_id = u.id),
      'app_role', u.raw_app_meta_data->>'role',
      'profile_role', p.role,
      'profile_host_is_the_host', p.host_id = (select h.id from public.hosts h),
      'is_active', p.is_active,
      'banned', u.banned_until is not null,
      'mfa_factors', (select count(*) from auth.mfa_factors f where f.user_id = u.id))
    from auth.users u join public.profiles p on p.id = u.id
    where lower(u.email) = 'wagnerstays@gmail.com'),
  'hosts', (select count(*) from public.hosts),
  'postgres_can_delete_auth_users', has_table_privilege('postgres', 'auth.users', 'DELETE'),
  'cron', (select jsonb_object_agg(j.jobname, j.active) from cron.job j),
  'webhooks_last_30d', (select jsonb_build_object(
      'reservation_events', count(*) filter (where r.id is not null),
      'events_on_ended_bookings', count(*) filter (
          where r.departure_date < (w.received_at at time zone 'Europe/Prague')::date - 1),
      'ended_bookings_touched', count(distinct r.id) filter (
          where r.departure_date < (w.received_at at time zone 'Europe/Prague')::date - 1),
      'ended_before_bound_touched', count(distinct r.id) filter (
          where r.departure_date < date '2026-10-15'
            and r.departure_date < (w.received_at at time zone 'Europe/Prague')::date - 1))
    from raw.webhook_events w left join public.reservations r on r.id = w.object_id
    where w.received_at > now() - interval '30 days'),
  'nightly_window_from_next_run', (now() at time zone 'UTC')::date + 1 - 7
) as r;
