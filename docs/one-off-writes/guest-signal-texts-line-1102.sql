-- One-off write (the owner's decision of 2026-11-05): the reviews' texts are
-- kept for stays from 2 November (Prague), not from 4 November.
--
--   npx supabase db query --linked -f docs/one-off-writes/guest-signal-texts-line-1102.sql
--
-- Not in 03:00–04:40 UTC. One statement (a DO block): every check passes or
-- nothing changes. Rollback: guest-signal-texts-line-1102-rollback.sql.
--
-- Why more than moving texts_enabled_at:
-- - the line is read by review_text_allowed (20261102100000) as a Prague day:
--   an exact stay by its arrival, a cut stay by stay_after_notice — the side
--   of the line it began on, written once, at its cut, against the line of
--   that moment;
-- - a stay cut before the move keeps its exact day nowhere (its arrival is the
--   first of its month), so a stay that began on 2 or 3 November and was cut
--   while the line was 4 November keeps «before» for good, and the load never
--   asks for its text (review_load_state reads the same rule, and
--   ingest_guest_reviews never touches the dates of a cut stay);
-- - so those rows go: the next load meets their reviews as new, with their
--   exact days, and the database decides by the new line. They are November's
--   cut stays answered «before» — no text, no finding by construction (both
--   are checked); a 1 November stay among them comes back without a text.
--   On 2026-11-04 23:06 UTC there was one such row, and Hostaway had exactly
--   one review of a stay from 1–3 November (arrival 2–3 November).
--
-- What stays as it was: notice_published_at (no notice), the switches, the
-- auto ceiling (0) and kinds (none), messages, every other review.

do $$
declare
  c_old_line  constant date := date '2026-11-04';
  c_new_line  constant timestamptz := '2026-11-02 00:00:00 Europe/Prague';
  c_expected  constant integer := 1;
  v_host      uuid := public.default_host_id();
  v_settings  public.signal_settings;
  v_targets   uuid[];
  v_deleted   integer;
begin
  select * into strict v_settings
  from public.signal_settings
  where host_id = v_host and kind = 'review'
  for update;

  if v_settings.notice_published_at is not null
     or not v_settings.texts_enabled
     or v_settings.texts_enabled_at is null
     or (v_settings.texts_enabled_at at time zone 'Europe/Prague')::date <> c_old_line
     or v_settings.daily_auto_cap <> 0
     or cardinality(v_settings.auto_kinds) <> 0 then
    raise exception 'The reviews'' settings are not the ones this write expects; nothing changed';
  end if;
  if exists (select 1 from public.signal_settings where host_id = v_host and kind = 'message')
     or exists (select 1 from public.guest_signals where host_id = v_host and kind = 'message') then
    raise exception 'Messages have settings or rows; nothing changed';
  end if;
  if exists (select 1 from public.problems where source <> 'staff') then
    raise exception 'Tasks from guest signals exist; nothing changed';
  end if;

  -- November's cut stays that answered «before the line»: by construction
  -- without a text and without a finding — both checked.
  select coalesce(array_agg(g.id order by g.id), '{}') into v_targets
  from public.guest_signals g
  where g.host_id = v_host and g.kind = 'review'
    and not g.stay_exact
    and g.stay_after_notice is false
    and g.arrival_date >= date '2026-11-01';
  if cardinality(v_targets) <> c_expected then
    raise exception 'Expected % November stay(s) cut before the line, found %; nothing changed',
      c_expected, cardinality(v_targets);
  end if;
  if exists (select 1 from public.guest_signals g
             where g.id = any (v_targets)
               and (g.public_text is not null or g.private_text is not null or g.category_comments is not null))
     or exists (select 1 from public.signal_findings f where f.signal_id = any (v_targets)) then
    raise exception 'A November stay cut before the line has a text or a finding; nothing changed';
  end if;

  update public.signal_settings
  set texts_enabled_at = c_new_line
  where host_id = v_host and kind = 'review';

  delete from public.guest_signals where id = any (v_targets);
  get diagnostics v_deleted = row_count;
  if v_deleted <> c_expected then
    raise exception 'Deleted % rows, expected %; rolled back', v_deleted, c_expected;
  end if;

  raise notice 'texts line moved to 2026-11-02 (Prague); % review row(s) to be loaded anew', v_deleted;
end;
$$;
