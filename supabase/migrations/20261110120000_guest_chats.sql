-- Guest messages (chats) behind one switch — docs/guest-chats.md.
--
-- The owner's decision of 2026-11-10: the lawyer and a notice to guests are not
-- waited for; chats are built whole and shipped off. One switch,
-- signal_settings.messages_enabled on the company's 'message' row, turns all of
-- it on (the word «включай чаты») and off again:
--
-- - Ingest: the webhook already journals every guest message without its text
--   (hostaway-webhook, stage 2). collect_guest_message_events() reads the
--   journal from where it stopped and queues the conversation
--   (raw.signal_message_queue: the PMS's ids and times, never a text). A poll of
--   the PMS's conversations once an hour is the net under a missed webhook.
-- - Reading: read-guest-messages, every two minutes outside 03:00–04:40 UTC,
--   claims conversations quiet for five minutes (or waiting fifteen), reads the
--   guest's new messages of the stay from the PMS in memory, redacts them and
--   asks the model for themes from the same 35 (themes-v1, the reading of past
--   reviews). Only the labels are stored: no text, no quotation, no summary.
-- - Cards: a theme a technician can fix becomes a finding of the existing «Гости»
--   section, decided by the existing rules. Confirm only: a problem is made by a
--   manager's click (signal_settings_messages_need_a_person: no automatic kind
--   for messages).
-- - Money: one reading is one call, booked before it is made against the
--   message row's daily_model_cap and two ceilings in money of its own (a day
--   and a month), journaled in raw.signal_message_runs. Reviews, their history
--   and its $5 are not touched.
-- - «Качество объектов»: a chat's themes are episodes of the layer
--   guest_message (origin 'message'), one per conversation and theme, counted
--   apart from reviews (quality_theme_rows: messages, messages_prev) and only
--   while the switch is on.
--
-- Off: the function stops at its first question, the screens stop showing
-- message cards and chat counts, and docs/one-off-writes/guest-chats-off.sql
-- empties the queue and stops the jobs. Nothing is deleted: the labels stay
-- hidden; docs/one-off-writes/guest-chats-labels-wipe.sql removes them by word.
--
-- Additive: new columns with defaults, three raw tables, new functions, two of
-- the panel's functions recreated with the same signature, three jobs (the
-- reading ones inactive). No existing row changes.

-- ===================================================================
-- Switch and ceilings
-- ===================================================================

alter table public.signal_settings
  -- The one switch of chats (the 'message' row only).
  add column messages_enabled               boolean not null default false,
  -- When it was last turned on: the journal is read from shortly before it.
  add column messages_enabled_at            timestamptz,
  -- Money a Prague day and a calendar month may take, in millionths of a dollar.
  -- The calls a day are daily_model_cap of the same row.
  add column message_daily_budget_micro_usd bigint not null default 250000
                                            check (message_daily_budget_micro_usd between 0 and 1000000),
  add column message_month_budget_micro_usd bigint not null default 5000000
                                            check (message_month_budget_micro_usd between 0 and 5000000),
  add constraint signal_settings_messages_switch_on_messages
    check (kind = 'message' or not messages_enabled),
  -- A chat never makes a problem on its own: no kind of it goes automatically,
  -- and a manager confirms every card (approve_signal_finding, which asks
  -- tasks_enabled of the row: guest-chats-on.sql turns it on with the switch).
  add constraint signal_settings_messages_need_a_person
    check (kind = 'review' or auto_kinds = '{}'::text[]);

-- ===================================================================
-- What a message signal and its card keep
-- ===================================================================

alter table public.guest_signals
  -- When in the stay the guest wrote: the day of arrival, the stay, the day of
  -- departure. Messages only; others are never read.
  add column stay_phase text check (stay_phase in ('arrival_day', 'stay', 'departure_day')),
  add constraint guest_signals_phase_is_a_message check (kind = 'message' or stay_phase is null);

