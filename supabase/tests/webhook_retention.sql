-- How long the webhook journal keeps what Hostaway sent.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected: raw.webhook_events holds whole Hostaway bookings,
-- guest names and phones included, about 870 of them a day, and nothing used
-- to delete them. The processor reads only pending rows; processed and skipped
-- ones are history nobody reads after a month. Failed rows stay — they are
-- the only record of a booking the API would not give — and so do pending
-- ones, which are the queue itself (docs/launch-reset.md, §5).
--
-- Fixture rows are keyed by object_id in the 9000026xx range.
begin;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $fn$;

create or replace function pg_temp.left_of(p_object_id bigint) returns int language sql as $fn$
  select count(*)::int from raw.webhook_events where object_id = p_object_id
$fn$;

insert into raw.webhook_events (object_type, object_id, event_type, payload, status, received_at)
values
  ('reservation', 900002601, 'reservation.updated', '{}', 'processed', now() - interval '31 days'),
  ('reservation', 900002602, 'reservation.updated', '{}', 'skipped',   now() - interval '31 days'),
  ('reservation', 900002603, 'reservation.updated', '{}', 'failed',    now() - interval '31 days'),
  ('reservation', 900002604, 'reservation.updated', '{}', 'pending',   now() - interval '31 days'),
  ('reservation', 900002605, 'reservation.updated', '{}', 'processed', now() - interval '29 days');

select pg_temp.check('the purge job is scheduled once',
  (select count(*)::int from cron.job where jobname = 'purge-webhook-events'), 1);

-- 03:50 UTC: after the nightly sync (03:15), the sweep (03:30) and the
-- generator trace purge (03:45), before media retention (04:30).
select pg_temp.check('at ten to four',
  (select schedule from cron.job where jobname = 'purge-webhook-events'), '50 3 * * *');

select pg_temp.check('and it is switched on',
  (select active from cron.job where jobname = 'purge-webhook-events'), true);

select pg_temp.check('the purge reads settled rows through an index of their own',
  (select count(*)::int from pg_indexes
   where schemaname = 'raw' and indexname = 'webhook_events_settled_received_idx'), 1);

-- Retention is the scheduled job itself, run here as written.
do $$ begin
  execute (select command from cron.job where jobname = 'purge-webhook-events');
end $$;

select pg_temp.check('a processed event older than thirty days is deleted',
  pg_temp.left_of(900002601), 0);
select pg_temp.check('so is a skipped one',
  pg_temp.left_of(900002602), 0);
select pg_temp.check('a failed one stays: it is the only record of that booking',
  pg_temp.left_of(900002603), 1);
select pg_temp.check('a pending one stays: it is the queue',
  pg_temp.left_of(900002604), 1);
select pg_temp.check('a processed event younger than thirty days stays',
  pg_temp.left_of(900002605), 1);

rollback;
