-- Property quality (docs/property-intelligence-plan.md, stages 1 and 2): what
-- guests and staff keep saying about a place, by theme, beside the number of
-- stays it is said against.
--
-- One migration for the themes, the episodes, the reading of past reviews and
-- what the panel's «Качество объектов» reads, and nothing in it acts until
-- somebody switches it on: history_enabled is off, history_daily_cap is 0, and
-- both jobs are scheduled inactive.
--
-- The rules every part keeps:
--
-- - An episode carries no guest text and no guest id. A review older than the
--   texts' line is read once in the reading function's memory and leaves only
--   its labels (the owner's decision of 2026-11-06): the line itself
--   (review_text_allowed, store_review_texts, review_load_state) is not touched
--   by a single statement here.
--
-- - Only public reviews: signal_settings.history_include_private is a separate
--   switch, off, and no screen shows it.
--
-- - Staff texts never reach a model: problem_themes comes from the dictionary
--   (issue_theme_words) or a finding's subject. A side table, not a column of
--   problems: a nightly write there would move updated_at, which the public
--   API's updated_since and the panel read.
--
-- - The reading's budget is one-off and hard: the journal counts the worst case
--   of every call before it is made, and a CHECK keeps the ceiling at $5, so a
--   higher one takes a migration. It shares nothing with daily_model_cap, which
--   counts classify runs alone.
--
-- - Months and weeks are the stay's: the month the guest left in, like the
--   stays they are counted against. A week lives 90 days, then only the month
--   stays.

-- ===================================================================
-- Themes
-- ===================================================================

create type public.issue_layer as enum ('guest_review', 'guest_message', 'found_at_work', 'staff_report');

comment on type public.issue_layer is
  'Who said it: a guest in a review or a message, staff while working, staff on their own. Never summed into one number.';

create table public.issue_themes (
  -- Never renamed: merging themes goes through replaced_by, and a series keeps
  -- the old code. The words are panel.quality.themes.<code> in the locales.
  code        text primary key check (code ~ '^[a-z_]{2,40}$'),
  theme_group text not null check (theme_group in (
    'engineering', 'tech', 'access', 'cleanliness', 'comfort', 'surroundings', 'service', 'safety', 'other'
  )),
  sort_order  integer not null unique,
  -- Compared with the same window a year ago, never with the window before.
  is_seasonal boolean not null default false,
  replaced_by text references public.issue_themes (code) on delete restrict
);

comment on table public.issue_themes is
  'The closed list of themes a place can be talked about under. docs/property-intelligence-plan.md §2.1';

insert into public.issue_themes (code, theme_group, sort_order, is_seasonal) values
  ('heating',            'engineering',   10, true),
  ('hot_water',          'engineering',   20, false),
  ('air_conditioning',   'engineering',   30, true),
  ('plumbing',           'engineering',   40, false),
  ('drain_toilet',       'engineering',   50, false),
  ('shower_bath',        'engineering',   60, false),
  ('electric_light',     'engineering',   70, false),
  ('wifi',               'tech',          80, false),
  ('tv',                 'tech',          90, false),
  ('kettle',             'tech',         100, false),
  ('kitchen_appliance',  'tech',         110, false),
  ('laundry_appliance',  'tech',         120, false),
  ('appliance_other',    'tech',         130, false),
  ('checkin_access',     'access',       140, false),
  ('lock_door',          'access',       150, false),
  ('lift_stairs',        'access',       160, false),
  ('parking',            'access',       170, false),
  ('cleanliness',        'cleanliness',  180, false),
  ('smell',              'cleanliness',  190, false),
  ('pests',              'cleanliness',  200, false),
  ('mould_damp',         'cleanliness',  210, false),
  ('bed_comfort',        'comfort',      220, false),
  ('linen_towels',       'comfort',      230, false),
  ('furniture',          'comfort',      240, false),
  ('window_blind',       'comfort',      250, false),
  ('room_temperature',   'comfort',      260, true),
  ('supplies_amenities', 'comfort',      270, false),
  ('noise_outside',      'surroundings', 280, false),
  ('noise_neighbours',   'surroundings', 290, false),
  ('location',           'surroundings', 300, false),
  ('accuracy',           'service',      310, false),
  ('communication',      'service',      320, false),
  ('value',              'service',      330, false),
  ('safety',             'safety',       340, false),
  ('other',              'other',        350, false);

-- The dictionary for staff texts: a regular expression over the lower-cased
-- title and description. The lowest rank that matches wins, so the narrow
-- theme goes before the wide one (a blocked drain before plumbing).
create table public.issue_theme_words (
  theme   text not null references public.issue_themes (code) on delete cascade,
  rank    integer not null,
  pattern text not null check (char_length(pattern) between 2 and 400),
  primary key (theme, pattern)
);

comment on table public.issue_theme_words is
  'dict-v1: staff write these texts, and a model never reads them (the owner''s decision of 2026-11-06).';

insert into public.issue_theme_words (theme, rank, pattern) values
  ('hot_water',          10, 'горяч\w* вод|тепл\w* вод|бойлер|teplá voda|teplou vodu|bojler|boiler|hot water|water heater'),
  ('heating',            20, 'отоплен|батаре[ия]|термостат|radiátor|radiator|topení|heating'),
  ('air_conditioning',   20, 'кондиц|klimatiz|air.?con'),
  ('drain_toilet',       30, 'унитаз|\yслив|засор|сифон|záchod|toaleta|odpad|ucpan|toilet|\ydrain'),
  ('shower_bath',        40, '\yдуш|\yванн|sprch|\yvan[ay]\y|shower|\ybath'),
  ('plumbing',           50, 'протек|протечк|\yтеч[ьеи]|смесител|\yкран[аеу]?\y|kohout|\yleak|\ytap\y'),
  ('electric_light',     60, 'лампоч|розетк|электр|выключател|\yсвет[ае]?\y|žárovk|světl|zásuvk|elektr|\ybulb|socket'),
  ('wifi',               70, 'wi-?fi|вай.?фай|интернет|роутер|router|internet'),
  ('tv',                 80, 'телевизор|\yтв\y|\yпульт|televiz|ovladač|\ytv\y'),
  ('kettle',             90, 'чайник|konvice|kettle'),
  ('laundry_appliance', 100, 'стиральн|сушилк|сушильн|pračk|sušičk|washing machine|\ywasher|\ydryer'),
  ('kitchen_appliance', 110, 'посудомо|холодил|морозил|духовк|варочн|индукц|микроволн|кофемаш|тостер|вытяжк|\yплит[аеуы]\y|myčk|lednic|sporák|troub|indukc|mikrovln|kávovar|digestoř|dishwasher|fridge|\yoven|\ystove|microwave|coffee'),
  ('appliance_other',   120, 'пылесос|\yфен\y|утюг|vysavač|\yfén|žehličk|vacuum|hair ?dryer'),
  ('checkin_access',    130, 'lockbox|key ?box|ключниц|сейф для ключ'),
  ('lock_door',         140, 'замок|замк|\yключ|\yдвер|домофон|zámek|zámk|klíč|dveř|\ylock|\ydoor'),
  ('lift_stairs',       150, '\yлифт|výtah|elevator|\ylift\y'),
  ('parking',           160, 'парков|parkov'),
  ('pests',             170, 'таракан|\yклоп|\yмыш[ьи]|мурав|šváb|štěnic|\ymyš|mravenc|cockroach|bed ?bug'),
  ('mould_damp',        180, 'плесен|плесн|сырост|plísn|vlhk|\ymould|\ymold\y'),
  ('smell',             190, '\yзапах|воня|zápach|smrd|\ysmell|\yodou?r'),
  ('cleanliness',       200, 'грязн|\yпятн|špína|špinav|skvrn|\yflek|\ystain|dirty'),
  ('linen_towels',      210, 'полотенц|постельн|простын|наволоч|пододеяльн|ručník|povlečen|prostěradl|\ytowel|\ylinen|\ysheets\y'),
  ('bed_comfort',       220, 'матрас|кроват|подушк|matrac|postel|polštář|mattress|pillow|\ybed\y'),
  ('window_blind',      230, '\yокн[оаеу]|\yштор|жалюз|\yokn[oa]|žaluzi|závěs|\ywindow|\yblind|curtain'),
  ('furniture',         240, 'мебел|\yстул|\yстол\y|\yстол[аеу]\y|\yшкаф|\yдиван|\yполк[аиу]\y|židl|\ystůl|skřín|gauč|pohovk|\ychair|\ysofa|wardrobe'),
  ('supplies_amenities',250, 'шампун|\yмыло|туалетн\w* бумаг|toaletní papír|mýdl|šampon|toilet paper|\ysoap|shampoo'),
  ('safety',            260, 'пожар|\yдым|\yгаз\y|детектор|požár|\ykouř|\yplyn\y|smoke|\ygas\y');

-- ===================================================================
-- Episodes
-- ===================================================================

create table public.issue_facts (
  id            uuid primary key default gen_random_uuid(),
  host_id       uuid not null references public.hosts (id) on delete restrict,
  -- The listing: a room's episode goes to its building (signal_place_family).
  property_id   bigint not null references public.properties (id) on delete cascade,
  theme         text not null references public.issue_themes (code) on delete restrict,
  layer         public.issue_layer not null,
  severity      public.problem_priority not null default 'normal',
  confidence    numeric(3, 2) check (confidence between 0 and 1),
  -- The first of the month the guest left in, or the task was reported in.
  month         date not null check (extract(day from month) = 1),
  -- Its Monday, only while it is 90 days young; refresh_property_quality()
  -- clears it after.
  week          date check (extract(isodow from week) = 1),
  channel       public.signal_channel,
  -- A label leaves with the review it came from.
  signal_id     uuid references public.guest_signals (id) on delete cascade,
  problem_id    uuid references public.problems (id) on delete cascade,
  finding_id    uuid references public.signal_findings (id) on delete cascade,
  -- stream: rebuilt each night from findings and problems. history: written by
  -- the reading of past reviews, replaced week by week.
  origin        text not null check (origin in ('stream', 'history')),
  -- The week of the reading that wrote it: what a repeated reading replaces.
  history_slice date,
  -- 'claude-haiku-5-5@themes-v1', 'dict-v1', 'manual': a series lives inside
  -- one version.
  detector      text not null check (detector ~ '^[a-z0-9.@_-]{3,80}$'),
  created_at    timestamptz not null default now(),
  constraint issue_facts_history_has_a_slice check ((origin = 'history') = (history_slice is not null))
);

comment on table public.issue_facts is
  'One episode about one theme at one place: no guest text, no guest id. docs/property-intelligence-plan.md §4.2';

create index issue_facts_place_idx on public.issue_facts (host_id, property_id, month desc);
create index issue_facts_theme_idx on public.issue_facts (theme);
create index issue_facts_slice_idx on public.issue_facts (host_id, detector, history_slice)
  where origin = 'history';
create index issue_facts_signal_idx on public.issue_facts (signal_id) where signal_id is not null;
create index issue_facts_problem_idx on public.issue_facts (problem_id) where problem_id is not null;
create index issue_facts_finding_idx on public.issue_facts (finding_id) where finding_id is not null;

-- The theme of a problem, beside it: see the header for why not a column.
create table public.problem_themes (
  problem_id uuid primary key references public.problems (id) on delete cascade,
  theme      text not null references public.issue_themes (code) on delete restrict,
  source     text not null check (source in ('signal', 'dict', 'manual')),
  detector   text not null check (detector ~ '^[a-z0-9.@_-]{3,80}$'),
  updated_at timestamptz not null default now()
);

create index problem_themes_theme_idx on public.problem_themes (theme);

comment on table public.problem_themes is
  'The theme a problem is about: from its finding or the dictionary; a manager''s hand outranks both.';

-- Stays and nights a place had in a month, by channel: what an episode is
-- counted against. The reservations table keeps the sync window, not the year,
-- so this comes from the PMS. Ratings are not here: guest_signals holds them.
create table public.property_month_stats (
  host_id     uuid not null references public.hosts (id) on delete restrict,
  property_id bigint not null references public.properties (id) on delete cascade,
  month       date not null check (extract(day from month) = 1),
  channel     public.signal_channel not null,
  stays       integer not null check (stays >= 0),
  nights      integer not null check (nights >= 0),
  updated_at  timestamptz not null default now(),
  primary key (host_id, property_id, month, channel)
);

comment on table public.property_month_stats is
  'Stays and nights per place, month and channel, read from the PMS. Aggregates only.';

alter table public.issue_themes enable row level security;
alter table public.issue_theme_words enable row level security;
alter table public.issue_facts enable row level security;
alter table public.problem_themes enable row level security;
alter table public.property_month_stats enable row level security;

-- No client reads these directly: the panel goes through quality_overview and
-- quality_place, which check the role and the company.
revoke all on public.issue_themes, public.issue_theme_words, public.issue_facts,
  public.problem_themes, public.property_month_stats from public, anon, authenticated, service_role;

-- ===================================================================
-- The reading of past reviews: switches and journal
-- ===================================================================

alter table public.signal_settings
  -- Past reviews are read. Reviews only: a message never gets here.
  add column history_enabled          boolean not null default false,
  -- Months back a listing is read, at most 12 (the owner's decision of
  -- 2026-11-06). The adapter's own limit may be lower: the run takes the less.
  add column history_depth_months     integer not null default 12
                                      check (history_depth_months between 1 and 12),
  -- Private feedback joins the public text. Off; no screen sets it.
  add column history_include_private  boolean not null default false,
  -- Model calls of the reading in a Prague day. Its own, not daily_model_cap.
  add column history_daily_cap        integer not null default 0
                                      check (history_daily_cap between 0 and 3000),
  -- The reading's one-off ceiling, in millionths of a dollar. $5 is hard: above
  -- it takes a migration.
  add column history_budget_micro_usd bigint not null default 5000000
                                      check (history_budget_micro_usd between 0 and 5000000),
  add constraint signal_settings_history_is_reviews
    check (kind = 'review' or not (history_enabled or history_include_private));

-- Each attempt at one week of reviews or one month of stays. An attempt is
-- never rewritten by the next: the sum over this table is the money spent.
create table raw.signal_history_runs (
  id                 bigint generated always as identity primary key,
  host_id            uuid not null,
  provider           public.signal_provider not null,
  detector           text not null,
  part               text not null check (part in ('reviews', 'stays')),
  slice_start        date not null,
  slice_end          date not null,
  status             text not null check (status in ('running', 'done', 'failed')),
  reserved_calls     integer not null default 0 check (reserved_calls >= 0),
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0),
  -- Null while running, and for ever in a run the platform killed: it stays
  -- counted at its reservation.
  spent_micro_usd    bigint check (spent_micro_usd >= 0),
  -- Counts and codes only, never a review's text.
  counts             jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  errors             jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz
);

