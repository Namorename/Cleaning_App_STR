-- The reading of past reviews stops (docs/rollout/property-quality-1106.md).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/property-quality-history-off.sql
--
-- A tick already reading finishes its week; the next one finds the switch off and does nothing.
-- Labels stay, and the reading can go on from where it stopped. To take the labels away too:
-- docs/one-off-writes/property-quality-labels-wipe.sql.
do $off$
begin
  update public.signal_settings
  set history_enabled = false, history_daily_cap = 0
  where kind = 'review';

  perform cron.alter_job(j.jobid, active => false)
  from cron.job j
  where j.jobname = 'read-signal-history-tick';
end;
$off$;
