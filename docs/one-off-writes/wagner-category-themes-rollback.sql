-- CLIENT:Wagnerstays — undo of wagner-category-themes.sql: the 27 categories bound to no theme
-- and none «no quality issue» again, and the themes of the company's catalogue tasks written
-- again at once — by the dictionary, as before the binding; a manager's own choice stays. A
-- WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/wagner-category-themes-rollback.sql
--
-- The switch (hosts.problem_report_mode) is not touched: the cleaners keep the catalogue.
-- Must run before the rollback of 20261115150000 (category-themes-rollback.sql), which drops the
-- columns this reads.
do $$
declare
  c_host constant uuid := 'ce77c272-c330-4b74-ac98-c7d36cba8b2a';
  v_count  integer;
  v_themed integer;
begin
  perform set_config('lock_timeout', '3s', true);

  if not exists (select 1 from public.hosts h where h.id = c_host) then
    raise exception 'The company % is not in this database', c_host;
  end if;

  update public.problem_categories c
  set theme = null, not_quality = false
  where c.host_id = c_host and (c.theme is not null or c.not_quality);
  get diagnostics v_count = row_count;

  v_themed := public.refresh_category_themes(c_host);
  raise notice 'categories unbound: %; catalogue tasks themed now (by the dictionary): %', v_count, v_themed;
end $$;
