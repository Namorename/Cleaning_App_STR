-- The boards' assignee in the cloud, rows, read-only — after migration 20261118230000 only (it reads
-- the column):
--   node scripts/cloud-read.mjs docs/rollout/probe_manager_card_assignee_rows.sql
-- Counts and nothing a person wrote: how many cards, with an assignee and without; how many of those
-- without are left so by a person (a line «assignee changed»), which the data script leaves alone;
-- the journal's assignment lines, none of them with words; the card pushes queued.
select
  (select count(*) from public.manager_board_cards) as cards,
  (select count(*) from public.manager_board_cards where assignee_id is not null) as with_assignee,
  (select count(*) from public.manager_board_cards c
   where c.assignee_id is null
     and not exists (select 1 from public.manager_board_entries e
                     where e.card_id = c.id and e.kind = 'assignee_changed')) as unassigned_untouched,
  (select count(*) from public.manager_board_entries where kind = 'assignee_changed') as assignment_lines,
  (select count(*) from public.manager_board_entries
   where kind <> 'comment' and body is not null) as system_lines_with_words,
  (select count(*) from raw.push_outbox where kind = 'board_card_assigned') as card_pushes;
