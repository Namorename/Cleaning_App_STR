-- Tasks from guest reviews (docs/reviews-to-tasks.md). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - the load: a review is stored once by its PMS id, a stay before the guest
--   notice keeps its rating and never its text, the test band is skipped, a
--   hidden review keeps its rating only, a long text keeps its beginning;
-- - the stay (the owner's decision of 2026-10-17, late): the exact days and
--   the booking live only while the review is unsettled — not yet read, or a
--   finding waiting for a manager — and never past its last day; then the
--   month and the place stay, for good; the card's list of problems on the
--   place and the duplicate guard work while the days are there and degrade
--   to the month after;
-- - the readers: the model first, the rules after, one queue; an outage costs
--   no attempt; bad items cost only themselves;
-- - the decision: candidate, task, duplicate, already fixed, no task, dropped;
--   auto only for a kind an admin switched on, on a fresh exact stay, on a
--   clean place;
-- - the manager: approve to the open column or to a technician, link as the
--   same or as already fixed, reject; the gates and the money are the admin's;
-- - row security: reviews and findings are the office's; the head technician
--   and the technician read a problem's facts, never the review;
-- - the purge: texts and their fragments and wordings after 18 months, or at
--   once when texts go off; the key after 18 months.
--
-- Fixture ids live in the 900061xxx range and under b61….
begin;

insert into public.hosts (id, name, default_language) values
  ('b6100000-0000-4000-8000-00000000000a', 'Reviews host A', 'en'),
  ('b6100000-0000-4000-8000-00000000000b', 'Reviews host B', 'en');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b6100001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.reviews@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b6100002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','owner.reviews@test.local','x',now(),now(),
   '{"full_name":"Owner"}'::jsonb, '{"role":"admin"}'::jsonb),
  ('b6100003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.reviews@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('b6100004-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','hector.reviews@test.local','x',now(),now(),
   '{"full_name":"Hector"}'::jsonb, '{"role":"head_tech"}'::jsonb),
  ('b6100005-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tomas.reviews@test.local','x',now(),now(),
   '{"full_name":"Tomas"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('b6100006-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','other.reviews@test.local','x',now(),now(),
   '{"full_name":"Other"}'::jsonb, '{"role":"manager"}'::jsonb);

update public.profiles set host_id = 'b6100000-0000-4000-8000-00000000000a'
where id::text like 'b610000%' and id <> 'b6100006-0000-4000-8000-000000000006';
update public.profiles set host_id = 'b6100000-0000-4000-8000-00000000000b'
where id = 'b6100006-0000-4000-8000-000000000006';

insert into public.properties (id, name, timezone, check_in_time, check_out_time, host_id) values
  (900061001, 'Reviews L1', 'Europe/Prague', '15:00', '10:00', 'b6100000-0000-4000-8000-00000000000a'),
  (900061002, 'Reviews L2', 'Europe/Prague', '15:00', '10:00', 'b6100000-0000-4000-8000-00000000000a'),
  (900061003, 'Reviews L3', 'Europe/Prague', '15:00', '10:00', 'b6100000-0000-4000-8000-00000000000a'),
  (900061004, 'Reviews L4', 'Europe/Prague', '15:00', '10:00', 'b6100000-0000-4000-8000-00000000000a'),
  (900061005, 'Reviews L5', 'Europe/Prague', '15:00', '10:00', 'b6100000-0000-4000-8000-00000000000a'),
  (900061006, 'Reviews L6', 'Europe/Prague', '15:00', '10:00', 'b6100000-0000-4000-8000-00000000000a'),
  (900061007, 'Reviews L7', 'Europe/Prague', '15:00', '10:00', 'b6100000-0000-4000-8000-00000000000a'),
  (900061008, 'Reviews L8', 'Europe/Prague', '15:00', '10:00', 'b6100000-0000-4000-8000-00000000000a'),
  (900061010, 'Reviews house', 'Europe/Prague', '15:00', '10:00', 'b6100000-0000-4000-8000-00000000000a'),
  (900061020, 'Other company flat', 'Europe/Prague', '15:00', '10:00', 'b6100000-0000-4000-8000-00000000000b');
insert into public.properties (id, hostaway_unit_id, parent_id, name, timezone, check_in_time, check_out_time, host_id) values
  (1000000061011, 61011, 900061010, 'Reviews house - room 1', 'Europe/Prague', '15:00', '10:00',
   'b6100000-0000-4000-8000-00000000000a');

insert into public.reservations
  (id, host_id, property_id, arrival_date, departure_date, status, is_block, guest_name, check_out_time)
values
  (900061101, 'b6100000-0000-4000-8000-00000000000a', 900061001,
   current_date - 5, current_date - 3, 'new', false, 'Synthetic Guest', '10:00');

insert into public.push_tokens (token, profile_id, host_id, platform)
values ('ExponentPushToken[reviews-suite]', 'b6100004-0000-4000-8000-000000000004',
        'b6100000-0000-4000-8000-00000000000a', 'android');

-- Texts may be kept for stays that began on or after the notice, 60 days ago.
insert into public.review_settings (host_id, tasks_enabled, texts_enabled, notice_published_at)
values ('b6100000-0000-4000-8000-00000000000a', true, true, now() - interval '60 days');

do $$
declare
  v_host     uuid := 'b6100000-0000-4000-8000-00000000000a';
  v_other    uuid := 'b6100000-0000-4000-8000-00000000000b';
  v_manager  uuid := 'b6100001-0000-4000-8000-000000000001';
  v_admin    uuid := 'b6100002-0000-4000-8000-000000000002';
  v_cleaner  uuid := 'b6100003-0000-4000-8000-000000000003';
  v_head     uuid := 'b6100004-0000-4000-8000-000000000004';
  v_tech     uuid := 'b6100005-0000-4000-8000-000000000005';
  v_boss_b   uuid := 'b6100006-0000-4000-8000-000000000006';
  v_l1       bigint := 900061001;
  v_l2       bigint := 900061002;
  v_l3       bigint := 900061003;
  v_l4       bigint := 900061004;
  v_l5       bigint := 900061005;
  v_l6       bigint := 900061006;
  v_l7       bigint := 900061007;
  v_l8       bigint := 900061008;
  v_building bigint := 900061010;
  v_room     bigint := 1000000061011;
  v_res      bigint := 900061101;
  v_month    date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_r        uuid;
  v_r1       uuid;
  v_r2       uuid;
  v_r3       uuid;
  v_r4       uuid;
  v_out      jsonb;
  v_out2     jsonb;
  v_f        public.review_findings;
  v_g        public.review_findings;
  v_review   public.guest_reviews;
  v_summary  text;
  v_problem  public.problems;
  v_task     public.tasks;
  v_set      public.review_settings;
  v_p1       uuid;
  v_p2       uuid;
  v_fixed    uuid;
  v_fixed2   uuid;
  v_before   uuid;
  v_p3       uuid;
  v_n        integer;
  v_total    integer;
  v_failed   boolean;
  v_hint     text;
  v_detail   text;
