-- Property quality (20261106120000, docs/rollout/property-quality-1106.md): the cloud before
-- the push, after it, and after a rollback. Catalog and counts only: one statement, static
-- SQL, valid in every state; no row of a guest, no text, no date of a stay.
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_property_quality_1106.sql
--
-- head          the newest migration applied;
-- tables        the six tables and the journal that exist;
-- settings      the switches of the review row (all off before the owner's word);
-- checks        the checks of the new switches: the five dollars and the twelve months;
-- jobs          the two jobs and whether they are active (none before the owner's word);
-- client_grants what PUBLIC, anon and authenticated hold on the new tables (pg_class.relacl):
--               must be empty, the hosting hands out more than the local stack;
-- raw_grants    the same for the journal: must be empty;
-- exec          who of PUBLIC, anon, authenticated may execute the new functions: only
--               authenticated, only quality_overview, quality_place and quality_areas;
-- line_bodies   md5 of the three bodies of the texts' line: unchanged by this migration;
-- How far the reading got: postpush_property_quality_counts_1106.sql, valid after the push.
select json_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'tables', (select coalesce(json_agg(n.nspname || '.' || c.relname order by c.relname), '[]'::json)
             from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where c.relkind = 'r' and (n.nspname, c.relname) in (
               ('public', 'issue_themes'), ('public', 'issue_theme_words'), ('public', 'issue_facts'),
               ('public', 'problem_themes'), ('public', 'property_month_stats'),
               ('public', 'quality_area_members'),
               ('raw', 'signal_history_runs'))),
  'settings', (select to_jsonb(s) - 'host_id' - 'kind' - 'updated_by' - 'updated_at' - 'auto_kinds'
                 - 'min_confidence' - 'daily_auto_cap' - 'notice_published_at' - 'texts_enabled_at'
                 - 'model_since'
               from public.signal_settings s where s.kind = 'review' limit 1),
  'checks', (select coalesce(json_agg(c.conname || ': ' || pg_get_constraintdef(c.oid) order by c.conname), '[]'::json)
             from pg_constraint c
             where c.conrelid = 'public.signal_settings'::regclass and c.contype = 'c'
               and c.conname like '%history%'),
  'jobs', (select coalesce(json_agg(j.jobname || ' ' || j.schedule || ' active=' || j.active order by j.jobname), '[]'::json)
           from cron.job j
           where j.jobname in ('refresh-property-quality', 'read-signal-history-tick')),
  'client_grants', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select c.relname || ' ' || case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end
             || ' ' || g.privilege_type as x
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) g
      where n.nspname = 'public'
        and c.relname in ('issue_themes', 'issue_theme_words', 'issue_facts', 'problem_themes',
                          'property_month_stats', 'quality_area_members')
        and (g.grantee = 0 or g.grantee in ('anon'::regrole, 'authenticated'::regrole))) t),
  'raw_grants', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end
             || ' ' || g.privilege_type as x
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) g
      where n.nspname = 'raw' and c.relname = 'signal_history_runs'
        and (g.grantee = 0 or g.grantee in ('anon'::regrole, 'authenticated'::regrole))) t),
  'exec', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select p.proname || ' ' || case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as x
      from pg_proc p
      cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where p.pronamespace = 'public'::regnamespace
        and (p.proname like 'quality\_%' or p.proname like '%signal\_history%'
             or p.proname like 'issue\_theme\_%'
             or p.proname in ('refresh_property_quality', 'refresh_quality_areas',
                              'replace_property_month_stays'))
        and a.privilege_type = 'EXECUTE'
        and (a.grantee = 0 or a.grantee in ('anon'::regrole, 'authenticated'::regrole))) t),
  'line_bodies', (select json_object_agg(p.proname, left(md5(replace(p.prosrc, chr(13), '')), 8) order by p.proname)
                  from pg_proc p
                  where p.pronamespace = 'public'::regnamespace
                    and p.proname in ('review_text_allowed', 'store_review_texts', 'review_load_state'))
) as out;
