-- Cleaning comments as episodes (docs/property-intelligence-plan.md §2.3, stage 4).
--
-- «Найдено при работе» came from tasks alone; the free text a cleaner leaves at the end of a
-- cleaning said nothing to it. The dictionary reads it now, as it reads the staff's tasks, and no
-- model does.
--
-- Off by default. A comment says what was noticed and what was done alike, «выключила отопление»
-- beside «отопление не работает», and the dictionary cannot tell them apart. Nobody has checked
-- how often it is wrong, so a host turns this on by its own word; the night takes the episodes
-- back when it is turned off, since the stream is rebuilt whole.

alter table public.hosts
  add column quality_comments_on boolean not null default false;

comment on column public.hosts.quality_comments_on is
  'Cleaning comments count as episodes found at work, by the dictionary.';

alter table public.issue_facts
  add column task_step_id uuid references public.task_steps (id) on delete cascade;

create index issue_facts_task_step_idx on public.issue_facts (task_step_id)
  where task_step_id is not null;

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
  v_comments integer := 0;
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
                    where h.signal_id = f.signal_id and h.origin = 'history');
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

  -- A cleaner's comment is found at work, when the company has asked for it. The text is read
  -- here and goes nowhere: an episode keeps a theme and a link to its step.
  if coalesce((select h.quality_comments_on from public.hosts h where h.id = v_host), false) then
    insert into public.issue_facts (host_id, property_id, theme, layer, month, week, task_step_id,
                                    origin, detector)
    select v_host,
           public.signal_place_family(tk.property_id),
           c.theme,
           'found_at_work',
           date_trunc('month', d.day::timestamp)::date,
           case when d.day >= current_date - 90 then date_trunc('week', d.day::timestamp)::date end,
           s.id,
           'stream',
           'dict-v1'
    from public.task_steps s
    join public.tasks tk on tk.id = s.task_id
    cross join lateral (select public.issue_theme_of_text(s.payload ->> 'text') as theme) c
    cross join lateral (select (s.completed_at at time zone 'Europe/Prague')::date as day) d
    where tk.host_id = v_host
      and s.type = 'cleaner_comment'
      and s.completed_at is not null
      and c.theme is not null
      and tk.property_id is not null
      and tk.status <> 'cancelled'
      -- A repair asks «what was done?» in this same step: an answer, never an episode.
      and tk.type in ('cleaning', 'midstay')
      -- What the same cleaning filed as a task speaks through that task, once.
      and not exists (select 1 from public.problems pr
                      join public.problem_themes t on t.problem_id = pr.id
                      where pr.task_id = s.task_id and t.theme = c.theme);
    get diagnostics v_comments = row_count;
  end if;

  update public.issue_facts f set week = null
  where f.host_id = v_host and f.week is not null and f.week < current_date - 90;
  get diagnostics v_folded = row_count;

  return jsonb_build_object('themed', v_themed, 'facts', v_facts + v_staff + v_comments,
                            'comments', v_comments, 'folded', v_folded,
                            'area_members', public.refresh_quality_areas(v_host));
end;
$$;