create index signal_history_runs_slice_idx
  on raw.signal_history_runs (host_id, provider, part, detector, slice_start);
create index signal_history_runs_started_idx on raw.signal_history_runs (host_id, started_at);
revoke all on raw.signal_history_runs from public, anon, authenticated;

/**
 * Money the reading has taken, in millionths of a dollar: what finished runs
 * reported, and for a run that is going or was killed, its whole reservation.
 *
 * Internal: no grants.
 */
create or replace function public.signal_history_spent(p_host uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coalesce(r.spent_micro_usd, r.reserved_micro_usd)), 0)::bigint
  from raw.signal_history_runs r
  where r.host_id = p_host and r.part = 'reviews'
$$;

/** The start of today in Prague, as the model's own ceiling counts its days. */
create or replace function public.signal_history_day_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('day', now() at time zone 'Europe/Prague') at time zone 'Europe/Prague'
$$;

/**
 * What the reading needs to know before it takes anything: the switches, the
 * texts' line as a Prague day, what is spent, and which weeks and months this
 * version has closed. Null when the company has no row of settings.
 */
create or replace function public.signal_history_state(
  p_provider public.signal_provider,
  p_detector text,
  p_host_id  uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled',          s.history_enabled,
    'depth_months',     s.history_depth_months,
    'include_private',  s.history_include_private,
    'daily_cap',        s.history_daily_cap,
    'budget_micro_usd', s.history_budget_micro_usd,
    'min_confidence',   s.min_confidence,
    'spent_micro_usd',  public.signal_history_spent(s.host_id),
    'calls_today',      (select coalesce(sum(r.reserved_calls), 0)
                         from raw.signal_history_runs r
                         where r.host_id = s.host_id and r.part = 'reviews'
                           and r.started_at >= public.signal_history_day_start()),
    'line',             (coalesce(s.notice_published_at, s.texts_enabled_at)
                         at time zone 'Europe/Prague')::date,
    'reviews_done',     (select coalesce(jsonb_agg(distinct r.slice_start), '[]'::jsonb)
                         from raw.signal_history_runs r
                         where r.host_id = s.host_id and r.provider = p_provider
                           and r.part = 'reviews' and r.detector = p_detector
                           and r.status = 'done'),
    'stays_done',       (select coalesce(jsonb_object_agg(x.slice_start, x.at), '{}'::jsonb)
                         from (select r.slice_start, max(r.finished_at) as at
                               from raw.signal_history_runs r
                               where r.host_id = s.host_id and r.provider = p_provider
                                 and r.part = 'stays' and r.status = 'done'
                               group by r.slice_start) x)
  )
  from public.signal_settings s
  where s.host_id = coalesce(p_host_id, public.default_host_id())
    and s.kind = 'review'
