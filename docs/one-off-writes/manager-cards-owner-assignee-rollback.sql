-- Undo of manager-cards-owner-assignee.sql: the cards it gave to their board's owner are left
-- without an assignee again. A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/manager-cards-owner-assignee-rollback.sql
--
-- Exactly those cards: c_ids is filled in with the ids the script answered at the rollout
-- (docs/rollout/manager-card-assignee-1118.md), and of them only a card that still has its board's
-- owner as the assignee and was never given by a person since (no line «assignee changed»). A card
-- made after the migration is its owner's by the server, not by the script, and is never in c_ids.
--
-- Before the migration itself is rolled back (manager-card-assignee-rollback.sql), not after: the
-- column goes with it.
do $$
declare
  c_ids constant uuid[] := null;  -- the ids the script answered, e.g. array['…', '…']::uuid[]
  v_count integer;
begin
  perform set_config('lock_timeout', '3s', true);

  if c_ids is null then
    raise exception 'Fill in c_ids: the ids manager-cards-owner-assignee.sql answered';
  end if;

  update public.manager_board_cards c
  set assignee_id = null
  from public.manager_boards b
  where b.id = c.board_id
    and c.id = any (c_ids)
    and c.assignee_id = b.owner_id
    and not exists (
      select 1 from public.manager_board_entries e
      where e.card_id = c.id and e.kind = 'assignee_changed'
    );
  get diagnostics v_count = row_count;
  raise notice 'cards left without an assignee again: %', v_count;
end;
$$;
