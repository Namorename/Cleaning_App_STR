-- Post-push check for the package 20260923120000 + 20260923130000: did BOTH files land, with the
-- bodies and privileges intended? Read-only, one result set. Run right after the push, next to
-- docs/rollout/postpush_raw.sql, and once more about an hour later for the trace:
--
--   npx supabase db query --linked -f docs/rollout/postpush_package.sql > postpush_package.json
--
-- Expected, label by label:
--   head              20260923130000. 20260923120000 means the push stopped on the second file:
--                     take the recovery written in docs/units-plan.md.
--   functions         one row per name, md5 prefix / length / ACL exactly:
--                       assign_problem           d633c06c  2185 {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                       expire_stale_tasks       55f07501   597 {postgres=X/postgres,service_role=X/postgres}
--                       generate_cleaning_tasks  212ec056 13146 {postgres=X/postgres,service_role=X/postgres}
--                       guard_task_fields        0121a161  1950 {=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                       mirror_problem_status    1dfa717c  2458 {=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                     all owned by postgres, definer true, config {search_path=""}
--   mirror_trigger    AFTER INSERT OR DELETE OR UPDATE OF status, problem_id ON public.tasks
--   cron_jobs         six, including purge-generator-runs 45 3 * * *
--   trace_last_hour   an hour after the push: rows > 0 whenever webhook_batches > 0. Rows = 0 with
--                     batches processed means the trace does not write: look for WARNING
--                     "run trace not written" in the Postgres log before the night.
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload

  union all
  select 2, 'functions',
         (select jsonb_agg(jsonb_build_object(
                   'name', p.proname, 'md5', left(md5(p.prosrc), 8), 'len', length(p.prosrc),
                   'owner', p.proowner::regrole::text, 'definer', p.prosecdef,
                   'config', p.proconfig, 'acl', p.proacl::text) order by p.proname)
          from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('assign_problem', 'expire_stale_tasks', 'generate_cleaning_tasks',
                              'guard_task_fields', 'mirror_problem_status'))

  union all
  select 3, 'mirror_trigger',
         (select jsonb_agg(pg_get_triggerdef(t.oid)) from pg_trigger t
          where t.tgrelid = 'public.tasks'::regclass and t.tgname = 'tasks_mirror_problem')

  union all
  select 4, 'cron_jobs',
         (select jsonb_agg(jsonb_build_object('job', jobname, 'schedule', schedule, 'active', active)
                           order by jobname)
          from cron.job)

  union all
  select 5, 'trace_last_hour',
         jsonb_build_object(
           'rows', (select count(*) from raw.generator_runs
                    where ran_at > now() - interval '1 hour'),
           'webhook_batches', (select count(distinct processed_at) from raw.webhook_events
                               where status = 'processed'
                                 and processed_at > now() - interval '1 hour'))
) checks
order by ord;
