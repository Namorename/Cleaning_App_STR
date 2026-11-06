-- A fingerprint of the schema the migrations own, for comparing the cloud with a throwaway
-- rehearsal database (docs/rollout-plan-1028.md, steps 3-5). Catalog only: no row of
-- application data is read. One statement, static SQL, valid before and after every step.
--
--   node scripts/cloud-read.mjs <plan tree>/docs/rollout/rollout_1030_fingerprint.sql > fp.json
--   node <plan tree>/docs/rollout/rollout-1030-compare.mjs <head|step3|step4|step5> fp.json
--
-- The expected values per state are in rollout_1030_expected.json; which state to expect before
-- and after each push is in the plan, §5.
-- Each part is a count and the first 8 hex of an md5 over a sorted text form; equal pairs mean
-- the same objects. Extension members are left out (pg_depend deptype 'e'). Bodies are hashed
-- without carriage returns: touch_updated_at went to the cloud with CRLF line ends (same text).
select json_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'migrations', (select count(*) from supabase_migrations.schema_migrations),
  'functions', (
    select json_build_object('n', count(*), 'md5', left(md5(string_agg(
             n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
             || md5(replace(p.prosrc, chr(13), '')) || p.prosecdef::text || coalesce(array_to_string(p.proconfig, ','), '')
             || pg_get_function_result(p.oid),
             ';' order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))), 8))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'raw')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')),
  'function_client_exec', (
    select json_build_object('n', count(*), 'md5', left(md5(string_agg(x, ';' order by x)), 8))
    from (
      select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
             || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as x
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where n.nspname in ('public', 'raw')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
        and a.privilege_type = 'EXECUTE'
        and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole))) f),
  'relations', (
    select json_build_object('n', count(*), 'md5', left(md5(string_agg(
             n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text,
             ';' order by n.nspname, c.relname)), 8))
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'raw') and c.relkind in ('r', 'p', 'v', 'm')),
  'columns', (
    select json_build_object('n', count(*), 'md5', left(md5(string_agg(
             n.nspname || '.' || c.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod)
             || ':' || a.attnotnull::text || ':' || coalesce(pg_get_expr(ad.adbin, ad.adrelid), ''),
             ';' order by n.nspname, c.relname, a.attname)), 8))
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef ad on ad.adrelid = a.attrelid and ad.adnum = a.attnum
    where n.nspname in ('public', 'raw') and c.relkind in ('r', 'p', 'v', 'm')
      and a.attnum > 0 and not a.attisdropped),
  'table_client_grants', (
    select json_build_object('n', count(*), 'md5', left(md5(string_agg(x, ';' order by x)), 8))
    from (
      select n.nspname || '.' || c.relname || ' '
             || case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end
             || ' ' || g.privilege_type as x
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) g
      where n.nspname in ('public', 'raw') and c.relkind in ('r', 'p', 'v', 'm')
        and (g.grantee = 0 or g.grantee in ('anon'::regrole, 'authenticated'::regrole))) t),
  'policies', (
    select json_build_object('n', count(*), 'md5', left(md5(string_agg(
             n.nspname || '.' || c.relname || '.' || p.polname || ':' || p.polcmd::text || ':' || p.polpermissive::text
             || ':' || array_to_string(array(select r::regrole::text from unnest(p.polroles) r order by 1), ',')
             || ':' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
             || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
             ';' order by n.nspname, c.relname, p.polname)), 8))
    from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'raw')),
  'triggers', (
    select json_build_object('n', count(*), 'md5', left(md5(string_agg(
             c.relname || '.' || t.tgname || ':' || t.tgtype || ':' || t.tgfoid::regproc::text || ':' || t.tgenabled::text,
             ';' order by c.relname, t.tgname)), 8))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'raw') and not t.tgisinternal),
  'indexes', (
    select json_build_object('n', count(*), 'md5', left(md5(string_agg(indexdef, ';' order by indexdef)), 8))
    from pg_indexes where schemaname in ('public', 'raw')),
  'enums', (
    select json_build_object('n', count(*), 'md5', left(md5(string_agg(
             t.typname || ':' || e.enumlabel, ';' order by t.typname, e.enumsortorder)), 8))
    from pg_enum e join pg_type t on t.oid = e.enumtypid join pg_namespace n on n.oid = t.typnamespace
    where n.nspname in ('public', 'raw')),
  'cron', (
    select json_build_object('n', count(*), 'md5', left(md5(string_agg(
             jobname || ':' || schedule || ':' || active::text || ':' || md5(command), ';' order by jobname)), 8),
             'off', coalesce(json_agg(jobname order by jobname) filter (where not active), '[]'::json))
    from cron.job)
) as catalog_fingerprint;
