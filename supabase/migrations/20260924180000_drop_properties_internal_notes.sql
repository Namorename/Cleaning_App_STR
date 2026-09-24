-- Window 3, M2: the office's note leaves the property row for good.
--
-- M1 (20260924130000) copied every non-empty properties.internal_notes into
-- property_internal_notes, and the panel now reads and writes only the table.
-- This file drops the column -- the step that actually closes the hole, since
-- until now a cleaner could still read the old column through the API. It is
-- pushed on its own, after the new panel is live (docs/window3-plan.md,
-- «Порядок выката», step 4): dropped earlier, the panel in production would
-- break on 42703 when reading a card and PGRST204 when saving one.
--
-- Dropping is irreversible, so the file first proves nothing is lost. It
-- refuses if any property still carries a non-empty column note that the table
-- does not hold with the same text -- trimmed, as M1 stored it. Two ways that
-- can happen: an old panel tab wrote the column after the copy, or a note was
-- edited in the new panel while its old text stayed in the column. The rule of
-- the window is that nobody edits office notes between the first push and this
-- one; if the refusal fires anyway, nothing is lost -- the column is still
-- there -- and the ids in the message say which properties to settle by hand.
--
-- LOCKS. The table is held still from the check to the drop: a plain SELECT
-- takes only ACCESS SHARE, and an old-panel save that committed between the
-- check and the drop would go with the column (preflight, 2026-09-25, seen
-- with a two-session race). The lock is taken inside the do-block because the
-- CLI sends a migration as one pipelined transaction in which a top-level
-- LOCK TABLE is refused ("can only be used in transaction blocks"); inside
-- plpgsql it is not top level, and it holds until the file commits. drop
-- column then needs no upgrade. The scan is ~110 rows, milliseconds, under the
-- same lock_timeout.

set local lock_timeout = '3s';

do $$
declare
  v_ids text;
begin
  lock table public.properties in access exclusive mode;

  select string_agg(p.id::text, ', ' order by p.id)
  into v_ids
  from public.properties p
  where nullif(btrim(p.internal_notes), '') is not null
    and not exists (
      select 1 from public.property_internal_notes n
      where n.property_id = p.id
        and n.notes = btrim(p.internal_notes));

  if v_ids is not null then
    -- No hint: that field carries i18n keys for the apps, and nobody but the
    -- operator running the push ever sees this.
    raise exception 'Office notes not carried over to property_internal_notes for properties %; the column is untouched, settle them by hand and push again',
      v_ids;
  end if;
end;
$$;

alter table public.properties drop column internal_notes;
