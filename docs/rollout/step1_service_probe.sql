-- Before the step 1 push (docs/ROADMAP.md, «Минимум запуска», item 1): what the "#" rule of
-- 20260926102000_generator_service_bookings.sql does to live data, and which bookings look like
-- the office's own work but carry no "#". Read-only, one statement:
--
--   node scripts/cloud-read.mjs docs/rollout/step1_service_probe.sql
--
-- Run it on the day of the push, right before "пушим": the numbers move with every booking.
--
-- No guest name leaves the database. A name is only matched; a match comes back as a category,
-- a booking as its Hostaway id, listing and dates.
--
-- The rule is spelled here with chr(160) for the no-break space; the migration spells the same
-- character as a regex escape (backslash, u00a0) inside the bracket. Before the push the function
-- does not exist in the cloud, so the probe cannot call it.
--
-- Labels:
--   selftest       every value true: the rule and the word patterns read Cyrillic and Czech under
--                  the cloud's locale (en_US.UTF-8, libc on 2026-09-26).
--   hash_bookings  live bookings (new/modified, not a block) under the rule, by departure: inside
--                  the nightly window (today-7 .. today+90, sync-reservations at 03:15 UTC) or not.
--   hash_open      their open cleanings (unassigned/assigned): what the first generator run whose
--                  range covers them cancels -- the nightly sync covers the whole window, a webhook
--                  batch its own range, sooner. `assigned` means someone already holds it.
--   hash_kept      their cleanings in any other status: the rule leaves those alone.
--   hash_list      each booking under the rule: id, listing, dates, its cleanings by status.
--   turnover_lost  open cleanings marked same-day turnover whose only live arrival that day is a
--                  "#" booking: the rule takes the priority and the deadline away (the same room
--                  narrowing as reservation_cleaning_window).
--   lookalikes     live bookings departing today or later, not blocks, not under the rule, whose
--                  name holds an office-work word: category, id, listing, dates, channel, price,
--                  open cleanings. A candidate list for the owner to rename in Hostaway, not a
--                  verdict -- a surname can match.
--   zero_price     the same bookings with no word match but a total price of 0 or none.
--   no_name        the same bookings with no name at all -- ordinary bookings for the rule.
with
  cfg as (
    select current_date as today,
           current_date - 7 as win_from,
           current_date + 90 as win_to,
           '^[[:space:]' || chr(160) || ']*#' as hash_rule
  ),
  live as (
    select r.id, r.property_id, r.arrival_date, r.departure_date, r.channel_id, r.total_price,
           r.guest_name, r.guest_name ~ cfg.hash_rule as is_hash
      from public.reservations r, cfg
     where r.status in ('new', 'modified')
       and not r.is_block
  ),
  hash as (
    select l.*, l.departure_date between cfg.win_from and cfg.win_to as in_window
      from live l, cfg
     where l.is_hash
  ),
  hash_tasks as (
    select t.id, t.status::text as status, t.scheduled_date, h.in_window, h.id as reservation_id
      from public.tasks t
      join hash h on h.id = t.reservation_id
     where t.type = 'cleaning'
  ),
  turnover as (
    select t.id
      from public.tasks t
      join public.reservations r on r.id = t.reservation_id
     where t.type = 'cleaning'
       and t.status in ('unassigned', 'assigned')
       and t.priority = 1
       and exists (
             select 1 from live n
              where n.property_id = r.property_id and n.arrival_date = r.departure_date
                and n.id <> r.id and n.is_hash
                and (t.property_id = r.property_id
                     or exists (select 1 from public.reservation_units nu
                                 where nu.reservation_id = n.id and nu.property_id = t.property_id)))
       and not exists (
             select 1 from live n
              where n.property_id = r.property_id and n.arrival_date = r.departure_date
                and n.id <> r.id and not n.is_hash
                and (t.property_id = r.property_id
                     or exists (select 1 from public.reservation_units nu
                                 where nu.reservation_id = n.id and nu.property_id = t.property_id)))
  ),
  ahead as (
    select l.*,
           case
             when l.guest_name ~* '\m(ремонт|remont|repair|oprav|renovat|rekonstruk|покраск|paint|malování|malovani)'
               then 'repair'
             when l.guest_name ~* '\m(бойлер|котел|котёл|boiler|bojler|kotel)'
               then 'boiler'
             when l.guest_name ~* '\m(сантехн|электрик|мастер|plumb|instalat|elektrik|electric|technik|technic|handyman)'
               then 'tradesman'
             when l.guest_name ~* '\m(обслуживан|служеб|maintenan|údržb|udrzb|servis|service)'
               then 'maintenance'
             when l.guest_name ~* '\m(блок(\M|ир)|blo(c)?k(\M|ed\M|ace|ován|ovan|ing\M))'
               then 'block'
             when l.guest_name ~* '\m(владел|собственн|хозя|owner|majitel|vlastn|wagner ?stays)'
               then 'owner'
             when l.guest_name ~* '\m(уборк|clean|úklid|uklid)'
               then 'cleaning'
             when l.guest_name ~* '\m(провер|осмотр|inspect|kontrol|reviz)'
               then 'inspection'
             when l.guest_name ~* '\m(staff|office|internal|intern[ií])\M|\m(kancel|zaměstnan|zamestnan|сотрудн|персонал)'
               then 'staff'
             when l.guest_name ~* '\m(тест|test|hold|stop|closed)\M|\m(zavřen|zavren|nepronaj|nedostupn|закрыт)'
               then 'test/closed'
             when l.guest_name ~* '\m(photo|foto)'
               then 'photo'
           end as category
      from live l, cfg
     where l.departure_date >= cfg.today
       and not l.is_hash
  ),
  open_by_res as (
    select t.reservation_id, count(*) as open_cleanings
      from public.tasks t
     where t.type = 'cleaning' and t.status in ('unassigned', 'assigned')
     group by t.reservation_id
  )
