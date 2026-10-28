-- Public API v1 (docs/api-v1.md): API keys and their scopes, the gate every
-- request passes, the request log, idempotency, rate windows, and the
-- api_v1_* functions the Edge Function `api` calls as service_role.
--
-- Isolation lives here, not in the function. Every api_v1_* function takes the
-- key's digest — HMAC-SHA256 of the key under a pepper only the Edge Functions
-- hold — and derives the company, the key's owner, its scopes and its property
-- restriction from the key row in the same transaction. No function takes a
-- host_id from the caller. Only service_role may execute them.
--
-- Writes go through the functions the panel calls (report_problem,
-- assign_problem, save_task) as the key's owner: api_act_as() sets the JWT
-- claims for the rest of the transaction, so their own checks, journals and
-- push triggers see the owner as if he had pressed the button. A task created
-- through the API therefore always has an author.
--
-- The scope registry is packages/shared/src/api/registry.json; the rows between
-- the api-scopes markers below are compared with it by the parity test
-- (apps/web/src/features/api-keys/__tests__/api-parity.test.ts). A later
-- migration that adds or changes a scope repeats the marker block with the
-- same row format.

-- ---------- 1. the scope registry ----------

create table public.api_scopes (
  id          text primary key check (id ~ '^[a-z_]+:[a-z_]+$'),
  scope_group text not null,
  action      text not null check (action in ('read', 'write')),
  sensitivity text not null check (sensitivity in ('normal', 'sensitive')),
  -- exposed: an operation or a field needs it, a key may hold it;
  -- planned: reserved, no operation yet, no key may hold it;
  -- forbidden: never held by any key, whatever the preset.
  status      text not null check (status in ('exposed', 'planned', 'forbidden')),
  operator    boolean not null default false,
  check (status <> 'forbidden' or (sensitivity = 'sensitive' and not operator))
);

comment on table public.api_scopes is
  'The API scope registry (packages/shared/src/api/registry.json). Presets are computed from it at '
  'every call, so a scope exposed later joins the presets whose rule it meets (20261028100000).';

-- api-scopes:begin
insert into public.api_scopes (id, scope_group, action, sensitivity, status, operator) values
  ('properties:read', 'properties', 'read', 'normal', 'exposed', false),
  ('properties:read_address', 'properties', 'read', 'sensitive', 'exposed', false),
  ('properties:write', 'properties', 'write', 'sensitive', 'planned', false),
  ('cleanings:read', 'cleanings', 'read', 'normal', 'exposed', false),
  ('cleanings:assign', 'cleanings', 'write', 'normal', 'exposed', true),
  ('cleanings:create', 'cleanings', 'write', 'normal', 'planned', true),
  ('cleanings:cancel', 'cleanings', 'write', 'normal', 'planned', true),
  ('cleanings:read_steps', 'cleanings', 'read', 'normal', 'planned', false),
  ('tasks:read', 'tasks', 'read', 'normal', 'exposed', false),
  ('tasks:create', 'tasks', 'write', 'normal', 'exposed', true),
  ('tasks:assign', 'tasks', 'write', 'normal', 'exposed', true),
  ('tasks:update', 'tasks', 'write', 'normal', 'planned', true),
  ('tasks:resolve', 'tasks', 'write', 'normal', 'planned', true),
  ('tasks:cancel', 'tasks', 'write', 'normal', 'planned', true),
  ('staff:read', 'staff', 'read', 'normal', 'exposed', false),
  ('staff:read_names', 'staff', 'read', 'sensitive', 'exposed', false),
  ('staff:write', 'staff', 'write', 'sensitive', 'planned', false),
  ('bookings:read', 'bookings', 'read', 'normal', 'exposed', false),
  ('bookings:read_prices', 'bookings', 'read', 'sensitive', 'planned', false),
  ('media:read', 'media', 'read', 'normal', 'exposed', false),
  ('media:download', 'media', 'read', 'sensitive', 'planned', false),
  ('settings:read', 'settings', 'read', 'normal', 'exposed', false),
  ('settings:write', 'settings', 'write', 'sensitive', 'planned', false),
  ('checklists:read', 'checklists', 'read', 'normal', 'planned', false),
  ('checklists:write', 'checklists', 'write', 'sensitive', 'planned', false),
  ('supplies:read', 'supplies', 'read', 'normal', 'planned', false),
  ('supplies:write', 'supplies', 'write', 'normal', 'planned', true),
  ('analytics:read', 'analytics', 'read', 'normal', 'planned', false),
  ('chat:read', 'chat', 'read', 'sensitive', 'planned', false),
  ('chat:write', 'chat', 'write', 'sensitive', 'planned', false),
  ('webhooks:manage', 'webhooks', 'write', 'sensitive', 'planned', false),
  ('api_keys:manage', 'forbidden', 'write', 'sensitive', 'forbidden', false),
  ('staff:manage_privileged', 'forbidden', 'write', 'sensitive', 'forbidden', false),
  ('staff:read_contacts', 'forbidden', 'read', 'sensitive', 'forbidden', false),
  ('guests:read_personal', 'forbidden', 'read', 'sensitive', 'forbidden', false),
  ('access_codes:read', 'forbidden', 'read', 'sensitive', 'forbidden', false),
  ('integrations:read_secrets', 'forbidden', 'read', 'sensitive', 'forbidden', false),
  ('hostaway:write', 'forbidden', 'write', 'sensitive', 'forbidden', false),
  ('data:destroy', 'forbidden', 'write', 'sensitive', 'forbidden', false),
  ('security:write', 'forbidden', 'write', 'sensitive', 'forbidden', false),
  ('tenants:cross', 'forbidden', 'read', 'sensitive', 'forbidden', false)
on conflict (id) do update
  set scope_group = excluded.scope_group,
      action      = excluded.action,
      sensitivity = excluded.sensitivity,
      status      = excluded.status,
      operator    = excluded.operator;
-- api-scopes:end

-- ---------- 2. keys, their journal, the request log, windows, idempotency ----------

create table public.api_keys (
  id           uuid primary key default gen_random_uuid(),
  host_id      uuid not null references public.hosts (id),
  name         text not null check (length(btrim(name)) between 1 and 80),
  -- The first 12 characters of the key, shown to tell keys apart. Not a secret:
  -- 7 random characters of the 43 say nothing about the rest.
  prefix       text not null check (prefix ~ '^woom_[A-Za-z0-9_-]{7}$'),
  -- HMAC-SHA256(API_KEY_PEPPER, key), hex. The pepper is a secret of the Edge
  -- Functions and never reaches the database.
  key_digest   text not null unique check (key_digest ~ '^[0-9a-f]{64}$'),
  preset       text not null check (preset in ('read_only', 'operator', 'full', 'custom')),
  -- For custom: the whole set. For a preset: the sensitive scopes added by hand.
  scopes       text[] not null default '{}',
  -- Null: every property of the company. A building brings its rooms.
  property_ids bigint[] check (property_ids is null or cardinality(property_ids) > 0),
  expires_at   timestamptz,
  created_by   uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_by   uuid references public.profiles (id),
  last_used_at timestamptz
);

