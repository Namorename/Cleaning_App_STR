-- Guest signals: what a guest tells about a flat through the PMS, turned into
-- work for the technicians (docs/guest-signals.md). The core knows no PMS;
-- its first kind is the guest review (docs/reviews-to-tasks.md), the second —
-- the guest's message in the conversation — comes with stage 3 of the guest
-- signals plan and adds to these tables, not beside them.
--
-- One migration for the core and the reviews, and nothing in it acts until
-- somebody switches it on: every signal_settings switch is off by default,
-- and the two jobs that call the Edge Functions are scheduled inactive. The
-- steps of the reviews design (§7) are the order the switches go on, not
-- separate migrations. 20261030103000 is the knowledge base's last (rollout
-- step 4e); this stamp keeps the migration after it.
--
-- What the core does not know (the owner's decision 1 of 2026-10-31, the
-- changes P1–P12 of docs/guest-signals.md §2.4): a PMS is a value of
-- signal_provider, and everything that knows how that PMS numbers its
-- listings, rooms and bookings sits in one branch of signal_place_id and
-- resolve_signal_reservation. An adapter hands over the PMS's own ids as
-- text; the database finds our place and our booking itself. No column, key
-- or function of the core is named after a PMS.
--
-- The exact days of a stay and the link to its booking live only while the
-- signal is unsettled — not yet read, or with a finding waiting for a
-- manager — and never past 89 days from it (the owner's decision of
-- 2026-10-17, late; signal_stay_link_ends, cut_signal_stay_links). The
-- rating, the listing, the month and the anonymised text stay; the text of a
-- review for 18 months. No guest name is ever stored.
--
-- The PMS's own id of a signal leads to its booking through the PMS, so it
-- goes with the booking (the owner's decision of 2026-10-18). A signal is
-- known by its key instead: an HMAC of '<provider>:<kind>:<the PMS's id>'
-- under the secret GUEST_SIGNAL_KEY_SECRET of the sync-guest-signals
-- function, which never enters the database (P1). A repeated load meets the
-- signal by the key, a hiding is still seen, and the key alone leads to no
-- booking.
--
-- What it adds (sections below follow the steps):
--   step 0  public.guest_signals (ratings, no text), public.signal_settings
--           (one row a company and a kind of signal), raw.signal_runs, the
--           place and the booking found from the PMS's ids,
--           ingest_guest_reviews(), signal_sync_watermark()
--   step 1  problems.source / title_i18n / source_facts, reported_by nullable
--           for a problem from a guest signal, push_on_problem_reported()
--           that still reaches the head technicians when nobody reported it
--   step 2  the texts of reviews on guest_signals (names replaced before they
--           arrive), kept 18 months — only once the guest notice is
--           published, never for a review hidden on the channel or a place in
--           the archive, erased at once when texts are switched off;
--           review_load_state(), so the load asks the PMS only for what is
--           still missing. A message never keeps a text (check).
--   step 3  public.signal_findings, apply_signal_findings() (the model's
--           reading and the rules' in one queue), the decision (candidate /
--           task / duplicate / already fixed), the manager's approve (to a
--           technician or to the open column) and reject, «false positive»
--           on the problem's card, public.signal_feedback (every verdict, no
--           text), the card's list of problems on the place, the settings
--           RPC; the cut of a settled signal's stay to its month
--           (cut_signal_stay_links)
--   all     row security (manager and admin of the company only), grants,
--           pg_cron jobs (the two Edge Function jobs inactive)
--
-- The owner's decisions: reviews of 2026-10-16/17/18 in
-- docs/reviews-to-tasks.md §9, guest signals of 2026-10-31 in
-- docs/guest-signals.md §10.
--
-- Nothing here calls a PMS or a model: that is the Edge Functions'
-- (sync-guest-signals, classify-guest-signals). Nothing here writes
-- user-facing text: the errors carry an English message, a serverErrors.*
-- key and JSON params.

set local lock_timeout = '3s';

-- ===================================================================
-- step 0 — ratings without texts
-- ===================================================================

-- The PMS a signal came through. The next one is a value added by the
-- migration of its adapter, together with its branch in signal_place_id and
-- resolve_signal_reservation (docs/guest-signals.md §2.2). The fake PMS of
-- the adapter contract lives in the tests only and has no value here.
create type public.signal_provider as enum ('hostaway');

-- What the guest sent: a review after the stay, or a message in the
-- conversation. Only reviews are loaded by this migration; messages come
-- with their own loading (docs/guest-signals.md §8.1, stage 3).
create type public.guest_signal_kind as enum ('review', 'message');

create type public.signal_channel as enum ('airbnb', 'booking', 'vrbo', 'direct', 'google', 'other');

