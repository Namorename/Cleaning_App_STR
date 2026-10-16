-- dashboard probe I: checkouts (live bookings by departure_date, generator's rule) against their cleanings, by month
with live as (
  select r.id, r.property_id, r.arrival_date, r.departure_date
  from public.reservations r
  where r.status in ('new', 'modified') and not r.is_block
    and not coalesce(r.guest_name ~ '^[[:space:]]*#', false)
),
c as (
  select t.reservation_id,
         count(*) as n_all,
         count(*) filter (where t.status <> 'cancelled') as n_live,
         count(*) filter (where t.status = 'done') as n_done
  from public.tasks t
  where t.type = 'cleaning' and t.reservation_id is not null
  group by 1
)
select
  to_char(date_trunc('month', l.departure_date), 'YYYY-MM') as month,
  count(*) as checkouts,
  count(distinct l.property_id) as listings,
  count(*) filter (where c.n_all is null) as without_any_cleaning,
  count(*) filter (where coalesce(c.n_live, 0) = 0 and c.n_all is not null) as only_cancelled_cleanings,
  count(*) filter (where c.n_live = 1) as one_live_cleaning,
  count(*) filter (where c.n_live > 1) as several_live_cleanings,
  coalesce(sum(c.n_live), 0) as live_cleanings,
  count(*) filter (where c.n_done > 0) as with_done_cleaning,
  count(*) filter (where exists (select 1 from live n where n.property_id = l.property_id
                                 and n.arrival_date = l.departure_date and n.id <> l.id)) as same_day_turnover,
  max(dead.n) as live_cleanings_of_dead_bookings
from live l
left join c on c.reservation_id = l.id
left join (
  select to_char(date_trunc('month', t.scheduled_date), 'YYYY-MM') as month, count(*) as n
  from public.tasks t
  join public.reservations r on r.id = t.reservation_id
  where t.type = 'cleaning' and t.status <> 'cancelled'
    and not (r.status in ('new', 'modified') and not r.is_block and not coalesce(r.guest_name ~ '^[[:space:]]*#', false))
  group by 1
) dead on dead.month = to_char(date_trunc('month', l.departure_date), 'YYYY-MM')
where l.departure_date >= date '2026-07-01' and l.departure_date < date '2027-02-01'
group by 1
order by 1;
