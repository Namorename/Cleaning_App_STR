-- Sign-in to the MCP server by OAuth 2.1 (docs/mcp-oauth.md, 20261109120000).
-- Run: npm run test:rls. Runs inside a transaction and rolls back.
--
-- What is being protected:
--   * only an admin allows a connection, and only for a redirect the client
--     registered (a loopback one on any port);
--   * a code is kept as its sha256 only, lives ten minutes, works once, binds
--     the client, the redirect, the PKCE challenge and the resource — and a
--     code that comes back ends the connection made with it;
--   * a connection is a key of kind 'oauth': the same scopes, properties,
--     journal and revocation, working while its admin is an active admin;
--   * its access token works for the MCP server alone, an hour at most and
--     never past the connection's end; the REST API refuses it;
--   * a refresh token is spent on use; a second use within a minute gets a
--     pair of its own, a later one ends the connection;
--   * no client role touches the tables; the panel calls two functions.
--
-- Fixture ids live in the 900911xxx range and under b11….
begin;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.raises(label text, stmt text, want_hint text)
returns void language plpgsql as $$
declare
  v_hint  text;
  v_state text;
begin
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
    if nullif(v_hint, '') is distinct from want_hint then
      raise exception 'FAIL % — hint %, want % (%)', label, v_hint, want_hint, v_state;
    end if;
    raise notice 'ok  %', label;
    return;
  end;
  raise exception 'FAIL % — no error, want %', label, want_hint;
end $$;

-- A digest as the Edge Function would send it: sha256 of a name stands in for
-- HMAC(pepper, token) — the database never sees the pepper.
create or replace function pg_temp.d(t text) returns text language sql as $$
  select encode(sha256(convert_to(t, 'UTF8')), 'hex')
$$;

-- A PKCE challenge of the right shape: 43 base64url characters.
create or replace function pg_temp.ch(t text) returns text language sql as $$
  select left(translate(encode(sha256(convert_to(t, 'UTF8')), 'base64'), '+/=', '-_'), 43)
$$;

create or replace function pg_temp.as_user(p_id uuid) returns void language sql as $$
  select set_config('request.jwt.claims',
                    json_build_object('sub', p_id, 'role', 'authenticated')::text, true),
         set_config('request.jwt.claim.sub', p_id::text, true);
$$;

create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('request.jwt.claims', '', true),
         set_config('request.jwt.claim.sub', '', true),
         set_config('request.jwt.claim.role', '', true);
$$;

-- The admin's «Allow» for Claude, as the consent page sends it.
create or replace function pg_temp.allow_claude(p_name text, p_preset text default 'read_only',
                                                 p_expires timestamptz default null)
returns text language sql as $$
  select (public.oauth_authorize(
    'https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude',
    'https://claude.ai/api/mcp/auth_callback', pg_temp.ch(p_name),
    'https://project.supabase.co/functions/v1/mcp', p_name, p_preset, '{}', null, p_expires)) ->> 'code'
$$;

-- The token endpoint's code grant for a code allowed by allow_claude.
create or replace function pg_temp.redeem(p_code text, p_name text, p_access text, p_refresh text)
returns jsonb language sql as $$
  select public.oauth_issue_tokens(
    pg_temp.d(p_code), 'https://claude.ai/oauth/mcp-oauth-client-metadata',
    'https://claude.ai/api/mcp/auth_callback', pg_temp.ch(p_name),
    'https://project.supabase.co/functions/v1/mcp', pg_temp.d(p_access), pg_temp.d(p_refresh))
$$;

create or replace function pg_temp.gate(p_token text, p_channel text default 'mcp')
returns text language sql as $$
  select coalesce(g ->> 'code', 'ok') from public.api_gate(pg_temp.d(p_token), null, p_channel) g
$$;

-- ---------- fixtures ----------

