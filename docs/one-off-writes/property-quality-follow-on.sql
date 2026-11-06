-- The reading goes on past the texts' line (docs/rollout/property-quality-1106.md).
-- A WRITE to the cloud: only on the owner's word, after the reading of the past has finished,
-- never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/property-quality-follow-on.sql
--
-- One switch. New reviews get their themes from the same reader, a settled week at a time, under
-- the same five dollars and the same day's ceiling: about $0.10 a month. Their findings stop
-- speaking for them, one episode a review. quality_meta stops naming the line, so review trends
-- appear in the 3, 6 and 12 month windows. The tick must stay active. The texts' line itself
-- does not move: nothing here changes what is stored.
-- The week the line falls in was read up to the line only, so it opens again and is read whole:
-- a few cents, and what it cost stays counted.
-- The stop: docs/one-off-writes/property-quality-follow-off.sql.
do $on$
begin
  update public.signal_settings set history_follow = true where kind = 'review';

  update raw.signal_history_runs r
  set status = 'failed', errors = r.errors || '[{"code": "reopened_for_follow", "count": 1}]'::jsonb
  from public.signal_settings s
  where s.kind = 'review' and s.host_id = r.host_id
    and r.part = 'reviews' and r.status = 'done'
    and (coalesce(s.notice_published_at, s.texts_enabled_at) at time zone 'Europe/Prague')::date
        between r.slice_start and r.slice_end;
end;
$on$;
