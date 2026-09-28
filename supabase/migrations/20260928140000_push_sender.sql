-- F11, M3b: handing the queue to the sender and settling it (docs/f11-plan.md,
-- «М3 — проект перед кодом», §4 M3 and Ф).
--
-- M3a writes raw.push_outbox. This migration gives the Edge Function send-push
-- what it needs to turn the rows into pushes, and schedules it:
--
-- - claim_push_batch() hands out whole groups — one person, one cleaning or
--   thread — and only when a group's LAST row is due, so a burst of changes to
--   one cleaning becomes one push (the function folds the rows, in TypeScript).
--   What she switched off, a dismissal, a phone that is gone, a thread she may
--   no longer read and free work somebody has since taken are checked here, at
--   the moment of sending, and settled with the reason instead of being handed
--   out. A group whose time ran out is settled as expired. What is handed out
--   is leased for two minutes: a lock alone ends with the RPC, before Expo is
--   even called, and two runs of the sender can overlap (pg_net's 120 s
--   timeout, the retries on 429).
-- - record_push_results() settles what was sent and keeps Expo's ticket for
--   each phone; a send that failed lets the group go for the next run.
-- - claim_push_receipts() / record_push_receipts(): Expo's receipts, asked a
--   quarter of an hour after the send. DeviceNotRegistered in a ticket or a
--   receipt forgets the phone — unless it registered again since that push.
-- - purge_push_history(): a week of settled rows, tickets and the cron's own
--   log (cron.job_run_details is written on every run and cleaned nowhere).
--
-- No text anywhere: the sender writes it in the language handed out with the
-- group (profiles.preferred_language → the phone's → the company's), from the
-- push.* keys (CLAUDE.md, «Исключение одно — текст push»).
--
-- New table and functions, three cron jobs (7 → 10).

set local lock_timeout = '3s';

-- ---------- named constants ----------

create or replace function public.push_lease()
returns interval language sql immutable parallel safe set search_path = ''
as $$ select interval '2 minutes' $$;

comment on function public.push_lease() is
  'How long a handed-out group is the sender''s: longer than one run with its '
  'retries, short enough that a run that died is forgotten within the next few.';

create or replace function public.push_receipt_delay()
returns interval language sql immutable parallel safe set search_path = ''
as $$ select interval '15 minutes' $$;

comment on function public.push_receipt_delay() is
  'Expo has a receipt for a ticket about a quarter of an hour after the send.';

create or replace function public.push_history_kept()
returns interval language sql immutable parallel safe set search_path = ''
as $$ select interval '7 days' $$;

-- ---------- the tickets ----------

create table raw.push_tickets (
  id              bigint generated always as identity primary key,
  -- The queue rows this push carried: a folded group is one push a phone.
  outbox_ids      bigint[] not null,
  recipient_id    uuid not null references public.profiles (id) on delete cascade,
  -- Not a foreign key: the phone may be forgotten while its ticket waits.
  token           text not null,
  status          text not null check (status in ('ok', 'error')),
  ticket_id       text,
  error           text,
  message         text,
  created_at      timestamptz not null default now(),
  receipt_status  text check (receipt_status in ('ok', 'error')),
  receipt_error   text,
  receipt_message text,
  receipt_at      timestamptz,
  constraint push_tickets_ok_has_id check (status <> 'ok' or ticket_id is not null)
);

create index push_tickets_receipt_due_idx on raw.push_tickets (created_at)
  where status = 'ok' and receipt_at is null;
create index push_tickets_created_idx on raw.push_tickets (created_at);

comment on table raw.push_tickets is
  'Expo''s answer for each phone a push went to, and later its receipt '
  '(docs/f11-plan.md, M3). Closed to clients like the rest of raw.';

-- ---------- forgetting a phone that is gone ----------

