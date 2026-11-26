-- CLIENT:Wagnerstays — «Карточки из чатов» off for the company (owner, 2026-11-26, «В2»): what
-- set_guest_chats(false) does when the admin presses the switch, for this company by id — the
-- switch and its tasks off, the company's reading state and queue emptied (the PMS's ids, never a
-- text), the reading jobs off once no company reads chats. No conversation is read and no model is
-- called from now; labels and cards stay (the cards from chats go by wagner-chat-cards-delete.sql).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC. Run it first, then the
-- backup, then the delete: with chats off no card from chats can appear between them.
--
--   npx supabase db query --linked -f docs/one-off-writes/wagner-chats-off.sql
--
-- Undo: the admin turns «Карточки из чатов» (or «Задания из чатов») on in the panel, which is
-- set_guest_chats(true): reading starts again from shortly before that moment.
do $off$
declare
  c_host constant uuid := 'ce77c272-c330-4b74-ac98-c7d36cba8b2a';
  v_count integer;
begin
  perform set_config('lock_timeout', '3s', true);
  if not exists (select 1 from public.hosts h where h.id = c_host) then
    raise exception 'The company % is not in this database', c_host;
  end if;

  -- One switch at a time across companies, as set_guest_chats takes it.
  perform pg_advisory_xact_lock(hashtextextended('set_guest_chats', 0));

  update public.signal_settings s
  set messages_enabled = false, tasks_enabled = false
  where s.host_id = c_host and s.kind = 'message' and (s.messages_enabled or s.tasks_enabled);
  get diagnostics v_count = row_count;

  perform public.reset_guest_chat_reading(c_host, true);
  if not exists (select 1 from public.signal_settings s where s.kind = 'message' and s.messages_enabled) then
    perform cron.alter_job(j.jobid, active => false)
    from cron.job j
    where j.jobname in ('read-guest-messages', 'read-guest-messages-0440') and j.active;
  end if;
  raise notice 'chats off: % row(s) of the switch changed', v_count;
end;
$off$;
