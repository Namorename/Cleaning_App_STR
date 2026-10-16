-- dashboard probe C: done cleanings - duration (completed_at - started_at) and lateness against the local day
with d as (
  select t.scheduled_date, t.started_at, t.completed_at, t.due_at, t.time_to, t.measured_minutes, t.is_parallel,
         p.timezone,
         extract(epoch from (t.completed_at - t.started_at)) / 60.0 as m,
         (t.completed_at at time zone p.timezone)::date as done_local_day,
         (t.started_at at time zone p.timezone)::date as start_local_day,
         (t.completed_at at time zone p.timezone)::time as done_local_time
  from public.tasks t
  join public.properties p on p.id = t.property_id
  where t.type = 'cleaning' and t.status = 'done' and t.property_id <> 900000000001
)
select
  count(*) as done,
  count(*) filter (where started_at is not null and completed_at is not null) as with_both,
  percentile_cont(array[0.1, 0.25, 0.5, 0.75, 0.9]) within group (order by m) as minutes_p10_25_50_75_90,
  round(avg(m)::numeric, 1) as minutes_avg,
  count(*) filter (where m < 5) as under_5_min,
  count(*) filter (where m >= 5 and m < 20) as from_5_to_20_min,
  count(*) filter (where m > 300) as over_5_h,
  count(*) filter (where m < 0) as negative,
  count(measured_minutes) as with_measured,
  percentile_cont(array[0.1, 0.5, 0.9]) within group (order by measured_minutes) as measured_p10_50_90,
  count(*) filter (where done_local_day = scheduled_date) as done_same_local_day,
  count(*) filter (where done_local_day > scheduled_date) as done_later_day,
  count(*) filter (where done_local_day < scheduled_date) as done_earlier_day,
  count(*) filter (where start_local_day <> done_local_day) as start_and_done_differ_day,
  count(due_at) as with_due,
  count(*) filter (where due_at is not null and completed_at > due_at) as done_after_due,
  count(time_to) as with_time_to,
  count(*) filter (where time_to is not null and done_local_day = scheduled_date and done_local_time > time_to) as done_after_time_to,
  count(*) filter (where is_parallel) as parallel,
  (select json_object_agg(timezone, n) from (select timezone, count(*) as n from d group by 1) z) as by_timezone
from d;
