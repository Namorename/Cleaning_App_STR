-- Two readings of the same reviews can stand side by side (docs/rollout/property-quality-1106.md,
-- «Темы v2»). A new prompt version writes its labels under its own detector and reads every week
-- again, and the old labels stay until the owner's word. The panel's reads counted every label of
-- every version, so each review would have spoken twice.
--
-- history_shown_detector names the one reading the panel counts. Null counts them all, which is
-- what the reads did before. Stream episodes and the themes of staff are no reading: they stay
-- counted whatever is shown.

alter table public.signal_settings
  add column history_shown_detector text
    check (history_shown_detector is null or history_shown_detector ~ '^[a-z0-9.@_-]{3,80}$');

comment on column public.signal_settings.history_shown_detector is
  'The reading of past reviews the panel counts; null counts all of them.';

update public.signal_settings
set history_shown_detector = 'claude-haiku-5-5@themes-v1'
where kind = 'review';

create or replace function public.quality_theme_rows(
  p_host      uuid,
  p_today     date,
  p_grain     text,
  p_from      date,
  p_prev_from date,
  p_prev_to   date,
  p_property  bigint
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with facts as (
    select f.property_id, f.theme, f.layer, f.month,
           coalesce(f.week, f.month) as day,
           case when p_grain = 'week' then f.week >= p_from else f.month >= p_from end as is_cur,
           case when p_grain = 'week' then f.week between p_prev_from and p_prev_to
                else f.month between p_prev_from and p_prev_to end as is_prev
    from public.issue_facts f
    left join public.guest_signals g on g.id = f.signal_id
    where f.host_id = p_host
      and f.layer <> 'guest_message'
      and not coalesce(g.is_hidden, false)
      and not public.analytics_is_test_listing(f.property_id)
      and (p_property is null or f.property_id = p_property)
      and (f.origin <> 'history' or f.detector = coalesce((select s.history_shown_detector from public.signal_settings s
                                       where s.host_id = p_host and s.kind = 'review'), f.detector))
  ),
  said as (
    select x.property_id, x.theme,
           count(*) filter (where x.is_cur and x.layer = 'guest_review') as reviews,
           count(*) filter (where x.is_prev and x.layer = 'guest_review') as reviews_prev,
           count(*) filter (where x.is_cur and x.layer = 'guest_review'
                              and x.month <= public.quality_settled_to(p_today)) as reviews_settled,
           count(*) filter (where x.is_cur and x.layer = 'found_at_work') as found,
           count(*) filter (where x.is_prev and x.layer = 'found_at_work') as found_prev,
           count(*) filter (where x.is_cur and x.layer = 'staff_report') as reported,
           count(*) filter (where x.is_prev and x.layer = 'staff_report') as reported_prev,
           count(*) filter (where x.day >= p_today - 90) as recent,
           count(*) filter (where x.day between p_today - 360 and p_today - 91) as older,
           max(x.day) as last_on
    from facts x
    group by x.property_id, x.theme
  ),
  work as (
    select coalesce(l.parent_id, l.id) as property_id, t.theme,
           count(*) filter (where pr.status not in ('resolved', 'cancelled') and pr.archived_at is null)
             as open_work,
           count(*) filter (where pr.created_at >= p_today - 180) as work_180,
           (max(pr.resolved_at) at time zone 'Europe/Prague')::date as closed_on
    from public.problem_themes t
    join public.problems pr on pr.id = t.problem_id
    join public.properties l on l.id = pr.property_id
    where pr.host_id = p_host
      and pr.status <> 'cancelled'
      and (p_property is null or coalesce(l.parent_id, l.id) = p_property)
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'property_id', s.property_id,
           'theme', s.theme,
           'seasonal', th.is_seasonal,
           'reviews', s.reviews,
           'reviews_prev', s.reviews_prev,
           'reviews_settled', s.reviews_settled,
           'found', s.found,
           'found_prev', s.found_prev,
           'reported', s.reported,
           'reported_prev', s.reported_prev,
           'recent', s.recent,
           'older', s.older,
           'last_on', s.last_on,
           'open_work', coalesce(w.open_work, 0),
           'work_180', coalesce(w.work_180, 0),
           'closed_on', w.closed_on
         ) order by s.property_id, th.sort_order), '[]'::jsonb)
  from said s
  join public.issue_themes th on th.code = s.theme
  left join work w on w.property_id = s.property_id and w.theme = s.theme
$$;

