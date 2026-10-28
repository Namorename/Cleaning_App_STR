-- The cloud before and after each db push of the 28.10 rollout (docs/rollout-plan-1028.md).
-- Read-only, one statement, no personal data:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_1028.sql
--
-- head           the newest migration applied;
-- since_1023     the versions of this rollout already applied, in order;
-- cron           every job: name, schedule, active;
-- client_grants  what anon, authenticated and PUBLIC hold on the tables of this rollout
--                (api_*, kb_*, guest_reviews, review_findings, review_settings), read from
--                pg_class.relacl: information_schema shows nothing to the read-only role;
-- video_md5      add_task_media and snapshot_task_steps: 1aae2aac / 54f7a9f0 before
--                20261023100000, bf208d8c / dd81ff14 with it;
-- review_cron    the two review jobs that stay off until the owner turns them on.
-- The API's scope rows: docs/rollout/postpush_api_scopes_1028.sql, once the API is pushed.
select json_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'since_1023', (select json_agg(version order by version)
                 from supabase_migrations.schema_migrations where version >= '20261023000000'),
  'cron', (select json_agg(json_build_object('job', jobname, 'at', schedule, 'on', active) order by jobname)
           from cron.job),
  'client_grants', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select c.relname || ' ' || case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end
             || ' ' || g.privilege_type as x
      from pg_class c
      cross join lateral aclexplode(c.relacl) g
      where c.relnamespace = 'public'::regnamespace
        and c.relkind in ('r', 'v', 'p', 'm')
        and (c.relname like 'api\_%' or c.relname like 'kb\_%'
             or c.relname in ('guest_reviews', 'review_findings', 'review_settings'))
        and (g.grantee = 0 or g.grantee in ('anon'::regrole, 'authenticated'::regrole))) t),
  'video_md5', (select json_object_agg(p.proname, left(md5(p.prosrc), 8))
                from pg_proc p
                where p.pronamespace = 'public'::regnamespace
                  and p.proname in ('add_task_media', 'snapshot_task_steps')),
  'review_cron', (select json_agg(json_build_object('job', jobname, 'on', active) order by jobname)
                  from cron.job where jobname in ('sync-reviews-daily', 'classify-reviews-daily'))
) as postpush_1028;
