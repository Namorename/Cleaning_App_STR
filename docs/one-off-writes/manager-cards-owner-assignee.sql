-- CORE — the cards of the manager boards made before the assignee existed get their board's owner
-- as the assignee (owner, 2026-11-18, stage 2 of docs/manager-boards.md). A WRITE to the cloud: on
-- the owner's word («выкатывай доски» covers it), never in 03:00–04:40 UTC, and LAST — after
-- migration 20261118230000_manager_card_assignee, send-push, main and both OTA groups.
--
--   npx supabase db query --linked -f docs/one-off-writes/manager-cards-owner-assignee.sql
--   undo:  docs/one-off-writes/manager-cards-owner-assignee-rollback.sql, with the ids this answers
--   probe: node scripts/cloud-read.mjs docs/rollout/probe_manager_card_assignee_rows.sql
--
-- Which cards: no assignee, and no line «assignee changed» in the journal — a card cleared by a
-- person has that line and is left alone, and a card made after the migration is its owner's from
-- the start. The owner must still be an active manager or admin of the company (the people a card
-- can be given to); a card of anybody else's board is left without one. Archived and deleted cards
-- too: returned, they are the owner's as any other.
--
-- Nothing is written to the journal and no push is sent: nobody gave the card to anybody; the owner
-- held it all along. It answers the ids it changed: they go into the rollout record
-- (docs/rollout/manager-card-assignee-1118.md), and the undo takes exactly them. Running it twice
-- changes nothing the second time and answers no ids.
--
-- One statement (the CLI's db query takes one).
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
  )
returning c.id;
