-- DRAFT — tasks from guest reviews (docs/reviews-to-tasks.md). NOT FOR db push.
--
-- The whole end state in one file so the design can be read and checked in one
-- place. At implementation it is cut into one migration per step (§7 of the
-- design), each with a fresh timestamp after the cloud head, and the guard
-- below goes away. 20261017100000 is taken by the knowledge base (an unmerged
-- branch); this stamp only keeps the draft after it.
--
-- What it adds (sections below follow the steps):
--   step 0  public.guest_reviews (ratings, no text), public.review_settings,
--           raw.review_runs, ingest_guest_reviews(), review_sync_watermark()
--   step 1  problems.source / title_i18n / review_facts, reported_by nullable
--           for a review's problem, push_on_problem_reported() that still
--           reaches the head technicians when nobody reported it
--   step 2  the texts on guest_reviews (names replaced before they arrive),
--           kept 18 months — only once the guest notice is published
--   step 3  public.review_findings, apply_review_findings(), the decision
--           (candidate / task / duplicate / already fixed), the manager's
--           approve and reject, the settings RPC
--   all     row security (manager and admin of the company only), grants,
--           pg_cron jobs
--
-- Nothing here calls Hostaway or a model: that is the Edge Functions'
-- (sync-reviews, classify-reviews). Nothing here writes user-facing text: the
-- errors carry an English message, a serverErrors.* key and JSON params.

-- >>> draft guard: remove at implementation
do $$
begin
  raise exception 'Draft migration 20261017110000_reviews_to_tasks is not for db push'
    using hint = 'docs/reviews-to-tasks.md, section 7: it is cut into per-step migrations first';
end;
$$;
-- <<< draft guard

set local lock_timeout = '3s';

-- ===================================================================
-- step 0 — ratings without texts
-- ===================================================================

-- A PMS the reviews come from. The next one is a value added by its own
-- migration, together with its adapter (docs/reviews-to-tasks.md §2.4).
create type public.review_source as enum ('hostaway');

create type public.review_channel as enum ('airbnb', 'booking', 'vrbo', 'direct', 'google', 'other');

-- One guest's review of one stay, whatever PMS it came through. No guest name
-- anywhere: the adapter uses it only to strip it out of the text, in memory.
create table public.guest_reviews (
  id                      uuid primary key default gen_random_uuid(),
  host_id                 uuid not null references public.hosts (id) on delete restrict,
  source                  public.review_source not null,
  -- The review's id in the PMS: the key a repeated load meets again.
  external_id             text not null,
  -- The listing as the PMS names it; ours when we have the row.
  external_listing_id     text not null,
  property_id             bigint references public.properties (id) on delete set null,
  -- The room the stay took on a listing with rooms, when the booking says so.
  room_id                 bigint references public.properties (id) on delete set null,
  external_reservation_id text,
  -- Ours only while the row exists: the reservations table keeps the sync
  -- window, not the whole history.
  reservation_id          bigint references public.reservations (id) on delete set null,
  channel                 public.review_channel not null,
  -- 0–10 for every channel (Airbnb stars × 2).
  rating                  numeric(4, 2) check (rating between 0 and 10),
  -- {"cleanliness": 10, "checkin": 8, …} in one vocabulary for every channel.
  category_ratings        jsonb not null default '{}'::jsonb
                          check (jsonb_typeof(category_ratings) = 'object'),
  arrival_date            date,
  departure_date          date,
  submitted_at            timestamptz not null,
  is_hidden               boolean not null default false,
  has_public_text         boolean not null default false,
  has_private_text        boolean not null default false,
  has_host_reply          boolean not null default false,
  external_updated_at     timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint guest_reviews_one_per_source unique (host_id, source, external_id),
  constraint guest_reviews_room_needs_listing check (room_id is null or property_id is not null)
);

comment on table public.guest_reviews is
  'Guest reviews from the PMS: ratings always, texts only from step 2 (names replaced before storing). '
  'docs/reviews-to-tasks.md';

create index guest_reviews_place_idx on public.guest_reviews (host_id, property_id, submitted_at desc);
create index guest_reviews_reservation_idx on public.guest_reviews (reservation_id)
  where reservation_id is not null;
-- The foreign keys a delete of a place walks (on delete set null).
create index guest_reviews_property_idx on public.guest_reviews (property_id)
  where property_id is not null;
create index guest_reviews_room_idx on public.guest_reviews (room_id)
  where room_id is not null;

create trigger guest_reviews_touch
  before update on public.guest_reviews
  for each row execute function public.touch_updated_at();

-- What a company has switched on. Every switch is off until somebody turns it
-- on: the order of steps is the order these go true.
create table public.review_settings (
  host_id              uuid primary key references public.hosts (id) on delete cascade,
  -- step 0: the daily load of ratings.
  sync_enabled         boolean not null default false,
  -- step 2: texts are stored. Only after the guest notice is published.
  texts_enabled        boolean not null default false,
  -- step 1 gate: problems from reviews may be created. Only once the phone and
  -- the panel in the field read a problem without a reporter (OTA adopted).
  tasks_enabled        boolean not null default false,
  -- step 4: the model reads the texts. Terms accepted, key in the secrets.
  model_enabled        boolean not null default false,
  -- Variant C: kinds whose findings become problems without a manager.
  auto_kinds           text[] not null default '{}',
  -- A ceiling on model calls a day, whatever a bug in a loop would like.
  daily_model_cap      integer not null default 50 check (daily_model_cap between 0 and 500),
  -- Below this a finding is kept as dropped, never shown as a candidate.
  min_confidence       numeric(3, 2) not null default 0.60 check (min_confidence between 0 and 1),
  -- The date the guest notice went live; texts and the model need it.
  notice_published_at  timestamptz,
  updated_by           uuid references public.profiles (id) on delete set null,
  updated_at           timestamptz not null default now(),
  constraint review_settings_auto_are_task_kinds
    check (auto_kinds <@ array['repair', 'safety', 'pests', 'access']::text[]),
  constraint review_settings_texts_need_notice
    check (not texts_enabled or notice_published_at is not null),
  constraint review_settings_model_needs_texts
    check (not model_enabled or texts_enabled)
);

comment on table public.review_settings is
  'Per company: which steps of tasks-from-reviews are on. All off by default.';

create trigger review_settings_touch
  before update on public.review_settings
  for each row execute function public.touch_updated_at();

-- Each run of the two Edge Functions, as raw.generator_runs is for the
-- generator: what was read, what changed, how far the load got.
create table raw.review_runs (
  id           bigint generated always as identity primary key,
  host_id      uuid not null,
  source       public.review_source not null,
  stage        text not null check (stage in ('sync', 'classify')),
  ran_at       timestamptz not null default now(),
  -- sync: the newest submitted_at read completely; the next run starts here
  -- minus the overlap.
  watermark    timestamptz,
  is_ok        boolean not null,
  -- {"fetched": 17, "inserted": 15, "updated": 2, "model_calls": 9, …}
  counts       jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  -- Codes and counts only, never a review's text.
  errors       jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array')
);

create index review_runs_ran_at_idx on raw.review_runs (ran_at);
revoke all on raw.review_runs from public, anon, authenticated;

/**
 * Where the next daily load starts: the newest watermark of a run that
 * finished. Null before the first one — the function then loads the history
 * (12 months, the owner's decision of 2026-10-16) in portions.
 */