insert into public.hosts (id, name) values
  ('b1100000-0000-4000-8000-00000000000a', 'Host A'),
  ('b1100000-0000-4000-8000-00000000000b', 'Host B');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b1100001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','ada.oauth@test.local','x',now(),now(),
   '{"full_name":"Ada Admin"}'::jsonb, '{"role":"admin"}'::jsonb),
  ('b1100002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','alan.oauth@test.local','x',now(),now(),
   '{"full_name":"Alan Admin"}'::jsonb, '{"role":"admin"}'::jsonb),
  ('b1100003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','mia.oauth@test.local','x',now(),now(),
   '{"full_name":"Mia Manager"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b1100006-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','bob.oauth@test.local','x',now(),now(),
   '{"full_name":"Bob Admin"}'::jsonb, '{"role":"admin"}'::jsonb);

update public.profiles set host_id = 'b1100000-0000-4000-8000-00000000000a'
where id in ('b1100001-0000-4000-8000-000000000001', 'b1100002-0000-4000-8000-000000000002',
             'b1100003-0000-4000-8000-000000000003');
update public.profiles set host_id = 'b1100000-0000-4000-8000-00000000000b'
where id = 'b1100006-0000-4000-8000-000000000006';

insert into public.properties (id, host_id, name, timezone) values
  (900911001, 'b1100000-0000-4000-8000-00000000000a', 'House', 'Europe/Prague'),
  (900911901, 'b1100000-0000-4000-8000-00000000000b', 'Other Co Flat', 'Europe/Prague');

-- A key made the old way, to show it keeps working beside connections.
select public.create_api_key('b1100001-0000-4000-8000-000000000001', 'Plain key', 'woom_plainAA',
                             pg_temp.d('key-plain'), 'read_only') is not null as made \gset

-- ---------- 1. dynamic registration ----------

select public.oauth_register_client('Cursor', '{http://127.0.0.1/callback,cursor://anysphere/cb}',
                                    pg_temp.d('ip-a')) as reg \gset
select pg_temp.check('a client registers and gets an id of our shape',
  (:'reg'::jsonb ->> 'client_id') ~ '^woomc_[0-9a-f]{32}$' and (:'reg'::jsonb ->> 'ok') = 'true', true);
select (:'reg'::jsonb ->> 'client_id') as dcr \gset
select pg_temp.check('its registration reads back, nothing secret in it',
  (select public.oauth_client(:'dcr') ->> 'client_name'), 'Cursor');
select pg_temp.check('an unknown client reads as nothing',
  public.oauth_client('woomc_00000000000000000000000000000000'), null::jsonb);
select pg_temp.raises('a registration may not name a scheme a browser runs',
  $$select public.oauth_register_client('x', '{javascript:alert(1)}')$$, 'serverErrors.oauthRedirectInvalid');
select pg_temp.raises('six redirect URIs are too many',
  $$select public.oauth_register_client('x', '{https://a/1,https://a/2,https://a/3,https://a/4,https://a/5,https://a/6}')$$,
  'serverErrors.oauthRedirectInvalid');
select public.oauth_register_client('Spam ' || n, '{https://spam.example/cb}', pg_temp.d('ip-spam'))
from generate_series(1, 20) n;
select pg_temp.check('the 21st registration from one address in an hour waits',
  (select public.oauth_register_client('Spam 21', '{https://spam.example/cb}', pg_temp.d('ip-spam')) ->> 'code'),
  'rate-limited');
select pg_temp.check('another address still registers',
  (select public.oauth_register_client('Fine', '{https://fine.example/cb}', pg_temp.d('ip-b')) ->> 'ok'), 'true');

-- ---------- 2. the admin allows ----------

select pg_temp.as_user('b1100003-0000-4000-8000-000000000003');
select pg_temp.raises('a manager may not allow a connection',
  $$select pg_temp.allow_claude('Mia''s Claude')$$, 'serverErrors.adminOnly');

select pg_temp.as_user('b1100001-0000-4000-8000-000000000001');
select pg_temp.allow_claude('Claude') as code1 \gset
select pg_temp.check('the admin gets a code of our shape',
  :'code1' ~ '^woomcd_[0-9a-f]{64}$', true);
select pg_temp.check('the code is kept as its sha256 only',
  (select count(*)::int from public.oauth_codes c
   where c.code_digest = pg_temp.d(:'code1') and to_jsonb(c)::text not like '%' || :'code1' || '%'),
  1);
select pg_temp.check('it lives ten minutes',
  (select c.expires_at - c.created_at from public.oauth_codes c where c.code_digest = pg_temp.d(:'code1')),
  interval '10 minutes');

