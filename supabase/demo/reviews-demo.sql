-- Demo reviews for the «Гости» section (docs/reviews-to-tasks.md §11), LOCAL STAND ONLY.
-- Synthetic reviews: no real guest, text or booking. Every row is marked
-- demo-review-* and goes with: node scripts/reviews-demo.mjs down
--
-- The screen then shows candidates of three kinds (one urgent, one from the
-- rules with no wording), a task made from a review with a second review
-- linked to it, a statistic, a finding set aside, and the line "updated at".

-- The key sync-guest-signals makes of a PMS id (HMAC-SHA256 of provider:kind:id),
-- here under a secret for the local stand only; the cloud's never enters any database.
-- The rows carry the PMS's ids alone, as an adapter hands them over; the database
-- finds our listing from them.
create function pg_temp.demo_review_key(p_id text)
returns text
language sql
immutable
as $$
  select encode(extensions.hmac('hostaway:review:' || p_id, 'local-demo-review-id-secret-not-for-the-cloud', 'sha256'), 'hex')
$$;

do $$
declare
  v_host    uuid := public.default_host_id();
  v_manager uuid;
  v_places  bigint[];
  v_r       uuid;
  v_f       uuid;
  v_ago     constant interval := interval '1 day';
begin
  select array_agg(p.id order by p.id) into v_places
  from (select p.id from public.properties p
        where p.host_id = v_host and p.status = 'active' and p.parent_id is null
          and not public.analytics_is_test_listing(p.id)
        order by p.id limit 5) p;
  if coalesce(cardinality(v_places), 0) < 4 then
    raise exception 'The demo needs four active listings on the stand, found %', coalesce(cardinality(v_places), 0);
  end if;
  select id into v_manager from public.profiles
  where host_id = v_host and role in ('manager', 'admin') and is_active order by role desc, created_at limit 1;
  if v_manager is null then
    raise exception 'The demo needs a manager on the stand';
  end if;

  insert into public.signal_settings (host_id, kind, sync_enabled, texts_enabled, tasks_enabled, notice_published_at)
  values (v_host, 'review', true, true, true, now() - interval '60 days')
  on conflict (host_id, kind) do update
    set sync_enabled = true, texts_enabled = true, tasks_enabled = true,
        notice_published_at = coalesce(signal_settings.notice_published_at, now() - interval '60 days');

  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_key', pg_temp.demo_review_key('demo-review-1'), 'external_id', 'demo-review-1', 'external_listing_id', v_places[1]::text,
      'external_reservation_id', '90000001', 'channel', 'airbnb', 'rating', 4,
      'category_ratings', '{"cleanliness": 9, "checkin": 8, "accuracy": 6}'::jsonb,
      'arrival_date', current_date - 6, 'departure_date', current_date - 3, 'submitted_at', now() - v_ago,
      'has_public_text', true, 'has_private_text', true,
      'public_text', 'Nice location and a clean flat. The kitchen smelled of gas in the evening, which worried us.',
      'private_text', 'Please check the stove: there was a gas smell near it twice.'),
    jsonb_build_object('external_key', pg_temp.demo_review_key('demo-review-2'), 'external_id', 'demo-review-2', 'external_listing_id', v_places[2]::text,
      'external_reservation_id', '90000002', 'channel', 'booking', 'rating', 6,
      'category_ratings', '{"cleanliness": 8, "facilities": 5, "staff": 9}'::jsonb,
      'arrival_date', current_date - 8, 'departure_date', current_date - 5, 'submitted_at', now() - 2 * v_ago,
      'has_public_text', true, 'public_text', 'There was no hot water in the shower for two days. [GUEST] called and nobody came.'),
    jsonb_build_object('external_key', pg_temp.demo_review_key('demo-review-3'), 'external_id', 'demo-review-3', 'external_listing_id', v_places[3]::text,
      'channel', 'airbnb', 'rating', 7, 'arrival_date', current_date - 10, 'departure_date', current_date - 7,
      'submitted_at', now() - 3 * v_ago, 'has_public_text', true,
      'public_text', 'Lovely place. The heating did not work in the bedroom, we used the oven to warm up.'),
    jsonb_build_object('external_key', pg_temp.demo_review_key('demo-review-4'), 'external_id', 'demo-review-4', 'external_listing_id', v_places[4]::text,
      'channel', 'booking', 'rating', 5, 'arrival_date', current_date - 12, 'departure_date', current_date - 9,
      'submitted_at', now() - 4 * v_ago, 'has_public_text', true,
      'public_text', 'We saw cockroaches in the bathroom at night. The bed was comfortable.'),
    jsonb_build_object('external_key', pg_temp.demo_review_key('demo-review-5'), 'external_id', 'demo-review-5', 'external_listing_id', v_places[2]::text,
      'channel', 'airbnb', 'rating', 7, 'arrival_date', current_date - 5, 'departure_date', current_date - 2,
      'submitted_at', now() - 6 * interval '1 hour', 'has_public_text', true,
      'public_text', 'Good stay, but again no warm water in the morning.'),
    jsonb_build_object('external_key', pg_temp.demo_review_key('demo-review-6'), 'external_id', 'demo-review-6', 'external_listing_id', v_places[1]::text,
      'channel', 'airbnb', 'rating', 10, 'arrival_date', current_date - 9, 'departure_date', current_date - 6,
      'submitted_at', now() - 5 * v_ago, 'has_public_text', true,
      'public_text', 'Perfect stay, spotless and quiet. Thank you!'),
    jsonb_build_object('external_key', pg_temp.demo_review_key('demo-review-7'), 'external_id', 'demo-review-7', 'external_listing_id', v_places[3]::text,
      'channel', 'vrbo', 'rating', 8, 'departure_date', current_date - 20, 'submitted_at', now() - 15 * v_ago,
      'has_public_text', true)
  ), now(), v_host);

  -- Readings of the model, as classify-guest-signals applies them, then of the rules.
  select id into v_r from public.guest_signals where external_key = pg_temp.demo_review_key('demo-review-1');
  perform public.apply_signal_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'safety', 'subject', 'other', 'urgency', 'high', 'still_relevant', 'likely',
      'confidence', 0.93, 'evidence', 'there was a gas smell near it twice', 'evidence_source', 'private',
      'summary_i18n', jsonb_build_object('en', 'Gas smell near the stove', 'cs', 'Zápach plynu u sporáku', 'ru', 'Запах газа у плиты')),
    jsonb_build_object('kind', 'cleaning', 'subject', 'other', 'confidence', 0.4,
      'summary_i18n', jsonb_build_object('en', 'Clean flat', 'cs', 'Čistý byt', 'ru', 'Чистая квартира'))));
  perform public.apply_signal_findings(v_r, 'rules-v1', null, '[]'::jsonb);

  select id into v_r from public.guest_signals where external_key = pg_temp.demo_review_key('demo-review-2');
  perform public.apply_signal_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'hot_water', 'urgency', 'normal', 'still_relevant', 'likely',
      'confidence', 0.9, 'evidence', 'There was no hot water in the shower for two days.', 'evidence_source', 'public',
      'summary_i18n', jsonb_build_object('en', 'No hot water in the shower', 'cs', 'Ve sprše neteče teplá voda', 'ru', 'Нет горячей воды в душе'))));
  perform public.apply_signal_findings(v_r, 'rules-v1', null, '[]'::jsonb);

  -- The rules alone, the model away: a card without words.
  select id into v_r from public.guest_signals where external_key = pg_temp.demo_review_key('demo-review-3');
  perform public.apply_signal_findings(v_r, 'rules-v1', null, jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'heating', 'confidence', 0.7,
      'evidence', 'The heating did not work in the bedroom', 'evidence_source', 'public')));

  select id into v_r from public.guest_signals where external_key = pg_temp.demo_review_key('demo-review-4');
  perform public.apply_signal_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'pests', 'subject', 'other', 'urgency', 'normal', 'still_relevant', 'likely',
      'confidence', 0.88, 'evidence', 'We saw cockroaches in the bathroom at night.', 'evidence_source', 'public',
      'summary_i18n', jsonb_build_object('en', 'Cockroaches in the bathroom', 'cs', 'Švábi v koupelně', 'ru', 'Тараканы в ванной')),
    jsonb_build_object('kind', 'repair', 'subject', 'furniture', 'confidence', 0.3,
      'summary_i18n', jsonb_build_object('en', 'Bed maybe worn', 'cs', 'Postel možná opotřebená', 'ru', 'Кровать, возможно, изношена'))));
  perform public.apply_signal_findings(v_r, 'rules-v1', null, '[]'::jsonb);

  -- A task made from review 2 by the manager; review 5 about the same joins it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  select f.id into v_f from public.signal_findings f join public.guest_signals g on g.id = f.signal_id
  where g.external_key = pg_temp.demo_review_key('demo-review-2');
  perform public.approve_signal_finding(v_f);
  perform set_config('request.jwt.claims', '{}', true);
  select id into v_r from public.guest_signals where external_key = pg_temp.demo_review_key('demo-review-5');
  perform public.apply_signal_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'hot_water', 'confidence', 0.85,
      'evidence', 'again no warm water in the morning', 'evidence_source', 'public',
      'summary_i18n', jsonb_build_object('en', 'No warm water in the morning', 'cs', 'Ráno neteče teplá voda', 'ru', 'Утром нет тёплой воды'))));
  perform public.apply_signal_findings(v_r, 'rules-v1', null, '[]'::jsonb);

  -- Praise: read, nothing found, the stay cut to its month at once.
  select id into v_r from public.guest_signals where external_key = pg_temp.demo_review_key('demo-review-6');
  perform public.apply_signal_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', '[]'::jsonb);
  perform public.apply_signal_findings(v_r, 'rules-v1', null, '[]'::jsonb);

  -- The journal of the jobs: the line "updated at".
  perform public.log_signal_run('hostaway', 'review', 'classify', true, '{"read": 6}'::jsonb, p_host_id => v_host);
end;
$$;
