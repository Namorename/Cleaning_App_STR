-- Guest chats on and off from the panel (the owner's request of 2026-11-19, CORE;
-- docs/panel-edits-reception-1119.md §4).
--
-- Until now the one switch of chats (signal_settings.messages_enabled of the company's 'message'
-- row, 20261110120000) was turned by two one-off scripts. The owner asked for a setting, and for
-- «off» to stop the source whole: no conversation is read any more — for tasks or for «Качество
-- объектов» — and the money stops with it. set_guest_chats does what those scripts did, for the
-- caller's company:
--
-- - off: the switch and the row's tasks go false; the company's queue and reading state are emptied
--   (the PMS's ids, never a text); the reading jobs stop once no company has chats on. Nothing else
--   is deleted: labels and cards stay hidden, and come back with chats on again.
-- - on: the switch, its moment and the row's tasks go true (the database still refuses an automatic
--   kind for messages); the reading state starts afresh, so the journal is read from shortly before
--   now, never further back; the reading jobs run.
--
-- The admin's alone, as the other gates of guest signals (update_signal_settings). A call that says
-- neither on nor off changes nothing. Repeating the current state changes nothing either.
--
-- raw stays closed to clients (supabase/tests/table_grants.sql: no client-callable function reads
-- or writes raw but one door). The queue and the reading state are emptied by a helper no client
-- may execute; it deletes the company's rows and returns nothing.
--
-- Additive: two new functions.

create function public.reset_guest_chat_reading(p_host uuid, p_queue boolean)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_queue then
    delete from raw.signal_message_queue where host_id = p_host;
  end if;
  delete from raw.signal_message_state where host_id = p_host;
end;
$$;

comment on function public.reset_guest_chat_reading(uuid, boolean) is
  'Helper of set_guest_chats: empties a company''s chat reading state, and its queue when asked; execute revoked from every role (20261119141000).';

revoke all on function public.reset_guest_chat_reading(uuid, boolean)
  from public, anon, authenticated, service_role;

create function public.set_guest_chats(p_enabled boolean)
returns public.signal_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host uuid := public.current_host_id();
  v_row  public.signal_settings;
begin
  if public.auth_role() is distinct from 'admin' then
    raise exception 'Only an admin switches guest chats'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.signalGateAdminOnly';
  end if;

  -- One switch at a time across companies: the reading jobs are shared, and two switches at once
  -- must not leave them off while a company reads chats.
  perform pg_advisory_xact_lock(hashtextextended('set_guest_chats', 0));

  insert into public.signal_settings (host_id, kind) values (v_host, 'message') on conflict do nothing;
  select * into v_row from public.signal_settings
  where host_id = v_host and kind = 'message'
  for update;

  if p_enabled is null or p_enabled = v_row.messages_enabled then
    return v_row;
  end if;

  if p_enabled then
    update public.signal_settings
    set messages_enabled    = true,
        messages_enabled_at = now(),
        tasks_enabled       = true,
        updated_by          = (select auth.uid())
    where host_id = v_host and kind = 'message'
    returning * into v_row;
    -- A queue row a reading wrote while chats were going off is not read now.
    perform public.reset_guest_chat_reading(v_host, true);
    perform cron.alter_job(j.jobid, active => true)
    from cron.job j
    where j.jobname in ('read-guest-messages', 'read-guest-messages-0440') and not j.active;
  else
    update public.signal_settings
    set messages_enabled = false,
        tasks_enabled    = false,
        updated_by       = (select auth.uid())
    where host_id = v_host and kind = 'message'
    returning * into v_row;
    perform public.reset_guest_chat_reading(v_host, true);
    if not exists (select 1 from public.signal_settings s where s.kind = 'message' and s.messages_enabled) then
      perform cron.alter_job(j.jobid, active => false)
      from cron.job j
      where j.jobname in ('read-guest-messages', 'read-guest-messages-0440') and j.active;
    end if;
  end if;

  return v_row;
end;
$$;

comment on function public.set_guest_chats(boolean) is
  'The admin turns the company''s guest chats on or off whole: the switch, its tasks, the reading state and queue, and the reading jobs (20261119141000).';

revoke all on function public.set_guest_chats(boolean) from public, anon;
grant execute on function public.set_guest_chats(boolean) to authenticated;