select pg_temp.check('a registered client may come back to its loopback address on any port',
  (public.oauth_authorize(:'dcr', 'Cursor', 'http://127.0.0.1:53682/callback', pg_temp.ch('cursor'),
     'https://project.supabase.co/functions/v1/mcp', 'Cursor', 'read_only') ->> 'code') is not null,
  true);
select pg_temp.raises('but not to an address it never registered',
  format($$select public.oauth_authorize(%L, 'Cursor', 'https://evil.example/cb', %L,
           'https://project.supabase.co/functions/v1/mcp', 'Cursor', 'read_only')$$,
         :'dcr', pg_temp.ch('cursor')),
  'serverErrors.oauthRedirectInvalid');
select pg_temp.raises('nor to localhost when it registered 127.0.0.1',
  format($$select public.oauth_authorize(%L, 'Cursor', 'http://localhost:53682/callback', %L,
           'https://project.supabase.co/functions/v1/mcp', 'Cursor', 'read_only')$$,
         :'dcr', pg_temp.ch('cursor')),
  'serverErrors.oauthRedirectInvalid');
select pg_temp.raises('an unknown registered client is refused',
  format($$select public.oauth_authorize('woomc_00000000000000000000000000000000', null,
           'https://a.example/cb', %L, 'https://project.supabase.co/functions/v1/mcp', 'X', 'read_only')$$,
         pg_temp.ch('x')),
  'serverErrors.oauthClientUnknown');
select pg_temp.raises('a client named by a plain-http URL is refused',
  format($$select public.oauth_authorize('http://claude.ai/meta', null,
           'https://claude.ai/api/mcp/auth_callback', %L, 'https://project.supabase.co/functions/v1/mcp',
           'X', 'read_only')$$, pg_temp.ch('x')),
  'serverErrors.oauthClientUnknown');
select pg_temp.raises('a client named by a URL may not send the browser to javascript:',
  format($$select public.oauth_authorize('https://evil.example/c.json', 'Claude',
           'javascript:location=1//', %L, 'https://project.supabase.co/functions/v1/mcp', 'X', 'read_only')$$,
         pg_temp.ch('x')),
  'serverErrors.oauthRedirectInvalid');
select pg_temp.check('safe redirects: https, loopback http, a program''s own scheme — nothing a browser runs',
  (select string_agg(u || '=' || public.oauth_redirect_safe(u)::text, ' ' order by n)
   from unnest(array['https://claude.ai/api/mcp/auth_callback', 'http://localhost:3118/callback',
                     'cursor://anysphere.cursor-mcp/oauth/callback', 'com.example.app:/cb',
                     'javascript:alert(1)', 'data:text/html,x', 'http://claude.ai/cb',
                     'https://u:p@claude.ai/cb', 'https://claude.ai/cb#x', 'mailto:x@y.z']) with ordinality t(u, n)),
  'https://claude.ai/api/mcp/auth_callback=true http://localhost:3118/callback=true '
  'cursor://anysphere.cursor-mcp/oauth/callback=true com.example.app:/cb=true javascript:alert(1)=false '
  'data:text/html,x=false http://claude.ai/cb=false https://u:p@claude.ai/cb=false https://claude.ai/cb#x=false '
  'mailto:x@y.z=false');
select pg_temp.raises('a challenge that is not S256-shaped is refused',
  $$select public.oauth_authorize('https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude',
      'https://claude.ai/api/mcp/auth_callback', 'plain', 'https://project.supabase.co/functions/v1/mcp',
      'X', 'read_only')$$,
  'serverErrors.oauthRequestInvalid');
select pg_temp.raises('a connection does not start with full access',
  $$select pg_temp.allow_claude('Full Claude', 'full')$$, 'serverErrors.apiPresetInvalid');
select pg_temp.raises('nor with another company''s property',
  format($$select public.oauth_authorize('https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude',
           'https://claude.ai/api/mcp/auth_callback', %L, 'https://project.supabase.co/functions/v1/mcp',
           'X', 'read_only', '{}', '{900911901}')$$, pg_temp.ch('x')),
  'serverErrors.propertyNotFound');
