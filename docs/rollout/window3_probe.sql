-- Window 3 probe (docs/window3-plan.md). Counts only: no names, addresses,
-- notes, e-mails or message text leave the database.
--
-- Part 1 replays the proposed staff_sees_property rule on live rows for every
-- active cleaner and technician and counts the property rows a phone reads
-- today that the rule would hide ("holes"). Every hole count must be 0.
-- Part 2 sizes the other three items of the window.
--
-- Run: npx supabase db query --linked -f docs/rollout/window3_probe.sql
with staff as (
  select pr.id as uid, pr.host_id, pr.role
  from public.profiles pr
  where pr.is_active and pr.role in ('cleaner', 'tech')
),
-- A direct tie between a person and a property, per arm of the rule.
tie as (
  select pc.cleaner_id as uid, pc.property_id as pid from public.property_cleaners pc
  union all
  select t.assignee_id, t.property_id from public.tasks t where t.assignee_id is not null
  union all
  select p.reported_by, p.property_id from public.problems p where p.property_id is not null
  union all
  select s.requested_by, s.property_id from public.supply_requests s where s.property_id is not null
),
-- The rule: a tie to the property or to a room/part under it (the listing
-- above), or a link to the listing above a real room (the rooms under it).
visible as (
  select s.uid, p.id as pid
  from staff s
  join public.properties p on p.host_id = s.host_id
  where exists (
          select 1 from tie
          where tie.uid = s.uid
            and (tie.pid = p.id
                 or tie.pid in (select c.id from public.properties c where c.parent_id = p.id)))
     or (p.hostaway_unit_id is not null
         and exists (select 1 from public.property_cleaners pc
                     where pc.cleaner_id = s.uid and pc.property_id = p.parent_id))
),
-- cleans_property(id) as it stands (20260912140000_unit_assignment.sql).
cleans as (
  select s.uid, p.id as pid
  from staff s
  join public.properties p on p.host_id = s.host_id
  where exists (select 1 from public.property_cleaners pc
                where pc.cleaner_id = s.uid and pc.property_id = p.id)
     or (p.hostaway_unit_id is not null
         and exists (select 1 from public.property_cleaners pc
                     where pc.cleaner_id = s.uid and pc.property_id = p.parent_id))
),
-- Every property row a phone reads today, with the reader that needs it.
-- Horizons and archive flags are ignored on purpose: that only adds rows.
needed_base as (
  select s.uid, t.property_id as pid, 'task_assignee' as reader
  from staff s join public.tasks t on t.assignee_id = s.uid and t.host_id = s.host_id
  union all
  select c.uid, t.property_id, 'task_on_linked'
  from cleans c join public.tasks t on t.property_id = c.pid
  union all
  select s.uid, p.property_id, 'problem_reporter'
  from staff s join public.problems p on p.reported_by = s.uid and p.host_id = s.host_id
  where p.property_id is not null
  union all
  select s.uid, p.property_id, 'problem_fixer'
  from staff s
  join public.tasks t on t.assignee_id = s.uid and t.problem_id is not null
                     and t.status not in ('cancelled', 'expired')
  join public.problems p on p.id = t.problem_id
  where p.property_id is not null
  union all
  select s.uid, r.property_id, 'supply_requester'
  from staff s join public.supply_requests r on r.requested_by = s.uid and r.host_id = s.host_id
  where r.property_id is not null
  union all
  select c.uid, c.pid, 'report_picker'
  from cleans c join public.properties p on p.id = c.pid and p.status <> 'archived'
),
-- The row itself and, for the parent:parent_id(name) embed and
-- effective_cleaner_notes, the row above it through bare parent_id.
needed as (
  select n.uid, n.pid, n.reader, 'row' as part from needed_base n
  union all
  select n.uid, p.parent_id, n.reader, 'parent'
  from needed_base n join public.properties p on p.id = n.pid
  where p.parent_id is not null
),
holes as (
  select n.* from needed n
  where not exists (select 1 from visible v where v.uid = n.uid and v.pid = n.pid)
),
per_staff as (
  select s.uid, s.role,
         (select count(*) from visible v where v.uid = s.uid) as sees_after,
         (select count(*) from public.properties p where p.host_id = s.host_id) as sees_before
  from staff s
)
select jsonb_build_object(
  'staff_by_role', (select jsonb_object_agg(role, n) from
                      (select role, count(*) as n from staff group by role) x),
  'sees_before_after', (select jsonb_agg(jsonb_build_object('role', role, 'before', sees_before,
                                                            'after', sees_after)
                                         order by role, sees_after) from per_staff),
  'holes_total', (select count(*) from holes),
  'holes_by_reader', (select coalesce(jsonb_object_agg(reader || '/' || part, n), '{}'::jsonb) from
                        (select reader, part, count(*) as n from holes group by reader, part) x),
  'properties', (select jsonb_build_object(
                   'total', count(*),
                   'listings', count(*) filter (where parent_id is null),
                   'rooms', count(*) filter (where hostaway_unit_id is not null),
                   'combined_parts', count(*) filter (where parent_id is not null and hostaway_unit_id is null),
                   'by_status', (select jsonb_object_agg(status, n) from
                                   (select status, count(*) as n from public.properties group by status) y))
                 from public.properties),
  'links', (select jsonb_build_object(
              'total', count(*),
              'to_rooms', count(*) filter (where p.hostaway_unit_id is not null),
              'to_combined_parts', count(*) filter (where p.parent_id is not null and p.hostaway_unit_id is null),
              'claim', count(*) filter (where pc.mode = 'claim'),
              'auto', count(*) filter (where pc.mode = 'auto'),
              'to_tech', count(*) filter (where pr.role = 'tech'),
              'to_inactive', count(*) filter (where not pr.is_active),
              'listings_without_link', (select count(*) from public.properties l
                                        where l.parent_id is null and l.status = 'active'
                                          and not exists (select 1 from public.property_cleaners x
                                                          where x.property_id = l.id)))
            from public.property_cleaners pc
            join public.properties p on p.id = pc.property_id
            join public.profiles pr on pr.id = pc.cleaner_id),
  -- internal_notes through to_jsonb: the column is dropped by M2, and the
  -- probe has to keep running after it (the key then reads 0).
  'notes', (select jsonb_build_object(
              'internal_nonempty', count(*) filter (where nullif(btrim(to_jsonb(p) ->> 'internal_notes'), '') is not null),
              'cleaner_nonempty_listings', count(*) filter (where p.parent_id is null
                                                  and nullif(btrim(p.cleaner_notes), '') is not null),
              'cleaner_nonempty_children', count(*) filter (where p.parent_id is not null
                                                  and nullif(btrim(p.cleaner_notes), '') is not null))
            from public.properties p),
  'tasks', (select jsonb_build_object(
              'completed_by_not_assignee', count(*) filter (where completed_by is not null
                                             and completed_by is distinct from assignee_id),
              'completed_by_set', count(*) filter (where completed_by is not null),
              -- Who finished, who holds the task now, and whether the finisher
              -- can still read it: roles and flags only.
              'finisher_mismatch', (select coalesce(jsonb_agg(jsonb_build_object(
                    'status', t3.status,
                    'type', t3.type,
                    'assignee_null', t3.assignee_id is null,
                    'finisher_role', f.role,
                    'finisher_active', f.is_active,
                    'assignee_role', a.role,
                    'finisher_linked', exists (select 1 from public.property_cleaners pc
                                               join public.properties p on p.id = t3.property_id
                                               where pc.cleaner_id = t3.completed_by
                                                 and (pc.property_id = p.id
                                                      or (p.hostaway_unit_id is not null
                                                          and pc.property_id = p.parent_id))),
                    'finished_days_ago', extract(day from now() - t3.completed_at)::int)), '[]'::jsonb)
                  from public.tasks t3
                  join public.profiles f on f.id = t3.completed_by
                  left join public.profiles a on a.id = t3.assignee_id
                  where t3.completed_by is distinct from t3.assignee_id),
              'by_type', (select jsonb_object_agg(type, n) from
                            (select type, count(*) as n from public.tasks group by type) y),
              'assigned_to_tech', (select count(*) from public.tasks t2
                                   join public.profiles pr on pr.id = t2.assignee_id
                                   where pr.role = 'tech'))
            from public.tasks),
  'open_manual_on_inactive', (select coalesce(jsonb_object_agg(type || '/' || status, n), '{}'::jsonb) from (
      select t.type, t.status, count(*) as n
      from public.tasks t
      join public.properties p on p.id = t.property_id
      left join public.properties l on l.id = p.parent_id and p.hostaway_unit_id is not null
      where t.type in ('midstay', 'inspection')
        and t.status in ('unassigned', 'assigned')
        and (p.status <> 'active' or l.status <> 'active')
      group by t.type, t.status) x),
  'webhook_events', (select jsonb_build_object(
      'by_status', (select jsonb_object_agg(status, n) from
                      (select status, count(*) as n from raw.webhook_events group by status) y),
      'oldest_days', (select extract(day from now() - min(received_at))::int from raw.webhook_events),
      'first_purge_would_delete', (select count(*) from raw.webhook_events
                                   where status in ('processed', 'skipped')
                                     and received_at < now() - interval '30 days'))),
  'cron_jobs', (select jsonb_agg(jobname || ' ' || schedule order by jobname) from cron.job)
) as probe;
