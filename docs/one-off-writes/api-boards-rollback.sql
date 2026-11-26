-- Rollback of 20261126140000_api_boards (docs/api-v1.md; docs/manager-boards.md «API v1»). One
-- statement, so `supabase db query --linked -f` takes it whole; then
-- `npx supabase migration repair --status reverted 20261126140000 --linked`. A WRITE to the cloud:
-- only on the owner's word.
--
-- Order: the code first — the functions api and mcp redeployed from a main without the boards'
-- routes and tools, the panel back — then this; a deployed api that still routes /v1/boards would
-- answer 500 once the functions are gone.
--
-- What it undoes: the three api_v1_* functions and their four helpers go; the two scopes leave the
-- registry, and a key that holds one by hand (a custom key, or one ticked in) loses it — the key
-- keeps everything else, and the count of keys touched is printed. The cards made through the API
-- stay on their boards: they are the office's cards like any other (created_by is the key's maker).
do $undo$
declare
  v_keys integer;
begin
  perform set_config('lock_timeout', '3s', true);
  if to_regprocedure('public.api_v1_create_board_card(text, text, text, text, uuid, text, uuid, text, text, '
                     'date, bigint, text, jsonb)') is null then
    raise notice '20261126140000 is not in this database: nothing to undo';
    return;
  end if;

  drop function if exists public.api_v1_create_board_card(text, text, text, text, uuid, text, uuid, text, text,
                                                          date, bigint, text, jsonb);
  drop function if exists public.api_v1_list_board_cards(text, uuid, uuid, uuid, bigint, boolean, timestamptz,
                                                         timestamptz, uuid, integer);
  drop function if exists public.api_v1_list_boards(text, text, boolean, timestamptz, uuid, integer);
  drop function if exists public.api_board_card_json(public.manager_board_cards);
  drop function if exists public.api_board_json(public.manager_boards);
  drop function if exists public.api_board_column_name(public.manager_board_columns);
  drop function if exists public.api_board_visible(public.api_context, public.manager_boards);

  update public.api_keys k
  set scopes = array(select s from unnest(k.scopes) s where s not in ('boards:read', 'boards:create_cards'))
  where k.scopes && array['boards:read', 'boards:create_cards']::text[];
  get diagnostics v_keys = row_count;
  raise notice 'keys that held a boards scope by hand: %', v_keys;

  delete from public.api_scopes where id in ('boards:read', 'boards:create_cards');
end;
$undo$;
