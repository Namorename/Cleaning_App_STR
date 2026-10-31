-- Technicians read the whole knowledge base (the owner's word of 2026-10-31):
-- every published article of their company, whatever work they hold now.
--
-- The rule it switches off stays in the database. Decision 5 of 2026-10-16
-- had a technician read only the places of the work he holds now;
-- kb_reader_property_ids() keeps that rule word for word, and a company whose
-- switch is off reads by it again:
--
--   update public.hosts set kb_techs_read_all = false where id = '<host>';
--
-- - hosts.kb_techs_read_all: the switch, on for every company.
-- - kb_tech_reads_all(): the caller is an active technician of a company with
--   the switch on.
-- - kb_staff_article_ids(): such a technician reads every published article of
--   his company. A cleaner, and a technician whose company has the switch off,
--   read as before.
-- - kb_article_targets: a new policy lets such a technician read every place
--   of the articles he reads. Then the card of any place he opens finds the
--   instructions of that place and of the house above it, not only those of
--   the places of his work. The articles of a house's rooms reach the house's
--   card only through the rooms he may read (properties' own rules), as before.
--   The cleaners' policy is unchanged: of an article's places, a cleaner reads
--   only her own.
--
-- Drafts and the archive stay in the office. The head technician and the
-- managers read as before (the office's policies). The phone needs no new
-- update: it reads whatever the policies hand it (features/knowledge/api.ts).
--
-- The version sorts between 20261030100000_knowledge_base, which it changes,
-- and 20261030110000_reviews_to_tasks, still parked for step 5 of
-- docs/rollout-plan-1028.md. So step 5 still pushes after the cloud's head.
--
-- The new column takes ACCESS EXCLUSIVE on hosts for a moment (a constant
-- default, no rewrite). A write still open on a table that points at hosts
-- makes it wait, and new writes queue behind it; after 3 s it gives up and
-- the push fails whole, nothing applied. Push outside 03:00–04:40 UTC, with
-- no long transaction in pg_stat_activity.

set local lock_timeout = '3s';

alter table public.hosts
  add column kb_techs_read_all boolean not null default true;

comment on column public.hosts.kb_techs_read_all is
  'Do the technicians read every published knowledge base article of the company (2026-10-31). Off: only the places of the work each holds now, the rule of 2026-10-16 (kb_reader_property_ids).';

-- Asked once a statement, as (select public.kb_tech_reads_all()).
create function public.kb_tech_reads_all()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select h.kb_techs_read_all
    from public.profiles p
    join public.hosts h on h.id = p.host_id
    where p.id = (select auth.uid()) and p.is_active and p.role = 'tech'
  ), false)
$$;

comment on function public.kb_tech_reads_all() is
  'The caller is an active technician of a company whose technicians read the whole knowledge base, hosts.kb_techs_read_all (20261030103000).';

-- As in 20261030100000, and every published article for a technician who
-- reads them all.
create or replace function public.kb_staff_article_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with places as materialized (
    select public.kb_reader_property_ids() as id
  )
  select a.id
  from public.kb_articles a
  where a.host_id = (select public.current_host_id())
    and a.status = 'published'
    and (a.scope = 'company'
         or (select public.kb_tech_reads_all())
         or exists (select 1
                    from public.kb_article_targets t
                    join places on places.id = t.property_id
                    where t.article_id = a.id));
$$;

comment on function public.kb_staff_article_ids() is
  'Published articles a cleaner or a technician reads: the whole company''s and those of kb_reader_property_ids() (20261030100000); every one for a technician while kb_tech_reads_all() (20261030103000).';

revoke all on function public.kb_tech_reads_all() from public, anon;
grant execute on function public.kb_tech_reads_all() to authenticated, service_role;

-- Named to sort before the office's and the cleaners' policies. Permissive
-- policies are OR'ed in descending order of name (20260924150000), and this one
-- stops at its first, cheap test for everybody but a technician.
create policy "technicians read every place of the articles they read"
  on public.kb_article_targets for select
  to authenticated
  using ((select public.kb_tech_reads_all())
         and host_id = (select public.current_host_id())
         and article_id = any (array(select public.kb_staff_article_ids())));