select pg_temp.raises('nor with a forbidden scope',
  format($$select public.oauth_authorize('https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude',
           'https://claude.ai/api/mcp/auth_callback', %L, 'https://project.supabase.co/functions/v1/mcp',
           'X', 'read_only', '{api_keys:manage}')$$, pg_temp.ch('x')),
  'serverErrors.apiScopeForbidden');

-- ---------- 3. the code for tokens ----------

select pg_temp.as_server();
select pg_temp.check('a wrong PKCE verifier gets nothing',
  public.oauth_issue_tokens(pg_temp.d(:'code1'), 'https://claude.ai/oauth/mcp-oauth-client-metadata',
    'https://claude.ai/api/mcp/auth_callback', pg_temp.ch('another verifier'),
    'https://project.supabase.co/functions/v1/mcp', pg_temp.d('a0'), pg_temp.d('r0')) ->> 'error',
  'invalid_grant');
select pg_temp.check('nor another client with the same code',
  public.oauth_issue_tokens(pg_temp.d(:'code1'), 'https://claude.ai/oauth/claude-code-client-metadata',
    'https://claude.ai/api/mcp/auth_callback', pg_temp.ch('Claude'),
    'https://project.supabase.co/functions/v1/mcp', pg_temp.d('a0'), pg_temp.d('r0')) ->> 'error',
  'invalid_grant');
select pg_temp.check('nor another redirect',
  public.oauth_issue_tokens(pg_temp.d(:'code1'), 'https://claude.ai/oauth/mcp-oauth-client-metadata',
    'https://claude.com/api/mcp/auth_callback', pg_temp.ch('Claude'),
    'https://project.supabase.co/functions/v1/mcp', pg_temp.d('a0'), pg_temp.d('r0')) ->> 'error',
  'invalid_grant');
select pg_temp.check('nor another resource',
  public.oauth_issue_tokens(pg_temp.d(:'code1'), 'https://claude.ai/oauth/mcp-oauth-client-metadata',
    'https://claude.ai/api/mcp/auth_callback', pg_temp.ch('Claude'),
    'https://elsewhere.example/mcp', pg_temp.d('a0'), pg_temp.d('r0')) ->> 'error',
  'invalid_target');
select pg_temp.check('failed attempts spend nothing and make no key',
  (select count(*)::int from public.api_keys where kind = 'oauth'), 0);

select pg_temp.redeem(:'code1', 'Claude', 'access-1', 'refresh-1') as issued \gset
select pg_temp.check('the right verifier gets an hour''s token',
  (:'issued'::jsonb ->> 'ok') || ' ' || (:'issued'::jsonb ->> 'expires_in'), 'true 3600');
select k.id as conn from public.api_keys k where k.kind = 'oauth' and k.oauth_client_name = 'Claude' \gset
select pg_temp.check('the connection is a key of its own kind, made by the admin who allowed it',
  (select k.kind || ' ' || k.name || ' ' || k.preset || ' ' || (k.prefix is null)::text || ' '
          || (k.key_digest is null)::text || ' ' || k.oauth_redirect_uri || ' '
          || (k.created_by = 'b1100001-0000-4000-8000-000000000001')::text
   from public.api_keys k where k.id = :'conn'),
  'oauth Claude read_only true true https://claude.ai/api/mcp/auth_callback true');
select pg_temp.check('the journal says the admin made it, for which client',
  (select e.kind || ' ' || (e.actor_id = 'b1100001-0000-4000-8000-000000000001')::text || ' '
          || (e.after ->> 'client_name')
   from public.api_key_events e where e.key_id = :'conn'),
  'created true Claude');
select pg_temp.check('the tokens are kept as digests, an hour and 90 days',
  (select string_agg(t.kind || ':' || (t.expires_at - now())::text, ' ' order by t.kind)
   from public.oauth_tokens t where t.key_id = :'conn'),
  'access:01:00:00 refresh:90 days');

-- ---------- 4. the gate: the MCP server alone takes a token ----------

