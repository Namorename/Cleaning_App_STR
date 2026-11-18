-- CORE — the cards of the manager boards made before the assignee existed get their board's owner
-- as the assignee (owner, 2026-11-18, stage 2 of docs/manager-boards.md). A WRITE to the cloud: on
-- the owner's word («выкатывай доски» covers it), never in 03:00–04:40 UTC, and LAST — after
-- migration 20261118230000_manager_card_assignee, send-push, main and both OTA groups.
--
--   npx supabase db query --linked -f docs/one-off-writes/manager-cards-owner-assignee.sql
--   undo:  docs/one-off-writes/manager-cards-owner-assignee-rollback.sql
--   probe: node scripts/cloud-read.mjs docs/rollout/probe_manager_card_assignee.sql
--
-- Which cards: no assignee, and no line «assignee changed» in the journal — a card cleared by a
-- person has that line and is left alone, and a card made after the migration is its owner's from
-- the start. The owner must still be an active manager or admin of the company (the people a card
-- can be given to); a card of anybody else's board is left without one. Archived and deleted cards
-- too: returned, they are the owner's as any other.
--
-- Nothing is written to the journal and no push is sent: nobody gave the card to anybody; the owner
-- held it all along. Running it twice writes nothing the second time.
--
-- One statement (the CLI's db query takes one): a do block.
do $$
declare
  v_count integer;
begin
  perform set_config('lock_timeout', '3s', true);

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'manager_board_cards' and column_name = 'assignee_id'
  ) then
    raise exception 'Migration 20261118230000_manager_card_assignee is not in this database';
  end if;

  update public.manager_board_cards c
  set assignee_id = b.owner_id
  from public.manager_boards b
  join public.profiles p on p.id = b.owner_id
  where b.id = c.board_id
    and c.assignee_id is null
    and p.host_id = c.host_id
    and p.is_active
    and p.role in ('manager', 'admin')
    and not exists (
      select 1 from public.manager_board_entries e
      where e.card_id = c.id and e.kind = 'assignee_changed'
    );
  get diagnostics v_count = row_count;
  raise notice 'cards given to their board owner: %', v_count;
end;
$$;
