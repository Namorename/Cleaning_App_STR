-- Pre-push read for 20261004100000_staff_disable (docs/staff-disable-plan.md, «Выкат»).
-- Read-only, one statement, counts only — no names, no e-mails, no phones, no ids of people.
-- Run before the db push, and again right before it if a day has passed:
--
--   node scripts/cloud-read.mjs docs/rollout/staff_disable_probe.sql
--
-- What the one-off cleanup at the end of the migration (release_work_of_inactive for
-- everybody switched off) will touch, and what it sets off:
--
--   head           the cloud's last migration: 20261003170000 before this push.
--   people         profiles by role, working and switched off.
--   released       jobs nobody has started on people switched off — 'unassigned' with a name,
--                  assigned, accepted — by what happens to them and their status:
--                  "free <type> <status>" become unassigned with nobody on them (cleanings of
--                  every kind, inspections, repairs written by hand), "taken_off <status>" are
--                  repairs of tasks, cancelled under the take-off flag. Its total is the number
--                  of rows the cleanup writes in tasks.
--   reopened       the tasks (problems) of those repairs by status, and how many are archived.
--                  Every repair taken off writes one taken_off line in its task's journal, an
--                  archived task's too; only the non-archived ones go back to 'open' (the mirror
--                  leaves an archived one as it is).
--   free_by_day    the freed jobs by their day against the listing's today: past (before
--                  yesterday — the sweep closes those as before), grace (yesterday), week (today
--                  to the seventh day), later.
--   free_push      push rows the cleanup queues: a freed cleaning or mid-stay cleaning in the
--                  week, times the working people linked to its listing (or its house) who have
--                  a phone. An upper bound — the rule cleans_property_as and the person's
--                  muted kinds are asked when it is written and sent.
--   handover       freed booking cleanings on a listing (or its house) that has a working 'auto'
--                  cleaner: the generator's next run over their day hands them to that person
--                  (its hand-over pass), as any free cleaning there.
--   links          links of people switched off by mode; every 'auto' becomes 'claim'.
--   pushes_settled rows of people switched off still waiting in the push queue, by kind, and how
--                  many of them a sender holds right now: the cleanup settles every other one as
--                  skipped (what claim_push_batch does while they are off); a held group is left
--                  to its sender.
--   under_way      work under way on people switched off, by type and status: not touched, it
--                  is what the dashboard's «У отключённых» shows from the push on.
--   objects        the push's functions and triggers already in the cloud: must be 0 and 0.
--   push           rows waiting in the push queue by kind: the sender should be idle.
select label, payload from (
  select 1 as ord, 'head' as label,
         to_jsonb((select max(version) from supabase_migrations.schema_migrations)) as payload

  union all
  select 2, 'people',
         (select coalesce(jsonb_object_agg(r.role, jsonb_build_object('working', r.working,
                                                                      'off', r.off)), '{}'::jsonb)
          from (select p.role::text as role,
                       count(*) filter (where p.is_active) as working,
                       count(*) filter (where not p.is_active) as off
                from public.profiles p
                group by p.role) r)

  union all
  select 3, 'released',
         (select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
          from (select case when t.type = 'maintenance' and t.problem_id is not null
                            then 'taken_off ' || t.status::text
                            else 'free ' || t.type::text || ' ' || t.status::text end as k,
                       count(*) as n
                from public.tasks t
                join public.profiles p on p.id = t.assignee_id
                where not p.is_active
                  and t.status in ('unassigned', 'assigned', 'accepted')
                group by 1) x)

  union all
  select 4, 'reopened',
         (select jsonb_build_object(
                   'by_status', coalesce(jsonb_object_agg(x.status, x.n), '{}'::jsonb),
                   'archived', coalesce(sum(x.archived), 0))
          from (select pb.status::text as status, count(*) as n,
                       count(*) filter (where pb.archived_at is not null) as archived
                from public.problems pb
                where pb.id in (select t.problem_id
                                from public.tasks t
                                join public.profiles p on p.id = t.assignee_id
                                where not p.is_active
                                  and t.type = 'maintenance' and t.problem_id is not null
                                  and t.status in ('unassigned', 'assigned', 'accepted'))
                group by pb.status) x)

  union all
  select 5, 'free_by_day',
         (select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
          from (select case when t.scheduled_date < (now() at time zone pr.timezone)::date - 1 then 'past'
                            when t.scheduled_date < (now() at time zone pr.timezone)::date then 'grace'
                            when t.scheduled_date <= (now() at time zone pr.timezone)::date + 7 then 'week'
                            else 'later' end as k,
                       count(*) as n
                from public.tasks t
                join public.profiles p on p.id = t.assignee_id
                join public.properties pr on pr.id = t.property_id
                where not p.is_active
                  and t.status in ('unassigned', 'assigned', 'accepted')
                  and not (t.type = 'maintenance' and t.problem_id is not null)
                group by 1) x)

  union all
  select 6, 'free_push',
         (select to_jsonb(count(*))
          from public.tasks t
          join public.profiles p on p.id = t.assignee_id
          join public.properties pr on pr.id = t.property_id
          join lateral (select distinct pc.cleaner_id
                        from public.property_cleaners pc
                        join public.profiles q on q.id = pc.cleaner_id
                        where pc.property_id in (pr.id, pr.parent_id)
                          and q.is_active
                          and exists (select 1 from public.push_tokens k where k.profile_id = q.id)) w
            on true
          where not p.is_active
            and t.status in ('unassigned', 'assigned', 'accepted')
            and t.type in ('cleaning', 'midstay')
            and t.scheduled_date between (now() at time zone pr.timezone)::date - 1
                                     and (now() at time zone pr.timezone)::date + 7)

  union all
  select 7, 'handover',
         (select to_jsonb(count(*))
          from public.tasks t
          join public.profiles p on p.id = t.assignee_id
          join public.properties pr on pr.id = t.property_id
          where not p.is_active
            and t.status in ('unassigned', 'assigned', 'accepted')
            and t.type = 'cleaning' and t.reservation_id is not null
            and exists (select 1 from public.property_cleaners pc
                        join public.profiles q on q.id = pc.cleaner_id
                        where pc.mode = 'auto' and q.is_active
                          and (pc.property_id = pr.id
                               or (pr.hostaway_unit_id is not null and pc.property_id = pr.parent_id))))

  union all
  select 8, 'links',
         (select coalesce(jsonb_object_agg(x.mode, jsonb_build_object('people', x.people, 'links', x.links)),
                          '{}'::jsonb)
          from (select pc.mode::text as mode, count(distinct pc.cleaner_id) as people, count(*) as links
                from public.property_cleaners pc
                join public.profiles p on p.id = pc.cleaner_id
                where not p.is_active
                group by pc.mode) x)

  union all
  select 9, 'pushes_settled',
         jsonb_build_object(
           'by_kind', (select coalesce(jsonb_object_agg(x.kind, x.n), '{}'::jsonb)
                       from (select o.kind::text as kind, count(*) as n
                             from raw.push_outbox o
                             join public.profiles p on p.id = o.recipient_id
                             where not p.is_active and o.settled_at is null
                             group by o.kind) x),
           'held', (select count(*)
                    from raw.push_outbox o
                    join public.profiles p on p.id = o.recipient_id
                    where not p.is_active and o.settled_at is null
                      and o.claimed_until > now()))

  union all
  select 10, 'under_way',
         (select coalesce(jsonb_object_agg(x.k, x.n), '{}'::jsonb)
          from (select t.type::text || case when t.problem_id is not null then '+task' else '' end
                       || ' ' || t.status::text as k,
                       count(*) as n
                from public.tasks t
                join public.profiles p on p.id = t.assignee_id
                where not p.is_active
                  and t.status in ('in_progress', 'paused', 'blocked')
                group by 1) x)

  union all
  select 11, 'objects',
         jsonb_build_object(
           'functions', (select count(*) from pg_proc pp
                         where pp.pronamespace = 'public'::regnamespace
                           and pp.proname in ('take_off_repairs', 'release_work_of_inactive',
                                              'release_work_on_deactivation', 'guard_person_works',
                                              'guard_auto_link_works')),
           'triggers', (select count(*) from pg_trigger tg
                        where not tg.tgisinternal
                          and tg.tgname in ('profiles_release_work', 'tasks_person_works_insert',
                                            'tasks_person_works_update',
                                            'property_cleaners_auto_works')))

  union all
  select 12, 'push',
         (select coalesce(jsonb_object_agg(x.kind, x.n), '{}'::jsonb)
          from (select o.kind::text as kind, count(*) as n
                from raw.push_outbox o where o.settled_at is null
                group by o.kind) x)
) checks
order by ord;
