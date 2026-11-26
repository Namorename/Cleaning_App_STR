-- CORE data of 20261126120000 (owner, 2026-11-26, «А1.2»): every board that existed before the
-- migration becomes its owner's alone. The migration left them shared (the column's first default
-- was true), so nothing changed for anybody until this. A WRITE to the cloud: only on the owner's
-- word, never in 03:00–04:40 UTC; after the migration, main and the OTA.
--
--   npx supabase db query --linked -f docs/one-off-writes/manager-boards-private.sql
--
-- The boards are named by id: the two the cloud held on 2026-11-26 (read by cloud-read, kept in
-- ~/.str-ops/backups/2026-11-26-boards-private/boards.json). Before writing it checks that the
-- shared boards are exactly these two — a board made since is its owner's alone already — and stops
-- otherwise, naming any other shared board for a person to decide. Undo:
-- manager-boards-private-rollback.sql.
do $private$
declare
  c_boards constant uuid[] := array[
    '46c61e02-833b-46de-b641-e77eeb8bef20',
    '75481ee1-4982-4ed6-acd6-44e6cf4cb2a8'
  ]::uuid[];
  v_shared uuid[];
  v_count  integer;
begin
  perform set_config('lock_timeout', '3s', true);

  select coalesce(array_agg(b.id order by b.id), '{}') into v_shared
  from public.manager_boards b
  where b.shared and b.id = any (c_boards);
  if v_shared is distinct from (select array_agg(x order by x) from unnest(c_boards) x) then
    raise exception 'The boards to close are not all shared as expected: %', v_shared;
  end if;
  -- Any other shared board is either one made before the migration and not read on 2026-11-26, or
  -- one its owner made shared since: a person decides, not this script.
  if exists (select 1 from public.manager_boards b where b.shared and b.id <> all (c_boards)) then
    raise exception 'Other boards are shared too: %',
      (select array_agg(b.id order by b.created_at) from public.manager_boards b
       where b.shared and b.id <> all (c_boards));
  end if;

  update public.manager_boards b
  set shared = false
  where b.id = any (c_boards) and b.shared;
  get diagnostics v_count = row_count;
  if v_count <> cardinality(c_boards) then
    raise exception 'Closed % boards, expected %', v_count, cardinality(c_boards);
  end if;
  raise notice 'closed % boards: %', v_count, c_boards;
end;
$private$;