select label, payload from (
  select 1 as ord, 'selftest' as label,
         jsonb_build_object(
           'rule_nbsp',     (chr(160) || '#Boiler') ~ (select hash_rule from cfg),
           'rule_spaces',   '  #x' ~ (select hash_rule from cfg),
           'rule_inside',   not ('Guest #2' ~ (select hash_rule from cfg)),
           'rule_fullwidth_not', not (chr(65283) || 'x' ~ (select hash_rule from cfg)),
           'cyrillic_word', 'Бойлер - РЕМОНТ' ~* '\mремонт',
           'czech_word',    'Velká ÚDRŽBA' ~* '\múdržb',
           'no_mid_word',   not ('Blokhin' ~* '\mblo(c)?k(\M|ed\M|ace|ován|ovan|ing\M)'),
           'surname_guard', not ('Stafford' ~* '\m(staff|office)\M')) as payload
  union all
  select 2, 'hash_bookings',
         (select jsonb_build_object('in_window', count(*) filter (where in_window),
                                    'beyond', count(*) filter (where not in_window))
            from hash)
  union all
  select 3, 'hash_open',
         (select jsonb_build_object(
                   'in_window', count(*) filter (where in_window),
                   'beyond', count(*) filter (where not in_window),
                   'assigned', count(*) filter (where status = 'assigned'))
            from hash_tasks where status in ('unassigned', 'assigned'))
  union all
  select 4, 'hash_kept',
         (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
            from (select status, count(*) as n from hash_tasks
                   where status not in ('unassigned', 'assigned') group by status) s)
  union all
  select 5, 'hash_list',
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', h.id, 'listing', p.name, 'arrival', h.arrival_date,
                   'departure', h.departure_date, 'in_window', h.in_window,
                   'cleanings', (select jsonb_object_agg(s.status, s.n)
                                   from (select status, count(*) as n from hash_tasks ht
                                          where ht.reservation_id = h.id group by status) s))
                   order by h.departure_date, h.id), '[]'::jsonb)
            from hash h join public.properties p on p.id = h.property_id)
  union all
  select 6, 'turnover_lost', to_jsonb((select count(*) from turnover))
  union all
  select 7, 'lookalikes',
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'category', a.category, 'id', a.id, 'listing', p.name,
                   'arrival', a.arrival_date, 'departure', a.departure_date,
                   'channel', a.channel_id, 'price', a.total_price,
                   'open_cleanings', coalesce(o.open_cleanings, 0))
                   order by a.arrival_date, a.id), '[]'::jsonb)
            from ahead a
            join public.properties p on p.id = a.property_id
            left join open_by_res o on o.reservation_id = a.id
           where a.category is not null)
  union all
  select 8, 'zero_price',
         (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', a.id, 'listing', p.name, 'arrival', a.arrival_date,
                   'departure', a.departure_date, 'channel', a.channel_id,
                   'open_cleanings', coalesce(o.open_cleanings, 0))
                   order by a.arrival_date, a.id), '[]'::jsonb)
            from ahead a
            join public.properties p on p.id = a.property_id
            left join open_by_res o on o.reservation_id = a.id
           where a.category is null and a.guest_name is not null
             and coalesce(a.total_price, 0) = 0)
  union all
  select 9, 'no_name',
         (select jsonb_build_object('count', count(*),
                                    'ids', coalesce(jsonb_agg(a.id order by a.arrival_date), '[]'::jsonb))
            from ahead a where nullif(btrim(a.guest_name), '') is null)
) t order by ord
