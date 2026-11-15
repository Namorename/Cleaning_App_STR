-- CLIENT:Wagnerstays — the themes of the client's categories and of its catalogue tasks in the
-- cloud, read-only, after 20261115150000 (the columns must exist):
--   node scripts/cloud-read.mjs docs/rollout/probe_wagner_category_themes.sql
-- Expected after wagner-category-themes.sql: live 27, themed 21, not_quality 1, unbound 5,
-- bindings_md5 as in docs/rollout/category-themes-1115.md; the catalogue tasks' themes by
-- source; the switch still catalog.
select
  (select h.problem_report_mode from public.hosts h
   where h.id = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a') as mode,
  (select count(*) from public.problem_categories c
   where c.host_id = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a' and c.archived_at is null) as live,
  (select count(*) from public.problem_categories c
   where c.host_id = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a' and c.theme is not null) as themed,
  (select count(*) from public.problem_categories c
   where c.host_id = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a' and c.not_quality) as not_quality,
  (select count(*) from public.problem_categories c
   where c.host_id = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a' and c.theme is null and not c.not_quality)
    as unbound,
  -- Every binding in the owner's order, as one fingerprint.
  (select md5(string_agg(c.id || '|' || coalesce(c.theme, '-') || '|' || c.not_quality, E'\n'
                         order by c.sort_order))
   from public.problem_categories c
   where c.host_id = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a') as bindings_md5,
  (select coalesce(string_agg(x.source || ' ' || x.n, ', ' order by x.source), '')
   from (select coalesce(t.source, 'none') as source, count(*) as n
         from public.problems p
         left join public.problem_themes t on t.problem_id = p.id
         where p.host_id = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a' and p.category_id is not null
         group by 1) x) as catalogue_task_themes;
