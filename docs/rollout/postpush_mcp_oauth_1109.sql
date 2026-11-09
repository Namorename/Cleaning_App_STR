-- The MCP server's sign-in by OAuth (20261109120000, docs/rollout/mcp-oauth-1109.md): the cloud
-- before the push, after it, and after a rollback. Catalog and counts only, one static statement
-- valid in every state (the new columns are read through to_jsonb); no name, no token, no text.
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_mcp_oauth_1109.sql
--
-- head      the newest migration applied;
-- tables    oauth_clients, oauth_codes, oauth_tokens, if they exist;
-- grants    what PUBLIC, anon and authenticated hold on them (nothing);
-- exec      who of PUBLIC, anon, authenticated, service_role may execute the gate and the new
--           functions (gate and oauth_issue/refresh/register: service_role; oauth_authorize:
--           authenticated; oauth_client: both; the helpers: nobody);
-- columns   api_keys' columns (four more after the push);
-- kinds     api_keys by kind ('key' only right after the push: no connection yet);
-- keys      api_keys whose prefix or digest is missing (0: only connections may have none).
select json_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'tables', (select coalesce(json_agg(c.relname order by c.relname), '[]'::json)
             from pg_class c
             where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
               and c.relname in ('oauth_clients', 'oauth_codes', 'oauth_tokens')),
  'grants', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select c.relname || ' ' || case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end
             || ' ' || g.privilege_type as x
      from pg_class c
      cross join lateral aclexplode(c.relacl) g
      where c.relnamespace = 'public'::regnamespace
        and c.relname in ('oauth_clients', 'oauth_codes', 'oauth_tokens')
        and (g.grantee = 0 or g.grantee::regrole::text in ('anon', 'authenticated'))) s),
  'exec', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select p.oid::regprocedure::text || ' ' ||
             coalesce(string_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end,
                                 ',' order by g.grantee::regrole::text), '-') as x
      from pg_proc p
      left join lateral aclexplode(p.proacl) g on g.privilege_type = 'EXECUTE'
        and (g.grantee = 0 or g.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))
      where p.pronamespace = 'public'::regnamespace
        and (p.proname like 'oauth\_%'
             or p.proname in ('api_gate', 'api_authorize', 'api_key_by_digest', 'api_key_public_json'))
      group by p.oid) s),
  'columns', (select string_agg(a.attname, ',' order by a.attname)
              from pg_attribute a
              where a.attrelid = 'public.api_keys'::regclass and a.attnum > 0 and not a.attisdropped),
  'kinds', (select coalesce(json_object_agg(k, n), '{}'::json) from (
      select coalesce(to_jsonb(k) ->> 'kind', 'key') as k, count(*) as n
      from public.api_keys k
      group by 1) s),
  'keys', (select count(*) from public.api_keys k
           where coalesce(to_jsonb(k) ->> 'kind', 'key') = 'key' and (k.prefix is null or k.key_digest is null))
) as out;
