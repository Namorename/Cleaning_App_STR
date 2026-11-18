-- Undo of manager-cards-owner-assignee.sql: the cards it gave to their board's owner are left
-- without an assignee again. A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/manager-cards-owner-assignee-rollback.sql
--
-- Exactly those cards: made before the migration (c_migrated, the moment 20261118230000 reached the
-- cloud — filled in at the rollout, docs/rollout/manager-card-assignee-1118.md), still with the
-- board's owner as the assignee, and never given by a person (no line «assignee changed»). A card
-- made after the migration is its owner's by the server, not by the script, and is left as it is;
-- so is every card a person assigned or cleared since.
--
-- Before the migration itself is rolled back (manager-card-assignee-rollback.sql), not after: the
-- column goes with it.
do $$
declare
  c_migrated constant timestamptz := null;  -- the moment of the db push, e.g. '2026-11-18 23:10:00+00'
  v_count integer;
begin
  perform set_config('lock_timeout', '3s', true);

  if c_migrated is null then
    raise exception 'Fill in c_migrated: the moment migration 20261118230000 reached the cloud';
  end if;

  update public.manager_board_cards c
  set assignee_id = null
  from public.manager_boards b
  where b.id = c.board_id
    and c.assignee_id = b.owner_id
    and c.created_at < c_migrated
    and not exists (
      select 1 from public.manager_board_entries e
      where e.card_id = c.id and e.kind = 'assignee_changed'
    );
  get diagnostics v_count = row_count;
  raise notice 'cards left without an assignee again: %', v_count;
end;
$$;
