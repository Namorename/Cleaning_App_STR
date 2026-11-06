-- The labels of themes-v1 go; themes-v2 stays (docs/rollout/property-quality-1106.md).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC, and only after
-- property-quality-show-v2.sql: this refuses to run while the panel still counts them.
--
--   npx supabase db query --linked -f docs/one-off-writes/property-quality-labels-wipe-v1.sql
--
-- The journal's rows stay, with what they cost: the budget is one-off.
do $wipe$
begin
  if exists (select 1 from public.signal_settings
             where kind = 'review' and history_shown_detector = 'claude-haiku-5-5@themes-v1') then
    raise exception 'The panel still counts themes-v1';
  end if;

  delete from public.issue_facts
  where origin = 'history' and detector = 'claude-haiku-5-5@themes-v1';
end;
$wipe$;
