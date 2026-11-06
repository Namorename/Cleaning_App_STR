-- The panel starts counting the labels of themes-v2 (docs/rollout/property-quality-1106.md).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/property-quality-show-v2.sql
--
-- Refuses while the second reading has weeks left. The old labels stay in the table, and the
-- refresh gives the reviews only they labelled back to their findings until the wipe.
-- Back, before any wipe: the same update with claude-haiku-5-5@themes-v1, then the refresh.
do $show$
begin
  if coalesce((select (r.counts ->> 'weeks_left')::integer
               from raw.signal_history_runs r
               where r.part = 'reviews' and r.status = 'done'
                 and r.detector = 'claude-haiku-5-5@themes-v2' and r.counts ? 'weeks_left'
               order by r.finished_at desc
               limit 1), 1) > 0 then
    raise exception 'themes-v2 still has weeks to read';
  end if;

  update public.signal_settings
  set history_shown_detector = 'claude-haiku-5-5@themes-v2'
  where kind = 'review';

  perform public.refresh_property_quality();
end;
$show$;