select pg_temp.check('the MCP server takes the access token', pg_temp.gate('access-1'), 'ok');
select pg_temp.check('and names the connection behind it',
  (select (g ->> 'key_id') = :'conn' and (g ->> 'digest') = pg_temp.d('access-1')
   from public.api_gate(pg_temp.d('access-1'), null, 'mcp') g),
  true);
select pg_temp.check('the REST API refuses it', pg_temp.gate('access-1', null), 'invalid-key');
select pg_temp.check('also when it says so', pg_temp.gate('access-1', 'api'), 'invalid-key');
select pg_temp.check('the gate called the old way (two arguments) refuses it',
  (select g ->> 'code' from public.api_gate(pg_temp.d('access-1'), null) g), 'invalid-key');
select pg_temp.check('a refresh token is no access token', pg_temp.gate('refresh-1'), 'invalid-key');
select pg_temp.check('a key works on both, as before',
  pg_temp.gate('key-plain', null) || ' ' || pg_temp.gate('key-plain', 'mcp'), 'ok ok');
select pg_temp.raises('an unknown channel is a mistake',
  $$select public.api_gate(null, null, 'web')$$, null);

select pg_temp.check('an operation sees the connection''s company and scopes',
  (select (c).host_id::text || ' ' || ('cleanings:read' = any((c).scopes))::text
   from (select public.api_authorize(pg_temp.d('access-1'), 'cleanings:read') c) x),
  'b1100000-0000-4000-8000-00000000000a true');
select pg_temp.raises('read only cannot create a task',
  $$select public.api_authorize(pg_temp.d('access-1'), 'tasks:create')$$, 'api:insufficient-scope');
select pg_temp.check('get_me names the connection, with no prefix',
  (select (m -> 'key' ->> 'name') || ' ' || coalesce(m -> 'key' ->> 'prefix', 'none')
   from public.api_v1_get_me(pg_temp.d('access-1')) m),
  'Claude none');

-- ---------- 5. the panel sees and changes it like a key ----------

select pg_temp.as_user('b1100001-0000-4000-8000-000000000001');
select pg_temp.check('Settings → API lists the connection beside the key',
  (select string_agg(x ->> 'kind' || ':' || (x ->> 'name') || ':' || coalesce(x ->> 'client_name', '-'), ' '
                     order by x ->> 'kind')
   from jsonb_array_elements(public.list_api_keys()) x
   where x ->> 'name' in ('Claude', 'Plain key')),
  'key:Plain key:- oauth:Claude:Claude');
select pg_temp.check('a change of preset applies to the next request',
  (public.update_api_key(:'conn', 'Claude', 'operator', '{}', null) ->> 'preset'), 'operator');
select pg_temp.as_server();
select pg_temp.check('now it may create tasks',
  (select 'tasks:create' = any((public.api_authorize(pg_temp.d('access-1'), 'tasks:create')).scopes)),
  true);
select pg_temp.as_user('b1100006-0000-4000-8000-000000000006');
select pg_temp.check('another company''s admin does not see it',
  (select count(*)::int from jsonb_array_elements(public.list_api_keys()) x where x ->> 'id' = :'conn'), 0);

-- ---------- 6. refresh: spent on use ----------

select pg_temp.as_server();
select pg_temp.check('a refresh token buys a new pair',
  public.oauth_refresh_tokens(pg_temp.d('refresh-1'), 'https://claude.ai/oauth/mcp-oauth-client-metadata',
                              pg_temp.d('access-2'), pg_temp.d('refresh-2')) ->> 'ok',
  'true');
select pg_temp.check('the new access token works, the old one until its hour ends',
  pg_temp.gate('access-2') || ' ' || pg_temp.gate('access-1'), 'ok ok');
select pg_temp.check('the spent refresh token is marked',
  (select t.used_at is not null from public.oauth_tokens t where t.digest = pg_temp.d('refresh-1')), true);
select pg_temp.check('a second refresh within a minute gets a pair of its own',
  public.oauth_refresh_tokens(pg_temp.d('refresh-1'), null, pg_temp.d('access-3'), pg_temp.d('refresh-3')) ->> 'ok',
  'true');
select pg_temp.check('another client cannot use the refresh token',
  public.oauth_refresh_tokens(pg_temp.d('refresh-2'), 'https://claude.ai/oauth/claude-code-client-metadata',
                              pg_temp.d('access-x'), pg_temp.d('refresh-x')) ->> 'error',
  'invalid_grant');
