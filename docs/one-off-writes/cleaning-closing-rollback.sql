-- Takes «who did a cleaning, who closed it» and the workers named afterwards away
-- (20261106125500). A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
-- First the readers, or they lose what they read: the phone's preview back to the OTA before
-- (republish), the panel back to main before the change (revert, Vercel). Then:
--
--   npx supabase db query --linked -f docs/one-off-writes/cleaning-closing-rollback.sql
--   npx supabase migration repair --status reverted 20261106125500 --linked
--
-- One statement: db query takes one. The functions go back to their bodies before the migration,
-- copied from 20261106125000, 20261028100000, 20261015110000 and 20261015120000. task_closings
-- and closing_marks go with what they hold; tasks keep every column they had. The attempts and
-- cleanings closed in somebody's name keep her as tasks.completed_by, as any finish keeps its
-- finisher; the workers named afterwards on tasks (problems.completed_by) stay, without a source.
do $rollback$
begin
  drop trigger if exists tasks_stamp_closing on public.tasks;
  drop function if exists public.stamp_task_closing();

create or replace function public.stamp_problem_closing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was    boolean := old.status in ('resolved', 'cancelled') or old.archived_at is not null;
  v_is     boolean := new.status in ('resolved', 'cancelled') or new.archived_at is not null;
  v_actor  uuid := (select auth.uid());
  v_choice jsonb := nullif(current_setting('str_ops.problem_closing', true), '')::jsonb;
  v_role   public.app_role;
  v_worker uuid;
begin
  if not v_is then
    new.completed_by := null;
    new.closed_by    := null;
    new.closed_how   := null;
    new.closed_cause := null;
    new.closed_at    := null;
    return new;
  end if;
  -- Still closed the same way: a resolved task put in the archive keeps who resolved it.
  if v_was and new.status = old.status then
    return new;
  end if;

  new.closed_at    := now();
  new.closed_cause := null;

  -- A fix closes with its attempt: the mirror resolves the task in the same write, and the
  -- attempt already says who finished it. Only an attempt finished in this transaction: a task
  -- reopened and closed again keeps the attempt of the round before, which did not close it.
  if new.status = 'resolved' then
    select t.completed_by into v_worker
    from public.tasks t
    where t.problem_id = new.id and t.status = 'done' and t.completed_at = now()
    order by t.id desc
    limit 1;
  end if;

  -- resolve_problem with the manager's choice (written for this task, in this transaction).
  if v_choice is not null and v_choice ->> 'problem' = new.id::text then
    new.closed_by    := v_actor;
    new.closed_how   := v_choice ->> 'how';
    new.completed_by := nullif(v_choice ->> 'completed_by', '')::uuid;
    return new;
  end if;

  if v_actor is null then
    new.closed_by    := null;
    new.closed_how   := 'auto';
    new.closed_cause := nullif(current_setting('str_ops.closing_cause', true), '');
    new.completed_by := v_worker;
    return new;
  end if;

  select pr.role into v_role from public.profiles pr where pr.id = v_actor;
  new.closed_by := v_actor;
  if v_role in ('manager', 'admin') then
    new.closed_how := 'manager';
    -- The guard writes the manager as the finisher when nobody is named: that names nobody.
    new.completed_by := case when v_worker is distinct from v_actor then v_worker end;
  else
    new.closed_how   := 'worker';
    new.completed_by := v_worker;
  end if;
  return new;
end;
$$;

create or replace function public.api_task_json(p public.problems, p_scopes text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'title', public.api_mask_codes(p.title),
    'description', public.api_mask_codes(p.description),
    'text_masked', public.api_mask_codes(p.title) is distinct from p.title
                   or public.api_mask_codes(p.description) is distinct from p.description
                   or public.api_mask_codes(p.cancel_reason) is distinct from p.cancel_reason,
    'priority', p.priority,
    'status', p.status,
    'property_id', p.property_id,
    'cleaning_id', p.task_id,
    'reported_by', p.reported_by,
    'archived', p.archived_at is not null,
    'cancel_reason', public.api_mask_codes(p.cancel_reason),
    'work', (select jsonb_build_object(
                      'cleaning_id', w.id,
                      'status', w.status,
                      'assignee_id', w.assignee_id,
                      'scheduled_date', w.scheduled_date,
                      'time_from', public.api_hm(w.time_from),
                      'time_to', public.api_hm(w.time_to))
             from public.tasks w
             where w.problem_id = p.id and w.host_id = p.host_id and w.type = 'maintenance'
             order by w.created_at desc, w.id desc
             limit 1),
    'created_at', public.api_ts(p.created_at),
    'updated_at', public.api_ts(p.updated_at),
    'resolved_at', public.api_ts(p.resolved_at),
    'cancelled_at', public.api_ts(p.cancelled_at),
    'archived_at', public.api_ts(p.archived_at),
    'completed_by', public.api_task_person_json(p.completed_by, p.host_id, p_scopes),
    'closed_by', public.api_task_person_json(p.closed_by, p.host_id, p_scopes),
    'closed_how', p.closed_how,
    'closed_cause', p.closed_cause,
    'closed_at', public.api_ts(p.closed_at))
