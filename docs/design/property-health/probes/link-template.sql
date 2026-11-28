-- READ ONLY. For each reviewed stay (arrival from 15.10.2026, when cleanings start in the cloud):
-- the cleaning before the guest's arrival on each of the stay's places, and who did it.
-- Inputs are Hostaway review ids, booking ids, listing ids, scores and arrival days — no text.
with g(review_id, res_id, listing, channel, clean, rating, arrival) as (values
/*VALUES*/
),
gr as (
  select g.*, r.property_id as res_prop, r.status as res_status
  from g left join reservations r on r.id = g.res_id
),
places as (
  select gr.review_id, coalesce(u.property_id, gr.res_prop) as place
  from gr left join reservation_units u on u.reservation_id = gr.res_id
  where gr.res_prop is not null
),
cand as (
  select p.review_id, p.place, t.id as task_id, t.status, t.scheduled_date, t.assignee_id,
         coalesce(c.completed_by, t.completed_by) as done_by, t.measured_minutes,
         row_number() over (partition by p.review_id, p.place order by t.scheduled_date desc, t.created_at desc) as rn
  from places p
  join gr on gr.review_id = p.review_id
  join tasks t on t.property_id = p.place and t.type = 'cleaning'
              and t.scheduled_date <= gr.arrival and t.scheduled_date >= gr.arrival - 30
              and t.status <> 'cancelled'
  left join task_closings c on c.task_id = t.id
),
last as (select * from cand where rn = 1),
same_day as (
  select l.review_id, count(*) as n
  from last l join cand c on c.review_id = l.review_id and c.place = l.place and c.scheduled_date = l.scheduled_date
  where c.status = 'done'
  group by 1
),
per_review as (
  select gr.review_id, gr.channel, gr.clean, gr.rating, gr.arrival,
    case
      when gr.res_prop is null then 'no_reservation'
      when not exists (select 1 from last l where l.review_id = gr.review_id) then 'no_cleaning'
      when exists (select 1 from last l where l.review_id = gr.review_id and l.status = 'expired') then 'expired'
      when exists (select 1 from last l where l.review_id = gr.review_id and l.status <> 'done') then 'not_done'
      else 'done'
    end as link,
    (select count(*) from places p where p.review_id = gr.review_id) as n_places,
    (select count(distinct l.done_by) from last l where l.review_id = gr.review_id and l.status = 'done') as people,
    (select bool_or(l.done_by is distinct from l.assignee_id) from last l where l.review_id = gr.review_id and l.status = 'done') as other_hand,
    (select max(gr.arrival - l.scheduled_date) from last l where l.review_id = gr.review_id) as gap_days,
    (select max(n) from same_day s where s.review_id = gr.review_id) as same_day_done,
    (select min(l.done_by::text) from last l where l.review_id = gr.review_id and l.status = 'done') as cleaner
  from gr
),
low as (
  select *, (case when channel = 'airbnb' then clean <= 8 else clean <= 7.5 end) as clean_low,
            (case when channel = 'airbnb' then clean <= 6 else clean <= 5 end) as clean_bad
  from per_review
),
by_cleaner as (
  select cleaner, count(*) as n, count(*) filter (where clean_low) as low, count(*) filter (where clean_bad) as bad
  from low where link = 'done' and people = 1 and cleaner is not null group by 1
)
select json_build_object(
  'reviews', (select count(*) from low),
  'by_link', (select json_object_agg(link, n) from (select link, count(*) as n from low group by 1) x),
  'by_link_channel', (select json_agg(x) from (select link, channel, count(*) as n, count(*) filter (where clean_low) as low from low group by 1, 2 order by 1, 2) x),
  'done_one_person', (select count(*) from low where link = 'done' and people = 1),
  'done_many_people', (select count(*) from low where link = 'done' and people > 1),
  'multi_place', (select count(*) from low where n_places > 1),
  'other_hand', (select count(*) from low where link = 'done' and other_hand),
  'same_day_two', (select count(*) from low where same_day_done > 1),
  'gap_days', (select json_object_agg(gap, n) from (select case when gap_days = 0 then '0' when gap_days = 1 then '1' when gap_days <= 3 then '2-3' when gap_days <= 7 then '4-7' else '8+' end as gap, count(*) as n from low where link in ('done', 'expired', 'not_done') group by 1) x),
  'clean_low_linked', (select count(*) from low where link = 'done' and people = 1 and clean_low),
  'clean_bad_linked', (select count(*) from low where link = 'done' and people = 1 and clean_bad),
  'clean_scored_linked', (select count(*) from low where link = 'done' and people = 1 and clean is not null),
  'cleaners', (select count(*) from by_cleaner),
  'per_cleaner_n', (select json_agg(n order by n desc) from by_cleaner),
  'per_cleaner_low', (select json_agg(json_build_array(n, low, bad) order by n desc) from by_cleaner),
  'arrival_range', (select json_build_array(min(arrival), max(arrival)) from low)
) as result;
