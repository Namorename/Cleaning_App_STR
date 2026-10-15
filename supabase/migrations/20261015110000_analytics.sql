-- The owner's analytics, step 1 (docs/dashboard-metrics.md; owner's decisions
-- of 2026-10-14): the figures and tables of the panel's Analytics page,
-- counted by the server.
--
-- The rules every function keeps:
--
-- - The manager of the company alone. Each public function is security
--   definer, so it reads past RLS; it asks is_manager() first and keeps to
--   current_host_id() in every query. Anyone else gets serverErrors.managerOnly.
--
-- - A period is a pair of listing-local days, from and to inclusive, at most
--   400 days long (serverErrors.analyticsPeriodInvalid). A comparison with the
--   previous period is a second call.
--
-- - The day of a row is the day of its listing's calendar:
--     a cleaning is planned on scheduled_date (already a local day) and done
--     on the local day of completed_at in its property's zone — two figures;
--     a checkout is a live booking on its departure_date, a listing-local date
--     from Hostaway, whatever day it was booked or the guest came; live means
--     new or modified, not an owner's block, not the office's '#' booking
--     (the generator's rule, 20260926102000); it frees the rooms the booking
--     holds, and a flat with no rooms is one room (owner, 2026-10-15);
--     occupancy counts nights: a booking's nights inside the period, room by
--     room for a multi-room listing, over the listing's rooms × days;
--     a task (problem) is created, resolved, cancelled on the local day of its
--     listing, or of the company (Europe/Prague, as push_timezone() — hosts
--     has no zone before F25) when it names none.
--
-- - A room is counted under its listing (parent_id when hostaway_unit_id is
--   set). The demo listings — ids 900000000000–999999999999, the band of the
--   App Store demo — stay out unless p_include_test is true.
--
-- - The archive (owner, 2026-10-15). A task the manager put away
--   (archive_problem: the panel's «delete», nothing is deleted) counts only if
--   it was resolved before it was put away; one closed without a resolution —
--   cancelled, a duplicate, a test put away while open — is no task at all,
--   in any figure of any period. An archived listing keeps its checkouts,
--   cleanings and tasks unless p_hide_archived is true; occupancy leaves it
--   out either way, because the days it was in work are not recorded and a
--   period of empty nights would be a lie. p_hide_archived null means the
--   caller said nothing: nothing is hidden.
--
-- - Cleanings are 'cleaning' and 'midstay' tasks that answer no problem; the
--   mid-stay ones are also given apart. The duration of a done cleaning is the
--   manager's correction if there is one, else the measured minutes when they
--   lie between 5 and 360 — shorter or longer is a measurement nobody trusts,
--   and it is left out of the median and the mean (not out of the counts).
--
-- - Filters, each null for "all": listings (bigint[], a room's listing
--   matches), people (uuid[]: who finished a done cleaning or holds a waiting
--   one; for tasks, whoever holds or did their repair), cleaning statuses,
--   task statuses, urgencies. Checkouts and occupancy take the listing filter
--   alone.
--
-- - Tables come a page at a time (p_limit 1–500, default 50; p_offset), each
--   row carrying total_count, the number of rows of the whole table.
--
-- The row functions (analytics_*_rows) are the shared core and are not for
-- clients: no grant. The public functions only read; nothing here writes.

-- ---------- the shared rules ----------

create or replace function public.analytics_is_test_listing(p_id bigint)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p_id between 900000000000 and 999999999999
$$;

comment on function public.analytics_is_test_listing(bigint) is
  'A listing of the demo band, out of the analytics unless asked (20261015110000).';

-- The caller may ask, and for this period: the company's id, or an error.
create or replace function public.analytics_guard(p_from date, p_to date)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'Analytics is for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > 400 then
    raise exception 'An analytics period runs forward and lasts at most 400 days, not % to %',
                    p_from, p_to
      using errcode = 'invalid_parameter_value',
            hint = 'serverErrors.analyticsPeriodInvalid',
            detail = json_build_object('maxDays', 400)::text;
  end if;
  return public.current_host_id();
end;
$$;

-- ---------- the rows ----------

-- Every cleaning that could count in the period: planned in it, or done
-- around it (the exact local day is decided by the caller).
create or replace function public.analytics_cleaning_rows(
  p_host           uuid,
  p_from           date,
  p_to             date,
  p_property_ids   bigint[],
  p_assignee_ids   uuid[],
  p_task_statuses  public.task_status[],
  p_include_test   boolean,
  p_hide_archived  boolean
)
returns table (
  task_id        uuid,
  listing_id     bigint,
  type           public.task_type,
  status         public.task_status,
  scheduled_date date,
  done_day       date,
  assignee_id    uuid,
  completed_by   uuid,
  minutes        numeric,
  has_photo      boolean
)
language sql
stable
set search_path = ''
as $$
  select t.id,
         l.id,
         t.type,
         t.status,
         t.scheduled_date,
         case when t.status = 'done' then (t.completed_at at time zone p.timezone)::date end,
         t.assignee_id,
         t.completed_by,
         case
           when t.status <> 'done' then null
           when t.duration_override_min is not null then t.duration_override_min::numeric
           when t.measured_minutes between 5 and 360 then t.measured_minutes::numeric
         end,
         exists (select 1 from public.task_media m
                 where m.task_id = t.id
                   and m.kind = 'photo'
                   and m.uploaded_at is not null
                   and m.deleted_at is null)
  from public.tasks t
  join public.properties p on p.id = t.property_id
  join public.properties l
    on l.id = case when p.hostaway_unit_id is not null then p.parent_id else p.id end
  where t.host_id = p_host
    and t.type in ('cleaning', 'midstay')
    and t.problem_id is null
    and (t.scheduled_date between p_from and p_to
         -- Any zone is within a day of UTC: a margin of a day each side
         -- keeps every cleaning finished on a local day of the period.
         or (t.status = 'done'
             and t.completed_at >= (p_from - 1)::timestamp at time zone 'UTC'
             and t.completed_at < (p_to + 2)::timestamp at time zone 'UTC'))
    and (p_include_test or not public.analytics_is_test_listing(l.id))
    and (not coalesce(p_hide_archived, false) or l.status <> 'archived')
    and (p_property_ids is null or l.id = any (p_property_ids))
    and (p_task_statuses is null or t.status = any (p_task_statuses))
    and (p_assignee_ids is null or coalesce(t.completed_by, t.assignee_id) = any (p_assignee_ids))
$$;

-- The live bookings that leave in the period, with the rooms they free: the
-- rooms the booking holds, and a flat with no rooms is one.
create or replace function public.analytics_checkout_rows(
  p_host           uuid,
  p_from           date,
  p_to             date,
  p_property_ids   bigint[],
  p_include_test   boolean,
  p_hide_archived  boolean
)
returns table (reservation_id bigint, listing_id bigint, departure_date date, rooms integer)
language sql
stable
set search_path = ''
as $$
  select r.id,
         l.id,
         r.departure_date,
         greatest(1, (select count(*) from public.reservation_units u
                      where u.reservation_id = r.id))::integer
  from public.reservations r
  join public.properties p on p.id = r.property_id
  join public.properties l
    on l.id = case when p.hostaway_unit_id is not null then p.parent_id else p.id end
  where r.host_id = p_host
    and r.departure_date between p_from and p_to
    and r.status in ('new', 'modified')
    and not r.is_block
    and not public.is_service_booking(r.guest_name)
    and (p_include_test or not public.analytics_is_test_listing(l.id))
    and (not coalesce(p_hide_archived, false) or l.status <> 'archived')
    and (p_property_ids is null or l.id = any (p_property_ids))
$$;

-- Each listing's room-nights taken in the period, over the room-nights it had.
-- An archived listing is left out: the days it was in work are not recorded.
create or replace function public.analytics_occupancy_rows(
  p_host          uuid,
  p_from          date,
  p_to            date,
  p_property_ids  bigint[],
  p_include_test  boolean
)
returns table (listing_id bigint, occupied_nights integer, available_nights integer)
language sql
stable
set search_path = ''
as $$
  with listings as (
    select l.id,
           greatest(1, (select count(*) from public.properties u
                        where u.parent_id = l.id and u.hostaway_unit_id is not null))::integer
             * (p_to - p_from + 1) as available
    from public.properties l
    where l.host_id = p_host
      and l.hostaway_unit_id is null
      and l.status <> 'archived'
      and (p_include_test or not public.analytics_is_test_listing(l.id))
      and (p_property_ids is null or l.id = any (p_property_ids))
  ),
  taken as (
    select r.property_id as listing_id,
           sum(greatest(0, least(r.departure_date, p_to + 1) - greatest(r.arrival_date, p_from))
               * greatest(1, (select count(*) from public.reservation_units u
                              where u.reservation_id = r.id))::integer)::integer as nights
    from public.reservations r
    where r.host_id = p_host
      and r.arrival_date <= p_to
      and r.departure_date > p_from
      and r.status in ('new', 'modified')
      and not r.is_block
      and not public.is_service_booking(r.guest_name)
    group by r.property_id
  )
  select l.id, least(coalesce(t.nights, 0), l.available), l.available
  from listings l
  left join taken t on t.listing_id = l.id
$$;

-- Every task (problem) created by the end of the period, on local days —
-- but not one put away without a resolution (see the header).
create or replace function public.analytics_problem_rows(
  p_host              uuid,
  p_from              date,
  p_to                date,
  p_property_ids      bigint[],
  p_assignee_ids      uuid[],
  p_problem_statuses  public.problem_status[],
  p_priorities        public.problem_priority[],
  p_include_test      boolean,
  p_hide_archived     boolean
)
returns table (
  problem_id        uuid,
  listing_id        bigint,
  urgency           integer,
  status            public.problem_status,
  created_day       date,
  resolved_day      date,
  cancelled_day     date,
  archived_day      date,
  hours_to_resolve  numeric
)
language sql
stable
set search_path = ''
as $$
  select pr.id,
         l.id,
         case pr.priority when 'low' then 1 when 'normal' then 2 when 'high' then 3 end,
         pr.status,
         (pr.created_at at time zone z.zone)::date,
         (pr.resolved_at at time zone z.zone)::date,
         (pr.cancelled_at at time zone z.zone)::date,
         (pr.archived_at at time zone z.zone)::date,
         (extract(epoch from pr.resolved_at - pr.created_at) / 3600.0)::numeric
  from public.problems pr
  left join public.properties p on p.id = pr.property_id
  left join public.properties l
    on l.id = case when p.hostaway_unit_id is not null then p.parent_id else p.id end
  -- The company's zone for a task that names no listing (see the header).
  cross join lateral (select coalesce(p.timezone, 'Europe/Prague') as zone) z
  where pr.host_id = p_host
    and pr.created_at < (p_to + 2)::timestamp at time zone 'UTC'
    -- In the archive, only what was resolved before it was put away.
    and (pr.archived_at is null
         or (pr.status = 'resolved' and pr.resolved_at <= pr.archived_at))
    and (p_include_test or l.id is null or not public.analytics_is_test_listing(l.id))
    and (not coalesce(p_hide_archived, false) or l.id is null or l.status <> 'archived')
    and (p_property_ids is null or l.id = any (p_property_ids))
    and (p_problem_statuses is null or pr.status = any (p_problem_statuses))
    and (p_priorities is null or pr.priority = any (p_priorities))
    and (p_assignee_ids is null
         or exists (select 1 from public.tasks t
                    where t.problem_id = pr.id
                      and t.type = 'maintenance'
                      and coalesce(t.completed_by, t.assignee_id) = any (p_assignee_ids)))
$$;

-- ---------- the key figures ----------

create or replace function public.analytics_summary(
  p_from              date,
  p_to                date,
  p_property_ids      bigint[] default null,
  p_assignee_ids      uuid[] default null,
  p_task_statuses     public.task_status[] default null,
  p_problem_statuses  public.problem_status[] default null,
  p_priorities        public.problem_priority[] default null,
  p_include_test      boolean default false,
  p_hide_archived     boolean default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host       uuid := public.analytics_guard(p_from, p_to);
  v_cleanings  record;
  v_checkouts  record;
  v_occupancy  record;
  v_problems   record;
begin
  select
    count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to) as done,
    count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to
                       and c.type = 'midstay') as done_midstay,
    count(*) filter (where c.scheduled_date between p_from and p_to
                       and (p_task_statuses is not null or c.status <> 'cancelled')) as planned,
    count(*) filter (where c.scheduled_date between p_from and p_to
                       and (p_task_statuses is not null or c.status <> 'cancelled')
                       and c.type = 'midstay') as planned_midstay,
    count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to
                       and c.has_photo) as with_photo,
    percentile_cont(0.5) within group (order by c.minutes)
      filter (where c.status = 'done' and c.done_day between p_from and p_to) as minutes_median,
    avg(c.minutes) filter (where c.status = 'done' and c.done_day between p_from and p_to)
      as minutes_avg
  into v_cleanings
  from public.analytics_cleaning_rows(v_host, p_from, p_to, p_property_ids, p_assignee_ids,
                                      p_task_statuses, p_include_test, p_hide_archived) c;

  select count(*) as checkouts, coalesce(sum(k.rooms), 0) as rooms
  into v_checkouts
  from public.analytics_checkout_rows(v_host, p_from, p_to, p_property_ids, p_include_test, p_hide_archived) k;

  select coalesce(sum(o.occupied_nights), 0) as occupied,
         coalesce(sum(o.available_nights), 0) as available
  into v_occupancy
  from public.analytics_occupancy_rows(v_host, p_from, p_to, p_property_ids, p_include_test) o;

  select
    count(*) filter (where pr.created_day between p_from and p_to) as created,
    count(*) filter (where pr.status = 'resolved' and pr.resolved_day between p_from and p_to)
      as resolved,
    count(*) filter (where pr.created_day <= p_to
                       and not coalesce(pr.resolved_day <= p_to, false)
                       and not coalesce(pr.cancelled_day <= p_to, false)
                       and not coalesce(pr.archived_day <= p_to, false)) as open_end,
    avg(pr.urgency) filter (where pr.created_day between p_from and p_to) as urgency_avg
  into v_problems
  from public.analytics_problem_rows(v_host, p_from, p_to, p_property_ids, p_assignee_ids,
                                     p_problem_statuses, p_priorities, p_include_test, p_hide_archived) pr;

  return jsonb_build_object(
    'cleanings_done', v_cleanings.done,
    'cleanings_done_midstay', v_cleanings.done_midstay,
    'cleanings_planned', v_cleanings.planned,
    'cleanings_planned_midstay', v_cleanings.planned_midstay,
    'cleaning_minutes_median', round(v_cleanings.minutes_median::numeric, 1),
    'cleaning_minutes_avg', round(v_cleanings.minutes_avg, 1),
    'cleanings_with_photo', v_cleanings.with_photo,
    'photo_share', round(v_cleanings.with_photo::numeric / nullif(v_cleanings.done, 0), 4),
    'checkouts', v_checkouts.checkouts,
    'rooms_released', v_checkouts.rooms,
    'occupied_nights', v_occupancy.occupied,
    'available_nights', v_occupancy.available,
    'occupancy', round(v_occupancy.occupied::numeric / nullif(v_occupancy.available, 0), 4),
    'problems_created', v_problems.created,
    'problems_resolved', v_problems.resolved,
    'problems_open', v_problems.open_end,
    'urgency_avg', round(v_problems.urgency_avg, 2)
  );