$$;

/**
 * Take the calls of one week before making them. One lock a company: two runs
 * never read the same week or both see the whole budget, and a run the
 * platform kills has already counted what it took. The whole week or nothing:
 * a week half read cannot be closed. The reason says what stopped it.
 *
 * `p_worst_micro_usd` is the worst case of one call, the caller's to know:
 * it knows the model's price and its max_tokens.
 */
create or replace function public.reserve_signal_history(
  p_provider        public.signal_provider,
  p_detector        text,
  p_slice_start     date,
  p_slice_end       date,
  p_calls           integer,
  p_worst_micro_usd bigint,
  p_host_id         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host   uuid := coalesce(p_host_id, public.default_host_id());
  v_set    public.signal_settings;
  v_worst  bigint := greatest(coalesce(p_calls, 0), 0)::bigint * greatest(coalesce(p_worst_micro_usd, 0), 0);
  v_today  bigint;
  v_run_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('signal-history:' || v_host, 0));

  select * into v_set from public.signal_settings s where s.host_id = v_host and s.kind = 'review';
  if not found or not v_set.history_enabled then
    return jsonb_build_object('granted', false, 'reason', 'off');
  end if;

  if exists (select 1 from raw.signal_history_runs r
             where r.host_id = v_host and r.part = 'reviews' and r.status = 'running'
               and r.started_at > now() - interval '15 minutes') then
    return jsonb_build_object('granted', false, 'reason', 'busy');
  end if;

  select coalesce(sum(r.reserved_calls), 0) into v_today
  from raw.signal_history_runs r
  where r.host_id = v_host and r.part = 'reviews'
    and r.started_at >= public.signal_history_day_start();
  if v_today + greatest(coalesce(p_calls, 0), 0) > v_set.history_daily_cap then
    return jsonb_build_object('granted', false, 'reason', 'daily_cap');
  end if;

  if public.signal_history_spent(v_host) + v_worst > v_set.history_budget_micro_usd then
    return jsonb_build_object('granted', false, 'reason', 'budget');
  end if;

  insert into raw.signal_history_runs (host_id, provider, detector, part, slice_start, slice_end,
                                       status, reserved_calls, reserved_micro_usd)
  values (v_host, p_provider, p_detector, 'reviews', p_slice_start, p_slice_end,
          'running', greatest(coalesce(p_calls, 0), 0), v_worst)
  returning id into v_run_id;

  return jsonb_build_object('granted', true, 'run_id', v_run_id);
