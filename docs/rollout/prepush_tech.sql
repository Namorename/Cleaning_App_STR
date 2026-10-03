-- Pre-push read for the stage «Техник и главный техник» + «Видео» (docs/tech-plan.md,
-- «Выкат серверной части»). Read-only, one statement, counts only — no names, no
-- e-mails, no phones, no ids of people. Run before the db push of the eight files:
--
--   node scripts/cloud-read.mjs docs/rollout/prepush_tech.sql
--
-- What it answers:
--   head           the cloud's last migration: 20260928140000 (F11) before this stage.
--   roles          active and inactive profiles by role. head_tech must be absent
--                  (the enum value arrives with the push; nobody can hold it before).
--   tech_links     links to listings held by technicians and head technicians: how
--                  many people, how many links, of which mode. The new trigger
--                  (20261003110000) refuses NEW links only; old rows stay until the
--                  owner takes them off in «Команда» (tech-plan §1: 27 «Из очереди»
--                  links on 30.09). A role change of such a person to tech/head_tech is
--                  refused while they stand.
--   tech_cleanings open cleanings, mid-stay cleanings and inspections assigned to a
--                  technician (not done, cancelled or expired), by type. The same:
--                  nothing breaks, but the owner takes them off himself (§2.5).
--   problems       tasks by status, and how many are archived: the head technician's
--                  board on day one, and the size of what problem_events will NOT
--                  hold (the journal starts empty).
--   live_repairs   live repairs of tasks by status: the attempts whose next move the
--                  journal will write.
--   hosts          companies, and whether any already has columns named video_*
--                  (must be 0: the columns come with 20261003170000).
--   push           phones registered, and rows waiting in the push queue by kind: the
--                  sender must be idle enough that the redeploy of send-push after the
--                  push lands between runs without a backlog.
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload

  union all
  select 2, 'roles',
         (select coalesce(jsonb_object_agg(r.role, jsonb_build_object('active', r.active,
                                                                      'inactive', r.inactive)),
                          '{}'::jsonb)
          from (select p.role::text as role,
                       count(*) filter (where p.is_active) as active,
                       count(*) filter (where not p.is_active) as inactive
                from public.profiles p
                group by p.role) r)

  union all
  select 3, 'tech_links',
         (select coalesce(jsonb_object_agg(x.role || ' ' || x.mode,
                                           jsonb_build_object('people', x.people, 'links', x.links)),
                          '{}'::jsonb)
          from (select p.role::text as role, pc.mode::text as mode,
                       count(distinct pc.cleaner_id) as people, count(*) as links
                from public.property_cleaners pc
                join public.profiles p on p.id = pc.cleaner_id
                where p.role::text in ('tech', 'head_tech')
                group by p.role, pc.mode) x)

  union all
  select 4, 'tech_cleanings',
         (select coalesce(jsonb_object_agg(x.type, x.n), '{}'::jsonb)
          from (select t.type::text as type, count(*) as n
                from public.tasks t
                join public.profiles p on p.id = t.assignee_id
                where p.role::text in ('tech', 'head_tech')
                  and t.type in ('cleaning', 'midstay', 'inspection')
                  and t.status not in ('done', 'cancelled', 'expired')
                group by t.type) x)

  union all
  select 5, 'problems',
         jsonb_build_object(
           'by_status', (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
                         from (select pb.status::text as status, count(*) as n
                               from public.problems pb group by pb.status) x),
           'archived', (select count(*) from public.problems pb where pb.archived_at is not null))

  union all
  select 6, 'live_repairs',
         (select coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb)
          from (select t.status::text as status, count(*) as n
                from public.tasks t
                where t.problem_id is not null and t.type = 'maintenance'
                  and t.status not in ('done', 'cancelled', 'expired')
                group by t.status) x)

  union all
  select 7, 'hosts',
         jsonb_build_object(
           'companies', (select count(*) from public.hosts),
           'video_columns', (select count(*) from pg_attribute a
                             where a.attrelid = 'public.hosts'::regclass
                               and a.attname like 'video\_%' and not a.attisdropped))

  union all
  select 8, 'push',
         jsonb_build_object(
           'tokens', (select count(*) from public.push_tokens),
           'pending', (select coalesce(jsonb_object_agg(x.kind, x.n), '{}'::jsonb)
                       from (select o.kind::text as kind, count(*) as n
                             from raw.push_outbox o where o.settled_at is null
                             group by o.kind) x))
) checks
order by ord;