begin
  perform set_config('request.jwt.claims', '{}', true);

  -- 0a. the last day: two years of review times, one every 7 hours. The
  -- sweep runs at 05:00 UTC on the day review_stay_link_ends() names: never
  -- 90 days or more after the review, and always on the first of a month.
  select count(*) into v_n
  from generate_series(timestamptz '2026-01-01 00:00+00', timestamptz '2027-12-31 23:00+00',
                       interval '7 hours') as t
  where (public.review_stay_link_ends(t)::timestamp + time '05:00') at time zone 'UTC' - t >= interval '90 days'
     or (public.review_stay_link_ends(t)::timestamp + time '05:00') at time zone 'UTC' - t < interval '58 days'
     or extract(day from public.review_stay_link_ends(t)) <> 1;
  if v_n = 0
     and public.review_stay_link_ends(timestamptz '2026-01-31 23:30 Europe/Prague') = date '2026-04-01'
     and public.review_stay_link_ends(timestamptz '2026-02-01 00:30 Europe/Prague') = date '2026-05-01'
  then raise notice 'ok the last day comes before day 90, on the first of a month, by the Prague day'; else raise exception 'FAIL last day (% out of bounds)', v_n; end if;

  -- 0. a stay from before the notice keeps its rating, never its text; with
  -- nothing to read, it is cut to its month at once.
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-old', 'external_listing_id', v_l1::text,
      'listing_id', v_l1, 'channel', 'booking', 'rating', 4, 'arrival_date', current_date - 75,
      'departure_date', current_date - 72, 'submitted_at', now() - interval '1 day',
      'reservation_id', v_res, 'external_reservation_id', 'R-old',
      'has_public_text', true, 'public_text', 'Old stay: text that must not be stored.')),
    p_host_id => v_host);
  select * into v_review from public.guest_reviews where external_id = 'suite-old';
  if v_review.public_text is null and v_review.rating = 4
  then raise notice 'ok a stay before the notice keeps the rating, not the text'; else raise exception 'FAIL history text'; end if;
  if not v_review.stay_exact and v_review.reservation_id is null and v_review.external_reservation_id is null
     and extract(day from v_review.arrival_date) = 1 and extract(day from v_review.departure_date) = 1
     and extract(day from v_review.submitted_at at time zone 'Europe/Prague') = 1
     and extract(day from v_review.created_at at time zone 'Europe/Prague') = 1
  then raise notice 'ok a review with nothing to read keeps its month, not its days or its booking'; else raise exception 'FAIL cut at load %', row_to_json(v_review); end if;

  -- 1. ingest: the test band skipped, a repeat inside the portion folded.
  v_out := public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-1', 'external_listing_id', v_l1::text,
      'listing_id', v_l1, 'channel', 'airbnb', 'rating', 8,
      'category_ratings', '{"cleanliness": 10}'::jsonb, 'arrival_date', current_date - 5,
      'departure_date', current_date - 3, 'submitted_at', now() - interval '1 day',
      'reservation_id', v_res, 'external_reservation_id', 'R-1', 'external_updated_at', now() - interval '20 hours',
      'has_public_text', true, 'public_text', 'The shower had no hot water. [GUEST] was told.'),
    jsonb_build_object('external_id', 'suite-test', 'external_listing_id', '900000000001',
      'listing_id', 900000000001, 'channel', 'booking', 'rating', 10,
      'submitted_at', now() - interval '1 day'),
    jsonb_build_object('external_id', 'suite-1', 'external_listing_id', v_l1::text,
      'listing_id', v_l1, 'channel', 'airbnb', 'rating', 8,
      'submitted_at', now() - interval '1 day')
  ), now(), v_host);
  if (v_out ->> 'inserted')::int = 1 and (v_out ->> 'journal_written')::boolean
     and not exists (select 1 from public.guest_reviews where external_id = 'suite-test')
  then raise notice 'ok ingest stores one, skips the test band and the repeat'; else raise exception 'FAIL ingest %', v_out; end if;

  -- 2. the same again changes nothing; a private text that comes later is added.
  v_out := public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-1', 'external_listing_id', v_l1::text,
      'listing_id', v_l1, 'channel', 'airbnb', 'rating', 8,
      'category_ratings', '{"cleanliness": 10}'::jsonb, 'arrival_date', current_date - 5,
      'departure_date', current_date - 3, 'submitted_at', now() - interval '1 day',
      'reservation_id', v_res, 'external_reservation_id', 'R-1',
      'has_public_text', true, 'private_text', 'Private: the boiler light blinked.')),
    p_host_id => v_host);
  if (v_out ->> 'inserted')::int = 0 and (v_out ->> 'updated')::int = 0 then raise notice 'ok a repeated load changes nothing'; else raise exception 'FAIL repeat %', v_out; end if;
  select id into v_r1 from public.guest_reviews where external_id = 'suite-1';
  select * into v_review from public.guest_reviews where id = v_r1;
  if v_review.public_text is not null and v_review.private_text is not null
     and v_review.text_purge_after is not null and extract(day from v_review.text_purge_after) = 1
  then raise notice 'ok the text is kept with its purge date (a first of the month), the late private part added'; else raise exception 'FAIL text'; end if;
  if v_review.stay_exact and v_review.reservation_id = v_res and v_review.external_reservation_id = 'R-1'
     and v_review.departure_date = current_date - 3 and v_review.arrival_date = current_date - 5
  then raise notice 'ok a review waiting for its reading keeps its exact days and its booking'; else raise exception 'FAIL exact while unread %', row_to_json(v_review); end if;

  -- 3. the watermark: moved, never ahead of now; a bad journal argument refused before any write.
  perform public.ingest_guest_reviews('hostaway', '[]'::jsonb, now() + interval '10 days', v_host);
  if public.review_sync_watermark('hostaway', v_host) <= now() then raise notice 'ok a future watermark is held at now'; else raise exception 'FAIL watermark'; end if;
  v_failed := false;
  begin
    perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
      jsonb_build_object('external_id', 'suite-x', 'external_listing_id', v_l1::text,
        'listing_id', v_l1, 'channel', 'airbnb', 'submitted_at', now())), now(), v_host, '{"oops": 1}'::jsonb);
  exception when invalid_parameter_value then v_failed := true;
  end;
  if v_failed and not exists (select 1 from public.guest_reviews where external_id = 'suite-x')
  then raise notice 'ok a bad journal argument writes nothing'; else raise exception 'FAIL errors arg'; end if;

  -- 3b. another company's listing is never ours; its reviews are its own.
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-foreign', 'external_listing_id', '900061020',
      'listing_id', 900061020, 'channel', 'airbnb', 'rating', 9, 'submitted_at', now())),
    p_host_id => v_host);
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-b', 'external_listing_id', '900061020',
      'listing_id', 900061020, 'channel', 'airbnb', 'rating', 9, 'submitted_at', now())),
    p_host_id => v_other);
  if (select property_id is null from public.guest_reviews where host_id = v_host and external_id = 'suite-foreign')
     and (select property_id = 900061020 from public.guest_reviews where host_id = v_other and external_id = 'suite-b')
  then raise notice 'ok a review lands only on its own company''s flat'; else raise exception 'FAIL tenant link'; end if;

  -- 4. one reading: a candidate, a statistic, one below the floor, two bad items skipped.
  v_out := public.apply_review_findings(v_r1, 'claude-haiku-5-5@prompt-v1', 'en-US', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'hot_water', 'urgency', 'high',
      'still_relevant', 'likely', 'confidence', 0.9,
      'summary_i18n', '{"en": "No hot water in the shower", "cs": "Ve sprše neteče teplá voda", "ru": "В душе нет горячей воды", "de": "Kein Warmwasser"}'::jsonb,
      'evidence', 'The shower had no hot water.', 'evidence_source', 'public'),
    jsonb_build_object('kind', 'cleaning', 'subject', 'dust_everywhere', 'confidence', 0.8,
      'summary_i18n', '{"en": "Dust on shelves", "cs": "Prach na policích", "ru": "Пыль на полках"}'::jsonb),
    jsonb_build_object('kind', 'repair', 'subject', 'appliance', 'confidence', 0.3,
      'summary_i18n', '{"en": "Kettle maybe broken", "cs": "Konvice možná rozbitá", "ru": "Чайник, возможно, сломан"}'::jsonb),
    jsonb_build_object('kind', 'bogus', 'subject', 'other', 'confidence', 0.9,
      'summary_i18n', '{"en": "x"}'::jsonb),
    jsonb_build_object('kind', 'repair', 'subject', 'electric', 'confidence', 0.9,
      'summary_i18n', '{"en": "See https://example.com", "cs": "x", "ru": "x"}'::jsonb)));
  if v_out = '{"candidate": 1, "no_task": 1, "dropped": 1, "invalid": 2}'::jsonb then raise notice 'ok decided, and two bad items cost only themselves'; else raise exception 'FAIL decide %', v_out; end if;
  if (select language = 'en' and analysed_at is not null from public.guest_reviews where id = v_r1)
     and (select subject from public.review_findings where review_id = v_r1 and kind = 'cleaning') = 'other'
     and not ((select summary_i18n from public.review_findings where review_id = v_r1 and subject = 'hot_water') ? 'de')
  then raise notice 'ok language, subject and translations normalised'; else raise exception 'FAIL normalise'; end if;
  perform public.apply_review_findings(v_r1, 'rules-v1', null, '[]'::jsonb);
  if (select stay_exact and reservation_id = v_res from public.guest_reviews where id = v_r1)
  then raise notice 'ok read, but a candidate waits: the days and the booking stay'; else raise exception 'FAIL exact while a candidate waits'; end if;

  v_out := public.apply_review_findings(v_r1, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'hot_water', 'confidence', 0.9,
      'summary_i18n', '{"en": "x", "cs": "x", "ru": "x"}'::jsonb)));
  if v_out = '{}'::jsonb then raise notice 'ok a repeated reading adds nothing'; else raise exception 'FAIL reread %', v_out; end if;

  -- 5. not a manager: refused.
  perform set_config('request.jwt.claims', json_build_object('sub', v_cleaner, 'role', 'authenticated')::text, true);
  select * into v_f from public.review_findings where review_id = v_r1 and subject = 'hot_water';
  v_summary := v_f.summary;
  v_failed := false;
  begin
    perform public.approve_review_finding(v_f.id);
  exception when insufficient_privilege then v_failed := true;
  end;
  if v_failed then raise notice 'ok a cleaner cannot approve'; else raise exception 'FAIL cleaner approved'; end if;

  -- 6. the manager approves: a problem from a review, nobody's report, pushed.
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  v_f := public.approve_review_finding(v_f.id);
  select * into v_problem from public.problems where id = v_f.problem_id;
  v_p1 := v_problem.id;
  if v_f.status = 'task_created' and v_problem.source = 'review' and v_problem.reported_by is null
     and v_problem.title = v_summary and v_problem.title_i18n ->> 'cs' = 'Ve sprše neteče teplá voda'
     and v_problem.review_facts ->> 'subject' = 'hot_water' and v_problem.property_id = v_l1
     and v_problem.status = 'open'
  then raise notice 'ok approved into a problem from a review, left in the open column'; else raise exception 'FAIL approve % %', row_to_json(v_f), row_to_json(v_problem); end if;
  if v_problem.review_facts ->> 'departure_month' = to_char(current_date - 3, 'YYYY-MM')
     and not (v_problem.review_facts ? 'departure_date')
  then raise notice 'ok the problem knows the month the guest left, never the day'; else raise exception 'FAIL facts %', v_problem.review_facts; end if;
  select * into v_review from public.guest_reviews where id = v_r1;
  if not v_review.stay_exact and v_review.reservation_id is null and v_review.external_reservation_id is null
     and v_review.departure_date = date_trunc('month', (current_date - 3)::timestamp)::date
     and v_review.arrival_date = date_trunc('month', (current_date - 5)::timestamp)::date
     and v_review.public_text is not null and v_review.property_id = v_l1
     and v_review.external_updated_at is null
     and extract(day from v_review.analysed_at at time zone 'Europe/Prague') = 1
     and extract(day from v_review.updated_at at time zone 'Europe/Prague') = 1
     and not exists (select 1 from public.review_findings
                     where review_id = v_r1 and extract(day from created_at at time zone 'Europe/Prague') <> 1)
  then raise notice 'ok decided: the days and the booking go, the place, the month and the text stay'; else raise exception 'FAIL cut at decision %', row_to_json(v_review); end if;
  select count(*) into v_n from raw.push_outbox where recipient_id = v_head and kind = 'problem_new'
    and params ->> 'problem_id' = v_problem.id::text;
  if v_n = 1 then raise notice 'ok the head technician is told although nobody reported it'; else raise exception 'FAIL push %', v_n; end if;
  if (select not urgent from raw.push_outbox where recipient_id = v_head and params ->> 'problem_id' = v_problem.id::text)
  then raise notice 'ok a high repair from a review does not wake anyone'; else raise exception 'FAIL urgent'; end if;
  if exists (select 1 from public.problem_events where problem_id = v_problem.id and kind = 'reported' and actor_id = v_manager)
  then raise notice 'ok the journal names the approving manager'; else raise exception 'FAIL journal'; end if;
  v_f := public.approve_review_finding(v_f.id);
  if (select count(*) from public.problems where source = 'review' and host_id = v_host) = 1 then raise notice 'ok a second press makes no second problem'; else raise exception 'FAIL idempotent'; end if;

  -- 6b. a cut review met again: no second row, the booking and the days stay gone.
  perform set_config('request.jwt.claims', '{}', true);
  v_out := public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-1', 'external_listing_id', v_l1::text,
      'listing_id', v_l1, 'channel', 'airbnb', 'rating', 9,
      'category_ratings', '{"cleanliness": 10}'::jsonb, 'arrival_date', current_date - 5,
      'departure_date', current_date - 3, 'submitted_at', now() - interval '1 day',
      'reservation_id', v_res, 'external_reservation_id', 'R-1', 'has_public_text', true)),
    p_host_id => v_host);
  select * into v_review from public.guest_reviews where id = v_r1;
  if (v_out ->> 'inserted')::int = 0 and (v_out ->> 'updated')::int = 1
     and (select count(*) from public.guest_reviews where external_id = 'suite-1') = 1
     and v_review.rating = 9 and not v_review.stay_exact and v_review.reservation_id is null
     and v_review.external_reservation_id is null and extract(day from v_review.departure_date) = 1
  then raise notice 'ok a cut review met again takes its new rating, never its days or its booking'; else raise exception 'FAIL reload cut % %', v_out, row_to_json(v_review); end if;

  -- 7. a second guest about the same: joins the open problem — with the
  -- stay already cut to its month (no text to read), the guard still holds.
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-2', 'external_listing_id', v_l1::text,
      'listing_id', v_l1, 'channel', 'booking', 'rating', 6,
      'submitted_at', now(), 'has_public_text', true)), now(), v_host);
  select id into v_r2 from public.guest_reviews where external_id = 'suite-2';
  v_out := public.apply_review_findings(v_r2, 'claude-haiku-5-5@prompt-v1', 'de', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'hot_water', 'confidence', 0.95,
      'evidence', 'Kein warmes Wasser in der Dusche, zwei Tage lang.',
      'summary_i18n', '{"en": "No hot water", "cs": "Bez teplé vody", "ru": "Нет горячей воды"}'::jsonb)));
  if v_out = '{"duplicate": 1}'::jsonb
     and (select problem_id from public.review_findings where review_id = v_r2) = v_problem.id
     and (select evidence is null from public.review_findings where review_id = v_r2)
     and (select not stay_exact from public.guest_reviews where id = v_r2)
     and (select extract(day from created_at at time zone 'Europe/Prague') = 1
                 and extract(day from updated_at at time zone 'Europe/Prague') = 1
          from public.review_findings where review_id = v_r2)
  then raise notice 'ok the same trouble joins the open problem, the stay cut or not; a finding after the cut keeps only the month'; else raise exception 'FAIL duplicate %', v_out; end if;

  -- 8. a rules finding on a room waits, writes no words, and leaves the review to the model.
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-3', 'external_listing_id', v_building::text,
      'listing_id', v_building, 'room_id', v_room, 'channel', 'airbnb', 'rating', 10,
      'submitted_at', now(), 'has_public_text', true)), now(), v_host);
  select id into v_r3 from public.guest_reviews where external_id = 'suite-3';
  if (select room_id from public.guest_reviews where id = v_r3) = v_room then raise notice 'ok a room is kept with its building'; else raise exception 'FAIL room'; end if;
  perform public.apply_review_findings(v_r3, 'rules-v1', null, jsonb_build_array(
    jsonb_build_object('kind', 'pests', 'subject', 'other', 'confidence', 0.7,
      'summary_i18n', '{"en": "Ants in the kitchen", "cs": "Mravenci v kuchyni", "ru": "Муравьи на кухне"}'::jsonb)));
  select * into v_f from public.review_findings where review_id = v_r3;
  if v_f.status = 'candidate' and v_f.property_id = v_room
     and v_f.summary = 'other' and v_f.summary_i18n = '{}'::jsonb
     and (select analysed_at is null and rules_version = 'rules-v1' from public.guest_reviews where id = v_r3)
  then raise notice 'ok a rules finding waits without words, and the model still reads the review'; else raise exception 'FAIL rules %', row_to_json(v_f); end if;

  -- 9. the manager cannot make a second work order for one fault — cut stays or not.
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-4', 'external_listing_id', v_l2::text, 'listing_id', v_l2,
      'channel', 'airbnb', 'rating', 6, 'submitted_at', now(), 'has_public_text', true),
    jsonb_build_object('external_id', 'suite-5', 'external_listing_id', v_l2::text, 'listing_id', v_l2,
      'channel', 'booking', 'rating', 5, 'submitted_at', now(), 'has_public_text', true)), now(), v_host);
  select id into v_r from public.guest_reviews where external_id = 'suite-4';
  perform public.apply_review_findings(v_r, 'rules-v1', null, jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'heating', 'confidence', 0.7)));
  select * into v_g from public.review_findings where review_id = v_r;
  select id into v_r from public.guest_reviews where external_id = 'suite-5';
  perform public.apply_review_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'heating', 'confidence', 0.9,
      'summary_i18n', '{"en": "Heating does not work", "cs": "Nefunguje topení", "ru": "Не работает отопление"}'::jsonb)));
  select * into v_f from public.review_findings where review_id = v_r;
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  v_f := public.approve_review_finding(v_f.id);
  v_p2 := v_f.problem_id;
  v_hint := null;
  begin
    perform public.approve_review_finding(v_g.id);
  exception when check_violation then
    get stacked diagnostics v_hint = pg_exception_hint, v_detail = pg_exception_detail;
  end;
  if v_hint = 'serverErrors.reviewDuplicateOpen' and (v_detail::jsonb ->> 'problem_id')::uuid = v_p2
  then raise notice 'ok a second approval of one fault is refused, naming the open one'; else raise exception 'FAIL approve twin % %', v_hint, v_detail; end if;
  v_g := public.approve_review_finding(v_g.id, p_link_problem_id => v_p2);
  if v_g.status = 'duplicate' and v_g.problem_id = v_p2 then raise notice 'ok linked by hand instead'; else raise exception 'FAIL link'; end if;

  -- 10. auto: a fresh exact stay on a clean place goes straight; an old review waits;
  -- a stay already cut to its month waits too.
  perform set_config('request.jwt.claims', '{}', true);
  update public.review_settings set auto_kinds = array['repair'] where host_id = v_host;
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-6', 'external_listing_id', v_l3::text, 'listing_id', v_l3,
      'channel', 'airbnb', 'rating', 8, 'arrival_date', current_date - 4, 'departure_date', current_date - 2,
      'submitted_at', now(), 'has_public_text', true, 'public_text', 'The socket by the bed is dead.'),
    jsonb_build_object('external_id', 'suite-7', 'external_listing_id', v_l4::text, 'listing_id', v_l4,
      'channel', 'booking', 'rating', 8, 'departure_date', current_date - 30,
      'submitted_at', now() - interval '20 days', 'has_public_text', true),
    jsonb_build_object('external_id', 'suite-cut-auto', 'external_listing_id', v_l8::text, 'listing_id', v_l8,
      'channel', 'airbnb', 'rating', 7, 'departure_date', current_date - 2,
      'submitted_at', now(), 'has_public_text', true)), now(), v_host);
  select id into v_r from public.guest_reviews where external_id = 'suite-6';
  v_out := public.apply_review_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'electric', 'confidence', 0.9,
      'summary_i18n', '{"en": "Socket by the bed is dead", "cs": "Zásuvka u postele nefunguje", "ru": "Не работает розетка у кровати"}'::jsonb)));
  if v_out = '{"task_created": 1}'::jsonb and (select decided_mode from public.review_findings where review_id = v_r) = 'auto'
     and (select stay_exact from public.guest_reviews where id = v_r)
  then raise notice 'ok the model read it, the rules not yet: the days stay'; else raise exception 'FAIL exact before the rules %', v_out; end if;
  perform public.apply_review_findings(v_r, 'rules-v1', null, '[]'::jsonb);
  if (select not stay_exact from public.guest_reviews where id = v_r)
  then raise notice 'ok a fresh exact stay on a clean place makes its problem at once, and is cut after'; else raise exception 'FAIL auto %', v_out; end if;
  select id into v_r from public.guest_reviews where external_id = 'suite-7';
  v_out := public.apply_review_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'electric', 'confidence', 0.9,
      'summary_i18n', '{"en": "Socket by the sofa is dead", "cs": "Zásuvka u gauče nefunguje", "ru": "Не работает розетка у дивана"}'::jsonb)));
  if v_out = '{"candidate": 1}'::jsonb then raise notice 'ok an old review waits for the manager even in auto'; else raise exception 'FAIL old auto %', v_out; end if;
  -- Cut at load (no text), its day put back by hand: only the cut itself
  -- stands between it and auto now.
  update public.guest_reviews set submitted_at = now() where external_id = 'suite-cut-auto';
  select id into v_r from public.guest_reviews where external_id = 'suite-cut-auto';
  v_out := public.apply_review_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'electric', 'confidence', 0.9,
      'summary_i18n', '{"en": "Socket in the hall is dead", "cs": "Zásuvka v chodbě nefunguje", "ru": "Не работает розетка в прихожей"}'::jsonb)));
  if v_out = '{"candidate": 1}'::jsonb then raise notice 'ok a fresh review whose stay is cut to its month never goes on its own'; else raise exception 'FAIL auto on cut %', v_out; end if;

  -- 11. auto is the admin's and earned; a manager may only take a kind out; the money is the admin's.
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  v_set := public.update_review_settings(p_auto_kinds => '{}');
  if v_set.auto_kinds = '{}' then raise notice 'ok a manager may take a kind out of auto'; else raise exception 'FAIL manager brake'; end if;
  v_hint := null;
  begin
    perform public.update_review_settings(p_auto_kinds => array['repair']);
  exception when insufficient_privilege then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint = 'serverErrors.reviewGateAdminOnly' then raise notice 'ok a manager cannot put a kind into auto'; else raise exception 'FAIL manager auto %', v_hint; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin
    perform public.update_review_settings(p_auto_kinds => array['repair']);
  exception when check_violation then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint = 'serverErrors.reviewAutoNotEarned' then raise notice 'ok nor an admin without the record'; else raise exception 'FAIL admin auto %', v_hint; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform public.update_review_settings(p_daily_model_cap => 500);
  exception when insufficient_privilege then v_failed := true;
  end;
  if v_failed then raise notice 'ok a manager cannot raise the model ceiling'; else raise exception 'FAIL cap'; end if;

  -- 12. a card without words needs the manager's title; reject calls its problem off while nobody is sent.
  select * into v_f from public.review_findings where review_id = v_r3;
  v_hint := null;
  begin
    perform public.approve_review_finding(v_f.id);
  exception when check_violation then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint = 'serverErrors.reviewTitleRequired' then raise notice 'ok a card without words needs a title'; else raise exception 'FAIL title required %', v_hint; end if;
  v_f := public.approve_review_finding(v_f.id, p_title => 'Ants in the kitchen');
  v_f := public.reject_review_finding(v_f.id, 'false_positive');
  select * into v_problem from public.problems where id = v_f.problem_id;
  if v_f.status = 'rejected' and v_problem.status = 'cancelled' and v_problem.archived_at is not null
     and v_problem.title = 'Ants in the kitchen'
  then raise notice 'ok rejected, and its problem called off'; else raise exception 'FAIL reject % %', row_to_json(v_f), row_to_json(v_problem); end if;

  -- 13. row security.
  perform set_config('request.jwt.claims', '{}', true);
  select count(*) into v_total from public.guest_reviews where host_id = v_host;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cleaner, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.guest_reviews;
  reset role;
  if v_n = 0 then raise notice 'ok a cleaner sees no review'; else raise exception 'FAIL cleaner sees %', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_head, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.review_findings;
  reset role;
  if v_n = 0 then raise notice 'ok the head technician sees no finding'; else raise exception 'FAIL head sees %', v_n; end if;
  set local role authenticated;
  select count(*) into v_n from public.problems where source = 'review' and review_facts ? 'kind';
  reset role;
  if v_n >= 1 then raise notice 'ok the head technician reads the facts on the problem'; else raise exception 'FAIL head facts %', v_n; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.guest_reviews;
  reset role;
  if v_n = v_total then raise notice 'ok the manager reads every review of the company'; else raise exception 'FAIL manager sees % of %', v_n, v_total; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_boss_b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.guest_reviews;
  reset role;
  if v_n = 1 then raise notice 'ok another company''s manager reads only its own'; else raise exception 'FAIL tenant read %', v_n; end if;

  -- 14. a place in maintenance goes to the manager.
  perform set_config('request.jwt.claims', '{}', true);
  update public.properties set status = 'maintenance' where id = v_l1;
  v_out := public.apply_review_findings(v_r2, 'claude-haiku-5-5@prompt-v1', 'de', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'lock_door', 'confidence', 0.9,
      'summary_i18n', '{"en": "Door lock sticks", "cs": "Zámek se zasekává", "ru": "Заедает замок"}'::jsonb)));
  if v_out = '{"candidate": 1}'::jsonb then raise notice 'ok a place in maintenance goes to the manager'; else raise exception 'FAIL maintenance %', v_out; end if;

  -- 15. a staff report still needs its reporter; the job's functions stay closed.
  v_failed := false;
  begin
    insert into public.problems (id, host_id, property_id, title) values (gen_random_uuid(), v_host, v_l2, 'x');
  exception when check_violation then v_failed := true;
  end;
  if v_failed then raise notice 'ok a staff problem without a reporter is refused'; else raise exception 'FAIL staff reporter'; end if;
  if not has_function_privilege('authenticated', 'public.ingest_guest_reviews(public.review_source, jsonb, timestamptz, uuid, jsonb)', 'execute')
     and not has_function_privilege('authenticated', 'public.apply_review_findings(uuid, text, text, jsonb)', 'execute')
     and not has_function_privilege('authenticated', 'public.decide_review_finding(uuid)', 'execute')
     and not has_function_privilege('authenticated', 'public.create_review_problem(uuid, text, jsonb, public.problem_priority, text, text)', 'execute')
     and not has_function_privilege('authenticated', 'public.reserve_review_model_calls(public.review_source, integer, uuid)', 'execute')
     and not has_function_privilege('authenticated', 'public.log_review_run(public.review_source, text, boolean, jsonb, jsonb, uuid)', 'execute')
     and not has_function_privilege('authenticated', 'public.mark_review_analysis_failed(uuid, text)', 'execute')
     and not has_function_privilege('authenticated', 'public.review_open_twin(uuid)', 'execute')
     and not has_function_privilege('authenticated', 'public.erase_review_texts(uuid[])', 'execute')
     and not has_function_privilege('service_role', 'public.erase_review_texts(uuid[])', 'execute')
     and not has_function_privilege('authenticated', 'public.cut_review_stay_links(uuid[])', 'execute')
     and not has_function_privilege('service_role', 'public.cut_review_stay_links(uuid[])', 'execute')
     and not has_function_privilege('authenticated', 'public.purge_review_data()', 'execute')
     and has_function_privilege('authenticated', 'public.review_place_problems(uuid)', 'execute')
     and has_function_privilege('authenticated', 'public.approve_review_finding(uuid, text, public.problem_priority, uuid, text, uuid, date)', 'execute')
  then raise notice 'ok the job functions are closed to clients, the card''s list is open'; else raise exception 'FAIL grants'; end if;

  -- 16. the model ceiling: booked before the calls, under one lock.
  if public.reserve_review_model_calls('hostaway', 5, v_host) = 0 then raise notice 'ok no calls while the model is off'; else raise exception 'FAIL calls off'; end if;
  update public.review_settings set model_enabled = true where host_id = v_host;
  if public.reserve_review_model_calls('hostaway', 9, v_host) = 9
     and public.reserve_review_model_calls('hostaway', 100, v_host) = 41
     and public.reserve_review_model_calls('hostaway', 1, v_host) = 0
  then raise notice 'ok calls are granted up to the ceiling and no further'; else raise exception 'FAIL reserve'; end if;
  perform public.log_review_run('hostaway', 'classify', true, '{"model_calls": 7, "read": 3}'::jsonb, p_host_id => v_host);
  if public.review_model_calls_left('hostaway', v_host) = 0
     and not exists (select 1 from raw.review_runs where counts ? 'read' and counts ? 'model_calls')
  then raise notice 'ok the end-of-run journal never counts calls twice'; else raise exception 'FAIL log'; end if;

  -- 17. a review the model cannot read leaves the queue after three tries.
  perform public.mark_review_analysis_failed(v_r3, 'model_bad_json');
  perform public.mark_review_analysis_failed(v_r3, 'model_bad_json');
  -- Called first, read after: inside one statement the read would see the
  -- row as it was before the call.
  v_n := public.mark_review_analysis_failed(v_r3, 'Model said: <html>');
  if v_n = 3
     and (select analysis_error from public.guest_reviews where id = v_r3) = 'unknown'
  then raise notice 'ok failures counted with a code, never free text'; else raise exception 'FAIL attempts'; end if;

  -- 17b. with the model on, the rules' reading alone settles nothing; the
  -- model giving up after three tries does.
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-wait', 'external_listing_id', v_l8::text,
      'listing_id', v_l8, 'channel', 'airbnb', 'rating', 9, 'arrival_date', current_date - 4,
      'departure_date', current_date - 2, 'submitted_at', now(), 'has_public_text', true,
      'public_text', 'All good.')), now(), v_host);
  select id into v_r from public.guest_reviews where external_id = 'suite-wait';
  perform public.apply_review_findings(v_r, 'rules-v1', null, '[]'::jsonb);
  if (select stay_exact from public.guest_reviews where id = v_r)
  then raise notice 'ok the rules read it, the model is on and has not: the days stay'; else raise exception 'FAIL exact waiting for the model'; end if;
  perform public.mark_review_analysis_failed(v_r, 'model_bad_json');
  perform public.mark_review_analysis_failed(v_r, 'model_bad_json');
  if (select stay_exact from public.guest_reviews where id = v_r)
  then raise notice 'ok two failures leave it waiting'; else raise exception 'FAIL cut after two failures'; end if;
  perform public.mark_review_analysis_failed(v_r, 'model_bad_json');
  if (select not stay_exact from public.guest_reviews where id = v_r)
  then raise notice 'ok the third failure takes it off the queue, and its days go'; else raise exception 'FAIL exact after three failures'; end if;

  -- 17c. the same review the model never read, and the admin switches the model off: settled at once.
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-model-off', 'external_listing_id', v_l8::text,
      'listing_id', v_l8, 'channel', 'booking', 'rating', 9, 'arrival_date', current_date - 4,
      'departure_date', current_date - 2, 'submitted_at', now(), 'has_public_text', true,
      'public_text', 'Nice flat.')), now(), v_host);
  select id into v_r from public.guest_reviews where external_id = 'suite-model-off';
  perform public.apply_review_findings(v_r, 'rules-v1', null, '[]'::jsonb);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.update_review_settings(p_model_enabled => false);
  perform set_config('request.jwt.claims', '{}', true);
  if (select not stay_exact from public.guest_reviews where id = v_r)
     and (select stay_exact from public.guest_reviews where external_id = 'suite-1') is false
  then raise notice 'ok the model off: a review the rules have read is settled at once'; else raise exception 'FAIL cut at model off'; end if;
  update public.review_settings set model_enabled = true where host_id = v_host;

  -- 19. a text past its column keeps its beginning and says so; a bad comment field costs only itself.
  v_out := public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-long', 'external_listing_id', v_l5::text,
      'listing_id', v_l5, 'channel', 'airbnb', 'rating', 6, 'arrival_date', current_date - 4,
      'departure_date', current_date - 2, 'submitted_at', now(), 'has_public_text', true,
      'public_text', repeat('The kettle is broken. ', 450),
      'category_comments', '["not", "an", "object"]'::jsonb),
    jsonb_build_object('external_id', 'suite-ok', 'external_listing_id', v_l5::text,
      'listing_id', v_l5, 'channel', 'booking', 'rating', 9, 'arrival_date', current_date - 4,
      'departure_date', current_date - 2, 'submitted_at', now(), 'has_public_text', true,
      'public_text', 'Fine, but the kettle did not work.',
      'category_comments', jsonb_build_object('staff', 'Very helpful', 'value', ' ',
                                              'location', repeat('x', 1500)))), now(), v_host);
  if (v_out ->> 'inserted')::int = 2
     and (select char_length(public_text) = 8000 and text_truncated and category_comments is null
          from public.guest_reviews where external_id = 'suite-long')
     and (select not text_truncated
                 and category_comments = jsonb_build_object('staff', 'Very helpful', 'location', repeat('x', 1000))
          from public.guest_reviews where external_id = 'suite-ok')
  then raise notice 'ok a long text keeps its beginning and says so; the portion is not lost'; else raise exception 'FAIL long %', v_out; end if;

  -- 20. hidden on the channel: the rating stays, the text is never kept.
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-h1', 'external_listing_id', v_l5::text,
      'listing_id', v_l5, 'channel', 'airbnb', 'rating', 3, 'arrival_date', current_date - 4,
      'departure_date', current_date - 2, 'submitted_at', now(), 'is_hidden', true,
      'has_public_text', true, 'public_text', 'Hidden: the oven does not heat.')), now(), v_host);
  if (select public_text is null and rating = 3 from public.guest_reviews where external_id = 'suite-h1')
  then raise notice 'ok a hidden review keeps its rating, never its text'; else raise exception 'FAIL hidden at load'; end if;

  -- 21. hidden after a load: the text goes at the next load, with the fragment and the wording drawn from it.
  select id into v_r4 from public.guest_reviews where external_id = 'suite-ok';
  perform public.apply_review_findings(v_r4, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'appliance', 'confidence', 0.9,
      'evidence', 'the kettle did not work', 'evidence_source', 'public',
      'summary_i18n', '{"en": "Kettle does not work", "cs": "Konvice nefunguje", "ru": "Не работает чайник"}'::jsonb)));
  if (select evidence is not null from public.review_findings where review_id = v_r4)
  then raise notice 'ok the fragment is kept while the text is'; else raise exception 'FAIL evidence kept'; end if;
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-ok', 'external_listing_id', v_l5::text,
      'listing_id', v_l5, 'channel', 'booking', 'rating', 9, 'arrival_date', current_date - 4,
      'departure_date', current_date - 2, 'submitted_at', now(), 'is_hidden', true,
      'has_public_text', true)), now(), v_host);
  select * into v_f from public.review_findings where review_id = v_r4 and subject = 'appliance';
  if (select public_text is null and category_comments is null and is_hidden and stay_exact
      from public.guest_reviews where id = v_r4)
     and v_f.evidence is null and v_f.summary = 'appliance' and v_f.summary_i18n = '{}'::jsonb
     and v_f.status = 'candidate'
  then raise notice 'ok hidden after a load: text, fragment and wording go, the card and its days stay'; else raise exception 'FAIL hidden after %', row_to_json(v_f); end if;
  -- A reading that lands after the erase (it was in flight) keeps no words either.
  perform public.apply_review_findings(v_r4, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'furniture', 'confidence', 0.9,
      'evidence', 'the wardrobe door', 'evidence_source', 'public',
      'summary_i18n', '{"en": "Wardrobe door is off", "cs": "Dvířka skříně upadla", "ru": "Отвалилась дверца шкафа"}'::jsonb)));
  if (select summary = 'furniture' and summary_i18n = '{}'::jsonb and evidence is null
      from public.review_findings where review_id = v_r4 and subject = 'furniture')
  then raise notice 'ok a reading after the erase keeps its card without words or fragment'; else raise exception 'FAIL reading after erase'; end if;

  -- 22. approved straight to the technician the manager picks, with the manager's own words.
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  v_f := public.approve_review_finding(v_f.id, p_title => 'Kettle does not work',
           p_description => 'Spare kettle in the storeroom', p_assignee_id => v_tech,
           p_scheduled_date => current_date + 1);
  select * into v_problem from public.problems where id = v_f.problem_id;
  select * into v_task from public.tasks
   where problem_id = v_problem.id and status not in ('done', 'cancelled', 'expired');
  if v_f.status = 'task_created' and v_problem.status = 'assigned'
     and v_problem.title = 'Kettle does not work' and v_problem.title_i18n is null
     and v_problem.description = 'Spare kettle in the storeroom'
     and v_task.assignee_id = v_tech and v_task.type = 'maintenance'
     and v_task.scheduled_date = current_date + 1 and v_task.notes = 'Spare kettle in the storeroom'
  then raise notice 'ok approved straight to the technician the manager picked'; else raise exception 'FAIL assign % %', row_to_json(v_problem), row_to_json(v_task); end if;
  if (select count(*) from public.problem_events
      where problem_id = v_problem.id and actor_id = v_manager and kind in ('reported', 'assigned')) = 2
  then raise notice 'ok the journal has the report and the assignment, both by the manager'; else raise exception 'FAIL journal assign'; end if;
  if (select stay_exact from public.guest_reviews where id = v_r4)
  then raise notice 'ok one finding decided, another still waiting: the days stay'; else raise exception 'FAIL exact with a candidate left'; end if;
  v_hint := null;
  select * into v_f from public.review_findings where review_id = v_r2 and subject = 'lock_door';
  begin
    perform public.approve_review_finding(v_f.id, p_assignee_id => v_cleaner);
  exception when check_violation then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint is null
     and (select status from public.review_findings where id = v_f.id) = 'task_created'
  then raise notice 'ok the office may send whoever is on the spot, as on the board'; else raise exception 'FAIL office assignee %', v_hint; end if;

  -- 23. the card's list while the days are exact: open problems and those
  -- reported or solved since the guest left; «уже починено» links to one.
  perform set_config('request.jwt.claims', '{}', true);
  v_fixed := gen_random_uuid();
  insert into public.problems (id, host_id, property_id, reported_by, title, status, resolved_at)
  values (v_fixed, v_host, v_l6, v_cleaner, 'Shower head replaced', 'resolved', now());
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-fix', 'external_listing_id', v_l6::text,
      'listing_id', v_l6, 'channel', 'airbnb', 'rating', 7, 'arrival_date', current_date - 6,
      'departure_date', current_date - 3, 'submitted_at', now(), 'has_public_text', true,
      'public_text', 'The shower head leaks.')), now(), v_host);
  select id into v_r from public.guest_reviews where external_id = 'suite-fix';
  perform public.apply_review_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'plumbing_leak', 'confidence', 0.9,
      'summary_i18n', '{"en": "Shower head leaks", "cs": "Sprchová hlavice kape", "ru": "Течёт лейка душа"}'::jsonb)));
  perform public.apply_review_findings(v_r, 'rules-v1', null, '[]'::jsonb);
  select * into v_f from public.review_findings where review_id = v_r;
  v_fixed2 := gen_random_uuid();
  insert into public.problems (id, host_id, property_id, reported_by, title, status, resolved_at)
  values (v_fixed2, v_host, v_l6, v_cleaner, 'Resolved without a day', 'resolved', null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  if exists (select 1 from public.review_place_problems(v_f.id) x where x.id = v_fixed and x.can_link)
     and exists (select 1 from public.review_place_problems(v_f.id) x where x.id = v_fixed2 and not x.can_link)
  then raise notice 'ok the list says which ones a link takes'; else raise exception 'FAIL can_link'; end if;
  v_hint := null;
  begin
    perform public.approve_review_finding(v_f.id, p_link_problem_id => v_fixed2);
  exception when check_violation then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_hint = 'serverErrors.reviewLinkInvalid' then raise notice 'ok a solved problem without its day is not taken as «уже починено»'; else raise exception 'FAIL null resolved link %', v_hint; end if;
  if v_f.status = 'candidate'
     and (select stay_exact from public.guest_reviews where id = v_r)
     and exists (select 1 from public.review_place_problems(v_f.id) x where x.id = v_fixed and not x.is_open)
     and not exists (select 1 from public.review_place_problems(v_f.id) x
                     where not x.is_open
                       and greatest(x.created_at, coalesce(x.resolved_at, x.created_at))::date < current_date - 3)
  then raise notice 'ok the card lists what is open and what was reported or solved since the guest left'; else raise exception 'FAIL place problems'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_cleaner, 'role', 'authenticated')::text, true);
  if not exists (select 1 from public.review_place_problems(v_f.id))
  then raise notice 'ok a cleaner gets no list'; else raise exception 'FAIL cleaner list'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  v_f := public.approve_review_finding(v_f.id, p_link_problem_id => v_fixed);
  if v_f.status = 'already_fixed' and v_f.problem_id = v_fixed and v_f.decided_mode = 'manager'
     and (select not stay_exact from public.guest_reviews where id = v_r)
  then raise notice 'ok «уже починено» links the repair done since the guest left, and the stay is cut'; else raise exception 'FAIL already fixed %', row_to_json(v_f); end if;

  -- 23b. «уже починено» by the rule: while the days are exact, a repair from a
  -- review solved since the guest left closes the new finding; once the stay
  -- is cut to its month, the rule steps back and a manager looks.
  perform set_config('request.jwt.claims', '{}', true);
  v_fixed := gen_random_uuid();
  insert into public.problems (id, host_id, property_id, reported_by, title, status, resolved_at,
                               source, review_facts)
  values (v_fixed, v_host, v_l7, null, 'Toilet flush repaired', 'resolved', now(), 'review',
          jsonb_build_object('kind', 'repair', 'subject', 'drain_toilet', 'channel', 'airbnb',
                             'departure_month', to_char(current_date, 'YYYY-MM')));
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-r5-exact', 'external_listing_id', v_l7::text,
      'listing_id', v_l7, 'channel', 'airbnb', 'rating', 7, 'arrival_date', current_date - 5,
      'departure_date', current_date - 2, 'submitted_at', now(), 'has_public_text', true,
      'public_text', 'The toilet did not flush.'),
    jsonb_build_object('external_id', 'suite-r5-cut', 'external_listing_id', v_l7::text,
      'listing_id', v_l7, 'channel', 'booking', 'rating', 6,
      'departure_date', current_date - 2, 'submitted_at', now(), 'has_public_text', true)), now(), v_host);
  select id into v_r from public.guest_reviews where external_id = 'suite-r5-exact';
  v_out := public.apply_review_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'drain_toilet', 'confidence', 0.9,
      'summary_i18n', '{"en": "Toilet does not flush", "cs": "Nesplachuje záchod", "ru": "Не смывает унитаз"}'::jsonb)));
  if v_out = '{"already_fixed": 1}'::jsonb
     and (select problem_id from public.review_findings where review_id = v_r) = v_fixed
  then raise notice 'ok with exact days the rule knows a repair done since the guest left'; else raise exception 'FAIL rule five exact %', v_out; end if;
  select id into v_r from public.guest_reviews where external_id = 'suite-r5-cut';
  v_out := public.apply_review_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'drain_toilet', 'confidence', 0.9,
      'summary_i18n', '{"en": "Toilet does not flush", "cs": "Nesplachuje záchod", "ru": "Не смывает унитаз"}'::jsonb)));
  if v_out = '{"candidate": 1}'::jsonb
  then raise notice 'ok with the month alone the rule steps back and a manager looks'; else raise exception 'FAIL rule five cut %', v_out; end if;

  -- 23c. the last day: a candidate waiting past it loses the days anyway; the
  -- card's list widens to the month, and the manager links what the month holds.
  v_before := gen_random_uuid();
  insert into public.problems (id, host_id, property_id, reported_by, title, status, created_at, resolved_at)
  values (v_before, v_host, v_l6, v_cleaner, 'Router restarted', 'resolved',
          (v_month + 3) + time '09:00', (v_month + 4) + time '12:00');
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-late-month', 'external_listing_id', v_l6::text,
      'listing_id', v_l6, 'channel', 'airbnb', 'rating', 6, 'arrival_date', v_month + 16,
      'departure_date', v_month + 19, 'submitted_at', (v_month + 20) + time '10:00',
      'has_public_text', true, 'public_text', 'The wifi kept dropping.')), now(), v_host);
  select id into v_r from public.guest_reviews where external_id = 'suite-late-month';
  perform public.apply_review_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'internet_tv', 'confidence', 0.9,
      'summary_i18n', '{"en": "Wi-Fi keeps dropping", "cs": "Wi-Fi vypadává", "ru": "Пропадает Wi-Fi"}'::jsonb)));
  perform public.apply_review_findings(v_r, 'rules-v1', null, '[]'::jsonb);
  select * into v_f from public.review_findings where review_id = v_r;
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin
    perform public.approve_review_finding(v_f.id, p_link_problem_id => v_before);
  exception when check_violation then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if v_f.status = 'candidate' and (select stay_exact from public.guest_reviews where id = v_r)
     and not exists (select 1 from public.review_place_problems(v_f.id) x where x.id = v_before)
     and v_hint = 'serverErrors.reviewLinkInvalid'
  then raise notice 'ok with exact days a repair from before the guest left is not on the card'; else raise exception 'FAIL exact list %', v_hint; end if;
  perform set_config('request.jwt.claims', '{}', true);
  update public.guest_reviews set submitted_at = submitted_at - interval '4 months' where id = v_r;
  perform public.purge_review_stays();
  if (select stay_exact from public.guest_reviews where id = v_r4)
  then raise notice 'ok the sweep leaves a waiting card with days left as it is'; else raise exception 'FAIL sweep took a waiting card'; end if;
  select * into v_review from public.guest_reviews where id = v_r;
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  if not v_review.stay_exact and v_review.departure_date = v_month and v_review.stay_after_notice
     and (select status from public.review_findings where id = v_f.id) = 'candidate'
     and exists (select 1 from public.review_place_problems(v_f.id) x where x.id = v_before and x.can_link)
  then raise notice 'ok past its last day a waiting card keeps the month, and the list widens to it'; else raise exception 'FAIL deadline cut %', row_to_json(v_review); end if;
  v_f := public.approve_review_finding(v_f.id, p_link_problem_id => v_before);
  if v_f.status = 'already_fixed' and v_f.problem_id = v_before
  then raise notice 'ok the manager links what the month holds'; else raise exception 'FAIL month link %', row_to_json(v_f); end if;

  -- 24. a place in the archive keeps ratings only: no text, no work, not even by hand.
  perform set_config('request.jwt.claims', '{}', true);
  update public.properties set status = 'archived' where id = v_l7;
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-arch', 'external_listing_id', v_l7::text,
      'listing_id', v_l7, 'channel', 'airbnb', 'rating', 5, 'arrival_date', current_date - 4,
      'departure_date', current_date - 2, 'submitted_at', now(), 'has_public_text', true,
      'public_text', 'The heating did not work.')), now(), v_host);
  select id into v_r from public.guest_reviews where external_id = 'suite-arch';
  v_out := public.apply_review_findings(v_r, 'rules-v1', null, jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'heating', 'confidence', 0.7)));
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  v_hint := null;
  begin
    perform public.add_review_finding(v_r, 'repair', 'electric', 'Socket does not work');
  exception when check_violation then get stacked diagnostics v_hint = pg_exception_hint;
  end;
  if (select public_text is null and rating = 5 from public.guest_reviews where id = v_r)
     and v_out = '{"no_task": 1}'::jsonb
     and v_hint = 'serverErrors.reviewPlaceArchived'
  then raise notice 'ok a place in the archive keeps its rating: no text, no work, not even by hand'; else raise exception 'FAIL archive % %', v_out, v_hint; end if;

  -- 25. the model first, the rules after: the rules add a card only where the model said nothing of that kind.
  perform set_config('request.jwt.claims', '{}', true);
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-mix1', 'external_listing_id', v_l4::text, 'listing_id', v_l4,
      'channel', 'airbnb', 'rating', 6, 'submitted_at', now(), 'has_public_text', true),
    jsonb_build_object('external_id', 'suite-mix2', 'external_listing_id', v_l4::text, 'listing_id', v_l4,
      'channel', 'airbnb', 'rating', 6, 'submitted_at', now(), 'has_public_text', true)), now(), v_host);
  select id into v_r from public.guest_reviews where external_id = 'suite-mix1';
  perform public.apply_review_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'heating', 'confidence', 0.9,
      'summary_i18n', '{"en": "Radiator stays cold", "cs": "Radiátor netopí", "ru": "Батарея холодная"}'::jsonb)));
  v_out := public.apply_review_findings(v_r, 'rules-v1', null, jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'other', 'confidence', 0.7),
    jsonb_build_object('kind', 'pests', 'subject', 'other', 'confidence', 0.7)));
  if v_out = '{"candidate": 1}'::jsonb
     and (select array_agg(kind::text || '/' || detector order by kind)
          from public.review_findings where review_id = v_r)
         = array['repair/claude-haiku-5-5@prompt-v1', 'pests/rules-v1']
  then raise notice 'ok after the model the rules add only the kind it did not see'; else raise exception 'FAIL rules after model %', v_out; end if;

  -- 26. the rules first (the model away), the model after: its reading takes over the waiting rules cards of that kind.
  select id into v_r from public.guest_reviews where external_id = 'suite-mix2';
  perform public.apply_review_findings(v_r, 'rules-v1', null, jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'other', 'confidence', 0.7),
    jsonb_build_object('kind', 'repair', 'subject', 'plumbing_leak', 'confidence', 0.7)));
  v_out := public.apply_review_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'plumbing_leak', 'confidence', 0.9,
      'summary_i18n', '{"en": "Sink drips", "cs": "Kape umyvadlo", "ru": "Капает раковина"}'::jsonb)));
  if v_out = '{"candidate": 1, "superseded": 1}'::jsonb
     and (select status = 'dropped' from public.review_findings where review_id = v_r and subject = 'other')
     and (select detector = 'claude-haiku-5-5@prompt-v1' and summary_i18n ->> 'en' = 'Sink drips'
                 and summary = summary_i18n ->> 'en' and status = 'candidate'
          from public.review_findings where review_id = v_r and subject = 'plumbing_leak')
     and (select analysed_at is not null from public.guest_reviews where id = v_r)
  then raise notice 'ok after the rules the model takes over their waiting cards'; else raise exception 'FAIL model after rules %', v_out; end if;

  -- 26b. a rules card a rule set aside (below the floor) still takes the model's reading.
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-mix3', 'external_listing_id', v_l4::text, 'listing_id', v_l4,
      'channel', 'booking', 'rating', 5, 'submitted_at', now(), 'has_public_text', true)), now(), v_host);
  select id into v_r from public.guest_reviews where external_id = 'suite-mix3';
  perform public.apply_review_findings(v_r, 'rules-v1', null, jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'window_blind', 'confidence', 0.4)));
  if (select status from public.review_findings where review_id = v_r) <> 'dropped' then raise exception 'FAIL rules below floor'; end if;
  v_out := public.apply_review_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', jsonb_build_array(
    jsonb_build_object('kind', 'repair', 'subject', 'window_blind', 'confidence', 0.9,
      'summary_i18n', '{"en": "Blind is stuck", "cs": "Roleta se zasekla", "ru": "Заело жалюзи"}'::jsonb)));
  if v_out = '{"candidate": 1}'::jsonb
     and (select status = 'candidate' and decided_mode is null and detector like 'claude-%' and summary_i18n ? 'cs'
          from public.review_findings where review_id = v_r)
  then raise notice 'ok a rules card set aside by a rule is taken over by the model, not lost'; else raise exception 'FAIL dropped rules card %', v_out; end if;

  -- 27. read with nothing found: cut at once; a part that comes later still
  -- sends the review back to the model (the notice is remembered past the cut).
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-late', 'external_listing_id', v_l6::text,
      'listing_id', v_l6, 'channel', 'airbnb', 'rating', 8, 'arrival_date', current_date - 4,
      'departure_date', current_date - 2, 'submitted_at', now(), 'has_public_text', true,
      'public_text', 'Lovely stay.')), now(), v_host);
  select id into v_r from public.guest_reviews where external_id = 'suite-late';
  perform public.apply_review_findings(v_r, 'claude-haiku-5-5@prompt-v1', 'en', '[]'::jsonb);
  if (select stay_exact from public.guest_reviews where id = v_r)
  then raise notice 'ok the model found nothing, the rules have not read it: the days stay for them'; else raise exception 'FAIL cut before the rules'; end if;
  perform public.apply_review_findings(v_r, 'rules-v1', null, '[]'::jsonb);
  if (select not stay_exact and stay_after_notice from public.guest_reviews where id = v_r)
  then raise notice 'ok both readers found nothing: the stay is cut at once'; else raise exception 'FAIL cut after an empty reading'; end if;
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-late', 'external_listing_id', v_l6::text,
      'listing_id', v_l6, 'channel', 'airbnb', 'rating', 8, 'arrival_date', current_date - 4,
      'departure_date', current_date - 2, 'submitted_at', now(), 'has_public_text', true,
      'has_private_text', true, 'private_text', 'Private: the hall light is out.')), now(), v_host);
  if (select analysed_at is null and private_text is not null and public_text = 'Lovely stay.'
      from public.guest_reviews where id = v_r)
  then raise notice 'ok a text that comes later sends the review back to its readers'; else raise exception 'FAIL late text'; end if;

  -- 28. an outage is the service's, not the review's: recorded, never counted.
  v_n := public.mark_review_analysis_failed(v_r, 'service_unavailable');
  if v_n = 0
     and (select analysis_error from public.guest_reviews where id = v_r) = 'service_unavailable'
  then raise notice 'ok a failure of the service is recorded, never counted against the review'; else raise exception 'FAIL service code'; end if;

  -- 18. the purge: texts, fragments, every wording drawn from them; problems keep their titles.
  perform public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-17m', 'external_listing_id', v_l6::text, 'listing_id', v_l6,
      'external_reservation_id', 'R-17m', 'channel', 'booking', 'rating', 7,
      'category_ratings', '{"cleanliness": 8}'::jsonb,
      'arrival_date', (now() - interval '17 months')::date - 3,
      'departure_date', (now() - interval '17 months')::date,
      'submitted_at', now() - interval '17 months')), now(), v_host);
  update public.guest_reviews set submitted_at = submitted_at - interval '2 months',
                                  departure_date = (departure_date - interval '2 months')::date,
                                  arrival_date = (arrival_date - interval '2 months')::date
   where external_id = 'suite-17m';
  select id into v_r from public.guest_reviews where external_id = 'suite-17m';
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  v_p3 := (public.add_review_finding(v_r, 'repair', 'mould_damp', 'Mould in the bathroom')).problem_id;
  perform set_config('request.jwt.claims', '{}', true);
  update public.guest_reviews set text_purge_after = current_date - 1 where id = v_r1;
  update public.review_findings set evidence = 'x' where review_id = v_r1;
  v_out := public.purge_review_data();
  -- Two: v_r1 past its date, and the text kept on L7 before L7 went to the archive.
  if (v_out ->> 'reviews')::int = 2
     and (select public_text is null from public.guest_reviews where external_id = 'suite-r5-exact')
     and (select public_text is null and private_text is null from public.guest_reviews where id = v_r1)
     and not exists (select 1 from public.review_findings where review_id = v_r1 and evidence is not null)
     and (select summary from public.review_findings where review_id = v_r1 and kind = 'cleaning') = 'other'
     and (select summary = 'hot_water' and summary_i18n = '{}'::jsonb
          from public.review_findings where review_id = v_r1 and subject = 'hot_water')
     and (select title = v_summary and title_i18n ? 'cs' from public.problems where id = v_p1)
  then raise notice 'ok purged: texts, fragments, wordings; the problem keeps its title'; else raise exception 'FAIL purge %', v_out; end if;

  -- 29. after 18 months the key goes too; such a review is never loaded again.
  if (v_out ->> 'keys')::int = 1
     and (select external_id = 'purged:' || id::text and external_reservation_id is null
                 and reservation_id is null and rating = 7 and category_ratings = '{"cleanliness": 8}'::jsonb
                 and not stay_exact
                 and extract(day from departure_date) = 1 and extract(day from arrival_date) = 1
                 and extract(day from created_at at time zone 'Europe/Prague') = 1
          from public.guest_reviews where id = v_r)
     and (select review_facts ? 'departure_month' and not review_facts ? 'departure_date'
          from public.problems where id = v_p3)
  then raise notice 'ok after 18 months the rating keeps its place and month, not its key'; else raise exception 'FAIL key purge %', v_out; end if;
  v_out2 := public.ingest_guest_reviews('hostaway', jsonb_build_array(
    jsonb_build_object('external_id', 'suite-17m', 'external_listing_id', v_l6::text, 'listing_id', v_l6,
      'external_reservation_id', 'R-17m', 'channel', 'booking', 'rating', 7,
      'submitted_at', now() - interval '19 months')), now(), v_host);
  if (v_out2 ->> 'inserted')::int = 0
     and not exists (select 1 from public.guest_reviews where external_id = 'suite-17m')
  then raise notice 'ok a review past 18 months is not loaded again'; else raise exception 'FAIL reload %', v_out2; end if;

  -- 30. texts off by the admin: everything kept goes at once, the model with it,
  -- and every stay that waited only for a reader is cut; a manager cannot.
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  v_failed := false;
  begin
    perform public.update_review_settings(p_texts_enabled => false);
  exception when insufficient_privilege then v_failed := true;
  end;
  if v_failed then raise notice 'ok a manager cannot switch texts off'; else raise exception 'FAIL manager texts'; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  v_set := public.update_review_settings(p_texts_enabled => false);
  if not v_set.texts_enabled and not v_set.model_enabled
     and not exists (select 1 from public.guest_reviews where host_id = v_host
                     and (public_text is not null or private_text is not null or category_comments is not null))
     and not exists (select 1 from public.review_findings where host_id = v_host and detector <> 'manual'
                     and (evidence is not null or summary_i18n <> '{}'::jsonb))
     and (select title = v_summary from public.problems where id = v_p1)
  then raise notice 'ok texts off: every text and wording go at once, the model with them; titles stay'; else raise exception 'FAIL texts off %', row_to_json(v_set); end if;
  if not exists (select 1 from public.guest_reviews g
                 where g.host_id = v_host and g.stay_exact
                   and not exists (select 1 from public.review_findings f
                                   where f.review_id = g.id and f.status = 'candidate'))
     and exists (select 1 from public.guest_reviews g where g.host_id = v_host and g.stay_exact)
  then raise notice 'ok with the readers gone only a stay a candidate waits on keeps its days'; else raise exception 'FAIL cut at texts off'; end if;
end;
$$;

rollback;