end;
$$;

/**
 * A week read to its end: its labels replace what this version wrote for the
 * week, and the journal gets what it really cost, in one transaction. Repeating
 * a week adds nothing.
 *
 * `p_facts` is a JSON array of labels, the PMS's own ids and the review's key:
 * {external_listing_id, external_key, theme, severity, confidence, channel,
 * departure_date}. A place this company does not hold, a test listing or an
 * unknown theme is counted and left out, never stored.
 */
create or replace function public.complete_signal_history(
  p_run_id          bigint,
  p_facts           jsonb,
  p_spent_micro_usd bigint,
  p_counts          jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run      raw.signal_history_runs;
  v_inserted integer;
  v_given    integer := coalesce(jsonb_array_length(p_facts), 0);
begin
  select * into v_run from raw.signal_history_runs r where r.id = p_run_id for update;
  if not found or v_run.status <> 'running' then
    raise exception 'History run % is not running', p_run_id
      using errcode = 'invalid_parameter_value';
  end if;

  delete from public.issue_facts f
  where f.host_id = v_run.host_id and f.origin = 'history'
    and f.detector = v_run.detector and f.history_slice = v_run.slice_start;

  insert into public.issue_facts (host_id, property_id, theme, layer, severity, confidence, month,
                                  week, channel, signal_id, origin, history_slice, detector)
  select v_run.host_id,
         public.signal_place_family(p.id),
         x.theme,
         'guest_review',
         coalesce(x.severity, 'normal')::public.problem_priority,
         x.confidence,
         date_trunc('month', x.departure_date::timestamp)::date,
         case when x.departure_date >= current_date - 90
              then date_trunc('week', x.departure_date::timestamp)::date end,
         x.channel::public.signal_channel,
         (select g.id from public.guest_signals g
          where g.host_id = v_run.host_id and g.provider = v_run.provider and g.kind = 'review'
            and g.external_key = x.external_key),
         'history',
         v_run.slice_start,
         v_run.detector
  from jsonb_to_recordset(coalesce(p_facts, '[]'::jsonb)) as x (
    external_listing_id text, external_key text, theme text, severity text,
    confidence numeric, channel text, departure_date date
  )
  join public.issue_themes t on t.code = x.theme
  join lateral (
    select public.resolve_signal_place(v_run.provider, v_run.host_id, x.external_listing_id) as id
  ) p on p.id is not null
  where x.departure_date is not null
    and not public.analytics_is_test_listing(p.id);
  get diagnostics v_inserted = row_count;

  update raw.signal_history_runs r
  set status = 'done',
      spent_micro_usd = greatest(coalesce(p_spent_micro_usd, r.reserved_micro_usd), 0),
      counts = coalesce(p_counts, '{}'::jsonb)
               || jsonb_build_object('labels', v_inserted, 'labels_left_out', v_given - v_inserted),
      finished_at = now()
  where r.id = p_run_id;

  return jsonb_build_object('labels', v_inserted, 'labels_left_out', v_given - v_inserted);
end;
$$;

/** A week that could not be finished: it stays open, and what it cost stays counted. */
create or replace function public.fail_signal_history(
  p_run_id          bigint,
  p_spent_micro_usd bigint,
  p_counts          jsonb default '{}'::jsonb,
  p_errors          jsonb default '[]'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update raw.signal_history_runs r
  set status = 'failed',
      spent_micro_usd = greatest(coalesce(p_spent_micro_usd, r.reserved_micro_usd), 0),
      counts = coalesce(p_counts, '{}'::jsonb),
      errors = coalesce(p_errors, '[]'::jsonb),
      finished_at = now()
  where r.id = p_run_id and r.status = 'running'
$$;

/**
 * A month of stays from the PMS replaces the month: nothing to add twice, and a
 * place with no stay left in it loses its row. `p_rows` is a JSON array of
 * {external_listing_id, channel, stays, nights}, by the PMS's own ids; a listing
 * this company does not hold is left out. The rooms' stays go to their building.
 */
create or replace function public.replace_property_month_stays(
  p_provider public.signal_provider,
  p_month    date,
  p_rows     jsonb,
  p_host_id  uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host     uuid := coalesce(p_host_id, public.default_host_id());
  v_inserted integer;
begin
  if p_month is null or extract(day from p_month) <> 1 then
    raise exception 'A month starts on its first day, not %', p_month
      using errcode = 'invalid_parameter_value';
  end if;

  delete from public.property_month_stats s where s.host_id = v_host and s.month = p_month;

  insert into public.property_month_stats (host_id, property_id, month, channel, stays, nights)
  select v_host, public.signal_place_family(p.id), p_month, x.channel::public.signal_channel,
         sum(x.stays), sum(x.nights)
  from jsonb_to_recordset(coalesce(p_rows, '[]'::jsonb)) as x (
    external_listing_id text, channel text, stays integer, nights integer
  )
  join lateral (
    select public.resolve_signal_place(p_provider, v_host, x.external_listing_id) as id
  ) p on p.id is not null
  where not public.analytics_is_test_listing(p.id)
  group by 2, 4;
  get diagnostics v_inserted = row_count;

  insert into raw.signal_history_runs (host_id, provider, detector, part, slice_start, slice_end,
                                       status, spent_micro_usd, counts, finished_at)
  values (v_host, p_provider, 'stays-v1', 'stays', p_month,
          (p_month + interval '1 month' - interval '1 day')::date, 'done', 0,
          jsonb_build_object('rows', v_inserted), now());

  return v_inserted;
end;
$$;

-- ===================================================================
-- Themes of findings and problems, and the nightly refresh
-- ===================================================================

/** The theme of a finding: its subject when that says enough, else its kind. A wish is no complaint. */
create or replace function public.issue_theme_of_finding(
  p_kind    public.signal_finding_kind,
  p_subject text
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case p_subject
           when 'hot_water'        then 'hot_water'
           when 'heating'          then 'heating'
           when 'air_conditioning' then 'air_conditioning'
           when 'plumbing_leak'    then 'plumbing'
           when 'drain_toilet'     then 'drain_toilet'
           when 'electric'         then 'electric_light'
           when 'appliance'        then 'appliance_other'
           when 'internet_tv'      then 'wifi'
           when 'lock_door'        then 'lock_door'
           when 'window_blind'     then 'window_blind'
           when 'furniture'        then 'furniture'
           when 'mould_damp'       then 'mould_damp'
           else case p_kind
                  when 'safety'        then 'safety'
                  when 'pests'         then 'pests'
                  when 'access'        then 'checkin_access'
                  when 'cleaning'      then 'cleanliness'
                  when 'supplies'      then 'supplies_amenities'
                  when 'noise'         then 'noise_outside'
                  when 'neighbourhood' then 'location'
                  when 'wish'          then null
                  else 'other'
                end
         end
$$;

/** The dictionary's theme of a staff text, or null when no word matches. */
create or replace function public.issue_theme_of_text(p_text text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select w.theme
  from public.issue_theme_words w
  where lower(p_text) ~ w.pattern
  order by w.rank, w.theme
  limit 1
$$;

/**
 * The nightly job (06:40 UTC, scheduled inactive): new problems get their theme,
 * the stream's episodes are rebuilt from what findings and problems say now — a
 * rejected finding or a cancelled problem is gone from them by the next morning
 * — and weeks older than 90 days give way to their month. Only derived rows are
 * written; a text is read here by the dictionary alone.
 */
create or replace function public.refresh_property_quality(p_host_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host     uuid := coalesce(p_host_id, public.default_host_id());
  v_themed   integer;
  v_facts    integer;
  v_folded   integer;
begin
  insert into public.problem_themes (problem_id, theme, source, detector)
  select x.id, x.theme, x.source, x.detector
  from (
    select pr.id,
           coalesce(public.issue_theme_of_finding(f.kind, f.subject),
                    public.issue_theme_of_text(pr.title || ' ' || coalesce(pr.description, ''))) as theme,
           case when public.issue_theme_of_finding(f.kind, f.subject) is not null
                then 'signal' else 'dict' end as source,
           case when public.issue_theme_of_finding(f.kind, f.subject) is not null
                then f.detector else 'dict-v1' end as detector
    from public.problems pr
    left join public.signal_findings f on f.problem_id = pr.id
    where pr.host_id = v_host
      and not exists (select 1 from public.problem_themes t where t.problem_id = pr.id)
  ) x
  where x.theme is not null
  on conflict (problem_id) do nothing;
  get diagnostics v_themed = row_count;

  delete from public.issue_facts f where f.host_id = v_host and f.origin = 'stream';

  insert into public.issue_facts (host_id, property_id, theme, layer, severity, confidence, month,
                                  week, channel, signal_id, finding_id, origin, detector)
  select v_host,
         public.signal_place_family(f.property_id),
         public.issue_theme_of_finding(f.kind, f.subject),
         'guest_review',
         f.urgency,
         f.confidence,
         date_trunc('month', d.day::timestamp)::date,
         case when g.stay_exact and d.day >= current_date - 90
              then date_trunc('week', d.day::timestamp)::date end,
         g.channel,
         g.id,
         f.id,
         'stream',
         f.detector
  from public.signal_findings f
  join public.guest_signals g on g.id = f.signal_id
  cross join lateral (
    select coalesce(g.departure_date, (g.submitted_at at time zone 'Europe/Prague')::date) as day
  ) d
  where f.host_id = v_host
    and f.property_id is not null
    and g.kind = 'review'
    and f.status not in ('rejected', 'dropped')
    and public.issue_theme_of_finding(f.kind, f.subject) is not null;
  get diagnostics v_facts = row_count;

  insert into public.issue_facts (host_id, property_id, theme, layer, severity, month, week,
                                  problem_id, origin, detector)
  select v_host,
         public.signal_place_family(pr.property_id),
         t.theme,
         case when pr.task_id is not null then 'found_at_work' else 'staff_report' end::public.issue_layer,
         pr.priority,
         date_trunc('month', d.day::timestamp)::date,
         case when d.day >= current_date - 90 then date_trunc('week', d.day::timestamp)::date end,
         pr.id,
         'stream',
         t.detector
  from public.problems pr
  join public.problem_themes t on t.problem_id = pr.id
  cross join lateral (select (pr.created_at at time zone 'Europe/Prague')::date as day) d
  where pr.host_id = v_host
    and pr.property_id is not null
    -- What a guest said is the finding's episode; the problem made of it is the answer.
    and pr.source = 'staff'
    and pr.status <> 'cancelled'
    and (pr.archived_at is null or (pr.status = 'resolved' and pr.resolved_at <= pr.archived_at));
  get diagnostics v_folded = row_count;
  v_facts := v_facts + v_folded;

  update public.issue_facts f set week = null
  where f.host_id = v_host and f.week is not null and f.week < current_date - 90;
  get diagnostics v_folded = row_count;

  return jsonb_build_object('themed', v_themed, 'facts', v_facts, 'folded', v_folded);
end;
$$;

-- ===================================================================
-- What the panel reads
-- ===================================================================

/**
 * A window as what is stored can answer it. The short windows are counted in
 * weeks, from the Monday of the week their first day falls in; the long ones in
 * calendar months with the present one, so twelve months never need more
 * history than the twelve months read. The window before has the same length.
 */
create or replace function public.quality_bounds(p_window text, p_today date)
returns table (grain text, from_day date, prev_from date, prev_to date)
language sql
immutable
set search_path = ''
as $$
  with w as (
    select case p_window when '14d' then 14 when '1m' then 30 end as days,
           case p_window when '3m' then 3 when '6m' then 6 when '12m' then 12 end as months
  ),
  f as (
    select w.days, w.months,
           case when w.days is not null
                then date_trunc('week', (p_today - (w.days - 1))::timestamp)::date
                else (date_trunc('month', p_today::timestamp)
                      - make_interval(months => w.months - 1))::date
           end as from_day
    from w
    where w.days is not null or w.months is not null
  )
  select case when f.days is not null then 'week' else 'month' end,
         f.from_day,
         case when f.days is not null
              then f.from_day - ((f.days + 6) / 7) * 7
              else (f.from_day - make_interval(months => f.months))::date
         end,
         f.from_day - 1
  from f
$$;

/** The manager of the company alone, and a window we know. Returns the company. */
create or replace function public.quality_guard(p_window text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'Property quality is for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if p_window is null or p_window not in ('14d', '1m', '3m', '6m', '12m') then
    raise exception 'A quality window is one of 14d, 1m, 3m, 6m, 12m, not %', p_window
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.qualityWindowInvalid';
  end if;
  return public.current_host_id();
end;
$$;

/**
 * The places of a window, one object each: stays beside ratings. Stays of the
 * short windows are counted from the bookings we hold, the long ones from the
 * months read from the PMS. A rating knows its month only, so the short windows
 * show the ratings of three months, and the screen says so.
 *
 * Internal: no grants.
 */
create or replace function public.quality_place_rows(
  p_host       uuid,
  p_today      date,
  p_grain      text,
  p_from       date,
  p_prev_from  date,
  p_prev_to    date,
  p_rate_from  date,
  p_rate_prev_from date,
  p_rate_prev_to   date,
  p_property   bigint
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with places as (
    select p.id, p.name, p.city
    from public.properties p
    where p.host_id = p_host
      and p.parent_id is null
      and not public.analytics_is_test_listing(p.id)
      and (case when p_property is null then p.status <> 'archived' else p.id = p_property end)
  ),
  stays as (
    select s.property_id,
           sum(s.stays) filter (where s.month >= p_from) as cur,
           sum(s.stays) filter (where s.month between p_prev_from and p_prev_to) as prev
    from public.property_month_stats s
    where s.host_id = p_host and p_grain = 'month'
    group by s.property_id
    union all
    select c.listing_id,
           count(*) filter (where c.departure_date >= p_from),
           count(*) filter (where c.departure_date <= p_prev_to)
    from public.analytics_checkout_rows(p_host, p_prev_from, p_today, null, false, false) c
    where p_grain = 'week'
    group by c.listing_id
  ),
  ratings as (
    select coalesce(l.parent_id, l.id) as property_id,
           count(*) filter (where m.month >= p_rate_from) as n,
           avg(g.rating) filter (where m.month >= p_rate_from) as average,
           count(*) filter (where m.month between p_rate_prev_from and p_rate_prev_to) as n_prev,
           avg(g.rating) filter (where m.month between p_rate_prev_from and p_rate_prev_to) as average_prev
    from public.guest_signals g
    join public.properties l on l.id = g.property_id
    cross join lateral (
      select date_trunc('month', coalesce(g.departure_date,
                                          (g.submitted_at at time zone 'Europe/Prague')::date)::timestamp)::date as month
    ) m
    where g.host_id = p_host and g.kind = 'review' and not g.is_hidden and g.rating is not null
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'name', p.name,
           'city', p.city,
           'stays', coalesce(s.cur, 0),
           'stays_prev', coalesce(s.prev, 0),
           'rating_n', coalesce(r.n, 0),
           'rating_avg', round(r.average, 2),
           'rating_n_prev', coalesce(r.n_prev, 0),
           'rating_avg_prev', round(r.average_prev, 2)
         ) order by p.name), '[]'::jsonb)
  from places p
  left join stays s on s.property_id = p.id
  left join ratings r on r.property_id = p.id
$$;

/**
 * Every place and theme with something to say, one object each: the episodes of
 * the window and the one before by layer, the numbers the state of the theme is
 * read from (packages/shared/src/quality), and the work on it. An episode of a
 * review hidden since is not shown. Messages stay out until stage 9 (their
 * switch).
 *
 * Internal: no grants.
 */
create or replace function public.quality_theme_rows(
  p_host      uuid,
  p_today     date,
  p_grain     text,
  p_from      date,
  p_prev_from date,
  p_prev_to   date,
  p_property  bigint
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with facts as (
    select f.property_id, f.theme, f.layer,
           coalesce(f.week, f.month) as day,
           case when p_grain = 'week' then f.week >= p_from else f.month >= p_from end as is_cur,
           case when p_grain = 'week' then f.week between p_prev_from and p_prev_to
                else f.month between p_prev_from and p_prev_to end as is_prev
    from public.issue_facts f
    left join public.guest_signals g on g.id = f.signal_id
    where f.host_id = p_host
      and f.layer <> 'guest_message'
      and not coalesce(g.is_hidden, false)
      and not public.analytics_is_test_listing(f.property_id)
      and (p_property is null or f.property_id = p_property)
  ),
  said as (
    select x.property_id, x.theme,
           count(*) filter (where x.is_cur and x.layer = 'guest_review') as reviews,
           count(*) filter (where x.is_prev and x.layer = 'guest_review') as reviews_prev,
           count(*) filter (where x.is_cur and x.layer = 'found_at_work') as found,
           count(*) filter (where x.is_prev and x.layer = 'found_at_work') as found_prev,
           count(*) filter (where x.is_cur and x.layer = 'staff_report') as reported,
           count(*) filter (where x.is_prev and x.layer = 'staff_report') as reported_prev,
           count(*) filter (where x.day >= p_today - 90) as recent,
           count(*) filter (where x.day between p_today - 360 and p_today - 91) as older,
           max(x.day) as last_on
    from facts x
    group by x.property_id, x.theme
  ),
  work as (
    select coalesce(l.parent_id, l.id) as property_id, t.theme,
           count(*) filter (where pr.status not in ('resolved', 'cancelled') and pr.archived_at is null)
             as open_work,
           count(*) filter (where pr.created_at >= p_today - 180) as work_180,
           (max(pr.resolved_at) at time zone 'Europe/Prague')::date as closed_on
    from public.problem_themes t
    join public.problems pr on pr.id = t.problem_id
    join public.properties l on l.id = pr.property_id
    where pr.host_id = p_host
      and pr.status <> 'cancelled'
      and (p_property is null or coalesce(l.parent_id, l.id) = p_property)
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'property_id', s.property_id,
           'theme', s.theme,
           'seasonal', th.is_seasonal,
           'reviews', s.reviews,
           'reviews_prev', s.reviews_prev,
           'found', s.found,
           'found_prev', s.found_prev,
           'reported', s.reported,
           'reported_prev', s.reported_prev,
           'recent', s.recent,
           'older', s.older,
           'last_on', s.last_on,
           'open_work', coalesce(w.open_work, 0),
           'work_180', coalesce(w.work_180, 0),
           'closed_on', w.closed_on
         ) order by s.property_id, th.sort_order), '[]'::jsonb)
  from said s
  join public.issue_themes th on th.code = s.theme
  left join work w on w.property_id = s.property_id and w.theme = s.theme
$$;

/** Where the reading of past reviews stands, for the panel's band. No money, no codes. */
create or replace function public.quality_history_state(p_host uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', coalesce((select s.history_enabled from public.signal_settings s
                         where s.host_id = p_host and s.kind = 'review'), false),
    'weeks_done', (select count(distinct r.slice_start) from raw.signal_history_runs r
                   where r.host_id = p_host and r.part = 'reviews' and r.status = 'done'),
    'weeks_total', (select (r.counts ->> 'weeks_total')::integer from raw.signal_history_runs r
                    where r.host_id = p_host and r.part = 'reviews' and r.status = 'done'
                      and r.counts ? 'weeks_total'
                    order by r.finished_at desc limit 1),
    'stay_months', (select count(distinct s.month) from public.property_month_stats s
                    where s.host_id = p_host),
    'stays_from', (select min(s.month) from public.property_month_stats s where s.host_id = p_host),
    'last_read_at', (select max(r.finished_at) from raw.signal_history_runs r
                     where r.host_id = p_host and r.part = 'reviews' and r.status = 'done')
  )
$$;

/** What every answer shares: the window's days, how far the data reaches. */
create or replace function public.quality_meta(
  p_host   uuid,
  p_window text,
  p_today  date,
  p_b_grain text,
  p_b_from  date,
  p_b_prev_from date,
  p_b_prev_to   date,
  p_rate_from   date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'window', p_window,
    'today', p_today,
    'grain', p_b_grain,
    'from', p_b_from,
    'prev_from', p_b_prev_from,
    'prev_to', p_b_prev_to,
    'rating_from', p_rate_from,
    -- Before this day there is no record of repairs: an old episode cannot be
    -- called unanswered.
    'work_from', (select (min(pr.created_at) at time zone 'Europe/Prague')::date
                  from public.problems pr where pr.host_id = p_host),
    'history', public.quality_history_state(p_host)
  )
$$;

/** «Качество объектов»: the portfolio of one window. */
create or replace function public.quality_overview(p_window text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host  uuid := public.quality_guard(p_window);
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_b     record;
  v_rate  record;
begin
  select * into v_b from public.quality_bounds(p_window, v_today);
  select * into v_rate
  from public.quality_bounds(case when v_b.grain = 'week' then '3m' else p_window end, v_today);

  return public.quality_meta(v_host, p_window, v_today, v_b.grain, v_b.from_day, v_b.prev_from,
                             v_b.prev_to, v_rate.from_day)
    || jsonb_build_object(
         'places', public.quality_place_rows(v_host, v_today, v_b.grain, v_b.from_day, v_b.prev_from,
                                             v_b.prev_to, v_rate.from_day, v_rate.prev_from,
                                             v_rate.prev_to, null),
         'themes', public.quality_theme_rows(v_host, v_today, v_b.grain, v_b.from_day, v_b.prev_from,
                                             v_b.prev_to, null));
end;
$$;

/**
 * One place in one window: what quality_overview says of it, the months of its
 * themes, and its ratings by channel and category beside those of its city. A
 * place of another company, a room or a test listing is no place here: null.
 */
create or replace function public.quality_place(p_property_id bigint, p_window text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host  uuid := public.quality_guard(p_window);
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_city  text;
  v_b     record;
  v_rate  record;
  v_year  date := (date_trunc('month', v_today::timestamp) - interval '11 months')::date;
begin
  select p.city into v_city
  from public.properties p
  where p.id = p_property_id and p.host_id = v_host and p.parent_id is null
    and not public.analytics_is_test_listing(p.id);
  if not found then
    return null;
  end if;

  select * into v_b from public.quality_bounds(p_window, v_today);
  select * into v_rate
  from public.quality_bounds(case when v_b.grain = 'week' then '3m' else p_window end, v_today);

  return public.quality_meta(v_host, p_window, v_today, v_b.grain, v_b.from_day, v_b.prev_from,
                             v_b.prev_to, v_rate.from_day)
    || jsonb_build_object(
         'place', public.quality_place_rows(v_host, v_today, v_b.grain, v_b.from_day, v_b.prev_from,
                                            v_b.prev_to, v_rate.from_day, v_rate.prev_from,
                                            v_rate.prev_to, p_property_id) -> 0,
         'themes', public.quality_theme_rows(v_host, v_today, v_b.grain, v_b.from_day, v_b.prev_from,
                                             v_b.prev_to, p_property_id),
         'months', (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'month', x.month, 'theme', x.theme, 'layer', x.layer, 'n', x.n
                  ) order by x.month, x.theme, x.layer), '[]'::jsonb)
           from (select f.month, f.theme, f.layer, count(*) as n
                 from public.issue_facts f
                 left join public.guest_signals g on g.id = f.signal_id
                 where f.host_id = v_host and f.property_id = p_property_id
                   and f.month >= v_year and f.layer <> 'guest_message'
                   and not coalesce(g.is_hidden, false)
                 group by 1, 2, 3) x),
         'channels', (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'channel', x.channel, 'n', x.n, 'average', x.average
                  ) order by x.n desc), '[]'::jsonb)
           from (select g.channel, count(*) as n, round(avg(g.rating), 2) as average
                 from public.guest_signals g
                 join public.properties l on l.id = g.property_id
                 where g.host_id = v_host and g.kind = 'review' and not g.is_hidden
                   and g.rating is not null and coalesce(l.parent_id, l.id) = p_property_id
                   and coalesce(g.departure_date, (g.submitted_at at time zone 'Europe/Prague')::date)
                       >= v_rate.from_day
                 group by g.channel) x),
         'categories', (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'key', x.key, 'n', x.n, 'average', x.average,
                    'city_n', x.city_n, 'city_average', x.city_average
                  ) order by x.key), '[]'::jsonb)
           from (select c.key,
                        count(*) filter (where o.id = p_property_id) as n,
                        round(avg(c.value::numeric) filter (where o.id = p_property_id), 2) as average,
                        count(*) filter (where o.id <> p_property_id) as city_n,
                        round(avg(c.value::numeric) filter (where o.id <> p_property_id), 2) as city_average
                 from public.guest_signals g
                 join public.properties l on l.id = g.property_id
                 join public.properties o on o.id = coalesce(l.parent_id, l.id)
                 cross join lateral jsonb_each_text(g.category_ratings) c
                 where g.host_id = v_host and g.kind = 'review' and not g.is_hidden
                   and (o.id = p_property_id or o.city is not distinct from v_city)
                   and not public.analytics_is_test_listing(o.id)
                   and coalesce(g.departure_date, (g.submitted_at at time zone 'Europe/Prague')::date)
                       >= v_rate.from_day
                 group by c.key
                 having count(*) filter (where o.id = p_property_id) > 0) x));