-- A phone Expo calls unregistered is forgotten — unless it registered again
-- after `p_seen_at`, the moment of the push that found it dead: the same token
-- then belongs to a live install again.
create or replace function public.forget_push_token(p_token text, p_seen_at timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens t
  where t.token = p_token
    and t.updated_at <= p_seen_at
$$;

-- ---------- handing out ----------

create or replace function public.claim_push_batch(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipients uuid[];
  v_keys       text[];
  v_ids        bigint[];
  v_batch      jsonb;
begin
  -- One sender at a time decides what is due; the lease below keeps the next
  -- one off what this one took once the transaction is over.
  perform pg_advisory_xact_lock(hashtext('public.claim_push_batch'));

  -- A group whose last row has outlived its lifetime is settled as a whole:
  -- never sent late, and never half-sent (a cancellation without the
  -- assignment it cancels would tell her about a job she never heard of).
  update raw.push_outbox o
  set settled_at = now(), outcome = 'expired', claimed_until = null
  from (
    select x.recipient_id, x.collapse_key
    from raw.push_outbox x
    where x.settled_at is null
    group by x.recipient_id, x.collapse_key
    having max(x.expire_at) < now()
       and not coalesce(bool_or(x.claimed_until > now()), false)
  ) dead
  where o.recipient_id = dead.recipient_id
    and o.collapse_key = dead.collapse_key
    and o.settled_at is null;

  -- The groups due now: every row of the group due, none of it leased.
  select array_agg(g.recipient_id order by g.due), array_agg(g.collapse_key order by g.due)
  into v_recipients, v_keys
  from (
    select x.recipient_id, x.collapse_key, max(x.send_after) as due
    from raw.push_outbox x
    where x.settled_at is null
    group by x.recipient_id, x.collapse_key
    having max(x.send_after) <= now()
       and not coalesce(bool_or(x.claimed_until > now()), false)
    order by max(x.send_after)
    limit greatest(p_limit, 0)
  ) g;

  if v_recipients is null then
    return '[]'::jsonb;
  end if;

  -- Checked now, not when the event was written.
  update raw.push_outbox o
  set settled_at = now(), outcome = v.outcome, claimed_until = null
  from (
    select x.id,
           case
             when not pr.is_active then 'skipped'
             when not exists (select 1 from public.push_tokens t where t.profile_id = x.recipient_id)
               then 'skipped'
             when x.kind = any (coalesce(pp.muted, '{}')) then 'muted'
             when x.kind = 'chat_message' and not coalesce((
                    select public.chat_participates_as(x.recipient_id, th.kind, th.task_id,
                                                       th.problem_id, th.profile_id)
                    from public.chat_threads th where th.id = x.thread_id), false)
               then 'skipped'
             -- Somebody took it since: telling her it is free would send her
             -- after work that is not there.
             when x.kind = 'cleaning_free' and not exists (
                    select 1 from public.tasks t
                    where t.id = x.task_id and t.status = 'unassigned' and t.assignee_id is null)
               then 'skipped'
           end as outcome
    from raw.push_outbox x
    join unnest(v_recipients, v_keys) as g(recipient_id, collapse_key)
      on g.recipient_id = x.recipient_id and g.collapse_key = x.collapse_key
    join public.profiles pr on pr.id = x.recipient_id
    left join public.push_preferences pp on pp.profile_id = x.recipient_id
    where x.settled_at is null
  ) v
  where o.id = v.id
    and v.outcome is not null;

  -- The rest is the sender's for the length of the lease. Only rows already
  -- due: one written a moment ago waits for its own group.
  with leased as (
    update raw.push_outbox o
    set claimed_until = now() + public.push_lease()
    from unnest(v_recipients, v_keys) as g(recipient_id, collapse_key)
    where o.recipient_id = g.recipient_id
      and o.collapse_key = g.collapse_key
      and o.settled_at is null
      and o.send_after <= now()
    returning o.id
  )
  select array_agg(l.id) into v_ids from leased l;

  if v_ids is null then
    return '[]'::jsonb;
  end if;

  with located as (
    -- The flat a row is about: the cleaning's own, or, for a message about a
    -- report, the report's.
    select o.*,
           coalesce(
             (select t.property_id from public.tasks t where t.id = o.task_id),
             (select pb.property_id from public.problems pb
              where pb.id = (o.params ->> 'problem_id')::uuid)
           ) as property_id
    from raw.push_outbox o
    where o.id = any (v_ids)
  ),
  r as (
    -- And every place a row names: that flat and the two ends of a move.
    select l.*,
           array_remove(array[
             l.property_id,
             (l.params ->> 'from_property')::bigint,
             (l.params ->> 'to_property')::bigint
           ], null) as property_ids
    from located l
  ),
  places as (
    select u.recipient_id, u.collapse_key,
           jsonb_object_agg(p.id::text, jsonb_build_object(
             'name', p.name,
             'hostaway_unit_id', p.hostaway_unit_id,
             'parent', case when par.id is null then null
                            else jsonb_build_object('name', par.name) end)) as places
    from (select distinct r.recipient_id, r.collapse_key, unnest(r.property_ids) as property_id
          from r) u
    join public.properties p on p.id = u.property_id
    left join public.properties par on par.id = p.parent_id
    group by u.recipient_id, u.collapse_key
  ),
  groups as (
    select r.recipient_id, r.collapse_key, max(r.send_after) as due,
           jsonb_agg(jsonb_build_object(
             'id', r.id, 'kind', r.kind, 'task_id', r.task_id, 'thread_id', r.thread_id,
             'property_id', r.property_id, 'params', r.params, 'urgent', r.urgent,
             'created_at', r.created_at)
             order by r.id) as rows
    from r
    group by r.recipient_id, r.collapse_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipient_id', g.recipient_id,
           'collapse_key', g.collapse_key,
           'language', (
             select coalesce(pr.preferred_language,
                             (select t.language from public.push_tokens t
                              where t.profile_id = pr.id and t.language is not null
                              order by t.updated_at desc limit 1),
                             h.default_language,
                             'ru')
             from public.profiles pr
             left join public.hosts h on h.id = pr.host_id
             where pr.id = g.recipient_id),
           'tokens', (
             select coalesce(jsonb_agg(jsonb_build_object('token', t.token, 'platform', t.platform)
                                       order by t.updated_at desc, t.token), '[]'::jsonb)
             from public.push_tokens t where t.profile_id = g.recipient_id),
           'places', coalesce(pl.places, '{}'::jsonb),
           'rows', g.rows)
         order by g.due, g.recipient_id, g.collapse_key), '[]'::jsonb)
  into v_batch
  from groups g
  left join places pl on pl.recipient_id = g.recipient_id and pl.collapse_key = g.collapse_key;

  return v_batch;
