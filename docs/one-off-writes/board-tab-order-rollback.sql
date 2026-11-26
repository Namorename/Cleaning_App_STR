-- Rollback of 20261126160000_board_tab_order (a person's own order of the board tabs; the
-- migration's head comment). One statement, so `supabase db query --linked -f` takes it whole; then
-- `npx supabase migration repair --status reverted 20261126160000 --linked`.
--
-- Order: the panel first (main back: the switcher reads the table and calls the function — though
-- a panel left on the new code only falls back to the default order when they are gone), then this.
-- What it undoes: the table, its policies and trigger, save_board_tab_order and board_tab_ids_valid.
-- Nothing that existed before the migration is touched.
--
-- What it cannot undo: the orders people saved are gone with the table; everyone sees the tabs in
-- the default order again, as before the migration.
do $undo$
begin
  perform set_config('lock_timeout', '3s', true);
  if to_regclass('public.board_tab_orders') is null then
    raise notice '20261126160000 is not in this database: nothing to undo';
    return;
  end if;

  drop function if exists public.save_board_tab_order(text[]);
  drop table public.board_tab_orders;
  drop function if exists public.board_tab_ids_valid(text[]);
end
$undo$;
