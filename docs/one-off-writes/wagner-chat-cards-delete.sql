-- CLIENT:Wagnerstays — the cards from chats leave «Гости» (owner, 2026-11-26, «В2в»): every card
-- from a chat of the company that no task was made from or linked to is deleted, in any status
-- (waiting for a decision, «уже починено», rejected). Kept:
-- - the cards a task was made from or linked to (problem_id set): they are the task's link to its
--   conversation («Сообщение гостя», «Из чата»), and the owner said tasks keep it; with chats off
--   «Гости» shows no card from chats at all (kindsOf), so they do not show there either;
-- - the labels of chats (issue_facts): a label that named a deleted card is unlinked first
--   (finding_id null) instead of cascading away;
-- - the managers' verdicts on cards (signal_feedback): the foreign key sets their finding_id null;
-- - the cards from reviews, the tasks, the conversations' keys and everything else.
--
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC. Order: chats off
-- (wagner-chats-off.sql), the backup (wagner-chat-cards-backup.sql into
-- ~/.str-ops/backups/2026-11-26-chat-cards/), then this. It stops unless chats are off and the
-- count is the backup's (c_expected below, the count of the read-only probe of 2026-11-26).
--
--   npx supabase db query --linked -f docs/one-off-writes/wagner-chat-cards-delete.sql
--
-- Undo: node docs/one-off-writes/wagner-chat-cards-restore.mjs <backup.json> <restore.sql>, then
-- npx supabase db query --linked -f <restore.sql>.
do $cards$
declare
  c_host     constant uuid := 'ce77c272-c330-4b74-ac98-c7d36cba8b2a';
  c_expected constant integer := 178;
  v_ids      uuid[];
  v_labels   integer;
  v_count    integer;
begin
  perform set_config('lock_timeout', '3s', true);
  if exists (select 1 from public.signal_settings s
             where s.host_id = c_host and s.kind = 'message' and s.messages_enabled) then
    raise exception 'Chats are still on for %: run wagner-chats-off.sql first', c_host;
  end if;

  select coalesce(array_agg(f.id order by f.id), '{}') into v_ids
  from public.signal_findings f
  join public.guest_signals s on s.id = f.signal_id
  where s.kind = 'message' and f.host_id = c_host and f.problem_id is null;
  if cardinality(v_ids) <> c_expected then
    raise exception 'Found % cards from chats to delete, the backup holds %: take the backup again',
      cardinality(v_ids), c_expected;
  end if;

  update public.issue_facts i set finding_id = null where i.finding_id = any (v_ids);
  get diagnostics v_labels = row_count;

  delete from public.signal_findings f where f.id = any (v_ids);
  get diagnostics v_count = row_count;
  if v_count <> c_expected then
    raise exception 'Deleted %, expected %', v_count, c_expected;
  end if;
  raise notice 'deleted % cards from chats; % labels unlinked', v_count, v_labels;
end;
$cards$;
