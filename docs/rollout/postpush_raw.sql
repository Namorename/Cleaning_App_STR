-- Post-push check: is schema raw still closed in the CLOUD, and did the run
-- trace of 20260923120000 land as intended? Read-only, one result set.
--
--   npx supabase db query --linked -f docs/rollout/postpush_raw.sql > postpush_raw.json
--
-- supabase/tests/table_grants.sql asks the same questions, but on the local
-- stack only; hosted default privileges have differed from local ones before.
-- Expected, label by label:
--   generator_runs_acl    the table {postgres=arwdDxtm/postgres,service_role=arwdDxtm/postgres};
--                         its sequence and both indexes null
--   client_access_to_raw  []  -- anything here is a leak: stop and revoke
--   raw_default_acl       no entry granting to anon, authenticated or PUBLIC (grantee 0);
--                         locally the only row is postgres|raw|r -> service_role
--   purge_job             schedule "45 3 * * *", username postgres, active true
--   generator_function    one row: security definer, owner postgres,
--                         acl {postgres=X/postgres,service_role=X/postgres}
select label, payload from (
  select 1 as ord, 'generator_runs_acl' as label,
         (select jsonb_agg(jsonb_build_object(
                   'object', c.oid::regclass::text, 'kind', c.relkind, 'acl', c.relacl::text)
                 order by c.relname)
          from pg_class c
          where c.relnamespace = 'raw'::regnamespace
            and c.relname like 'generator_runs%') as payload

  union all
  select 2, 'client_access_to_raw', coalesce((
    select jsonb_agg(jsonb_build_object('role', r, 'what', x.what) order by r, x.what)
    from unnest(array['anon', 'authenticated']) r
    cross join lateral (
      select 'schema raw ' || p as what
      from unnest(array['USAGE', 'CREATE']) p
      where has_schema_privilege(r, 'raw', p)
      union all
      select c.oid::regclass::text from pg_class c
      where c.relnamespace = 'raw'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
        and (has_table_privilege(r, c.oid,
               'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
             or has_any_column_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,REFERENCES'))
      union all
      select c.oid::regclass::text from pg_class c
      where c.relnamespace = 'raw'::regnamespace and c.relkind = 'S'
        and has_sequence_privilege(r, c.oid, 'USAGE,SELECT,UPDATE')
      union all
      select p.oid::regprocedure::text from pg_proc p
      where p.pronamespace not in ('pg_catalog'::regnamespace, 'information_schema'::regnamespace)
        and p.prosrc ~ '\mraw\.'
        and has_function_privilege(r, p.oid, 'EXECUTE')
      union all
      select 'view ' || v.oid::regclass::text
      from pg_rewrite rw
      join pg_class v on v.oid = rw.ev_class
      join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = rw.oid
      join pg_class t on t.oid = d.refobjid
      where t.relnamespace = 'raw'::regnamespace and v.oid <> t.oid
        and has_table_privilege(r, v.oid, 'SELECT')
    ) x), '[]'::jsonb)

  union all
  select 3, 'raw_default_acl',
         (select jsonb_agg(jsonb_build_object(
                   'role', d.defaclrole::regrole::text,
                   'schema', coalesce(d.defaclnamespace::regnamespace::text, '(all)'),
                   'type', d.defaclobjtype::text, 'acl', d.defaclacl::text))
          from pg_default_acl d
          where d.defaclnamespace = 'raw'::regnamespace or d.defaclnamespace = 0)

  union all
  select 4, 'purge_job',
         (select jsonb_agg(jsonb_build_object(
                   'schedule', j.schedule, 'username', j.username,
                   'active', j.active, 'command', j.command))
          from cron.job j where j.jobname = 'purge-generator-runs')

  union all
  select 5, 'generator_function',
         (select jsonb_agg(jsonb_build_object(
                   'signature', p.oid::regprocedure::text, 'definer', p.prosecdef,
                   'owner', p.proowner::regrole::text, 'acl', p.proacl::text))
          from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname = 'generate_cleaning_tasks')
) checks
order by ord;
