-- The reading stops at the texts' line again (docs/rollout/property-quality-1106.md).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/property-quality-follow-off.sql
--
-- Labels already written stay. quality_meta names the line again, so review trends across it are
-- withheld again. New reviews go back to being spoken for by their findings.
update public.signal_settings set history_follow = false where kind = 'review';
