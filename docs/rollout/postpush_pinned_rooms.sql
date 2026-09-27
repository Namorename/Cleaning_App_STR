-- Post-push check for 20260927120000_pinned_rooms (the owner's word of
-- 2026-09-27: any change of a booking's rooms undoes every move of it; the
-- window of a booking's cleaning is the server's). Read-only, one statement,
-- catalog and one count:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_pinned_rooms.sql
--
-- Expected, label by label:
--   head         20260927120000.
--   columns      pinned_arrival and pinned_departure date, pinned_rooms bigint[],
--                all three nullable, no column ACL; moved as the probe before
--                the push counted it (0 on 2026-09-27).
--   constraints  tasks_pinned_whole and tasks_pinned_rooms_whole, both
--                validated:
--                  CHECK (((pinned_arrival IS NULL) = (pinned_departure IS NULL)))
--                  CHECK (((pinned_rooms IS NULL) = (pinned_departure IS NULL)))
--   functions    six rows, owner postgres, config {search_path=""}; all
--                security definer but reservation_rooms; volatility v but for
--                the three sql ones (s). The three replaced ones keep the ACL
--                they had (create or replace keeps it); reservation_rooms is
--                granted by the hosting's defaults and revoked from public,
--                anon and authenticated:
--                  cleaning_turnover_on(bigint,bigint,date)
--                    {postgres=X/postgres,service_role=X/postgres}     untouched
--                  generate_cleaning_tasks(date,date)
--                    {postgres=X/postgres,service_role=X/postgres}
--                  guard_task_fields()
--                    {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                  reservation_cleaning_window(bigint,bigint)
--                    {postgres=X/postgres,service_role=X/postgres}     untouched
--                  reservation_rooms(bigint)
--                    {postgres=X/postgres,service_role=X/postgres}     new
--                  save_task(uuid,bigint,task_type,date,text,jsonb,uuid,time without time zone,time without time zone,text,integer,boolean,date)
--                    {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
--                — one row for save_task, the thirteen-argument one.
--                md5 prefix / length of the bodies in the migration file as
--                committed (LF, what db push stores; the local stack holds the
--                same after the bodies were re-applied from the file), and what
--                the cloud held before the push (postpush_pinned_cleaning.sql);
--                has_cr false for all six — a body re-created through a
--                Windows pipe carries CRs and another md5 for the same text:
--                                               after              before
--                  cleaning_turnover_on         eb21e064  1737     eb21e064  1737
--                  generate_cleaning_tasks      6615ddf6 21150     40d48c56 19728
--                  guard_task_fields            26092472  2181     ded65b7a  2130
--                  reservation_cleaning_window  3420c63a  1389     3420c63a  1389
--                  reservation_rooms            55a579fb   171     —
--                  save_task                    ca2ee81c 10608     bcdae505  9662
--   anon         false for all six. Any true is a stop.
--   public       false for all six.
--   tasks_acl    as before the push: authenticated DELETE, INSERT, SELECT,
--                UPDATE; anon and PUBLIC nothing.
--
-- ROLLBACK: see the header of the migration.
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
             and a.attname in ('pinned_arrival', 'pinned_departure', 'pinned_rooms')
             and not a.attisdropped)
  union all
  select 3, 'constraints',
         (select jsonb_agg(jsonb_build_object('name', c.conname, 'def', pg_get_constraintdef(c.oid),
                                              'validated', c.convalidated)
                           order by c.conname)
            from pg_constraint c
           where c.conrelid = 'public.tasks'::regclass
             and c.conname in ('tasks_pinned_whole', 'tasks_pinned_rooms_whole'))
  union all
  select 4, 'functions',
         (select jsonb_agg(jsonb_build_object(
                   'signature', p.oid::regprocedure::text,
                   'md5', left(md5(p.prosrc), 8), 'len', length(p.prosrc),
                   'has_cr', position(chr(13) in p.prosrc) > 0,
                   'owner', p.proowner::regrole::text, 'definer', p.prosecdef,
                   'volatility', p.provolatile::text,
                   'config', p.proconfig, 'acl', p.proacl::text)
                   order by p.proname)
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('cleaning_turnover_on', 'generate_cleaning_tasks',
                               'guard_task_fields', 'reservation_cleaning_window',
                               'reservation_rooms', 'save_task'))
  union all
  select 5, 'anon',
         (select jsonb_object_agg(p.proname, has_function_privilege('anon', p.oid, 'execute'))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('cleaning_turnover_on', 'generate_cleaning_tasks',
                               'guard_task_fields', 'reservation_cleaning_window',
                               'reservation_rooms', 'save_task'))
  union all
  select 6, 'public',
         (select jsonb_object_agg(p.proname,
                                  exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                                           where a.grantee = 0))
            from pg_proc p
           where p.pronamespace = 'public'::regnamespace
             and p.proname in ('cleaning_turnover_on', 'generate_cleaning_tasks',
                               'guard_task_fields', 'reservation_cleaning_window',
                               'reservation_rooms', 'save_task'))
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
