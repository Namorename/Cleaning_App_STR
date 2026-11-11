-- After the push of 20261111120000 (docs/rollout/task-source-1111.md): the head, the four functions,
-- who may execute each (proacl, not information_schema: the read role sees it empty), the API's task.
select json_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'functions', (
    select json_agg(json_build_object(
             'fn', p.oid::regprocedure::text,
             'definer', p.prosecdef,
             'volatile', p.provolatile,
             'exec', (select coalesce(string_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end,
                                                 ',' order by 1), '-')
                      from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) g
                      where g.privilege_type = 'EXECUTE' and g.grantee <> p.proowner))
           order by p.proname)
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('problem_guest_origin', 'guest_stay_json', 'problem_origin_signal',
                        'api_task_guest_stay', 'api_task_json')),
  'api_task_has_fields', (select bool_and(prosrc like '%''source'', p.source%' and prosrc like '%''guest_stay''%')
                          from pg_proc where proname = 'api_task_json'
                            and pronamespace = 'public'::regnamespace and pronargs = 2),
  'signal_tasks', (select count(*) from public.problems where source <> 'staff')
) as out;