select pg_temp.check('an access token is no refresh token',
  public.oauth_refresh_tokens(pg_temp.d('access-2'), null, pg_temp.d('access-x'), pg_temp.d('refresh-x')) ->> 'error',
  'invalid_grant');

update public.oauth_tokens set used_at = now() - interval '2 minutes' where digest = pg_temp.d('refresh-1');
select pg_temp.check('a spent refresh token back later was copied: invalid',
  public.oauth_refresh_tokens(pg_temp.d('refresh-1'), null, pg_temp.d('access-4'), pg_temp.d('refresh-4')) ->> 'error',
  'invalid_grant');
select pg_temp.check('and the connection ends, journalled with why',
  (select public.api_key_state(k) || ' ' || (select e.after ->> 'reason' from public.api_key_events e
                                             where e.key_id = k.id and e.kind = 'revoked')
   from public.api_keys k where k.id = :'conn'),
  'revoked refresh_token_reused');
select pg_temp.check('no token of it is left, and the MCP server refuses it',
  (select count(*)::int from public.oauth_tokens t where t.key_id = :'conn')::text || ' ' || pg_temp.gate('access-2'),
  '0 invalid-key');

-- ---------- 7. a code used twice ends its connection ----------

select pg_temp.as_user('b1100001-0000-4000-8000-000000000001');
select pg_temp.allow_claude('Claude two') as code2 \gset
select pg_temp.as_server();
select pg_temp.redeem(:'code2', 'Claude two', 'access-b1', 'refresh-b1') ->> 'ok' as ok2 \gset
select pg_temp.check('a second connection is made', :'ok2'::text, 'true');
select pg_temp.check('a spent code without its verifier gets nothing and ends nothing',
  (public.oauth_issue_tokens(pg_temp.d(:'code2'), 'https://claude.ai/oauth/mcp-oauth-client-metadata',
     'https://claude.ai/api/mcp/auth_callback', pg_temp.ch('a guess'),
     'https://project.supabase.co/functions/v1/mcp', pg_temp.d('a-x'), pg_temp.d('r-x')) ->> 'error')
  || ' ' || (select public.api_key_state(k) from public.api_keys k where k.name = 'Claude two'),
  'invalid_grant active');
select pg_temp.check('the same code again gets nothing',
  pg_temp.redeem(:'code2', 'Claude two', 'access-b2', 'refresh-b2') ->> 'error', 'invalid_grant');
select pg_temp.check('and the connection made with it ends',
  (select public.api_key_state(k) from public.api_keys k where k.name = 'Claude two'), 'revoked');
select pg_temp.check('its token is refused', pg_temp.gate('access-b1'), 'invalid-key');

-- ---------- 8. ends: expiry, the admin, revocation ----------

select pg_temp.as_user('b1100001-0000-4000-8000-000000000001');
select pg_temp.allow_claude('Claude short', 'read_only', now() + interval '30 minutes') as code3 \gset
select pg_temp.allow_claude('Claude late') as code4 \gset
select pg_temp.as_server();
select pg_temp.check('a connection that ends in half an hour gets a half-hour token',
  pg_temp.redeem(:'code3', 'Claude short', 'access-c1', 'refresh-c1') ->> 'expires_in', '1800');
select pg_temp.check('and a refresh token that ends with it',
  (select t.expires_at = k.expires_at from public.oauth_tokens t join public.api_keys k on k.id = t.key_id
   where t.digest = pg_temp.d('refresh-c1')),
  true);

update public.oauth_codes set expires_at = now() - interval '1 second' where code_digest = pg_temp.d(:'code4');
select pg_temp.check('a code past its ten minutes gets nothing',
  pg_temp.redeem(:'code4', 'Claude late', 'access-d1', 'refresh-d1') ->> 'error', 'invalid_grant');

update public.oauth_tokens set expires_at = now() - interval '1 second' where digest = pg_temp.d('access-c1');
select pg_temp.check('an access token past its hour is refused', pg_temp.gate('access-c1'), 'invalid-key');
select pg_temp.check('its refresh token still buys a new one',
  public.oauth_refresh_tokens(pg_temp.d('refresh-c1'), null, pg_temp.d('access-c2'), pg_temp.d('refresh-c2')) ->> 'ok',
  'true');

