-- Chats on (docs/guest-chats.md, docs/rollout/guest-chats-1110.md): the owner's word «включай чаты».
-- A WRITE to the cloud: only on that word, never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/guest-chats-on.sql
--
-- What goes on: the 'message' row's switch (and with it its tasks: a manager's «Создать задание»
-- on a chat card; no kind ever goes automatically — the database refuses auto for messages), a
-- day's ceiling of 150 readings (≈ $0.17 at the worst; the money ceilings are $0.25 a day and $5 a
-- month), and the reading every two minutes outside 03:00–04:40 UTC. The journal is read from two
-- hours back, never further. The stop: docs/one-off-writes/guest-chats-off.sql.
do $on$
declare
  v_host uuid := public.default_host_id();
begin
  insert into public.signal_settings (host_id, kind, messages_enabled, messages_enabled_at, tasks_enabled,
                                      daily_model_cap)
  values (v_host, 'message', true, now(), true, 150)
  on conflict (host_id, kind) do update
    set messages_enabled = true, messages_enabled_at = now(), tasks_enabled = true;

  delete from raw.signal_message_state where host_id = v_host;

  perform cron.alter_job(j.jobid, active => true)
  from cron.job j
  where j.jobname in ('read-guest-messages', 'read-guest-messages-0440');
end;
$on$;