end;
$$;

-- ===================================================================
-- Privileges
-- ===================================================================

revoke all on function public.signal_history_spent(uuid) from public, anon, authenticated, service_role;
revoke all on function public.signal_history_day_start() from public, anon, authenticated, service_role;
revoke all on function public.signal_history_state(public.signal_provider, text, uuid) from public, anon, authenticated;
revoke all on function public.reserve_signal_history(public.signal_provider, text, date, date, integer, bigint, uuid) from public, anon, authenticated;
revoke all on function public.complete_signal_history(bigint, jsonb, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.fail_signal_history(bigint, bigint, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.replace_property_month_stays(public.signal_provider, date, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.refresh_property_quality(uuid) from public, anon, authenticated;
grant execute on function public.signal_history_state(public.signal_provider, text, uuid) to service_role;
grant execute on function public.reserve_signal_history(public.signal_provider, text, date, date, integer, bigint, uuid) to service_role;
grant execute on function public.complete_signal_history(bigint, jsonb, bigint, jsonb) to service_role;
grant execute on function public.fail_signal_history(bigint, bigint, jsonb, jsonb) to service_role;
grant execute on function public.replace_property_month_stays(public.signal_provider, date, jsonb, uuid) to service_role;
grant execute on function public.refresh_property_quality(uuid) to service_role;

-- Internal: no grants.
revoke all on function public.issue_theme_of_finding(public.signal_finding_kind, text) from public, anon, authenticated, service_role;
revoke all on function public.issue_theme_of_text(text) from public, anon, authenticated, service_role;
revoke all on function public.quality_bounds(text, date) from public, anon, authenticated, service_role;
revoke all on function public.quality_guard(text) from public, anon, authenticated, service_role;
revoke all on function public.quality_place_rows(uuid, date, text, date, date, date, date, date, date, bigint) from public, anon, authenticated, service_role;
revoke all on function public.quality_theme_rows(uuid, date, text, date, date, date, bigint) from public, anon, authenticated, service_role;
revoke all on function public.quality_history_state(uuid) from public, anon, authenticated, service_role;
revoke all on function public.quality_meta(uuid, text, date, text, date, date, date, date) from public, anon, authenticated, service_role;

revoke all on function public.quality_overview(text) from public, anon;
revoke all on function public.quality_place(bigint, text) from public, anon;
grant execute on function public.quality_overview(text) to authenticated;
grant execute on function public.quality_place(bigint, text) to authenticated;

-- ===================================================================
-- Jobs: both inactive; each is turned on by its own word. Neither runs inside
-- 03:00–04:40 UTC, and the reading checks its own switch in signal_settings too,
-- so a job turned on early does nothing.
-- ===================================================================

select cron.schedule(
  'refresh-property-quality',
  '40 6 * * *',
  $$select public.refresh_property_quality()$$
);

select cron.schedule(
  'read-signal-history-tick',
  '*/10 7-21 * * *',
  $$select public.invoke_edge_function('read-signal-history')$$
);

select cron.alter_job(j.jobid, active => false)
from cron.job j
where j.jobname in ('refresh-property-quality', 'read-signal-history-tick');
