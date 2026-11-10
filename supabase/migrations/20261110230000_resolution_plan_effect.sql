-- What followed a plan (docs/property-intelligence-plan.md §5.6, stage 5): the same themes, the
-- same layers, before the launch and after the last step closed.
--
-- This reads and concludes nothing. The panel holds the rules: no conclusion under 30 stays after
-- the close, a seasonal theme against the same months of the year before, and words of
-- coincidence only (§3.4). An episode keeps its week for 90 days and its month after that, so the
-- whole week of the close, or the whole month once the week is folded, counts as after. That errs
-- against the plan and never for it, and the number does not move as the episodes age.

create or replace function public.resolution_plan_effect(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_host   uuid := public.current_host_id();
  v_plan   public.resolution_plans;
  v_today  date := (now() at time zone 'Europe/Prague')::date;
  v_closed date;
  v_stays  integer;
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'Plans are for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select p.* into v_plan
  from public.resolution_plans p
  where p.id = p_id and p.host_id = v_host;
  if not found or v_plan.status <> 'launched' then
    return null;
  end if;
  if not exists (select 1 from public.resolution_step_states(p_id))
     or exists (select 1 from public.resolution_step_states(p_id) x where x.state <> 'closed') then
    return null;
  end if;

  v_closed := (coalesce((select max(x.closed_at) from public.resolution_step_states(p_id) x),
                        v_plan.launched_at) at time zone 'Europe/Prague')::date;

  select count(*) into v_stays
  from public.analytics_checkout_rows(v_host, v_closed, v_today, null, false, false) c
  where c.listing_id = v_plan.property_id;

  return jsonb_build_object(
    'closed_on', v_closed,
    'launched_on', v_plan.baseline ->> 'on',
    'stays_before', (v_plan.baseline -> '12m' ->> 'stays')::integer,
    'stays_after', v_stays,
    'themes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'theme', th.code,
               'seasonal', th.is_seasonal,
               'before', coalesce(v_plan.baseline -> '12m' -> 'themes' -> th.code,
                                  '{"reviews": 0, "found": 0, "reported": 0}'::jsonb),
               'after', a.counts,
               'work_after', w.n,
               'last_year', case when th.is_seasonal then y.counts end
             ) order by th.sort_order)
      from public.issue_themes th
      cross join lateral (
        select jsonb_build_object(
                 'reviews', count(*) filter (where f.layer = 'guest_review'),
                 'found', count(*) filter (where f.layer = 'found_at_work'),
                 'reported', count(*) filter (where f.layer = 'staff_report')) as counts
        from public.issue_facts f
        left join public.guest_signals g on g.id = f.signal_id
        where f.host_id = v_host and f.property_id = v_plan.property_id and f.theme = th.code
          and f.layer <> 'guest_message' and not coalesce(g.is_hidden, false)
          and case when f.week is not null then f.week >= date_trunc('week', v_closed::timestamp)::date
                   else f.month >= date_trunc('month', v_closed::timestamp)::date end
      ) a
      cross join lateral (
        select count(*)::integer as n
        from public.problem_themes t
        join public.problems pr on pr.id = t.problem_id
        join public.properties l on l.id = pr.property_id
        where t.theme = th.code and pr.host_id = v_host
          and coalesce(l.parent_id, l.id) = v_plan.property_id
          and (pr.created_at at time zone 'Europe/Prague')::date >= v_closed
      ) w
      cross join lateral (
        -- The same months a year earlier; months, since an old episode keeps no week.
        select jsonb_build_object(
                 'reviews', count(*) filter (where f.layer = 'guest_review'),
                 'found', count(*) filter (where f.layer = 'found_at_work'),
                 'reported', count(*) filter (where f.layer = 'staff_report'),
                 'stays', (select coalesce(sum(s.stays), 0)
                           from public.property_month_stats s
                           where s.host_id = v_host and s.property_id = v_plan.property_id
                             and s.month between date_trunc('month', v_closed - interval '1 year')::date
                                             and (v_today - interval '1 year')::date)) as counts
        from public.issue_facts f
        left join public.guest_signals g on g.id = f.signal_id
        where f.host_id = v_host and f.property_id = v_plan.property_id and f.theme = th.code
          and f.layer <> 'guest_message' and not coalesce(g.is_hidden, false)
          and f.month between date_trunc('month', v_closed - interval '1 year')::date
                          and (v_today - interval '1 year')::date
      ) y
      where th.code in (select s.theme from public.resolution_plan_steps s where s.plan_id = p_id)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.resolution_plan_effect(uuid) from public, anon;
grant execute on function public.resolution_plan_effect(uuid) to authenticated;
