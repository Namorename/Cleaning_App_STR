-- The office corrects any task's title and description (the owner's request of 2026-11-19, CORE;
-- docs/panel-edits-reception-1119.md §1).
--
-- update_problem stays the reporter's own: her open report, as before. This is the office's: any
-- task (problem) of the company — a cleaner's report, a technician's, a guest's — in any status,
-- archived or not, by whoever problem_for_manager lets through (a manager or an admin; with
-- 20261119143000 the reception too).
--
-- - A new title takes the translations off (title_i18n held the model's or the category's words,
--   which it no longer is); the same title keeps them. The category stays: it is the statistics'.
-- - p_description null leaves the description alone (the house rule for an argument nobody named);
--   an empty one clears it.
-- - No journal line: a new kind of problem_events would break the clients that read the journal by
--   a closed list of kinds.
--
-- Additive: one new function. Old clients never call it.

create function public.edit_problem_text(
  p_id          uuid,
  p_title       text,
  p_description text default null
)
returns public.problems
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem public.problems;
  v_title   text := btrim(coalesce(p_title, ''));
begin
  -- The office of this company, the row locked: refuses anybody else (serverErrors.managerOnly)
  -- and a task of another company or none (serverErrors.problemNotFound).
  v_problem := public.problem_for_manager(p_id);
  perform public.validate_problem_text(v_title, p_description);

  update public.problems p
  set title       = v_title,
      title_i18n  = case when v_title = p.title then p.title_i18n end,
      description = case when p_description is null then p.description
                         else nullif(btrim(p_description), '') end
  where p.id = v_problem.id
  returning * into v_problem;

  return v_problem;
end;
$$;

comment on function public.edit_problem_text(uuid, text, text) is
  'The office corrects any task''s title and description; a new title takes the translations off, a null description is left alone (20261119140000).';

revoke all on function public.edit_problem_text(uuid, text, text) from public, anon;
grant execute on function public.edit_problem_text(uuid, text, text) to authenticated;
