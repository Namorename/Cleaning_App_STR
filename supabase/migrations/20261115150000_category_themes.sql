-- CORE (owner, 2026-11-15): a category of the catalogue (20261115100000) may name the theme of
-- «Качество объектов» its tasks are about, or say that they are no quality issue at all.
--
-- Until now a task filed under a category got its theme from the dictionary (dict-v1) reading
-- its title: 15 of a client's 27 category names gave one, and «Доставка (бельё, химия…)» the
-- wrong one. Now, for a task filed under a category (category_id), the order is:
--   1. the manager's hand (problem_themes.source = 'manual'), as before, above everything;
--   2. the category: its theme (source 'category'), or «не проблема качества» (not_quality):
--      no theme, so no episode in the themes of the place;
--   3. as before: the guest's finding, then the dictionary.
-- A task with no category: exactly as before.
--
-- - problem_categories.theme: a code of the live catalogue (issue_themes, themes-v1), never a new
--   one; problem_categories.not_quality; not both.
-- - problem_themes.source learns 'category'.
-- - refresh_category_themes(host): the themes of the company's catalogue tasks by that order,
--   recomputed whole except the manual ones — a category's binding may change, a task may move
--   to another category. The nightly refresh_property_quality calls it first and leaves the
--   catalogue tasks to it; a one-off script that binds categories calls it at once.
-- - problem_theme(task), what the panel shows: the hand, else the category, else what the night
--   wrote — so a task shows its category's theme from the first minute, «Определена по
--   категории». A task of no category answers as before.
--
-- The body of refresh_property_quality is the live definition (20261110210000) read back with
-- pg_get_functiondef and changed only where the comments say; the rollback
-- (docs/one-off-writes/category-themes-rollback.sql) restores it and problem_theme byte for byte.
--
-- Locks: ADD COLUMN on problem_categories and a new check on problem_themes take ACCESS
-- EXCLUSIVE for a moment. After 3 s the push gives up whole. Push outside 03:00–04:40 UTC.

set local lock_timeout = '3s';

-- ---------- the catalogue names a theme, or says «no quality issue» ----------

alter table public.problem_categories
  add column theme text references public.issue_themes (code) on delete restrict,
  add column not_quality boolean not null default false;

alter table public.problem_categories
  add constraint problem_categories_theme_or_not_quality check (not (not_quality and theme is not null));

comment on column public.problem_categories.theme is
  'The theme of «Качество объектов» a task of this category is about (issue_themes); null: the dictionary reads its title, as before (20261115150000).';
comment on column public.problem_categories.not_quality is
  'A task of this category is no quality issue: it gets no theme and no episode, unless a manager gives it one (20261115150000).';

-- ---------- a theme said by a category ----------

alter table public.problem_themes drop constraint problem_themes_source_check;
alter table public.problem_themes
  add constraint problem_themes_source_check check (source in ('signal', 'dict', 'manual', 'category'));

/**
 * The themes of a company's tasks filed under a category, by the order of the header: the
 * manual ones stay; every other is taken away and written again — the category's theme, none
 * for «no quality issue», and for a category with no binding the guest's finding or the
 * dictionary, as for any task. Returns how many tasks have a theme by it now.
 */
create function public.refresh_category_themes(p_host uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_themed integer;
begin
  -- A task that is no longer under a category loses a theme its category gave: the night
  -- writes the dictionary's again.
  delete from public.problem_themes t
  using public.problems pr
  where t.problem_id = pr.id
    and pr.host_id = p_host
    and (pr.category_id is not null or t.source = 'category')
    and t.source <> 'manual';

  insert into public.problem_themes (problem_id, theme, source, detector)
  select x.id, x.theme, x.source, x.detector
  from (
    select pr.id,
           case when c.not_quality then null
                when c.theme is not null then c.theme
                else coalesce(public.issue_theme_of_finding(f.kind, f.subject),
                              public.issue_theme_of_text(pr.title || ' ' || coalesce(pr.description, '')))
           end as theme,
           case when c.theme is not null then 'category'
                when public.issue_theme_of_finding(f.kind, f.subject) is not null then 'signal'
                else 'dict' end as source,
           case when c.theme is not null then 'category'
                when public.issue_theme_of_finding(f.kind, f.subject) is not null then f.detector
                else 'dict-v1' end as detector
    from public.problems pr
    join public.problem_categories c on c.id = pr.category_id
    left join public.signal_findings f on f.problem_id = pr.id
    where pr.host_id = p_host
      and not exists (select 1 from public.problem_themes t where t.problem_id = pr.id)
  ) x
  where x.theme is not null
  on conflict (problem_id) do nothing;
  get diagnostics v_themed = row_count;
  return v_themed;
end;
$$;

comment on function public.refresh_category_themes(uuid) is
  'The themes of a company''s catalogue tasks: the hand, else the category (or no theme for not_quality), else the finding or the dictionary (20261115150000).';

revoke all on function public.refresh_category_themes(uuid) from public, anon, authenticated, service_role;

-- ---------- what the panel shows ----------

/** The theme of a task and who said it: the hand, else its category, else what the night wrote. */
create or replace function public.problem_theme(p_problem_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not coalesce((select public.is_manager()), false) then
    raise exception 'The theme of a task is for managers only'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  return (
    select case
             when t.source = 'manual' then jsonb_build_object('theme', t.theme, 'source', 'manual')
             -- «Не проблема качества»: no theme, said by the category.
             when c.not_quality then jsonb_build_object('theme', null, 'source', 'category', 'not_quality', true)
             when c.theme is not null then jsonb_build_object('theme', c.theme, 'source', 'category')
             when t.theme is not null then jsonb_build_object('theme', t.theme, 'source', t.source)
           end
    from public.problems p
    left join public.problem_themes t on t.problem_id = p.id
    left join public.problem_categories c on c.id = p.category_id
    where p.id = p_problem_id and p.host_id = public.current_host_id()
  );
end;
$$;

-- ---------- the night: the catalogue tasks by their category first ----------

CREATE OR REPLACE FUNCTION public.refresh_property_quality(p_host_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_host     uuid := coalesce(p_host_id, public.default_host_id());
  v_themed   integer;
  v_facts    integer;
  v_staff    integer;
  v_comments integer := 0;
  v_folded   integer;
begin
  -- A task filed under a category takes its theme by the category first (20261115150000).
  perform public.refresh_category_themes(v_host);

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
      and pr.category_id is null
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
$function$
;