select pg_temp.as_user('b1100001-0000-4000-8000-000000000001');
select pg_temp.allow_claude('Claude of Ada') as code5 \gset
select pg_temp.as_server();
update public.profiles set role = 'manager' where id = 'b1100001-0000-4000-8000-000000000001';
select pg_temp.check('an admin no longer one: the code he allowed gets nothing',
  pg_temp.redeem(:'code5', 'Claude of Ada', 'access-e1', 'refresh-e1') ->> 'error', 'invalid_grant');
select pg_temp.check('and his connections are suspended',
  pg_temp.gate('access-c2'), 'key-suspended');
select pg_temp.check('their refresh tokens buy nothing',
  public.oauth_refresh_tokens(pg_temp.d('refresh-c2'), null, pg_temp.d('access-c3'), pg_temp.d('refresh-c3')) ->> 'error',
  'invalid_grant');
update public.profiles set role = 'admin' where id = 'b1100001-0000-4000-8000-000000000001';
select pg_temp.check('back as admin, they work again', pg_temp.gate('access-c2'), 'ok');

select pg_temp.as_user('b1100002-0000-4000-8000-000000000002');
select public.revoke_api_key(k.id) is not null as revoked from public.api_keys k where k.name = 'Claude short' \gset
select pg_temp.as_server();
select pg_temp.check('a connection another admin revoked is refused at once',
  pg_temp.gate('access-c2'), 'key-revoked');
select pg_temp.check('and buys no new token',
  public.oauth_refresh_tokens(pg_temp.d('refresh-c2'), null, pg_temp.d('access-c4'), pg_temp.d('refresh-c4')) ->> 'error',
  'invalid_grant');

-- ---------- 9. what a key of kind 'key' still is ----------

select pg_temp.raises('a key still needs its digest',
  $$insert into public.api_keys (host_id, name, preset, created_by)
    values ('b1100000-0000-4000-8000-00000000000a', 'No digest', 'read_only',
            'b1100001-0000-4000-8000-000000000001')$$,
  null);
select pg_temp.raises('a connection holds no digest of its own',
  $$insert into public.api_keys (host_id, kind, name, prefix, key_digest, preset, created_by,
                                 oauth_client_id, oauth_redirect_uri)
    values ('b1100000-0000-4000-8000-00000000000a', 'oauth', 'Odd', 'woom_oddAAAA', repeat('a', 64),
            'read_only', 'b1100001-0000-4000-8000-000000000001', 'https://c.example/m', 'https://c.example/cb')$$,
  null);

-- ---------- 10. who may call what ----------

select pg_temp.check('the panel calls exactly the client lookup and the consent',
  (select string_agg(p.proname, ',' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'oauth\_%'
     and has_function_privilege('authenticated', p.oid, 'execute')),
  'oauth_authorize,oauth_client');
select pg_temp.check('the Edge Function oauth calls registration, the grants and the lookup',
  (select string_agg(p.proname, ',' order by p.proname)
   from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.proname like 'oauth\_%'
     and has_function_privilege('service_role', p.oid, 'execute')),
  'oauth_client,oauth_issue_tokens,oauth_refresh_tokens,oauth_register_client');
select pg_temp.check('anon calls none of it',
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'oauth\_%' or p.proname in ('api_gate', 'api_key_by_digest'))
     and has_function_privilege('anon', p.oid, 'execute')),
  0);
select pg_temp.check('nobody calls the digest lookup directly',
  (select count(*)::int from unnest(array['anon', 'authenticated', 'service_role']) r
   where has_function_privilege(r, 'public.api_key_by_digest(text, boolean)', 'execute')),
  0);
select pg_temp.check('no client role holds any privilege on the OAuth tables',
  (select count(*)::int from pg_class c, unnest(array['anon', 'authenticated']) r,
          unnest(array['select', 'insert', 'update', 'delete', 'truncate', 'trigger']) pr
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'oauth\_%'
     and has_table_privilege(r, c.oid, pr)),
  0);

rollback;
