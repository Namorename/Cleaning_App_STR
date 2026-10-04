-- Post-push check for 20261004100000_staff_disable (docs/staff-disable-plan.md, «Выкат»).
-- Read-only, one statement, catalog and counts only — no names, no ids of people. Run right
-- after the db push:
--
--   node scripts/cloud-read.mjs docs/rollout/postpush_staff_disable.sql
--
-- Grants come from pg_proc.proacl through aclexplode (a function with no ACL of its own reads
-- its built-in default, acldefault) — information_schema shows the read-only role nothing, and
-- a check built on it passes without checking (CLAUDE.md). No table changes in this push, so
-- the table matrix (postpush_window3.sql, public_grants) does not move.
--
-- Expected, label by label (local stack after db:reset on staff-disable, 2026-10-04):
--   head        20261004100000.
--   functions   7 rows, one per name, overloads = 1, config {search_path=""}, definer true; md5
--               prefix and length exactly (the text between the dollar quotes of each create in
--               the migration file, read with newline='' so a CRLF would change it; the same as
--               md5(prosrc) and length(prosrc) on the local stack):
--                 guard_link_works               159d1c60   537
--                 guard_person_works             dcb1f989   512
--                 journal_repair_change          05ea64d7  4205
--                 release_work_of_inactive       7c659a96  3416
--                 release_work_on_deactivation   36da10a1    78
--                 take_off_repairs               be6993e3  1054
--                 unassign_problem               6282d99b  2088
--               journal_repair_change is no new function: 20261003140000 made it, this file adds
--               the cause of a take-off (owner's answer 3 of 2026-10-04).
--               A different md5 is a file saved with CRLF or a body edited after this list —
--               recompute before the push, never after.
--   function_privs  who of anon / authenticated / PUBLIC holds EXECUTE: [] for the five new
--               ones and for journal_repair_change; ["authenticated"] for unassign_problem (its ACL from 20261003130000, kept by
--               create or replace).
--   triggers    four, enabled ('O'), "row": true, "when": true, and the md5 prefix of
--               pg_get_triggerdef exactly (local stack; an older trigger,
--               tasks_no_cleaning_for_tech, hashes the same in the cloud and locally —
--               58b40f36 — so the definitions compare as they are printed):
--                 profiles_release_work         profiles           [is_active]   after   78d31b2c
--                 property_cleaners_person_works property_cleaners []           before  adeef84d
--                 tasks_person_works_insert     tasks              []            before  879a2481
--                 tasks_person_works_update     tasks              [assignee_id, status] before d24bc3f1
--   left_on_off unstarted jobs ('unassigned' with a name, assigned, accepted) on people switched
--               off: {} — the cleanup took off every one (the probe counted 87 cleanings on
--               2026-10-04); and their links, any mode: 0.
--   under_way   work under way on people switched off by type and status, on listings not
--               archived — as the panel's readers count it: what the dashboard's «Уборок у
--               отключённых» and «Ремонтов у отключённых» show ({} on 2026-10-04).
--   freed       cleanings nobody holds whose last change came in the push's hour — the freed
--               ones among them (87 on 2026-10-04, plus whatever the generator or the office
--               freed in that hour); their days past / grace / week / later as the probe had them.
--   journal     taken_off events by the system (no actor) in the push's hour: the repairs the
--               cleanup took off — 0 on 2026-10-04.
--   push        the queue's rows written in the push's hour by kind, waiting and settled apart
--               (settled as "kind outcome"): no cleaning_free from the cleanup on 2026-10-04 (the
--               probe's free_push was 0). Rows written before the hour are not counted — on
--               2026-10-04 one cleaning_free waited in the cloud that the cleanup did not write.
--               And "settled_off": rows of people switched off settled as skipped in the hour —
--               what the cleanup settled (the probe's pushes_settled: 0 on 2026-10-04).
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload

  union all
  select 2, 'functions',
         (select jsonb_agg(jsonb_build_object(
                   'name', f.name,
                   'overloads', (select count(*) from pg_proc p2
                                 where p2.pronamespace = 'public'::regnamespace and p2.proname = f.name),
                   'md5', left(md5(p.prosrc), 8), 'len', length(p.prosrc),
                   'definer', p.prosecdef, 'config', p.proconfig) order by f.name)
          from unnest(array['guard_link_works', 'guard_person_works', 'journal_repair_change',
                            'release_work_of_inactive', 'release_work_on_deactivation',
                            'take_off_repairs', 'unassign_problem']) as f(name)
          left join pg_proc p
            on p.pronamespace = 'public'::regnamespace and p.proname = f.name)

  union all
  select 3, 'function_privs',
         (select jsonb_agg(jsonb_build_object(
                   'name', p.proname,
                   'execute', (select coalesce(jsonb_agg(distinct
                                        case when a.grantee = 0 then 'PUBLIC'
                                             else a.grantee::regrole::text end), '[]'::jsonb)
                               from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                               where a.privilege_type = 'EXECUTE'
                                 and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)))
                   order by p.proname)
          from pg_proc p
          where p.pronamespace = 'public'::regnamespace
            and p.proname in ('guard_link_works', 'guard_person_works', 'journal_repair_change',
                              'release_work_of_inactive', 'release_work_on_deactivation',
                              'take_off_repairs', 'unassign_problem'))

  union all
  select 4, 'triggers',
         (select jsonb_agg(jsonb_build_object('table', t.tgrelid::regclass::text, 'name', t.tgname,
                                              'md5', left(md5(pg_get_triggerdef(t.oid)), 8),
                                              'enabled', t.tgenabled,
                                              'row', (t.tgtype & 1) = 1,
                                              'before', (t.tgtype & 2) = 2,
                                              'when', t.tgqual is not null,
                                              'columns', (select coalesce(jsonb_agg(a.attname order by a.attname),
                                                                          '[]'::jsonb)
                                                          from pg_attribute a
                                                          where a.attrelid = t.tgrelid
                                                            and a.attnum = any (t.tgattr::int2[])))
                           order by t.tgname)
          from pg_trigger t
          where not t.tgisinternal
            and t.tgname in ('profiles_release_work', 'property_cleaners_person_works',
                             'tasks_person_works_insert', 'tasks_person_works_update'))

  union all
  select 5, 'left_on_off',
         jsonb_build_object(
           'unstarted', (select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
                         from (select t.type::text || ' ' || t.status::text as k, count(*) as n
                               from public.tasks t
                               join public.profiles p on p.id = t.assignee_id
                               where not p.is_active
                                 and t.status in ('unassigned', 'assigned', 'accepted')
                               group by 1) x),
           'links', (select count(*)
                     from public.property_cleaners pc
                     join public.profiles p on p.id = pc.cleaner_id
                     where not p.is_active))

  union all
  select 6, 'under_way',
         (select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
          from (select t.type::text || case when t.problem_id is not null then '+task' else '' end
                       || ' ' || t.status::text as k,
                       count(*) as n
                from public.tasks t
                join public.profiles p on p.id = t.assignee_id
                join public.properties pr on pr.id = t.property_id
                where not p.is_active
                  and t.status in ('in_progress', 'paused', 'blocked')
                  and pr.status <> 'archived'
                group by 1) x)

  union all
  select 7, 'freed',
         (select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
          from (select case when t.scheduled_date < (now() at time zone pr.timezone)::date - 1 then 'past'
                            when t.scheduled_date < (now() at time zone pr.timezone)::date then 'grace'
                            when t.scheduled_date <= (now() at time zone pr.timezone)::date + 7 then 'week'
                            else 'later' end as k,
                       count(*) as n
                from public.tasks t
                join public.properties pr on pr.id = t.property_id
                where t.status = 'unassigned'
                  and t.assignee_id is null
                  and t.updated_at > now() - interval '1 hour'
                group by 1) x)

  union all
  select 8, 'journal',
         (select to_jsonb(count(*))
          from public.problem_events e
          where e.kind = 'taken_off'
            and e.actor_id is null
            and e.created_at > now() - interval '1 hour')

  union all
  select 9, 'push',
         jsonb_build_object(
           'waiting', (select coalesce(jsonb_object_agg(x.kind, x.n), '{}'::jsonb)
                       from (select o.kind::text as kind, count(*) as n
                             from raw.push_outbox o
                             where o.created_at > now() - interval '1 hour'
                               and o.settled_at is null
                             group by o.kind) x),
           'settled', (select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
                       from (select o.kind::text || ' ' || o.outcome as k, count(*) as n
                             from raw.push_outbox o
                             where o.created_at > now() - interval '1 hour'
                               and o.settled_at is not null
                             group by 1) x),
           'settled_off', (select count(*)
                           from raw.push_outbox o
                           join public.profiles p on p.id = o.recipient_id
                           where not p.is_active
                             and o.outcome = 'skipped'
                             and o.settled_at > now() - interval '1 hour'))
) checks
order by ord;

-- ROLLBACK. One file, its own transaction; a revert is a forward migration through the same
-- dry-run gate (docs/units-plan.md, «Эксплуатация выката»), never a hand edit in Studio:
-- drop the four triggers, drop the five new functions, and unassign_problem and
-- journal_repair_change back to their bodies of 20261003130000 and 20261003140000 (same
-- signatures, create or replace). The jobs the cleanup freed stay free — nothing records whose
-- they were but the journal of the repairs (taken_off, params.assignee) and the docs' probe
-- numbers; removed links do not come back (0 on 2026-10-04).
