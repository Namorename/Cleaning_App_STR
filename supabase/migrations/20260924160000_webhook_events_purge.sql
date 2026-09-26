-- Window 3, В: the webhook journal keeps settled events for thirty days.
--
-- raw.webhook_events holds whole Hostaway bookings, guest names and phones
-- included -- about 870 events a day, 24 707 at 28 days on 2026-09-24 -- and
-- nothing deleted them. The processor claims only pending rows
-- (claim_webhook_events, for update skip locked) and reads the booking again
-- from the API; the payload of a processed or skipped event is read by nobody
-- after the fact. Failed rows stay: they are the only record of a booking the
-- API would not give. Pending rows are the queue.
--
-- Plain SQL on pg_cron, without pg_net or an Edge Function, like
-- purge-generator-runs (20260923120000). 03:50 UTC: after the nightly sync
-- (03:15), the sweep (03:30) and the generator trace purge (03:45), before
-- media retention (04:30). cron.schedule is idempotent by name.
--
-- The rows before the launch go in a one-off deletion in the reset window
-- (docs/launch-reset.md, §4); with this job in place first, the archive copy
-- made there covers the last thirty days only (owner's word 2026-09-24).
--
-- LOCKS. The index takes SHARE on raw.webhook_events until this file commits,
-- which holds up the inserts of hostaway-webhook for the milliseconds it takes
-- on ~25 000 rows (Hostaway waits 20 s). lock_timeout bounds the wait for it.

set local lock_timeout = '3s';

-- The purge reads settled rows by age; the only index so far is on pending.
create index webhook_events_settled_received_idx
  on raw.webhook_events (received_at)
  where status in ('processed', 'skipped');

select cron.schedule(
  'purge-webhook-events',
  '50 3 * * *',
  $$delete from raw.webhook_events
      where status in ('processed', 'skipped')
        and received_at < now() - interval '30 days'$$
);
