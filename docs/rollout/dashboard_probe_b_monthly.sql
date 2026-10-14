-- dashboard probe B: cleanings per month of scheduled_date (demo excluded) - outcome mix and booking link
select
  to_char(date_trunc('month', scheduled_date), 'YYYY-MM') as month,
  count(*) as n,
  count(*) filter (where status = 'done') as done,
  count(*) filter (where status = 'cancelled') as cancelled,
  count(*) filter (where status = 'expired') as expired,
  count(*) filter (where status not in ('done','cancelled','expired')) as open,
  count(*) filter (where assignee_id is not null) as assigned,
  count(reservation_id) as with_booking,
  count(*) filter (where created_by is not null) as by_person,
  count(distinct assignee_id) filter (where status = 'done') as cleaners_done,
  count(distinct property_id) as properties,
  min(created_at)::date as first_created
from public.tasks
where type = 'cleaning' and property_id <> 900000000001
group by 1
order by 1;
