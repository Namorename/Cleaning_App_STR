-- What chats left behind, wiped (docs/guest-chats.md): only by its own word of the owner, after
-- docs/one-off-writes/guest-chats-off.sql. No text is anywhere to wipe — the labels, the message
-- signals (keys, a phase, a month) and their cards are. Problems a manager made from a card stay
-- (source 'message'), and so do the manager's verdicts in signal_feedback (their finding_id goes
-- null) and the money journal raw.signal_message_runs.
--
--   npx supabase db query --linked -f docs/one-off-writes/guest-chats-labels-wipe.sql
do $wipe$
declare
  v_host uuid := public.default_host_id();
begin
  if coalesce((select s.messages_enabled from public.signal_settings s
               where s.host_id = v_host and s.kind = 'message'), false) then
    raise exception 'Chats are on: turn them off first (guest-chats-off.sql)';
  end if;
  delete from public.issue_facts where host_id = v_host and origin = 'message';
  -- The cards go with their messages (on delete cascade).
  delete from public.guest_signals where host_id = v_host and kind = 'message';
end;
$wipe$;
