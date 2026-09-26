-- Post-push check for 20260926160000_pinned_cleaning. Read-only, one
-- statement, catalog and one count:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_pinned_cleaning.sql
--
-- Expected, label by label:
--   head       20260926160000.
--   column     pinned_departure, date, nullable, no column ACL; pinned 0 right
--              after the push (only a manager's move in the panel sets it).
--   functions  three rows, each owner postgres, security definer, volatility
--              v, config {search_path=""}, and the ACL it had before the push
--              (create or replace keeps it; cloud, 2026-09-26, before the push —
--              the trigger function carries the hosting's default grants,
--              which the local stack does not give):
--                generate_cleaning_tasks(date,date)
--                  {postgres=X/postgres,service_role=X/postgres}
--                guard_task_fields()
--                  {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                save_task(uuid,bigint,task_type,date,text,jsonb,uuid,time without time zone,time without time zone,text,integer,boolean)
--                  {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--              md5 prefix / length (local stack, 2026-09-26), and what the
--              cloud held before the push — the bodies of the three migrations
--              this one starts from, hashed the same way:
--                                         after              before
--                generate_cleaning_tasks  2902e27c 17926     7730946a 13726
--                guard_task_fields        cf75e049  2071     0121a161  1950
--                save_task                c1bc4b75  7690     24f754be  5446
--   anon       false for all three. Any true is a stop.
--   public     false for all three.
--   tasks_acl  anon, authenticated and PUBLIC on public.tasks as before the
--              push: authenticated arwd (SELECT, INSERT, UPDATE, DELETE), anon
--              and PUBLIC nothing. A column adds no table privilege; this
--              checks that nothing else moved.
--
-- ROLLBACK. There is no down migration. A later forward migration restores the
-- three bodies of 20260926102000 / 20260910150000 / 20260923130000 and drops
-- the column — the column only once no deployed panel selects it (a select
-- naming a missing column answers 42703 and empties the calendar). Restoring
-- the bodies alone is safe at any time: the old generator ignores the pin, and
-- the pinned cleanings go back under it on its next run.
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload
  union all
  select 2, 'column',
         (select jsonb_build_object(
                   'type', format_type(a.atttypid, a.atttypmod),
                   'not_null', a.attnotnull,
                   'acl', a.attacl::text,
                   'pinned', (select count(*) from public.tasks t
                              where t.pinned_departure is not null))
            from pg_attribute a
           where a.attrelid = 'public.tasks'::regclass
             and a.attname = 'pinned_departure' and not a.attisdropped)
  union all
  select 3, 'functions',
         (select jsonb_agg(jsonb_build_object(
                   'signature', p.oid::regprocedure::text,
                   'md5', left(md5(p.prosrc), 8), 'len', length(p.prosrc),
                   'owner', p.proowner::regrole::text, 'definer', p.prosecdef,
                   'volatility', p.provolatile::text,
                   'config', p.proconfig, 'acl', p.proacl::text)
                   order by p.proname)
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('generate_cleaning_tasks', 'guard_task_fields', 'save_task'))
  union all
  select 4, 'anon',
         (select jsonb_object_agg(p.proname, has_function_privilege('anon', p.oid, 'execute'))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('generate_cleaning_tasks', 'guard_task_fields', 'save_task'))
  union all
  select 5, 'public',
         (select jsonb_object_agg(p.proname,
                                  exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                           where a.grantee = 0))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('generate_cleaning_tasks', 'guard_task_fields', 'save_task'))
  union all
  select 6, 'tasks_acl',
         (select jsonb_object_agg(grantee, privileges)
            from (select case a.grantee when 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
                         jsonb_agg(a.privilege_type order by a.privilege_type) as privileges
                    from pg_class c
                    cross join lateral aclexplode(c.relacl) a
                   where c.oid = 'public.tasks'::regclass
                     and (a.grantee = 0
                          or a.grantee in ('anon'::regrole, 'authenticated'::regrole))
                   group by 1) x)
) t order by ord
