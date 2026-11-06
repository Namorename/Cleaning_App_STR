-- The nightly refresh of property quality goes on (docs/rollout/property-quality-1106.md).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/property-quality-refresh-on.sql
--
-- One statement: the job turns active and runs once now, so the section has themes today and
-- not after 06:40 UTC tomorrow. It writes derived rows only: problem_themes and the stream's
-- issue_facts. problems itself is not touched. Staff texts are read here by the dictionary
-- alone; no model is called. Undo: the same job with active => false; its rows are harmless,
-- and property-quality-rollback.sql takes them with their tables.
do $on$
begin
  perform cron.alter_job(j.jobid, active => true)
  from cron.job j
  where j.jobname = 'refresh-property-quality';

  perform public.refresh_property_quality();
end;
$on$;