create index api_keys_host_idx on public.api_keys (host_id, created_at);

create trigger api_keys_touch_updated_at
  before update on public.api_keys
  for each row execute function public.touch_updated_at();

comment on table public.api_keys is
  'API keys (docs/api-v1.md §5.1): only the digest is kept. Written by create_api_key, '
  'update_api_key, revoke_api_key; no client role reads the table.';

create table public.api_key_events (
  id         bigint generated always as identity primary key,
  key_id     uuid not null references public.api_keys (id),
  host_id    uuid not null references public.hosts (id),
  actor_id   uuid references public.profiles (id),
  kind       text not null check (kind in ('created', 'updated', 'revoked')),
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);

create index api_key_events_key_idx on public.api_key_events (key_id, created_at);

comment on table public.api_key_events is
  'Who created, changed or revoked an API key, and what it was before and after (20261028100000).';

-- No request body, no query string, no IP, no personal data: which key called
-- what, how it ended and how long it took.
create table public.api_request_log (
  id          bigint generated always as identity primary key,
  key_id      uuid references public.api_keys (id),
  host_id     uuid references public.hosts (id),
  operation   text not null check (length(operation) <= 64),
  method      text not null check (method in ('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD')),
  status      smallint not null check (status between 100 and 599),
  duration_ms integer check (duration_ms >= 0),
  object_id   text check (length(object_id) <= 64),
  request_id  uuid,
  created_at  timestamptz not null default now()
);

create index api_request_log_key_idx on public.api_request_log (key_id, created_at);
create index api_request_log_created_idx on public.api_request_log (created_at);

-- Fixed windows: 'key:<uuid>' by the minute, 'ip:<hmac>' by ten minutes.
create table public.api_rate_windows (
  bucket       text not null check (bucket ~ '^(key|ip):[0-9a-f-]+$'),
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);

create index api_rate_windows_start_idx on public.api_rate_windows (window_start);

create table public.api_idempotency (
  key_id       uuid not null references public.api_keys (id),
  idem_key     text not null check (idem_key ~ '^[\x21-\x7e]{1,255}$'),
  operation    text not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  status       smallint,
  response     jsonb,
  created_at   timestamptz not null default now(),
  primary key (key_id, idem_key)
);

create index api_idempotency_created_idx on public.api_idempotency (created_at);

alter table public.api_scopes        enable row level security;
alter table public.api_keys          enable row level security;
alter table public.api_key_events    enable row level security;
alter table public.api_request_log   enable row level security;
alter table public.api_rate_windows  enable row level security;
alter table public.api_idempotency   enable row level security;

revoke all on table public.api_scopes, public.api_keys, public.api_key_events,
  public.api_request_log, public.api_rate_windows, public.api_idempotency
  from public, anon, authenticated;
revoke all on sequence public.api_key_events_id_seq, public.api_request_log_id_seq
  from public, anon, authenticated;

-- ---------- 3. helpers ----------

create type public.api_context as (
  key_id   uuid,
  host_id  uuid,
  owner_id uuid,
  -- Null: every property. Otherwise the key's properties and their rooms.
  allowed  bigint[],
  scopes   text[]
);

