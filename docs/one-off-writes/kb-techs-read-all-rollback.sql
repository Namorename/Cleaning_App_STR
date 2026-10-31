-- Rollback of 20261030103000_kb_techs_read_all (docs/knowledge-base-step1.md, «Решение
-- владельца 2026-10-31»). A WRITE to the cloud: only on the owner's word, never in
-- 03:00–04:40 UTC.
--
-- Most often this file is not needed. The rule of 2026-10-16 comes back for a company with
-- one write of its switch, and the schema stays as it is:
--   update public.hosts set kb_techs_read_all = false where id = '<host>';
--
-- This file takes the schema back to 20261030100000:
--   1. this file, one statement:
--        npx supabase db query --linked -f docs/one-off-writes/kb-techs-read-all-rollback.sql
--   2. the history: npx supabase migration repair --status reverted 20261030103000 --linked
--   3. the file out of the catalog, or the next db push applies it again: revert the commit
--      that brought it (it takes database.types.ts, coverage.json and the doc back too) —
--      in main that is a push to production, on the owner's word as well.
--   4. the probe: node scripts/cloud-read.mjs docs/rollout/postpush_kb_techs_read_all.sql —
--      column [], kb_tech_reads_all absent, kb_staff_article_ids 1576bc36 / 434 (its body of
--      20261030100000), two policies on kb_article_targets.
--
-- Like the migration, step 1 takes ACCESS EXCLUSIVE on hosts for a moment: outside
-- 03:00–04:40 UTC, no long transaction in pg_stat_activity. The phone and the panel read
-- nothing of these objects by name; no client changes.
do $$
begin
  perform set_config('lock_timeout', '3s', true);

  drop policy "technicians read every place of the articles they read" on public.kb_article_targets;

  -- The body of 20261030100000, word for word.
  create or replace function public.kb_staff_article_ids()
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = ''
  as $fn$
  with places as materialized (
    select public.kb_reader_property_ids() as id
  )
  select a.id
  from public.kb_articles a
  where a.host_id = (select public.current_host_id())
    and a.status = 'published'
    and (a.scope = 'company'
         or exists (select 1
                    from public.kb_article_targets t
                    join places on places.id = t.property_id
                    where t.article_id = a.id));
$fn$;

  comment on function public.kb_staff_article_ids() is
    'Published articles a cleaner or a technician reads: the whole company''s and those of kb_reader_property_ids() (20261030100000).';

  drop function public.kb_tech_reads_all();

  alter table public.hosts drop column kb_techs_read_all;
end $$;
