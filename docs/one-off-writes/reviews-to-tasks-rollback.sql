-- Rollback of 20261030110000_reviews_to_tasks (docs/reviews-to-tasks.md, §7 «Откат»).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
-- One file for the one migration of the feature (all of its steps).
--
-- Order:
--   1. the clients first: the panel and the phone of step 1 read
--      problems.source / title_i18n / review_facts. Revert the panel merge in
--      main (Vercel deploys it) and republish the previous phone update to the
--      same runtime BEFORE this file — a select of a dropped column answers
--      42703 and the problems screens go empty;
--   2. switch everything off and let the day's runs finish:
--        update_review_settings(p_sync_enabled => false, …) from the panel, or
--        wait until no run of sync-reviews / classify-reviews is in flight;
--   3. this file, one statement:
--        npx supabase db query --linked -f docs/one-off-writes/reviews-to-tasks-rollback.sql
--   4. the history: npx supabase migration repair --status reverted 20261030110000 --linked
--   5. the Edge Functions sync-reviews and classify-reviews: delete them from
--      the dashboard (nothing calls them once the cron jobs are gone);
--   6. the probe: node scripts/cloud-read.mjs with the checks of the design's
--      §7 (no table, type or function named *review* left, problems as before).
--
-- It refuses while any problem from a review exists: problems.reported_by goes
-- back to NOT NULL, and such a problem has nobody to name. What to do with
-- them (cancel and keep the schema, or delete them with their events) is the
-- owner's decision, not this file's.
--
-- Guest texts and ratings are DROPPED with their tables — that is the point of
-- a rollback of personal data; copy the ratings out first if the statistics
-- are worth keeping (counts only, no text).
do $$
declare
  v_review_problems boolean := false;
begin
  perform set_config('lock_timeout', '3s', true);

  -- Dynamic, so a second run (the column already gone) does not fail on
  -- parsing a reference to it.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'problems' and column_name = 'source') then
    execute 'select exists (select 1 from public.problems where source = ''review'')'
      into v_review_problems;
  end if;
  if v_review_problems then
    raise exception 'Problems from reviews exist; decide about them first (see the header)';
  end if;

  -- The schedule.
  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname in ('sync-reviews-daily', 'classify-reviews-daily',
                      'purge-review-stays', 'purge-review-data', 'purge-review-runs');

  -- The push trigger as 20261003160000 left it — the body byte for byte, so
  -- md5(prosrc) after the rollback is the one the probe of that day knows.
create or replace function public.push_on_problem_reported()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_actor  uuid := (select auth.uid());
  -- A leak at night cannot wait for seven; a squeaking door can.
  v_urgent boolean := new.priority = 'high';
  v_after  timestamptz := public.push_send_after(v_urgent);
begin
  insert into raw.push_outbox (host_id, recipient_id, kind, collapse_key,
                               params, urgent, send_after, expire_at)
  select new.host_id, h.id, 'problem_new', 'problem:' || new.id,
         jsonb_build_object('problem_id', new.id, 'priority', new.priority,
                            'property', new.property_id, 'reporter_name', rp.full_name),
         v_urgent, v_after, v_after + public.push_lifetime()
  from public.profiles h
  left join public.profiles rp on rp.id = new.reported_by
  where h.host_id = new.host_id
    and h.role = 'head_tech'
    and h.is_active
    -- Never the person who reported it, nor whoever wrote it.
    and h.id <> new.reported_by
    and h.id is distinct from v_actor
    and exists (select 1 from public.push_tokens t where t.profile_id = h.id)
  order by h.id;

  return null;
end;
$fn$;
  revoke all on function public.push_on_problem_reported() from public, anon, authenticated;

  -- The functions, before the tables and types they name.
  drop function if exists public.update_review_settings(boolean, boolean, boolean, boolean, text[], integer, numeric, timestamptz);
  drop function if exists public.reject_review_finding(uuid, public.review_reject_reason);
  drop function if exists public.add_review_finding(uuid, public.review_finding_kind, text, text, public.problem_priority, text, uuid, date);
  drop function if exists public.approve_review_finding(uuid, text, public.problem_priority, uuid, text, uuid, date);
  drop function if exists public.review_place_problems(uuid);
  drop function if exists public.review_run_status();
  drop function if exists public.apply_review_findings(uuid, text, text, jsonb);
  drop function if exists public.decide_review_finding(uuid);
  drop function if exists public.create_review_problem(uuid, text, jsonb, public.problem_priority, text, text);
  drop function if exists public.review_kind_record(uuid, public.review_finding_kind);
  drop function if exists public.review_place_family(bigint);
  drop function if exists public.review_kind_gives_task(public.review_finding_kind);
  drop function if exists public.purge_review_data();
  drop function if exists public.purge_review_stays();
  drop function if exists public.erase_review_texts(uuid[]);
  drop function if exists public.review_load_state(public.review_source, text[], uuid);
  drop function if exists public.store_review_texts(uuid, public.review_source, jsonb);
  -- Before the tables: its arguments are their row types.
  drop function if exists public.review_text_allowed(public.guest_reviews, public.review_settings);
  drop function if exists public.ingest_guest_reviews(public.review_source, jsonb, timestamptz, uuid, jsonb, jsonb);
  drop function if exists public.mark_review_analysis_failed(uuid, text);
  drop function if exists public.review_open_twin(uuid);
  drop function if exists public.reserve_review_model_calls(public.review_source, integer, uuid);
  drop function if exists public.review_model_calls_left(public.review_source, uuid);
  drop function if exists public.log_review_run(public.review_source, text, boolean, jsonb, jsonb, uuid);
  drop function if exists public.review_sync_watermark(public.review_source, uuid);
  drop function if exists public.cut_review_stay_links(uuid[]);
  drop function if exists public.review_stay_link_ends(timestamptz);
  drop function if exists public.review_retention_ends(timestamptz);

  -- The tables (texts and findings go with them), then the types.
  drop table if exists public.review_findings;
  drop table if exists public.guest_reviews;
  drop table if exists public.review_settings;
  drop table if exists raw.review_runs;
  -- The trigger functions and the month helper, after the tables they served.
  drop function if exists public.review_findings_dates();
  drop function if exists public.guest_reviews_touch();
  drop function if exists public.review_month_of(timestamptz);
  -- After the table: its CHECK on subject calls it.
  drop function if exists public.review_subjects();
  drop type if exists public.review_reject_reason;
  drop type if exists public.review_finding_status;
  drop type if exists public.review_finding_kind;
  drop type if exists public.review_channel;
  drop type if exists public.review_source;

  -- problems as 20260908130000 made it.
  alter table public.problems
    drop constraint if exists problems_review_has_facts,
    drop constraint if exists problems_staff_have_reporter,
    drop column if exists review_facts,
    drop column if exists title_i18n,
    drop column if exists source,
    alter column reported_by set not null;
  drop type if exists public.problem_source;

  -- The API's scope rows the migration added (its api-scopes block); the
  -- API's table exists once 20261028100000 is in, which comes first.
  if to_regclass('public.api_scopes') is not null then
    delete from public.api_scopes where id in ('reviews:read', 'reviews:decide');
  end if;
end;
$$;