alter table public.signal_findings
  -- The PMS's id of the conversation, for a manager to find it: until 30 days
  -- after the decision and never past the 89th day (the owner's decision 10 of
  -- 2026-10-31). purge_guest_message_links() clears it.
  add column external_conversation_id text check (external_conversation_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  add column conversation_link_ends   date,
  add constraint signal_findings_link_has_an_end
    check (external_conversation_id is null or conversation_link_ends is not null);

-- ===================================================================
-- Episodes from chats
-- ===================================================================

alter table public.issue_facts drop constraint issue_facts_origin_check;
alter table public.issue_facts
  add constraint issue_facts_origin_check check (origin in ('stream', 'history', 'message')),
  -- The conversation, keyed as guest_signals keys it: one episode a theme. Gone
  -- after 90 days (purge_guest_message_links), the episode stays.
  add column conversation_key text check (conversation_key ~ '^[0-9a-f]{64}$'),
  add constraint issue_facts_message_is_a_chat check ((origin = 'message') = (layer = 'guest_message')),
  add constraint issue_facts_chat_has_no_signal check (origin <> 'message' or signal_id is null);

create unique index issue_facts_one_per_chat_theme
  on public.issue_facts (host_id, conversation_key, theme)
  where conversation_key is not null;

-- ===================================================================
-- Queue and journal (raw: never exposed, no text anywhere)
-- ===================================================================

create table raw.signal_message_queue (
  host_id                  uuid not null,
  provider                 public.signal_provider not null,
  external_conversation_id text not null check (external_conversation_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  external_listing_id      text not null check (external_listing_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  external_reservation_id  text check (external_reservation_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  -- waiting: a guest wrote and nobody read it; reading: claimed by a tick;
  -- idle: read up to read_to.
  state                    text not null default 'waiting' check (state in ('waiting', 'reading', 'idle')),
  via                      text not null check (via in ('webhook', 'poll')),
  -- The first unread message's arrival and the latest: five minutes of quiet,
  -- fifteen at most (the owner's decision 12 of 2026-10-31).
  first_waiting_at         timestamptz,
  last_event_at            timestamptz not null,
  claimed_at               timestamptz,
  -- The guest's messages up to here are read.
  read_to                  timestamptz,
  attempts                 integer not null default 0 check (attempts >= 0),
  last_error               text check (last_error ~ '^[a-z0-9_.:-]{1,80}$'),
  updated_at               timestamptz not null default now(),
  primary key (host_id, provider, external_conversation_id)
);

create index signal_message_queue_due_idx on raw.signal_message_queue (host_id, provider, state, last_event_at);

create table raw.signal_message_state (
  host_id        uuid not null,
  provider       public.signal_provider not null,
  -- The webhook journal's id up to which message events were looked at.
  events_seen_id bigint,
  polled_at      timestamptz,
  primary key (host_id, provider)
);

-- One reading of one conversation is one model call. The sum is the money.
create table if not exists raw.signal_message_runs (
  id                 bigint generated always as identity primary key,
  host_id            uuid not null,
  provider           public.signal_provider not null,
  detector           text not null,
  status             text not null check (status in ('running', 'done', 'failed')),
  reserved_micro_usd bigint not null default 0 check (reserved_micro_usd >= 0),
  spent_micro_usd    bigint check (spent_micro_usd >= 0),
  counts             jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  errors             jsonb not null default '[]'::jsonb check (jsonb_typeof(errors) = 'array'),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz
);

create index if not exists signal_message_runs_started_idx on raw.signal_message_runs (host_id, started_at);

revoke all on raw.signal_message_queue, raw.signal_message_state, raw.signal_message_runs
  from public, anon, authenticated;

-- ===================================================================
-- Functions
-- ===================================================================

/**
 * The finding a theme of a chat makes: kind and subject of signal_findings, or
 * null for a theme no technician fixes (noise, value, location, ...). Only the
 * kinds that make a problem are named here (signal_finding_gives_task).
 *
 * Internal: no grants.
 */
create or replace function public.message_theme_finding(p_theme text)
returns text[]
language sql
immutable
strict
set search_path = ''
as $$
  select case p_theme
           when 'heating'           then array['repair', 'heating']
           when 'hot_water'         then array['repair', 'hot_water']
           when 'air_conditioning'  then array['repair', 'air_conditioning']
           when 'plumbing'          then array['repair', 'plumbing_leak']
           when 'shower_bath'       then array['repair', 'plumbing_leak']
           when 'drain_toilet'      then array['repair', 'drain_toilet']
           when 'electric_light'    then array['repair', 'electric']
           when 'wifi'              then array['repair', 'internet_tv']
           when 'tv'                then array['repair', 'internet_tv']
           when 'kettle'            then array['repair', 'appliance']
           when 'kitchen_appliance' then array['repair', 'appliance']
           when 'laundry_appliance' then array['repair', 'appliance']
           when 'appliance_other'   then array['repair', 'appliance']
           when 'window_blind'      then array['repair', 'window_blind']
           when 'furniture'         then array['repair', 'furniture']
           when 'bed_comfort'       then array['repair', 'furniture']
           when 'mould_damp'        then array['repair', 'mould_damp']
           when 'checkin_access'    then array['access', 'other']
           when 'lock_door'         then array['access', 'lock_door']
           when 'pests'             then array['pests', 'other']
           when 'safety'            then array['safety', 'other']
         end
$$;

/** The start of this calendar month in Prague. Internal: no grants. */
create or replace function public.signal_message_month_start()
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select date_trunc('month', now() at time zone 'Europe/Prague') at time zone 'Europe/Prague'
$$;

/**
 * What read-guest-messages asks first: the switch, the ceilings and what is
 * spent of them, the floor of confidence, whether the poll is due. Null when the
 * company has no 'message' row (chats were never turned on).
 */
create or replace function public.guest_message_state(
  p_provider public.signal_provider,
  p_host_id  uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled',        s.messages_enabled,
    'daily_cap',      s.daily_model_cap,
    'daily_budget',   s.message_daily_budget_micro_usd,
    'month_budget',   s.message_month_budget_micro_usd,
    'min_confidence', s.min_confidence,
    'calls_today',    (select count(*) from raw.signal_message_runs r
                       where r.host_id = s.host_id and r.started_at >= public.signal_history_day_start()),
    'spent_today',    (select coalesce(sum(coalesce(r.spent_micro_usd, r.reserved_micro_usd)), 0)
                       from raw.signal_message_runs r
                       where r.host_id = s.host_id and r.started_at >= public.signal_history_day_start()),
    'spent_month',    (select coalesce(sum(coalesce(r.spent_micro_usd, r.reserved_micro_usd)), 0)
                       from raw.signal_message_runs r
                       where r.host_id = s.host_id and r.started_at >= public.signal_message_month_start()),
    'poll_due',       coalesce((select m.polled_at < now() - interval '55 minutes'
                                from raw.signal_message_state m
                                where m.host_id = s.host_id and m.provider = p_provider), true)
  )
  from public.signal_settings s
  where s.host_id = coalesce(p_host_id, public.default_host_id())
    and s.kind = 'message'
$$;

/**
 * Our listing of a PMS listing a guest wrote about, when the company works it:
 * not archived, not the test band. Null otherwise.
 *
 * Internal: no grants.
 */
create or replace function public.guest_message_place(
  p_provider public.signal_provider,
  p_host_id  uuid,
  p_listing  text
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from public.properties p
  where p.id = public.resolve_signal_place(p_provider, p_host_id, p_listing)
    and p.status <> 'archived'
    and not public.analytics_is_test_listing(p.id)
$$;

/**
 * The guest messages the webhook journaled since the last look, as conversations
 * to read: one row a conversation, whatever number of messages. The journal keeps
 * the routing fields only (hostaway-webhook/guest-message.ts). The first look
 * starts two hours back, never at the month the journal holds. A listing the
 * company does not work is not queued. Returns how many conversations were queued.
 */
create or replace function public.collect_guest_message_events(
  p_provider public.signal_provider,
  p_host_id  uuid default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid := coalesce(p_host_id, public.default_host_id());
  v_seen bigint;
  v_top  bigint;
  v_n    integer := 0;
begin
  if not coalesce((select s.messages_enabled from public.signal_settings s
                   where s.host_id = v_host and s.kind = 'message'), false) then
    return 0;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('guest-messages:collect:' || v_host, 0));

  select m.events_seen_id into v_seen
  from raw.signal_message_state m
  where m.host_id = v_host and m.provider = p_provider;
  if v_seen is null then
    select coalesce(max(e.id), 0) into v_seen
    from raw.webhook_events e
    where e.received_at < now() - interval '2 hours';
  end if;
  select coalesce(max(e.id), v_seen) into v_top from raw.webhook_events e;

  with events as (
    select e.received_at,
           e.payload -> 'data' ->> 'conversationId' as conversation,
           e.payload -> 'data' ->> 'listingMapId' as listing,
           e.payload -> 'data' ->> 'reservationId' as booking
    from raw.webhook_events e
    where e.id > v_seen and e.id <= v_top
      -- A switch turned on again after weeks must not queue the weeks.
      and e.received_at > now() - interval '1 day'
      and e.source = p_provider::text
      and (e.object_type ~* 'message' or e.event_type ~* '^(message|conversation)')
      and e.payload -> 'data' ->> 'isIncoming' in ('1', 'true')
  ),
  conversations as (
    select x.conversation, max(x.listing) as listing, max(x.booking) as booking,
           min(x.received_at) as first_at, max(x.received_at) as last_at
    from events x
    where x.conversation ~ '^[A-Za-z0-9_-]{1,64}$'
      and x.listing ~ '^[A-Za-z0-9_-]{1,64}$'
    group by x.conversation
  ),
  queued as (
    insert into raw.signal_message_queue as q (
      host_id, provider, external_conversation_id, external_listing_id, external_reservation_id,
      state, via, first_waiting_at, last_event_at)
    select v_host, p_provider, c.conversation, c.listing,
           case when c.booking ~ '^[A-Za-z0-9_-]{1,64}$' then c.booking end,
           'waiting', 'webhook', c.first_at, c.last_at
    from conversations c
    where public.guest_message_place(p_provider, v_host, c.listing) is not null
    on conflict (host_id, provider, external_conversation_id) do update
      set state = case when q.state = 'reading' then 'reading' else 'waiting' end,
          first_waiting_at = case when q.state = 'waiting' then coalesce(q.first_waiting_at, excluded.first_waiting_at)
                                  else excluded.first_waiting_at end,
          last_event_at = greatest(q.last_event_at, excluded.last_event_at),
          external_reservation_id = coalesce(excluded.external_reservation_id, q.external_reservation_id),
          updated_at = now()
    returning 1
  )
  select count(*) into v_n from queued;

  insert into raw.signal_message_state as m (host_id, provider, events_seen_id)
  values (v_host, p_provider, v_top)
  on conflict (host_id, provider) do update set events_seen_id = excluded.events_seen_id;

  return v_n;
end;
$$;

/**
 * The poll's answer: conversations the guest wrote in lately, by the PMS's ids.
 * One whose latest guest message the queue has not seen is queued, and counted
 * as missed by the webhook when no event came for it at all. `p_rows`: JSON
 * array of {external_conversation_id, external_listing_id,
 * external_reservation_id, last_guest_at}.
 */
create or replace function public.queue_polled_conversations(
  p_provider public.signal_provider,
  p_rows     jsonb,
  p_host_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host   uuid := coalesce(p_host_id, public.default_host_id());
  v_queued integer := 0;
  v_missed integer := 0;
begin
  if not coalesce((select s.messages_enabled from public.signal_settings s
                   where s.host_id = v_host and s.kind = 'message'), false) then
    return jsonb_build_object('queued', 0, 'missed', 0);
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Polled conversations must be a JSON array'
      using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('guest-messages:collect:' || v_host, 0));

  with rows as (
    select x.external_conversation_id as conversation, x.external_listing_id as listing,
           case when x.external_reservation_id ~ '^[A-Za-z0-9_-]{1,64}$'
                then x.external_reservation_id end as booking,
           x.last_guest_at as at
    from jsonb_to_recordset(p_rows) as x (external_conversation_id text, external_listing_id text,
                                          external_reservation_id text, last_guest_at timestamptz)
    where x.external_conversation_id ~ '^[A-Za-z0-9_-]{1,64}$'
      and x.external_listing_id ~ '^[A-Za-z0-9_-]{1,64}$'
      and x.last_guest_at is not null
      and x.last_guest_at > now() - interval '1 day'
  ),
  unseen as (
    select r.*, q.external_conversation_id is null as missed
    from rows r
    left join raw.signal_message_queue q
      on q.host_id = v_host and q.provider = p_provider and q.external_conversation_id = r.conversation
    where (q.external_conversation_id is null
           or (greatest(q.last_event_at, coalesce(q.read_to, q.last_event_at)) < r.at - interval '1 minute'))
      and public.guest_message_place(p_provider, v_host, r.listing) is not null
  ),
  queued as (
    insert into raw.signal_message_queue as q (
      host_id, provider, external_conversation_id, external_listing_id, external_reservation_id,
      state, via, first_waiting_at, last_event_at)
    select v_host, p_provider, u.conversation, u.listing, u.booking, 'waiting', 'poll', u.at, u.at
    from unseen u
    on conflict (host_id, provider, external_conversation_id) do update
      set state = case when q.state = 'reading' then 'reading' else 'waiting' end,
          first_waiting_at = case when q.state = 'waiting' then coalesce(q.first_waiting_at, excluded.first_waiting_at)
                                  else excluded.first_waiting_at end,
          last_event_at = greatest(q.last_event_at, excluded.last_event_at),
          external_reservation_id = coalesce(excluded.external_reservation_id, q.external_reservation_id),
          updated_at = now()
    returning 1
  )
  select (select count(*) from queued), (select count(*) from unseen where missed)
    into v_queued, v_missed;

  insert into raw.signal_message_state as m (host_id, provider, polled_at)
  values (v_host, p_provider, now())
  on conflict (host_id, provider) do update set polled_at = excluded.polled_at;

  return jsonb_build_object('queued', v_queued, 'missed', v_missed);
end;
$$;

/**
 * Conversations due for reading, claimed for this tick: quiet for five minutes,
 * or waiting fifteen however busy, or claimed by a tick that died ten minutes
 * ago. Oldest wait first. A JSON array of {external_conversation_id,
 * external_listing_id, external_reservation_id, read_to}.
 */
create or replace function public.claim_guest_conversations(
  p_provider public.signal_provider,
  p_limit    integer,
  p_host_id  uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid := coalesce(p_host_id, public.default_host_id());
  v_out  jsonb;
begin
  if not coalesce((select s.messages_enabled from public.signal_settings s
                   where s.host_id = v_host and s.kind = 'message'), false) then
    return '[]'::jsonb;
  end if;

  with due as (
    select q.external_conversation_id
    from raw.signal_message_queue q
    where q.host_id = v_host and q.provider = p_provider
      and ((q.state = 'waiting'
            and (q.last_event_at <= now() - interval '5 minutes'
                 or q.first_waiting_at <= now() - interval '15 minutes'))
           or (q.state = 'reading' and q.claimed_at < now() - interval '10 minutes'))
    order by coalesce(q.first_waiting_at, q.last_event_at), q.external_conversation_id
    limit greatest(coalesce(p_limit, 0), 0)
    for update skip locked
  ),
  claimed as (
    update raw.signal_message_queue q
    set state = 'reading', claimed_at = now(), attempts = q.attempts + 1, updated_at = now()
    from due
    where q.host_id = v_host and q.provider = p_provider
      and q.external_conversation_id = due.external_conversation_id
    returning q.external_conversation_id, q.external_listing_id, q.external_reservation_id, q.read_to,
              coalesce(q.first_waiting_at, q.last_event_at) as waiting_since
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'external_conversation_id', c.external_conversation_id,
           'external_listing_id', c.external_listing_id,
           'external_reservation_id', c.external_reservation_id,
           'read_to', c.read_to) order by c.waiting_since), '[]'::jsonb)
    into v_out
  from claimed c;
  return v_out;
end;
$$;

/**
 * The stay a conversation belongs to, as our tables hold it: our listing (and
 * the room, when the PMS names one inside it), the booking and its days. A
 * message is read only inside its stay (the owner's decision 5 of 2026-10-31):
 * without a booking we hold, nothing is read. Null when the listing is not ours
 * to read.
 */
create or replace function public.guest_conversation_stay(
  p_provider    public.signal_provider,
  p_listing     text,
  p_unit        text,
  p_reservation text,
  p_host_id     uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with h as (select coalesce(p_host_id, public.default_host_id()) as id),
  place as (
    select public.guest_message_place(p_provider, h.id, p_listing) as listing,
           case when p_unit is not null
                then public.resolve_signal_place(p_provider, h.id, p_listing, p_unit) end as room,
           h.id as host
    from h
  )
  select case when p.listing is null then null else jsonb_build_object(
           'property_id', p.listing,
           'room_id', p.room,
           'reservation_id', r.id,
           'arrival_date', r.arrival_date,
           'departure_date', r.departure_date,
           'cancelled', coalesce(r.status = 'cancelled' or r.is_block, false)
         ) end
  from place p
  left join public.reservations r
    on r.id = public.resolve_signal_reservation(p_provider, p.host, p_reservation)
   and r.host_id = p.host
$$;

/**
 * Book one reading — one model call — before making it, under one lock a
 * company: the calls of a Prague day (daily_model_cap of the 'message' row), the
 * money of the day and of the month by the worst case of a call. A run the
 * platform kills stays counted at its reservation. The reason says what stopped.
 */
create or replace function public.reserve_guest_message_reading(
  p_provider        public.signal_provider,
  p_detector        text,
  p_worst_micro_usd bigint,
  p_host_id         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host  uuid := coalesce(p_host_id, public.default_host_id());
  v_set   public.signal_settings;
  v_worst bigint := greatest(coalesce(p_worst_micro_usd, 0), 0);
  v_calls bigint;
  v_day   bigint;
  v_month bigint;
  v_id    bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('guest-messages:money:' || v_host, 0));

  select * into v_set from public.signal_settings s where s.host_id = v_host and s.kind = 'message';
  if not found or not v_set.messages_enabled then
    return jsonb_build_object('granted', false, 'reason', 'off');
  end if;

  select count(*),
         coalesce(sum(coalesce(r.spent_micro_usd, r.reserved_micro_usd)), 0)
    into v_calls, v_day
  from raw.signal_message_runs r
  where r.host_id = v_host and r.started_at >= public.signal_history_day_start();
  if v_calls + 1 > v_set.daily_model_cap then
    return jsonb_build_object('granted', false, 'reason', 'daily_cap');
  end if;
  if v_day + v_worst > v_set.message_daily_budget_micro_usd then
    return jsonb_build_object('granted', false, 'reason', 'daily_budget');
  end if;

  select coalesce(sum(coalesce(r.spent_micro_usd, r.reserved_micro_usd)), 0) into v_month
  from raw.signal_message_runs r
  where r.host_id = v_host and r.started_at >= public.signal_message_month_start();
  if v_month + v_worst > v_set.message_month_budget_micro_usd then
    return jsonb_build_object('granted', false, 'reason', 'month_budget');
  end if;

  insert into raw.signal_message_runs (host_id, provider, detector, status, reserved_micro_usd)
  values (v_host, p_provider, p_detector, 'running', v_worst)
  returning id into v_id;
  return jsonb_build_object('granted', true, 'run_id', v_id);
end;
$$;

/** A reading that did not finish: what it cost stays counted, with codes only. */
create or replace function public.fail_guest_message_reading(
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
  update raw.signal_message_runs r
  set status = 'failed',
      spent_micro_usd = greatest(coalesce(p_spent_micro_usd, r.reserved_micro_usd), 0),
      counts = coalesce(p_counts, '{}'::jsonb),
      errors = coalesce(p_errors, '[]'::jsonb),
      finished_at = now()
  where r.id = p_run_id and r.status = 'running'
$$;

/**
 * A conversation done with for now: read up to `p_read_to` (null — nothing new
 * was read), or failed with a code. A guest who wrote again while it was read
 * puts it back in the queue; a failure waits five quiet minutes and gives up
 * after five attempts (idle, with its code).
 */
create or replace function public.finish_guest_conversation(
  p_provider        public.signal_provider,
  p_conversation_id text,
  p_read_to         timestamptz,
  p_error           text default null,
  p_host_id         uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  update raw.signal_message_queue q
  set read_to = case when p_read_to is null then q.read_to else greatest(coalesce(q.read_to, p_read_to), p_read_to) end,
      state = case when p_error is not null and q.attempts >= 5 then 'idle'
                   when p_error is not null then 'waiting'
                   when q.last_event_at > coalesce(q.claimed_at, q.last_event_at) then 'waiting'
                   else 'idle' end,
      -- A failure starts its wait again: five quiet minutes before the next try.
      first_waiting_at = case when p_error is not null and q.attempts < 5 then now()
                              when p_error is null and q.last_event_at > coalesce(q.claimed_at, q.last_event_at)
                                then q.last_event_at
                              end,
      last_event_at = case when p_error is not null then greatest(q.last_event_at, now()) else q.last_event_at end,
      attempts = case when p_error is null then 0 else q.attempts end,
      last_error = case when p_error ~ '^[a-z0-9_.:-]{1,80}$' then p_error
                        when p_error is not null then 'unknown' end,
      claimed_at = null,
      updated_at = now()
  where q.host_id = coalesce(p_host_id, public.default_host_id())
    and q.provider = p_provider
    and q.external_conversation_id = p_conversation_id
$$;

/**
 * One conversation's reading, applied in one transaction: the guest's new
 * messages of the stay become message signals (keys only), the labels become
 * episodes of the chat layer, the themes a technician fixes become cards
 * decided by the existing rules, and the queue moves on.
 *
 * - `p_conversation`: {external_conversation_id, conversation_key,
 *   external_listing_id, external_unit_id, external_reservation_id, channel}.
 * - `p_messages`: JSON array of {external_key, external_id, sent_at, phase,
 *   attachments} — the guest's messages of the stay read now, keyed by
 *   read-guest-messages (HMAC); the text never comes here.
 * - `p_labels`: JSON array of {theme, severity, confidence, resolved}; empty
 *   when nothing was sent to the model (no names to redact, nothing with words).
 *
 * Repeats add nothing: a message is met by its key, an episode by its
 * conversation and theme, a card waiting about the same kind and subject in the
 * same conversation is joined, not doubled. A card is decided by
 * decide_signal_finding: below the floor, said fixed, already open or solved
 * since — the rules of the reviews; never automatic (the 'message' row keeps
 * tasks off). Without the switch nothing is stored.
 */
create or replace function public.apply_guest_message_reading(
  p_provider        public.signal_provider,
  p_conversation    jsonb,
  p_messages        jsonb,
  p_labels          jsonb,
  p_detector        text,
  p_read_to         timestamptz,
  p_run_id          bigint default null,
  p_spent_micro_usd bigint default null,
  p_counts          jsonb default '{}'::jsonb,
  p_host_id         uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host     uuid := coalesce(p_host_id, public.default_host_id());
  v_set      public.signal_settings;
  v_run      raw.signal_message_runs;
  v_conv_id  text := p_conversation ->> 'external_conversation_id';
  v_conv_key text := p_conversation ->> 'conversation_key';
  v_listing  text := p_conversation ->> 'external_listing_id';
  v_unit     text := p_conversation ->> 'external_unit_id';
  v_booking  text := p_conversation ->> 'external_reservation_id';
  v_channel  public.signal_channel;
  v_stay     jsonb;
  v_place    bigint;
  v_room     bigint;
  v_family   bigint;
  v_ids      uuid[];
  v_latest   public.guest_signals;
  v_day      date;
  v_labels   integer := 0;
  v_unsure   integer := 0;
  v_joined   integer := 0;
  v_new      integer := 0;
  v_finding  uuid;
  v_status   public.signal_finding_status;
  v_label    record;
  v_pair     text[];
  v_counts   jsonb := '{}'::jsonb;
begin
  select * into v_set from public.signal_settings s where s.host_id = v_host and s.kind = 'message';
  if not found or not v_set.messages_enabled then
    raise exception 'Chats are off'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.signalMessagesOff';
  end if;
  if v_conv_key is null or v_conv_key !~ '^[0-9a-f]{64}$'
     or v_conv_id is null or v_conv_id !~ '^[A-Za-z0-9_-]{1,64}$'
     or jsonb_typeof(p_messages) is distinct from 'array'
     or jsonb_typeof(coalesce(p_labels, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'A conversation''s reading is malformed'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.signalFindingsInvalid';
  end if;
  v_channel := case when p_conversation ->> 'channel' = any (enum_range(null::public.signal_channel)::text[])
                    then (p_conversation ->> 'channel')::public.signal_channel else 'other' end;

  if p_run_id is not null then
    select * into v_run from raw.signal_message_runs r where r.id = p_run_id for update;
    if not found or v_run.status <> 'running' or v_run.host_id <> v_host then
      raise exception 'Message reading % is not running', p_run_id
        using errcode = 'invalid_parameter_value';
    end if;
  end if;

  v_stay := public.guest_conversation_stay(p_provider, v_listing, v_unit, v_booking, v_host);
  v_place := (v_stay ->> 'property_id')::bigint;
  v_room := (v_stay ->> 'room_id')::bigint;

  if v_place is not null and jsonb_array_length(p_messages) > 0 then
    with rows as (
      select x.*
      from jsonb_to_recordset(p_messages) as x (external_key text, external_id text, sent_at timestamptz,
                                                phase text, attachments integer)
      where x.external_key ~ '^[0-9a-f]{64}$'
        and x.sent_at is not null
        and x.phase in ('arrival_day', 'stay', 'departure_day')
    ),
    stored as (
      insert into public.guest_signals as g (
        host_id, provider, kind, external_key, conversation_key, external_id, external_listing_id,
        external_unit_id, property_id, room_id, external_reservation_id, reservation_id, channel,
        arrival_date, departure_date, submitted_at, stay_phase)
      select v_host, p_provider, 'message', r.external_key, v_conv_key,
             case when r.external_id ~ '^[A-Za-z0-9_-]{1,64}$' then r.external_id end,
             v_listing, v_unit, v_place, v_room,
             case when v_booking ~ '^[A-Za-z0-9_-]{1,64}$' then v_booking end,
             (v_stay ->> 'reservation_id')::bigint, v_channel,
             (v_stay ->> 'arrival_date')::date, (v_stay ->> 'departure_date')::date,
             r.sent_at, r.phase
      from rows r
      on conflict (host_id, provider, kind, external_key) do nothing
      returning g.id
    )
    select coalesce(array_agg(id), '{}') into v_ids from stored;
    v_new := cardinality(v_ids);

    -- The card and the episodes hang on the newest of the messages read now.
    select g.* into v_latest
    from public.guest_signals g
    where g.host_id = v_host and g.provider = p_provider and g.kind = 'message'
      and g.external_key in (select x ->> 'external_key' from jsonb_array_elements(p_messages) x)
    order by g.submitted_at desc, g.id
    limit 1;
  end if;

  if v_latest.id is not null then
    v_day := (v_latest.submitted_at at time zone 'Europe/Prague')::date;
    v_family := public.signal_place_family(coalesce(v_room, v_place));

    for v_label in
      select x.theme, x.severity, least(greatest(coalesce(x.confidence, 0), 0), 1) as confidence,
             coalesce(x.resolved, false) as resolved
      from jsonb_to_recordset(coalesce(p_labels, '[]'::jsonb))
             as x (theme text, severity text, confidence numeric, resolved boolean)
      join public.issue_themes t on t.code = x.theme
    loop
      if v_label.confidence < v_set.min_confidence then
        v_unsure := v_unsure + 1;
        continue;
      end if;

      insert into public.issue_facts as f (host_id, property_id, theme, layer, severity, confidence,
                                           month, week, channel, origin, detector, conversation_key)
      values (v_host, v_family, v_label.theme, 'guest_message',
              case when v_label.severity in ('low', 'normal', 'high')
                   then v_label.severity::public.problem_priority else 'normal' end,
              round(v_label.confidence, 2),
              date_trunc('month', v_day::timestamp)::date,
              case when v_day >= current_date - 90 then date_trunc('week', v_day::timestamp)::date end,
              v_channel, 'message', p_detector, v_conv_key)
      on conflict (host_id, conversation_key, theme) where conversation_key is not null do update
        set severity = greatest(f.severity, excluded.severity),
            confidence = greatest(f.confidence, excluded.confidence);
      v_labels := v_labels + 1;

      v_pair := public.message_theme_finding(v_label.theme);
      if v_pair is null then
        continue;
      end if;
      -- One card waiting about one fault in one conversation: a guest who
      -- writes again about it joins the card.
      if exists (select 1 from public.signal_findings f
                 join public.guest_signals g on g.id = f.signal_id
                 where g.host_id = v_host and g.conversation_key = v_conv_key
                   and f.kind::text = v_pair[1] and f.subject = v_pair[2]
                   and f.status = 'candidate') then
        v_joined := v_joined + 1;
        continue;
      end if;

      v_finding := null;
      insert into public.signal_findings (host_id, signal_id, property_id, kind, subject, urgency,
                                          still_relevant, summary, summary_i18n, evidence_source,
                                          confidence, detector, external_conversation_id,
                                          conversation_link_ends)
      values (v_host, v_latest.id, coalesce(v_room, v_place), v_pair[1]::public.signal_finding_kind,
              v_pair[2],
              case when v_label.severity in ('low', 'normal', 'high')
                   then v_label.severity::public.problem_priority else 'normal' end,
              case when v_label.resolved then 'fixed_during_stay' else 'likely' end,
              -- No words of the model are kept: the screen names the kind and
              -- the subject, and the manager writes the title.
              v_pair[2], '{}'::jsonb, 'message', round(v_label.confidence, 2), p_detector, v_conv_id,
              v_day + 89)
      on conflict (signal_id, kind, subject) do nothing
      returning id into v_finding;

      if v_finding is not null then
        v_status := public.decide_signal_finding(v_finding);
        v_counts := jsonb_set(v_counts, array[v_status::text],
                              to_jsonb(coalesce((v_counts ->> v_status::text)::integer, 0) + 1));
      end if;
    end loop;

    -- Read, and nothing waiting for a manager: the day and the booking go now.
    perform public.cut_signal_stay_links(v_ids || v_latest.id);
  end if;

  v_counts := v_counts || jsonb_build_object('messages', v_new, 'labels', v_labels,
                                             'unsure', v_unsure, 'joined', v_joined);

  if p_run_id is not null then
    update raw.signal_message_runs r
    set status = 'done',
        spent_micro_usd = greatest(coalesce(p_spent_micro_usd, r.reserved_micro_usd), 0),
        counts = coalesce(p_counts, '{}'::jsonb) || v_counts,
        finished_at = now()
    where r.id = p_run_id;
  end if;

  perform public.finish_guest_conversation(p_provider, v_conv_id, p_read_to, null, v_host);
  return v_counts;
end;
$$;

/**
 * Nightly (05:20 UTC): what a chat leaves behind ages out. The conversation key
 * goes with the message's key (90 days, purge_signal_data) and from an episode
 * after 90 days; the PMS's id of a conversation on a card 30 days after the
 * decision, never past its 89th day; the queue of conversations nobody wrote in
 * for two weeks. The episodes stay: a theme, a place, a month.
 */
create or replace function public.purge_guest_message_links()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_signals  integer;
  v_facts    integer;
  v_links    integer;
  v_queue    integer;
begin
  update public.guest_signals g
  set conversation_key = null
  where g.kind = 'message' and g.conversation_key is not null
    and (g.external_key like 'purged:%'
         or public.signal_retention_ends(g.kind, g.submitted_at) <= current_date);
  get diagnostics v_signals = row_count;

  update public.issue_facts f
  set conversation_key = null
  where f.conversation_key is not null and f.created_at < now() - interval '90 days';
  get diagnostics v_facts = row_count;

  update public.signal_findings f
  set conversation_link_ends = least(f.conversation_link_ends,
                                     (f.decided_at at time zone 'Europe/Prague')::date + 30)
  where f.external_conversation_id is not null and f.decided_at is not null
    and f.status <> 'candidate';

  update public.signal_findings f
  set external_conversation_id = null, conversation_link_ends = null
  where f.external_conversation_id is not null and f.conversation_link_ends <= current_date;
  get diagnostics v_links = row_count;

  delete from raw.signal_message_queue q
  where q.state = 'idle' and q.updated_at < now() - interval '14 days';
  get diagnostics v_queue = row_count;

  return jsonb_build_object('signals', v_signals, 'facts', v_facts, 'links', v_links, 'queue', v_queue);
end;
$$;

-- ===================================================================
-- «Качество объектов»: chats beside reviews, never in them
-- ===================================================================

/** Chats are on for the company: their episodes and cards may be shown. Internal: no grants. */
create or replace function public.guest_messages_shown(p_host uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.messages_enabled from public.signal_settings s
                   where s.host_id = p_host and s.kind = 'message'), false)
$$;

/**
 * Every place and theme with something to say, one object each: the episodes of
 * the window and the one before by layer, the numbers the state of the theme is
 * read from (packages/shared/src/quality), and the work on it. An episode of a
 * review hidden since is not shown. Chats are counted apart (messages,
 * messages_prev) and only while their switch is on; the state of a theme is read
 * from reviews and staff alone, so a chat never moves it unseen.
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
    select f.property_id, f.theme, f.layer, f.month,
           coalesce(f.week, f.month) as day,
           case when p_grain = 'week' then f.week >= p_from else f.month >= p_from end as is_cur,
           case when p_grain = 'week' then f.week between p_prev_from and p_prev_to
                else f.month between p_prev_from and p_prev_to end as is_prev
    from public.issue_facts f
    left join public.guest_signals g on g.id = f.signal_id
    where f.host_id = p_host
      and (f.layer <> 'guest_message' or public.guest_messages_shown(p_host))
      and not coalesce(g.is_hidden, false)
      and not public.analytics_is_test_listing(f.property_id)
      and (p_property is null or f.property_id = p_property)
  ),
  said as (
    select x.property_id, x.theme,
           count(*) filter (where x.is_cur and x.layer = 'guest_review') as reviews,
           count(*) filter (where x.is_prev and x.layer = 'guest_review') as reviews_prev,
           count(*) filter (where x.is_cur and x.layer = 'guest_review'
                              and x.month <= public.quality_settled_to(p_today)) as reviews_settled,
           count(*) filter (where x.is_cur and x.layer = 'found_at_work') as found,
           count(*) filter (where x.is_prev and x.layer = 'found_at_work') as found_prev,
           count(*) filter (where x.is_cur and x.layer = 'staff_report') as reported,
           count(*) filter (where x.is_prev and x.layer = 'staff_report') as reported_prev,
           count(*) filter (where x.is_cur and x.layer = 'guest_message') as messages,
           count(*) filter (where x.is_prev and x.layer = 'guest_message') as messages_prev,
           count(*) filter (where x.day >= p_today - 90 and x.layer <> 'guest_message') as recent,
           count(*) filter (where x.day between p_today - 360 and p_today - 91
                              and x.layer <> 'guest_message') as older,
           max(x.day) filter (where x.layer <> 'guest_message') as last_on
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
           'reviews_settled', s.reviews_settled,
           'found', s.found,
           'found_prev', s.found_prev,
           'reported', s.reported,
           'reported_prev', s.reported_prev,
           'messages', s.messages,
           'messages_prev', s.messages_prev,
           'recent', s.recent,
           'older', s.older,
           'last_on', coalesce(s.last_on, (select max(x.day) from facts x
                                            where x.property_id = s.property_id and x.theme = s.theme)),
           'open_work', coalesce(w.open_work, 0),
           'work_180', coalesce(w.work_180, 0),
           'closed_on', w.closed_on
         ) order by s.property_id, th.sort_order), '[]'::jsonb)
  from said s
  join public.issue_themes th on th.code = s.theme
  left join work w on w.property_id = s.property_id and w.theme = s.theme
$$;

/** What every answer shares: the window's days, how far the data reaches, whether chats are shown. */
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
    -- From this day the bookings we hold are whole: the short windows count stays
    -- from them, and the table keeps the sync window. A percentile, because a few
    -- stray old rows must not read as a year of bookings.
    'held_from', (select percentile_disc(0.01) within group (order by r.departure_date)
                  from public.reservations r
                  where r.host_id = p_host and r.departure_date <= p_today
                    and r.status in ('new', 'modified') and not r.is_block),
    -- Reviews are compared only up to here (quality_settled_to).
    'settled_to', public.quality_settled_to(p_today),
    -- The texts' line: before it the reading labels a review, after it the stream's
    -- findings do, and a comparison across it compares two readers. Null while the
    -- reading is on and follows the new reviews: then one reader stands on both sides.
    'line', (select case when not (s.history_follow and s.history_enabled)
                         then (coalesce(s.notice_published_at, s.texts_enabled_at)
                               at time zone 'Europe/Prague')::date end
             from public.signal_settings s
             where s.host_id = p_host and s.kind = 'review'),
    'city_groups', (select h.quality_city_groups from public.hosts h where h.id = p_host),
    'history', public.quality_history_state(p_host),
    -- Chats are on: the screen shows their column, marked as chats.
    'messages_on', public.guest_messages_shown(p_host)
  )
$$;

-- ===================================================================
-- Privileges
-- ===================================================================

revoke all on function public.message_theme_finding(text) from public, anon, authenticated, service_role;
revoke all on function public.signal_message_month_start() from public, anon, authenticated, service_role;
revoke all on function public.guest_message_place(public.signal_provider, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.guest_messages_shown(uuid) from public, anon, authenticated, service_role;
revoke all on function public.quality_theme_rows(uuid, date, text, date, date, date, bigint) from public, anon, authenticated, service_role;
revoke all on function public.quality_meta(uuid, text, date, text, date, date, date, date) from public, anon, authenticated, service_role;

revoke all on function public.guest_message_state(public.signal_provider, uuid) from public, anon, authenticated;
revoke all on function public.collect_guest_message_events(public.signal_provider, uuid) from public, anon, authenticated;
revoke all on function public.queue_polled_conversations(public.signal_provider, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.claim_guest_conversations(public.signal_provider, integer, uuid) from public, anon, authenticated;
revoke all on function public.guest_conversation_stay(public.signal_provider, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.reserve_guest_message_reading(public.signal_provider, text, bigint, uuid) from public, anon, authenticated;
revoke all on function public.fail_guest_message_reading(bigint, bigint, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.finish_guest_conversation(public.signal_provider, text, timestamptz, text, uuid) from public, anon, authenticated;
revoke all on function public.apply_guest_message_reading(public.signal_provider, jsonb, jsonb, jsonb, text, timestamptz, bigint, bigint, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.purge_guest_message_links() from public, anon, authenticated;
grant execute on function public.guest_message_state(public.signal_provider, uuid) to service_role;
grant execute on function public.collect_guest_message_events(public.signal_provider, uuid) to service_role;
grant execute on function public.queue_polled_conversations(public.signal_provider, jsonb, uuid) to service_role;
grant execute on function public.claim_guest_conversations(public.signal_provider, integer, uuid) to service_role;
grant execute on function public.guest_conversation_stay(public.signal_provider, text, text, text, uuid) to service_role;
grant execute on function public.reserve_guest_message_reading(public.signal_provider, text, bigint, uuid) to service_role;
grant execute on function public.fail_guest_message_reading(bigint, bigint, jsonb, jsonb) to service_role;
grant execute on function public.finish_guest_conversation(public.signal_provider, text, timestamptz, text, uuid) to service_role;
grant execute on function public.apply_guest_message_reading(public.signal_provider, jsonb, jsonb, jsonb, text, timestamptz, bigint, bigint, jsonb, uuid) to service_role;
grant execute on function public.purge_guest_message_links() to service_role;


-- ===================================================================
-- Jobs. The reading is created inactive and starts with the word «включай
-- чаты» (docs/one-off-writes/guest-chats-on.sql); it skips 03:00–04:40 UTC and
-- checks the switch first anyway. The purge runs from the start: with nothing
-- to age it touches nothing.
-- ===================================================================

select cron.schedule(
  'read-guest-messages',
  '*/2 0-2,5-23 * * *',
  $$select public.invoke_edge_function('read-guest-messages')$$
);

select cron.schedule(
  'read-guest-messages-0440',
  '40-58/2 4 * * *',
  $$select public.invoke_edge_function('read-guest-messages')$$
);

select cron.schedule(
  'purge-guest-message-links',
  '20 5 * * *',
  $$select public.purge_guest_message_links()$$
);

select cron.alter_job(j.jobid, active => false)
from cron.job j
where j.jobname in ('read-guest-messages', 'read-guest-messages-0440');
