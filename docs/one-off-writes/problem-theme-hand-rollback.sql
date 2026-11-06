-- Takes the manager's hand on a task's theme away (20261106140000).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC, after the panel:
--
--   npx supabase db query --linked -f docs/one-off-writes/problem-theme-hand-rollback.sql
--   npx supabase migration repair --status reverted 20261106140000 --linked
--
-- Themes set by hand stay in problem_themes: the night does not overwrite them, and they are
-- ordinary rows without these functions. To forget them too: delete where source = 'manual'.
drop function if exists public.set_problem_theme(uuid, text);
drop function if exists public.problem_theme(uuid);
