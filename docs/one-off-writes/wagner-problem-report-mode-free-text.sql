-- CLIENT:Wagnerstays — back to the typed title (hosts.problem_report_mode = 'free_text',
-- every company's mode before 2026-11-14). The first step of every rollback of the
-- catalogue (docs/problem-categories.md). A WRITE to the cloud: never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/wagner-problem-report-mode-free-text.sql
--
-- Tasks already filed under a category keep it, their title and their urgency. A phone
-- shows the typed title again within five minutes of opening the report form.
do $$
declare
  c_host constant uuid := 'ce77c272-c330-4b74-ac98-c7d36cba8b2a';
begin
  perform set_config('lock_timeout', '3s', true);

  update public.hosts h set problem_report_mode = 'free_text' where h.id = c_host;
  if not found then
    raise exception 'The company % is not in this database', c_host;
  end if;
end $$;
