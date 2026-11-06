-- The labels of the reading of past reviews go; the schema stays
-- (docs/rollout/property-quality-1106.md «Откат»). A WRITE to the cloud: only on the owner's
-- word, never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/property-quality-labels-wipe.sql
--
-- What it does, in one transaction:
--   * the reading stops: history_enabled and the day's ceiling off, its job inactive;
--   * every label of origin 'history' is deleted;
--   * every week closed is opened again, so a later reading reads it anew.
-- What it does not: the journal's rows stay, with what they cost. The budget is one-off, and a
-- wipe must not hand the money back: a new reading spends what is left of the same five dollars.
-- No text is erased because none was stored: texts kept by the stream since 02.11 are not
-- touched, and neither are stays, the stream's episodes or the themes of problems.
do $wipe$
begin
  update public.signal_settings
  set history_enabled = false, history_daily_cap = 0
  where kind = 'review';

  perform cron.alter_job(j.jobid, active => false)
  from cron.job j
  where j.jobname = 'read-signal-history-tick';

  delete from public.issue_facts where origin = 'history';

  update raw.signal_history_runs
  set status = 'failed', errors = errors || '[{"code": "labels_wiped", "count": 1}]'::jsonb
  where part = 'reviews' and status = 'done';
end;
$wipe$;
