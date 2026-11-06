-- The panel starts counting the labels of themes-v2 (docs/rollout/property-quality-1106.md).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC, and only when the
-- second reading has closed its weeks.
--
--   npx supabase db query --linked -f docs/one-off-writes/property-quality-show-v2.sql
--
-- The old labels stay in the table. Back: the same update with claude-haiku-5-5@themes-v1.
do $show$
begin
  update public.signal_settings
  set history_shown_detector = 'claude-haiku-5-5@themes-v2'
  where kind = 'review';

  perform public.refresh_property_quality();
end;
$show$;
