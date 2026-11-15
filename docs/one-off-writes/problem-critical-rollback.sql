-- Rollback of 20261115090000_problem_critical, the level above high (docs/problem-categories.md
-- §3). A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
-- Order, when the level is live:
--   0. the code that reads the level goes back first, the phones, the panel and the API alike:
--      republish the OTA groups before the ones that read critical (preview №19
--      93191573-a27e-4505-b075-7fb2e15daaa1, field №12 1c5c6ce9-e1fe-447a-8390-36cdc657c4ea);
--      `git revert` the branch's commits in main and wait for Vercel READY; deploy api and mcp
--      from b25ba5b. A build or a panel that selects problems.critical answers 42703 once the
--      column is gone, and one that sends p_levels or p_critical PGRST202; the older code
--      runs on the newer schema unchanged, so this order has no gap.
--   1. the catalogue goes first (docs/one-off-writes/problem-categories-rollback.sql and its
--      own order): its writers read problems.critical. This file refuses while it is there.
--   2. this file, one statement:
--        npx supabase db query --linked -f docs/one-off-writes/problem-critical-rollback.sql
--      It first makes every critical task high — what it already reads to an older reader —
--      and only then takes the level away: the writers of 20260908130000, the analytics and
--      the API as they were (word for word: their md5 return to the probe's «before»), the
--      trigger, the check and the column.
--   3. the history: npx supabase migration repair --status reverted 20261115090000 --linked
--   4. the file out of the catalogue (step 0 did it).
--   5. the probe: node scripts/cloud-read.mjs docs/rollout/probe_problem_critical.sql —
--      report_problem(6) e784ff29…, update_problem(4) ccb9c738…, the analytics and the API
--      as in docs/rollout/wagner-problem-catalog-1114.md «до», no column, no trigger.
--
-- Like the migration it takes ACCESS EXCLUSIVE on problems for a moment: no long
-- transaction in pg_stat_activity.
do $$
begin
  perform set_config('lock_timeout', '3s', true);

  if to_regclass('public.problem_categories') is not null then
    raise exception 'Roll the catalogue back first (problem-categories-rollback.sql): its writers read problems.critical';
  end if;

  -- 1. Every critical task becomes high, as it already reads. Its updated_at moves
  --    (problems_touch): an API client reading by updated_since reads it once more.
  update public.problems set critical = false where critical;

  -- 2. The writers of before.
  drop function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, boolean);
  drop function public.update_problem(uuid, text, text, public.problem_priority, boolean);

  -- The bodies of 20260908130000, word for word.
  create function public.report_problem(
  p_id          uuid,
  p_title       text,
  p_description text default null,
  p_priority    public.problem_priority default 'normal',
  p_property_id bigint default null,
  p_task_id     uuid default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_problem  public.problems;
  v_property bigint;
begin
  select p.* into v_problem
  from public.problems p
  where p.id = p_id and p.host_id = public.current_host_id();
  if found then
    if v_problem.reported_by is distinct from (select auth.uid()) then
      raise exception 'Problem not found'
        using errcode = 'check_violation', hint = 'serverErrors.problemNotFound';
    end if;
    return v_problem;
  end if;

  perform public.validate_problem_text(p_title, p_description);
  v_property := public.resolve_report_property(p_property_id, p_task_id);

  insert into public.problems (
    id, host_id, property_id, task_id, reported_by, title, description, priority
  ) values (
    p_id, public.current_host_id(), v_property, p_task_id, (select auth.uid()),
    btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), coalesce(p_priority, 'normal')
  )
  returning * into v_problem;

  return v_problem;
