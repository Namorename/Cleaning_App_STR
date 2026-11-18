-- Manager boards (20261118200000) in the cloud after the migration, read-only:
--   node scripts/cloud-read.mjs docs/rollout/probe_manager_boards_rows.sql
-- How many rows the boards hold (none right after the push), and that no word of theirs ever
-- reached the work log: the journals of cleanings and tasks gained no kind or cause.
select
  (select count(*) from public.manager_boards) as boards,
  (select count(*) from public.manager_board_cards) as cards,
  (select count(*) from public.manager_board_steps) as steps,
  (select count(*) from public.manager_board_entries) as lines,
  (select count(*) from public.manager_board_entries where kind <> 'comment' and body is not null)
    as system_lines_with_words;
