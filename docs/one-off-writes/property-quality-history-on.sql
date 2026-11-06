-- The reading of past reviews starts (docs/rollout/property-quality-1106.md).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/property-quality-history-on.sql
--
-- What goes on: history_enabled, a day's ceiling of 1 500 calls, and the tick, every ten minutes
-- from 07:00 to 21:50 UTC. Three days of reading at about one dollar in all; the database stops it
-- at five whatever happens. Private feedback stays off: nothing here touches it.
-- The stop: docs/one-off-writes/property-quality-history-off.sql.
do $on$
begin
  update public.signal_settings
  set history_enabled = true, history_daily_cap = 1500
  where kind = 'review';

  perform cron.alter_job(j.jobid, active => true)
  from cron.job j
  where j.jobname = 'read-signal-history-tick';
end;
$on$;
