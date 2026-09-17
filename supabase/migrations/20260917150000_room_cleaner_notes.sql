-- Units 6.4: a room shows the note written on its listing.
--
-- "The key is in box 4325" is written on the listing, and since 20260912150000
-- the cleaning stands on the room. The phone reads the note of the row the
-- cleaning stands on, so the note never reached the person at the door.
--
-- The loss today is exactly zero -- no listing of the seventy-nine carries a
-- note yet -- which is what makes it worth fixing now rather than later: the
-- first note anyone writes would be invisible in the nine places it matters
-- most, and nothing would say so.
--
-- Inherited through bare `parent_id`, like resolve_checklist_property and
-- resolve_workflow_template, and NOT gated on `hostaway_unit_id` the way
-- cleaners and the status cascade are. 20260912140000 draws that line and this
-- sits on its described side: a checklist, a process and a house note all say
-- how the work is done, and a part of a combined listing borrowing the
-- building's description is a sane default. Staff is an authority, not a
-- description, and authority does not cross into a listing that keeps its own
-- calendar.
--
-- A computed field rather than a coalesce in the phone. The phone already
-- embeds the parent row for its name, so the two notes could have been merged
-- in TypeScript -- and then the rule would live in the client, where the next
-- reader of a note (Help, F19) would have to remember to repeat it. PostgREST
-- serves a function of the row type as a column, so the rule stays here and
-- every reader gets it by asking for the field.
--
-- Invoker: "active staff read properties" already lets any active member of
-- the company read every listing it owns, so the parent row is readable by
-- whoever could read the room. A definer here would answer about rows the
-- caller may not see, which is what 20260917120000 has just taken away.
--
-- Blank is nothing. An empty string and a line of spaces are what a cleared
-- textarea leaves behind, and treating either as "the room has its own note"
-- would shadow the listing's note with nothing at all.

create or replace function public.effective_cleaner_notes(p public.properties)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(btrim(coalesce(p.cleaner_notes, '')), ''),
    (select nullif(btrim(coalesce(parent.cleaner_notes, '')), '')
     from public.properties parent
     where parent.id = p.parent_id)
  )
$$;

comment on function public.effective_cleaner_notes(public.properties) is
  'The note the cleaner at this door should read: the row''s own, otherwise the one on the listing above it. Served by PostgREST as a column of properties. The raw cleaner_notes column stays what the manager edits.';

revoke all on function public.effective_cleaner_notes(public.properties)
  from public, anon;
grant execute on function public.effective_cleaner_notes(public.properties)
  to authenticated, service_role;
