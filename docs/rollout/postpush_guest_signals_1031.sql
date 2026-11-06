-- Rollout step 5 (the guest signals core and its reviews, 20261030110000): the cloud AFTER the
-- push, by the names of the rehearsal of 31.10 (docs/rollout-plan-1028.md §9.7). Before the push
-- the catalog fingerprint (rollout_1030_fingerprint.sql, state head of rollout_1031_expected.json)
-- is the probe; this one names the step's tables and fails before them.
-- Read-only, one statement, no personal data: counts, names, md5 of bodies, never a row of a guest.
--
--   node scripts/cloud-read.mjs <plan tree>/docs/rollout/postpush_guest_signals_1031.sql
--
-- head           the newest migration applied;
-- since_1030     the versions of 30.10 and later, in order;
-- jobs           the step's five jobs: name, schedule, active (the two that call the Edge
--                Functions stay off until the owner turns them on);
-- client_grants  what anon, authenticated and PUBLIC hold on the step's tables, from pg_class.relacl
--                (information_schema shows nothing to the read-only role);
-- door           signal_run_status(): the one client door into raw — its arguments, its answer's
--                columns and types, and who may call it (table_grants.sql, rollout step 5a);
-- push_md5       push_on_problem_reported (ef9de429 before the step);
-- scopes         the API's scope rows by status, and the step's two;
-- rows           how many signals, findings, settings rows and verdicts there are (all 0 right
--                after the push: the first settings row comes with the first save in the panel).
select json_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'since_1030', (select json_agg(version order by version)
                 from supabase_migrations.schema_migrations where version >= '20261030000000'),
  'jobs', (select coalesce(json_agg(json_build_object('job', jobname, 'at', schedule, 'on', active)
                                    order by jobname), '[]'::json)
           from cron.job
           where jobname in ('sync-guest-signals-daily', 'classify-guest-signals-daily',
                             'purge-signal-stays', 'purge-signal-data', 'purge-signal-runs')),
  'client_grants', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select c.relname || ' ' || case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end
             || ' ' || g.privilege_type as x
      from pg_class c
      cross join lateral aclexplode(c.relacl) g
      where c.relnamespace = 'public'::regnamespace
        and c.relname in ('guest_signals', 'signal_findings', 'signal_settings', 'signal_feedback')
        and (g.grantee = 0 or g.grantee in ('anon'::regrole, 'authenticated'::regrole))) t),
  'door', (select json_build_object(
                    'args', pg_get_function_identity_arguments(p.oid),
                    'columns', p.proargnames,
                    'types', (select json_agg(format_type(a.t, null) order by a.o)
                              from unnest(p.proallargtypes) with ordinality as a (t, o)),
                    'definer', p.prosecdef,
                    'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
                    'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'))
           from pg_proc p
           where p.oid = to_regprocedure('public.signal_run_status()')),
  'push_md5', (select left(md5(replace(p.prosrc, chr(13), '')), 8)
               from pg_proc p
               where p.pronamespace = 'public'::regnamespace and p.proname = 'push_on_problem_reported'),
  'scopes', (select json_build_object(
                      'total', count(*),
                      'exposed', count(*) filter (where status = 'exposed'),
                      'planned', count(*) filter (where status = 'planned'),
                      'forbidden', count(*) filter (where status = 'forbidden'),
                      'step', (select coalesce(json_agg(s.id || ' ' || s.status order by s.id), '[]'::json)
                               from public.api_scopes s where s.scope_group = 'guest_signals'))
             from public.api_scopes),
  'rows', json_build_object(
            'signals', (select count(*) from public.guest_signals),
            'findings', (select count(*) from public.signal_findings),
            'settings', (select count(*) from public.signal_settings),
            'verdicts', (select count(*) from public.signal_feedback))
) as postpush_guest_signals;
