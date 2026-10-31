-- Rollback of 20261030110000_reviews_to_tasks — the guest signals core and its
-- reviews (docs/guest-signals.md, docs/reviews-to-tasks.md §7 «Откат»).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
-- One file for the one migration (all of its steps).
--
-- Order (docs/rollout-plan-1028.md §9.5, rollout step 5):
--   1. the clients first: the panel and the phone read problems.source /
--      title_i18n / source_facts. Revert the step's commits in main (Vercel
--      deploys the panel) and republish the previous phone update to the same
--      runtime BEFORE this file — a select of a dropped column answers 42703
--      and the problems screens go empty;
--   2. switch everything off and let the day's runs finish:
--        update_signal_settings(p_sync_enabled => false, …) from the panel, or
--        wait until no run of sync-guest-signals / classify-guest-signals is in
--        flight;
--   3. this file, one statement:
--        npx supabase db query --linked -f docs/one-off-writes/guest-signals-rollback.sql
--   4. the history: npx supabase migration repair --status reverted 20261030110000 --linked
--   5. the Edge Functions sync-guest-signals and classify-guest-signals:
--        npx supabase functions delete sync-guest-signals classify-guest-signals
--      (nothing calls them once the cron jobs are gone);
--   6. the probe: rollout_1031_fingerprint.sql must say the state before the
--      step (EQUAL head), with no table, type or function of the core left
--      and problems as before.
--
-- It refuses while any problem from a guest signal exists (a review or a
-- message): problems.reported_by goes back to NOT NULL, and such a problem has
-- nobody to name. What to do with them (cancel and keep the schema, or delete
-- them with their events) is the owner's decision, not this file's.
--
-- Guest texts, ratings and the managers' verdicts are DROPPED with their
-- tables — that is the point of a rollback of personal data; copy the ratings
-- and the verdict counts out first if the statistics are worth keeping
-- (counts only, no text).
do $$
declare
  v_signal_problems boolean := false;
begin
  perform set_config('lock_timeout', '3s', true);

  -- Dynamic, so a second run (the column already gone) does not fail on
  -- parsing a reference to it.
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'problems' and column_name = 'source') then
    execute 'select exists (select 1 from public.problems where source::text <> ''staff'')'
      into v_signal_problems;
  end if;
  if v_signal_problems then
    raise exception 'Problems from guest signals exist; decide about them first (see the header)';
  end if;

  -- The schedule.
  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname in ('sync-guest-signals-daily', 'classify-guest-signals-daily',
                      'purge-signal-stays', 'purge-signal-data', 'purge-signal-runs');

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
  drop function if exists public.update_signal_settings(boolean, boolean, boolean, boolean, text[], integer, numeric, timestamptz, integer, public.guest_signal_kind);
  drop function if exists public.mark_signal_false_positive(uuid, boolean);
  drop function if exists public.reject_signal_finding(uuid, public.signal_reject_reason);
  drop function if exists public.add_signal_finding(uuid, public.signal_finding_kind, text, text, public.problem_priority, text, uuid, date);
  drop function if exists public.approve_signal_finding(uuid, text, public.problem_priority, uuid, text, uuid, date);
  drop function if exists public.record_signal_feedback(uuid, public.signal_verdict, text);
  drop function if exists public.signal_place_problems(uuid);
  drop function if exists public.signal_run_status();
  drop function if exists public.apply_signal_findings(uuid, text, text, jsonb);
  drop function if exists public.decide_signal_finding(uuid);
  drop function if exists public.create_signal_problem(uuid, text, jsonb, public.problem_priority, text, text);
  drop function if exists public.signal_finding_record(uuid, public.guest_signal_kind, public.signal_finding_kind);
  drop function if exists public.signal_place_family(bigint);
  drop function if exists public.signal_finding_gives_task(public.signal_finding_kind);
  drop function if exists public.purge_signal_data();
  drop function if exists public.purge_signal_stays();
  drop function if exists public.erase_signal_texts(uuid[]);
  drop function if exists public.review_load_state(public.signal_provider, text[], uuid);
  drop function if exists public.store_review_texts(uuid, public.signal_provider, jsonb);
  -- Before the tables: their arguments are the tables' row types.
  drop function if exists public.review_text_allowed(public.guest_signals, public.signal_settings);
  drop function if exists public.signal_since(public.guest_signals);
  drop function if exists public.ingest_guest_reviews(public.signal_provider, jsonb, timestamptz, uuid, jsonb, jsonb);
  drop function if exists public.mark_signal_analysis_failed(uuid, text);
  drop function if exists public.signal_open_twin(uuid);
  drop function if exists public.reserve_signal_model_calls(public.signal_provider, public.guest_signal_kind, integer, uuid);
  drop function if exists public.signal_model_calls_left(public.guest_signal_kind, uuid);
  drop function if exists public.log_signal_run(public.signal_provider, public.guest_signal_kind, text, boolean, jsonb, jsonb, uuid);
  drop function if exists public.signal_sync_watermark(public.signal_provider, public.guest_signal_kind, uuid);
  drop function if exists public.signal_buildings(public.signal_provider, uuid);
  drop function if exists public.resolve_signal_reservation(public.signal_provider, uuid, text);
  drop function if exists public.resolve_signal_place(public.signal_provider, uuid, text, text);
  drop function if exists public.signal_place_id(public.signal_provider, text, text);
  drop function if exists public.cut_signal_stay_links(uuid[]);
  drop function if exists public.signal_stay_link_ends(public.guest_signal_kind, timestamptz);
  drop function if exists public.signal_retention_ends(public.guest_signal_kind, timestamptz);

  -- The tables (texts, findings and verdicts go with them), then the types.
  drop table if exists public.signal_feedback;
  drop table if exists public.signal_findings;
  drop table if exists public.guest_signals;
  drop table if exists public.signal_settings;
  drop table if exists raw.signal_runs;
  -- The trigger functions and the month helper, after the tables they served.
  drop function if exists public.signal_findings_dates();
  drop function if exists public.guest_signals_touch();
  drop function if exists public.signal_month_of(timestamptz);
  -- After the tables: their CHECKs on subject call it.
  drop function if exists public.signal_subjects();
  drop type if exists public.signal_verdict;
  drop type if exists public.signal_reject_reason;
  drop type if exists public.signal_finding_status;
  drop type if exists public.signal_finding_kind;
  drop type if exists public.signal_channel;
  drop type if exists public.guest_signal_kind;
  drop type if exists public.signal_provider;

  -- problems as 20260908130000 made it.
  alter table public.problems
    drop constraint if exists problems_signal_has_facts,
    drop constraint if exists problems_staff_have_reporter,
    drop column if exists source_facts,
    drop column if exists title_i18n,
    drop column if exists source,
    alter column reported_by set not null;
  drop type if exists public.problem_source;

  -- The API's scope rows the migration added (its api-scopes block); the
  -- API's table exists once 20261028100000 is in, which comes first.
  if to_regclass('public.api_scopes') is not null then
    delete from public.api_scopes where id in ('guest_signals:read', 'guest_signals:decide');
  end if;
end;
$$;
