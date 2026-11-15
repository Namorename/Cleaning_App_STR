-- CLIENT:Wagnerstays — the company's cleaners pick a category instead of typing a title
-- (hosts.problem_report_mode = 'catalog', docs/problem-categories.md). A WRITE to the
-- cloud: only on the owner's word, never in 03:00–04:40 UTC, and only after
--   - migration 20261115100000_problem_categories,
--   - docs/one-off-writes/wagner-problem-categories.sql (it refuses an empty catalogue),
--   - the OTA that reads the switch (a phone without it keeps the typed title; no harm).
--
--   npx supabase db query --linked -f docs/one-off-writes/wagner-problem-report-mode-catalog.sql
--   undo: docs/one-off-writes/wagner-problem-report-mode-free-text.sql
--
-- The phones read it with the company settings: within five minutes of opening the report
-- form, at most an hour elsewhere (apps/mobile/src/features/host/use-host.ts).
do $$
declare
  c_host constant uuid := 'ce77c272-c330-4b74-ac98-c7d36cba8b2a';
begin
  perform set_config('lock_timeout', '3s', true);

  if (select count(*) from public.problem_categories c
      where c.host_id = c_host and c.archived_at is null) = 0 then
    raise exception 'The company % has no live category: load the catalogue first', c_host;
  end if;

  update public.hosts h set problem_report_mode = 'catalog' where h.id = c_host;
  if not found then
    raise exception 'The company % is not in this database', c_host;
  end if;
end $$;
