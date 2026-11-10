-- Chats off (docs/guest-chats.md): the reading stops, cards and chat counts leave the screens at once
-- (the panel and «Качество объектов» read the switch), the queue of conversations is emptied — it
-- held the PMS's ids, never a text. The labels and cards stay, hidden; turning chats on again shows
-- them without a new reading. They go only by docs/one-off-writes/guest-chats-labels-wipe.sql.
--
--   npx supabase db query --linked -f docs/one-off-writes/guest-chats-off.sql
do $off$
declare
  v_host uuid := public.default_host_id();
begin
  update public.signal_settings
  set messages_enabled = false, tasks_enabled = false
  where host_id = v_host and kind = 'message';

  perform cron.alter_job(j.jobid, active => false)
  from cron.job j
  where j.jobname in ('read-guest-messages', 'read-guest-messages-0440');

  delete from raw.signal_message_queue where host_id = v_host;
  delete from raw.signal_message_state where host_id = v_host;
end;
$off$;