-- One thing one guest sent about one stay, whatever PMS it came through. No
-- guest name anywhere: the adapter uses it only to strip it out of the text,
-- in memory.
create table public.guest_signals (
  id                      uuid primary key default gen_random_uuid(),
  host_id                 uuid not null references public.hosts (id) on delete restrict,
  provider                public.signal_provider not null,
  kind                    public.guest_signal_kind not null,
  -- The key a repeated load meets the signal by, so it is stored once however
  -- often it is read (the owner's decision of 2026-10-18): HMAC-SHA256 of
  -- '<provider>:<kind>:<the PMS's id>' under the secret
  -- GUEST_SIGNAL_KEY_SECRET of sync-guest-signals. The secret never enters
  -- the database, so the key alone leads to no review in the PMS and no
  -- booking. When its time is over it becomes 'purged:<our id>'
  -- (purge_signal_data).
  external_key            text not null
                          check (external_key ~ '^([0-9a-f]{64}|purged:[0-9a-f-]{36})$'),
  -- The conversation a message belongs to, keyed the same way:
  -- HMAC-SHA256 of '<provider>:conversation:<the PMS's id of it>'. What joins
  -- the messages of one stay; null for a review.
  conversation_key        text check (conversation_key ~ '^[0-9a-f]{64}$'),
  -- The signal's own id in the PMS. It finds the booking through the PMS, so
  -- it lives as the booking does: only while the stay is exact (the cut
  -- clears both).
  external_id             text,
  -- The listing, and the room inside it when the PMS names one, as the PMS
  -- numbers them; resolve_signal_place finds ours from them.
  external_listing_id     text not null,
  external_unit_id        text,
  property_id             bigint references public.properties (id) on delete set null,
  -- The room the stay took on a listing with rooms, when the booking says so.
  room_id                 bigint references public.properties (id) on delete set null,
  -- The booking, while the stay is exact (below): ours only while the row
  -- exists — the reservations table keeps the sync window, not the history.
  external_reservation_id text,
  reservation_id          bigint references public.reservations (id) on delete set null,
  channel                 public.signal_channel not null,
  -- A review's own: 0–10 for every channel (Airbnb stars × 2).
  rating                  numeric(4, 2) check (rating between 0 and 10),
  -- A review's own: {"cleanliness": 10, "checkin": 8, …} in one vocabulary
  -- for every channel.
  category_ratings        jsonb not null default '{}'::jsonb
                          check (jsonb_typeof(category_ratings) = 'object'),
  -- The exact days while stay_exact; the first of their month after.
  arrival_date            date,
  departure_date          date,
  -- When the guest sent it.
  submitted_at            timestamptz not null,
  -- True while the signal is unsettled — its text not yet read, or a finding
  -- waiting for a manager — and at most until signal_stay_link_ends(): the
  -- days above are exact and the booking is linked. Then the cut
  -- (cut_signal_stay_links) leaves the month and the place, for good: a later
  -- load never brings the days or the booking back.
  stay_exact              boolean not null default true,
  is_hidden               boolean not null default false,
  has_public_text         boolean not null default false,
  has_private_text        boolean not null default false,
  has_host_reply          boolean not null default false,
  external_updated_at     timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint guest_signals_one_per_key unique (host_id, provider, kind, external_key),
  constraint guest_signals_room_needs_listing check (room_id is null or property_id is not null),
  constraint guest_signals_booking_only_while_exact
    check (stay_exact or (reservation_id is null and external_reservation_id is null
                          and external_id is null)),
  -- A review has no conversation, and a message no rating or reply.
  constraint guest_signals_conversation_is_a_message
    check (kind = 'message' or conversation_key is null),
  constraint guest_signals_ratings_are_a_review
    check (kind = 'review' or (rating is null and category_ratings = '{}'::jsonb
                               and not has_host_reply))
);

comment on table public.guest_signals is
  'What guests sent through the PMS — reviews now, messages from stage 3: ratings always, review '
  'texts only from step 2 (names replaced before storing), message texts never. docs/guest-signals.md';

create index guest_signals_place_idx on public.guest_signals (host_id, property_id, submitted_at desc);
-- The messages of one conversation (stage 3: the window a reader is given).
create index guest_signals_conversation_idx on public.guest_signals (host_id, conversation_key)
  where conversation_key is not null;
create index guest_signals_reservation_idx on public.guest_signals (reservation_id)
  where reservation_id is not null;
-- The foreign keys a delete of a place walks (on delete set null).
create index guest_signals_property_idx on public.guest_signals (property_id)
  where property_id is not null;
create index guest_signals_room_idx on public.guest_signals (room_id)
  where room_id is not null;
-- The reviews whose stay is still exact: what the nightly sweep looks at.
create index guest_signals_exact_idx on public.guest_signals (host_id, submitted_at)
  where stay_exact;

/**
 * The first moment of the month `p_at` falls in, Prague time: what a cut
 * review keeps of any time on it.
 *
 * Internal: no grants.
 */
create or replace function public.signal_month_of(p_at timestamptz)
returns timestamptz
language sql
stable
parallel safe
set search_path = ''
as $$
  select date_trunc('month', p_at at time zone 'Europe/Prague') at time zone 'Europe/Prague'
$$;

/**
 * updated_at for a review: the moment of the change while the stay is exact,
 * its month once the stay is cut — the cut's own write, a load a day later,
 * a late text: none of them may stamp the day back on a row that keeps only
 * its month.
 */
create or replace function public.guest_signals_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := case when new.stay_exact then now() else public.signal_month_of(now()) end;
  return new;
end;
$$;

create trigger guest_signals_touch
  before update on public.guest_signals
  for each row execute function public.guest_signals_touch();

-- What a company has switched on, for each kind of signal apart (P4): the
-- messages have their own guest notice, their own ceilings and their own
-- record for auto. Every switch is off until somebody turns it on: the order
-- of steps is the order these go true.
create table public.signal_settings (
  host_id              uuid not null references public.hosts (id) on delete cascade,
  kind                 public.guest_signal_kind not null,
  -- step 0: the daily load of ratings.
  sync_enabled         boolean not null default false,
  -- step 2: texts are read and, for a review, stored. Only after the guest
  -- notice is published.
  texts_enabled        boolean not null default false,
  -- step 1 gate: problems from this kind may be created. Only once the phone
  -- and the panel in the field read a problem without a reporter (OTA
  -- adopted).
  tasks_enabled        boolean not null default false,
  -- step 4: the model reads the texts. Terms accepted, key in the secrets.
  model_enabled        boolean not null default false,
  -- The oldest signal the model reads: 14 days before it was switched on
  -- (the owner's decision of 2026-10-18), set by update_signal_settings each
  -- time it goes on. Older texts keep the rules' reading.
  model_since          timestamptz,
  -- Variant C: kinds of finding that become problems without a manager. Only
  -- an admin puts a kind here (the owner's decision of 2026-10-17).
  auto_kinds           text[] not null default '{}',
  -- A ceiling on model calls a day, whatever a bug in a loop would like.
  daily_model_cap      integer not null default 50 check (daily_model_cap between 0 and 500),
  -- A ceiling on the problems auto makes in a Prague day (the owner's
  -- decision of 2026-10-18: five), so a model gone wrong fills the manager's
  -- queue, not the technicians' day (P9).
  daily_auto_cap       integer not null default 5 check (daily_auto_cap between 0 and 50),
  -- Below this a finding is kept as dropped, never shown as a candidate.
  min_confidence       numeric(3, 2) not null default 0.60 check (min_confidence between 0 and 1),
  -- The date the guest notice went live; texts and the model need it.
  notice_published_at  timestamptz,
  updated_by           uuid references public.profiles (id) on delete set null,
  updated_at           timestamptz not null default now(),
  primary key (host_id, kind),
  constraint signal_settings_auto_are_task_kinds
    check (auto_kinds <@ array['repair', 'safety', 'pests', 'access']::text[]),
  constraint signal_settings_texts_need_notice
    check (not texts_enabled or notice_published_at is not null),
  constraint signal_settings_model_needs_texts
    check (not model_enabled or texts_enabled),
  constraint signal_settings_model_has_since
    check (not model_enabled or model_since is not null)
);

comment on table public.signal_settings is
  'Per company and kind of guest signal: which steps of tasks-from-guest-signals are on. All off by default.';

create trigger signal_settings_touch
  before update on public.signal_settings
  for each row execute function public.touch_updated_at();

-- Each run of the two Edge Functions, as raw.generator_runs is for the
-- generator: what was read, what changed, how far the load got. The
-- watermark is a provider's and a kind's (P5): reviews and messages of one
-- PMS are read on their own clocks.
create table raw.signal_runs (
  id           bigint generated always as identity primary key,
  host_id      uuid not null,
  provider     public.signal_provider not null,
  kind         public.guest_signal_kind not null,
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

create index signal_runs_ran_at_idx on raw.signal_runs (ran_at);
revoke all on raw.signal_runs from public, anon, authenticated;

/**
 * The day a signal's key goes, and with it what was drawn from its text
 * (P7, by kind):
 * - a review: its text and its key go 18 months from the first of the month
 *   it was sent in, Prague time (the owner's decisions of 2026-10-16 and
 *   2026-10-17). A whole month goes in one night, so nothing left on the row
 *   — not even updated_at, which the purge itself sets — tells the day it
 *   was sent. Kept 17 to 18 months, never longer than the guest notice says.
 * - a message keeps no text; its key goes 90 days after it was sent (the
 *   owner's decision 10 of 2026-10-31).
 *
 * Internal: no grants.
 */
create or replace function public.signal_retention_ends(
  p_kind         public.guest_signal_kind,
  p_submitted_at timestamptz
)
returns date
language sql
stable
parallel safe
set search_path = ''
as $$
  select case p_kind
           when 'review'
             then (date_trunc('month', p_submitted_at at time zone 'Europe/Prague')
                   + interval '18 months')::date
           else (p_submitted_at at time zone 'Europe/Prague')::date + 90
         end
$$;

/**
 * The day at the latest a signal's exact stay and its booking go, whether or
 * not a manager has decided (the owner's decision of 2026-10-17, late: "not
 * longer than 90 days from the review"): the first of the month the 89th day
 * from the signal falls in, Prague time. A month's signals are cut in one
 * night, so the cut itself (updated_at) tells only the month; the nightly
 * sweep runs at 05:00 UTC on that day, before the 90th day has passed for
 * any of them. A signal settled earlier is cut earlier
 * (cut_signal_stay_links). One rule for both kinds today — a message's
 * whole row goes at 90 days anyway (signal_retention_ends) — and the kind is
 * an argument so that a kind's own rule is a change of this body, not of
 * every caller.
 *
 * Internal: no grants.
 */
create or replace function public.signal_stay_link_ends(
  p_kind         public.guest_signal_kind,
  p_submitted_at timestamptz
)
returns date
language sql
stable
parallel safe
set search_path = ''
as $$
  select case when p_kind is not null
              then date_trunc('month', ((p_submitted_at at time zone 'Europe/Prague')::date + 89)::timestamp)::date
         end
$$;

/**
 * The day a decision about a signal looks back to (P8): the problems
 * reported or solved since then are the ones it may be about. For a review
 * the day the guest left; for a message sent during the stay the day it was
 * sent — "after the guest left" means nothing while the guest is there. The
 * earlier of the two, so a review written before a late departure date, or
 * a message after the stay, reads as it should.
 *
 * Internal: no grants.
 */
create or replace function public.signal_since(p_signal public.guest_signals)
returns date
language sql
stable
parallel safe
set search_path = ''
as $$
  select least(p_signal.departure_date, (p_signal.submitted_at at time zone 'Europe/Prague')::date)
$$;

/**
 * The id our tables give a PMS's place — a listing, or the room inside it
 * the PMS names — whether or not the row is there yet. The one place the
 * database knows how a PMS numbers its places (P6), one branch a provider:
 * for Hostaway our listing is its listing's id, and a room is 10¹² + its
 * listingUnitId (property_id_for_unit). A second PMS adds its branch here —
 * through a table of its ids against ours (docs/guest-signals.md §2.2) — in
 * the migration of its adapter. Null for an id that is not one.
 *
 * Internal: no grants.
 */
create or replace function public.signal_place_id(
  p_provider            public.signal_provider,
  p_external_listing_id text,
  p_external_unit_id    text default null
)
returns bigint
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_provider
           when 'hostaway' then
             case when p_external_unit_id is not null
                  then case when p_external_unit_id ~ '^[1-9][0-9]{0,11}$'
                            then public.property_id_for_unit(p_external_unit_id::bigint) end
                  when p_external_listing_id ~ '^[1-9][0-9]{0,17}$'
                  then p_external_listing_id::bigint
             end
         end
$$;

/**
 * Our place of a signal, if this company holds it: the room the PMS names
 * when it hangs under the listing, else the listing. Null otherwise — a
 * listing we never loaded, another company's, a room under another listing.
 *
 * Internal: no grants.
 */
create or replace function public.resolve_signal_place(
  p_provider            public.signal_provider,
  p_host_id             uuid,
  p_external_listing_id text,
  p_external_unit_id    text default null
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.properties p
  where p.host_id = p_host_id
    and p.id = public.signal_place_id(p_provider, p_external_listing_id, p_external_unit_id)
    and (p_external_unit_id is null
         or p.parent_id = public.signal_place_id(p_provider, p_external_listing_id))
$$;

/**
 * Our booking of a signal, while this company holds its row (the
 * reservations table keeps the sync window, not the history). The second
 * branch a PMS adds (P6): for Hostaway our booking's id is its own.
 *
 * Internal: no grants.
 */
create or replace function public.resolve_signal_reservation(
  p_provider                public.signal_provider,
  p_host_id                 uuid,
  p_external_reservation_id text
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select x.id
  from public.reservations x
  where x.host_id = p_host_id
    and x.id = case p_provider
                 when 'hostaway' then
                   case when p_external_reservation_id ~ '^[1-9][0-9]{0,17}$'
                        then p_external_reservation_id::bigint end
               end
$$;

/**
 * The PMS's ids of this company's listings that have rooms under them: a
 * load asks a booking for its room only on those (sync-guest-signals). The
 * inverse of signal_place_id's listing branch.
 */
create or replace function public.signal_buildings(
  p_provider public.signal_provider,
  p_host_id  uuid default null
)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct b.external_id order by b.external_id), '{}')
  from (select case p_provider when 'hostaway' then p.parent_id::text end as external_id
        from public.properties p
        where p.host_id = coalesce(p_host_id, public.default_host_id())
          and p.parent_id is not null) b
  where b.external_id is not null
$$;

/**
 * Where the next load of a provider's signals of one kind starts: the newest
 * watermark a run wrote. Null before the first one — the function then loads
 * the history (12 months of reviews, the owner's decision of 2026-10-16) in
 * portions.
 *
 * The run decides, not its error codes: one that wants its window read again
 * — a review held back until its guest's names can be read, a booking it
 * could not ask — writes no watermark. A run with only lasting faults (a row
 * the PMS sends broken every day) still moves on; is_ok says so to the
 * screen's "updated at" line.
 */
create or replace function public.signal_sync_watermark(
  p_provider public.signal_provider,
  p_kind     public.guest_signal_kind,
  p_host_id  uuid default null
)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(r.watermark)
  from raw.signal_runs r
  where r.host_id = coalesce(p_host_id, public.default_host_id())
    and r.provider = p_provider
    and r.kind = p_kind
    and r.stage = 'sync'
$$;

/**
 * A run of classify-guest-signals, journaled from the Edge Function: raw is
 * not exposed through PostgREST, so the function writes through here. Model
 * calls are booked beforehand by reserve_signal_model_calls(); this row
 * carries the rest (read, findings, problems, failures) and never
 * "model_calls", which would count them twice.
 */
create or replace function public.log_signal_run(
  p_provider public.signal_provider,
  p_kind     public.guest_signal_kind,
  p_stage    text,
  p_is_ok    boolean,
  p_counts   jsonb default '{}'::jsonb,
  p_errors   jsonb default '[]'::jsonb,
  p_host_id  uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into raw.signal_runs (host_id, provider, kind, stage, is_ok, counts, errors)
  values (coalesce(p_host_id, public.default_host_id()), p_provider, p_kind, p_stage, p_is_ok,
          coalesce(p_counts, '{}'::jsonb) - 'model_calls', coalesce(p_errors, '[]'::jsonb))
$$;

/**
 * Model calls left today (Prague day) under the company's ceiling for one
 * kind of signal (P5): reviews and messages have ceilings of their own, and
 * one PMS or two share it. The Edge Function asks before each call; the
 * console's spending limit is the second fence (docs §3.3).
 */
create or replace function public.signal_model_calls_left(
  p_kind    public.guest_signal_kind,
  p_host_id uuid default null
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(
    coalesce((select s.daily_model_cap from public.signal_settings s
              where s.host_id = coalesce(p_host_id, public.default_host_id())
                and s.kind = p_kind
                and s.model_enabled), 0)
    - coalesce((select sum((r.counts ->> 'model_calls')::integer)
                from raw.signal_runs r
                where r.host_id = coalesce(p_host_id, public.default_host_id())
                  and r.kind = p_kind
                  and r.stage = 'classify'
                  and r.ran_at >= (date_trunc('day', now() at time zone 'Europe/Prague')
                                   at time zone 'Europe/Prague')), 0),
    0)::integer
$$;

/**
 * Take model calls out of today's ceiling before making them. Read-then-act
 * would let two runs (the cron and a manual one) both see the full ceiling,
 * and a run killed by the platform before it logs would leave no trace; so the
 * calls are booked first, under one lock a company and a kind, in a classify
 * row of their own. Returns how many were granted (0..p_wanted).
 */
create or replace function public.reserve_signal_model_calls(
  p_provider public.signal_provider,
  p_kind     public.guest_signal_kind,
  p_wanted   integer,
  p_host_id  uuid default null
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
  perform pg_advisory_xact_lock(hashtextextended('signal-model-calls:' || v_host || ':' || p_kind, 0));
  v_granted := least(greatest(coalesce(p_wanted, 0), 0),
                     public.signal_model_calls_left(p_kind, v_host));
  if v_granted > 0 then
    insert into raw.signal_runs (host_id, provider, kind, stage, is_ok, counts)
    values (v_host, p_provider, p_kind, 'classify', true,
            jsonb_build_object('model_calls', v_granted, 'reserved', true));
  end if;
  return v_granted;
end;
$$;

/**
 * One portion of normalized reviews from an adapter, upserted by their key
 * (external_key, the HMAC sync-guest-signals makes of '<provider>:review:<the
 * PMS's id>'). A repeated
 * load meets the same rows and changes only what changed — after the cut
 * too, when the PMS's id itself is gone. A row without a well-formed key
 * stops the whole portion: stored, it could never be met again.
 *
 * `p_rows` is a JSON array of the neutral review (docs/guest-signals.md
 * §2.2): the PMS's own ids as text — the listing, the room inside it, the
 * booking — and nothing of ours. Our place and our booking are found here
 * (resolve_signal_place, resolve_signal_reservation), within this company:
 * an adapter never needs to know how our tables number anything. Text fields are stored only while `texts_enabled` is on, and arrive
 * with names already replaced by the adapter; otherwise they are dropped here
 * and only the "has text" flags stay. A listing in the test band
 * (analytics_is_test_listing) is skipped, not stored; so is a review whose
 * retention is over (signal_retention_ends) — its key is already gone
 * (purge_signal_data), and loading it again would store it a second time.
 *
 * A review hidden on the channel keeps its rating, never its text (the
 * owner's decision of 2026-10-17): one hidden since an earlier load loses
 * its text here, at the first load that sees it hidden.
 *
 * The stay: a new row comes with its exact days, its booking and the PMS's
 * id, and keeps them only while it is unsettled (cut_signal_stay_links, at
 * the end of the portion: a review whose text is not kept has nothing to wait
 * for and is cut at once). A row already cut is met again by its key and
 * gets its rating and flags; its days, its booking and the PMS's id never
 * come back.
 *
 * `p_host_id` default null means "the one company there is" (F25 phase B
 * passes it). `p_watermark` null means "do not move the watermark": a portion
 * before the last, or a run that wants its window read again. `p_counts`
 * default null means "the run has no numbers of its own"; given, they join
 * the journal row (booking reads, reviews held for their names, texts sent
 * without), never over the database's own counts.
 */
create or replace function public.ingest_guest_reviews(
  p_provider  public.signal_provider,
  p_rows      jsonb,
  p_watermark timestamptz default null,
  p_host_id   uuid default null,
  p_errors    jsonb default '[]'::jsonb,
  p_counts    jsonb default null
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
  v_cut      integer;
  v_logged   boolean := false;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Reviews must be a JSON array'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.signalRowsInvalid';
  end if;
  -- Checked before anything is written: a bad journal argument must not roll
  -- back a portion already upserted.
  if jsonb_typeof(coalesce(p_errors, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Run errors must be a JSON array'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.signalRowsInvalid';
  end if;
  if p_counts is not null and jsonb_typeof(p_counts) is distinct from 'object' then
    raise exception 'Run counts must be a JSON object'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.signalRowsInvalid';
  end if;
  if exists (select 1 from jsonb_array_elements(p_rows) as e (item)
             where jsonb_typeof(e.item) is distinct from 'object'
                or coalesce(e.item ->> 'external_key', '') !~ '^[0-9a-f]{64}$') then
    raise exception 'Every review row needs its external_key: 64 hexadecimal characters'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.signalRowsInvalid';
  end if;

  -- Locked for share: an admin switching texts off (FOR UPDATE in
  -- update_signal_settings) waits for this portion to end, or this portion
  -- waits for the switch and reads it. Either way the switch's erase sees
  -- every text a portion kept.
  select coalesce(s.texts_enabled, false) into v_texts
  from public.signal_settings s where s.host_id = v_host and s.kind = 'review'
  for share;
  v_texts := coalesce(v_texts, false);

  v_total := jsonb_array_length(p_rows);

  with incoming as (
    -- One row per review even if a page boundary repeated it: ON CONFLICT
    -- DO UPDATE refuses to touch a row twice in one statement.
    select distinct on (r.external_key) r.*
    from jsonb_to_recordset(p_rows) as r (
      external_key text, external_id text, external_listing_id text, external_unit_id text,
      external_reservation_id text, channel public.signal_channel, rating numeric, category_ratings jsonb,
      arrival_date date, departure_date date, submitted_at timestamptz, is_hidden boolean,
      has_public_text boolean, has_private_text boolean, has_host_reply boolean,
      external_updated_at timestamptz, public_text text, private_text text,
      category_comments jsonb, language text
    )
    where r.submitted_at is not null
      and coalesce(btrim(r.external_listing_id), '') <> ''
      and public.signal_retention_ends('review', r.submitted_at) > current_date
      and not public.analytics_is_test_listing(
                coalesce(public.signal_place_id(p_provider, r.external_listing_id), -1))
    order by r.external_key, r.external_updated_at desc nulls last
  ),
  -- Ours only within this company: in F25 phase B ids of two PMS accounts
  -- may meet, and a review must never land on another company's flat.
  resolved as (
    select i.*,
           nullif(btrim(i.external_unit_id), '') as unit,
           public.resolve_signal_place(p_provider, v_host, btrim(i.external_listing_id)) as our_listing,
           case when nullif(btrim(i.external_unit_id), '') is not null
                then public.resolve_signal_place(p_provider, v_host, btrim(i.external_listing_id),
                                                 btrim(i.external_unit_id)) end as our_room,
           public.resolve_signal_reservation(p_provider, v_host,
                                             btrim(i.external_reservation_id)) as our_reservation
    from incoming i
  ),
  written as (
    insert into public.guest_signals as g (
      host_id, provider, kind, external_key, external_id, external_listing_id,
      external_unit_id, property_id, room_id, external_reservation_id, reservation_id,
      channel, rating, category_ratings, arrival_date, departure_date, submitted_at,
      is_hidden, has_public_text, has_private_text, has_host_reply, external_updated_at
    )
    select v_host, p_provider, 'review', r.external_key, nullif(btrim(r.external_id), ''),
           btrim(r.external_listing_id), r.unit, r.our_listing,
           case when r.our_listing is null then null else r.our_room end,
           nullif(btrim(r.external_reservation_id), ''), r.our_reservation,
           coalesce(r.channel, 'other'),
           r.rating, coalesce(r.category_ratings, '{}'::jsonb), r.arrival_date,
           r.departure_date, r.submitted_at, coalesce(r.is_hidden, false),
           coalesce(r.has_public_text, false), coalesce(r.has_private_text, false),
           coalesce(r.has_host_reply, false), r.external_updated_at
    from resolved r
    on conflict (host_id, provider, kind, external_key) do update
      set rating              = excluded.rating,
          category_ratings    = excluded.category_ratings,
          is_hidden           = excluded.is_hidden,
          has_public_text     = excluded.has_public_text,
          has_private_text    = excluded.has_private_text,
          has_host_reply      = excluded.has_host_reply,
          -- The PMS's own clock dates the review too: gone with the cut.
          external_updated_at = case when g.stay_exact then excluded.external_updated_at end,
          -- Learned later, never forgotten: a booking that left the window
          -- keeps the link the row already had — while the stay is exact.
          -- Once cut, the booking stays gone whatever the PMS sends again.
          property_id         = coalesce(excluded.property_id, g.property_id),
          room_id             = coalesce(excluded.room_id, g.room_id),
          external_unit_id    = coalesce(excluded.external_unit_id, g.external_unit_id),
          reservation_id      = case when g.stay_exact
                                     then coalesce(excluded.reservation_id, g.reservation_id) end,
          -- Fixed by the key it hashes to, so never a change to compare below.
          external_id         = case when g.stay_exact then coalesce(excluded.external_id, g.external_id) end
      where (g.rating, g.category_ratings, g.is_hidden, g.has_public_text,
             g.has_private_text, g.has_host_reply, g.property_id, g.room_id, g.reservation_id)
            is distinct from
            (excluded.rating, excluded.category_ratings, excluded.is_hidden,
             excluded.has_public_text, excluded.has_private_text, excluded.has_host_reply,
             coalesce(excluded.property_id, g.property_id), coalesce(excluded.room_id, g.room_id),
             case when g.stay_exact then coalesce(excluded.reservation_id, g.reservation_id) end)
    returning (xmax = 0) as is_new
  )
  select count(*) filter (where is_new), count(*) filter (where not is_new)
    into v_inserted, v_updated
  from written;

  v_skipped := v_total - v_inserted - v_updated;

  -- step 2: hidden since an earlier load — the text goes now. (A review
  -- older than the daily overlap is seen again by the Sunday re-read of 100
  -- days; the nightly purge sweeps whatever a load missed.)
  perform public.erase_signal_texts(array(
    select g.id
    from public.guest_signals g
    where g.host_id = v_host
      and g.provider = p_provider
      and g.kind = 'review'
      and g.is_hidden
      and g.external_key in (select r.external_key
                             from jsonb_to_recordset(p_rows) as r (external_key text))));

  -- step 2: the texts, only while they may be kept (see below).
  if v_texts then
    perform public.store_review_texts(v_host, p_provider, p_rows);
  end if;

  -- The stays of this portion that wait for nothing: without a kept text
  -- there is nothing to read and nothing to decide, so the days and the
  -- booking go now.
  v_cut := public.cut_signal_stay_links(array(
    select g.id
    from public.guest_signals g
    where g.host_id = v_host
      and g.provider = p_provider
      and g.kind = 'review'
      and g.stay_exact
      and g.external_key in (select r.external_key
                             from jsonb_to_recordset(p_rows) as r (external_key text))));

  -- The run's journal: one row per portion, the last one carries the
  -- watermark. The lock is the generator's: never wait on a purge.
  begin
    lock table raw.signal_runs in row exclusive mode nowait;
    -- Never ahead of now: a watermark from the future (a date bug, infinity)
    -- would win max() for good, and every later run would read nothing. And
    -- none at all when none was given — least() would turn a null into now()
    -- and move the watermark for a portion before the last.
    insert into raw.signal_runs (host_id, provider, kind, stage, watermark, is_ok, counts, errors)
    values (v_host, p_provider, 'review', 'sync',
            case when p_watermark is not null then least(p_watermark, now()) end,
            jsonb_array_length(coalesce(p_errors, '[]')) = 0,
            coalesce(p_counts, '{}'::jsonb)
            || jsonb_build_object('received', v_total, 'inserted', v_inserted,
                                  'updated', v_updated, 'unchanged_or_skipped', v_skipped,
                                  'cut', v_cut),
            coalesce(p_errors, '[]'::jsonb));
    v_logged := true;
  exception when lock_not_available then
    null;
  end;

  -- journal_written false: the rows are in, the watermark did not move; the
  -- function says so, and the next run reads the same window again.
  return jsonb_build_object('received', v_total, 'inserted', v_inserted,
                            'updated', v_updated, 'unchanged_or_skipped', v_skipped,
                            'cut', v_cut, 'journal_written', v_logged);
end;
$$;

-- ===================================================================
-- step 1 — a problem can come from a guest signal
-- ===================================================================

-- Who brought the problem: a person (staff), or a guest through the PMS — in
-- a review, or in a message (P2). The value is the kind of signal, so the
-- phone and the panel name the source without a second column.
create type public.problem_source as enum ('staff', 'review', 'message');

alter table public.problems
  add column source       public.problem_source not null default 'staff',
  -- The title in en/cs/ru, as names a manager types are kept (x / x_i18n);
  -- validated by is_localized_text() in the writing function, not a CHECK
  -- (it reads an enum and is stable).
  add column title_i18n   jsonb
                          check (title_i18n is null or jsonb_typeof(title_i18n) = 'object'),
  -- What a technician may know of the guest's signal (P2): kind, subject,
  -- channel, period_month — the month the guest left for a review, the month
  -- the message was sent for a message ("2026-10" — never the day: the
  -- stay's exact days go when the signal is settled, and the problem is made
  -- as it settles) — and mode, who made it: "manager" (a manager confirmed
  -- it) or "auto" (the owner's decision 7 of 2026-10-31: «Создано
  -- автоматически», «Подтвердил менеджер»). Never a quote (the owner's
  -- decision 3 of 2026-10-16).
  add column source_facts jsonb
                          check (source_facts is null or jsonb_typeof(source_facts) = 'object'),
  alter column reported_by drop not null,
  add constraint problems_staff_have_reporter
    check (source <> 'staff' or reported_by is not null),
  add constraint problems_signal_has_facts
    check ((source <> 'staff') = (source_facts is not null));

comment on column public.problems.source is
  'staff: somebody reported it (reported_by set); review, message: found in what a guest sent through '
  'the PMS (source_facts set), reported_by null.';

/**
 * The push about a new problem, now also for one nobody reported.
 *
 * Two changes to 20261003160000:
 * - `h.id <> new.reported_by` was null — and so false for everybody — when
 *   nobody reported it; `is distinct from` keeps the head technicians.
 * - Urgency by the kind of signal (P10): a problem from a review is urgent
 *   only when it is about safety — the guest left days ago, and a dripping
 *   tap can wait for seven in the morning; one from a message is the guest
 *   in the flat now, and a high one is urgent as a staff report is.
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
                      and (new.source in ('staff', 'message')
                           or new.source_facts ->> 'kind' = 'safety');
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
    -- problem from a guest signal: nobody to leave out.
    and h.id is distinct from new.reported_by
    and h.id is distinct from v_actor
    and exists (select 1 from public.push_tokens t where t.profile_id = h.id)
  order by h.id;

  return null;
end;
$$;

-- ===================================================================
-- step 2 — texts of reviews (names replaced before they arrive), 18 months
-- ===================================================================

-- Only a review keeps a text. A message's text is read from the PMS when it
-- is read and forgotten with the run (the owner's decision 3 of
-- 2026-10-31); the check below holds that for whatever loads messages.
alter table public.guest_signals
  add column public_text       text check (char_length(public_text) <= 8000),
  add column private_text      text check (char_length(private_text) <= 4000),
  add column category_comments jsonb check (category_comments is null
                                            or jsonb_typeof(category_comments) = 'object'),
  -- ISO code of the text's language, from the model (a PMS may have none).
  add column language          text check (language ~ '^[a-z]{2,3}$'),
  -- The texts go at this date (18 months counted in whole months,
  -- signal_retention_ends; the reviews owner's decision 7); the ratings stay.
  add column text_purge_after  date,
  -- A text longer than its column keeps its beginning; the card says so and
  -- points to the channel for the rest. None in the data of 2026-10-17 came
  -- near (public 1 222, private 1 000 characters at most).
  add column text_truncated    boolean not null default false,
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
  -- Whether the stay began on or after the day of the guest notice, as its
  -- exact arrival said when the stay was cut to its month (null: no notice
  -- then, or no arrival). A part of the text that comes after the cut is
  -- kept only if this says so (store_review_texts).
  add column stay_after_notice boolean,
  add constraint guest_signals_texts_are_a_review
    check (kind = 'review' or (public_text is null and private_text is null
                               and category_comments is null)),
  add constraint guest_signals_text_has_purge_date
    check ((public_text is null and private_text is null and category_comments is null)
           or text_purge_after is not null);

-- What classify-guest-signals reads: every stored text the model has not read —
-- not only the ones the rules flagged. The "has text" flags are not enough:
-- the history of step 0 has them and no text. Newest first, so a backlog
-- (the model switched on after weeks of rules alone) never holds back
-- today's reviews.
create index guest_signals_to_analyse_idx on public.guest_signals (host_id, submitted_at desc)
  where analysed_at is null and analysis_attempts < 3
    and (public_text is not null or private_text is not null or category_comments is not null);

/**
 * Whether a review may keep a text at all, by the company's switches — one
 * answer for store_review_texts (what is written) and review_load_state
 * (what sync-guest-signals asks the PMS for).
 *
 * Only stays that began on or after the day the guest notice went live: the
 * guest had the line about reviews before writing one. Not the submission
 * date — Booking takes reviews up to three months after departure, and a
 * guest who stayed before the notice never saw it. A stay without a known
 * arrival keeps no text. This also keeps the history and the weekly re-read
 * of 100 days from turning old texts into findings. The exact arrival while
 * there is one; after the cut, what it said then. A stay cut before the
 * notice had a date says nothing; its month still answers when the whole
 * month came after the notice (the first of the month is never later than
 * the real day).
 *
 * Never for a review hidden on the channel, nor for a place in the archive:
 * those keep their ratings only (the owner's decisions of 2026-10-17); nor
 * past the text's 18 months. Never for anything but a review, and only by
 * the reviews' own switches.
 *
 * Internal: no grants.
 */
create or replace function public.review_text_allowed(
  p_review   public.guest_signals,
  p_settings public.signal_settings
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_review.kind = 'review'
     and p_settings.kind = 'review'
     and coalesce(p_settings.texts_enabled, false)
     and p_settings.notice_published_at is not null
     and coalesce(case when p_review.stay_exact
                       then p_review.arrival_date
                            >= (p_settings.notice_published_at at time zone 'Europe/Prague')::date
                       else coalesce(p_review.stay_after_notice,
                                     p_review.arrival_date
                                     >= (p_settings.notice_published_at at time zone 'Europe/Prague')::date)
                  end, false)
     and (p_review.text_purge_after is null or p_review.text_purge_after > current_date)
     and not p_review.is_hidden
     and not exists (select 1 from public.properties p
                     where p.id in (p_review.property_id, p_review.room_id) and p.status = 'archived')
$$;

/**
 * The texts of a portion, written only by ingest_guest_reviews and only while
 * the company keeps texts. Names are replaced by the adapter before the row
 * is sent; this function cannot check that and does not pretend to.
 *
 * Only where review_text_allowed() says a text may be kept. Read against the
 * switch itself; ingest_guest_reviews holds the settings row for share, so a
 * load and an admin switching texts off never pass each other.
 *
 * Bounded, not refused: a text past its column keeps its beginning and says
 * so (text_truncated) — one long review must not cost the whole portion and
 * stop the watermark. A category comment is kept only as text, 1 000
 * characters each.
 *
 * A part that comes later (a private text after the public one) is added; a
 * part already kept is not rewritten. Either way the review goes back to its
 * readers: the model reads it again whole, and adds only findings it did not
 * have.
 */
create or replace function public.store_review_texts(
  p_host_id  uuid,
  p_provider public.signal_provider,
  p_rows     jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  with incoming as (
    select r.external_key,
           nullif(btrim(r.public_text), '') as public_text,
           nullif(btrim(r.private_text), '') as private_text,
           case when jsonb_typeof(r.category_comments) = 'object' then
             (select jsonb_object_agg(c.key, left(btrim(c.value), 1000))
              from jsonb_each_text(r.category_comments) as c
              where nullif(btrim(c.value), '') is not null)
           end as category_comments
    from jsonb_to_recordset(p_rows) as r (external_key text, public_text text,
                                          private_text text, category_comments jsonb)
  )
  update public.guest_signals g
  set public_text       = coalesce(g.public_text, left(i.public_text, 8000)),
      private_text      = coalesce(g.private_text, left(i.private_text, 4000)),
      category_comments = coalesce(g.category_comments, i.category_comments),
      text_truncated    = g.text_truncated
                          or (g.public_text is null and coalesce(char_length(i.public_text) > 8000, false))
                          or (g.private_text is null and coalesce(char_length(i.private_text) > 4000, false)),
      text_purge_after  = coalesce(g.text_purge_after, public.signal_retention_ends(g.kind, g.submitted_at)),
      analysed_at       = null,
      rules_version     = null,
      analysis_attempts = 0,
      analysis_error    = null
  from incoming i, public.signal_settings s
  where g.host_id = p_host_id
    and g.provider = p_provider
    and g.kind = 'review'
    and g.external_key = i.external_key
    and s.host_id = p_host_id
    and s.kind = 'review'
    and public.review_text_allowed(g, s)
    and ((g.public_text is null and i.public_text is not null)
         or (g.private_text is null and i.private_text is not null)
         or (g.category_comments is null and i.category_comments is not null))
$$;

/**
 * What sync-guest-signals needs to know of the reviews it read, by their keys, so
 * that it asks the PMS only for what is still missing (the owner's decisions
 * of 2026-10-18): a booking read for the guest's names only while a part of
 * the text is still to be kept, a room only while the stay is exact and its
 * room unknown. A key it does not return is a review not stored yet.
 *
 * Flags only, never a text, a date or an id.
 */
create or replace function public.review_load_state(
  p_provider public.signal_provider,
  p_keys     text[],
  p_host_id  uuid default null
)
returns table (
  external_key  text,
  public_kept   boolean,
  private_kept  boolean,
  comments_kept boolean,
  text_allowed  boolean,
  stay_exact    boolean,
  room_known    boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.external_key,
         g.public_text is not null,
         g.private_text is not null,
         g.category_comments is not null,
         public.review_text_allowed(g, s),
         g.stay_exact,
         g.room_id is not null
  from public.guest_signals g
  left join public.signal_settings s on s.host_id = g.host_id and s.kind = g.kind
  where g.host_id = coalesce(p_host_id, public.default_host_id())
    and g.provider = p_provider
    and g.kind = 'review'
    and g.external_key = any (coalesce(p_keys, '{}'))
$$;

/**
 * A signal's texts go, and everything drawn from them: the fragments, and
 * the model's paraphrase on every finding — a finding keeps its kind and
 * subject, which the screen names from the locales. A problem keeps its own
 * title: that is the work order, worded without names or quotes, and lives
 * on the problem, not here. A finding filed by hand keeps the manager's
 * words, which never came from the text.
 *
 * One path for every reason a text goes: its 18 months are over, the review
 * was hidden on the channel, the company switched texts off, the place went
 * to the archive.
 *
 * Internal: no grants.
 */
create or replace function public.erase_signal_texts(p_signal_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_signals  integer;
  v_findings integer;
begin
  -- The signals first, in one order — as apply_signal_findings takes its
  -- signal before its findings — so the two never wait on each other
  -- crosswise, and a reading in flight finishes before its text goes.
  perform 1 from public.guest_signals g where g.id = any (p_signal_ids) order by g.id for update;

  update public.signal_findings f
  set evidence = null, summary = f.subject, summary_i18n = '{}'::jsonb
  where f.signal_id = any (p_signal_ids)
    and f.detector <> 'manual'
    and (f.evidence is not null or f.summary <> f.subject or f.summary_i18n <> '{}'::jsonb);
  get diagnostics v_findings = row_count;

  update public.guest_signals g
  set public_text = null, private_text = null, category_comments = null, text_truncated = false
  where g.id = any (p_signal_ids)
    and (g.public_text is not null or g.private_text is not null or g.category_comments is not null);
  get diagnostics v_signals = row_count;

  return jsonb_build_object('signals', v_signals, 'findings', v_findings);
end;
$$;

/**
 * The nightly purge.
 *
 * Texts, and what was drawn from them, where they may no longer be: past
 * their 18 months; hidden on the channel since; on a place gone to the
 * archive; of a company whose texts are off (the switch erases at once —
 * this sweeps a load that raced it).
 *
 * Stays are cut by their own job (purge_signal_stays), not here: a failure
 * of one must not skip the other for the night.
 *
 * The key, on its kind's day (signal_retention_ends): the HMAC of the PMS's
 * id becomes 'purged:<our id>' (the id itself went with the stay's cut, long
 * before). What is left — the rating, its categories, the place, the channel,
 * the month — is statistics. A load never brings the key back:
 * ingest_guest_reviews skips such reviews.
 */
create or replace function public.purge_signal_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_erased jsonb;
  v_keys   integer;
begin
  v_erased := public.erase_signal_texts(array(
    select g.id
    from public.guest_signals g
    left join public.signal_settings s on s.host_id = g.host_id and s.kind = g.kind
    where (g.text_purge_after <= current_date
           or g.is_hidden
           or not coalesce(s.texts_enabled, false)
           or exists (select 1 from public.properties p
                      where p.id in (g.property_id, g.room_id) and p.status = 'archived'))
      and (g.public_text is not null or g.private_text is not null or g.category_comments is not null
           or exists (select 1 from public.signal_findings f
                      where f.signal_id = g.id
                        and f.detector <> 'manual'
                        and (f.evidence is not null or f.summary_i18n <> '{}'::jsonb)))));

  update public.guest_signals g
  set external_key        = 'purged:' || g.id::text,
      external_id         = null,
      external_updated_at = null
  where public.signal_retention_ends(g.kind, g.submitted_at) <= current_date
    and g.external_key not like 'purged:%';
  get diagnostics v_keys = row_count;

  return v_erased || jsonb_build_object('keys', v_keys);
end;
$$;

/**
 * The nightly sweep of stays (job purge-signal-stays, 05:00 UTC): every
 * signal settled since the last cut — a race with a load, a switch — and
 * every one whose signal_stay_link_ends() has come keeps its month and its
 * place and loses its days and its booking (cut_signal_stay_links — the
 * owner's decision of 2026-10-17, late). A review with a finding still
 * waiting and days left keeps them.
 */
create or replace function public.purge_signal_stays()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.cut_signal_stay_links(array(
    select g.id from public.guest_signals g where g.stay_exact));
end;
$$;

-- ===================================================================
-- step 3 — findings, the decision, the manager's word
-- ===================================================================

-- What a finding is about. Only the first four make a problem (the owner's
-- decision 2 of 2026-10-16); the rest are statistics.
create type public.signal_finding_kind as enum (
  'repair', 'safety', 'pests', 'access',
  'cleaning', 'supplies', 'noise', 'neighbourhood', 'wish', 'other'
);

-- candidate: waits for a manager. task_created: a problem was made of it (by
-- the manager or, for an auto kind, by the job). duplicate: linked to a
-- problem already open about the same. already_fixed: the same was solved
-- after the guest left, or the guest says it was fixed during the stay.
-- rejected: a manager said no — in the queue, or later on the problem's card
-- («false positive», mark_signal_false_positive). no_task: a kind that never
-- makes a problem, or a place nobody works any more. dropped: below the
-- confidence floor.
create type public.signal_finding_status as enum (
  'candidate', 'task_created', 'duplicate', 'already_fixed', 'rejected', 'no_task', 'dropped'
);

create type public.signal_reject_reason as enum (
  'false_positive', 'not_property', 'already_fixed', 'duplicate', 'not_worth'
);

/**
 * What a finding can be about — a closed list (plan 16.10 §3.4). Duplicates
 * are found by exact kind + subject, so a free code ("hot_water" one day,
 * "no_hot_water" the next) would never meet itself. A new subject is a new
 * value here, with its key in the locales (panel.guests.subject.*).
 */
create or replace function public.signal_subjects()
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

create table public.signal_findings (
  id              uuid primary key default gen_random_uuid(),
  host_id         uuid not null references public.hosts (id) on delete restrict,
  signal_id       uuid not null references public.guest_signals (id) on delete cascade,
  -- Where the work is: the room when the stay names one, else the listing.
  property_id     bigint references public.properties (id) on delete set null,
  kind            public.signal_finding_kind not null,
  -- One of signal_subjects(); anything else is mapped to 'other' on the way in.
  subject         text not null check (subject = any (public.signal_subjects())),
  urgency         public.problem_priority not null default 'normal',
  still_relevant  text not null default 'unclear'
                  check (still_relevant in ('likely', 'fixed_during_stay', 'unclear')),
  -- The model's words: in the company's language, the three languages
  -- beside it. The rules write no words, and a purge takes them away: then
  -- summary is the subject code and summary_i18n is {} — the screen names
  -- the kind and the subject, and the manager writes the title. By hand:
  -- the manager's title.
  summary         text not null check (char_length(btrim(summary)) between 1 and 200),
  summary_i18n    jsonb not null check (jsonb_typeof(summary_i18n) = 'object'),
  -- The anonymised fragment the finding rests on. Manager and admin only;
  -- purged with the review's text. A message keeps none: the manager reads
  -- the conversation in the PMS (docs/guest-signals.md §5.3).
  evidence        text check (char_length(evidence) <= 300),
  evidence_source text check (evidence_source in ('public', 'private', 'category_comment', 'message')),
  confidence      numeric(3, 2) check (confidence between 0 and 1),
  -- 'rules-v1', 'claude-haiku-5-5@prompt-v1': which reader found it.
  detector        text not null check (detector ~ '^[a-z0-9.@_-]{3,80}$'),
  status          public.signal_finding_status not null default 'candidate',
  -- manager, auto (an auto kind), rule (the kind or the place decided it).
  decided_mode    text check (decided_mode in ('manager', 'auto', 'rule')),
  reject_reason   public.signal_reject_reason,
  -- The problem it made or joined. Problems are archived; one is deleted
  -- only as a false positive nobody worked on (mark_signal_false_positive).
  problem_id      uuid references public.problems (id) on delete set null,
  decided_by      uuid references public.profiles (id) on delete set null,
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- A repeated reading of the same signal adds nothing it already has.
  constraint signal_findings_one_per_subject unique (signal_id, kind, subject),
  constraint signal_findings_reject_has_reason
    check (status <> 'rejected' or reject_reason is not null)
);

comment on table public.signal_findings is
  'What a reader (rules or the model) found in a guest signal, and what was decided about it.';

-- One finding made each problem; the others that met it are duplicates.
create unique index signal_findings_one_origin on public.signal_findings (problem_id)
  where status = 'task_created';
create index signal_findings_queue_idx on public.signal_findings (host_id, status, created_at desc);
create index signal_findings_problem_idx on public.signal_findings (problem_id)
  where problem_id is not null;
create index signal_findings_property_idx on public.signal_findings (property_id)
  where property_id is not null;

/**
 * A finding's own times, the moment of the write while its signal's stay is
 * exact; the month once it is cut — a finding stored after the cut (the
 * rules after the model, a late text, one filed by hand) must not stamp the
 * signal's day back through its created_at. decided_at is the work log's
 * and stays exact (cut_signal_stay_links).
 */
create or replace function public.signal_findings_dates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.guest_signals g where g.id = new.signal_id and not g.stay_exact) then
    new.created_at := public.signal_month_of(new.created_at);
    new.updated_at := public.signal_month_of(now());
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger signal_findings_dates
  before insert or update on public.signal_findings
  for each row execute function public.signal_findings_dates();

-- What a manager said of a reader's finding (P12, docs/guest-signals.md §7.3):
-- confirmed — work was made of it; duplicate or already_fixed — it joined
-- work already there about the same fault, open or solved; otherwise the
-- reason of a rejection, in the queue or later on the problem's card.
create type public.signal_verdict as enum (
  'confirmed', 'false_positive', 'wrong_kind', 'not_property', 'already_fixed', 'duplicate',
  'not_worth'
);

-- Every verdict, as it was given: the readers' calibration by kind of
-- signal, kind of finding and reader (detector@prompt), and the history a
-- finding's own status keeps only the last of. No text at all — no summary,
-- no evidence, no title — so a row outlives the finding's words, its signal
-- (a message's row goes after 90 days) and the problem, deleted or not. The
-- owner's decision 11 of 2026-10-31: the text of a false positive is not
-- kept for later replays.
create table public.signal_feedback (
  id             bigint generated always as identity primary key,
  host_id        uuid not null references public.hosts (id) on delete restrict,
  finding_id     uuid references public.signal_findings (id) on delete set null,
  provider       public.signal_provider not null,
  signal_kind    public.guest_signal_kind not null,
  kind           public.signal_finding_kind not null,
  subject        text not null check (subject = any (public.signal_subjects())),
  detector       text not null check (detector ~ '^[a-z0-9.@_-]{3,80}$'),
  confidence     numeric(3, 2) check (confidence between 0 and 1),
  verdict        public.signal_verdict not null,
  -- From the problem's card: what became of the work order (archived, or
  -- deleted while nobody had worked on it). Null for a verdict in the queue.
  problem_action text check (problem_action in ('archived', 'deleted')),
  decided_by     uuid references public.profiles (id) on delete set null,
  decided_at     timestamptz not null default now()
);

comment on table public.signal_feedback is
  'Every verdict a manager gave on a reader''s finding, without any text: the readers'' calibration. '
  'docs/guest-signals.md §7.3';

create index signal_feedback_record_idx
  on public.signal_feedback (host_id, signal_kind, kind, decided_at desc);
create index signal_feedback_finding_idx on public.signal_feedback (finding_id)
  where finding_id is not null;

/**
 * One verdict on a finding, as the manager gives it. A finding filed by hand
 * is the manager's own and says nothing of a reader: nothing is written.
 *
 * Internal: no grants. Called by the manager's levers below, which have
 * checked who calls.
 */
create or replace function public.record_signal_feedback(
  p_finding_id     uuid,
  p_verdict        public.signal_verdict,
  p_problem_action text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.signal_feedback (host_id, finding_id, provider, signal_kind, kind, subject,
                                      detector, confidence, verdict, problem_action, decided_by)
  select f.host_id, f.id, g.provider, g.kind, f.kind, f.subject, f.detector, f.confidence,
         p_verdict, p_problem_action, (select auth.uid())
  from public.signal_findings f
  join public.guest_signals g on g.id = f.signal_id
  where f.id = p_finding_id
    and f.detector <> 'manual'
$$;

/** The kinds that make a problem for a technician (the owner's decision 2). */
create or replace function public.signal_finding_gives_task(p_kind public.signal_finding_kind)
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
 * the building is the same leak as in its room. By parent_id, the core's own
 * column (P6): in the cloud on 2026-10-31 every room has both parent_id and
 * the PMS's unit id, and no other place has either, so nothing of a PMS is
 * needed to tell a room.
 */
create or replace function public.signal_place_family(p_property_id bigint)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.parent_id, p.id)
  from public.properties p
  where p.id = p_property_id
$$;

/**
 * How a kind of finding has done under the manager's eye, in one kind of
 * signal (P9: a chat is noisier than a review, and one record must not buy
 * auto for the other): decisions in the last 60 days and the share
 * approved. Variant C turns a kind to auto only at ≥ 50 decisions and ≥ 90 %
 * (the owner's decision 1). A «false positive» on a problem's card is a
 * manager's "no" too: it rejects the finding (mark_signal_false_positive).
 */
create or replace function public.signal_finding_record(
  p_host_id     uuid,
  p_signal_kind public.guest_signal_kind,
  p_kind        public.signal_finding_kind
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
  from public.signal_findings f
  join public.guest_signals g on g.id = f.signal_id
  left join public.problems pr on pr.id = f.problem_id
  where f.host_id = p_host_id
    and g.kind = p_signal_kind
    and f.kind = p_kind
    and f.detector <> 'manual'
    and f.decided_at >= now() - interval '60 days'
    and (f.decided_mode = 'manager'
         or (f.decided_mode = 'auto' and f.status = 'task_created' and pr.status = 'cancelled'))
$$;

/**
 * The open problem from a guest signal about the same thing — same kind,
 * same subject — anywhere in the finding's place family, whichever kind of
 * signal made it (a message in the stay and the review after it are one
 * fault); null if there is none.
 * One lookup for the job (decide_signal_finding) and for the manager
 * (approve_signal_finding), so neither makes a second work order for one
 * fault. Callers hold the family's lock.
 *
 * Internal: no grants.
 */
create or replace function public.signal_open_twin(p_finding_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id
  from public.signal_findings f
  join public.problems pr
    on pr.host_id = f.host_id
   and pr.source <> 'staff'
   and pr.archived_at is null
   and pr.status in ('open', 'assigned', 'in_progress')
   and pr.source_facts ->> 'kind' = f.kind::text
   and pr.source_facts ->> 'subject' = f.subject
   and public.signal_place_family(pr.property_id) = public.signal_place_family(f.property_id)
  where f.id = p_finding_id
  order by pr.created_at
  limit 1
$$;

/**
 * The cut (the owner's decision of 2026-10-17, late): the exact days of a
 * stay and the link to its booking are kept only while the review is
 * unsettled, and never past signal_stay_link_ends(). Of the reviews given,
 * each whose stay is still exact and that
 * - is settled — no finding waits for a manager, and its kept text, if any,
 *   has been read by both readers: the rules always (classify-guest-signals runs
 *   them after the model), and the model while it is on and the review is
 *   within its reach (model_since; a review it gave up on after three
 *   failures counts as read) — the rules' "already fixed" needs the exact
 *   day as much as the model's findings do;
 * - or has come to its last day,
 * keeps its place, its rating and its month and loses the rest. Arrival,
 * departure, the day it was sent, the row's own day, when it was read and
 * the PMS's own clock become the first of their month or go — its findings'
 * created_at too, written the day it was read (signal_findings_dates keeps
 * later ones to the month), and updated_at from now on (guest_signals_touch).
 * The booking (ours, and the PMS's id of it) goes, and the PMS's id of the
 * review with it (the owner's decision of 2026-10-18): from then on the
 * review is known by its HMAC key alone. For good: stay_exact is false and
 * nothing sets it back; ingest_guest_reviews never restores a booking, an id
 * or a day on such a row.
 *
 * The work log is not touched: when a manager or the job decided, when a
 * problem was made and what became of it stay exact. They date the work; the
 * day of a review can be guessed from them only to within days.
 *
 * Two statements on purpose: the reviews are locked first, in id order —
 * waiting, if need be, for a reading or a decision on them to commit — and
 * whether each is settled is read after, in a snapshot that sees what that
 * reading or decision wrote. A subquery in a locking statement would keep
 * the snapshot from before the wait and miss a candidate just stored.
 *
 * Internal: no grants.
 */
create or replace function public.cut_signal_stay_links(p_signal_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cut uuid[];
begin
  if coalesce(cardinality(p_signal_ids), 0) = 0 then
    return 0;
  end if;

  perform 1 from public.guest_signals g
  where g.id = any (p_signal_ids) and g.stay_exact
  order by g.id
  for update;

  with due as (
    select g.id,
           g.arrival_date >= (s.notice_published_at at time zone 'Europe/Prague')::date as after_notice
    from public.guest_signals g
    left join public.signal_settings s on s.host_id = g.host_id and s.kind = g.kind
    where g.id = any (p_signal_ids)
      and g.stay_exact
      and (public.signal_stay_link_ends(g.kind, g.submitted_at) <= current_date
           or (not exists (select 1 from public.signal_findings f
                           where f.signal_id = g.id and f.status = 'candidate')
               and not ((g.public_text is not null or g.private_text is not null
                         or g.category_comments is not null)
                        and (g.rules_version is null
                             or (coalesce(s.model_enabled, false)
                                 and g.submitted_at >= s.model_since
                                 and g.analysed_at is null and g.analysis_attempts < 3)))))
  ),
  cut as (
    update public.guest_signals g
    set stay_exact              = false,
        stay_after_notice       = due.after_notice,
        reservation_id          = null,
        external_reservation_id = null,
        external_id             = null,
        external_updated_at     = null,
        arrival_date            = date_trunc('month', g.arrival_date::timestamp)::date,
        departure_date          = date_trunc('month', g.departure_date::timestamp)::date,
        submitted_at            = public.signal_month_of(g.submitted_at),
        created_at              = public.signal_month_of(g.created_at),
        analysed_at             = public.signal_month_of(g.analysed_at)
    from due
    where g.id = due.id
    returning g.id
  )
  select coalesce(array_agg(cut.id), '{}') into v_cut from cut;

  if cardinality(v_cut) > 0 then
    update public.signal_findings f
    set created_at = public.signal_month_of(f.created_at)
    where f.signal_id = any (v_cut);
  end if;

  return cardinality(v_cut);
end;
$$;

/**
 * Make the problem a finding asks for — the same insert into the same table as
 * report_problem, so the same triggers run: the journal (reported, actor =
 * whoever approved, null for the job) and the push to the head technicians.
 * report_problem itself is not touched (docs §4.5).
 *
 * The description is the manager's own words, never the model's: the
 * technician reads the short wording, the kind, the subject and the month,
 * nothing longer from the guest (the owner's decision 3). The problem's
 * source is the kind of signal, and its facts say who made it — the
 * manager, or auto — for the technician's «Создано автоматически» and
 * «Подтвердил менеджер» (the owner's decision 7 of 2026-10-31).
 *
 * Internal: no grants. Callers hold the place's lock and have checked the
 * finding.
 */
create or replace function public.create_signal_problem(
  p_finding_id  uuid,
  p_title       text,
  p_title_i18n  jsonb,
  p_priority    public.problem_priority,
  p_mode        text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finding public.signal_findings;
  v_signal  public.guest_signals;
  v_id      uuid := gen_random_uuid();
begin
  select * into v_finding from public.signal_findings where id = p_finding_id;
  select * into v_signal from public.guest_signals where id = v_finding.signal_id;

  -- assign_problem refuses a problem without a place (problemNoProperty):
  -- one made here would sit in the pool and never reach a technician.
  if v_finding.property_id is null then
    raise exception 'Finding % has no place to send anyone to', p_finding_id
      using errcode = 'check_violation', hint = 'serverErrors.signalFindingNoPlace';
  end if;
  -- A place in the archive keeps ratings only, never work (the owner's
  -- decision of 2026-10-17) — the room, or the building it hangs under.
  if exists (select 1 from public.properties p
             where p.id in (v_finding.property_id, public.signal_place_family(v_finding.property_id))
               and p.status = 'archived') then
    raise exception 'Finding % is about a place in the archive', p_finding_id
      using errcode = 'check_violation', hint = 'serverErrors.signalPlaceArchived';
  end if;

  perform public.validate_problem_text(p_title, p_description);
  if p_title_i18n is not null and not public.is_localized_text(p_title_i18n) then
    raise exception 'Title translations are not valid localized text'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.localizedTextInvalid';
  end if;

  insert into public.problems (id, host_id, property_id, reported_by, title, title_i18n,
                               description, priority, source, source_facts)
  values (v_id, v_finding.host_id, v_finding.property_id, null, btrim(p_title), p_title_i18n,
          nullif(btrim(p_description), ''), p_priority, v_signal.kind::text::public.problem_source,
          -- The month, never the day: the signal is settling, and its days
          -- are about to go (cut_signal_stay_links). A review: the month the
          -- guest left; a message: the month it was sent.
          jsonb_build_object('kind', v_finding.kind, 'subject', v_finding.subject,
                             'channel', v_signal.channel,
                             'period_month',
                             to_char(case v_signal.kind
                                       when 'review' then v_signal.departure_date
                                       else (v_signal.submitted_at at time zone 'Europe/Prague')::date
                                     end, 'YYYY-MM'),
                             'mode', p_mode));

  update public.signal_findings
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
create or replace function public.decide_signal_finding(p_finding_id uuid)
returns public.signal_finding_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finding  public.signal_findings;
  v_signal   public.guest_signals;
  v_settings public.signal_settings;
  v_since    date;
  v_family   bigint;
  v_status   public.property_status;
  v_match    uuid;
begin
  select * into v_finding from public.signal_findings where id = p_finding_id for update;
  if v_finding.status <> 'candidate' then
    return v_finding.status;
  end if;
  select * into v_signal from public.guest_signals where id = v_finding.signal_id;
  select * into v_settings from public.signal_settings
  where host_id = v_finding.host_id and kind = v_signal.kind;
  v_since := public.signal_since(v_signal);
  select p.status into v_status from public.properties p where p.id = v_finding.property_id;

  -- 1. Kinds that never make a problem, and places nobody works any more. A
  -- place in maintenance stays: the manager knows whether this is the repair
  -- it is closed for (it never goes automatically — rule 6).
  if not public.signal_finding_gives_task(v_finding.kind)
     or v_finding.property_id is null
     or v_status is distinct from 'active' and v_status is distinct from 'maintenance' then
    update public.signal_findings
    set status = 'no_task', decided_mode = 'rule', decided_at = now()
    where id = p_finding_id;
    return 'no_task';
  end if;

  -- 2. Below the floor: kept for the record, never shown as work.
  if coalesce(v_finding.confidence, 0) < coalesce(v_settings.min_confidence, 0.60) then
    update public.signal_findings
    set status = 'dropped', decided_mode = 'rule', decided_at = now()
    where id = p_finding_id;
    return 'dropped';
  end if;

  -- 3. The guest says it was fixed while they stayed.
  if v_finding.still_relevant = 'fixed_during_stay' then
    update public.signal_findings
    set status = 'already_fixed', decided_mode = 'rule', decided_at = now()
    where id = p_finding_id;
    return 'already_fixed';
  end if;

  v_family := public.signal_place_family(v_finding.property_id);
  perform pg_advisory_xact_lock(hashtextextended('signal-place:' || v_family, 0));

  -- 4. Already open from a guest signal about the same, anywhere in the
  -- family.
  v_match := public.signal_open_twin(p_finding_id);
  if v_match is not null then
    update public.signal_findings
    set status = 'duplicate', problem_id = v_match, decided_mode = 'rule', decided_at = now()
    where id = p_finding_id;
    return 'duplicate';
  end if;

  -- 5. Solved since the guest left (or, for a message, since it was sent:
  -- signal_since, P8): someone found it before the signal came. Only while
  -- the stay's days are exact: from its month, "since" could be a repair done
  -- before the guest came — the manager judges that on the card.
  if v_signal.stay_exact then
    select pr.id into v_match
    from public.problems pr
    where pr.host_id = v_finding.host_id
      and pr.source <> 'staff'
      and pr.status = 'resolved'
      and pr.resolved_at::date >= v_since
      and public.signal_place_family(pr.property_id) = v_family
      and pr.source_facts ->> 'kind' = v_finding.kind::text
      and pr.source_facts ->> 'subject' = v_finding.subject
    order by pr.resolved_at desc
    limit 1;
  end if;
  if v_match is not null then
    update public.signal_findings
    set status = 'already_fixed', problem_id = v_match, decided_mode = 'rule', decided_at = now()
    where id = p_finding_id;
    return 'already_fixed';
  end if;

  -- 6. Automatic only for a kind the company switched to auto for this kind
  -- of signal, read by the model (rules alone never make a problem), about a
  -- fresh signal (Booking takes reviews for three months), and on a place
  -- where nothing was reported since — open or already solved, by anyone: a
  -- staff report has no kind to compare, so a human looks. "Since" needs the
  -- exact day: a stay cut to its month never goes on its own. And at most
  -- daily_auto_cap a Prague day for this kind of signal (five by default,
  -- the owner's decision of 2026-10-18; a setting since P9): a model gone
  -- wrong fills the manager's queue, not the technicians' day. The count is
  -- taken under the company's and the kind's lock, so two runs at once
  -- cannot both make the last one; the place lock above is always taken
  -- first.
  if coalesce(v_settings.tasks_enabled, false)
     and v_signal.stay_exact
     and v_status = 'active'
     and v_finding.kind::text = any (coalesce(v_settings.auto_kinds, '{}'))
     and v_finding.detector not like 'rules-%'
     and v_finding.detector <> 'manual'
     and v_signal.submitted_at >= now() - interval '7 days'
     and not exists (
       select 1 from public.problems pr
       where pr.host_id = v_finding.host_id
         and public.signal_place_family(pr.property_id) = v_family
         and ((pr.archived_at is null and pr.status in ('open', 'assigned', 'in_progress'))
              or pr.created_at::date >= v_since)
     ) then
    perform pg_advisory_xact_lock(
      hashtextextended('signal-auto:' || v_finding.host_id || ':' || v_signal.kind, 0));
    if (select count(*) from public.signal_findings f
        join public.guest_signals g on g.id = f.signal_id
        where f.host_id = v_finding.host_id
          and g.kind = v_signal.kind
          and f.decided_mode = 'auto'
          and f.decided_at >= date_trunc('day', now() at time zone 'Europe/Prague')
                              at time zone 'Europe/Prague') < v_settings.daily_auto_cap then
      perform public.create_signal_problem(
        p_finding_id, v_finding.summary, v_finding.summary_i18n, v_finding.urgency, 'auto');
      return 'task_created';
    end if;
  end if;

  -- 7. Otherwise a manager decides.
  return 'candidate';
end;
$$;

/**
 * One review's reading, applied in one transaction: the findings are stored
 * (a repeated reading adds only new subjects), each is decided, the review is
 * marked as read by this version. Called by classify-guest-signals.
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
 * Two readers, one queue (the hybrid of 2026-10-16: the rules always, the
 * model on every text, a disagreement to the manager). classify-guest-signals
 * applies the model's reading first and the rules' after it:
 * - the rules write no words (summary = subject, summary_i18n = {}), never
 *   make a problem alone (decide rule 6), and add a card only for a kind the
 *   model — or a manager by hand — said nothing of in this review: that is
 *   the disagreement;
 * - a rules-only reading (the model away, off, or over its ceiling) marks
 *   rules_version and leaves the review open for the model;
 * - when the model reads after the rules, a rules card nobody decided gives
 *   way: the same kind and subject takes the model's reading in place (even
 *   one a rule set aside), another subject still waiting is set aside as
 *   dropped (counted as "superseded"). A card a manager decided stays.
 * - a reading that lands after the kept text was erased keeps its cards
 *   without words or fragment.
 *
 * At the end the review is cut to its month if it is settled — read, and no
 * candidate left (cut_signal_stay_links).
 */
create or replace function public.apply_signal_findings(
  p_signal_id uuid,
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
  v_signal   public.guest_signals;
  v_is_rules boolean := p_detector like 'rules-%';
  v_has_text boolean;
  v_words    boolean;
  v_language text;
  v_ids      uuid[];
  v_kinds    public.signal_finding_kind[];
  v_id       uuid;
  v_valid    integer;
  v_n        integer;
  v_code     text;
  v_status   public.signal_finding_status;
  v_counts   jsonb := '{}'::jsonb;
begin
  select * into v_signal from public.guest_signals where id = p_signal_id for update;
  if not found then
    raise exception 'Guest signal % not found', p_signal_id
      using errcode = 'no_data_found', hint = 'serverErrors.signalNotFound';
  end if;
  if jsonb_typeof(p_findings) is distinct from 'array' then
    raise exception 'Findings must be a JSON array'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.signalFindingsInvalid';
  end if;

  select h.default_language::text into v_language from public.hosts h where h.id = v_signal.host_id;

  -- The fragment only while the text it quotes is kept. The model's words
  -- only while the text they came from is: a reading that lands after the
  -- kept text was erased (hidden, switched off, archived, expired — it was
  -- kept once, so it has a purge date) keeps its cards and loses its words,
  -- as erase_signal_texts would have left them.
  v_has_text := v_signal.public_text is not null or v_signal.private_text is not null
                or v_signal.category_comments is not null;
  v_words := not v_is_rules and not (v_signal.text_purge_after is not null and not v_has_text);

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
      case when i.item ->> 'subject' = any (public.signal_subjects())
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
      case when i.item ->> 'evidence_source' in ('public', 'private', 'category_comment', 'message')
           then i.item ->> 'evidence_source' end as evidence_source,
      case when jsonb_typeof(i.item -> 'confidence') = 'number'
           then least(greatest((i.item ->> 'confidence')::numeric, 0), 1) end as confidence
    from items i
  ),
  valid as (
    select case when p.kind_text = any (enum_range(null::public.signal_finding_kind)::text[])
                then p.kind_text::public.signal_finding_kind end as kind,
           p.subject, p.urgency, p.still_relevant, p.evidence_source, p.confidence,
           -- The rules write no words: the screen names kind and subject.
           case when v_words then p.summary_i18n else '{}'::jsonb end as summary_i18n,
           case when v_words
                then coalesce(p.summary_i18n ->> v_language, p.summary_i18n ->> 'en',
                              p.summary_i18n ->> 'cs', p.summary_i18n ->> 'ru')
                else p.subject end as summary,
           case when v_has_text then left(p.raw_evidence, 300) end as evidence
    from parsed p
    where p.kind_text = any (enum_range(null::public.signal_finding_kind)::text[])
      and (v_is_rules or p.summary_i18n <> '{}'::jsonb)
      -- Technicians read this as the title: no link, no address, no quote. A
      -- short neutral phrase ("no hot water") may well be the guest's words
      -- too; a long one copied whole, or the fragment pasted in, is a quote.
      and (v_is_rules or not exists (
        select 1 from jsonb_each_text(p.summary_i18n) as s (k, v)
        where s.v ~* '(https?:|www\.|@)'
           or (char_length(s.v) >= 40
               and position(lower(s.v) in lower(coalesce(p.raw_evidence, ''))) > 0)
           or (char_length(coalesce(p.raw_evidence, '')) >= 30
               and position(lower(p.raw_evidence) in lower(s.v)) > 0)))
  ),
  deduped as (
    select distinct on (v.kind, v.subject) v.*
    from valid v
    -- Where the model (or a manager) spoke about a kind, the rules add
    -- nothing to it: no second card for one complaint.
    where not (v_is_rules and exists (
      select 1 from public.signal_findings f
      where f.signal_id = p_signal_id and f.kind = v.kind and f.detector not like 'rules-%'))
    order by v.kind, v.subject, v.confidence desc nulls last
  ),
  stored as (
    insert into public.signal_findings as rf (
      host_id, signal_id, property_id, kind, subject, urgency, still_relevant,
      summary, summary_i18n, evidence, evidence_source, confidence, detector
    )
    select v_signal.host_id, v_signal.id, coalesce(v_signal.room_id, v_signal.property_id),
           d.kind, d.subject, d.urgency, d.still_relevant, d.summary, d.summary_i18n,
           d.evidence, d.evidence_source, d.confidence, p_detector
    from deduped d
    -- The model meets a rules card about the same kind and subject that no
    -- person has decided — still waiting, or set aside by a rule (below the
    -- floor, say, at the rules' confidence): the card takes the model's
    -- reading and is decided again below. One a manager decided, or the job
    -- made a problem of, stays as it is.
    on conflict (signal_id, kind, subject) do update
      set urgency         = excluded.urgency,
          still_relevant  = excluded.still_relevant,
          summary         = excluded.summary,
          summary_i18n    = excluded.summary_i18n,
          evidence        = excluded.evidence,
          evidence_source = excluded.evidence_source,
          confidence      = excluded.confidence,
          detector        = excluded.detector,
          status          = 'candidate',
          decided_mode    = null,
          decided_by      = null,
          decided_at      = null,
          problem_id      = null
      where not v_is_rules and rf.detector like 'rules-%'
        and (rf.status = 'candidate' or rf.decided_mode = 'rule')
    returning rf.id
  )
  select coalesce(array_agg(id), '{}'),
         (select count(*) from valid),
         (select array_agg(distinct v.kind) from valid v)
    into v_ids, v_valid, v_kinds
  from stored;

  if jsonb_array_length(p_findings) > v_valid then
    v_counts := jsonb_build_object('invalid', jsonb_array_length(p_findings) - v_valid);
  end if;

  -- A rules card still waiting about a kind the model has now read, under
  -- another subject, gives way to the model's own finding.
  if not v_is_rules and v_kinds is not null then
    update public.signal_findings f
    set status = 'dropped', decided_mode = 'rule', decided_at = now()
    where f.signal_id = p_signal_id
      and f.detector like 'rules-%'
      and f.status = 'candidate'
      and f.kind = any (v_kinds);
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_counts := v_counts || jsonb_build_object('superseded', v_n);
    end if;
  end if;

  foreach v_id in array v_ids loop
    v_status := public.decide_signal_finding(v_id);
    v_counts := jsonb_set(v_counts, array[v_status::text],
                          to_jsonb(coalesce((v_counts ->> v_status::text)::integer, 0) + 1));
  end loop;

  -- en-US, EN, en_GB → en; anything else is not a language code and is dropped.
  v_code := lower(split_part(replace(coalesce(p_language, ''), '_', '-'), '-', 1));
  if v_code !~ '^[a-z]{2,3}$' then
    v_code := null;
  end if;

  if v_is_rules then
    update public.guest_signals
    set rules_version = p_detector, language = coalesce(language, v_code)
    where id = p_signal_id;
  else
    update public.guest_signals
    -- A cut review read again (a late text) keeps only the month of it.
    set analysed_version = p_detector, analysis_error = null,
        analysed_at = case when stay_exact then now() else public.signal_month_of(now()) end,
        language = coalesce(v_code, language)
    where id = p_signal_id;
  end if;

  -- Read, and nothing left for a manager: the stay goes to its month now.
  -- With a candidate waiting it stays until the manager decides.
  perform public.cut_signal_stay_links(array[p_signal_id]);

  return v_counts;
end;
$$;

/**
 * A reading that failed (the model's answer did not parse, the call errored):
 * counted, with a code. After three the review leaves the model's queue
 * (guest_signals_to_analyse_idx) and stops taking the daily ceiling; the
 * manager still has it under «Все отзывы».
 *
 * A code starting with "service_" says the model's service failed — down,
 * overloaded, the key refused, the spending limit reached — not this review:
 * it is recorded and never counted, so an outage of three days does not push
 * every review out of the queue. Which it is, classify-guest-signals tells by the
 * next review: a failure, then a failure on another review, is the service —
 * the run stops and journals it (log_signal_run); a failure, then a success,
 * was the first review's own — that one is marked with a counted code. So a
 * review that always fails (a timeout on its text) never sits at the head of
 * the queue for ever. The rules' reading of the day stands, and the model
 * reads the queue when it is back.
 */
create or replace function public.mark_signal_analysis_failed(
  p_signal_id uuid,
  p_error     text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempts integer;
begin
  update public.guest_signals
  set analysis_attempts = analysis_attempts
                          + case when p_error like 'service\_%' then 0 else 1 end,
      analysis_error    = case when p_error ~ '^[a-z0-9_.:-]{1,80}$' then p_error else 'unknown' end
  where id = p_signal_id and analysed_at is null
  returning analysis_attempts into v_attempts;

  -- The third failure takes the review off the model's queue: with the rules
  -- read and no candidate, nothing waits on its days any more.
  if v_attempts >= 3 then
    perform public.cut_signal_stay_links(array[p_signal_id]);
  end if;
  return v_attempts;
end;
$$;

/**
 * The manager says yes: a problem is made of the finding — or, with
 * `p_link_problem_id`, the finding joins a problem on the same place: one
 * still open (duplicate), or one solved since the guest left (already
 * fixed); the card lists both kinds (signal_place_problems).
 *
 * The problem goes to the technician the manager picks (`p_assignee_id`,
 * through assign_problem — the board's own lever, so the repair, its journal
 * and the technician's push follow), or, without one, to «Открытые» for the
 * head technician (the owner's decision of 2026-10-17).
 *
 * Idempotent: a second press returns the finding as the first left it — and
 * so ignores a person or a day it brings; so does a link (the problem
 * linked to has its own). A day without a person means nothing either.
 */
create or replace function public.approve_signal_finding(
  p_finding_id      uuid,
  p_title           text default null,
  p_priority        public.problem_priority default null,
  p_link_problem_id uuid default null,
  p_description     text default null,
  p_assignee_id     uuid default null,
  p_scheduled_date  date default null
)
returns public.signal_findings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finding public.signal_findings;
  v_signal  public.guest_signals;
  v_since   date;
  v_enabled boolean;
  v_link    public.problems;
  v_twin    uuid;
  v_problem uuid;
begin
  if not public.is_manager() then
    raise exception 'Only a manager decides about findings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;

  -- The signal first, then the finding: the order apply_signal_findings and
  -- erase_signal_texts take them in, so a manager and the job never wait on
  -- each other crosswise.
  perform 1 from public.guest_signals g
  where g.id = (select f.signal_id from public.signal_findings f
                where f.id = p_finding_id and f.host_id = public.current_host_id())
  for update;
  select * into v_finding from public.signal_findings
  where id = p_finding_id and host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Finding % not found', p_finding_id
      using errcode = 'no_data_found', hint = 'serverErrors.signalFindingNotFound';
  end if;
  if v_finding.status in ('task_created', 'duplicate') then
    return v_finding;
  end if;
  -- The manager may overrule the rules: a finding dropped for low confidence,
  -- or one they took for fixed, can still become work. A rejection, or a kind
  -- or place that never makes a problem, cannot.
  if v_finding.status not in ('candidate', 'dropped', 'already_fixed') then
    raise exception 'Finding % is already decided', p_finding_id
      using errcode = 'check_violation', hint = 'serverErrors.signalFindingDecided',
            detail = jsonb_build_object('status', v_finding.status)::text;
  end if;

  select * into v_signal from public.guest_signals where id = v_finding.signal_id;
  v_since := public.signal_since(v_signal);

  select coalesce(s.tasks_enabled, false) into v_enabled
  from public.signal_settings s where s.host_id = v_finding.host_id and s.kind = v_signal.kind;
  if not coalesce(v_enabled, false) then
    raise exception 'Problems from guest signals of this kind are switched off'
      using errcode = 'check_violation', hint = 'serverErrors.signalTasksDisabled',
            detail = jsonb_build_object('kind', v_signal.kind)::text;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('signal-place:' || public.signal_place_family(v_finding.property_id), 0));

  if p_link_problem_id is not null then
    select * into v_link from public.problems
    where id = p_link_problem_id and host_id = v_finding.host_id;
    if not found
       or public.signal_place_family(v_link.property_id)
          is distinct from public.signal_place_family(v_finding.property_id)
       or not ((v_link.archived_at is null and v_link.status in ('open', 'assigned', 'in_progress'))
               or (v_link.status = 'resolved'
                   and coalesce(v_link.resolved_at::date >= v_since, false))) then
      raise exception 'Problem % cannot take this finding', p_link_problem_id
        using errcode = 'check_violation', hint = 'serverErrors.signalLinkInvalid';
    end if;
    update public.signal_findings
    set status = case when v_link.status = 'resolved'
                      then 'already_fixed'::public.signal_finding_status
                      else 'duplicate'::public.signal_finding_status end,
        problem_id = v_link.id, decided_mode = 'manager',
        decided_by = (select auth.uid()), decided_at = now()
    where id = p_finding_id;
    perform public.record_signal_feedback(
      p_finding_id,
      case when v_link.status = 'resolved' then 'already_fixed' else 'duplicate' end::public.signal_verdict);
    perform public.cut_signal_stay_links(array[v_finding.signal_id]);
    select * into v_finding from public.signal_findings where id = p_finding_id;
    return v_finding;
  end if;

  -- The same fault already has its work order (two guests, or a candidate
  -- that waited while the job made one): no second visit. The screen offers
  -- «Это то же самое» with this id.
  v_twin := public.signal_open_twin(p_finding_id);
  if v_twin is not null then
    raise exception 'An open problem from a guest signal is about the same: %', v_twin
      using errcode = 'check_violation', hint = 'serverErrors.signalDuplicateOpen',
            detail = jsonb_build_object('problem_id', v_twin)::text;
  end if;

  -- No words to offer (a rules card, or one whose text was erased): the
  -- screen fills the title from the kind and the subject in the manager's
  -- language, and the manager may change it.
  if v_finding.summary_i18n = '{}'::jsonb and nullif(btrim(p_title), '') is null then
    raise exception 'Finding % has no wording; it needs a title', p_finding_id
      using errcode = 'check_violation', hint = 'serverErrors.signalTitleRequired';
  end if;

  -- The manager's own title is in the company's language and has no
  -- translations; the model's comes with all three.
  v_problem := public.create_signal_problem(
    p_finding_id,
    coalesce(nullif(btrim(p_title), ''), v_finding.summary),
    case when nullif(btrim(p_title), '') is null then v_finding.summary_i18n end,
    coalesce(p_priority, v_finding.urgency),
    'manager',
    p_description);
  perform public.record_signal_feedback(p_finding_id, 'confirmed');

  -- Sent at once, or left in «Открытые». assign_problem checks the person
  -- (an active member of the company) and the day; a refusal there undoes
  -- the problem too — one press, one outcome.
  if p_assignee_id is not null then
    perform public.assign_problem(v_problem, p_assignee_id, p_scheduled_date);
  end if;

  -- Decided: with no other candidate left, the stay goes to its month.
  perform public.cut_signal_stay_links(array[v_finding.signal_id]);

  select * into v_finding from public.signal_findings where id = p_finding_id;
  return v_finding;
end;
$$;

/**
 * The card's neighbours: the problems on the finding's place family that are
 * open now, or were reported or solved since the signal's day (signal_since:
 * the guest left, or the message was sent) — the family and the day the
 * decision looks at, so the manager sees what the job saw. Open
 * ones first, at most 20. `can_link` says which approve_signal_finding takes
 * as a link (open — «то же самое»; solved since the guest left — «уже
 * починено»); a cancelled one is listed for what it tells, not to link.
 * Manager and admin of the company only; for anyone else, nothing.
 */
create or replace function public.signal_place_problems(p_finding_id uuid)
returns table (
  id          uuid,
  property_id bigint,
  title       text,
  title_i18n  jsonb,
  source      public.problem_source,
  status      public.problem_status,
  priority    public.problem_priority,
  created_at  timestamptz,
  resolved_at timestamptz,
  is_open     boolean,
  can_link    boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select pr.id, pr.property_id, pr.title, pr.title_i18n, pr.source, pr.status, pr.priority,
         pr.created_at, pr.resolved_at,
         pr.archived_at is null and pr.status in ('open', 'assigned', 'in_progress') as is_open,
         (pr.archived_at is null and pr.status in ('open', 'assigned', 'in_progress'))
           or (pr.status = 'resolved'
               and coalesce(pr.resolved_at::date >= public.signal_since(g), false)) as can_link
  from public.signal_findings f
  join public.guest_signals g on g.id = f.signal_id
  join public.problems pr
    on pr.host_id = f.host_id
   and public.signal_place_family(pr.property_id) = public.signal_place_family(f.property_id)
  where f.id = p_finding_id
    and (select public.is_manager())
    and f.host_id = (select public.current_host_id())
    and ((pr.archived_at is null and pr.status in ('open', 'assigned', 'in_progress'))
         or pr.created_at::date >= public.signal_since(g)
         or pr.resolved_at::date >= public.signal_since(g))
  order by is_open desc, pr.created_at desc
  limit 20
$$;

/**
 * When each job last ran for each kind of signal, and last ran clean — the
 * «Гости» screen's line "updated at", and its warning when a day has gone by
 * without a clean run (docs/reviews-to-tasks.md §3.3). raw.signal_runs is not
 * exposed through PostgREST; this hands a manager of the company the kind,
 * the stage and two times, and nothing else: no counts, no codes, no
 * provider, nothing of a guest. The model's bookings are classify rows too
 * and are left out.
 *
 * The one function of the core that reads raw and is callable by a client:
 * table_grants.sql lets exactly this signature and this answer through
 * (rollout step 5a), and the guest signals suite checks the answer's shape.
 * Another column here, or another argument, turns that suite red.
 */
create or replace function public.signal_run_status()
returns table (kind public.guest_signal_kind, stage text, last_run_at timestamptz,
               last_ok_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select k.kind, s.stage, max(r.ran_at), max(r.ran_at) filter (where r.is_ok)
  from unnest(enum_range(null::public.guest_signal_kind)) as k (kind)
  cross join (values ('sync'), ('classify')) as s (stage)
  left join raw.signal_runs r
    on r.kind = k.kind
   and r.stage = s.stage
   and r.host_id = (select public.current_host_id())
   and not (r.counts ? 'reserved')
  where (select public.is_manager())
  group by k.kind, s.stage
  order by k.kind, s.stage desc
$$;

/**
 * «Создать задание» by hand from a guest signal, on the «Гости» screen:
 * works without the rules and without the model. The manager names the kind, the subject
 * and the title; the finding is stored as the manual reader's and approved at
 * once, through the same path as any other.
 */
create or replace function public.add_signal_finding(
  p_signal_id      uuid,
  p_kind           public.signal_finding_kind,
  p_subject        text,
  p_title          text,
  p_priority       public.problem_priority default 'normal',
  p_description    text default null,
  p_assignee_id    uuid default null,
  p_scheduled_date date default null
)
returns public.signal_findings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_signal public.guest_signals;
  v_id     uuid;
begin
  if not public.is_manager() then
    raise exception 'Only a manager decides about findings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;
  -- Locked first, as approve_signal_finding takes it.
  select * into v_signal from public.guest_signals
  where id = p_signal_id and host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Guest signal % not found', p_signal_id
      using errcode = 'no_data_found', hint = 'serverErrors.signalNotFound';
  end if;
  if not public.signal_finding_gives_task(p_kind) then
    raise exception 'Kind % never makes a problem', p_kind
      using errcode = 'check_violation', hint = 'serverErrors.signalKindNoTask',
            detail = jsonb_build_object('kind', p_kind)::text;
  end if;
  if not (p_subject = any (public.signal_subjects())) then
    raise exception 'Unknown subject %', p_subject
      using errcode = 'check_violation', hint = 'serverErrors.signalSubjectUnknown',
            detail = jsonb_build_object('subject', p_subject)::text;
  end if;
  perform public.validate_problem_text(p_title, p_description);

  insert into public.signal_findings (host_id, signal_id, property_id, kind, subject, urgency,
                                      summary, summary_i18n, confidence, detector)
  values (v_signal.host_id, v_signal.id, coalesce(v_signal.room_id, v_signal.property_id),
          p_kind, p_subject, coalesce(p_priority, 'normal'), btrim(p_title), '{}'::jsonb, 1, 'manual')
  on conflict (signal_id, kind, subject) do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.signal_findings
    where signal_id = p_signal_id and kind = p_kind and subject = p_subject;
  end if;
  return public.approve_signal_finding(v_id, p_title, p_priority,
                                       p_description    => p_description,
                                       p_assignee_id    => p_assignee_id,
                                       p_scheduled_date => p_scheduled_date);
end;
$$;

/**
 * The manager says no. A candidate becomes rejected with a reason. A problem
 * this finding made is called off too — but only while nobody has been sent:
 * once the head technician has handed it out, the manager closes it by hand.
 */
create or replace function public.reject_signal_finding(
  p_finding_id uuid,
  p_reason     public.signal_reject_reason
)
returns public.signal_findings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_finding public.signal_findings;
  v_problem public.problems;
begin
  if not public.is_manager() then
    raise exception 'Only a manager decides about findings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;
  if p_reason is null then
    raise exception 'A rejection needs a reason'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.signalRejectReasonMissing';
  end if;

  -- The signal first, then the finding, as approve_signal_finding.
  perform 1 from public.guest_signals g
  where g.id = (select f.signal_id from public.signal_findings f
                where f.id = p_finding_id and f.host_id = public.current_host_id())
  for update;
  select * into v_finding from public.signal_findings
  where id = p_finding_id and host_id = public.current_host_id()
  for update;
  if not found then
    raise exception 'Finding % not found', p_finding_id
      using errcode = 'no_data_found', hint = 'serverErrors.signalFindingNotFound';
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
        using errcode = 'check_violation', hint = 'serverErrors.signalFindingWorkStarted';
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
      using errcode = 'check_violation', hint = 'serverErrors.signalFindingDecided',
            detail = jsonb_build_object('status', v_finding.status)::text;
  end if;

  update public.signal_findings
  set status = 'rejected', reject_reason = p_reason, decided_mode = 'manager',
      decided_by = (select auth.uid()), decided_at = now()
  where id = p_finding_id;
  perform public.record_signal_feedback(p_finding_id, p_reason::text::public.signal_verdict);

  -- Decided: with no other candidate left, the stay goes to its month.
  perform public.cut_signal_stay_links(array[v_finding.signal_id]);

  select * into v_finding from public.signal_findings where id = p_finding_id;
  return v_finding;
end;
$$;

/**
 * «Ложное срабатывание» on the card of a problem made from a guest signal,
 * at any time — not only while it is open and nobody was sent (that is
 * reject_signal_finding, in the queue) (P12; the owner's decision 8 of
 * 2026-10-31):
 * - by default the work order goes to the archive: a problem still open,
 *   assigned or in progress is cancelled with its live repair, as
 *   cancel_problem does (the technician's push about a cancelled job
 *   follows from the repair); a solved or cancelled one is only archived;
 * - with p_delete it is deleted instead — only while nobody has worked on
 *   it: still open, no repair ever made for it, no photo, no conversation,
 *   and no other finding joined to it. Otherwise the call is refused and the
 *   archive is the way.
 * Either way the finding that made the problem is rejected as a false
 * positive — a manager's "no" in its kind's record for auto
 * (signal_finding_record) — and the verdict is written to signal_feedback,
 * which outlives the problem. Idempotent on the finding: a second press on
 * an archived problem returns the finding as the first left it.
 */
create or replace function public.mark_signal_false_positive(
  p_problem_id uuid,
  p_delete     boolean default false
)
returns public.signal_findings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
  v_finding public.signal_findings;
  v_action  text;
begin
  if not public.is_manager() then
    raise exception 'Only a manager decides about findings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;

  -- The signal first, then the finding, then the problem: the order of
  -- approve and reject, so a manager and the job never wait crosswise.
  perform 1 from public.guest_signals g
  where g.id = (select f.signal_id from public.signal_findings f
                where f.problem_id = p_problem_id
                  and f.host_id = public.current_host_id()
                  and (f.status = 'task_created'
                       or (f.status = 'rejected' and f.reject_reason = 'false_positive'))
                order by f.status = 'task_created' desc
                limit 1)
  for update;
  select * into v_finding from public.signal_findings f
  where f.problem_id = p_problem_id
    and f.host_id = public.current_host_id()
    and (f.status = 'task_created' or (f.status = 'rejected' and f.reject_reason = 'false_positive'))
  order by f.status = 'task_created' desc
  limit 1
  for update;
  if not found then
    raise exception 'Problem % was not made from a guest signal', p_problem_id
      using errcode = 'no_data_found', hint = 'serverErrors.signalProblemNotFromSignal';
  end if;
  if v_finding.status = 'rejected' then
    return v_finding;
  end if;

  -- The lock the dispatch levers take (20261003130000).
  select * into v_problem from public.problems
  where id = p_problem_id and host_id = public.current_host_id()
  for no key update;

  if coalesce(p_delete, false) then
    if v_problem.status <> 'open'
       or exists (select 1 from public.tasks t where t.problem_id = p_problem_id)
       or exists (select 1 from public.task_media m where m.problem_id = p_problem_id)
       or exists (select 1 from public.chat_threads c where c.problem_id = p_problem_id)
       or exists (select 1 from public.signal_findings f
                  where f.problem_id = p_problem_id and f.id <> v_finding.id) then
      raise exception 'Problem % has work on it; it can only be archived', p_problem_id
        using errcode = 'check_violation', hint = 'serverErrors.signalProblemHasWork';
    end if;
    v_action := 'deleted';
  else
    v_action := 'archived';
  end if;

  update public.signal_findings
  set status = 'rejected', reject_reason = 'false_positive', decided_mode = 'manager',
      decided_by = (select auth.uid()), decided_at = now()
  where id = v_finding.id;
  perform public.record_signal_feedback(v_finding.id, 'false_positive', v_action);

  if v_action = 'deleted' then
    -- The finding keeps its verdict; its link goes with the problem (on
    -- delete set null), and so do the problem's own journal rows. Its push
    -- not yet sent stays queued: claim_push_batch settles a problem_new
    -- whose problem is gone as skipped (20261003160000), and this function,
    -- callable by a manager, touches nothing in raw (table_grants.sql).
    delete from public.problems where id = p_problem_id;
  else
    -- As cancel_problem does: a repair left waiting for somebody goes too.
    update public.tasks t
    set status = 'cancelled'
    where t.problem_id = p_problem_id and t.status not in ('done', 'cancelled', 'expired');
    update public.problems
    set status       = case when status in ('open', 'assigned', 'in_progress')
                            then 'cancelled'::public.problem_status else status end,
        cancelled_at = case when status in ('open', 'assigned', 'in_progress')
                            then now() else cancelled_at end,
        archived_at  = coalesce(archived_at, now())
    where id = p_problem_id;
  end if;

  select * into v_finding from public.signal_findings where id = v_finding.id;
  return v_finding;
end;
$$;

/**
 * The company's switches. Null means "not part of this call", as in
 * update_host_settings. The gates (texts, model, tasks, the notice) are the
 * admin's: they follow the owner's actions, not a manager's preference. So is
 * auto (the owner's decision of 2026-10-17): only an admin puts a kind into
 * it, and only with its record (≥ 50 decisions, ≥ 90 % in 60 days); a
 * manager may take a kind out — a brake, never an accelerator.
 *
 * Texts off erases the texts kept so far, at once, with what was drawn from
 * them (the owner's decision of 2026-10-17), and takes the model off with
 * them unless the same call asks otherwise (which is then refused).
 *
 * One kind of signal a call (P4): `p_kind` null means "the reviews" — the
 * only kind loaded today, and what a caller that says nothing of a kind
 * means. The ceiling on auto's problems a day is a setting of its own (P9),
 * the admin's like the other ceilings.
 */
create or replace function public.update_signal_settings(
  p_sync_enabled        boolean default null,
  p_texts_enabled       boolean default null,
  p_tasks_enabled       boolean default null,
  p_model_enabled       boolean default null,
  p_auto_kinds          text[] default null,
  p_daily_model_cap     integer default null,
  p_min_confidence      numeric default null,
  p_notice_published_at timestamptz default null,
  p_daily_auto_cap      integer default null,
  p_kind                public.guest_signal_kind default null
)
returns public.signal_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host     uuid := public.current_host_id();
  v_signal   public.guest_signal_kind := coalesce(p_kind, 'review');
  v_row      public.signal_settings;
  v_kind     text;
  v_record   record;
  v_model    boolean;
  v_is_admin boolean := public.auth_role() = 'admin' and public.is_active_user();
begin
  if not public.is_manager() then
    raise exception 'Only a manager changes guest signal settings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;

  insert into public.signal_settings (host_id, kind) values (v_host, v_signal) on conflict do nothing;
  select * into v_row from public.signal_settings
  where host_id = v_host and kind = v_signal
  for update;

  -- The gates and the money are the admin's: the ceiling on model calls and
  -- the confidence floor decide what is paid for and what reaches people;
  -- auto decides what reaches a technician with nobody looking.
  if not v_is_admin and (p_texts_enabled is not null or p_model_enabled is not null
                         or p_tasks_enabled is not null or p_notice_published_at is not null
                         or p_daily_model_cap is not null or p_min_confidence is not null
                         or p_daily_auto_cap is not null
                         or (p_auto_kinds is not null and not (p_auto_kinds <@ v_row.auto_kinds))) then
    raise exception 'Only an admin switches the guest signal gates'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.signalGateAdminOnly';
  end if;

  -- The notice's date is set once, never ahead of now: moving it earlier would
  -- widen the stays whose texts are kept.
  if p_notice_published_at is not null then
    if p_notice_published_at > now()
       or (v_row.notice_published_at is not null
           and p_notice_published_at <> v_row.notice_published_at) then
      raise exception 'The notice date is set once and not in the future'
        using errcode = 'check_violation', hint = 'serverErrors.signalNoticeDateFixed';
    end if;
  end if;
  if coalesce(p_texts_enabled, v_row.texts_enabled)
     and coalesce(p_notice_published_at, v_row.notice_published_at) is null then
    raise exception 'Texts need the published guest notice'
      using errcode = 'check_violation', hint = 'serverErrors.signalTextsNeedNotice';
  end if;
  -- Texts off with nothing said about the model: the model goes off too, it
  -- would have nothing to read.
  v_model := case when p_texts_enabled is false and p_model_enabled is null then false
                  else coalesce(p_model_enabled, v_row.model_enabled) end;
  if v_model and not coalesce(p_texts_enabled, v_row.texts_enabled) then
    raise exception 'The model needs the texts switched on'
      using errcode = 'check_violation', hint = 'serverErrors.signalModelNeedsTexts';
  end if;

  if p_auto_kinds is not null then
    foreach v_kind in array p_auto_kinds loop
      if not (v_kind = any (array['repair', 'safety', 'pests', 'access'])) then
        raise exception 'Kind % never makes a problem', v_kind
          using errcode = 'check_violation', hint = 'serverErrors.signalKindNoTask',
                detail = jsonb_build_object('kind', v_kind)::text;
      end if;
      if not (v_kind = any (v_row.auto_kinds)) then
        select * into v_record
        from public.signal_finding_record(v_host, v_signal, v_kind::public.signal_finding_kind);
        if v_record.decisions < 50 or v_record.approved * 10 < v_record.decisions * 9 then
          raise exception 'Kind % has not earned auto yet', v_kind
            using errcode = 'check_violation', hint = 'serverErrors.signalAutoNotEarned',
                  detail = jsonb_build_object('kind', v_kind, 'decisions', v_record.decisions,
                                              'approved', v_record.approved)::text;
        end if;
      end if;
    end loop;
  end if;

  update public.signal_settings
  set sync_enabled        = coalesce(p_sync_enabled, sync_enabled),
      texts_enabled       = coalesce(p_texts_enabled, texts_enabled),
      tasks_enabled       = coalesce(p_tasks_enabled, tasks_enabled),
      model_enabled       = v_model,
      -- Each time the model goes on it reads back 14 days and no further (the
      -- owner's decision of 2026-10-18 for the first time; the same for a
      -- later one, so a month off never comes back as a month of cards).
      model_since         = case when v_model and not v_row.model_enabled
                                 then now() - interval '14 days' else model_since end,
      auto_kinds          = coalesce(p_auto_kinds, auto_kinds),
      daily_model_cap     = coalesce(p_daily_model_cap, daily_model_cap),
      daily_auto_cap      = coalesce(p_daily_auto_cap, daily_auto_cap),
      min_confidence      = coalesce(p_min_confidence, min_confidence),
      notice_published_at = coalesce(p_notice_published_at, notice_published_at),
      updated_by          = (select auth.uid())
  where host_id = v_host and kind = v_signal
  returning * into v_row;

  -- Texts off: what was kept goes now, not in 18 months. A load running at
  -- this moment stores nothing more (store_review_texts reads the switch);
  -- the nightly purge sweeps whatever raced it.
  if p_texts_enabled is false then
    perform public.erase_signal_texts(array(
      select g.id from public.guest_signals g where g.host_id = v_host and g.kind = v_signal));
  end if;

  -- A review that waited only for a reader this call took away (texts or
  -- the model off) is settled now: its stay goes to its month at once, not
  -- at the nightly sweep.
  perform public.cut_signal_stay_links(array(
    select g.id from public.guest_signals g
    where g.host_id = v_host and g.kind = v_signal and g.stay_exact));

  return v_row;
end;
$$;

-- ===================================================================
-- row security and grants (all steps)
-- ===================================================================

alter table public.guest_signals enable row level security;
alter table public.signal_findings enable row level security;
alter table public.signal_settings enable row level security;
alter table public.signal_feedback enable row level security;

revoke all on public.guest_signals, public.signal_findings, public.signal_settings,
  public.signal_feedback
  from public, anon, authenticated, service_role;
grant select on public.guest_signals, public.signal_findings, public.signal_settings
  to authenticated, service_role;
-- The verdicts are the readers' statistics: no screen reads them yet, and the
-- definer levers write them. No client may touch the table (no policy).
grant select on public.signal_feedback to service_role;

-- Manager and admin of the company only. The head technician and the
-- technicians see a problem's title and source_facts, never the guest's
-- signal (the owner's decision 3).
create policy "managers read guest signals"
  on public.guest_signals for select to authenticated
  using ((select public.is_manager()) and host_id = (select public.current_host_id()));

create policy "managers read signal findings"
  on public.signal_findings for select to authenticated
  using ((select public.is_manager()) and host_id = (select public.current_host_id()));

create policy "managers read signal settings"
  on public.signal_settings for select to authenticated
  using ((select public.is_manager()) and host_id = (select public.current_host_id()));

-- The jobs' functions: the service role only (they write raw.signal_runs or
-- decide for the company).
revoke all on function public.signal_sync_watermark(public.signal_provider, public.guest_signal_kind, uuid) from public, anon, authenticated;
revoke all on function public.ingest_guest_reviews(public.signal_provider, jsonb, timestamptz, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.apply_signal_findings(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.purge_signal_data() from public, anon, authenticated;
revoke all on function public.reserve_signal_model_calls(public.signal_provider, public.guest_signal_kind, integer, uuid) from public, anon, authenticated;
revoke all on function public.mark_signal_analysis_failed(uuid, text) from public, anon, authenticated;
revoke all on function public.log_signal_run(public.signal_provider, public.guest_signal_kind, text, boolean, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.signal_model_calls_left(public.guest_signal_kind, uuid) from public, anon, authenticated;
revoke all on function public.purge_signal_stays() from public, anon, authenticated;
revoke all on function public.review_load_state(public.signal_provider, text[], uuid) from public, anon, authenticated;
revoke all on function public.signal_buildings(public.signal_provider, uuid) from public, anon, authenticated;
grant execute on function public.signal_sync_watermark(public.signal_provider, public.guest_signal_kind, uuid) to service_role;
grant execute on function public.ingest_guest_reviews(public.signal_provider, jsonb, timestamptz, uuid, jsonb, jsonb) to service_role;
grant execute on function public.apply_signal_findings(uuid, text, text, jsonb) to service_role;
grant execute on function public.purge_signal_data() to service_role;
grant execute on function public.reserve_signal_model_calls(public.signal_provider, public.guest_signal_kind, integer, uuid) to service_role;
grant execute on function public.mark_signal_analysis_failed(uuid, text) to service_role;
grant execute on function public.log_signal_run(public.signal_provider, public.guest_signal_kind, text, boolean, jsonb, jsonb, uuid) to service_role;
grant execute on function public.signal_model_calls_left(public.guest_signal_kind, uuid) to service_role;
grant execute on function public.purge_signal_stays() to service_role;
grant execute on function public.review_load_state(public.signal_provider, text[], uuid) to service_role;
grant execute on function public.signal_buildings(public.signal_provider, uuid) to service_role;

-- Internal: called only from the functions above, which run as their owner.
revoke all on function public.store_review_texts(uuid, public.signal_provider, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.review_text_allowed(public.guest_signals, public.signal_settings) from public, anon, authenticated, service_role;
revoke all on function public.erase_signal_texts(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.signal_retention_ends(public.guest_signal_kind, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.signal_stay_link_ends(public.guest_signal_kind, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.signal_since(public.guest_signals) from public, anon, authenticated, service_role;
revoke all on function public.signal_place_id(public.signal_provider, text, text) from public, anon, authenticated, service_role;
revoke all on function public.resolve_signal_place(public.signal_provider, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.resolve_signal_reservation(public.signal_provider, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.cut_signal_stay_links(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.signal_month_of(timestamptz) from public, anon, authenticated, service_role;
-- Trigger functions: a trigger fires them whoever writes; nobody calls them.
revoke all on function public.guest_signals_touch() from public, anon, authenticated, service_role;
revoke all on function public.signal_findings_dates() from public, anon, authenticated, service_role;
revoke all on function public.create_signal_problem(uuid, text, jsonb, public.problem_priority, text, text) from public, anon, authenticated, service_role;
revoke all on function public.decide_signal_finding(uuid) from public, anon, authenticated, service_role;
revoke all on function public.signal_finding_record(uuid, public.guest_signal_kind, public.signal_finding_kind) from public, anon, authenticated, service_role;
revoke all on function public.signal_place_family(bigint) from public, anon, authenticated, service_role;
revoke all on function public.signal_open_twin(uuid) from public, anon, authenticated, service_role;
revoke all on function public.record_signal_feedback(uuid, public.signal_verdict, text) from public, anon, authenticated, service_role;
-- A constant list; the panel shows its words (panel.guests.subject.*).
revoke all on function public.signal_subjects() from public, anon;
grant execute on function public.signal_subjects() to authenticated, service_role;
revoke all on function public.signal_finding_gives_task(public.signal_finding_kind) from public, anon;
grant execute on function public.signal_finding_gives_task(public.signal_finding_kind) to authenticated, service_role;

-- The manager's buttons, and the card's list (manager-only inside).
revoke all on function public.approve_signal_finding(uuid, text, public.problem_priority, uuid, text, uuid, date) from public, anon;
revoke all on function public.add_signal_finding(uuid, public.signal_finding_kind, text, text, public.problem_priority, text, uuid, date) from public, anon;
revoke all on function public.reject_signal_finding(uuid, public.signal_reject_reason) from public, anon;
revoke all on function public.mark_signal_false_positive(uuid, boolean) from public, anon;
revoke all on function public.update_signal_settings(boolean, boolean, boolean, boolean, text[], integer, numeric, timestamptz, integer, public.guest_signal_kind) from public, anon;
revoke all on function public.signal_place_problems(uuid) from public, anon;
revoke all on function public.signal_run_status() from public, anon;
grant execute on function public.approve_signal_finding(uuid, text, public.problem_priority, uuid, text, uuid, date) to authenticated;
grant execute on function public.add_signal_finding(uuid, public.signal_finding_kind, text, text, public.problem_priority, text, uuid, date) to authenticated;
grant execute on function public.reject_signal_finding(uuid, public.signal_reject_reason) to authenticated;
grant execute on function public.mark_signal_false_positive(uuid, boolean) to authenticated;
grant execute on function public.update_signal_settings(boolean, boolean, boolean, boolean, text[], integer, numeric, timestamptz, integer, public.guest_signal_kind) to authenticated;
grant execute on function public.signal_place_problems(uuid) to authenticated;
grant execute on function public.signal_run_status() to authenticated;

-- ===================================================================
-- schedule (UTC). Away from the night window 03:00–04:40 (listings 03:00,
-- reservations 03:15, the sweeps until 03:50, media 04:30) and after the quiet
-- hours in Prague in both seasons: 06:00 UTC is 07:00 CET / 08:00 CEST, so a
-- problem made by the job never pushes into the night.
--
-- The two jobs that call the Edge Functions are created inactive: the owner
-- turns them on (cron.alter_job(…, active => true), docs §7) once the
-- functions are deployed and the pilot week is over. Each function checks its
-- own switch in signal_settings too, so a job turned on early does nothing.
-- The purges stay active: with no data they do nothing, and with data they
-- are what keeps the 89 days and the 18 months.
-- ===================================================================

select cron.schedule(
  'sync-guest-signals-daily',
  '0 6 * * *',
  $$select public.invoke_edge_function('sync-guest-signals')$$
);

select cron.schedule(
  'classify-guest-signals-daily',
  '20 6 * * *',
  $$select public.invoke_edge_function('classify-guest-signals')$$
);

select cron.alter_job(j.jobid, active => false)
from cron.job j
where j.jobname in ('sync-guest-signals-daily', 'classify-guest-signals-daily');

-- Stays cut to their month: settled since, or at their last day.
select cron.schedule(
  'purge-signal-stays',
  '0 5 * * *',
  $$select public.purge_signal_stays()$$
);

-- Texts and what was drawn from them; keys at their kind's end (18 months
-- for a review, 90 days for a message).
select cron.schedule(
  'purge-signal-data',
  '5 5 * * *',
  $$select public.purge_signal_data()$$
);

select cron.schedule(
  'purge-signal-runs',
  '10 5 * * *',
  $$delete from raw.signal_runs where ran_at < now() - interval '180 days'$$
);

-- The public API's registry (packages/shared/src/api/registry.json) reserves
-- the scopes this feature will be served under (P11: the guest signals'
-- scopes, reviews and messages alike); no key may hold a planned scope
-- (20261028100000).
-- api-scopes:begin
insert into public.api_scopes (id, scope_group, action, sensitivity, status, operator) values
  ('guest_signals:read', 'guest_signals', 'read', 'sensitive', 'planned', false),
  ('guest_signals:decide', 'guest_signals', 'write', 'normal', 'planned', true)
on conflict (id) do update
  set scope_group = excluded.scope_group,
      action      = excluded.action,
      sensitivity = excluded.sensitivity,
      status      = excluded.status,
      operator    = excluded.operator;
-- api-scopes:end
