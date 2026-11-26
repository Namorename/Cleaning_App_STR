-- Undo of manager-boards-private.sql: the two boards that existed before 20261126120000 are
-- shared with the office again, as they were (the state before the write: shared, kept in
-- ~/.str-ops/backups/2026-11-26-boards-private/boards.json). A board its owner or an admin made
-- private or shared since keeps that choice only if it is not one of these two. A WRITE to the
-- cloud: only on the owner's word, never in 03:00–04:40 UTC. Before the migration's own rollback.
--
--   npx supabase db query --linked -f docs/one-off-writes/manager-boards-private-rollback.sql
do $shared$
declare
  c_boards constant uuid[] := array[
    '46c61e02-833b-46de-b641-e77eeb8bef20',
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