end;
$$;

comment on function public.claim_push_batch(integer) is
  'The sender''s: hands out the groups of raw.push_outbox that are due — one '
  'person, one cleaning or thread — with her language, phones and place names, '
  'and leases them; settles what may not go (docs/f11-plan.md, M3).';

-- ---------- settling what was sent ----------

-- p_results: [{ "outbox_ids": [..], "outcome": "sent" | "collapsed" | "skipped"
-- | "failed", "tickets": [{ "token", "status": "ok"|"error", "ticket_id",
-- "error", "message" }] }]. "failed" — Expo did not answer — lets the rows go
-- for the next run, until they expire. A row already settled keeps its first
-- outcome: a repeated answer changes nothing.
create or replace function public.record_push_results(p_results jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_ids    bigint[];
  v_ticket jsonb;
begin
  for v_result in select value from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    select coalesce(array_agg(value::bigint), '{}') into v_ids
    from jsonb_array_elements_text(v_result -> 'outbox_ids');

    if v_result ->> 'outcome' = 'failed' then
      update raw.push_outbox o
      set claimed_until = null
      where o.id = any (v_ids) and o.settled_at is null;
    elsif v_result ->> 'outcome' in ('sent', 'collapsed', 'skipped') then
      update raw.push_outbox o
      set settled_at = now(), outcome = v_result ->> 'outcome', claimed_until = null
      where o.id = any (v_ids) and o.settled_at is null;
    else
      raise exception 'Unknown push outcome %', v_result ->> 'outcome'
        using errcode = 'invalid_parameter_value';
    end if;

    for v_ticket in select value from jsonb_array_elements(coalesce(v_result -> 'tickets', '[]'::jsonb)) loop
      insert into raw.push_tickets (outbox_ids, recipient_id, token, status, ticket_id, error, message)
      select v_ids, o.recipient_id, v_ticket ->> 'token', v_ticket ->> 'status',
             v_ticket ->> 'ticket_id', v_ticket ->> 'error', left(v_ticket ->> 'message', 500)
      from raw.push_outbox o
      where o.id = v_ids[1];

      if v_ticket ->> 'error' = 'DeviceNotRegistered' then
        perform public.forget_push_token(v_ticket ->> 'token', now());
      end if;
    end loop;
  end loop;
end;
$$;

comment on function public.record_push_results(jsonb) is
  'The sender''s: settles the groups it sent and keeps Expo''s ticket for each '
  'phone; a failed send lets the group go again (docs/f11-plan.md, M3).';

-- ---------- receipts ----------

create or replace function public.claim_push_receipts(p_limit integer default 1000)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(t.ticket_id order by t.created_at), '[]'::jsonb)
  from (
    select t.ticket_id, t.created_at
    from raw.push_tickets t
    where t.status = 'ok'
      and t.receipt_at is null
      and t.created_at <= now() - public.push_receipt_delay()
    order by t.created_at
    limit greatest(p_limit, 0)
  ) t
