-- The owner's analytics, step 2 (docs/dashboard-metrics.md; owner's decisions
-- of 2026-10-14): the series behind the charts, and the tasks by urgency.
--
-- - analytics_series: the figures of 20261015110000 day by day or week by
--   week (ISO weeks, Mondays), every bucket of the period present, the empty
--   ones as zeros — a chart's axis must not skip a quiet day. The same rules
--   and filters as the summary; it is built on the same row functions, so a
--   series adds up to the summary of its period. At most 400 rows.
--
-- - analytics_summary gains problems_by_priority: the tasks created in the
--   period, low / normal / high — the bar a manager clicks to filter by
--   urgency. The rest of its body is 20261015110000's, unchanged.

create or replace function public.analytics_summary(
  p_from              date,
  p_to                date,
  p_property_ids      bigint[] default null,
  p_assignee_ids      uuid[] default null,
  p_task_statuses     public.task_status[] default null,
  p_problem_statuses  public.problem_status[] default null,
  p_priorities        public.problem_priority[] default null,
  p_include_test      boolean default false
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
                                      p_task_statuses, p_include_test) c;

  select count(*) as checkouts, coalesce(sum(k.rooms), 0) as rooms
  into v_checkouts
  from public.analytics_checkout_rows(v_host, p_from, p_to, p_property_ids, p_include_test) k;

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
                                     p_problem_statuses, p_priorities, p_include_test) pr;

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
    'urgency_avg', round(v_problems.urgency_avg, 2),
    'problems_by_priority', jsonb_build_object(
      'low', v_problems.created_low,
      'normal', v_problems.created_normal,
      'high', v_problems.created_high)
  );
end;
$$;

create or replace function public.analytics_series(
  p_from              date,
  p_to                date,
  p_bucket            text default 'day',
  p_property_ids      bigint[] default null,
  p_assignee_ids      uuid[] default null,
  p_task_statuses     public.task_status[] default null,
  p_problem_statuses  public.problem_status[] default null,
  p_priorities        public.problem_priority[] default null,
  p_include_test      boolean default false
)
returns table (
  bucket             date,
  cleanings_done     integer,
  cleanings_planned  integer,
  checkouts          integer,
  problems_created   integer,
  problems_resolved  integer
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
  if p_bucket is null or p_bucket not in ('day', 'week') then
    raise exception 'An analytics series is by day or by week, not %', p_bucket
      using errcode = 'invalid_parameter_value',
            hint = 'serverErrors.analyticsPeriodInvalid',
            detail = json_build_object('maxDays', 400)::text;
  end if;

  return query
  with days as (
    select d::date as day,
           case when p_bucket = 'week' then date_trunc('week', d)::date else d::date end as bucket
    from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') d
  ),
  c as (
    select * from public.analytics_cleaning_rows(v_host, p_from, p_to, p_property_ids,
                                                 p_assignee_ids, p_task_statuses, p_include_test)
  ),
  done_d as (
    select c.done_day as day, count(*) as n from c where c.status = 'done' group by c.done_day
  ),
  planned_d as (
    select c.scheduled_date as day, count(*) as n
    from c
    where p_task_statuses is not null or c.status <> 'cancelled'
    group by c.scheduled_date
  ),
  checkouts_d as (
    select k.departure_date as day, count(*) as n
    from public.analytics_checkout_rows(v_host, p_from, p_to, p_property_ids, p_include_test) k
    group by k.departure_date
  ),
  pr as (
    select * from public.analytics_problem_rows(v_host, p_from, p_to, p_property_ids,
                                                p_assignee_ids, p_problem_statuses, p_priorities,
                                                p_include_test)
  ),
  created_d as (
    select pr.created_day as day, count(*) as n from pr group by pr.created_day
  ),
  resolved_d as (
    select pr.resolved_day as day, count(*) as n
    from pr where pr.status = 'resolved' group by pr.resolved_day
  )
  select days.bucket,
         coalesce(sum(done_d.n), 0)::integer,
         coalesce(sum(planned_d.n), 0)::integer,
         coalesce(sum(checkouts_d.n), 0)::integer,
         coalesce(sum(created_d.n), 0)::integer,
         coalesce(sum(resolved_d.n), 0)::integer
  from days
  left join done_d on done_d.day = days.day
  left join planned_d on planned_d.day = days.day
  left join checkouts_d on checkouts_d.day = days.day
  left join created_d on created_d.day = days.day
  left join resolved_d on resolved_d.day = days.day
  group by days.bucket
  order by days.bucket;
end;
$$;

comment on function public.analytics_series(date, date, text, bigint[], uuid[], public.task_status[],
                                            public.problem_status[], public.problem_priority[],
                                            boolean) is
  'The figures of the Analytics page day by day or week by week, for the manager '
  '(20261015120000).';

revoke all on function public.analytics_series(date, date, text, bigint[], uuid[],
  public.task_status[], public.problem_status[], public.problem_priority[], boolean)
  from public, anon;
grant execute on function public.analytics_series(date, date, text, bigint[], uuid[],
  public.task_status[], public.problem_status[], public.problem_priority[], boolean)
  to authenticated;