end;
$$;

comment on function public.analytics_summary(date, date, bigint[], uuid[], public.task_status[],
                                             public.problem_status[], public.problem_priority[],
                                             boolean, boolean) is
  'The key figures of the Analytics page for one period, for the manager '
  '(20261015110000).';

-- ---------- the tables ----------

create or replace function public.analytics_cleanings_by_property(
  p_from              date,
  p_to                date,
  p_property_ids      bigint[] default null,
  p_assignee_ids      uuid[] default null,
  p_task_statuses     public.task_status[] default null,
  p_problem_statuses  public.problem_status[] default null,
  p_priorities        public.problem_priority[] default null,
  p_include_test      boolean default false,
  p_limit             integer default 50,
  p_offset            integer default 0,
  p_hide_archived     boolean default null
)
returns table (
  listing_id      bigint,
  listing_name    text,
  planned         integer,
  done            integer,
  done_midstay    integer,
  expired         integer,
  cancelled       integer,
  minutes_median  numeric,
  minutes_avg     numeric,
  photo_share     numeric,
  total_count     bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_host uuid := public.analytics_guard(p_from, p_to);
begin
  return query
  with g as (
    select c.listing_id,
           count(*) filter (where c.scheduled_date between p_from and p_to
                              and (p_task_statuses is not null or c.status <> 'cancelled'))::integer
             as planned,
           count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to)::integer
             as done,
           count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to
                              and c.type = 'midstay')::integer as done_midstay,
           count(*) filter (where c.status = 'expired'
                              and c.scheduled_date between p_from and p_to)::integer as expired,
           count(*) filter (where c.status = 'cancelled'
                              and c.scheduled_date between p_from and p_to)::integer as cancelled,
           percentile_cont(0.5) within group (order by c.minutes)
             filter (where c.status = 'done' and c.done_day between p_from and p_to) as m_median,
           avg(c.minutes) filter (where c.status = 'done' and c.done_day between p_from and p_to)
             as m_avg,
           count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to
                              and c.has_photo) as with_photo
    from public.analytics_cleaning_rows(v_host, p_from, p_to, p_property_ids, p_assignee_ids,
                                        p_task_statuses, p_include_test, p_hide_archived) c
    group by c.listing_id
  )
  select g.listing_id,
         l.name,
         g.planned,
         g.done,
         g.done_midstay,
         g.expired,
         g.cancelled,
         round(g.m_median::numeric, 1),
         round(g.m_avg, 1),
         round(g.with_photo::numeric / nullif(g.done, 0), 4),
         count(*) over ()
  from g
  join public.properties l on l.id = g.listing_id
  where g.planned > 0 or g.done > 0 or g.expired > 0 or g.cancelled > 0
  order by g.done desc, g.planned desc, l.name, g.listing_id
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.analytics_cleanings_by_cleaner(
  p_from              date,
  p_to                date,
  p_property_ids      bigint[] default null,
  p_assignee_ids      uuid[] default null,
  p_task_statuses     public.task_status[] default null,
  p_problem_statuses  public.problem_status[] default null,
  p_priorities        public.problem_priority[] default null,
  p_include_test      boolean default false,
  p_limit             integer default 50,
  p_offset            integer default 0,
  p_hide_archived     boolean default null
)
returns table (
  person_id       uuid,
  full_name       text,
  done            integer,
  done_midstay    integer,
  planned         integer,
  minutes_median  numeric,
  minutes_avg     numeric,
  photo_share     numeric,
  listings        integer,
  total_count     bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_host uuid := public.analytics_guard(p_from, p_to);
begin
  return query
  with c as (
    select * from public.analytics_cleaning_rows(v_host, p_from, p_to, p_property_ids,
                                                 p_assignee_ids, p_task_statuses, p_include_test, p_hide_archived)
  ),
  -- A done cleaning counts for who finished it; a planned one for who holds it.
  x as (
    select c.completed_by as person_id, 1 as is_done, 0 as is_planned, c.type, c.minutes,
           c.has_photo, c.listing_id
    from c
    where c.status = 'done' and c.done_day between p_from and p_to and c.completed_by is not null
    union all
    select c.assignee_id, 0, 1, c.type, null, false, c.listing_id
    from c
    where c.scheduled_date between p_from and p_to
      and (p_task_statuses is not null or c.status <> 'cancelled')
      and c.assignee_id is not null
  ),
  g as (
    select x.person_id,
           sum(x.is_done)::integer as done,
           sum(x.is_done) filter (where x.type = 'midstay') as done_midstay,
           sum(x.is_planned)::integer as planned,
           percentile_cont(0.5) within group (order by x.minutes) filter (where x.is_done = 1)
             as m_median,
           avg(x.minutes) filter (where x.is_done = 1) as m_avg,
           count(*) filter (where x.is_done = 1 and x.has_photo) as with_photo,
           count(distinct x.listing_id) filter (where x.is_done = 1)::integer as listings
    from x
    group by x.person_id
  )
  select g.person_id,
         pr.full_name,
         g.done,
         coalesce(g.done_midstay, 0)::integer,
         g.planned,
         round(g.m_median::numeric, 1),
         round(g.m_avg, 1),
         round(g.with_photo::numeric / nullif(g.done, 0), 4),
         g.listings,
         count(*) over ()
  from g
  join public.profiles pr on pr.id = g.person_id
  -- Filtered to people, the table shows those people: a cleaning one of them
  -- finished must not bring in the person who held it before.
  where p_assignee_ids is null or g.person_id = any (p_assignee_ids)
  order by g.done desc, g.planned desc, pr.full_name, g.person_id
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.analytics_checkouts_by_property(
  p_from              date,
  p_to                date,
  p_property_ids      bigint[] default null,
  p_assignee_ids      uuid[] default null,
  p_task_statuses     public.task_status[] default null,
  p_problem_statuses  public.problem_status[] default null,
  p_priorities        public.problem_priority[] default null,
  p_include_test      boolean default false,
  p_limit             integer default 50,
  p_offset            integer default 0,
  p_hide_archived     boolean default null
)
returns table (
  listing_id        bigint,
  listing_name      text,
  checkouts         integer,
  rooms_released    integer,
  occupied_nights   integer,
  available_nights  integer,
  occupancy         numeric,
  total_count       bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_host uuid := public.analytics_guard(p_from, p_to);
begin
  return query
  with k as (
    select kr.listing_id, count(*)::integer as checkouts, sum(kr.rooms)::integer as rooms
    from public.analytics_checkout_rows(v_host, p_from, p_to, p_property_ids, p_include_test, p_hide_archived) kr
    group by kr.listing_id
  ),
  o as (
    select * from public.analytics_occupancy_rows(v_host, p_from, p_to, p_property_ids,
                                                  p_include_test)
  ),
  ids as (
    select k.listing_id from k
    union
    select o.listing_id from o
  )
  select ids.listing_id,
         l.name,
         coalesce(k.checkouts, 0),
         coalesce(k.rooms, 0),
         coalesce(o.occupied_nights, 0),
         coalesce(o.available_nights, 0),
         round(o.occupied_nights::numeric / nullif(o.available_nights, 0), 4),
         count(*) over ()
  from ids
  join public.properties l on l.id = ids.listing_id
  left join k on k.listing_id = ids.listing_id
  left join o on o.listing_id = ids.listing_id
  order by coalesce(k.checkouts, 0) desc,
           (o.occupied_nights::numeric / nullif(o.available_nights, 0)) desc nulls last,
           l.name, ids.listing_id
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.analytics_problems_by_property(
  p_from              date,
  p_to                date,
  p_property_ids      bigint[] default null,
  p_assignee_ids      uuid[] default null,
  p_task_statuses     public.task_status[] default null,
  p_problem_statuses  public.problem_status[] default null,
  p_priorities        public.problem_priority[] default null,
  p_include_test      boolean default false,
  p_limit             integer default 50,
  p_offset            integer default 0,
  p_hide_archived     boolean default null
)
returns table (
  listing_id            bigint,
  listing_name          text,
  created               integer,
  resolved              integer,
  open_end              integer,
  urgency_avg           numeric,
  hours_to_resolve_avg  numeric,
  total_count           bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_host uuid := public.analytics_guard(p_from, p_to);
begin
  return query
  with g as (
    select pr.listing_id,
           count(*) filter (where pr.created_day between p_from and p_to)::integer as created,
           count(*) filter (where pr.status = 'resolved'
                              and pr.resolved_day between p_from and p_to)::integer as resolved,
           count(*) filter (where pr.created_day <= p_to
                              and not coalesce(pr.resolved_day <= p_to, false)
                              and not coalesce(pr.cancelled_day <= p_to, false)
                              and not coalesce(pr.archived_day <= p_to, false))::integer as open_end,
           avg(pr.urgency) filter (where pr.created_day between p_from and p_to) as u_avg,
           avg(pr.hours_to_resolve) filter (where pr.status = 'resolved'
                                              and pr.resolved_day between p_from and p_to) as h_avg
    from public.analytics_problem_rows(v_host, p_from, p_to, p_property_ids, p_assignee_ids,
                                       p_problem_statuses, p_priorities, p_include_test, p_hide_archived) pr
    group by pr.listing_id
  )
  select g.listing_id,
         l.name,
         g.created,
         g.resolved,
         g.open_end,
         round(g.u_avg, 2),
         round(g.h_avg, 1),
         count(*) over ()
  from g
  left join public.properties l on l.id = g.listing_id
  where g.created > 0 or g.resolved > 0 or g.open_end > 0
  order by g.open_end desc, g.created desc, l.name nulls last, g.listing_id
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.analytics_problems_by_technician(
  p_from              date,
  p_to                date,
  p_property_ids      bigint[] default null,
  p_assignee_ids      uuid[] default null,
  p_task_statuses     public.task_status[] default null,
  p_problem_statuses  public.problem_status[] default null,
  p_priorities        public.problem_priority[] default null,
  p_include_test      boolean default false,
  p_limit             integer default 50,
  p_offset            integer default 0,
  p_hide_archived     boolean default null
)
returns table (
  person_id             uuid,
  full_name             text,
  repairs_done          integer,
  repairs_open          integer,
  problems_resolved     integer,
  work_minutes_avg      numeric,
  hours_to_resolve_avg  numeric,
  total_count           bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_host uuid := public.analytics_guard(p_from, p_to);
begin
  return query
  with pr as (
    select * from public.analytics_problem_rows(v_host, p_from, p_to, p_property_ids,
                                                p_assignee_ids, p_problem_statuses, p_priorities,
                                                p_include_test, p_hide_archived)
  ),
  rep as (
    select coalesce(t.completed_by, t.assignee_id) as person_id,
           t.status,
           t.problem_id,
           pr.status as problem_status,
           pr.hours_to_resolve,
           (t.completed_at at time zone p.timezone)::date as done_day,
           -- The manager's correction, else a measurement worth trusting:
           -- a repair left open for days is not days of work.
           case
             when t.status <> 'done' then null
             when t.duration_override_min is not null then t.duration_override_min::numeric
             when t.measured_minutes between 5 and 720 then t.measured_minutes::numeric
           end as work_minutes
    from public.tasks t
    join pr on pr.problem_id = t.problem_id
    join public.properties p on p.id = t.property_id
    where t.host_id = v_host
      and t.type = 'maintenance'
      and (p_assignee_ids is null or coalesce(t.completed_by, t.assignee_id) = any (p_assignee_ids))
  ),
  g as (
    select rep.person_id,
           count(*) filter (where rep.status = 'done'
                              and rep.done_day between p_from and p_to)::integer as repairs_done,
           count(*) filter (where rep.status not in ('done', 'cancelled', 'expired'))::integer
             as repairs_open,
           count(distinct rep.problem_id) filter (where rep.status = 'done'
                                                    and rep.done_day between p_from and p_to
                                                    and rep.problem_status = 'resolved')::integer
             as problems_resolved,
           avg(rep.work_minutes) filter (where rep.status = 'done'
                                           and rep.done_day between p_from and p_to) as w_avg,
           avg(rep.hours_to_resolve) filter (where rep.status = 'done'
                                               and rep.done_day between p_from and p_to
                                               and rep.problem_status = 'resolved') as h_avg
    from rep
    where rep.person_id is not null
    group by rep.person_id
  )
  select g.person_id,
         pf.full_name,
         g.repairs_done,
         g.repairs_open,
         g.problems_resolved,
         round(g.w_avg, 1),
         round(g.h_avg, 1),
         count(*) over ()
  from g
  join public.profiles pf on pf.id = g.person_id
  where g.repairs_done > 0 or g.repairs_open > 0
  order by g.repairs_done desc, g.repairs_open desc, pf.full_name, g.person_id
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ---------- who may call what ----------

revoke all on function public.analytics_is_test_listing(bigint) from public, anon, authenticated;
revoke all on function public.analytics_guard(date, date) from public, anon, authenticated;
revoke all on function public.analytics_cleaning_rows(uuid, date, date, bigint[], uuid[],
  public.task_status[], boolean, boolean) from public, anon, authenticated;
revoke all on function public.analytics_checkout_rows(uuid, date, date, bigint[], boolean, boolean)
  from public, anon, authenticated;
revoke all on function public.analytics_occupancy_rows(uuid, date, date, bigint[], boolean)
  from public, anon, authenticated;
revoke all on function public.analytics_problem_rows(uuid, date, date, bigint[], uuid[],
  public.problem_status[], public.problem_priority[], boolean, boolean) from public, anon, authenticated;

revoke all on function public.analytics_summary(date, date, bigint[], uuid[], public.task_status[],
  public.problem_status[], public.problem_priority[], boolean, boolean) from public, anon;
revoke all on function public.analytics_cleanings_by_property(date, date, bigint[], uuid[],
  public.task_status[], public.problem_status[], public.problem_priority[], boolean, integer,
  integer, boolean) from public, anon;
revoke all on function public.analytics_cleanings_by_cleaner(date, date, bigint[], uuid[],
  public.task_status[], public.problem_status[], public.problem_priority[], boolean, integer,
  integer, boolean) from public, anon;
revoke all on function public.analytics_checkouts_by_property(date, date, bigint[], uuid[],
  public.task_status[], public.problem_status[], public.problem_priority[], boolean, integer,
  integer, boolean) from public, anon;
revoke all on function public.analytics_problems_by_property(date, date, bigint[], uuid[],
  public.task_status[], public.problem_status[], public.problem_priority[], boolean, integer,
  integer, boolean) from public, anon;
revoke all on function public.analytics_problems_by_technician(date, date, bigint[], uuid[],
  public.task_status[], public.problem_status[], public.problem_priority[], boolean, integer,
  integer, boolean) from public, anon;

grant execute on function public.analytics_summary(date, date, bigint[], uuid[],
  public.task_status[], public.problem_status[], public.problem_priority[], boolean, boolean)
  to authenticated;
grant execute on function public.analytics_cleanings_by_property(date, date, bigint[], uuid[],
  public.task_status[], public.problem_status[], public.problem_priority[], boolean, integer,
  integer, boolean) to authenticated;
grant execute on function public.analytics_cleanings_by_cleaner(date, date, bigint[], uuid[],
  public.task_status[], public.problem_status[], public.problem_priority[], boolean, integer,
  integer, boolean) to authenticated;
grant execute on function public.analytics_checkouts_by_property(date, date, bigint[], uuid[],
  public.task_status[], public.problem_status[], public.problem_priority[], boolean, integer,
  integer, boolean) to authenticated;
grant execute on function public.analytics_problems_by_property(date, date, bigint[], uuid[],
  public.task_status[], public.problem_status[], public.problem_priority[], boolean, integer,
  integer, boolean) to authenticated;
grant execute on function public.analytics_problems_by_technician(date, date, bigint[], uuid[],
  public.task_status[], public.problem_status[], public.problem_priority[], boolean, integer,
  integer, boolean) to authenticated;
