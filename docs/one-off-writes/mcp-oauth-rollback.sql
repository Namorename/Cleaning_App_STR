-- Rollback of 20261109120000_mcp_oauth (docs/rollout/mcp-oauth-1109.md): only by the
-- owner's word, never in 03:00–04:40 UTC, after the functions are back to their
-- previous versions (oauth deleted, mcp and api redeployed from before the change).
-- Then: npx supabase migration repair --status reverted 20261109120000 --linked
--
-- One statement (the CLI runs one): a do block. It removes every OAuth
-- connection — their keys, journal rows and idempotency rows; their request
-- log rows stay, without a key — and the three tables, restores api_keys to
-- what it was, and puts back the gate, the key lookup and the panel's view of a
-- key exactly as 20261028100000 made them.
do $rollback$
begin
  lock table public.api_keys in access exclusive mode;

  drop table public.oauth_tokens;
  drop table public.oauth_codes;
  drop table public.oauth_clients;

  update public.api_request_log set key_id = null
  where key_id in (select id from public.api_keys where kind = 'oauth');
  delete from public.api_idempotency where key_id in (select id from public.api_keys where kind = 'oauth');
  delete from public.api_key_events where key_id in (select id from public.api_keys where kind = 'oauth');
  delete from public.api_keys where kind = 'oauth';

  drop function public.oauth_authorize(text, text, text, text, text, text, text, text[], bigint[], timestamptz);
  drop function public.oauth_client(text);
  drop function public.oauth_register_client(text, text[], text);
  drop function public.oauth_issue_tokens(text, text, text, text, text, text, text);
  drop function public.oauth_refresh_tokens(text, text, text, text);
  drop function public.oauth_store_tokens(public.api_keys, text, text);
  drop function public.oauth_end_connection(uuid, text);
  drop function public.oauth_redirect_allowed(text[], text);
  drop function public.oauth_redirect_safe(text);

  drop function public.api_gate(text, text, text);

create or replace function public.api_gate(p_digest text, p_ip_hash text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
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

  if p_digest is not null then
    select k.* into v_key from public.api_keys k where k.key_digest = p_digest;
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

  return jsonb_build_object('ok', true, 'key_id', v_key.id, 'digest', v_key.key_digest,
                            'limit', c_key_limit, 'remaining', greatest(c_key_limit - v_hits, 0),
                            'reset', v_reset);
end;
$fn$;

create or replace function public.api_authorize(p_digest text, p_scope text)
returns public.api_context
language plpgsql
stable
security definer
set search_path = ''
as $fn$
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
$fn$;

create or replace function public.api_key_public_json(k public.api_keys)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $fn$
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
$fn$;

  drop function public.api_key_by_digest(text, boolean);

  alter table public.api_keys drop constraint api_keys_secret_by_kind;
  alter table public.api_keys
    drop column kind,
    drop column oauth_client_id,
    drop column oauth_client_name,
    drop column oauth_redirect_uri;
  alter table public.api_keys
    alter column prefix set not null,
    alter column key_digest set not null;

  revoke all on function public.api_gate(text, text) from public, anon, authenticated, service_role;
  grant execute on function public.api_gate(text, text) to service_role;
  revoke all on function public.api_authorize(text, text) from public, anon, authenticated, service_role;
  revoke all on function public.api_key_public_json(public.api_keys) from public, anon, authenticated, service_role;
end
$rollback$;
