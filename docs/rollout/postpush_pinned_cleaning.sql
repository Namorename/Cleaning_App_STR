-- Post-push check for 20260926160000_pinned_cleaning (the owner's rule of
-- 2026-09-27: the cleaning follows its booking). Read-only, one statement,
-- catalog and one count:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_pinned_cleaning.sql
--
-- Expected, label by label:
--   head        20260926160000.
--   columns     pinned_arrival and pinned_departure, both date, nullable, no
--               column ACL; moved 0 right after the push (only a manager's
--               move in the panel sets them).
--   constraint  tasks_pinned_whole,
--               CHECK (((pinned_arrival IS NULL) = (pinned_departure IS NULL))),
--               validated.
--   functions   five rows, each owner postgres, security definer, config
--               {search_path=""}; volatility v but for the two sql ones (s).
--               The ACL of the two replaced ones is what they had before the
--               push (create or replace keeps it; cloud, 2026-09-26 — the
--               trigger function carries the hosting's default grants, which
--               the local stack does not give); cleaning_turnover_on is granted
--               by the hosting's defaults and then revoked from authenticated;
--               save_task is dropped and created, and granted again explicitly:
--                 cleaning_turnover_on(bigint,bigint,date)
--                   {postgres=X/postgres,service_role=X/postgres}           new
--                 generate_cleaning_tasks(date,date)
--                   {postgres=X/postgres,service_role=X/postgres}
--                 guard_task_fields()
--                   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                 reservation_cleaning_window(bigint,bigint)
--                   {postgres=X/postgres,service_role=X/postgres}     untouched
--                 save_task(uuid,bigint,task_type,date,text,jsonb,uuid,time without time zone,time without time zone,text,integer,boolean,date)
--                   {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}  new signature
--                 — the twelve-argument save_task is gone: exactly one row for it.
--               md5 prefix / length (local stack, 2026-09-27), and what the
--               cloud held before the push:
--                                              after              before
--                 cleaning_turnover_on         91d3a00c  1392     —
--                 generate_cleaning_tasks      f48b956b 19636     7730946a 13726
--                 guard_task_fields            ded65b7a  2130     0121a161  1950
--                 reservation_cleaning_window  3420c63a  1389     3420c63a  1389
--                 save_task                    91c9583b  9423     24f754be  5446
--   anon        false for all five. Any true is a stop.
--   public      false for all five.
--   tasks_acl   anon, authenticated and PUBLIC on public.tasks as before the
--               push: authenticated arwd (SELECT, INSERT, UPDATE, DELETE), anon
--               and PUBLIC nothing. A column adds no table privilege; this
--               checks that nothing else moved.
--
-- ROLLBACK. There is no down migration. A later forward migration restores the
-- three bodies of 20260926102000 / 20260910150000 / 20260923130000 (save_task
-- with its twelve arguments, dropping the thirteen-argument one — a panel
-- that sends p_expected_date must not be deployed then), drops
-- cleaning_turnover_on, the constraint and the two columns — the columns only
-- once no deployed panel selects them (a select naming a missing column
-- answers 42703 and empties the calendar). Restoring the bodies alone is safe
-- at any time: the old generator ignores the columns, and moved cleanings go
-- back under it on its next run — which is the incident of 2026-09-26 again,
-- so only as a last resort.
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload
  union all
  select 2, 'columns',
         (select jsonb_object_agg(a.attname, jsonb_build_object(
                   'type', format_type(a.atttypid, a.atttypmod),
                   'not_null', a.attnotnull,
                   'acl', a.attacl::text))
                 || jsonb_build_object('moved', (select count(*) from public.tasks t
                                                 where t.pinned_departure is not null))
            from pg_attribute a
           where a.attrelid = 'public.tasks'::regclass
             and a.attname in ('pinned_arrival', 'pinned_departure') and not a.attisdropped)
  union all
  select 3, 'constraint',
         (select jsonb_build_object('name', c.conname, 'def', pg_get_constraintdef(c.oid),
                                    'validated', c.convalidated)
            from pg_constraint c
           where c.conrelid = 'public.tasks'::regclass and c.conname = 'tasks_pinned_whole')
  union all
  select 4, 'functions',
         (select jsonb_agg(jsonb_build_object(
                   'signature', p.oid::regprocedure::text,
                   'md5', left(md5(p.prosrc), 8), 'len', length(p.prosrc),
                   'owner', p.proowner::regrole::text, 'definer', p.prosecdef,
                   'volatility', p.provolatile::text,
                   'config', p.proconfig, 'acl', p.proacl::text)
                   order by p.proname)
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('cleaning_turnover_on', 'generate_cleaning_tasks',
                               'guard_task_fields', 'reservation_cleaning_window', 'save_task'))
  union all
  select 5, 'anon',
         (select jsonb_object_agg(p.proname, has_function_privilege('anon', p.oid, 'execute'))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('cleaning_turnover_on', 'generate_cleaning_tasks',
                               'guard_task_fields', 'reservation_cleaning_window', 'save_task'))
  union all
  select 6, 'public',
         (select jsonb_object_agg(p.proname,
                                  exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                           where a.grantee = 0))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('cleaning_turnover_on', 'generate_cleaning_tasks',
                               'guard_task_fields', 'reservation_cleaning_window', 'save_task'))
  union all
  select 7, 'tasks_acl',
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
