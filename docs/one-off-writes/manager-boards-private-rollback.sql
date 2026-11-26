-- Undo of manager-boards-private.sql as run on 2026-11-26 16:36 UTC: the one board it closed
-- (75481ee1…, archived) is shared with the office again, as it was. The other board of before,
-- 46c61e02…, was made private by a person in the panel at 16:33 UTC, before the write, and is not
-- reopened (~/.str-ops/backups/2026-11-26-boards-private/boards.json). A WRITE to the
-- cloud: only on the owner's word, never in 03:00–04:40 UTC. Before the migration's own rollback.
--
--   npx supabase db query --linked -f docs/one-off-writes/manager-boards-private-rollback.sql
do $shared$
declare
  c_boards constant uuid[] := array[
    '75481ee1-4982-4ed6-acd6-44e6cf4cb2a8'
  ]::uuid[];
  v_count integer;
begin
  perform set_config('lock_timeout', '3s', true);
  update public.manager_boards b
  set shared = true
  where b.id = any (c_boards) and not b.shared;
  get diagnostics v_count = row_count;
  raise notice 'shared again: % boards', v_count;
end;
$shared$;
