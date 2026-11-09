-- Sign-in to the MCP server by OAuth 2.1 (docs/mcp-oauth.md).
--
-- Claude's connectors (claude.ai, Desktop, mobile) reach a remote MCP server
-- only through OAuth, and Claude Code prefers it to a pasted key. An OAuth
-- connection is an API key without a secret of its own: a row of api_keys of
-- kind 'oauth', with the same preset, scopes, properties, expiry, journal, rate
-- window and request log, listed, changed and revoked in Settings → API like
-- any key, and working only while the admin who allowed it is an active admin.
-- Its secrets are the tokens the authorization server issues and rotates
-- (oauth_tokens): an access token for an hour, a refresh token for 90 days
-- since it was last used. Only the MCP server takes them (api_gate's channel);
-- the REST API refuses them.
--
-- The authorization server is split three ways: the panel (its metadata, and
-- the consent page where an admin chooses what the connection may do), the
-- database (codes, tokens, registered clients) and the Edge Function oauth
-- (token exchange and dynamic registration: the pepper lives there).
--
-- Adds only: no existing row changes. api_keys gains four columns (existing
-- keys become kind 'key'), and its prefix and digest may be empty for kind
-- 'oauth' alone.

-- ---------- 1. a connection is a key of its own kind ----------

alter table public.api_keys
  add column kind text not null default 'key' check (kind in ('key', 'oauth')),
  -- The client as it named itself: a URL (a Client ID Metadata Document) or the
  -- id dynamic registration gave it.
  add column oauth_client_id text
    check (oauth_client_id is null or length(oauth_client_id) between 1 and 2048),
  add column oauth_client_name text
    check (oauth_client_name is null or length(oauth_client_name) between 1 and 100),
  -- Where the admin's browser was sent back: tells the panel which program it was.
  add column oauth_redirect_uri text
    check (oauth_redirect_uri is null or length(oauth_redirect_uri) between 1 and 2048);

alter table public.api_keys
  alter column prefix drop not null,
  alter column key_digest drop not null;

alter table public.api_keys add constraint api_keys_secret_by_kind check (
  case kind
    when 'key' then prefix is not null and key_digest is not null and oauth_client_id is null
    else prefix is null and key_digest is null
         and oauth_client_id is not null and oauth_redirect_uri is not null
  end);

comment on column public.api_keys.kind is
  'key: a secret shown once (create_api_key). oauth: a connection allowed on the consent page; '
  'its tokens are in oauth_tokens (20261109120000).';

-- ---------- 2. clients, codes and tokens ----------

-- Clients registered dynamically (RFC 7591). Claude names itself by a URL
-- instead (a Client ID Metadata Document) and is never stored here.
create table public.oauth_clients (
  client_id     text primary key check (client_id ~ '^woomc_[0-9a-f]{32}$'),
  client_name   text check (client_name is null or length(client_name) between 1 and 100),
  redirect_uris text[] not null
    check (cardinality(redirect_uris) between 1 and 5 and array_position(redirect_uris, null) is null),
  -- HMAC of the registering address, to count registrations by it.
  ip_hash       text check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index oauth_clients_created_idx on public.oauth_clients (created_at);
create index oauth_clients_ip_idx on public.oauth_clients (ip_hash, created_at);

comment on table public.oauth_clients is
  'OAuth clients registered dynamically (docs/mcp-oauth.md). Written by oauth_register_client only.';

-- What the admin allowed, until the client trades it for tokens (ten minutes,
-- once). The code itself is never kept: its sha256 is.
create table public.oauth_codes (
  code_digest    text primary key check (code_digest ~ '^[0-9a-f]{64}$'),
  host_id        uuid not null references public.hosts (id),
  created_by     uuid not null references public.profiles (id),
  client_id      text not null check (length(client_id) between 1 and 2048),
  client_name    text check (client_name is null or length(client_name) between 1 and 100),
  redirect_uri   text not null check (length(redirect_uri) between 1 and 2048),
  code_challenge text not null check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  resource       text not null check (length(resource) between 1 and 2048),
  name           text not null,
  preset         text not null,
  scopes         text[] not null,
  property_ids   bigint[],
  key_expires_at timestamptz,
  expires_at     timestamptz not null,
  used_at        timestamptz,
  key_id         uuid references public.api_keys (id),
  created_at     timestamptz not null default now()
);

create index oauth_codes_expires_idx on public.oauth_codes (expires_at);
create index oauth_codes_key_idx on public.oauth_codes (key_id) where key_id is not null;
create index oauth_codes_created_by_idx on public.oauth_codes (created_by);
create index oauth_codes_host_idx on public.oauth_codes (host_id);

comment on table public.oauth_codes is
  'Authorization codes (docs/mcp-oauth.md): sha256 of the code, what the admin allowed, '
  'the PKCE challenge. Written by oauth_authorize, spent by oauth_issue_tokens.';

-- HMAC-SHA256(API_KEY_PEPPER, token), as for keys: a copy of the table yields
-- no token and tests no guess.
create table public.oauth_tokens (
  digest     text primary key check (digest ~ '^[0-9a-f]{64}$'),
  key_id     uuid not null references public.api_keys (id),
  kind       text not null check (kind in ('access', 'refresh')),
  expires_at timestamptz not null,
  -- A refresh token's: when it was traded for the next pair.
  used_at    timestamptz check (used_at is null or kind = 'refresh'),
  created_at timestamptz not null default now()
);

create index oauth_tokens_key_idx on public.oauth_tokens (key_id, kind);
create index oauth_tokens_expires_idx on public.oauth_tokens (expires_at);

comment on table public.oauth_tokens is
  'Access and refresh tokens of OAuth connections (docs/mcp-oauth.md), as digests only.';

alter table public.oauth_clients enable row level security;
alter table public.oauth_codes   enable row level security;
alter table public.oauth_tokens  enable row level security;

revoke all on table public.oauth_clients, public.oauth_codes, public.oauth_tokens
  from public, anon, authenticated;

-- ---------- 3. the key behind a digest ----------

/**
 * The key a digest stands for: a key's own digest, or — when the caller takes
 * OAuth tokens — a live access token of a connection. A row of nulls when
 * neither; api_key_state calls that 'invalid'.
 */
create or replace function public.api_key_by_digest(p_digest text, p_oauth boolean)
returns public.api_keys
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys;
begin
  if p_digest is null then
    return v_key;
  end if;
  select k.* into v_key from public.api_keys k where k.key_digest = p_digest;
  if found or not coalesce(p_oauth, false) then
    return v_key;
  end if;
  select k.* into v_key
  from public.oauth_tokens t
  join public.api_keys k on k.id = t.key_id
  where t.digest = p_digest and t.kind = 'access' and t.expires_at > now();
  return v_key;
end;
$$;

/**
 * The key behind a digest, checked, with the scope the operation needs.
 *
 * Raises with an `api:` hint the Edge Function turns into problem+json: a key
 * gone bad between the gate and the operation answers 401, a missing scope 403
 * with the scope named. Takes an OAuth access token too: which channel may
 * use one is the gate's question, and every request passes the gate first.
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
  v_key := public.api_key_by_digest(p_digest, true);
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

-- ---------- 4. the gate learns the channel ----------

-- A new argument with a default: between the push and the deploy the old api
-- and mcp functions call the gate with two arguments, and get the REST API's
-- answer — no OAuth token, exactly as before.
drop function public.api_gate(text, text);

/**
 * Every request passes here first, in its own transaction, so that the counters
 * it moves stay moved whatever the operation does next.
 *
 * Answers {ok: false, code, retry_after?} rather than raising: a failed
 * authentication counts against the IP, and a raise would roll the count back.
 * The key is looked up first: a working key is never held up by its address —
 * a shared NAT, or somebody sending bad keys under a forged header, must not
 * lock it out. Only failures count, and they are counted before they are
 * compared, so a burst of them cannot slip past the check together.
 * On success: the key's id and digest (compared again in the function in
 * constant time) and the key's rate window.
 *
 * p_channel: 'mcp' takes OAuth access tokens as well as keys; null or 'api'
 * (the REST API) takes keys only — a token issued for the MCP server is valid
 * there alone (MCP authorization, audience).
 */
create function public.api_gate(p_digest text, p_ip_hash text, p_channel text default null)
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
  if p_channel is not null and p_channel not in ('api', 'mcp') then
    raise exception 'Unknown channel %', p_channel using errcode = 'invalid_parameter_value';
  end if;

  if p_digest is not null then
    v_key := public.api_key_by_digest(p_digest, p_channel = 'mcp');
  end if;
  v_state := case when p_digest is null then 'missing' else public.api_key_state(v_key) end;

  if v_state <> 'active' then
    if p_ip_hash is not null then
      insert into public.api_rate_windows as w (bucket, window_start, hits)
      values ('ip:' || p_ip_hash, v_ip_window, 1)
      on conflict (bucket, window_start) do update set hits = w.hits + 1
      returning w.hits into v_ip_hits;
      if v_ip_hits > c_ip_limit then
        return jsonb_build_object(
          'ok', false, 'code', 'rate-limited',
          'retry_after', greatest(1, ceil(extract(epoch from v_ip_window + interval '10 minutes' - now()))::integer));
      end if;
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

  -- A connection has no digest of its own: the token's matched by equality.
  return jsonb_build_object('ok', true, 'key_id', v_key.id,
                            'digest', coalesce(v_key.key_digest, p_digest),
                            'limit', c_key_limit, 'remaining', greatest(c_key_limit - v_hits, 0),
                            'reset', v_reset);
end;
$$;

-- What the panel shows of a key. Never the digest. A connection adds who it
-- was given to: the client's name, its id and where it sent the admin back.
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
    'kind', k.kind,
    'client_name', k.oauth_client_name,
    'client_id', k.oauth_client_id,
    'redirect_uri', k.oauth_redirect_uri,
    'state', public.api_key_state(k),
    'effective_scopes', to_jsonb(public.api_effective_scopes(k.preset, k.scopes)),
    'created_by', k.created_by,
    'created_at', public.api_ts(k.created_at),
    'updated_at', public.api_ts(k.updated_at),
    'revoked_at', public.api_ts(k.revoked_at),
    'revoked_by', k.revoked_by,
    'last_used_at', public.api_ts(k.last_used_at))
$$;

-- ---------- 5. the authorization server's database half ----------

/**
 * Is this redirect one the client registered? Exactly, or — for a program on
 * this computer (RFC 8252 §7.3) — the same loopback address on any port:
 * Claude Code listens on a port that changes every session.
 */
create or replace function public.oauth_redirect_allowed(p_registered text[], p_redirect text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_redirect is not null and (
    p_redirect = any(p_registered)
    or (p_redirect ~ '^http://(localhost|127\.0\.0\.1|\[::1\])(:[0-9]{1,5})?(/|$)'
        and regexp_replace(p_redirect, '^(http://(localhost|127\.0\.0\.1|\[::1\])):[0-9]{1,5}', '\1')
            = any(array(select regexp_replace(r, '^(http://(localhost|127\.0\.0\.1|\[::1\])):[0-9]{1,5}', '\1')
                        from unnest(p_registered) r))))
$$;

/** A dynamically registered client, for the consent page and the token endpoint. Nothing secret. */
create or replace function public.oauth_client(p_client_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('client_id', c.client_id, 'client_name', c.client_name,
                            'redirect_uris', to_jsonb(c.redirect_uris))
  from public.oauth_clients c
  where c.client_id = p_client_id
$$;

/**
 * Dynamic client registration (RFC 7591), called by the Edge Function oauth,
 * which has checked the shape of every redirect URI. Public clients only (no
 * secret). Answers {ok: false, code: 'rate-limited'} past 20 registrations an
 * hour from one address or 200 from all; a client never used in a week goes.
 */
create or replace function public.oauth_register_client(
  p_client_name   text,
  p_redirect_uris text[],
  p_ip_hash       text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  c_per_ip constant integer := 20;
  c_all    constant integer := 200;
  v_client public.oauth_clients;
begin
  if p_ip_hash is not null and p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'The IP hash is malformed' using errcode = 'invalid_parameter_value';
  end if;
  if p_redirect_uris is null or cardinality(p_redirect_uris) not between 1 and 5
     or exists (select 1 from unnest(p_redirect_uris) r where r is null or length(r) not between 1 and 2048) then
    raise exception 'A client registers one to five redirect URIs' using errcode = 'invalid_parameter_value';
  end if;

  if (select count(*) from public.oauth_clients c where c.created_at > now() - interval '1 hour') >= c_all
     or (p_ip_hash is not null
         and (select count(*) from public.oauth_clients c
              where c.ip_hash = p_ip_hash and c.created_at > now() - interval '1 hour') >= c_per_ip) then
    return jsonb_build_object('ok', false, 'code', 'rate-limited');
  end if;

  delete from public.oauth_clients c
  where c.last_used_at is null and c.created_at < now() - interval '7 days';

  insert into public.oauth_clients (client_id, client_name, redirect_uris, ip_hash)
  values ('woomc_' || replace(gen_random_uuid()::text, '-', ''),
          nullif(left(btrim(coalesce(p_client_name, '')), 100), ''),
          p_redirect_uris, p_ip_hash)
  returning * into v_client;

  return jsonb_build_object('ok', true, 'client_id', v_client.client_id,
                            'client_name', v_client.client_name,
                            'redirect_uris', to_jsonb(v_client.redirect_uris),
                            'client_id_issued_at', floor(extract(epoch from v_client.created_at))::bigint);
end;
$$;

/**
 * The admin's «Allow» on the consent page: what the connection may do, for
 * which client, sent back where. Answers the code, once; only its sha256 is
 * kept, for ten minutes. A registered client's redirect is checked against its
 * registration here; a client named by a URL was checked by the page against
 * the document at that URL (the database cannot fetch it). A connection gets
 * read only or operator, with sensitive scopes added by hand; full access and
 * a custom set are a change in Settings → API afterwards, as for a key.
 */
create or replace function public.oauth_authorize(
  p_client_id      text,
  p_client_name    text,
  p_redirect_uri   text,
  p_code_challenge text,
  p_resource       text,
  p_name           text,
  p_preset         text,
  p_scopes         text[] default '{}',
  p_property_ids   bigint[] default null,
  p_expires_at     timestamptz default null
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
  v_client public.oauth_clients;
  v_code   text;
begin
  if p_client_id is null or length(p_client_id) not between 1 and 2048
     or p_redirect_uri is null or length(p_redirect_uri) not between 1 and 2048
     or p_resource is null or length(p_resource) not between 1 and 2048
     or p_code_challenge is null or p_code_challenge !~ '^[A-Za-z0-9_-]{43}$'
     or (p_client_name is not null and length(p_client_name) not between 1 and 100) then
    raise exception 'The authorization request is malformed'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.oauthRequestInvalid';
  end if;

  if p_client_id like 'woomc\_%' then
    select c.* into v_client from public.oauth_clients c where c.client_id = p_client_id;
    if not found then
      raise exception 'Unknown OAuth client'
        using errcode = 'no_data_found', hint = 'serverErrors.oauthClientUnknown';
    end if;
    if not public.oauth_redirect_allowed(v_client.redirect_uris, p_redirect_uri) then
      raise exception 'The redirect URI is not one the client registered'
        using errcode = 'check_violation', hint = 'serverErrors.oauthRedirectInvalid';
    end if;
  elsif p_client_id !~ '^https://' then
    raise exception 'Unknown OAuth client'
      using errcode = 'no_data_found', hint = 'serverErrors.oauthClientUnknown';
  end if;

  if p_preset is null or p_preset not in ('read_only', 'operator') then
    raise exception 'A connection starts as read only or operator'
      using errcode = 'check_violation', hint = 'serverErrors.apiPresetInvalid';
  end if;
  perform public.api_check_key_fields(v_host, p_name, p_preset, p_scopes, p_property_ids);
  if p_expires_at is not null
     and (p_expires_at <= now() or p_expires_at > now() + interval '366 days') then
    raise exception 'A key expires within a year, or never'
      using errcode = 'check_violation', hint = 'serverErrors.apiExpiryInvalid';
  end if;

  -- 244 random bits (two version-4 UUIDs from the server's strong source).
  v_code := 'woomcd_' || replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

  insert into public.oauth_codes (code_digest, host_id, created_by, client_id, client_name, redirect_uri,
                                  code_challenge, resource, name, preset, scopes, property_ids,
                                  key_expires_at, expires_at)
  values (encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), v_host, v_actor, p_client_id,
          nullif(btrim(coalesce(p_client_name, '')), ''), p_redirect_uri, p_code_challenge, p_resource,
          btrim(p_name), p_preset,
          array(select distinct s from unnest(coalesce(p_scopes, '{}')) s order by s),
          case when p_property_ids is null then null
               else array(select distinct x from unnest(p_property_ids) x order by x) end,
          p_expires_at, now() + interval '10 minutes');

  delete from public.oauth_codes c
  where c.code_digest in (select o.code_digest from public.oauth_codes o
                          where o.expires_at < now() - interval '1 day' limit 500);

  return jsonb_build_object('code', v_code);
end;
$$;

/** A connection ends at once, journalled with why: a code or refresh token came back twice. */
create or replace function public.oauth_end_connection(p_key uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_key public.api_keys;
begin
  update public.api_keys set revoked_at = now()
  where id = p_key and kind = 'oauth' and revoked_at is null
  returning * into v_key;
  if found then
    insert into public.api_key_events (key_id, host_id, actor_id, kind, after)
    values (v_key.id, v_key.host_id, null, 'revoked', jsonb_build_object('reason', p_reason));
  end if;
  delete from public.oauth_tokens t where t.key_id = p_key;
end;
$$;

/** A connection's two tokens: an hour, and 90 days since the last refresh — never past the connection's own end. */
create or replace function public.oauth_store_tokens(
  p_key            public.api_keys,
  p_access_digest  text,
  p_refresh_digest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_access_until timestamptz := least(now() + interval '1 hour', coalesce(p_key.expires_at, 'infinity'));
begin
  if p_access_digest !~ '^[0-9a-f]{64}$' or p_refresh_digest !~ '^[0-9a-f]{64}$'
     or p_access_digest = p_refresh_digest then
    raise exception 'A token digest is malformed' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.oauth_tokens (digest, key_id, kind, expires_at)
  values (p_access_digest, p_key.id, 'access', v_access_until),
         (p_refresh_digest, p_key.id, 'refresh',
          least(now() + interval '90 days', coalesce(p_key.expires_at, 'infinity')));

  delete from public.oauth_tokens t
  where t.digest in (select o.digest from public.oauth_tokens o
                     where o.expires_at < now() - interval '1 day' limit 500);

  return jsonb_build_object('ok', true,
                            'expires_in', greatest(1, floor(extract(epoch from v_access_until - now())))::integer);
end;
$$;

/**
 * The token endpoint's authorization_code grant (the Edge Function oauth, as
 * service_role). The function sends sha256 of the code, the PKCE challenge it
 * computed from the verifier (S256), and the digests of the two tokens it made.
 * Answers {ok: false, error} with an RFC 6749 code rather than raising: a
 * code that comes back after it was spent ends the connection made with it
 * (OAuth 2.1 §4.1.3), and that must commit.
 */
create or replace function public.oauth_issue_tokens(
  p_code_digest    text,
  p_client_id      text,
  p_redirect_uri   text,
  p_challenge      text,
  p_resource       text,
  p_access_digest  text,
  p_refresh_digest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_code public.oauth_codes;
  v_key  public.api_keys;
begin
  select c.* into v_code from public.oauth_codes c where c.code_digest = p_code_digest for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;
  if v_code.used_at is not null then
    if v_code.key_id is not null then
      perform public.oauth_end_connection(v_code.key_id, 'code_reused');
    end if;
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;
  if v_code.expires_at <= now()
     or p_client_id is distinct from v_code.client_id
     or p_redirect_uri is distinct from v_code.redirect_uri
     or p_challenge is distinct from v_code.code_challenge then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;
  if p_resource is not null and p_resource <> v_code.resource then
    return jsonb_build_object('ok', false, 'error', 'invalid_target');
  end if;
  -- The admin who allowed it is still one, and what he chose has not run out.
  if not exists (select 1 from public.profiles pr
                 where pr.id = v_code.created_by and pr.host_id = v_code.host_id
                   and pr.is_active and pr.role = 'admin')
     or (v_code.key_expires_at is not null and v_code.key_expires_at <= now()) then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;

  insert into public.api_keys (host_id, kind, name, preset, scopes, property_ids, expires_at, created_by,
                               oauth_client_id, oauth_client_name, oauth_redirect_uri)
  values (v_code.host_id, 'oauth', v_code.name, v_code.preset, v_code.scopes, v_code.property_ids,
          v_code.key_expires_at, v_code.created_by,
          v_code.client_id, v_code.client_name, v_code.redirect_uri)
  returning * into v_key;

  insert into public.api_key_events (key_id, host_id, actor_id, kind, after)
  values (v_key.id, v_key.host_id, v_code.created_by, 'created',
          public.api_key_fields_json(v_key)
            || jsonb_build_object('client_name', v_key.oauth_client_name, 'client_id', v_key.oauth_client_id));

  update public.oauth_codes set used_at = now(), key_id = v_key.id where code_digest = p_code_digest;
  update public.oauth_clients set last_used_at = now() where client_id = v_code.client_id;

  return public.oauth_store_tokens(v_key, p_access_digest, p_refresh_digest);
end;
$$;

/**
 * The token endpoint's refresh_token grant. The refresh token is spent and a
 * new pair made (rotation, OAuth 2.1 §4.3.1). One that comes back within a
 * minute gets a pair of its own — two refreshes in flight at once are the
 * client's own; one that comes back later was copied, and the connection ends.
 */
create or replace function public.oauth_refresh_tokens(
  p_refresh_digest     text,
  p_client_id          text,
  p_access_digest      text,
  p_new_refresh_digest text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_token public.oauth_tokens;
  v_key   public.api_keys;
begin
  select t.* into v_token from public.oauth_tokens t
  where t.digest = p_refresh_digest and t.kind = 'refresh'
  for update;
  if not found or v_token.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;

  select k.* into v_key from public.api_keys k where k.id = v_token.key_id for update;
  if public.api_key_state(v_key) <> 'active'
     or (p_client_id is not null and p_client_id is distinct from v_key.oauth_client_id) then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;

  if v_token.used_at is null then
    update public.oauth_tokens set used_at = now() where digest = p_refresh_digest;
  elsif v_token.used_at <= now() - interval '1 minute' then
    perform public.oauth_end_connection(v_key.id, 'refresh_token_reused');
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;

  return public.oauth_store_tokens(v_key, p_access_digest, p_new_refresh_digest);
end;
$$;

-- ---------- 6. who may call what ----------

do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'oauth\_%'
           or p.proname in ('api_key_by_digest', 'api_authorize', 'api_gate', 'api_key_public_json'))
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', v_fn);
  end loop;
end $$;

-- The Edge Functions api and mcp: the gate.
grant execute on function public.api_gate(text, text, text) to service_role;
-- The Edge Function oauth: registration and the two grants of the token endpoint.
grant execute on function public.oauth_register_client(text, text[], text) to service_role;
grant execute on function public.oauth_issue_tokens(text, text, text, text, text, text, text) to service_role;
grant execute on function public.oauth_refresh_tokens(text, text, text, text) to service_role;
-- The panel's consent page, as the admin.
grant execute on function public.oauth_client(text) to authenticated, service_role;
grant execute on function public.oauth_authorize(text, text, text, text, text, text, text, text[], bigint[],
  timestamptz) to authenticated;
