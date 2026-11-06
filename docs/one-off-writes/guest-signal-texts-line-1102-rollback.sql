-- Rollback of guest-signal-texts-line-1102.sql: the reviews' texts are kept
-- for stays from 4 November (Prague) again, the moment texts first went on.
--
--   npx supabase db query --linked -f docs/one-off-writes/guest-signal-texts-line-1102-rollback.sql
--
-- Not in 03:00–04:40 UTC. One statement (a DO block).
--
-- - texts_enabled_at goes back to the moment texts first went on;
-- - a November stay cut while the line was 2 November kept only «after 2
--   November», which no longer says on which side of 4 November it began:
--   that answer goes, and its month answers alone (review_text_allowed) —
--   the first of November is before the line, so such a stay keeps no text.
--   This also takes the texts of stays from 4 November that were cut in the
--   meantime: the safe side, as update_signal_settings does when a line
--   moves later. Their ratings, findings and tasks stay;
-- - every text the restored line no longer allows goes at once, with what was
--   drawn from it (erase_signal_texts: the findings keep their kind and
--   subject, lose their words and evidence).

do $$
declare
  c_moved_line constant date := date '2026-11-02';
  c_first_on   constant timestamptz := '2026-11-04 18:50:32.137795+00';
  v_host       uuid := public.default_host_id();
  v_settings   public.signal_settings;
  v_forgotten  integer;
  v_erased     integer;
begin
  select * into strict v_settings
  from public.signal_settings
  where host_id = v_host and kind = 'review'
  for update;

  if v_settings.notice_published_at is not null
     or (v_settings.texts_enabled_at at time zone 'Europe/Prague')::date <> c_moved_line then
    raise exception 'The line is not the one the write left; nothing changed';
  end if;

  update public.signal_settings
  set texts_enabled_at = c_first_on
  where host_id = v_host and kind = 'review'
  returning * into v_settings;

  update public.guest_signals g
  set stay_after_notice = null
  where g.host_id = v_host and g.kind = 'review'
    and not g.stay_exact
    and g.stay_after_notice is true
    and g.arrival_date = date '2026-11-01';
  get diagnostics v_forgotten = row_count;

  select count(*) into v_erased
  from public.guest_signals g
  where g.host_id = v_host and g.kind = 'review'
    and (g.public_text is not null or g.private_text is not null or g.category_comments is not null)
    and not public.review_text_allowed(g, v_settings);

  perform public.erase_signal_texts(array(
    select g.id from public.guest_signals g
    where g.host_id = v_host and g.kind = 'review'
      and (g.public_text is not null or g.private_text is not null or g.category_comments is not null)
      and not public.review_text_allowed(g, v_settings)));

  raise notice 'texts line back to 2026-11-04; % cut stay answer(s) forgotten, % text(s) erased',
    v_forgotten, v_erased;
end;
$$;