$$;

create or replace function public.api_cleaning_json(t public.tasks)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'type', t.type,
    'status', t.status,
    'property_id', t.property_id,
    'booking_id', t.reservation_id,
    'task_id', t.problem_id,
    'scheduled_date', t.scheduled_date,
    'time_from', public.api_hm(t.time_from),
    'time_to', public.api_hm(t.time_to),
    'due_at', public.api_ts(t.due_at),
    'priority', t.priority,
    'assignee_id', t.assignee_id,
    'title', public.api_mask_codes(t.title),
    'text_masked', public.api_mask_codes(t.title) is distinct from t.title,
    'guests_count', t.guests_count,
    'is_parallel', t.is_parallel,
    'started_at', public.api_ts(t.started_at),
    'completed_at', public.api_ts(t.completed_at),
    'completed_by', t.completed_by,
    'created_at', public.api_ts(t.created_at),
    'updated_at', public.api_ts(t.updated_at))
$$;

create or replace function public.api_v1_list_cleanings(
  p_digest        text,
  p_date_from     date default null,
  p_date_to       date default null,
  p_property_id   bigint default null,
  p_assignee_id   uuid default null,
  p_status        text[] default null,
  p_type          text[] default null,
  p_updated_since timestamptz default null,
  p_after_date    date default null,
  p_after_id      uuid default null,
  p_limit         integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'cleanings:read');
begin
  return (
    select coalesce(jsonb_agg(public.api_cleaning_json(t) order by t.scheduled_date, t.id), '[]'::jsonb)
    from (select tk.* from public.tasks tk
          where tk.host_id = v_ctx.host_id
            and public.api_allows_property(v_ctx, tk.property_id)
            and (p_date_from is null or tk.scheduled_date >= p_date_from)
            and (p_date_to is null or tk.scheduled_date <= p_date_to)
            and (p_property_id is null or tk.property_id = p_property_id)
            and (p_assignee_id is null or tk.assignee_id = p_assignee_id)
            and (p_status is null or tk.status::text = any(p_status))
            and (p_type is null or tk.type::text = any(p_type))
            and (p_updated_since is null or tk.updated_at >= p_updated_since)
            and (p_after_id is null or (tk.scheduled_date, tk.id) > (p_after_date, p_after_id))
          order by tk.scheduled_date, tk.id
          limit least(greatest(p_limit, 1), 200) + 1) t);
end;
$$;

create or replace function public.api_v1_get_cleaning(p_digest text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'cleanings:read');
  v_row public.tasks;
begin
  select tk.* into v_row from public.tasks tk
  where tk.id = p_id and tk.host_id = v_ctx.host_id and public.api_allows_property(v_ctx, tk.property_id);
  if not found then
    perform public.api_not_found('Cleaning');
  end if;
  return public.api_cleaning_json(v_row);
end;
$$;

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
  v_cancelled  bigint;
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
    avg(pr.urgency) filter (where pr.created_day between p_from and p_to) as urgency_avg,
    count(*) filter (where pr.created_day between p_from and p_to and pr.urgency = 1) as created_low,
    count(*) filter (where pr.created_day between p_from and p_to and pr.urgency = 2) as created_normal,
    count(*) filter (where pr.created_day between p_from and p_to and pr.urgency = 3) as created_high
  into v_problems
  from public.analytics_problem_rows(v_host, p_from, p_to, p_property_ids, p_assignee_ids,
                                     p_problem_statuses, p_priorities, p_include_test, p_hide_archived,
                                     false) pr;

  select count(*) filter (where pr.cancelled_day between p_from and p_to)
  into v_cancelled
  from public.analytics_problem_rows(v_host, p_from, p_to, p_property_ids, p_assignee_ids,
                                     p_problem_statuses, p_priorities, p_include_test, p_hide_archived,
                                     true) pr;

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
    'problems_cancelled', v_cancelled,
    'urgency_avg', round(v_problems.urgency_avg, 2),
    'problems_by_priority', jsonb_build_object(
      'low', v_problems.created_low,
      'normal', v_problems.created_normal,
      'high', v_problems.created_high)
  );
end;
$$;

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

  drop function if exists public.api_cleaning_json(public.tasks, text[]);
  drop function if exists public.api_cleaning_closing_json(public.tasks, text[]);
  drop function if exists public.task_closing(public.tasks);
  drop function if exists public.name_problem_worker(uuid, uuid);
  drop function if exists public.name_cleaning_worker(uuid, uuid);
  drop function if exists public.closing_worker_check(uuid, uuid);
  drop function if exists public.complete_cleaning(uuid, uuid);

  drop table if exists public.closing_marks;
  drop table if exists public.task_closings;

  alter table public.problems
    drop constraint if exists problems_completed_by_source_known,
    drop column if exists completed_by_source;
end;
$rollback$;
