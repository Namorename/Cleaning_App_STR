-- CLIENT:Wagnerstays — the client's catalogue and switch in the cloud, read-only, after
-- migrations 20261115090000 and 20261115100000 (the table and its flag must exist):
--   node scripts/cloud-read.mjs docs/rollout/probe_wagner_problem_categories.sql
-- Expected after wagner-problem-categories.sql: live 27, archived 0, by_level
-- «critical 6, high 7, normal 6, low 8» (the owner's mapping of 2026-11-15),
-- catalogue_md5 as in docs/rollout/wagner-problem-catalog-1114.md. Every other
-- company: free_text.
select
  (select h.problem_report_mode from public.hosts h
   where h.id = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a') as mode,
  (select count(*) from public.hosts h
   where h.id <> 'ce77c272-c330-4b74-ac98-c7d36cba8b2a' and h.problem_report_mode <> 'free_text')
    as other_companies_not_free_text,
  (select count(*) from public.problem_categories c
   where c.host_id = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a' and c.archived_at is null) as live,
  (select count(*) from public.problem_categories c
   where c.host_id = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a' and c.archived_at is not null) as archived,
  (select string_agg(x.level || ' ' || x.n, ', ' order by x.rank desc)
   from (select case when c.critical then 'critical' else c.priority::text end as level,
                case when c.critical then 4 else array_position(array['low', 'normal', 'high'],
                                                                c.priority::text) end as rank,
                count(*) as n
         from public.problem_categories c
         where c.host_id = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a' and c.archived_at is null
         group by 1, 2) x) as by_level,
  -- Names, translations, words and urgencies in the owner's order, as one fingerprint.
  (select md5(string_agg(c.id || '|' || c.sort_order || '|' || c.name || '|' || c.name_i18n::text
                         || '|' || array_to_string(c.synonyms, ',') || '|' || c.priority
                         || '|' || c.critical,
                         E'\n' order by c.sort_order))
   from public.problem_categories c
   where c.host_id = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a' and c.archived_at is null)
    as catalogue_md5,
  (select count(*) from public.problems p where p.category_id is not null) as tasks_with_category;