create or replace function public.api_ts(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
$$;

create or replace function public.api_hm(p_at time)
returns text
language sql
immutable
set search_path = ''
as $$
  select to_char(p_at, 'HH24:MI')
$$;

-- Hostaway's channel numbers, named the way the reviews design names them.
create or replace function public.api_channel(p_channel_id integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_channel_id
    when 2018 then 'airbnb'
    when 2005 then 'booking'
    when 2002 then 'vrbo'
    when 2000 then 'direct'
    when 2013 then 'direct'
    when 2022 then 'google'
    else 'other'
  end
$$;

/**
 * A property's name with door codes taken out (docs/api-v1.md §6.4, F27).
 *
 * Codes were written into listing and unit names in Hostaway ("|code - 1234|",
 * "lockbox 1234", "Unit 3 - 1234"). A segment that names a code goes with its
 * number and its |frame|; any other run of four or more digits becomes ••••.
 * A name with neither comes back exactly as it was.
 */
create or replace function public.api_safe_property_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  c_keyword constant text :=
    '\|?\s*\m(code|door|lock\s?box|keypad|pin|k[oó]d|код|dve[rř]e?)\M\s*[-:#=]?\s*[0-9][0-9 -]*[0-9]?\s*\|?';
  v_name text := p_name;
begin
  if p_name is null then
    return null;
  end if;
  if p_name !~* c_keyword and p_name !~ '[0-9]{4,}' then
    return p_name;
  end if;

  v_name := regexp_replace(v_name, c_keyword, ' ', 'gi');
  v_name := regexp_replace(v_name, '(^|[^0-9])[0-9]{4,}(?![0-9])', '\1••••', 'g');
  v_name := regexp_replace(v_name, '\s{2,}', ' ', 'g');
  v_name := regexp_replace(v_name, '\s*-\s*(-\s*)+', ' - ', 'g');
  v_name := regexp_replace(v_name, '^[\s|-]+|[\s|-]+$', '', 'g');
  return coalesce(nullif(v_name, ''), '••••');
end;
$$;

-- What a key may do now: the preset by the registry's current rows, plus the
-- scopes stored on the key. Only exposed scopes ever count.
create or replace function public.api_effective_scopes(p_preset text, p_scopes text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(s.id order by s.id), '{}')
  from public.api_scopes s
  where s.status = 'exposed'
    and (p_preset = 'full'
         or (p_preset in ('read_only', 'operator') and s.action = 'read' and s.sensitivity = 'normal')
         or (p_preset = 'operator' and s.operator)
         or s.id = any(coalesce(p_scopes, '{}')))
$$;

-- active | invalid | revoked | expired | suspended. A key works while the admin
-- who made it is an active admin of the same company (docs/api-v1.md §3.5).
create or replace function public.api_key_state(p_key public.api_keys)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_key.id is null then 'invalid'
    when p_key.revoked_at is not null then 'revoked'
    when p_key.expires_at is not null and p_key.expires_at <= now() then 'expired'
    when not exists (select 1 from public.profiles pr
                     where pr.id = p_key.created_by
                       and pr.host_id = p_key.host_id
                       and pr.is_active
                       and pr.role = 'admin') then 'suspended'
    else 'active'
  end
$$;

/**
 * The key behind a digest, checked, with the scope the operation needs.
 *
 * Raises with an `api:` hint the Edge Function turns into problem+json: a key
 * gone bad between the gate and the operation answers 401, a missing scope 403
 * with the scope named.
 */
create or replace function public.api_authorize(p_digest text, p_scope text)
returns public.api_context
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key    public.api_keys;
  v_state  text;
  v_scopes text[];
  v_allowed bigint[];
begin
  select k.* into v_key from public.api_keys k where k.key_digest = p_digest;
  v_state := public.api_key_state(v_key);
  if v_state <> 'active' then
    raise exception 'API key is %', v_state
      using errcode = 'invalid_authorization_specification',
            hint = case v_state when 'invalid' then 'api:invalid-key' else 'api:key-' || v_state end;
  end if;

  v_scopes := public.api_effective_scopes(v_key.preset, v_key.scopes);
  if p_scope is not null and not (p_scope = any(v_scopes)) then
    raise exception 'API key lacks scope %', p_scope
      using errcode = 'insufficient_privilege',
            hint = 'api:insufficient-scope',
            detail = jsonb_build_object('required_scope', p_scope)::text;
  end if;

  if v_key.property_ids is not null then
    select coalesce(array_agg(pr.id order by pr.id), '{}') into v_allowed
    from public.properties pr
    where pr.host_id = v_key.host_id
      and (pr.id = any(v_key.property_ids) or pr.parent_id = any(v_key.property_ids));
  end if;

  return (v_key.id, v_key.host_id, v_key.created_by, v_allowed, v_scopes)::public.api_context;
end;
$$;

create or replace function public.api_require(p_ctx public.api_context, p_scope text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not (p_scope = any(p_ctx.scopes)) then
    raise exception 'API key lacks scope %', p_scope
      using errcode = 'insufficient_privilege',
            hint = 'api:insufficient-scope',
            detail = jsonb_build_object('required_scope', p_scope)::text;
  end if;
end;
$$;

create or replace function public.api_allows_property(p_ctx public.api_context, p_property bigint)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_ctx.allowed is null or (p_property is not null and p_property = any(p_ctx.allowed))
$$;

create or replace function public.api_not_found(p_what text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  raise exception '% not found', p_what
    using errcode = 'no_data_found', hint = 'api:not-found';
end;
$$;

-- The rest of the transaction runs as the key's owner: auth.uid() and every
-- check built on it see him. Only the api_v1_* writes call it.
create or replace function public.api_act_as(p_profile uuid)
returns void
language sql
volatile
set search_path = ''
as $$
  select set_config('request.jwt.claims',
                    jsonb_build_object('sub', p_profile, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_profile::text, true),
         set_config('request.jwt.claim.role', 'authenticated', true);
$$;

-- ---------- 4. the gate and the request log ----------

/**
 * Every request passes here first, in its own transaction, so that the counters
 * it moves stay moved whatever the operation does next.
 *
 * Answers {ok: false, code, retry_after?} rather than raising: a failed
 * authentication counts against the IP, and a raise would roll the count back.
 * On success: the key's id and digest (compared again in the function in
 * constant time) and the key's rate window.
 */
create or replace function public.api_gate(p_digest text, p_ip_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_key_limit constant integer := 120;
  c_ip_limit  constant integer := 20;
  v_ip_window  timestamptz := to_timestamp(floor(extract(epoch from now()) / 600) * 600);
  v_key_window timestamptz := date_trunc('minute', now());
  v_ip_hits    integer;
  v_key        public.api_keys;
  v_state      text;
  v_hits       integer;
  v_reset      integer;
begin
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'The IP hash is malformed' using errcode = 'invalid_parameter_value';
  end if;

  if p_ip_hash is not null then
    select w.hits into v_ip_hits
    from public.api_rate_windows w
    where w.bucket = 'ip:' || p_ip_hash and w.window_start = v_ip_window;
    if coalesce(v_ip_hits, 0) >= c_ip_limit then
      return jsonb_build_object(
        'ok', false, 'code', 'rate-limited',
        'retry_after', greatest(1, ceil(extract(epoch from v_ip_window + interval '10 minutes' - now()))::integer));
    end if;
  end if;

  if p_digest is not null then
    select k.* into v_key from public.api_keys k where k.key_digest = p_digest;
  end if;
  v_state := case when p_digest is null then 'missing' else public.api_key_state(v_key) end;

  if v_state <> 'active' then
    if p_ip_hash is not null then
      insert into public.api_rate_windows as w (bucket, window_start, hits)
      values ('ip:' || p_ip_hash, v_ip_window, 1)
      on conflict (bucket, window_start) do update set hits = w.hits + 1;
    end if;
    return jsonb_build_object('ok', false, 'code', case v_state
      when 'missing' then 'missing-key'
      when 'invalid' then 'invalid-key'
      else 'key-' || v_state end);
  end if;

  insert into public.api_rate_windows as w (bucket, window_start, hits)
  values ('key:' || v_key.id, v_key_window, 1)
  on conflict (bucket, window_start) do update set hits = w.hits + 1
  returning w.hits into v_hits;

  v_reset := greatest(1, ceil(extract(epoch from v_key_window + interval '1 minute' - now()))::integer);
  if v_hits > c_key_limit then
    return jsonb_build_object('ok', false, 'code', 'rate-limited', 'retry_after', v_reset,
                              'limit', c_key_limit, 'remaining', 0, 'reset', v_reset);
  end if;

  if v_key.last_used_at is null or v_key.last_used_at < now() - interval '1 minute' then
    update public.api_keys set last_used_at = now() where id = v_key.id;
  end if;

  return jsonb_build_object('ok', true, 'key_id', v_key.id, 'digest', v_key.key_digest,
                            'limit', c_key_limit, 'remaining', greatest(c_key_limit - v_hits, 0),
                            'reset', v_reset);
end;
$$;

create or replace function public.api_log_request(
  p_key_id      uuid,
  p_operation   text,
  p_method      text,
  p_status      integer,
  p_duration_ms integer,
  p_object_id   text default null,
  p_request_id  uuid default null
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.api_request_log (key_id, host_id, operation, method, status, duration_ms,
                                      object_id, request_id)
  values (p_key_id, (select k.host_id from public.api_keys k where k.id = p_key_id),
          left(p_operation, 64), p_method, p_status, p_duration_ms, left(p_object_id, 64),
          p_request_id);
$$;

-- ---------- 5. what each resource looks like ----------

create or replace function public.api_property_json(p public.properties, p_scopes text[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
      'id', p.id,
      'name', public.api_safe_property_name(p.name),
      'name_masked', public.api_safe_property_name(p.name) is distinct from p.name,
      'parent_id', p.parent_id,
      'status', p.status,
      'city', p.city,
      'country_code', p.country_code,
      'timezone', p.timezone,
      'bedrooms', p.bedrooms,
      'bathrooms', p.bathrooms,
      'max_guests', p.max_guests,
      'check_in_time', public.api_hm(p.check_in_time),
      'check_out_time', public.api_hm(p.check_out_time),
      'created_at', public.api_ts(p.created_at),
      'updated_at', public.api_ts(p.updated_at))
    || case when 'properties:read_address' = any(p_scopes)
            then jsonb_build_object('address', p.address) else '{}'::jsonb end
$$;

create or replace function public.api_cleaning_json(t public.tasks)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'type', t.type,
    'status', t.status,
    'property_id', t.property_id,
    'booking_id', t.reservation_id,
    'task_id', t.problem_id,
    'scheduled_date', t.scheduled_date,
    'time_from', public.api_hm(t.time_from),
    'time_to', public.api_hm(t.time_to),
    'due_at', public.api_ts(t.due_at),
    'priority', t.priority,
    'assignee_id', t.assignee_id,
    'title', t.title,
    'guests_count', t.guests_count,
    'is_parallel', t.is_parallel,
    'started_at', public.api_ts(t.started_at),
    'completed_at', public.api_ts(t.completed_at),
    'completed_by', t.completed_by,
    'created_at', public.api_ts(t.created_at),
    'updated_at', public.api_ts(t.updated_at))
$$;

-- The work on a task is its latest repair attempt, live or not.
create or replace function public.api_task_json(p public.problems)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'description', p.description,
    'priority', p.priority,
    'status', p.status,
    'property_id', p.property_id,
    'cleaning_id', p.task_id,
    'reported_by', p.reported_by,
    'archived', p.archived_at is not null,
    'cancel_reason', p.cancel_reason,
    'work', (select jsonb_build_object(
                      'cleaning_id', w.id,
                      'status', w.status,
                      'assignee_id', w.assignee_id,
                      'scheduled_date', w.scheduled_date,
                      'time_from', public.api_hm(w.time_from),
                      'time_to', public.api_hm(w.time_to))
             from public.tasks w
             where w.problem_id = p.id and w.type = 'maintenance'
             order by w.created_at desc, w.id desc
             limit 1),
    'created_at', public.api_ts(p.created_at),
    'updated_at', public.api_ts(p.updated_at),
    'resolved_at', public.api_ts(p.resolved_at),
    'cancelled_at', public.api_ts(p.cancelled_at),
    'archived_at', public.api_ts(p.archived_at))
$$;

create or replace function public.api_staff_json(pr public.profiles, p_scopes text[])
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
      'id', pr.id,
      'role', pr.role,
      'is_active', pr.is_active,
      'created_at', public.api_ts(pr.created_at),
      'updated_at', public.api_ts(pr.updated_at))
    || case when 'staff:read_names' = any(p_scopes)
            then jsonb_build_object('full_name', pr.full_name) else '{}'::jsonb end
$$;

create or replace function public.api_booking_json(r public.reservations)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'property_id', r.property_id,
    'room_ids', coalesce((select jsonb_agg(u.property_id order by u.property_id)
                          from public.reservation_units u
                          where u.reservation_id = r.id), '[]'::jsonb),
    'arrival_date', r.arrival_date,
    'departure_date', r.departure_date,
    'check_in_time', public.api_hm(r.check_in_time),
    'check_out_time', public.api_hm(r.check_out_time),
    'status', r.status,
    'channel', public.api_channel(r.channel_id),
    'channel_id', r.channel_id,
    'guests_count', r.guests_count,
    'is_block', r.is_block,
    'created_at', public.api_ts(r.created_at),
    'updated_at', public.api_ts(r.updated_at))
$$;

create or replace function public.api_media_json(m public.task_media)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id,
    'kind', m.kind,
    'source', m.source,
    'mime_type', m.mime_type,
    'byte_size', m.byte_size,
    'width', m.width,
    'height', m.height,
    'duration_sec', m.duration_sec,
    'step_id', m.step_id,
    'step_type', (select s.type from public.task_steps s where s.id = m.step_id),
    'status', case when m.purged_at is not null then 'purged'
                   when m.uploaded_at is not null then 'uploaded'
                   else 'registered' end,
    'created_by', m.created_by,
    'device_taken_at', public.api_ts(m.device_taken_at),
    'uploaded_at', public.api_ts(m.uploaded_at),
    'created_at', public.api_ts(m.created_at))
$$;

-- ---------- 6. reads ----------

create or replace function public.api_v1_get_me(p_digest text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, null);
  v_key public.api_keys;
begin
  select k.* into v_key from public.api_keys k where k.id = v_ctx.key_id;
  return jsonb_build_object(
    'key', jsonb_build_object(
      'id', v_key.id,
      'name', v_key.name,
      'prefix', v_key.prefix,
      'preset', v_key.preset,
      'scopes', to_jsonb(v_ctx.scopes),
      'property_ids', to_jsonb(v_key.property_ids),
      'expires_at', public.api_ts(v_key.expires_at),
      'created_at', public.api_ts(v_key.created_at)),
    'company', (select jsonb_build_object('id', h.id, 'name', h.name)
                from public.hosts h where h.id = v_ctx.host_id));
end;
$$;

create or replace function public.api_v1_list_properties(
  p_digest        text,
  p_status        text[] default null,
  p_parent_id     bigint default null,
  p_updated_since timestamptz default null,
  p_after_id      bigint default null,
  p_limit         integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'properties:read');
begin
  return (
    select coalesce(jsonb_agg(public.api_property_json(p, v_ctx.scopes) order by p.id), '[]'::jsonb)
    from (select pr.* from public.properties pr
          where pr.host_id = v_ctx.host_id
            and public.api_allows_property(v_ctx, pr.id)
            and (p_status is null or pr.status::text = any(p_status))
            and (p_parent_id is null or pr.parent_id = p_parent_id)
            and (p_updated_since is null or pr.updated_at >= p_updated_since)
            and (p_after_id is null or pr.id > p_after_id)
          order by pr.id
          limit least(greatest(p_limit, 1), 200) + 1) p);
end;
$$;

create or replace function public.api_v1_get_property(p_digest text, p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'properties:read');
  v_row public.properties;
begin
  select pr.* into v_row from public.properties pr
  where pr.id = p_id and pr.host_id = v_ctx.host_id and public.api_allows_property(v_ctx, pr.id);
  if not found then
    perform public.api_not_found('Property');
  end if;
  return public.api_property_json(v_row, v_ctx.scopes);
end;
$$;

create or replace function public.api_v1_list_cleanings(
  p_digest        text,
  p_date_from     date default null,
  p_date_to       date default null,
  p_property_id   bigint default null,
  p_assignee_id   uuid default null,
  p_status        text[] default null,
  p_type          text[] default null,
  p_updated_since timestamptz default null,
  p_after_date    date default null,
  p_after_id      uuid default null,
  p_limit         integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'cleanings:read');
begin
  return (
    select coalesce(jsonb_agg(public.api_cleaning_json(t) order by t.scheduled_date, t.id), '[]'::jsonb)
    from (select tk.* from public.tasks tk
          where tk.host_id = v_ctx.host_id
            and public.api_allows_property(v_ctx, tk.property_id)
            and (p_date_from is null or tk.scheduled_date >= p_date_from)
            and (p_date_to is null or tk.scheduled_date <= p_date_to)
            and (p_property_id is null or tk.property_id = p_property_id)
            and (p_assignee_id is null or tk.assignee_id = p_assignee_id)
            and (p_status is null or tk.status::text = any(p_status))
            and (p_type is null or tk.type::text = any(p_type))
            and (p_updated_since is null or tk.updated_at >= p_updated_since)
            and (p_after_id is null or (tk.scheduled_date, tk.id) > (p_after_date, p_after_id))
          order by tk.scheduled_date, tk.id
          limit least(greatest(p_limit, 1), 200) + 1) t);
end;
$$;

create or replace function public.api_v1_get_cleaning(p_digest text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'cleanings:read');
  v_row public.tasks;
begin
  select tk.* into v_row from public.tasks tk
  where tk.id = p_id and tk.host_id = v_ctx.host_id and public.api_allows_property(v_ctx, tk.property_id);
  if not found then
    perform public.api_not_found('Cleaning');
  end if;
  return public.api_cleaning_json(v_row);
end;
$$;

create or replace function public.api_v1_list_tasks(
  p_digest           text,
  p_status           text[] default null,
  p_priority         text[] default null,
  p_property_id      bigint default null,
  p_assignee_id      uuid default null,
  p_created_from     timestamptz default null,
  p_created_to       timestamptz default null,
  p_include_archived boolean default false,
  p_updated_since    timestamptz default null,
  p_after_created    timestamptz default null,
  p_after_id         uuid default null,
  p_limit            integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'tasks:read');
begin
  return (
    -- _sort: created_at at full precision, for the cursor; the function strips it.
    select coalesce(jsonb_agg(public.api_task_json(p) || jsonb_build_object('_sort', p.created_at)
                              order by p.created_at, p.id), '[]'::jsonb)
    from (select pb.* from public.problems pb
          where pb.host_id = v_ctx.host_id
            and (v_ctx.allowed is null or public.api_allows_property(v_ctx, pb.property_id))
            and (p_status is null or pb.status::text = any(p_status))
            and (p_priority is null or pb.priority::text = any(p_priority))
            and (p_property_id is null or pb.property_id = p_property_id)
            and (coalesce(p_include_archived, false) or pb.archived_at is null)
            and (p_created_from is null or pb.created_at >= p_created_from)
            and (p_created_to is null or pb.created_at < p_created_to)
            and (p_updated_since is null or pb.updated_at >= p_updated_since)
            and (p_assignee_id is null or p_assignee_id = (
                   select w.assignee_id from public.tasks w
                   where w.problem_id = pb.id and w.type = 'maintenance'
                   order by w.created_at desc, w.id desc limit 1))
            and (p_after_id is null or (pb.created_at, pb.id) > (p_after_created, p_after_id))
          order by pb.created_at, pb.id
          limit least(greatest(p_limit, 1), 200) + 1) p);
end;
$$;

create or replace function public.api_v1_get_task(p_digest text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'tasks:read');
  v_row public.problems;
begin
  select pb.* into v_row from public.problems pb
  where pb.id = p_id and pb.host_id = v_ctx.host_id
    and (v_ctx.allowed is null or public.api_allows_property(v_ctx, pb.property_id));
  if not found then
    perform public.api_not_found('Task');
  end if;
  return public.api_task_json(v_row);
end;
$$;

create or replace function public.api_v1_list_staff(
  p_digest   text,
  p_role     text[] default null,
  p_active   boolean default null,
  p_after_id uuid default null,
  p_limit    integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'staff:read');
begin
  return (
    select coalesce(jsonb_agg(public.api_staff_json(s, v_ctx.scopes) order by s.id), '[]'::jsonb)
    from (select pr.* from public.profiles pr
          where pr.host_id = v_ctx.host_id
            and (p_role is null or pr.role::text = any(p_role))
            and (p_active is null or pr.is_active = p_active)
            and (p_after_id is null or pr.id > p_after_id)
          order by pr.id
          limit least(greatest(p_limit, 1), 200) + 1) s);
end;
$$;

create or replace function public.api_v1_get_staff_member(p_digest text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'staff:read');
  v_row public.profiles;
begin
  select pr.* into v_row from public.profiles pr where pr.id = p_id and pr.host_id = v_ctx.host_id;
  if not found then
    perform public.api_not_found('Staff member');
  end if;
  return public.api_staff_json(v_row, v_ctx.scopes);
end;
$$;

-- A booking is the key's when its listing is, or one of the rooms it took.
create or replace function public.api_allows_booking(p_ctx public.api_context, p_booking public.reservations)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_ctx.allowed is null
      or p_booking.property_id = any(p_ctx.allowed)
      or exists (select 1 from public.reservation_units u
                 where u.reservation_id = p_booking.id and u.property_id = any(p_ctx.allowed))
$$;

create or replace function public.api_v1_list_bookings(
  p_digest        text,
  p_date_from     date default null,
  p_date_to       date default null,
  p_property_id   bigint default null,
  p_channel       text[] default null,
  p_status        text[] default null,
  p_updated_since timestamptz default null,
  p_after_date    date default null,
  p_after_id      bigint default null,
  p_limit         integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'bookings:read');
begin
  return (
    select coalesce(jsonb_agg(public.api_booking_json(b) order by b.arrival_date, b.id), '[]'::jsonb)
    from (select r.* from public.reservations r
          where r.host_id = v_ctx.host_id
            and public.api_allows_booking(v_ctx, r)
            and (p_date_from is null or r.departure_date >= p_date_from)
            and (p_date_to is null or r.arrival_date <= p_date_to)
            and (p_property_id is null
                 or r.property_id = p_property_id
                 or exists (select 1 from public.reservation_units u
                            where u.reservation_id = r.id and u.property_id = p_property_id))
            and (p_channel is null or public.api_channel(r.channel_id) = any(p_channel))
            and (p_status is null or r.status = any(p_status))
            and (p_updated_since is null or r.updated_at >= p_updated_since)
            and (p_after_id is null or (r.arrival_date, r.id) > (p_after_date, p_after_id))
          order by r.arrival_date, r.id
          limit least(greatest(p_limit, 1), 200) + 1) b);
end;
$$;

create or replace function public.api_v1_get_booking(p_digest text, p_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'bookings:read');
  v_row public.reservations;
begin
  select r.* into v_row from public.reservations r where r.id = p_id and r.host_id = v_ctx.host_id;
  if not found or not public.api_allows_booking(v_ctx, v_row) then
    perform public.api_not_found('Booking');
  end if;
  return public.api_booking_json(v_row);
end;
$$;

-- Metadata only: no storage path, no link. Removed media are left out; purged
-- ones (the file gone by retention) stay, marked so.
create or replace function public.api_v1_list_cleaning_media(p_digest text, p_cleaning_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'media:read');
begin
  if not exists (select 1 from public.tasks tk
                 where tk.id = p_cleaning_id and tk.host_id = v_ctx.host_id
                   and public.api_allows_property(v_ctx, tk.property_id)) then
    perform public.api_not_found('Cleaning');
  end if;
  return (
    select coalesce(jsonb_agg(public.api_media_json(m) order by m.created_at, m.id), '[]'::jsonb)
    from (select tm.* from public.task_media tm
          where tm.task_id = p_cleaning_id and tm.host_id = v_ctx.host_id and tm.deleted_at is null
          order by tm.created_at, tm.id
          limit 500) m);
end;
$$;

create or replace function public.api_v1_list_task_media(p_digest text, p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'media:read');
begin
  if not exists (select 1 from public.problems pb
                 where pb.id = p_task_id and pb.host_id = v_ctx.host_id
                   and (v_ctx.allowed is null or public.api_allows_property(v_ctx, pb.property_id))) then
    perform public.api_not_found('Task');
  end if;
  return (
    select coalesce(jsonb_agg(public.api_media_json(m) order by m.created_at, m.id), '[]'::jsonb)
    from (select tm.* from public.task_media tm
          where tm.problem_id = p_task_id and tm.host_id = v_ctx.host_id and tm.deleted_at is null
          order by tm.created_at, tm.id
          limit 500) m);
end;
$$;

create or replace function public.api_v1_get_settings(p_digest text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'settings:read');
begin
  return (
    select jsonb_build_object(
      'company_id', h.id,
      'company_name', h.name,
      'default_language', h.default_language,
      'video_max_sec', h.video_max_sec,
      'video_max_mb', h.video_max_mb,
      'video_bitrate_kbps', h.video_bitrate_kbps,
      'gallery_allowed', h.gallery_allowed,
      'parallel_start_allowed', h.parallel_start_allowed,
      'updated_at', public.api_ts(h.updated_at))
    from public.hosts h where h.id = v_ctx.host_id);
end;
$$;

-- ---------- 7. writes ----------

/**
 * Claim an idempotency key for this request, or replay what it answered.
 *
 * Null: the key is ours, go on. A row: the stored answer of an earlier request
 * with the same body. The insert waits on a concurrent twin through the
 * primary key, so two retries in flight cannot both run. A failed request
 * rolls its claim back with everything else, so an error is never remembered.
 * Older than 24 hours, a key is free again.
 */
create or replace function public.api_idempotency_claim(
  p_key_id    uuid,
  p_idem_key  text,
  p_operation text,
  p_hash      text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.api_idempotency;
begin
  if p_idem_key is null or p_idem_key !~ '^[\x21-\x7e]{1,255}$' then
    raise exception 'Idempotency-Key is required'
      using errcode = 'invalid_parameter_value', hint = 'api:idempotency-key-required';
  end if;

  insert into public.api_idempotency as i (key_id, idem_key, operation, request_hash)
  values (p_key_id, p_idem_key, p_operation, p_hash)
  on conflict (key_id, idem_key) do update
    set operation = excluded.operation, request_hash = excluded.request_hash,
        status = null, response = null, created_at = now()
    where i.created_at < now() - interval '24 hours';
  if found then
    return null;
  end if;

  select i.* into v_row from public.api_idempotency i
  where i.key_id = p_key_id and i.idem_key = p_idem_key;
  if v_row.operation <> p_operation or v_row.request_hash <> p_hash then
    raise exception 'Idempotency-Key was used with another request'
      using errcode = 'invalid_parameter_value', hint = 'api:idempotency-key-reused';
  end if;
  return jsonb_build_object('status', v_row.status, 'body', v_row.response, 'replayed', true);
end;
$$;

create or replace function public.api_idempotency_store(
  p_key_id   uuid,
  p_idem_key text,
  p_status   integer,
  p_body     jsonb
)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  update public.api_idempotency
  set status = p_status, response = p_body
  where key_id = p_key_id and idem_key = p_idem_key;
  select jsonb_build_object('status', p_status, 'body', p_body, 'replayed', false);
$$;

/**
 * POST /v1/tasks — a task for a technician, written by report_problem as the
 * key's owner, and handed out by assign_problem when an assignee is named.
 */
create or replace function public.api_v1_create_task(
  p_digest          text,
  p_idempotency_key text,
  p_request_hash    text,
  p_title           text,
  p_description     text default null,
  p_priority        text default null,
  p_property_id     bigint default null,
  p_assignee_id     uuid default null,
  p_scheduled_date  date default null,
  p_time_from       time default null,
  p_time_to         time default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ctx     public.api_context := public.api_authorize(p_digest, 'tasks:create');
  v_replay  jsonb;
  v_problem public.problems;
  v_id      uuid := gen_random_uuid();
begin
  if p_assignee_id is not null then
    perform public.api_require(v_ctx, 'tasks:assign');
  elsif p_scheduled_date is not null or p_time_from is not null or p_time_to is not null then
    raise exception 'A day or hours need an assignee'
      using errcode = 'invalid_parameter_value', hint = 'api:invalid-request',
            detail = jsonb_build_object('name', 'assignee_id')::text;
  end if;

  v_replay := public.api_idempotency_claim(v_ctx.key_id, p_idempotency_key, 'createTask', p_request_hash);
  if v_replay is not null then
    return v_replay;
  end if;

  if v_ctx.allowed is not null and not public.api_allows_property(v_ctx, p_property_id) then
    raise exception 'The key may not write on property %', p_property_id
      using errcode = 'insufficient_privilege', hint = 'api:property-not-allowed',
            detail = jsonb_build_object('property_id', p_property_id)::text;
  end if;

  perform public.api_act_as(v_ctx.owner_id);
  v_problem := public.report_problem(v_id, p_title, p_description,
                                     coalesce(p_priority, 'normal')::public.problem_priority,
                                     p_property_id);
  if p_assignee_id is not null then
    v_problem := public.assign_problem(v_id, p_assignee_id, p_scheduled_date, p_time_from, p_time_to);
  end if;

  return public.api_idempotency_store(v_ctx.key_id, p_idempotency_key, 201,
                                      public.api_task_json(v_problem));
end;
$$;

-- POST /v1/tasks/{id}/assign — assign_problem as the key's owner.
create or replace function public.api_v1_assign_task(
  p_digest          text,
  p_idempotency_key text,
  p_request_hash    text,
  p_task_id         uuid,
  p_assignee_id     uuid,
  p_scheduled_date  date default null,
  p_time_from       time default null,
  p_time_to         time default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ctx     public.api_context := public.api_authorize(p_digest, 'tasks:assign');
  v_replay  jsonb;
  v_problem public.problems;
begin
  v_replay := public.api_idempotency_claim(v_ctx.key_id, p_idempotency_key, 'assignTask', p_request_hash);
  if v_replay is not null then
    return v_replay;
  end if;

  select pb.* into v_problem from public.problems pb
  where pb.id = p_task_id and pb.host_id = v_ctx.host_id
    and (v_ctx.allowed is null or public.api_allows_property(v_ctx, pb.property_id));
  if not found then
    perform public.api_not_found('Task');
  end if;

  perform public.api_act_as(v_ctx.owner_id);
  v_problem := public.assign_problem(p_task_id, p_assignee_id, p_scheduled_date, p_time_from, p_time_to);

  return public.api_idempotency_store(v_ctx.key_id, p_idempotency_key, 200,
                                      public.api_task_json(v_problem));
end;
$$;

/**
 * POST /v1/cleanings/{id}/assign — save_task as the key's owner, with every
 * other field as the cleaning has it now: only the executor changes, and the
 * day the form "was opened with" is today's day of the cleaning, so a move
 * made meanwhile is not undone. Null takes the executor off.
 */
create or replace function public.api_v1_assign_cleaning(
  p_digest          text,
  p_idempotency_key text,
  p_request_hash    text,
  p_cleaning_id     uuid,
  p_assignee_id     uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ctx    public.api_context := public.api_authorize(p_digest, 'cleanings:assign');
  v_replay jsonb;
  v_task   public.tasks;
begin
  v_replay := public.api_idempotency_claim(v_ctx.key_id, p_idempotency_key, 'assignCleaning',
                                           p_request_hash);
  if v_replay is not null then
    return v_replay;
  end if;

  select tk.* into v_task from public.tasks tk
  where tk.id = p_cleaning_id and tk.host_id = v_ctx.host_id
    and public.api_allows_property(v_ctx, tk.property_id);
  if not found then
    perform public.api_not_found('Cleaning');
  end if;

  perform public.api_act_as(v_ctx.owner_id);
  v_task := public.save_task(
    p_id              => v_task.id,
    p_property_id     => v_task.property_id,
    p_type            => v_task.type,
    p_scheduled_date  => v_task.scheduled_date,
    p_title           => v_task.title,
    p_assignee_id     => p_assignee_id,
    p_time_from       => v_task.time_from,
    p_time_to         => v_task.time_to,
    p_notes           => v_task.notes,
    p_allow_duplicate => true,
    p_expected_date   => v_task.scheduled_date);

  return public.api_idempotency_store(v_ctx.key_id, p_idempotency_key, 200,
                                      public.api_cleaning_json(v_task));
end;
$$;

-- ---------- 8. keys, for the panel ----------

create or replace function public.api_require_admin()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Only an admin may manage API keys'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.adminOnly';
  end if;
  return (select auth.uid());
end;
$$;

create or replace function public.api_check_key_fields(
  p_host         uuid,
  p_name         text,
  p_preset       text,
  p_scopes       text[],
  p_property_ids bigint[]
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_status text;
  v_missing bigint;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 80 then
    raise exception 'A key needs a name of 1 to 80 characters'
      using errcode = 'check_violation', hint = 'serverErrors.apiKeyNameInvalid';
  end if;
  if p_preset is null or p_preset not in ('read_only', 'operator', 'full', 'custom') then
    raise exception 'Unknown preset %', p_preset
      using errcode = 'check_violation', hint = 'serverErrors.apiPresetInvalid';
  end if;
  foreach v_scope in array coalesce(p_scopes, '{}') loop
    select s.status into v_status from public.api_scopes s where s.id = v_scope;
    if v_status is null then
      raise exception 'Unknown scope %', v_scope
        using errcode = 'check_violation', hint = 'serverErrors.apiScopeUnknown',
              detail = jsonb_build_object('scope', v_scope)::text;
    elsif v_status = 'forbidden' then
      raise exception 'Scope % may never be granted', v_scope
        using errcode = 'check_violation', hint = 'serverErrors.apiScopeForbidden',
              detail = jsonb_build_object('scope', v_scope)::text;
    elsif v_status = 'planned' then
      raise exception 'Scope % is reserved and has no operation yet', v_scope
        using errcode = 'check_violation', hint = 'serverErrors.apiScopeNotYetAvailable',
              detail = jsonb_build_object('scope', v_scope)::text;
    end if;
  end loop;
  if p_preset = 'custom' and cardinality(coalesce(p_scopes, '{}')) = 0 then
    raise exception 'A custom key needs at least one scope'
      using errcode = 'check_violation', hint = 'serverErrors.apiScopesEmpty';
  end if;
  if p_property_ids is not null then
    if cardinality(p_property_ids) = 0 then
      raise exception 'An empty list of properties would allow nothing'
        using errcode = 'check_violation', hint = 'serverErrors.apiPropertiesEmpty';
    end if;
    select x into v_missing
    from unnest(p_property_ids) x
    where not exists (select 1 from public.properties pr where pr.id = x and pr.host_id = p_host)
    limit 1;
    if v_missing is not null then
      raise exception 'Property % is not in this company', v_missing
        using errcode = 'check_violation', hint = 'serverErrors.propertyNotFound';
    end if;
  end if;
end;
$$;

create or replace function public.api_key_fields_json(k public.api_keys)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('name', k.name, 'preset', k.preset, 'scopes', to_jsonb(k.scopes),
                            'property_ids', to_jsonb(k.property_ids),
                            'expires_at', public.api_ts(k.expires_at))
$$;

-- What the panel shows of a key. Never the digest.
create or replace function public.api_key_public_json(k public.api_keys)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public.api_key_fields_json(k) || jsonb_build_object(
    'id', k.id,
    'prefix', k.prefix,
    'state', public.api_key_state(k),
    'effective_scopes', to_jsonb(public.api_effective_scopes(k.preset, k.scopes)),
    'created_by', k.created_by,
    'created_at', public.api_ts(k.created_at),
    'updated_at', public.api_ts(k.updated_at),
    'revoked_at', public.api_ts(k.revoked_at),
    'revoked_by', k.revoked_by,
    'last_used_at', public.api_ts(k.last_used_at))
$$;

/**
 * Called by the Edge Function api-keys only, as service_role, after it has
 * checked the admin's token: the pepper lives there, so the key and its
 * digest are made there. Full access asks for the key's name typed again.
 */
create or replace function public.create_api_key(
  p_actor        uuid,
  p_name         text,
  p_prefix       text,
  p_digest       text,
  p_preset       text,
  p_scopes       text[] default '{}',
  p_property_ids bigint[] default null,
  p_expires_at   timestamptz default null,
  p_confirmation text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_host uuid;
  v_key  public.api_keys;
begin
  select pr.host_id into v_host from public.profiles pr
  where pr.id = p_actor and pr.is_active and pr.role = 'admin';
  if v_host is null then
    raise exception 'Only an admin may manage API keys'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.adminOnly';
  end if;

  perform public.api_check_key_fields(v_host, p_name, p_preset, p_scopes, p_property_ids);
  if p_preset = 'full' and coalesce(btrim(p_confirmation), '') <> btrim(p_name) then
    raise exception 'Full access needs the key''s name typed again'
      using errcode = 'check_violation', hint = 'serverErrors.apiFullAccessUnconfirmed';
  end if;
  if p_expires_at is not null
     and (p_expires_at <= now() or p_expires_at > now() + interval '366 days') then
    raise exception 'A key expires within a year, or never'
      using errcode = 'check_violation', hint = 'serverErrors.apiExpiryInvalid';
  end if;

  insert into public.api_keys (host_id, name, prefix, key_digest, preset, scopes, property_ids,
                               expires_at, created_by)
  values (v_host, btrim(p_name), p_prefix, p_digest, p_preset,
          array(select distinct s from unnest(coalesce(p_scopes, '{}')) s order by s),
          case when p_property_ids is null then null
               else array(select distinct x from unnest(p_property_ids) x order by x) end,
          p_expires_at, p_actor)
  returning * into v_key;

  insert into public.api_key_events (key_id, host_id, actor_id, kind, after)
  values (v_key.id, v_host, p_actor, 'created', public.api_key_fields_json(v_key));

  return public.api_key_public_json(v_key);
end;
$$;

create or replace function public.list_api_keys()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.api_require_admin();
  return (select coalesce(jsonb_agg(public.api_key_public_json(k) order by k.created_at desc, k.id),
                          '[]'::jsonb)
          from public.api_keys k
          where k.host_id = public.current_host_id());
end;
$$;

/**
 * Change what a key may do. Takes effect on the key's next request: scopes
 * and properties are read on every call. Journalled with before and after.
 */
create or replace function public.update_api_key(
  p_id           uuid,
  p_name         text,
  p_preset       text,
  p_scopes       text[],
  p_property_ids bigint[],
  p_confirmation text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := public.api_require_admin();
  v_host   uuid := public.current_host_id();
  v_before public.api_keys;
  v_after  public.api_keys;
begin
  select k.* into v_before from public.api_keys k
  where k.id = p_id and k.host_id = v_host
  for update;
  if not found then
    raise exception 'API key not found'
      using errcode = 'no_data_found', hint = 'serverErrors.apiKeyNotFound';
  end if;
  if v_before.revoked_at is not null then
    raise exception 'A revoked key cannot be changed'
      using errcode = 'check_violation', hint = 'serverErrors.apiKeyRevoked';
  end if;

  perform public.api_check_key_fields(v_host, p_name, p_preset, p_scopes, p_property_ids);
  if p_preset = 'full' and v_before.preset <> 'full'
     and coalesce(btrim(p_confirmation), '') <> btrim(p_name) then
    raise exception 'Full access needs the key''s name typed again'
      using errcode = 'check_violation', hint = 'serverErrors.apiFullAccessUnconfirmed';
  end if;

  update public.api_keys
  set name = btrim(p_name),
      preset = p_preset,
      scopes = array(select distinct s from unnest(coalesce(p_scopes, '{}')) s order by s),
      property_ids = case when p_property_ids is null then null
                          else array(select distinct x from unnest(p_property_ids) x order by x) end
  where id = p_id
  returning * into v_after;

  if public.api_key_fields_json(v_before) is distinct from public.api_key_fields_json(v_after) then
    insert into public.api_key_events (key_id, host_id, actor_id, kind, before, after)
    values (p_id, v_host, v_actor, 'updated',
            public.api_key_fields_json(v_before), public.api_key_fields_json(v_after));
  end if;

  return public.api_key_public_json(v_after);
end;
$$;

create or replace function public.revoke_api_key(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public.api_require_admin();
  v_host  uuid := public.current_host_id();
  v_key   public.api_keys;
begin
  select k.* into v_key from public.api_keys k
  where k.id = p_id and k.host_id = v_host
  for update;
  if not found then
    raise exception 'API key not found'
      using errcode = 'no_data_found', hint = 'serverErrors.apiKeyNotFound';
  end if;
  if v_key.revoked_at is not null then
    return public.api_key_public_json(v_key);
  end if;

  update public.api_keys set revoked_at = now(), revoked_by = v_actor
  where id = p_id
  returning * into v_key;

  insert into public.api_key_events (key_id, host_id, actor_id, kind, before, after)
  values (p_id, v_host, v_actor, 'revoked', null,
          jsonb_build_object('revoked_at', public.api_ts(v_key.revoked_at)));

  return public.api_key_public_json(v_key);
end;
$$;

create or replace function public.list_api_key_events(p_key_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.api_require_admin();
  return (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', e.id, 'kind', e.kind, 'actor_id', e.actor_id,
                    'before', e.before, 'after', e.after,
                    'created_at', public.api_ts(e.created_at)) order by e.created_at desc, e.id desc),
                  '[]'::jsonb)
          from public.api_key_events e
          where e.key_id = p_key_id and e.host_id = public.current_host_id());
end;
$$;

-- ---------- 9. retention ----------

-- 04:05 UTC, a slot no other job holds (03:15 sync … 03:50 webhook purge, 04:30
-- media retention). The request log is kept 90 days, windows and idempotency
-- keys a day.
select cron.schedule(
  'purge-api-records',
  '5 4 * * *',
  $$delete from public.api_request_log where created_at < now() - interval '90 days';
    delete from public.api_rate_windows where window_start < now() - interval '1 day';
    delete from public.api_idempotency where created_at < now() - interval '1 day'$$
);

-- ---------- 10. who may call what ----------

-- Nothing by default, service_role included: the platform hands it every new
-- function, and the helpers (api_act_as above all) are for the operations alone.

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'api\_%' or p.proname in ('create_api_key', 'list_api_keys',
           'update_api_key', 'revoke_api_key', 'list_api_key_events'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end $$;

-- The Edge Function `api`: the gate, the log and the operations.
grant execute on function public.api_gate(text, text) to service_role;
grant execute on function public.api_log_request(uuid, text, text, integer, integer, text, uuid)
  to service_role;
grant execute on function public.api_v1_get_me(text) to service_role;
grant execute on function public.api_v1_list_properties(text, text[], bigint, timestamptz, bigint, integer)
  to service_role;
grant execute on function public.api_v1_get_property(text, bigint) to service_role;
grant execute on function public.api_v1_list_cleanings(text, date, date, bigint, uuid, text[], text[],
  timestamptz, date, uuid, integer) to service_role;
grant execute on function public.api_v1_get_cleaning(text, uuid) to service_role;
grant execute on function public.api_v1_list_tasks(text, text[], text[], bigint, uuid, timestamptz,
  timestamptz, boolean, timestamptz, timestamptz, uuid, integer) to service_role;
grant execute on function public.api_v1_get_task(text, uuid) to service_role;
grant execute on function public.api_v1_list_staff(text, text[], boolean, uuid, integer) to service_role;
grant execute on function public.api_v1_get_staff_member(text, uuid) to service_role;
grant execute on function public.api_v1_list_bookings(text, date, date, bigint, text[], text[],
  timestamptz, date, bigint, integer) to service_role;
grant execute on function public.api_v1_get_booking(text, bigint) to service_role;
grant execute on function public.api_v1_list_cleaning_media(text, uuid) to service_role;
grant execute on function public.api_v1_list_task_media(text, uuid) to service_role;
grant execute on function public.api_v1_get_settings(text) to service_role;
grant execute on function public.api_v1_create_task(text, text, text, text, text, text, bigint, uuid,
  date, time, time) to service_role;
grant execute on function public.api_v1_assign_task(text, text, text, uuid, uuid, date, time, time)
  to service_role;
grant execute on function public.api_v1_assign_cleaning(text, text, text, uuid, uuid) to service_role;

-- The Edge Function `api-keys`, after checking the admin's token.
grant execute on function public.create_api_key(uuid, text, text, text, text, text[], bigint[],
  timestamptz, text) to service_role;

-- The panel, as the admin: the functions check the role themselves.
grant execute on function public.list_api_keys() to authenticated;
grant execute on function public.update_api_key(uuid, text, text, text[], bigint[], text)
  to authenticated;
grant execute on function public.revoke_api_key(uuid) to authenticated;
grant execute on function public.list_api_key_events(uuid) to authenticated;