create or replace function public.review_sync_watermark(
  p_source  public.review_source,
  p_host_id uuid default null
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(r.watermark)
  from raw.review_runs r
  where r.host_id = coalesce(p_host_id, public.default_host_id())
    and r.source = p_source
    and r.stage = 'sync'
    and r.is_ok
$$;

/**
 * A run of classify-reviews, journaled from the Edge Function: raw is not
 * exposed through PostgREST, so the function writes through here. Model calls
 * are booked beforehand by reserve_review_model_calls(); this row carries the
 * rest (read, findings, problems, failures) and never "model_calls", which
 * would count them twice.
 */
create or replace function public.log_review_run(
  p_source  public.review_source,
  p_stage   text,
  p_is_ok   boolean,
  p_counts  jsonb default '{}'::jsonb,
  p_errors  jsonb default '[]'::jsonb,
  p_host_id uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into raw.review_runs (host_id, source, stage, is_ok, counts, errors)
  values (coalesce(p_host_id, public.default_host_id()), p_source, p_stage, p_is_ok,
          coalesce(p_counts, '{}'::jsonb) - 'model_calls', coalesce(p_errors, '[]'::jsonb))
$$;

/**
 * Model calls left today (Prague day) under the company's ceiling. The Edge
 * Function asks before each call; the console's spending limit is the second
 * fence (docs §3.3).
 */
create or replace function public.review_model_calls_left(
  p_source  public.review_source,
  p_host_id uuid default null
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((select s.daily_model_cap from public.review_settings s
              where s.host_id = coalesce(p_host_id, public.default_host_id())
                and s.model_enabled), 0)
    - coalesce((select sum((r.counts ->> 'model_calls')::integer)
                from raw.review_runs r
                where r.host_id = coalesce(p_host_id, public.default_host_id())
                  and r.source = p_source
                  and r.stage = 'classify'
                  and r.ran_at >= (date_trunc('day', now() at time zone 'Europe/Prague')
                                   at time zone 'Europe/Prague')), 0),
    0)::integer
$$;

/**
 * Take model calls out of today's ceiling before making them. Read-then-act
 * would let two runs (the cron and a manual one) both see the full ceiling,
 * and a run killed by the platform before it logs would leave no trace; so the
 * calls are booked first, under one lock, in a classify row of their own.
 * Returns how many were granted (0..p_wanted).
 */
create or replace function public.reserve_review_model_calls(
  p_source  public.review_source,
  p_wanted  integer,
  p_host_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host    uuid := coalesce(p_host_id, public.default_host_id());
  v_granted integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('review-model-calls:' || v_host, 0));
  v_granted := least(greatest(coalesce(p_wanted, 0), 0),
                     public.review_model_calls_left(p_source, v_host));
  if v_granted > 0 then
    insert into raw.review_runs (host_id, source, stage, is_ok, counts)
    values (v_host, p_source, 'classify', true,
            jsonb_build_object('model_calls', v_granted, 'reserved', true));
  end if;
  return v_granted;
end;
$$;

/**
 * One portion of normalized reviews from an adapter, upserted by the PMS's own
 * id. A repeated load meets the same rows and changes only what changed.
 *
 * `p_rows` is a JSON array of the neutral review (docs/reviews-to-tasks.md
 * §2.3). Text fields are stored only while `texts_enabled` is on, and arrive
 * with names already replaced by the adapter; otherwise they are dropped here
 * and only the "has text" flags stay. A listing in the test band
 * (analytics_is_test_listing) is skipped, not stored.
 *
 * `p_host_id` default null means "the one company there is" (F25 phase B
 * passes it). `p_watermark` null means "this portion is not the end of the
 * load": only the last portion of a run moves the watermark.
 */
create or replace function public.ingest_guest_reviews(
  p_source    public.review_source,
  p_rows      jsonb,
  p_watermark timestamptz default null,
  p_host_id   uuid default null,
  p_errors    jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host     uuid := coalesce(p_host_id, public.default_host_id());
  v_texts    boolean;
  v_inserted integer := 0;
  v_updated  integer := 0;
  v_skipped  integer := 0;
  v_total    integer;
  v_logged   boolean := false;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Reviews must be a JSON array'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.reviewRowsInvalid';
  end if;
  -- Checked before anything is written: a bad journal argument must not roll
  -- back a portion already upserted.
  if jsonb_typeof(coalesce(p_errors, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Run errors must be a JSON array'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.reviewRowsInvalid';
  end if;

  select coalesce(s.texts_enabled, false) into v_texts
  from public.review_settings s where s.host_id = v_host;
  v_texts := coalesce(v_texts, false);

  v_total := jsonb_array_length(p_rows);

  with incoming as (
    -- One row per review even if a page boundary repeated it: ON CONFLICT
    -- DO UPDATE refuses to touch a row twice in one statement.
    select distinct on (r.external_id) r.*
    from jsonb_to_recordset(p_rows) as r (
      external_id text, external_listing_id text, listing_id bigint, room_id bigint,
      external_reservation_id text, reservation_id bigint, channel public.review_channel,
      rating numeric, category_ratings jsonb, arrival_date date, departure_date date,
      submitted_at timestamptz, is_hidden boolean, has_public_text boolean,
      has_private_text boolean, has_host_reply boolean, external_updated_at timestamptz,
      public_text text, private_text text, category_comments jsonb, language text
    )
    where r.external_id is not null
      and r.submitted_at is not null
      and not public.analytics_is_test_listing(coalesce(r.listing_id, -1))
    order by r.external_id, r.external_updated_at desc nulls last
  ),
  -- Ours only within this company: in F25 phase B ids of two PMS accounts
  -- may meet, and a review must never land on another company's flat.
  resolved as (
    select i.*,
           (select p.id from public.properties p
             where p.id = i.listing_id and p.host_id = v_host) as our_listing,
           (select p.id from public.properties p
             where p.id = i.room_id and p.parent_id = i.listing_id and p.host_id = v_host) as our_room,
           (select x.id from public.reservations x
             where x.id = i.reservation_id and x.host_id = v_host) as our_reservation
    from incoming i
  ),
  written as (
    insert into public.guest_reviews as g (
      host_id, source, external_id, external_listing_id, property_id, room_id,
      external_reservation_id, reservation_id, channel, rating, category_ratings,
      arrival_date, departure_date, submitted_at, is_hidden, has_public_text,
      has_private_text, has_host_reply, external_updated_at
    )
    select v_host, p_source, r.external_id, r.external_listing_id, r.our_listing,
           case when r.our_listing is null then null else r.our_room end,
           r.external_reservation_id, r.our_reservation, coalesce(r.channel, 'other'),
           r.rating, coalesce(r.category_ratings, '{}'::jsonb), r.arrival_date,
           r.departure_date, r.submitted_at, coalesce(r.is_hidden, false),
           coalesce(r.has_public_text, false), coalesce(r.has_private_text, false),
           coalesce(r.has_host_reply, false), r.external_updated_at
    from resolved r
    on conflict (host_id, source, external_id) do update
      set rating              = excluded.rating,
          category_ratings    = excluded.category_ratings,
          is_hidden           = excluded.is_hidden,
          has_public_text     = excluded.has_public_text,
          has_private_text    = excluded.has_private_text,
          has_host_reply      = excluded.has_host_reply,
          external_updated_at = excluded.external_updated_at,
          -- Learned later, never forgotten: a booking that left the window
          -- keeps the link the row already had.
          property_id         = coalesce(excluded.property_id, g.property_id),
          room_id             = coalesce(excluded.room_id, g.room_id),
          reservation_id      = coalesce(excluded.reservation_id, g.reservation_id)
      where (g.rating, g.category_ratings, g.is_hidden, g.has_public_text,
             g.has_private_text, g.has_host_reply, g.property_id, g.room_id, g.reservation_id)
            is distinct from
            (excluded.rating, excluded.category_ratings, excluded.is_hidden,
             excluded.has_public_text, excluded.has_private_text, excluded.has_host_reply,
             coalesce(excluded.property_id, g.property_id), coalesce(excluded.room_id, g.room_id),
             coalesce(excluded.reservation_id, g.reservation_id))
    returning (xmax = 0) as is_new
  )
  select count(*) filter (where is_new), count(*) filter (where not is_new)
    into v_inserted, v_updated
  from written;

  v_skipped := v_total - v_inserted - v_updated;

  -- step 2: the texts, only while they may be kept (see below).
  if v_texts then
    perform public.store_review_texts(v_host, p_source, p_rows);
  end if;

  -- The run's journal: one row per portion, the last one carries the
  -- watermark. The lock is the generator's: never wait on a purge.
  begin
    lock table raw.review_runs in row exclusive mode nowait;
    -- Never ahead of now: a watermark from the future (a date bug, infinity)
    -- would win max() for good, and every later run would read nothing.
    insert into raw.review_runs (host_id, source, stage, watermark, is_ok, counts, errors)
    values (v_host, p_source, 'sync', least(p_watermark, now()),
            jsonb_array_length(coalesce(p_errors, '[]')) = 0,
            jsonb_build_object('received', v_total, 'inserted', v_inserted,
                               'updated', v_updated, 'unchanged_or_skipped', v_skipped),
            coalesce(p_errors, '[]'::jsonb));
    v_logged := true;
  exception when lock_not_available then
    null;
  end;

  -- journal_written false: the rows are in, the watermark did not move; the
  -- function says so, and the next run reads the same window again.
  return jsonb_build_object('received', v_total, 'inserted', v_inserted,
                            'updated', v_updated, 'unchanged_or_skipped', v_skipped,
                            'journal_written', v_logged);
end;
$$;

-- ===================================================================
-- step 1 — a problem can come from a review
-- ===================================================================

create type public.problem_source as enum ('staff', 'review');

alter table public.problems
  add column source       public.problem_source not null default 'staff',
  -- The title in en/cs/ru, as names a manager types are kept (x / x_i18n);
  -- validated by is_localized_text() in the writing function, not a CHECK
  -- (it reads an enum and is stable).
  add column title_i18n   jsonb
                          check (title_i18n is null or jsonb_typeof(title_i18n) = 'object'),
  -- What a technician may know of the review: kind, subject, channel,
  -- departure day. Never a quote (the owner's decision 3 of 2026-10-16).
  add column review_facts jsonb
                          check (review_facts is null or jsonb_typeof(review_facts) = 'object'),
  alter column reported_by drop not null,
  add constraint problems_staff_have_reporter
    check (source <> 'staff' or reported_by is not null),
  add constraint problems_review_has_facts
    check ((source = 'review') = (review_facts is not null));

comment on column public.problems.source is
  'staff: somebody reported it (reported_by set); review: found in a guest review, reported_by null.';

/**
 * The push about a new problem, now also for one nobody reported.
 *
 * Two changes to 20261003160000:
 * - `h.id <> new.reported_by` was null — and so false for everybody — when
 *   nobody reported it; `is distinct from` keeps the head technicians.
 * - A problem from a review is urgent only when it is about safety: the guest
 *   left days ago, and a dripping tap can wait for seven in the morning.
 */
create or replace function public.push_on_problem_reported()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  -- A leak at night cannot wait for seven; a squeaking door can.
  v_urgent boolean := new.priority = 'high'
                      and (new.source = 'staff' or new.review_facts ->> 'kind' = 'safety');
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
    -- Never the person who reported it, nor whoever wrote it. Null for a
    -- problem from a review: nobody to leave out.
    and h.id is distinct from new.reported_by
    and h.id is distinct from v_actor
    and exists (select 1 from public.push_tokens t where t.profile_id = h.id)
  order by h.id;

  return null;
end;
$$;

-- ===================================================================
-- step 2 — texts (names replaced before they arrive), 18 months
-- ===================================================================

alter table public.guest_reviews
  add column public_text       text check (char_length(public_text) <= 8000),
  add column private_text      text check (char_length(private_text) <= 4000),
  add column category_comments jsonb check (category_comments is null
                                            or jsonb_typeof(category_comments) = 'object'),
  -- ISO code of the text's language, from the model (Hostaway has none).
  add column language          text check (language ~ '^[a-z]{2,3}$'),
  -- The texts go at this date (18 months, the owner's decision 7); the
  -- ratings stay.
  add column text_purge_after  date,
  -- The model's reading. Set only by the model: a rules-only reading (the
  -- fallback when the model is down) leaves it null, so the model still reads
  -- the review once it is back.
  add column analysed_version  text,
  add column analysed_at       timestamptz,
  -- The rules' reading, kept apart for the same reason.
  add column rules_version     text,
  -- Failed readings: a review the model cannot read is tried three times and
  -- then left to the manager, not billed every day for ever.
  add column analysis_attempts integer not null default 0 check (analysis_attempts >= 0),
  -- A code, never text from the review.
  add column analysis_error    text check (analysis_error ~ '^[a-z0-9_.:-]{1,80}$'),
  add constraint guest_reviews_text_has_purge_date
    check ((public_text is null and private_text is null and category_comments is null)
           or text_purge_after is not null);

-- What classify-reviews reads: stored text not yet read. The "has text"
-- flags are not enough — the history of step 0 has them and no text.
create index guest_reviews_to_analyse_idx on public.guest_reviews (host_id, submitted_at desc)
  where analysed_at is null and analysis_attempts < 3
    and (public_text is not null or private_text is not null);

/**
 * The texts of a portion, written only by ingest_guest_reviews and only while
 * the company keeps texts. Names are replaced by the adapter before the row
 * is sent; this function cannot check that and does not pretend to.
 *
 * Only stays that began on or after the day the guest notice went live: the
 * guest had the line about reviews before writing one. Not the submission
 * date — Booking takes reviews up to three months after departure, and a
 * guest who stayed before the notice never saw it. A stay without a known
 * arrival keeps no text. This also keeps the history and the weekly re-read
 * of 100 days from turning old texts into findings.
 *
 * A part that comes later (a private text after the public one) is added; a
 * part already kept is not rewritten.
 */
create or replace function public.store_review_texts(
  p_host_id uuid,
  p_source  public.review_source,
  p_rows    jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.guest_reviews g
  set public_text       = coalesce(g.public_text, nullif(btrim(r.public_text), '')),
      private_text      = coalesce(g.private_text, nullif(btrim(r.private_text), '')),
      category_comments = coalesce(g.category_comments, r.category_comments),
      text_purge_after  = coalesce(g.text_purge_after, (g.submitted_at + interval '18 months')::date)
  from jsonb_to_recordset(p_rows) as r (external_id text, public_text text,
                                        private_text text, category_comments jsonb),
       public.review_settings s
  where g.host_id = p_host_id
    and g.source = p_source
    and g.external_id = r.external_id
    and s.host_id = p_host_id
    and s.notice_published_at is not null
    and g.arrival_date >= (s.notice_published_at at time zone 'Europe/Prague')::date
    and (g.text_purge_after is null or g.text_purge_after > current_date)
    and ((g.public_text is null and nullif(btrim(r.public_text), '') is not null)
         or (g.private_text is null and nullif(btrim(r.private_text), '') is not null)
         or (g.category_comments is null and r.category_comments is not null))
$$;

/**
 * The nightly purge of texts past their date, of the fragments quoted from
 * them, and of the model's paraphrase where it is not a problem's title: a
 * finding that made no work keeps only its kind and subject code. A problem's
 * title stays — it is the work order, worded without names or quotes.
 */
create or replace function public.purge_review_texts()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reviews  integer;
  v_findings integer;
begin
  update public.review_findings f
  set evidence     = null,
      summary      = case when f.problem_id is null then f.subject else f.summary end,
      summary_i18n = case when f.problem_id is null
                          then jsonb_build_object('en', f.subject) else f.summary_i18n end
  from public.guest_reviews g
  where f.review_id = g.id
    and g.text_purge_after <= current_date
    and (f.evidence is not null or (f.problem_id is null and f.summary <> f.subject));
  get diagnostics v_findings = row_count;

  update public.guest_reviews g
  set public_text = null, private_text = null, category_comments = null
  where g.text_purge_after <= current_date
    and (g.public_text is not null or g.private_text is not null or g.category_comments is not null);
  get diagnostics v_reviews = row_count;

  return jsonb_build_object('reviews', v_reviews, 'findings', v_findings);
end;
$$;

-- ===================================================================
-- step 3 — findings, the decision, the manager's word
-- ===================================================================

-- What a finding is about. Only the first four make a problem (the owner's
-- decision 2 of 2026-10-16); the rest are statistics.
create type public.review_finding_kind as enum (
  'repair', 'safety', 'pests', 'access',
  'cleaning', 'supplies', 'noise', 'neighbourhood', 'wish', 'other'
);

-- candidate: waits for a manager. task_created: a problem was made of it (by
-- the manager or, for an auto kind, by the job). duplicate: linked to a
-- problem already open about the same. already_fixed: the same was solved
-- after the guest left, or the guest says it was fixed during the stay.
-- rejected: a manager said no. no_task: a kind that never makes a problem, or
-- a place nobody works any more. dropped: below the confidence floor.
create type public.review_finding_status as enum (
  'candidate', 'task_created', 'duplicate', 'already_fixed', 'rejected', 'no_task', 'dropped'
);

create type public.review_reject_reason as enum (
  'false_positive', 'not_property', 'already_fixed', 'duplicate', 'not_worth'
);

/**
 * What a finding can be about — a closed list (plan 16.10 §3.4). Duplicates
 * are found by exact kind + subject, so a free code ("hot_water" one day,
 * "no_hot_water" the next) would never meet itself. A new subject is a new
 * value here, with its key in the locales (reviews.subject.*).
 */
create or replace function public.review_subjects()
returns text[]
language sql
immutable
parallel safe
set search_path = ''
as $$
  select array['hot_water', 'heating', 'air_conditioning', 'plumbing_leak', 'drain_toilet',
               'electric', 'appliance', 'internet_tv', 'lock_door', 'window_blind',
               'furniture', 'mould_damp', 'other']
$$;

create table public.review_findings (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid not null references public.hosts (id) on delete restrict,
  review_id       uuid not null references public.guest_reviews (id) on delete cascade,
  -- Where the work is: the room when the stay names one, else the listing.
  property_id     bigint references public.properties (id) on delete set null,
  kind            public.review_finding_kind not null,
  -- One of review_subjects(); anything else is mapped to 'other' on the way in.
  subject         text not null check (subject = any (public.review_subjects())),
  urgency         public.problem_priority not null default 'normal',
  still_relevant  text not null default 'unclear'
                  check (still_relevant in ('likely', 'fixed_during_stay', 'unclear')),
  -- In the company's language; the three languages beside it.
  summary         text not null check (char_length(btrim(summary)) between 1 and 200),
  summary_i18n    jsonb not null check (jsonb_typeof(summary_i18n) = 'object'),
  -- The anonymised fragment the finding rests on. Manager and admin only;
  -- purged with the review's text.
  evidence        text check (char_length(evidence) <= 300),
  evidence_source text check (evidence_source in ('public', 'private', 'category_comment')),
  confidence      numeric(3, 2) check (confidence between 0 and 1),
  -- 'rules-v1', 'claude-haiku-5-5@prompt-v1': which reader found it.
  detector        text not null check (detector ~ '^[a-z0-9.@_-]{3,80}$'),
  status          public.review_finding_status not null default 'candidate',
  -- manager, auto (an auto kind), rule (the kind or the place decided it).
  decided_mode    text check (decided_mode in ('manager', 'auto', 'rule')),
  reject_reason   public.review_reject_reason,
  -- The problem it made or joined. Problems are archived, never deleted.
  problem_id      uuid references public.problems (id) on delete set null,
  decided_by      uuid references public.profiles (id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A repeated reading of the same review adds nothing it already has.
  constraint review_findings_one_per_subject unique (review_id, kind, subject),
  constraint review_findings_reject_has_reason
    check (status <> 'rejected' or reject_reason is not null)
);

comment on table public.review_findings is
  'What a reader (rules or the model) found in a guest review, and what was decided about it.';

-- One finding made each problem; the others that met it are duplicates.
create unique index review_findings_one_origin on public.review_findings (problem_id)
  where status = 'task_created';
create index review_findings_queue_idx on public.review_findings (host_id, status, created_at desc);
create index review_findings_problem_idx on public.review_findings (problem_id)
  where problem_id is not null;
create index review_findings_property_idx on public.review_findings (property_id)
  where property_id is not null;

create trigger review_findings_touch
  before update on public.review_findings
  for each row execute function public.touch_updated_at();

/** The kinds that make a problem for a technician (the owner's decision 2). */
create or replace function public.review_kind_gives_task(p_kind public.review_finding_kind)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_kind in ('repair', 'safety', 'pests', 'access')
$$;

/**
 * A place and its family: the listing a room hangs under, or the listing
 * itself. Duplicates are looked for across the family — a leak reported on
 * the building is the same leak as in its room.
 */
create or replace function public.review_place_family(p_property_id bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.hostaway_unit_id is not null then p.parent_id else p.id end
  from public.properties p
  where p.id = p_property_id
$$;

/**
 * How a kind has done under the manager's eye: decisions in the last 60 days
 * and the share approved. Variant C turns a kind to auto only at ≥ 50
 * decisions and ≥ 90 % (the owner's decision 1).
 */
create or replace function public.review_kind_record(
  p_host_id uuid,
  p_kind    public.review_finding_kind
)
returns table (decisions integer, approved integer)
language sql
stable
security definer
set search_path = ''
as $$
  -- The readers' record, not the manager's: a finding filed by hand
  -- (detector 'manual') says nothing about the rules or the model. A problem
  -- the job made and somebody later cancelled counts as a "no".
  select count(*)::integer,
         count(*) filter (where f.decided_mode = 'manager'
                            and f.status in ('task_created', 'duplicate', 'already_fixed'))::integer
  from public.review_findings f
  left join public.problems pr on pr.id = f.problem_id
  where f.host_id = p_host_id
    and f.kind = p_kind
    and f.detector <> 'manual'
    and f.decided_at >= now() - interval '60 days'
    and (f.decided_mode = 'manager'
         or (f.decided_mode = 'auto' and f.status = 'task_created' and pr.status = 'cancelled'))
$$;

/**
 * The open problem from a review about the same thing — same kind, same
 * subject — anywhere in the finding's place family; null if there is none.
 * One lookup for the job (decide_review_finding) and for the manager
 * (approve_review_finding), so neither makes a second work order for one
 * fault. Callers hold the family's lock.
 *
 * Internal: no grants.
 */
create or replace function public.review_open_twin(p_finding_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id
  from public.review_findings f
  join public.problems pr
    on pr.host_id = f.host_id
   and pr.source = 'review'
   and pr.archived_at is null
   and pr.status in ('open', 'assigned', 'in_progress')
   and pr.review_facts ->> 'kind' = f.kind::text
   and pr.review_facts ->> 'subject' = f.subject
   and public.review_place_family(pr.property_id) = public.review_place_family(f.property_id)
  where f.id = p_finding_id
  order by pr.created_at
  limit 1
$$;

/**
 * Make the problem a finding asks for — the same insert into the same table as
 * report_problem, so the same triggers run: the journal (reported, actor =
 * whoever approved, null for the job) and the push to the head technicians.
 * report_problem itself is not touched (docs §4.5).
 *
 * Internal: no grants. Callers hold the place's lock and have checked the
 * finding.
 */
create or replace function public.create_review_problem(
  p_finding_id uuid,
  p_title      text,
  p_title_i18n jsonb,
  p_priority   public.problem_priority,
  p_mode       text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finding public.review_findings;
  v_review  public.guest_reviews;
  v_id      uuid := gen_random_uuid();
begin
  select * into v_finding from public.review_findings where id = p_finding_id;
  select * into v_review from public.guest_reviews where id = v_finding.review_id;

  -- assign_problem refuses a problem without a place (problemNoProperty):
  -- one made here would sit in the pool and never reach a technician.
  if v_finding.property_id is null then
    raise exception 'Finding % has no place to send anyone to', p_finding_id
      using errcode = 'check_violation', hint = 'serverErrors.reviewFindingNoPlace';
  end if;

  perform public.validate_problem_text(p_title, null);
  if p_title_i18n is not null and not public.is_localized_text(p_title_i18n) then
    raise exception 'Title translations are not valid localized text'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.localizedTextInvalid';
  end if;

  insert into public.problems (id, host_id, property_id, reported_by, title, title_i18n,
                               priority, source, review_facts)
  values (v_id, v_finding.host_id, v_finding.property_id, null, btrim(p_title), p_title_i18n,
          p_priority, 'review',
          jsonb_build_object('kind', v_finding.kind, 'subject', v_finding.subject,
                             'channel', v_review.channel,
                             'departure_date', v_review.departure_date));

  update public.review_findings
  set status = 'task_created', problem_id = v_id, decided_mode = p_mode,
      decided_by = (select auth.uid()), decided_at = now()
  where id = p_finding_id;

  return v_id;
end;
$$;

/**
 * What becomes of a fresh finding: the rules of docs §4.3, in order. Runs in
 * the job's transaction with the place family locked, so two findings about
 * one flat — or the job and a manager — never make two problems.
 *
 * Internal: no grants.
 */
create or replace function public.decide_review_finding(p_finding_id uuid)
returns public.review_finding_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finding  public.review_findings;
  v_review   public.guest_reviews;
  v_settings public.review_settings;
  v_family   bigint;
  v_status   public.property_status;
  v_match    uuid;
begin
  select * into v_finding from public.review_findings where id = p_finding_id for update;
  if v_finding.status <> 'candidate' then
    return v_finding.status;
  end if;
  select * into v_review from public.guest_reviews where id = v_finding.review_id;
  select * into v_settings from public.review_settings where host_id = v_finding.host_id;
  select p.status into v_status from public.properties p where p.id = v_finding.property_id;

  -- 1. Kinds that never make a problem, and places nobody works any more. A
  -- place in maintenance stays: the manager knows whether this is the repair
  -- it is closed for (it never goes automatically — rule 6).
  if not public.review_kind_gives_task(v_finding.kind)
     or v_finding.property_id is null
     or v_status is distinct from 'active' and v_status is distinct from 'maintenance' then
    update public.review_findings
    set status = 'no_task', decided_mode = 'rule', decided_at = now()
    where id = p_finding_id;
    return 'no_task';
  end if;

  -- 2. Below the floor: kept for the record, never shown as work.
  if coalesce(v_finding.confidence, 0) < coalesce(v_settings.min_confidence, 0.60) then
    update public.review_findings
    set status = 'dropped', decided_mode = 'rule', decided_at = now()
    where id = p_finding_id;
    return 'dropped';
  end if;

  -- 3. The guest says it was fixed while they stayed.
  if v_finding.still_relevant = 'fixed_during_stay' then
    update public.review_findings
    set status = 'already_fixed', decided_mode = 'rule', decided_at = now()
    where id = p_finding_id;
    return 'already_fixed';
  end if;

  v_family := public.review_place_family(v_finding.property_id);
  perform pg_advisory_xact_lock(hashtextextended('review-place:' || v_family, 0));

  -- 4. Already open from a review about the same, anywhere in the family.
  v_match := public.review_open_twin(p_finding_id);
  if v_match is not null then
    update public.review_findings
    set status = 'duplicate', problem_id = v_match, decided_mode = 'rule', decided_at = now()
    where id = p_finding_id;
    return 'duplicate';
  end if;

  -- 5. Solved after the guest left: someone found it before the review came.
  select pr.id into v_match
  from public.problems pr
  where pr.host_id = v_finding.host_id
    and pr.source = 'review'
    and pr.status = 'resolved'
    and pr.resolved_at::date >= coalesce(v_review.departure_date, v_review.submitted_at::date)
    and public.review_place_family(pr.property_id) = v_family
    and pr.review_facts ->> 'kind' = v_finding.kind::text
    and pr.review_facts ->> 'subject' = v_finding.subject
  order by pr.resolved_at desc
  limit 1;
  if v_match is not null then
    update public.review_findings
    set status = 'already_fixed', problem_id = v_match, decided_mode = 'rule', decided_at = now()
    where id = p_finding_id;
    return 'already_fixed';
  end if;

  -- 6. Automatic only for a kind the company switched to auto, read by the
  -- model (rules alone never make a problem), about a fresh review (Booking
  -- takes them for three months), and on a place where nothing was reported
  -- since the guest left — open or already solved, by anyone: a staff report
  -- has no kind to compare, so a human looks.
  if coalesce(v_settings.tasks_enabled, false)
     and v_status = 'active'
     and v_finding.kind::text = any (coalesce(v_settings.auto_kinds, '{}'))
     and v_finding.detector not like 'rules-%'
     and v_finding.detector <> 'manual'
     and v_review.submitted_at >= now() - interval '7 days'
     and not exists (
       select 1 from public.problems pr
       where pr.host_id = v_finding.host_id
         and public.review_place_family(pr.property_id) = v_family
         and ((pr.archived_at is null and pr.status in ('open', 'assigned', 'in_progress'))
              or pr.created_at::date >= coalesce(v_review.departure_date, v_review.submitted_at::date))
     ) then
    perform public.create_review_problem(
      p_finding_id, v_finding.summary, v_finding.summary_i18n, v_finding.urgency, 'auto');
    return 'task_created';
  end if;

  -- 7. Otherwise a manager decides.
  return 'candidate';
end;
$$;

/**
 * One review's reading, applied in one transaction: the findings are stored
 * (a repeated reading adds only new subjects), each is decided, the review is
 * marked as read by this version. Called by classify-reviews.
 *
 * `p_findings` — JSON array of {kind, subject, urgency, still_relevant,
 * summary_i18n {en, cs, ru}, evidence, evidence_source, confidence}.
 *
 * Every item is read as text and checked here, so one bad field from the
 * model costs that finding, not the review (and not a paid retry every day):
 * an unknown kind drops it; an unknown subject becomes 'other'; the summary
 * keeps only en/cs/ru, non-empty, ≤ 200 characters; a summary with a link, an
 * address or the guest's own words (a quote of the evidence) is dropped — it
 * would become the title technicians read. The evidence is kept only for a
 * review whose text is kept (it is purged with it).
 *
 * A rules-only reading (rules-*) marks rules_version and leaves the review
 * open for the model.
 */
create or replace function public.apply_review_findings(
  p_review_id uuid,
  p_detector  text,
  p_language  text,
  p_findings  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review   public.guest_reviews;
  v_language text;
  v_ids      uuid[];
  v_id       uuid;
  v_valid    integer;
  v_code     text;
  v_status   public.review_finding_status;
  v_counts   jsonb := '{}'::jsonb;
begin
  select * into v_review from public.guest_reviews where id = p_review_id for update;
  if not found then
    raise exception 'Review % not found', p_review_id
      using errcode = 'no_data_found', hint = 'serverErrors.reviewNotFound';
  end if;
  if jsonb_typeof(p_findings) is distinct from 'array' then
    raise exception 'Findings must be a JSON array'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.reviewFindingsInvalid';
  end if;

  select h.default_language::text into v_language from public.hosts h where h.id = v_review.host_id;

  -- Read as text, checked, normalised; stored first and decided after (a FOR
  -- loop runs its query through a cursor, and a cursor may not hold an INSERT
  -- in its WITH).
  with items as (
    select e as item
    from jsonb_array_elements(p_findings) as e
    where jsonb_typeof(e) = 'object'
  ),
  parsed as (
    select
      i.item ->> 'kind' as kind_text,
      case when i.item ->> 'subject' = any (public.review_subjects())
           then i.item ->> 'subject' else 'other' end as subject,
      case when i.item ->> 'urgency' in ('low', 'normal', 'high')
           then (i.item ->> 'urgency')::public.problem_priority else 'normal' end as urgency,
      case when i.item ->> 'still_relevant' in ('likely', 'fixed_during_stay', 'unclear')
           then i.item ->> 'still_relevant' else 'unclear' end as still_relevant,
      (select coalesce(jsonb_object_agg(s.k, left(btrim(s.v), 200)), '{}'::jsonb)
       from jsonb_each_text(case when jsonb_typeof(i.item -> 'summary_i18n') = 'object'
                                 then i.item -> 'summary_i18n' else '{}'::jsonb end) as s (k, v)
       where s.k in ('en', 'cs', 'ru') and btrim(s.v) <> '') as summary_i18n,
      i.item ->> 'evidence' as raw_evidence,
      case when i.item ->> 'evidence_source' in ('public', 'private', 'category_comment')
           then i.item ->> 'evidence_source' end as evidence_source,
      case when jsonb_typeof(i.item -> 'confidence') = 'number'
           then least(greatest((i.item ->> 'confidence')::numeric, 0), 1) end as confidence
    from items i
  ),
  valid as (
    select case when p.kind_text = any (enum_range(null::public.review_finding_kind)::text[])
                then p.kind_text::public.review_finding_kind end as kind,
           p.subject, p.urgency, p.still_relevant, p.summary_i18n, p.evidence_source, p.confidence,
           coalesce(p.summary_i18n ->> v_language, p.summary_i18n ->> 'en',
                    p.summary_i18n ->> 'cs', p.summary_i18n ->> 'ru') as summary,
           case when v_review.text_purge_after is not null then left(p.raw_evidence, 300) end as evidence
    from parsed p
    where p.kind_text = any (enum_range(null::public.review_finding_kind)::text[])
      and p.summary_i18n <> '{}'::jsonb
      -- Technicians read this as the title: no link, no address, no quote. A
      -- short neutral phrase ("no hot water") may well be the guest's words
      -- too; a long one copied whole, or the fragment pasted in, is a quote.
      and not exists (
        select 1 from jsonb_each_text(p.summary_i18n) as s (k, v)
        where s.v ~* '(https?:|www\.|@)'
           or (char_length(s.v) >= 40
               and position(lower(s.v) in lower(coalesce(p.raw_evidence, ''))) > 0)
           or (char_length(coalesce(p.raw_evidence, '')) >= 30
               and position(lower(p.raw_evidence) in lower(s.v)) > 0))
  ),
  deduped as (
    select distinct on (v.kind, v.subject) v.*
    from valid v
    order by v.kind, v.subject, v.confidence desc nulls last
  ),
  stored as (
    insert into public.review_findings as rf (
      host_id, review_id, property_id, kind, subject, urgency, still_relevant,
      summary, summary_i18n, evidence, evidence_source, confidence, detector
    )
    select v_review.host_id, v_review.id, coalesce(v_review.room_id, v_review.property_id),
           d.kind, d.subject, d.urgency, d.still_relevant, d.summary, d.summary_i18n,
           d.evidence, d.evidence_source, d.confidence, p_detector
    from deduped d
    on conflict (review_id, kind, subject) do nothing
    returning rf.id
  )
  select coalesce(array_agg(id), '{}'), (select count(*) from valid)
    into v_ids, v_valid
  from stored;

  if jsonb_array_length(p_findings) > v_valid then
    v_counts := jsonb_build_object('invalid', jsonb_array_length(p_findings) - v_valid);
  end if;

  foreach v_id in array v_ids loop
    v_status := public.decide_review_finding(v_id);
    v_counts := jsonb_set(v_counts, array[v_status::text],
                          to_jsonb(coalesce((v_counts ->> v_status::text)::integer, 0) + 1));
  end loop;

  -- en-US, EN, en_GB → en; anything else is not a language code and is dropped.
  v_code := lower(split_part(replace(coalesce(p_language, ''), '_', '-'), '-', 1));
  if v_code !~ '^[a-z]{2,3}$' then
    v_code := null;
  end if;

  if p_detector like 'rules-%' then
    update public.guest_reviews
    set rules_version = p_detector, language = coalesce(language, v_code)
    where id = p_review_id;
  else
    update public.guest_reviews
    set analysed_version = p_detector, analysed_at = now(), analysis_error = null,
        language = coalesce(v_code, language)
    where id = p_review_id;
  end if;

  return v_counts;
end;
$$;

/**
 * A reading that failed (the model's answer did not parse, the call errored):
 * counted, with a code. After three the review leaves the model's queue
 * (guest_reviews_to_analyse_idx) and stops taking the daily ceiling; the
 * manager still has it under «Все отзывы».
 */
create or replace function public.mark_review_analysis_failed(
  p_review_id uuid,
  p_error     text
)
returns integer
language sql
security definer
set search_path = ''
as $$
  update public.guest_reviews
  set analysis_attempts = analysis_attempts + 1,
      analysis_error    = case when p_error ~ '^[a-z0-9_.:-]{1,80}$' then p_error else 'unknown' end
  where id = p_review_id and analysed_at is null
  returning analysis_attempts
$$;

/**
 * The manager says yes: a problem is made of the finding — or, with
 * `p_link_problem_id`, the finding joins a problem already open on the same
 * place. Idempotent: a second press returns the finding as the first left it.
 */
create or replace function public.approve_review_finding(
  p_finding_id      uuid,
  p_title           text default null,
  p_priority        public.problem_priority default null,
  p_link_problem_id uuid default null
)
returns public.review_findings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finding public.review_findings;
  v_enabled boolean;
  v_link    public.problems;
  v_twin    uuid;
begin
  if not public.is_manager() then
    raise exception 'Only a manager decides about findings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;

  select * into v_finding from public.review_findings
  where id = p_finding_id and host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Finding % not found', p_finding_id
      using errcode = 'no_data_found', hint = 'serverErrors.reviewFindingNotFound';
  end if;
  if v_finding.status in ('task_created', 'duplicate') then
    return v_finding;
  end if;
  -- The manager may overrule the rules: a finding dropped for low confidence,
  -- or one they took for fixed, can still become work. A rejection, or a kind
  -- or place that never makes a problem, cannot.
  if v_finding.status not in ('candidate', 'dropped', 'already_fixed') then
    raise exception 'Finding % is already decided', p_finding_id
      using errcode = 'check_violation', hint = 'serverErrors.reviewFindingDecided',
            detail = jsonb_build_object('status', v_finding.status)::text;
  end if;

  select coalesce(s.tasks_enabled, false) into v_enabled
  from public.review_settings s where s.host_id = v_finding.host_id;
  if not coalesce(v_enabled, false) then
    raise exception 'Problems from reviews are switched off'
      using errcode = 'check_violation', hint = 'serverErrors.reviewTasksDisabled';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('review-place:' || public.review_place_family(v_finding.property_id), 0));

  if p_link_problem_id is not null then
    select * into v_link from public.problems
    where id = p_link_problem_id and host_id = v_finding.host_id;
    if not found
       or v_link.archived_at is not null
       or v_link.status not in ('open', 'assigned', 'in_progress')
       or public.review_place_family(v_link.property_id)
          is distinct from public.review_place_family(v_finding.property_id) then
      raise exception 'Problem % cannot take this finding', p_link_problem_id
        using errcode = 'check_violation', hint = 'serverErrors.reviewLinkInvalid';
    end if;
    update public.review_findings
    set status = 'duplicate', problem_id = v_link.id, decided_mode = 'manager',
        decided_by = (select auth.uid()), decided_at = now()
    where id = p_finding_id
    returning * into v_finding;
    return v_finding;
  end if;

  -- The same fault already has its work order (two guests, or a candidate
  -- that waited while the job made one): no second visit. The screen offers
  -- «Это то же самое» with this id.
  v_twin := public.review_open_twin(p_finding_id);
  if v_twin is not null then
    raise exception 'An open problem from a review is about the same: %', v_twin
      using errcode = 'check_violation', hint = 'serverErrors.reviewDuplicateOpen',
            detail = jsonb_build_object('problem_id', v_twin)::text;
  end if;

  -- The manager's own title is in the company's language and has no
  -- translations; the model's comes with all three.
  perform public.create_review_problem(
    p_finding_id,
    coalesce(nullif(btrim(p_title), ''), v_finding.summary),
    case when nullif(btrim(p_title), '') is null then v_finding.summary_i18n end,
    coalesce(p_priority, v_finding.urgency),
    'manager');

  select * into v_finding from public.review_findings where id = p_finding_id;
  return v_finding;
end;
$$;

/**
 * «Создать задание из отзыва» by hand, on the «Отзывы» screen: works without
 * the rules and without the model. The manager names the kind, the subject
 * and the title; the finding is stored as the manual reader's and approved at
 * once, through the same path as any other.
 */
create or replace function public.add_review_finding(
  p_review_id uuid,
  p_kind      public.review_finding_kind,
  p_subject   text,
  p_title     text,
  p_priority  public.problem_priority default 'normal'
)
returns public.review_findings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_review public.guest_reviews;
  v_id     uuid;
begin
  if not public.is_manager() then
    raise exception 'Only a manager decides about findings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;
  select * into v_review from public.guest_reviews
  where id = p_review_id and host_id = public.current_host_id();
  if not found then
    raise exception 'Review % not found', p_review_id
      using errcode = 'no_data_found', hint = 'serverErrors.reviewNotFound';
  end if;
  if not public.review_kind_gives_task(p_kind) then
    raise exception 'Kind % never makes a problem', p_kind
      using errcode = 'check_violation', hint = 'serverErrors.reviewKindNoTask',
            detail = jsonb_build_object('kind', p_kind)::text;
  end if;
  if not (p_subject = any (public.review_subjects())) then
    raise exception 'Unknown subject %', p_subject
      using errcode = 'check_violation', hint = 'serverErrors.reviewSubjectUnknown',
            detail = jsonb_build_object('subject', p_subject)::text;
  end if;
  perform public.validate_problem_text(p_title, null);

  insert into public.review_findings (host_id, review_id, property_id, kind, subject, urgency,
                                      summary, summary_i18n, confidence, detector)
  values (v_review.host_id, v_review.id, coalesce(v_review.room_id, v_review.property_id),
          p_kind, p_subject, coalesce(p_priority, 'normal'), btrim(p_title), '{}'::jsonb, 1, 'manual')
  on conflict (review_id, kind, subject) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.review_findings
    where review_id = p_review_id and kind = p_kind and subject = p_subject;
  end if;
  return public.approve_review_finding(v_id, p_title, p_priority);
end;
$$;

/**
 * The manager says no. A candidate becomes rejected with a reason. A problem
 * this finding made is called off too — but only while nobody has been sent:
 * once the head technician has handed it out, the manager closes it by hand.
 */
create or replace function public.reject_review_finding(
  p_finding_id uuid,
  p_reason     public.review_reject_reason
)
returns public.review_findings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finding public.review_findings;
  v_problem public.problems;
begin
  if not public.is_manager() then
    raise exception 'Only a manager decides about findings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;
  if p_reason is null then
    raise exception 'A rejection needs a reason'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.reviewRejectReasonMissing';
  end if;

  select * into v_finding from public.review_findings
  where id = p_finding_id and host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Finding % not found', p_finding_id
      using errcode = 'no_data_found', hint = 'serverErrors.reviewFindingNotFound';
  end if;
  if v_finding.status = 'rejected' then
    return v_finding;
  end if;

  if v_finding.status = 'task_created' then
    -- The lock the dispatch levers take (20261003130000).
    select * into v_problem from public.problems where id = v_finding.problem_id
    for no key update;
    -- Somebody was sent: the manager closes it by hand, knowing who.
    if v_problem.status <> 'open'
       or exists (select 1 from public.tasks t
                  where t.problem_id = v_problem.id
                    and t.status not in ('done', 'cancelled', 'expired')
                    and t.assignee_id is not null) then
      raise exception 'Work on problem % has started', v_problem.id
        using errcode = 'check_violation', hint = 'serverErrors.reviewFindingWorkStarted';
    end if;
    -- As cancel_problem does: a repair left waiting for somebody goes too.
    update public.tasks t
    set status = 'cancelled'
    where t.problem_id = v_problem.id and t.status not in ('done', 'cancelled', 'expired');
    update public.problems
    set status = 'cancelled', cancelled_at = now(), archived_at = now()
    where id = v_problem.id;
  elsif v_finding.status not in ('candidate', 'duplicate', 'already_fixed') then
    raise exception 'Finding % is already decided', p_finding_id
      using errcode = 'check_violation', hint = 'serverErrors.reviewFindingDecided',
            detail = jsonb_build_object('status', v_finding.status)::text;
  end if;

  update public.review_findings
  set status = 'rejected', reject_reason = p_reason, decided_mode = 'manager',
      decided_by = (select auth.uid()), decided_at = now()
  where id = p_finding_id
  returning * into v_finding;
  return v_finding;
end;
$$;

/**
 * The company's switches. Null means "not part of this call", as in
 * update_host_settings. The gates (texts, model, tasks, the notice) are the
 * admin's: they follow the owner's actions, not a manager's preference. A kind
 * goes to auto only with its record (≥ 50 decisions, ≥ 90 % in 60 days);
 * taking it back is always allowed.
 */
create or replace function public.update_review_settings(
  p_sync_enabled        boolean default null,
  p_texts_enabled       boolean default null,
  p_tasks_enabled       boolean default null,
  p_model_enabled       boolean default null,
  p_auto_kinds          text[] default null,
  p_daily_model_cap     integer default null,
  p_min_confidence      numeric default null,
  p_notice_published_at timestamptz default null
)
returns public.review_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host    uuid := public.current_host_id();
  v_row     public.review_settings;
  v_kind    text;
  v_record  record;
  v_is_admin boolean := public.auth_role() = 'admin' and public.is_active_user();
begin
  if not public.is_manager() then
    raise exception 'Only a manager changes review settings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;
  -- The gates and the money are the admin's: the ceiling on model calls and
  -- the confidence floor decide what is paid for and what reaches people.
  if not v_is_admin and (p_texts_enabled is not null or p_model_enabled is not null
                         or p_tasks_enabled is not null or p_notice_published_at is not null
                         or p_daily_model_cap is not null or p_min_confidence is not null) then
    raise exception 'Only an admin switches the review gates'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.reviewGateAdminOnly';
  end if;

  insert into public.review_settings (host_id) values (v_host) on conflict do nothing;
  select * into v_row from public.review_settings where host_id = v_host for update;

  -- The notice's date is set once, never ahead of now: moving it earlier would
  -- widen the stays whose texts are kept.
  if p_notice_published_at is not null then
    if p_notice_published_at > now()
       or (v_row.notice_published_at is not null
           and p_notice_published_at <> v_row.notice_published_at) then
      raise exception 'The notice date is set once and not in the future'
        using errcode = 'check_violation', hint = 'serverErrors.reviewNoticeDateFixed';
    end if;
  end if;
  if coalesce(p_texts_enabled, v_row.texts_enabled)
     and coalesce(p_notice_published_at, v_row.notice_published_at) is null then
    raise exception 'Texts need the published guest notice'
      using errcode = 'check_violation', hint = 'serverErrors.reviewTextsNeedNotice';
  end if;
  if coalesce(p_model_enabled, v_row.model_enabled)
     and not coalesce(p_texts_enabled, v_row.texts_enabled) then
    raise exception 'The model needs the texts switched on'
      using errcode = 'check_violation', hint = 'serverErrors.reviewModelNeedsTexts';
  end if;

  if p_auto_kinds is not null then
    foreach v_kind in array p_auto_kinds loop
      if not (v_kind = any (array['repair', 'safety', 'pests', 'access'])) then
        raise exception 'Kind % never makes a problem', v_kind
          using errcode = 'check_violation', hint = 'serverErrors.reviewKindNoTask',
                detail = jsonb_build_object('kind', v_kind)::text;
      end if;
      if not (v_kind = any (v_row.auto_kinds)) then
        select * into v_record from public.review_kind_record(v_host, v_kind::public.review_finding_kind);
        if v_record.decisions < 50 or v_record.approved * 10 < v_record.decisions * 9 then
          raise exception 'Kind % has not earned auto yet', v_kind
            using errcode = 'check_violation', hint = 'serverErrors.reviewAutoNotEarned',
                  detail = jsonb_build_object('kind', v_kind, 'decisions', v_record.decisions,
                                              'approved', v_record.approved)::text;
        end if;
      end if;
    end loop;
  end if;

  update public.review_settings
  set sync_enabled        = coalesce(p_sync_enabled, sync_enabled),
      texts_enabled       = coalesce(p_texts_enabled, texts_enabled),
      tasks_enabled       = coalesce(p_tasks_enabled, tasks_enabled),
      model_enabled       = coalesce(p_model_enabled, model_enabled),
      auto_kinds          = coalesce(p_auto_kinds, auto_kinds),
      daily_model_cap     = coalesce(p_daily_model_cap, daily_model_cap),
      min_confidence      = coalesce(p_min_confidence, min_confidence),
      notice_published_at = coalesce(p_notice_published_at, notice_published_at),
      updated_by          = (select auth.uid())
  where host_id = v_host
  returning * into v_row;
  return v_row;
end;
$$;

-- ===================================================================
-- row security and grants (all steps)
-- ===================================================================

alter table public.guest_reviews enable row level security;
alter table public.review_findings enable row level security;
alter table public.review_settings enable row level security;

revoke all on public.guest_reviews, public.review_findings, public.review_settings
  from public, anon, authenticated, service_role;
grant select on public.guest_reviews, public.review_findings, public.review_settings
  to authenticated, service_role;

-- Manager and admin of the company only. The head technician and the
-- technicians see a problem's title and review_facts, never the review
-- (the owner's decision 3).
create policy "managers read reviews"
  on public.guest_reviews for select to authenticated
  using ((select public.is_manager()) and host_id = (select public.current_host_id()));

create policy "managers read review findings"
  on public.review_findings for select to authenticated
  using ((select public.is_manager()) and host_id = (select public.current_host_id()));

create policy "managers read review settings"
  on public.review_settings for select to authenticated
  using ((select public.is_manager()) and host_id = (select public.current_host_id()));

-- The job's functions: the service role only (they write raw.review_runs or
-- decide for the company).
revoke all on function public.review_sync_watermark(public.review_source, uuid) from public, anon, authenticated;
revoke all on function public.ingest_guest_reviews(public.review_source, jsonb, timestamptz, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.apply_review_findings(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.purge_review_texts() from public, anon, authenticated;
revoke all on function public.reserve_review_model_calls(public.review_source, integer, uuid) from public, anon, authenticated;
revoke all on function public.mark_review_analysis_failed(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_review_model_calls(public.review_source, integer, uuid) to service_role;
grant execute on function public.mark_review_analysis_failed(uuid, text) to service_role;
revoke all on function public.log_review_run(public.review_source, text, boolean, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.review_model_calls_left(public.review_source, uuid) from public, anon, authenticated;
grant execute on function public.log_review_run(public.review_source, text, boolean, jsonb, jsonb, uuid) to service_role;
grant execute on function public.review_model_calls_left(public.review_source, uuid) to service_role;
grant execute on function public.review_sync_watermark(public.review_source, uuid) to service_role;
grant execute on function public.ingest_guest_reviews(public.review_source, jsonb, timestamptz, uuid, jsonb) to service_role;
grant execute on function public.apply_review_findings(uuid, text, text, jsonb) to service_role;
grant execute on function public.purge_review_texts() to service_role;

-- Internal: called only from the functions above, which run as their owner.
revoke all on function public.store_review_texts(uuid, public.review_source, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.create_review_problem(uuid, text, jsonb, public.problem_priority, text) from public, anon, authenticated, service_role;
revoke all on function public.decide_review_finding(uuid) from public, anon, authenticated, service_role;
revoke all on function public.review_kind_record(uuid, public.review_finding_kind) from public, anon, authenticated, service_role;
revoke all on function public.review_place_family(bigint) from public, anon, authenticated, service_role;
revoke all on function public.review_open_twin(uuid) from public, anon, authenticated, service_role;
-- A constant list; the panel shows its words (reviews.subject.*).
revoke all on function public.review_subjects() from public, anon;
grant execute on function public.review_subjects() to authenticated, service_role;
revoke all on function public.review_kind_gives_task(public.review_finding_kind) from public, anon;

-- The manager's buttons.
revoke all on function public.approve_review_finding(uuid, text, public.problem_priority, uuid) from public, anon;
revoke all on function public.add_review_finding(uuid, public.review_finding_kind, text, text, public.problem_priority) from public, anon;
grant execute on function public.add_review_finding(uuid, public.review_finding_kind, text, text, public.problem_priority) to authenticated;
revoke all on function public.reject_review_finding(uuid, public.review_reject_reason) from public, anon;
revoke all on function public.update_review_settings(boolean, boolean, boolean, boolean, text[], integer, numeric, timestamptz) from public, anon;
grant execute on function public.approve_review_finding(uuid, text, public.problem_priority, uuid) to authenticated;
grant execute on function public.reject_review_finding(uuid, public.review_reject_reason) to authenticated;
grant execute on function public.update_review_settings(boolean, boolean, boolean, boolean, text[], integer, numeric, timestamptz) to authenticated;
grant execute on function public.review_kind_gives_task(public.review_finding_kind) to authenticated, service_role;

-- ===================================================================
-- schedule (UTC). Away from the night window 03:00–04:40 (listings 03:00,
-- reservations 03:15, the sweeps until 03:50, media 04:30) and after the quiet
-- hours in Prague in both seasons: 06:00 UTC is 07:00 CET / 08:00 CEST, so a
-- problem made by the job never pushes into the night.
-- ===================================================================

select cron.schedule(
  'sync-reviews-daily',
  '0 6 * * *',
  $$select public.invoke_edge_function('sync-reviews')$$
);

select cron.schedule(
  'classify-reviews-daily',
  '20 6 * * *',
  $$select public.invoke_edge_function('classify-reviews')$$
);

select cron.schedule(
  'purge-review-texts',
  '5 5 * * *',
  $$select public.purge_review_texts()$$
);

select cron.schedule(
  'purge-review-runs',
  '10 5 * * *',
  $$delete from raw.review_runs where ran_at < now() - interval '180 days'$$
);