$$;

comment on function public.claim_push_receipts(integer) is
  'The sender''s: the tickets old enough for Expo to have their receipts.';

-- p_receipts: [{ "ticket_id", "status": "ok"|"error", "error", "message" }].
create or replace function public.record_push_receipts(p_receipts jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receipt jsonb;
  v_ticket  raw.push_tickets;
begin
  for v_receipt in select value from jsonb_array_elements(coalesce(p_receipts, '[]'::jsonb)) loop
    update raw.push_tickets t
    set receipt_status = v_receipt ->> 'status',
        receipt_error = v_receipt ->> 'error',
        receipt_message = left(v_receipt ->> 'message', 500),
        receipt_at = now()
    where t.ticket_id = v_receipt ->> 'ticket_id'
      and t.receipt_at is null
    returning t.* into v_ticket;

    if found and v_receipt ->> 'error' = 'DeviceNotRegistered' then
      perform public.forget_push_token(v_ticket.token, v_ticket.created_at);
    end if;
  end loop;
end;
$$;

comment on function public.record_push_receipts(jsonb) is
  'The sender''s: keeps Expo''s receipts; a phone reported gone is forgotten '
  'unless it registered again after the push.';

-- ---------- history ----------

create or replace function public.purge_push_history()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from raw.push_outbox o
  where o.settled_at < now() - public.push_history_kept();

  delete from raw.push_tickets t
  where t.created_at < now() - public.push_history_kept();

  -- pg_cron logs every run and cleans nothing; the sender alone adds 1 440
  -- rows a day (cron.log_run is on).
  delete from cron.job_run_details d
  where d.end_time < now() - public.push_history_kept();
end;
$$;

comment on function public.purge_push_history() is
  'Nightly: a week of the push queue, its tickets and the cron''s own log.';

-- ---------- grants ----------

revoke all on table raw.push_tickets from public, anon, authenticated;

revoke all on function public.push_lease() from public, anon;
revoke all on function public.push_receipt_delay() from public, anon;
revoke all on function public.push_history_kept() from public, anon;
grant execute on function public.push_lease() to authenticated, service_role;
grant execute on function public.push_receipt_delay() to authenticated, service_role;
grant execute on function public.push_history_kept() to authenticated, service_role;

revoke all on function public.forget_push_token(text, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
revoke all on function public.record_push_results(jsonb) from public, anon, authenticated;
revoke all on function public.claim_push_receipts(integer) from public, anon, authenticated;
revoke all on function public.record_push_receipts(jsonb) from public, anon, authenticated;
revoke all on function public.purge_push_history() from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;
grant execute on function public.record_push_results(jsonb) to service_role;
grant execute on function public.claim_push_receipts(integer) to service_role;
grant execute on function public.record_push_receipts(jsonb) to service_role;
grant execute on function public.purge_push_history() to service_role;

-- ---------- the schedule ----------

-- Every minute: the settle time of a push is a minute, and a burst folds
-- inside it. Not every 30 s — the cron's log grows with every run.
select cron.schedule(
  'send-push',
  '* * * * *',
  $$select public.invoke_edge_function('send-push')$$
);

-- Every hour at :05; enqueue_daily_digest writes only in the run inside seven
-- o'clock in Prague, so the change of summer time cannot move the summary.
select cron.schedule(
  'push-daily-digest',
  '5 * * * *',
  $$select public.enqueue_daily_digest()$$
);

select cron.schedule(
  'push-history-purge',
  '40 2 * * *',
  $$select public.purge_push_history()$$
);
