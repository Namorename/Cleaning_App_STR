-- Rollback of 20261118200000_manager_boards (manager boards). A WRITE to the cloud: only on the
-- owner's word or a failed probe of the rollout, never in 03:00–04:40 UTC.
--
-- Order (docs/rollout/manager-boards-1118.md «Откат»):
--   0. the code that reads the boards goes back first: republish the OTA groups before it
--      (preview №22 74ec8993-4841-4fde-83a1-bdee503120c4, field №22
--      d8af26cb-9b6a-4eb6-87f5-be38de83dcf0), `git revert` the branch's commits in main and wait
--      for Vercel READY. The older code never reads these tables.
--   1. this file, one statement:
--        npx supabase db query --linked -f docs/one-off-writes/manager-boards-rollback.sql
--   2. npx supabase migration repair --status reverted 20261118200000 --linked
--
-- The migration only added: four tables, their policies and sixteen functions. Nothing that
-- existed before is touched here either. The boards hold the managers' own words: while any
-- board exists this refuses — export them first (the rollout record says how), then empty the
-- four tables by the owner's word, then run this again.
do $$
begin
  perform set_config('lock_timeout', '3s', true);

  if exists (select 1 from public.manager_boards) then
    raise exception 'manager_boards holds % board(s): export them before the rollback',
      (select count(*) from public.manager_boards);
  end if;

  drop function public.delete_manager_comment(uuid);
  drop function public.save_manager_comment(uuid, uuid, text);
  drop function public.order_manager_steps(uuid, uuid[]);
  drop function public.delete_manager_step(uuid);
  drop function public.set_manager_step_done(uuid, boolean);
  drop function public.save_manager_step(uuid, uuid, text);
  drop function public.manager_step_card(uuid);
  drop function public.duplicate_manager_card(uuid, uuid, text);
  drop function public.set_manager_card_state(uuid, text);
  drop function public.move_manager_card(uuid, text);
  drop function public.save_manager_card(uuid, uuid, text, text, date, bigint, text, text, jsonb);
  drop function public.set_manager_board_archived(uuid, boolean);
  drop function public.save_manager_board(uuid, text);
  drop function public.manager_board_column(text);
  drop function public.manager_card_for_edit(uuid, boolean);
  drop function public.manager_board_for_edit(uuid, boolean);

  drop table public.manager_board_entries;
  drop table public.manager_board_steps;
  drop table public.manager_board_cards;
  drop table public.manager_boards;
end;
$$;
