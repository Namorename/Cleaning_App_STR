-- Two readings of the same reviews can stand side by side (docs/rollout/property-quality-1106.md,
-- «Темы v2»). A new prompt version writes its labels under its own detector and reads every week
-- again, and the old labels stay until the owner's word. The panel's reads counted every label of
-- every version, so each review would have spoken twice.
--
-- history_shown_detector names the one reading the panel counts. Null counts them all, which is
-- what the reads did before. Stream episodes and the themes of staff are no reading: they stay
-- counted whatever is shown.
--
-- A review speaks through its labels instead of its finding only when those labels are shown: a
-- label the panel does not count must not silence the review.

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

create or replace function public.complete_signal_history(
  p_run_id          bigint,
  p_facts           jsonb,
  p_spent_micro_usd bigint,
  p_counts          jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run      raw.signal_history_runs;
  v_inserted integer;
  v_given    integer := coalesce(jsonb_array_length(p_facts), 0);
begin
  select * into v_run from raw.signal_history_runs r where r.id = p_run_id for update;
  if not found or v_run.status <> 'running' then
    raise exception 'History run % is not running', p_run_id
      using errcode = 'invalid_parameter_value';
  end if;

  delete from public.issue_facts f
  where f.host_id = v_run.host_id and f.origin = 'history'
    and f.detector = v_run.detector and f.history_slice = v_run.slice_start;

  insert into public.issue_facts (host_id, property_id, theme, layer, severity, confidence, month,
                                  week, channel, signal_id, origin, history_slice, detector)
  select v_run.host_id,
         public.signal_place_family(p.id),
         x.theme,
         'guest_review',
         coalesce(x.severity, 'normal')::public.problem_priority,
         x.confidence,
         date_trunc('month', x.departure_date::timestamp)::date,
         case when x.departure_date >= current_date - 90
              then date_trunc('week', x.departure_date::timestamp)::date end,
         x.channel::public.signal_channel,
         (select g.id from public.guest_signals g
          where g.host_id = v_run.host_id and g.provider = v_run.provider and g.kind = 'review'
            and g.external_key = x.external_key),
         'history',
         v_run.slice_start,
         v_run.detector
  from jsonb_to_recordset(coalesce(p_facts, '[]'::jsonb)) as x (
    external_listing_id text, external_key text, theme text, severity text,
    confidence numeric, channel text, departure_date date
  )
  join public.issue_themes t on t.code = x.theme
  join lateral (
    select public.resolve_signal_place(v_run.provider, v_run.host_id, x.external_listing_id) as id
  ) p on p.id is not null
  where x.departure_date is not null
    and not public.analytics_is_test_listing(p.id);
  get diagnostics v_inserted = row_count;

  -- A review now labelled stops speaking through its finding at once, not next morning.
  delete from public.issue_facts f
  where f.host_id = v_run.host_id and f.origin = 'stream' and f.layer = 'guest_review'
    and v_run.detector = coalesce((select s.history_shown_detector from public.signal_settings s
                                       where s.host_id = v_run.host_id and s.kind = 'review'), v_run.detector)
    and f.signal_id in (select h.signal_id from public.issue_facts h
                        where h.host_id = v_run.host_id and h.origin = 'history'
                          and h.detector = v_run.detector and h.history_slice = v_run.slice_start
                          and h.signal_id is not null);

  update raw.signal_history_runs r
  set status = 'done',
      spent_micro_usd = greatest(coalesce(p_spent_micro_usd, r.reserved_micro_usd), 0),
      counts = coalesce(p_counts, '{}'::jsonb)
               || jsonb_build_object('labels', v_inserted, 'labels_left_out', v_given - v_inserted),
      finished_at = now()
  where r.id = p_run_id;

  return jsonb_build_object('labels', v_inserted, 'labels_left_out', v_given - v_inserted);
end;
$$;

create or replace function public.refresh_property_quality(p_host_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host     uuid := coalesce(p_host_id, public.default_host_id());
  v_themed   integer;
  v_facts    integer;
  v_staff    integer;
  v_folded   integer;
begin
  insert into public.problem_themes (problem_id, theme, source, detector)
  select x.id, x.theme, x.source, x.detector
  from (
    select pr.id,
           coalesce(public.issue_theme_of_finding(f.kind, f.subject),
                    public.issue_theme_of_text(pr.title || ' ' || coalesce(pr.description, ''))) as theme,
           case when public.issue_theme_of_finding(f.kind, f.subject) is not null
                then 'signal' else 'dict' end as source,
           case when public.issue_theme_of_finding(f.kind, f.subject) is not null
                then f.detector else 'dict-v1' end as detector
    from public.problems pr
    left join public.signal_findings f on f.problem_id = pr.id
    where pr.host_id = v_host
      and not exists (select 1 from public.problem_themes t where t.problem_id = pr.id)
  ) x
  where x.theme is not null
  on conflict (problem_id) do nothing;
  get diagnostics v_themed = row_count;

  delete from public.issue_facts f where f.host_id = v_host and f.origin = 'stream';

  insert into public.issue_facts (host_id, property_id, theme, layer, severity, confidence, month,
                                  week, channel, signal_id, finding_id, origin, detector)
  select v_host,
         public.signal_place_family(f.property_id),
         public.issue_theme_refined(public.issue_theme_of_finding(f.kind, f.subject),
                                    f.summary || ' ' || coalesce(f.summary_i18n ->> 'en', '')),
         'guest_review',
         f.urgency,
         f.confidence,
         date_trunc('month', d.day::timestamp)::date,
         case when g.stay_exact and d.day >= current_date - 90
              then date_trunc('week', d.day::timestamp)::date end,
         g.channel,
         g.id,
         f.id,
         'stream',
         f.detector
  from public.signal_findings f
  join public.guest_signals g on g.id = f.signal_id
  cross join lateral (
    select coalesce(g.departure_date, (g.submitted_at at time zone 'Europe/Prague')::date) as day
  ) d
  where f.host_id = v_host
    and f.property_id is not null
    and g.kind = 'review'
    and f.status not in ('rejected', 'dropped')
    and public.issue_theme_of_finding(f.kind, f.subject) is not null
    -- A review the reading has labelled speaks through its labels: one episode, not two.
    and not exists (select 1 from public.issue_facts h
                    where h.signal_id = f.signal_id and h.origin = 'history'
                      and h.detector = coalesce((select s.history_shown_detector from public.signal_settings s
                                       where s.host_id = v_host and s.kind = 'review'), h.detector));
  get diagnostics v_facts = row_count;

  insert into public.issue_facts (host_id, property_id, theme, layer, severity, month, week,
                                  problem_id, origin, detector)
  select v_host,
         public.signal_place_family(pr.property_id),
         t.theme,
         case when pr.task_id is not null then 'found_at_work' else 'staff_report' end::public.issue_layer,
         pr.priority,
         date_trunc('month', d.day::timestamp)::date,
         case when d.day >= current_date - 90 then date_trunc('week', d.day::timestamp)::date end,
         pr.id,
         'stream',
         t.detector
  from public.problems pr
  join public.problem_themes t on t.problem_id = pr.id
  cross join lateral (select (pr.created_at at time zone 'Europe/Prague')::date as day) d
  where pr.host_id = v_host
    and pr.property_id is not null
    -- What a guest said is the finding's episode; the problem made of it is the answer.
    and pr.source = 'staff'
    and pr.status <> 'cancelled'
    and (pr.archived_at is null or (pr.status = 'resolved' and pr.resolved_at <= pr.archived_at));
  get diagnostics v_staff = row_count;

  update public.issue_facts f set week = null
  where f.host_id = v_host and f.week is not null and f.week < current_date - 90;
  get diagnostics v_folded = row_count;

  return jsonb_build_object('themed', v_themed, 'facts', v_facts + v_staff, 'folded', v_folded,
                            'area_members', public.refresh_quality_areas(v_host));
end;
$$;
