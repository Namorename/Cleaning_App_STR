-- CORE: a company's catalogue of task categories, and a switch that has the
-- cleaners pick from it instead of typing a title (docs/problem-categories.md).
--
-- The first company to use it is a client's (CLIENT:Wagnerstays, 2026-11-14),
-- and its list is data: docs/one-off-writes/wagner-problem-categories.sql loads
-- it, nothing here names it. This migration makes only the room for a list:
--
-- - hosts.problem_report_mode: 'free_text' (every company, as today) or
--   'catalog' (the phone's cleaners pick a category). The phone decides what it
--   offers from it; the server accepts a typed title in either mode, because a
--   phone that has not taken the update yet still sends one.
-- - problem_categories: the list. A name in the company's language with its
--   translations (as checklist_modules, 20260907110000), words a cleaner may
--   type for it (synonyms), the urgency a task of that category gets, an order.
--   Read by the staff of the company, written by nobody but the database owner
--   and the service role: there is no screen for it yet. Archived, never
--   deleted while a task points at it.
-- - problems.category_id: the category a task was filed under, for the
--   statistics to come. Null for every task filed so far, and for every task
--   filed with a typed title.
-- - report_problem gains p_category_id (default null). With it the server, not
--   the phone, decides the title (the category's name and translations) and the
--   urgency (the category's). Without it nothing changes: an old phone, the
--   panel and the API (api_v1_create_task) call the function as before.
-- - update_problem gains p_category_id (default null) too. A task filed under a
--   category keeps the category's title and urgency whatever the caller sends;
--   with p_category_id the reporter moves it to another category.
--
-- The urgency of a category is the product's own scale (problem_priority: low,
-- normal, high). It drives the night pushes (push_on_problem_reported) and the
-- «Срочно» pill, so a category says which of the three it is; there is no
-- fourth level here.
--
-- Locks: ADD COLUMN on hosts and on problems takes ACCESS EXCLUSIVE for a
-- moment (nullable or a constant default: no rewrite). A write still open on
-- either table makes it wait, and new writes queue behind it; after 3 s it
-- gives up and the push fails whole, nothing applied. Push outside 03:00–04:40
-- UTC, with no long transaction in pg_stat_activity.

set local lock_timeout = '3s';

-- ---------- the switch ----------

alter table public.hosts
  add column problem_report_mode text not null default 'free_text'
    constraint hosts_problem_report_mode_check
      check (problem_report_mode in ('free_text', 'catalog'));

comment on column public.hosts.problem_report_mode is
  'How a cleaner names a task on the phone: free_text (types a title and picks the urgency) or catalog (picks a category of problem_categories; title and urgency follow it). Free text for every company unless switched (20261115100000).';

-- ---------- the catalogue ----------

create table public.problem_categories (
  id          uuid primary key default gen_random_uuid(),
  host_id     uuid not null default public.default_host_id()
                references public.hosts(id) on delete restrict,
  -- In the company's language (hosts.default_language); the translations
  -- beside it, read as localizedText does: the reader's language, else this.
  name        text not null,
  name_i18n   jsonb not null default '{}'::jsonb,
  -- Words a cleaner may type for it and not find in its name: «кран» for
  -- «Смесители», «wifi» for «Wi-Fi». Any language; the phone searches them
  -- with the names.
  synonyms    text[] not null default '{}'::text[],
  -- The urgency a task of this category is filed with, decided here and not
  -- on the phone.
  priority    public.problem_priority not null,
  sort_order  smallint not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- The name becomes a task's title: the same bound (problem_title_max_length).
  check (length(btrim(name)) between 1 and 200),
  check (jsonb_typeof(name_i18n) = 'object'),
  check (cardinality(synonyms) <= 50),
  check (array_position(synonyms, null) is null),
  check (not ('' = any (synonyms)))
);

comment on table public.problem_categories is
  'What a cleaner picks when the company reports by catalogue (hosts.problem_report_mode): a name in the company language, its translations, words to find it by, the urgency of a task filed under it. Archived, never deleted (20261115100000).';

-- One live entry per name in a company, whatever the case; an archived entry
-- does not block the name from being used again.
create unique index problem_categories_name_key
  on public.problem_categories (host_id, lower(btrim(name)))
  where archived_at is null;
create index problem_categories_host_idx
  on public.problem_categories (host_id, archived_at, sort_order, name);

create trigger problem_categories_touch
  before update on public.problem_categories
  for each row execute function public.touch_updated_at();

revoke all on public.problem_categories from anon, authenticated;
grant select on public.problem_categories to authenticated;
grant select, insert, update, delete on public.problem_categories to service_role;

alter table public.problem_categories enable row level security;

create policy "staff read the categories"
  on public.problem_categories for select to authenticated
  using (host_id = (select public.current_host_id()) and (select public.is_active_user()));

-- ---------- the category of a task ----------

-- Restrict, not set null: a category a task was filed under is archived, never
-- deleted, so the statistics keep the link and the task keeps the translations
-- of its title in step with its category.
alter table public.problems
  add column category_id uuid references public.problem_categories(id) on delete restrict;

comment on column public.problems.category_id is
  'The category the task was filed under (problem_categories); null when its title was typed. Kept for the statistics; set by report_problem and update_problem only; a category a task points at cannot be deleted, only archived (20261115100000).';

create index problems_category_idx
  on public.problems (category_id) where category_id is not null;

/**
 * A category of the caller's company, for a task about to be filed or edited.
 *
 * An archived one is still found: a report queued on a phone without a
 * connection was picked while the category was offered, and refusing it after
 * the fact would lose the report. One of another company, or none at all, is
 * refused.
 */
create function public.problem_category_for_report(p_category_id uuid)
returns public.problem_categories
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_category public.problem_categories;
begin
  select c.* into v_category
  from public.problem_categories c
  where c.id = p_category_id
    and c.host_id = public.current_host_id();
  if not found then
    raise exception 'Problem category not found'
      using errcode = 'check_violation', hint = 'serverErrors.problemCategoryNotFound';
  end if;
  return v_category;
end;
$$;

comment on function public.problem_category_for_report(uuid) is
  'The caller''s company''s category, archived or not, or an error (serverErrors.problemCategoryNotFound). Called by report_problem and update_problem (20261115100000).';

revoke all on function public.problem_category_for_report(uuid) from public, anon, authenticated;

-- ---------- the cleaner's writes ----------

-- A new argument is a new signature. The old one goes in the same transaction,
-- so PostgREST never sees two functions of one name a call could mean.
drop function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid);

/**
 * Report a problem. Replayable: the same id returns the same row.
 *
 * With p_category_id the category names the task and sets its urgency; the
 * title and the priority the caller sent are not read. Without it, as before
 * (20260908130000): an older phone, the panel and the API send none.
 */
create function public.report_problem(
  p_id          uuid,
  p_title       text,
  p_description text default null,
  p_priority    public.problem_priority default 'normal',
  p_property_id bigint default null,
  p_task_id     uuid default null,
  p_category_id uuid default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem    public.problems;
  v_property   bigint;
  v_category   public.problem_categories;
  v_title      text := p_title;
  v_title_i18n jsonb;
  v_priority   public.problem_priority := coalesce(p_priority, 'normal');
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

  if p_category_id is not null then
    v_category := public.problem_category_for_report(p_category_id);
    v_title := v_category.name;
    v_title_i18n := nullif(v_category.name_i18n, '{}'::jsonb);
    v_priority := v_category.priority;
  end if;

  perform public.validate_problem_text(v_title, p_description);
  v_property := public.resolve_report_property(p_property_id, p_task_id);

  insert into public.problems (
    id, host_id, property_id, task_id, reported_by, title, title_i18n, description, priority,
    category_id
  ) values (
    p_id, public.current_host_id(), v_property, p_task_id, (select auth.uid()),
    btrim(v_title), v_title_i18n, nullif(btrim(coalesce(p_description, '')), ''), v_priority,
    p_category_id
  )
  returning * into v_problem;

  return v_problem;
end;
$$;

drop function public.update_problem(uuid, text, text, public.problem_priority);

/**
 * The reporter corrects her own report while nobody has picked it up.
 *
 * A task filed under a category keeps the category's title and urgency: the
 * title and the priority the caller sent are not read. p_category_id moves it
 * to another category. A task with a typed title and no p_category_id: as
 * before (20260908130000).
 */
create function public.update_problem(
  p_id          uuid,
  p_title       text,
  p_description text default null,
  p_priority    public.problem_priority default 'normal',
  p_category_id uuid default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem     public.problems;
  v_category    public.problem_categories;
  v_category_id uuid;
  v_title       text := p_title;
  v_priority    public.problem_priority := coalesce(p_priority, 'normal');
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

  v_category_id := coalesce(p_category_id, v_problem.category_id);
  if v_category_id is not null then
    v_category := public.problem_category_for_report(v_category_id);
    v_title := v_category.name;
    v_priority := v_category.priority;
  end if;

  perform public.validate_problem_text(v_title, p_description);

  update public.problems p
  set title       = btrim(v_title),
      title_i18n  = case when v_category_id is null then p.title_i18n
                         else nullif(v_category.name_i18n, '{}'::jsonb) end,
      description = nullif(btrim(coalesce(p_description, '')), ''),
      priority    = v_priority,
      category_id = v_category_id
  where p.id = p_id
  returning * into v_problem;

  return v_problem;
end;
$$;

revoke all on function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, uuid)
  from public, anon;
revoke all on function public.update_problem(uuid, text, text, public.problem_priority, uuid)
  from public, anon;
grant execute on function public.report_problem(uuid, text, text, public.problem_priority, bigint, uuid, uuid)
  to authenticated, service_role;
grant execute on function public.update_problem(uuid, text, text, public.problem_priority, uuid)
  to authenticated, service_role;
