-- Property quality (20261106120000, docs/rollout/property-quality-1106.md): how far the
-- reading got and what it spent. Counts only. Valid after step 1: before it the tables are not
-- there, and postpush_property_quality_1106.sql is the probe for every state.
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_property_quality_counts_1106.sql
select json_build_object(
  'themes', (select count(*) from public.issue_themes),
  'facts', (select count(*) from public.issue_facts),
  'facts_history', (select count(*) from public.issue_facts where origin = 'history'),
  'stay_months', (select count(distinct month) from public.property_month_stats),
  'problem_themes', (select count(*) from public.problem_themes),
  'weeks_done', (select count(distinct slice_start) from raw.signal_history_runs
                 where part = 'reviews' and status = 'done'),
  'attempts_failed', (select count(*) from raw.signal_history_runs
                      where part = 'reviews' and status = 'failed'),
  'calls_reserved', (select coalesce(sum(reserved_calls), 0) from raw.signal_history_runs
                     where part = 'reviews'),
  'spent_micro_usd', (select coalesce(sum(coalesce(spent_micro_usd, reserved_micro_usd)), 0)
                      from raw.signal_history_runs where part = 'reviews')
) as out;
