-- Cleaning comments stop counting (20261110210000). A WRITE to the cloud: only on the owner's
-- word, never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/quality-comments-off.sql
--
-- The refresh rebuilds the stream, so their episodes are gone at once.
do $off$
begin
  update public.hosts set quality_comments_on = false where id = public.default_host_id();
  perform public.refresh_property_quality();
end;
$off$;