create or replace function public.quality_history_state(p_host uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'enabled', coalesce((select s.history_enabled from public.signal_settings s
                         where s.host_id = p_host and s.kind = 'review'), false),
    -- The weeks closed of the window the last run counted its total on: a window that
    -- moved on since must not make a finished reading look unfinished.
    'weeks_done', (select count(distinct r.slice_start) from raw.signal_history_runs r
                   where r.host_id = p_host and r.part = 'reviews' and r.status = 'done'
                     and r.detector = coalesce((select s.history_shown_detector from public.signal_settings s
                                       where s.host_id = p_host and s.kind = 'review'), r.detector)
                     and r.slice_start >= (
                       select date_trunc('week', date_trunc('month', l.started_at at time zone 'UTC')
                                                 - make_interval(months => s.history_depth_months - 1))::date
                       from public.signal_settings s
                       cross join lateral (
                         select x.started_at from raw.signal_history_runs x
                         where x.host_id = p_host and x.part = 'reviews' and x.counts ? 'weeks_total'
                           and x.detector = coalesce((select s.history_shown_detector from public.signal_settings s
                                       where s.host_id = p_host and s.kind = 'review'), x.detector)
                         order by x.finished_at desc nulls last limit 1
                       ) l
                       where s.host_id = p_host and s.kind = 'review')),
    'weeks_total', (select (r.counts ->> 'weeks_total')::integer from raw.signal_history_runs r
                    where r.host_id = p_host and r.part = 'reviews' and r.counts ? 'weeks_total'
                      and r.detector = coalesce((select s.history_shown_detector from public.signal_settings s
                                       where s.host_id = p_host and s.kind = 'review'), r.detector)
                    order by r.finished_at desc nulls last limit 1),
    'stay_months', (select count(distinct s.month) from public.property_month_stats s
                    where s.host_id = p_host),
    'stays_from', (select min(s.month) from public.property_month_stats s where s.host_id = p_host),
    'last_read_at', (select max(r.finished_at) from raw.signal_history_runs r
                     where r.host_id = p_host and r.part = 'reviews' and r.status = 'done'
                       and r.detector = coalesce((select s.history_shown_detector from public.signal_settings s
                                       where s.host_id = p_host and s.kind = 'review'), r.detector))
  )
$$;

create or replace function public.quality_place(p_property_id bigint, p_window text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host  uuid := public.quality_guard(p_window);
  v_today date := (now() at time zone 'Europe/Prague')::date;
  v_city  text;
  v_peers boolean := (select h.quality_city_groups from public.hosts h
                      where h.id = public.current_host_id());
  v_b     record;
  v_rate  record;
  v_year  date := (date_trunc('month', v_today::timestamp) - interval '11 months')::date;
begin
  select p.city into v_city
  from public.properties p
  where p.id = p_property_id and p.host_id = v_host and p.parent_id is null
    and not public.analytics_is_test_listing(p.id);
  if not found then
    return null;
  end if;

  select * into v_b from public.quality_bounds(p_window, v_today);
  select * into v_rate
  from public.quality_bounds(case when v_b.grain = 'week' then '3m' else p_window end, v_today);

  return public.quality_meta(v_host, p_window, v_today, v_b.grain, v_b.from_day, v_b.prev_from,
                             v_b.prev_to, v_rate.from_day)
    || jsonb_build_object(
         'place', public.quality_place_rows(v_host, v_today, v_b.grain, v_b.from_day, v_b.prev_from,
                                            v_b.prev_to, v_rate.from_day, v_rate.prev_from,
                                            v_rate.prev_to, p_property_id) -> 0,
         'themes', public.quality_theme_rows(v_host, v_today, v_b.grain, v_b.from_day, v_b.prev_from,
                                             v_b.prev_to, p_property_id),
         'months', (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'month', x.month, 'theme', x.theme, 'layer', x.layer, 'n', x.n
                  ) order by x.month, x.theme, x.layer), '[]'::jsonb)
           from (select f.month, f.theme, f.layer, count(*) as n
                 from public.issue_facts f
                 left join public.guest_signals g on g.id = f.signal_id
                 where f.host_id = v_host and f.property_id = p_property_id
                   and f.month >= v_year and f.layer <> 'guest_message'
                   and not coalesce(g.is_hidden, false)
                   and (f.origin <> 'history' or f.detector = coalesce((select s.history_shown_detector from public.signal_settings s
                                       where s.host_id = v_host and s.kind = 'review'), f.detector))
                 group by 1, 2, 3) x),
         'channels', (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'channel', x.channel, 'n', x.n, 'average', x.average
                  ) order by x.n desc), '[]'::jsonb)
           from (select g.channel, count(*) as n, round(avg(g.rating), 2) as average
                 from public.guest_signals g
                 join public.properties l on l.id = g.property_id
                 where g.host_id = v_host and g.kind = 'review' and not g.is_hidden
                   and g.rating is not null and coalesce(l.parent_id, l.id) = p_property_id
                   and coalesce(g.departure_date, (g.submitted_at at time zone 'Europe/Prague')::date)
                       >= v_rate.from_day
                 group by g.channel) x),
         'categories', (
           select coalesce(jsonb_agg(jsonb_build_object(
                    'key', x.key, 'n', x.n, 'average', x.average,
                    'peers_n', x.peers_n, 'peers_average', x.peers_average
                  ) order by x.key), '[]'::jsonb)
           from (select c.key,
                        count(*) filter (where o.id = p_property_id) as n,
                        round(avg(c.value::numeric) filter (where o.id = p_property_id), 2) as average,
                        count(*) filter (where o.id <> p_property_id) as peers_n,
                        round(avg(c.value::numeric) filter (where o.id <> p_property_id), 2) as peers_average
                 from public.guest_signals g
                 join public.properties l on l.id = g.property_id
                 join public.properties o on o.id = coalesce(l.parent_id, l.id)
                 cross join lateral jsonb_each_text(g.category_ratings) c
                 where g.host_id = v_host and g.kind = 'review' and not g.is_hidden
                   and (o.id = p_property_id or not v_peers or o.city is not distinct from v_city)
                   and not public.analytics_is_test_listing(o.id)
                   and coalesce(g.departure_date, (g.submitted_at at time zone 'Europe/Prague')::date)
                       >= v_rate.from_day
                 group by c.key
                 having count(*) filter (where o.id = p_property_id) > 0) x));
end;
$$;
