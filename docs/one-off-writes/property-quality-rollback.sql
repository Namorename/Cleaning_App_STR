-- Rollback of 20261106120000_property_quality (docs/property-intelligence-plan.md,
-- docs/rollout/property-quality-1106.md «Откат»).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
-- Order:
--   1. the panel first: the section calls quality_overview and quality_place, and without
--      them it shows the server's refusal. Revert the merge in main and push (Vercel). The
--      phone never knew any of this;
--   2. the reading stops: the job is dropped here, and a tick already running finds its
--      functions gone and fails with no effect;
--   3. this file — one statement, as db query takes no more:
--        npx supabase db query --linked -f docs/one-off-writes/property-quality-rollback.sql
--   4. the history: npx supabase migration repair --status reverted 20261106120000 --linked
--   5. the function: npx supabase functions delete read-signal-history
--   6. the probe: node scripts/cloud-read.mjs docs/rollout/postpush_property_quality_1106.sql —
--      head 20261104200000, none of the new tables, columns, jobs or functions.
--
-- What it does, in one transaction: drops the two jobs, the functions, the six tables, the
-- enum, the six switches of signal_settings and the two columns of hosts. Labels and stays go with their tables: they
-- are derived, and no guest text was ever in them. The journal goes only if the reading never
-- spent anything: once it did, it stays, and a second push finds it (if not exists), so a
-- rollback cannot hand the one-off budget back. Nothing of the texts' line is
-- touched: review_text_allowed, store_review_texts, review_load_state and the texts kept since
-- 02.11 stay as they are, and so does every row of problems and guest_signals.
--
-- Applying the migration again after this works: it recreates everything from nothing
-- (rehearsed on a throwaway database, docs/rollout/property-quality-1106.md).
do $rollback$
begin
  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname in ('refresh-property-quality', 'read-signal-history-tick');

  drop function public.quality_areas(text);
  drop function public.quality_place(bigint, text);
  drop function public.quality_overview(text);
  drop function public.quality_meta(uuid, text, date, text, date, date, date, date);
  drop function public.quality_history_state(uuid);
  drop function public.quality_theme_rows(uuid, date, text, date, date, date, bigint);
  drop function public.quality_place_rows(uuid, date, text, date, date, date, date, date, date, bigint);
  drop function public.quality_guard(text);
  drop function public.quality_settled_to(date);
  drop function public.quality_bounds(text, date);
  drop function public.refresh_property_quality(uuid);
  drop function public.refresh_quality_areas(uuid);
  drop function public.issue_theme_refined(text, text);
  drop function public.issue_theme_of_text(text);
  drop function public.issue_theme_of_finding(public.signal_finding_kind, text);
  drop function public.replace_property_month_stays(public.signal_provider, date, jsonb, uuid);
  drop function public.fail_signal_history(bigint, bigint, jsonb, jsonb);
  drop function public.complete_signal_history(bigint, jsonb, bigint, jsonb);
  drop function public.reserve_signal_history(public.signal_provider, text, date, date, integer, bigint, uuid);
  drop function public.signal_history_readable(public.signal_provider, text[], uuid);
  drop function public.signal_history_state(public.signal_provider, text, uuid);
  drop function public.signal_history_day_start();
  drop function public.signal_history_spent(uuid);

  if not exists (select 1 from raw.signal_history_runs r where r.part = 'reviews') then
    drop table raw.signal_history_runs;
  end if;
  drop table public.quality_area_members;
  drop table public.property_month_stats;
  drop table public.problem_themes;
  drop table public.issue_facts;
  drop table public.issue_theme_words;
  drop table public.issue_themes;
  drop type public.issue_layer;

  alter table public.signal_settings
    drop constraint signal_settings_history_is_reviews,
    drop column history_follow,
    drop column history_budget_micro_usd,
    drop column history_daily_cap,
    drop column history_include_private,
    drop column history_depth_months,
    drop column history_enabled;

  alter table public.hosts drop column quality_areas_on, drop column quality_city_groups;
end;
$rollback$;
