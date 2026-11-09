-- Who did a task and who closed it (20261106125000, docs/rollout/problem-closing-1109.md): the
-- cloud before the push, after it, and after a rollback. Catalog and counts only, one static
-- statement valid in every state (the new columns are read through to_jsonb); no name, no text.
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_problem_closing_1109.sql
--
-- head      the newest migration applied;
-- columns   the five new columns of problems that exist;
-- triggers  the triggers of problems and whether they are on (problems_touch must stay on);
-- exec      who of PUBLIC, anon, authenticated, service_role may execute the new and changed
--           functions (pg_proc.proacl; information_schema is empty under the read-only role);
-- closing   problems by closed_how and whether a worker is named, open and closed apart;
-- kept      md5 of what the backfill must not move — status, dates, updated_at — for the rows
--           not touched since midnight UTC: the same before and after a push on the same day.
select json_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'columns', (select coalesce(json_agg(a.attname order by a.attname), '[]'::json)
              from pg_attribute a
              where a.attrelid = 'public.problems'::regclass and not a.attisdropped
                and a.attname in ('completed_by', 'closed_by', 'closed_how', 'closed_cause', 'closed_at')),
  'triggers', (select json_agg(t.tgname || '=' || t.tgenabled::text order by t.tgname)
               from pg_trigger t
               where t.tgrelid = 'public.problems'::regclass and not t.tgisinternal),
  'exec', (select coalesce(json_agg(x order by x), '[]'::json) from (
      select p.oid::regprocedure::text || ' ' ||
             coalesce(string_agg(case when g.grantee = 0 then 'PUBLIC' else g.grantee::regrole::text end,
                                 ',' order by g.grantee::regrole::text), '-') as x
      from pg_proc p
      left join lateral aclexplode(p.proacl) g on g.privilege_type = 'EXECUTE'
        and (g.grantee = 0 or g.grantee::regrole::text in ('anon', 'authenticated', 'service_role'))
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('resolve_problem', 'closing_people', 'stamp_problem_closing',
                          'api_task_json', 'api_task_person_json', 'api_v1_get_task',
                          'api_v1_list_tasks', 'analytics_problems_by_technician')
      group by p.oid) s),
  'closing', (select json_object_agg(k, n) from (
      select case when p.status in ('resolved', 'cancelled') or p.archived_at is not null
                  then 'closed' else 'open' end
             || ':' || coalesce(to_jsonb(p) ->> 'closed_how', 'none')
             || ':' || case when to_jsonb(p) ->> 'completed_by' is null then 'no_worker' else 'worker' end as k,
             count(*) as n
      from public.problems p
      group by 1) c),
  'kept', (select md5(string_agg(p.id::text || p.status::text || coalesce(p.resolved_at::text, '')
                                 || coalesce(p.cancelled_at::text, '') || coalesce(p.archived_at::text, '')
                                 || p.updated_at::text, ',' order by p.id))
           from public.problems p
           where p.updated_at < date_trunc('day', now()))
) as out;