end;
$fn$;

  create function public.update_problem(
  p_id          uuid,
  p_title       text,
  p_description text default null,
  p_priority    public.problem_priority default 'normal'
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_problem public.problems;
begin
  select p.* into v_problem
  from public.problems p
  where p.id = p_id
    and p.host_id = public.current_host_id()
    and p.reported_by = (select auth.uid())
  for update;
  if not found then
    raise exception 'Problem not found'
      using errcode = 'check_violation', hint = 'serverErrors.problemNotFound';
  end if;
  if v_problem.status <> 'open' then
    raise exception 'Problem is % and can no longer be edited by its reporter', v_problem.status
      using errcode = 'check_violation', hint = 'serverErrors.problemNotOpen';
  end if;

  perform public.validate_problem_text(p_title, p_description);

  update public.problems p
  set title       = btrim(p_title),
      description = nullif(btrim(coalesce(p_description, '')), ''),
      priority    = coalesce(p_priority, 'normal')
  where p.id = p_id
  returning * into v_problem;

  return v_problem;
end;
$fn$;

  revoke all on function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid)
    from public, anon;
  revoke all on function public.update_problem(uuid, text, text, public.problem_priority) from public, anon;
  grant execute on function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid)
    to authenticated, service_role;
  grant execute on function public.update_problem(uuid, text, text, public.problem_priority)
    to authenticated, service_role;

  -- 3. The analytics and the API as they were (pg_get_functiondef of the cloud's bodies).
drop function public.analytics_problem_rows(p_host uuid, p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_hide_archived boolean, p_cancelled boolean, p_levels text[]);

CREATE OR REPLACE FUNCTION public.analytics_problem_rows(p_host uuid, p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_hide_archived boolean, p_cancelled boolean)
 RETURNS TABLE(problem_id uuid, listing_id bigint, urgency integer, status problem_status, created_day date, resolved_day date, cancelled_day date, archived_day date, hours_to_resolve numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
    -- In the archive, only what was resolved before it was put away — so a
    -- cancelled one comes only from outside it, and only when asked for.
    and (pr.archived_at is null
         or (pr.status = 'resolved' and pr.resolved_at <= pr.archived_at))
    and (pr.status = 'cancelled') = p_cancelled
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
$function$
;

revoke all on function public.analytics_problem_rows(p_host uuid, p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_hide_archived boolean, p_cancelled boolean) from public, anon, authenticated, service_role;
grant execute on function public.analytics_problem_rows(p_host uuid, p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_hide_archived boolean, p_cancelled boolean) to service_role;

drop function public.analytics_summary(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_hide_archived boolean, p_levels text[]);

CREATE OR REPLACE FUNCTION public.analytics_summary(p_from date, p_to date, p_property_ids bigint[] DEFAULT NULL::bigint[], p_assignee_ids uuid[] DEFAULT NULL::uuid[], p_task_statuses task_status[] DEFAULT NULL::task_status[], p_problem_statuses problem_status[] DEFAULT NULL::problem_status[], p_priorities problem_priority[] DEFAULT NULL::problem_priority[], p_include_test boolean DEFAULT false, p_hide_archived boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    -- The cleanings whose photos count: not those a manager closed (20261106125500).
    count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to
                       and c.has_photo is not null) as done_photo,
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
    'photo_share', round(v_cleanings.with_photo::numeric / nullif(v_cleanings.done_photo, 0), 4),
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
$function$
;

comment on function public.analytics_summary(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_hide_archived boolean) is 'The key figures of the Analytics page for one period, for the manager (20261015110000).';
revoke all on function public.analytics_summary(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_hide_archived boolean) from public, anon, authenticated, service_role;
grant execute on function public.analytics_summary(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_hide_archived boolean) to authenticated, service_role;

drop function public.analytics_series(p_from date, p_to date, p_bucket text, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_hide_archived boolean, p_levels text[]);

CREATE OR REPLACE FUNCTION public.analytics_series(p_from date, p_to date, p_bucket text DEFAULT 'day'::text, p_property_ids bigint[] DEFAULT NULL::bigint[], p_assignee_ids uuid[] DEFAULT NULL::uuid[], p_task_statuses task_status[] DEFAULT NULL::task_status[], p_problem_statuses problem_status[] DEFAULT NULL::problem_status[], p_priorities problem_priority[] DEFAULT NULL::problem_priority[], p_include_test boolean DEFAULT false, p_hide_archived boolean DEFAULT NULL::boolean)
 RETURNS TABLE(bucket date, cleanings_done integer, cleanings_planned integer, checkouts integer, problems_created integer, problems_resolved integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                                                 p_assignee_ids, p_task_statuses, p_include_test, p_hide_archived)
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
    from public.analytics_checkout_rows(v_host, p_from, p_to, p_property_ids, p_include_test, p_hide_archived) k
    group by k.departure_date
  ),
  pr as (
    select * from public.analytics_problem_rows(v_host, p_from, p_to, p_property_ids,
                                                p_assignee_ids, p_problem_statuses, p_priorities,
                                                p_include_test, p_hide_archived, false)
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
$function$
;

comment on function public.analytics_series(p_from date, p_to date, p_bucket text, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_hide_archived boolean) is 'The figures of the Analytics page day by day or week by week, for the manager (20261015120000).';
revoke all on function public.analytics_series(p_from date, p_to date, p_bucket text, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_hide_archived boolean) from public, anon, authenticated, service_role;
grant execute on function public.analytics_series(p_from date, p_to date, p_bucket text, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_hide_archived boolean) to authenticated, service_role;

drop function public.analytics_cleanings_by_property(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean, p_levels text[]);

CREATE OR REPLACE FUNCTION public.analytics_cleanings_by_property(p_from date, p_to date, p_property_ids bigint[] DEFAULT NULL::bigint[], p_assignee_ids uuid[] DEFAULT NULL::uuid[], p_task_statuses task_status[] DEFAULT NULL::task_status[], p_problem_statuses problem_status[] DEFAULT NULL::problem_status[], p_priorities problem_priority[] DEFAULT NULL::problem_priority[], p_include_test boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_hide_archived boolean DEFAULT NULL::boolean)
 RETURNS TABLE(listing_id bigint, listing_name text, planned integer, done integer, done_midstay integer, expired integer, cancelled integer, minutes_median numeric, minutes_avg numeric, photo_share numeric, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                              and c.has_photo) as with_photo,
           -- The cleanings whose photos count: not those a manager closed (20261106125500).
           count(*) filter (where c.status = 'done' and c.done_day between p_from and p_to
                              and c.has_photo is not null) as done_photo
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
         round(g.with_photo::numeric / nullif(g.done_photo, 0), 4),
         count(*) over ()
  from g
  join public.properties l on l.id = g.listing_id
  where g.planned > 0 or g.done > 0 or g.expired > 0 or g.cancelled > 0
  order by g.done desc, g.planned desc, l.name, g.listing_id
  limit least(greatest(coalesce(p_limit, 50), 1), 500)
  offset greatest(coalesce(p_offset, 0), 0);
end;
$function$
;

revoke all on function public.analytics_cleanings_by_property(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean) from public, anon, authenticated, service_role;
grant execute on function public.analytics_cleanings_by_property(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean) to authenticated, service_role;

drop function public.analytics_cleanings_by_cleaner(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean, p_levels text[]);

CREATE OR REPLACE FUNCTION public.analytics_cleanings_by_cleaner(p_from date, p_to date, p_property_ids bigint[] DEFAULT NULL::bigint[], p_assignee_ids uuid[] DEFAULT NULL::uuid[], p_task_statuses task_status[] DEFAULT NULL::task_status[], p_problem_statuses problem_status[] DEFAULT NULL::problem_status[], p_priorities problem_priority[] DEFAULT NULL::problem_priority[], p_include_test boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_hide_archived boolean DEFAULT NULL::boolean)
 RETURNS TABLE(person_id uuid, full_name text, done integer, done_midstay integer, planned integer, minutes_median numeric, minutes_avg numeric, photo_share numeric, listings integer, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
           -- The cleanings whose photos count: not those a manager closed (20261106125500).
           count(*) filter (where x.is_done = 1 and x.has_photo is not null) as done_photo,
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
         round(g.with_photo::numeric / nullif(g.done_photo, 0), 4),
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
$function$
;

revoke all on function public.analytics_cleanings_by_cleaner(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean) from public, anon, authenticated, service_role;
grant execute on function public.analytics_cleanings_by_cleaner(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean) to authenticated, service_role;

drop function public.analytics_checkouts_by_property(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean, p_levels text[]);

CREATE OR REPLACE FUNCTION public.analytics_checkouts_by_property(p_from date, p_to date, p_property_ids bigint[] DEFAULT NULL::bigint[], p_assignee_ids uuid[] DEFAULT NULL::uuid[], p_task_statuses task_status[] DEFAULT NULL::task_status[], p_problem_statuses problem_status[] DEFAULT NULL::problem_status[], p_priorities problem_priority[] DEFAULT NULL::problem_priority[], p_include_test boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_hide_archived boolean DEFAULT NULL::boolean)
 RETURNS TABLE(listing_id bigint, listing_name text, checkouts integer, rooms_released integer, occupied_nights integer, available_nights integer, occupancy numeric, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

revoke all on function public.analytics_checkouts_by_property(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean) from public, anon, authenticated, service_role;
grant execute on function public.analytics_checkouts_by_property(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean) to authenticated, service_role;

drop function public.analytics_problems_by_property(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean, p_levels text[]);

CREATE OR REPLACE FUNCTION public.analytics_problems_by_property(p_from date, p_to date, p_property_ids bigint[] DEFAULT NULL::bigint[], p_assignee_ids uuid[] DEFAULT NULL::uuid[], p_task_statuses task_status[] DEFAULT NULL::task_status[], p_problem_statuses problem_status[] DEFAULT NULL::problem_status[], p_priorities problem_priority[] DEFAULT NULL::problem_priority[], p_include_test boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_hide_archived boolean DEFAULT NULL::boolean)
 RETURNS TABLE(listing_id bigint, listing_name text, created integer, resolved integer, open_end integer, urgency_avg numeric, hours_to_resolve_avg numeric, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
                                       p_problem_statuses, p_priorities, p_include_test, p_hide_archived,
                                       false) pr
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
$function$
;

revoke all on function public.analytics_problems_by_property(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean) from public, anon, authenticated, service_role;
grant execute on function public.analytics_problems_by_property(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean) to authenticated, service_role;

drop function public.analytics_problems_by_technician(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean, p_levels text[]);

CREATE OR REPLACE FUNCTION public.analytics_problems_by_technician(p_from date, p_to date, p_property_ids bigint[] DEFAULT NULL::bigint[], p_assignee_ids uuid[] DEFAULT NULL::uuid[], p_task_statuses task_status[] DEFAULT NULL::task_status[], p_problem_statuses problem_status[] DEFAULT NULL::problem_status[], p_priorities problem_priority[] DEFAULT NULL::problem_priority[], p_include_test boolean DEFAULT false, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0, p_hide_archived boolean DEFAULT NULL::boolean)
 RETURNS TABLE(person_id uuid, full_name text, repairs_done integer, repairs_open integer, problems_resolved integer, work_minutes_avg numeric, hours_to_resolve_avg numeric, total_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
declare
  v_host uuid := public.analytics_guard(p_from, p_to);
begin
  return query
  -- The tasks up to today, not to the end of the period: repairs_open is the
  -- work open now (owner, 2026-10-15), and a task reported after the period
  -- may hold some. The other figures count repairs done in the period, which
  -- only a task made by then can have.
  with pr as (
    select * from public.analytics_problem_rows(v_host, p_from, greatest(p_to, current_date),
                                                p_property_ids, p_assignee_ids, p_problem_statuses,
                                                p_priorities, p_include_test, p_hide_archived, false)
  ),
  rep as (
    -- A repair a manager closed in the panel (20261106125000): the person named keeps it in
    -- the counts, but its times are the click's, not the work's; closed «alone», it is nobody's.
    select case when m.by_office and pb.closed_how = 'manager_self' then null
                else coalesce(t.completed_by, t.assignee_id) end as person_id,
           t.status,
           t.problem_id,
           pr.status as problem_status,
           case when m.by_office then null else pr.hours_to_resolve end as hours_to_resolve,
           (t.completed_at at time zone p.timezone)::date as done_day,
           -- The manager's correction, else a measurement worth trusting:
           -- a repair left open for days is not days of work.
           case
             when t.status <> 'done' or m.by_office then null
             when t.duration_override_min is not null then t.duration_override_min::numeric
             when t.measured_minutes between 5 and 720 then t.measured_minutes::numeric
           end as work_minutes
    from public.tasks t
    join pr on pr.problem_id = t.problem_id
    join public.properties p on p.id = t.property_id
    join public.problems pb on pb.id = t.problem_id
    cross join lateral (select t.status = 'done'
                               and pb.closed_how in ('manager_for', 'manager_self')
                               and t.completed_at >= pb.closed_at as by_office) m
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
$function$
;

revoke all on function public.analytics_problems_by_technician(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean) from public, anon, authenticated, service_role;
grant execute on function public.analytics_problems_by_technician(p_from date, p_to date, p_property_ids bigint[], p_assignee_ids uuid[], p_task_statuses task_status[], p_problem_statuses problem_status[], p_priorities problem_priority[], p_include_test boolean, p_limit integer, p_offset integer, p_hide_archived boolean) to authenticated, service_role;

CREATE OR REPLACE FUNCTION public.api_task_json(p problems, p_scopes text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
    'completed_by_source', p.completed_by_source,
    'closed_by', public.api_task_person_json(p.closed_by, p.host_id, p_scopes),
    'closed_how', p.closed_how,
    'closed_cause', p.closed_cause,
    'closed_at', public.api_ts(p.closed_at),
    'source', p.source,
    'guest_stay', public.api_task_guest_stay(p))
$function$
;

CREATE OR REPLACE FUNCTION public.api_v1_list_tasks(p_digest text, p_status text[] DEFAULT NULL::text[], p_priority text[] DEFAULT NULL::text[], p_property_id bigint DEFAULT NULL::bigint, p_assignee_id uuid DEFAULT NULL::uuid, p_created_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_created_to timestamp with time zone DEFAULT NULL::timestamp with time zone, p_include_archived boolean DEFAULT false, p_updated_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_created timestamp with time zone DEFAULT NULL::timestamp with time zone, p_after_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ctx public.api_context := public.api_authorize(p_digest, 'tasks:read');
begin
  return (
    -- _sort: created_at at full precision, for the cursor; the function strips it.
    select coalesce(jsonb_agg(public.api_task_json(p, v_ctx.scopes) || jsonb_build_object('_sort', p.created_at)
                              order by p.created_at, p.id), '[]'::jsonb)
    from (select pb.* from public.problems pb
          where pb.host_id = v_ctx.host_id
            and (v_ctx.allowed is null or public.api_allows_property(v_ctx, pb.property_id))
            and (p_status is null or pb.status::text = any(p_status))
            and (p_priority is null or pb.priority::text = any(p_priority))
            and (p_property_id is null or pb.property_id = p_property_id)
            and (coalesce(p_include_archived, false) or pb.archived_at is null)
            and (p_created_from is null or pb.created_at >= p_created_from)
            and (p_created_to is null or pb.created_at < p_created_to)
            and (p_updated_since is null or pb.updated_at >= p_updated_since)
            and (p_assignee_id is null or p_assignee_id = (
                   select w.assignee_id from public.tasks w
                   where w.problem_id = pb.id and w.type = 'maintenance'
                   order by w.created_at desc, w.id desc limit 1))
            and (p_after_id is null or (pb.created_at, pb.id) > (p_after_created, p_after_id))
          order by pb.created_at, pb.id
          limit least(greatest(p_limit, 1), 200) + 1) p);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.api_v1_create_task(p_digest text, p_idempotency_key text, p_request_hash text, p_title text, p_description text DEFAULT NULL::text, p_priority text DEFAULT NULL::text, p_property_id bigint DEFAULT NULL::bigint, p_assignee_id uuid DEFAULT NULL::uuid, p_scheduled_date date DEFAULT NULL::date, p_time_from time without time zone DEFAULT NULL::time without time zone, p_time_to time without time zone DEFAULT NULL::time without time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ctx     public.api_context := public.api_authorize(p_digest, 'tasks:create');
  v_replay  jsonb;
  v_problem public.problems;
  v_id      uuid := gen_random_uuid();
begin
  if p_assignee_id is not null then
    perform public.api_require(v_ctx, 'tasks:assign');
  elsif p_scheduled_date is not null or p_time_from is not null or p_time_to is not null then
    raise exception 'A day or hours need an assignee'
      using errcode = 'invalid_parameter_value', hint = 'api:invalid-request',
            detail = jsonb_build_object('name', 'assignee_id')::text;
  end if;

  v_replay := public.api_idempotency_claim(v_ctx.key_id, p_idempotency_key, 'createTask', p_request_hash);
  if v_replay is not null then
    return v_replay;
  end if;

  if v_ctx.allowed is not null and not public.api_allows_property(v_ctx, p_property_id) then
    raise exception 'The key may not write on property %', p_property_id
      using errcode = 'insufficient_privilege', hint = 'api:property-not-allowed',
            detail = jsonb_build_object('property_id', p_property_id)::text;
  end if;

  perform public.api_act_as(v_ctx.owner_id);
  v_problem := public.report_problem(v_id, p_title, p_description,
                                     coalesce(p_priority, 'normal')::public.problem_priority,
                                     p_property_id);
  if p_assignee_id is not null then
    v_problem := public.assign_problem(v_id, p_assignee_id, p_scheduled_date, p_time_from, p_time_to);
  end if;

  return public.api_idempotency_store(v_ctx.key_id, p_idempotency_key, 201,
                                      public.api_task_json(v_problem));
end;
$function$
;

  -- 4. The level itself.
  drop trigger problems_critical_follows_priority on public.problems;
  drop function public.problems_critical_follows_priority();
  alter table public.problems drop constraint problems_critical_is_high;
  alter table public.problems drop column critical;
end $$;
