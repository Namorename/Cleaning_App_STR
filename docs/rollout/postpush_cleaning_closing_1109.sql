-- Who did a cleaning and who closed it (20261106125500, docs/rollout/cleaning-closing-1109.md): the
-- cloud before the push, after it, and after a rollback. Catalog and counts only, one static
-- statement valid in every state (the new table and column are read through to_regclass and
-- to_jsonb); no name, no text.
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_cleaning_closing_1109.sql
--
-- head        the newest migration applied;
-- tables      task_closings and closing_marks, if they exist;
-- grants      what PUBLIC, anon and authenticated hold on them (only authenticated SELECT);
-- trigger     tasks_stamp_closing and whether it is on;
-- exec        who of PUBLIC, anon, authenticated, service_role may execute the new functions;
-- sources     tasks (problems) by the source of their worker;
-- The closings by source: postpush_cleaning_closing_counts_1109.sql, valid after the push.
-- kept        md5 of the cleanings' status and updated_at for the rows not touched since midnight
--             UTC: the same before and after a push on the same day — the backfill moves none.
select json_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'tables', (select coalesce(json_agg(c.relname order by c.relname), '[]'::json)
             from pg_class c
             where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
               and c.relname in ('task_closings', 'closing_marks')),
  'grants', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select c.relname || ' ' || case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end
             || ' ' || g.privilege_type as x
      from pg_class c
      cross join lateral aclexplode(c.relacl) g
      where c.relnamespace = 'public'::regnamespace
        and c.relname in ('task_closings', 'closing_marks')
        and (g.grantee = 0 or g.grantee::regrole::text in ('anon', 'authenticated'))) s),
  'trigger', (select coalesce(json_agg(t.tgname || '=' || t.tgenabled::text), '[]'::json)
              from pg_trigger t
              where t.tgrelid = 'public.tasks'::regclass and t.tgname = 'tasks_stamp_closing'),
  'exec', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select p.oid::regprocedure::text || ' ' ||
             coalesce(string_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end,
                                 ',' order by g.grantee::regrole::text), '-') as x
      from pg_proc p
      left join lateral aclexplode(p.proacl) g on g.privilege_type = 'EXECUTE'
        and (g.grantee = 0 or g.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('complete_cleaning', 'name_cleaning_worker', 'name_problem_worker',
                          'task_closing', 'stamp_task_closing', 'closing_worker_check',
                          'api_cleaning_json', 'api_cleaning_closing_json')
      group by p.oid) s),
  'sources', (select coalesce(json_object_agg(k, n), '{}'::json) from (
      select coalesce(to_jsonb(p) ->> 'completed_by_source', 'none') as k, count(*) as n
      from public.problems p
      where p.status = 'resolved'
      group by 1) s),
  'kept', (select md5(string_agg(t.id::text || t.status::text || t.updated_at::text, ',' order by t.id))
           from public.tasks t
           where t.problem_id is null and t.updated_at < date_trunc('day', now()))
) as out;
