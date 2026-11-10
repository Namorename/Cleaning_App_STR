-- Guest messages (chats) behind one switch (docs/guest-chats.md, 20261110120000).
-- Run: npm run test:rls. Runs inside a transaction and rolls back.
--
-- What is being protected:
--   * off by default: nothing is queued, booked, stored or shown until the
--     'message' row's messages_enabled is on; turning it off hides it again;
--   * the webhook journal is read once, guest messages only, our listings only;
--   * a conversation is read after five quiet minutes, by one tick at a time;
--   * one reading is one call, under the day's calls and the day's and month's
--     money; what is stored has no text: keys, labels, a card without words;
--   * repeats add nothing: a message by its key, an episode by conversation and
--     theme, a waiting card is joined; an open problem makes a duplicate;
--   * a card never becomes a problem by itself: a manager confirms it;
--   * chats count apart from reviews in «Качество объектов»;
--   * no client role runs the job's functions or reads the raw tables.
--
-- Fixture ids live in the 900062xxx range and under b62….
begin;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.raises(label text, stmt text, want_hint text)
returns void language plpgsql as $$
declare
  v_hint  text;
  v_state text;
begin
  begin
    execute stmt;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
    if nullif(v_hint, '') is distinct from want_hint then
      raise exception 'FAIL % — hint %, want % (%)', label, v_hint, want_hint, v_state;
    end if;
    raise notice 'ok  %', label;
    return;
  end;
  raise exception 'FAIL % — no error, want %', label, want_hint;
end $$;

-- A key as read-guest-messages would send it: sha256 of a name stands in for the HMAC.
create or replace function pg_temp.k(t text) returns text language sql as $$
  select encode(sha256(convert_to(t, 'UTF8')), 'hex')
$$;

-- A guest message as the webhook journal keeps it (hostaway-webhook/guest-message.ts).
create or replace function pg_temp.event(p_conv text, p_listing text, p_booking text,
                                         p_incoming integer, p_message text)
returns void language sql as $$
  insert into raw.webhook_events (source, object_type, object_id, event_type, payload, status)
  values ('hostaway', 'conversationMessage', null, 'message.received',
          jsonb_build_object('object', 'conversationMessage', 'event', 'message.received',
                             'data', jsonb_build_object('id', p_message, 'conversationId', p_conv,
                                                        'listingMapId', p_listing,
                                                        'reservationId', p_booking,
                                                        'isIncoming', p_incoming)),
          'skipped')
$$;

insert into public.hosts (id, name, default_language) values
  ('b6200000-0000-4000-8000-00000000000a', 'Chats host A', 'en'),
  ('b6200000-0000-4000-8000-00000000000b', 'Chats host B', 'en');

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b6200001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.chats@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b6200003-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','anna.chats@test.local','x',now(),now(),
   '{"full_name":"Anna"}'::jsonb, '{"role":"cleaner"}'::jsonb);

update public.profiles set host_id = 'b6200000-0000-4000-8000-00000000000a'
where id::text like 'b620000%';

insert into public.properties (id, name, timezone, check_in_time, check_out_time, host_id) values
  (900062001, 'Chats L1', 'Europe/Prague', '15:00', '10:00', 'b6200000-0000-4000-8000-00000000000a'),
  (900062002, 'Chats L2', 'Europe/Prague', '15:00', '10:00', 'b6200000-0000-4000-8000-00000000000a'),
  (900062020, 'Chats other company', 'Europe/Prague', '15:00', '10:00', 'b6200000-0000-4000-8000-00000000000b');

insert into public.reservations
  (id, host_id, property_id, arrival_date, departure_date, status, is_block, guest_name, check_out_time)
values
  (900062101, 'b6200000-0000-4000-8000-00000000000a', 900062001,
   current_date - 1, current_date + 2, 'new', false, 'Synthetic Guest', '10:00'),
  (900062102, 'b6200000-0000-4000-8000-00000000000a', 900062002,
   current_date - 1, current_date + 2, 'cancelled', false, 'Synthetic Guest', '10:00');

do $$
declare
  v_host    uuid := 'b6200000-0000-4000-8000-00000000000a';
  v_manager uuid := 'b6200001-0000-4000-8000-000000000001';
  v_cleaner uuid := 'b6200003-0000-4000-8000-000000000003';
  v_conv    jsonb := jsonb_build_object('external_conversation_id', '7001', 'conversation_key', pg_temp.k('c7001'),
                                        'external_listing_id', '900062001', 'external_unit_id', null,
                                        'external_reservation_id', '900062101', 'channel', 'airbnb');
  v_msgs    jsonb := jsonb_build_array(
                       jsonb_build_object('external_key', pg_temp.k('m1'), 'external_id', '81',
                                          'sent_at', now() - interval '20 minutes', 'phase', 'stay'),
                       jsonb_build_object('external_key', pg_temp.k('m2'), 'external_id', '82',
                                          'sent_at', now() - interval '10 minutes', 'phase', 'stay'));
  v_labels  jsonb := '[{"theme":"hot_water","severity":"high","confidence":0.9,"resolved":false},
                       {"theme":"noise_outside","severity":"normal","confidence":0.8,"resolved":false},
                       {"theme":"wifi","severity":"normal","confidence":0.4,"resolved":false},
                       {"theme":"not_a_theme","severity":"normal","confidence":0.9,"resolved":false}]';
  v_out     jsonb;
  v_run     bigint;
  v_n       integer;
  v_finding public.signal_findings;
  v_problem uuid;
  v_text    text;
begin
  -- ---------------------------------------------------------------- off
  perform pg_temp.check('a company without a message row has no state',
    public.guest_message_state('hostaway', v_host), null::jsonb);
  perform pg_temp.check('off: nothing is collected', public.collect_guest_message_events('hostaway', v_host), 0);
  perform pg_temp.check('off: nothing is claimed', public.claim_guest_conversations('hostaway', 5, v_host), '[]'::jsonb);
  perform pg_temp.check('off: nothing is booked',
    public.reserve_guest_message_reading('hostaway', 'claude-haiku-5-5@themes-v1-msg', 1100, v_host) ->> 'reason', 'off');
  perform pg_temp.raises('off: a reading is refused',
    format('select public.apply_guest_message_reading(%L, %L::jsonb, %L::jsonb, %L::jsonb, %L, now(), null, null, ''{}''::jsonb, %L)',
           'hostaway', v_conv, v_msgs, v_labels, 'claude-haiku-5-5@themes-v1-msg', v_host),
    'serverErrors.signalMessagesOff');

  insert into public.signal_settings (host_id, kind) values (v_host, 'message');
  perform pg_temp.check('the message row starts off', (select messages_enabled from public.signal_settings
                                                        where host_id = v_host and kind = 'message'), false);
  perform pg_temp.check('the day''s money defaults to $0.25', (select message_daily_budget_micro_usd
    from public.signal_settings where host_id = v_host and kind = 'message'), 250000::bigint);

  -- A chat never makes a problem by itself, and the switch is the message row's.
  begin
    update public.signal_settings set auto_kinds = '{repair}' where host_id = v_host and kind = 'message';
    raise exception 'FAIL auto for messages was accepted';
  exception when check_violation then
    raise notice 'ok  auto stays off for messages';
  end;
  begin
    insert into public.signal_settings (host_id, kind, messages_enabled) values (v_host, 'review', true);
    raise exception 'FAIL the switch on a review row was accepted';
  exception when check_violation then
    raise notice 'ok  the switch belongs to the message row';
  end;

  -- ---------------------------------------------------------------- collect
  update public.signal_settings set messages_enabled = true, tasks_enabled = true, messages_enabled_at = now()
  where host_id = v_host and kind = 'message';

  perform pg_temp.event('7001', '900062001', '900062101', 1, '81');
  perform pg_temp.event('7001', '900062001', '900062101', 1, '82');
  perform pg_temp.event('7002', '900062001', '900062101', 0, '83');   -- the host's reply
  perform pg_temp.event('7003', '900062020', null, 1, '84');          -- another company's listing
  perform pg_temp.event('7004', '999999999', null, 1, '85');          -- a listing nobody holds
  perform pg_temp.event('bad id!', '900062001', null, 1, '86');       -- not an id

  perform pg_temp.check('one conversation is queued from six events',
    public.collect_guest_message_events('hostaway', v_host), 1);
  perform pg_temp.check('the journal is read once', public.collect_guest_message_events('hostaway', v_host), 0);
  perform pg_temp.check('the queued conversation waits, by webhook',
    (select state || '/' || via from raw.signal_message_queue where host_id = v_host and external_conversation_id = '7001'),
    'waiting/webhook');
  perform pg_temp.check('the queue holds no text column',
    (select count(*)::integer from information_schema.columns
     where table_schema = 'raw' and table_name = 'signal_message_queue'
       and column_name in ('body', 'text', 'message')), 0);

  -- ---------------------------------------------------------------- claim
  perform pg_temp.check('a conversation still busy is not read',
    public.claim_guest_conversations('hostaway', 5, v_host), '[]'::jsonb);
  update raw.signal_message_queue set last_event_at = now() - interval '6 minutes'
  where host_id = v_host and external_conversation_id = '7001';
  v_out := public.claim_guest_conversations('hostaway', 5, v_host);
  perform pg_temp.check('five quiet minutes: claimed', v_out -> 0 ->> 'external_conversation_id', '7001');
  perform pg_temp.check('first reading has no line yet', v_out -> 0 -> 'read_to', 'null'::jsonb);
  perform pg_temp.check('one tick at a time', public.claim_guest_conversations('hostaway', 5, v_host), '[]'::jsonb);

  -- ---------------------------------------------------------------- stay
  v_out := public.guest_conversation_stay('hostaway', '900062001', null, '900062101', v_host);
  perform pg_temp.check('the stay is found', (v_out ->> 'arrival_date')::date, current_date - 1);
  perform pg_temp.check('the stay is not cancelled', (v_out ->> 'cancelled')::boolean, false);
  perform pg_temp.check('a cancelled booking says so',
    (public.guest_conversation_stay('hostaway', '900062002', null, '900062102', v_host) ->> 'cancelled')::boolean, true);
  perform pg_temp.check('another company''s listing is no stay',
    public.guest_conversation_stay('hostaway', '900062020', null, null, v_host), null::jsonb);

  -- ---------------------------------------------------------------- money
  update public.signal_settings set daily_model_cap = 2 where host_id = v_host and kind = 'message';
  v_out := public.reserve_guest_message_reading('hostaway', 'claude-haiku-5-5@themes-v1-msg', 1100, v_host);
  perform pg_temp.check('a reading is booked', (v_out ->> 'granted')::boolean, true);
  v_run := (v_out ->> 'run_id')::bigint;
  perform pg_temp.check('the second is booked', (public.reserve_guest_message_reading(
    'hostaway', 'claude-haiku-5-5@themes-v1-msg', 1100, v_host) ->> 'granted')::boolean, true);
  perform pg_temp.check('the third is over the day''s calls', public.reserve_guest_message_reading(
    'hostaway', 'claude-haiku-5-5@themes-v1-msg', 1100, v_host) ->> 'reason', 'daily_cap');
  update public.signal_settings set daily_model_cap = 50, message_daily_budget_micro_usd = 3000
  where host_id = v_host and kind = 'message';
  perform pg_temp.check('the day''s money stops a call that would pass it', public.reserve_guest_message_reading(
    'hostaway', 'claude-haiku-5-5@themes-v1-msg', 1100, v_host) ->> 'reason', 'daily_budget');
  update public.signal_settings set message_daily_budget_micro_usd = 250000, message_month_budget_micro_usd = 2500
  where host_id = v_host and kind = 'message';
  perform pg_temp.check('the month''s money stops it too', public.reserve_guest_message_reading(
    'hostaway', 'claude-haiku-5-5@themes-v1-msg', 1100, v_host) ->> 'reason', 'month_budget');
  update public.signal_settings set message_month_budget_micro_usd = 5000000 where host_id = v_host and kind = 'message';
  perform pg_temp.check('the state counts the booked calls',
    (public.guest_message_state('hostaway', v_host) ->> 'calls_today')::integer, 2);

  -- ---------------------------------------------------------------- apply
  v_out := public.apply_guest_message_reading('hostaway', v_conv, v_msgs, v_labels,
                                              'claude-haiku-5-5@themes-v1-msg', now() - interval '10 minutes',
                                              v_run, 950, '{"model_read":1}'::jsonb, v_host);
  perform pg_temp.check('two messages stored', (v_out ->> 'messages')::integer, 2);
  perform pg_temp.check('two labels kept (a known theme, over the floor)', (v_out ->> 'labels')::integer, 2);
  perform pg_temp.check('one label under the floor', (v_out ->> 'unsure')::integer, 1);
  perform pg_temp.check('one card waits for a manager', (v_out ->> 'candidate')::integer, 1);

  perform pg_temp.check('the messages are keys, a phase and no text',
    (select count(*)::integer from public.guest_signals
     where host_id = v_host and kind = 'message' and conversation_key = pg_temp.k('c7001')
       and stay_phase = 'stay' and public_text is null and private_text is null and rating is null), 2);
  perform pg_temp.check('the episodes are chats, one a theme',
    (select string_agg(theme || ':' || origin || ':' || layer, ',' order by theme) from public.issue_facts
     where host_id = v_host and conversation_key = pg_temp.k('c7001')),
    'hot_water:message:guest_message,noise_outside:message:guest_message');
  perform pg_temp.check('an episode of a chat is the building''s and this month''s',
    (select property_id || '/' || (month = date_trunc('month', (now() at time zone 'Europe/Prague'))::date)
     from public.issue_facts where host_id = v_host and theme = 'hot_water' and origin = 'message'),
    '900062001/true');

  select * into v_finding from public.signal_findings f
  where f.host_id = v_host and f.subject = 'hot_water';
  perform pg_temp.check('the card is a repair of hot water, urgent', v_finding.kind || '/' || v_finding.urgency,
                        'repair/high');
  perform pg_temp.check('the card keeps no words of the model',
    v_finding.summary || '|' || v_finding.summary_i18n::text || '|' || coalesce(v_finding.evidence, '-'),
    'hot_water|{}|-');
  perform pg_temp.check('the card names the conversation, for 89 days at most',
    v_finding.external_conversation_id || '/' || (v_finding.conversation_link_ends
      - (now() at time zone 'Europe/Prague')::date), '7001/89');
  perform pg_temp.check('noise makes no card', (select count(*)::integer from public.signal_findings
    where host_id = v_host and kind = 'noise'), 0);
  perform pg_temp.check('the run is done at what it cost',
    (select status || '/' || spent_micro_usd || '/' || (counts ->> 'model_read') from raw.signal_message_runs where id = v_run),
    'done/950/1');
  perform pg_temp.check('the conversation is read up to its last message',
    (select state || '/' || attempts from raw.signal_message_queue where host_id = v_host and external_conversation_id = '7001'),
    'idle/0');
  perform pg_temp.check('the message with the card keeps its day; the other is cut',
    (select string_agg(stay_exact::text, ',' order by submitted_at) from public.guest_signals
     where host_id = v_host and kind = 'message'), 'false,true');

  -- ---------------------------------------------------------------- repeats
  v_out := public.apply_guest_message_reading('hostaway', v_conv, v_msgs, v_labels,
                                              'claude-haiku-5-5@themes-v1-msg', now() - interval '10 minutes',
                                              null, null, '{}'::jsonb, v_host);
  perform pg_temp.check('the same messages again: nothing new', (v_out ->> 'messages')::integer, 0);
  perform pg_temp.check('the waiting card is joined', (v_out ->> 'joined')::integer, 1);
  perform pg_temp.check('still two episodes', (select count(*)::integer from public.issue_facts
    where host_id = v_host and origin = 'message'), 2);
  perform pg_temp.check('still one card', (select count(*)::integer from public.signal_findings
    where host_id = v_host), 1);

  -- ---------------------------------------------------------------- the manager
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform public.approve_signal_finding(v_finding.id, 'No hot water in the bathroom');
  reset role;
  select f.problem_id into v_problem from public.signal_findings f where f.id = v_finding.id;
  perform pg_temp.check('the manager''s click makes the problem, of a message',
    (select source::text || '/' || (source_facts ->> 'mode') from public.problems where id = v_problem), 'message/manager');

  -- The panel learns how the reading goes through the one door into raw:
  -- read-guest-messages journals its ticks as the classify stage of messages.
  perform public.log_signal_run('hostaway', 'message', 'classify', false, '{"read": 1}'::jsonb,
                                '[{"code": "source_rate_limited", "count": 1}]'::jsonb, v_host);
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*)::integer into v_n from public.signal_run_status()
  where kind = 'message' and stage = 'classify' and last_run_at is not null and last_ok_at is null;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check('the panel sees a failed tick of chats through the one door', v_n, 1);

  perform set_config('request.jwt.claims', '', true);

  -- A second conversation about the same fault in the same flat meets the open problem.
  v_out := public.apply_guest_message_reading('hostaway',
    v_conv || jsonb_build_object('external_conversation_id', '7005', 'conversation_key', pg_temp.k('c7005')),
    jsonb_build_array(jsonb_build_object('external_key', pg_temp.k('m5'), 'external_id', '91',
                                         'sent_at', now() - interval '6 minutes', 'phase', 'stay')),
    '[{"theme":"hot_water","severity":"normal","confidence":0.9,"resolved":false}]'::jsonb,
    'claude-haiku-5-5@themes-v1-msg', now(), null, null, '{}'::jsonb, v_host);
  perform pg_temp.check('the open problem makes the new card a duplicate', (v_out ->> 'duplicate')::integer, 1);

  -- The guest says it works again: no work is asked for.
  v_out := public.apply_guest_message_reading('hostaway',
    v_conv || jsonb_build_object('external_conversation_id', '7006', 'conversation_key', pg_temp.k('c7006')),
    jsonb_build_array(jsonb_build_object('external_key', pg_temp.k('m6'), 'external_id', '92',
                                         'sent_at', now() - interval '6 minutes', 'phase', 'arrival_day')),
    '[{"theme":"lock_door","severity":"high","confidence":0.9,"resolved":true}]'::jsonb,
    'claude-haiku-5-5@themes-v1-msg', now(), null, null, '{}'::jsonb, v_host);
  perform pg_temp.check('a fault the guest says is fixed is already fixed', (v_out ->> 'already_fixed')::integer, 1);
  perform pg_temp.check('no problem was made without a manager',
    (select count(*)::integer from public.problems where host_id = v_host and source = 'message'), 1);

  -- ---------------------------------------------------------------- poll
  v_out := public.queue_polled_conversations('hostaway', jsonb_build_array(
    jsonb_build_object('external_conversation_id', '7007', 'external_listing_id', '900062001',
                       'external_reservation_id', '900062101', 'last_guest_at', now() - interval '3 minutes'),
    jsonb_build_object('external_conversation_id', '7001', 'external_listing_id', '900062001',
                       'external_reservation_id', '900062101', 'last_guest_at', now() - interval '10 minutes'),
    jsonb_build_object('external_conversation_id', '7008', 'external_listing_id', '900062020',
                       'external_reservation_id', null, 'last_guest_at', now())), v_host);
  perform pg_temp.check('the poll queues what the webhook missed', v_out, '{"queued": 1, "missed": 1}'::jsonb);
  perform pg_temp.check('the poll is not due again', (public.guest_message_state('hostaway', v_host) ->> 'poll_due')::boolean,
                        false);

  -- ---------------------------------------------------------------- failure
  update raw.signal_message_queue set last_event_at = now() - interval '6 minutes', first_waiting_at = now() - interval '6 minutes'
  where host_id = v_host and external_conversation_id = '7007';
  perform public.claim_guest_conversations('hostaway', 5, v_host);
  perform public.finish_guest_conversation('hostaway', '7007', null, 'source_rate_limited', v_host);
  perform pg_temp.check('a failure waits five quiet minutes, and a passing one spends no attempt',
    (select state || '/' || last_error || '/' || (last_event_at > now() - interval '1 minute') || '/' || attempts
     from raw.signal_message_queue where host_id = v_host and external_conversation_id = '7007'),
    'waiting/source_rate_limited/true/0');
  update raw.signal_message_queue set attempts = 5 where host_id = v_host and external_conversation_id = '7007';
  perform public.finish_guest_conversation('hostaway', '7007', null, 'service_overloaded', v_host);
  perform pg_temp.check('an outage of the model never leaves a conversation for good',
    (select state from raw.signal_message_queue where host_id = v_host and external_conversation_id = '7007'), 'waiting');
  update raw.signal_message_queue set attempts = 5 where host_id = v_host and external_conversation_id = '7007';
  perform public.finish_guest_conversation('hostaway', '7007', null, 'source_bad_row', v_host);
  perform pg_temp.check('five failures of its own and it rests',
    (select state from raw.signal_message_queue where host_id = v_host and external_conversation_id = '7007'), 'idle');

  -- ---------------------------------------------------------------- quality
  v_out := public.quality_theme_rows(v_host, (now() at time zone 'Europe/Prague')::date, 'month',
                                     (date_trunc('month', now()) - interval '2 months')::date,
                                     (date_trunc('month', now()) - interval '5 months')::date,
                                     (date_trunc('month', now()) - interval '3 months')::date, null);
  perform pg_temp.check('chats count apart from reviews',
    (select x ->> 'messages' || '/' || (x ->> 'reviews') || '/' || (x ->> 'recent')
     from jsonb_array_elements(v_out) x where x ->> 'theme' = 'hot_water'), '2/0/0');
  perform pg_temp.check('a theme said only in chats has no day to turn its state by',
    (select coalesce(x ->> 'last_on', 'none') from jsonb_array_elements(v_out) x
     where x ->> 'theme' = 'noise_outside'), 'none');
  perform pg_temp.check('the meta says chats are shown',
    (public.quality_meta(v_host, '3m', current_date, 'month', current_date, current_date, current_date, current_date)
      ->> 'messages_on')::boolean, true);

  -- ---------------------------------------------------------------- off again
  update public.signal_settings set messages_enabled = false, tasks_enabled = false
  where host_id = v_host and kind = 'message';
  v_out := public.quality_theme_rows(v_host, (now() at time zone 'Europe/Prague')::date, 'month',
                                     (date_trunc('month', now()) - interval '2 months')::date,
                                     (date_trunc('month', now()) - interval '5 months')::date,
                                     (date_trunc('month', now()) - interval '3 months')::date, null);
  perform pg_temp.check('off: chats leave the screen', jsonb_array_length(v_out), 0);
  perform pg_temp.check('off: the labels stay, hidden',
    (select count(*)::integer from public.issue_facts where host_id = v_host and origin = 'message'), 4);
  perform pg_temp.check('off: nothing is collected', public.collect_guest_message_events('hostaway', v_host), 0);

  -- ---------------------------------------------------------------- ageing
  update public.signal_findings set decided_at = now() - interval '40 days'
  where host_id = v_host and external_conversation_id is not null and status <> 'candidate';
  update public.issue_facts set created_at = now() - interval '91 days' where host_id = v_host and origin = 'message';
  update raw.signal_message_queue set updated_at = now() - interval '91 days' where host_id = v_host and state = 'idle';
  v_out := public.purge_guest_message_links();
  perform pg_temp.check('a decided card forgets the conversation after 30 days',
    (select count(*)::integer from public.signal_findings
     where host_id = v_host and status <> 'candidate' and external_conversation_id is not null), 0);
  perform pg_temp.check('an episode forgets the conversation after 90 days',
    (select count(*)::integer from public.issue_facts where host_id = v_host and conversation_key is not null), 0);
  perform pg_temp.check('the episodes themselves stay',
    (select count(*)::integer from public.issue_facts where host_id = v_host and origin = 'message'), 4);
  perform pg_temp.check('quiet conversations leave the queue',
    (select count(*)::integer from raw.signal_message_queue where host_id = v_host and state = 'idle'), 0);

  -- ---------------------------------------------------------------- grants
  perform pg_temp.check('a client role runs none of the job''s functions',
    (select count(*)::integer from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and p.proname in ('guest_message_state', 'collect_guest_message_events', 'queue_polled_conversations',
                         'claim_guest_conversations', 'guest_conversation_stay', 'reserve_guest_message_reading',
                         'fail_guest_message_reading', 'finish_guest_conversation', 'apply_guest_message_reading',
                         'purge_guest_message_links', 'message_theme_finding', 'guest_messages_shown')
       and (has_function_privilege('authenticated', p.oid, 'execute')
            or has_function_privilege('anon', p.oid, 'execute'))), 0);
  perform pg_temp.check('the server runs them',
    has_function_privilege('service_role', 'public.apply_guest_message_reading(public.signal_provider, jsonb, jsonb, jsonb, text, timestamptz, bigint, bigint, jsonb, uuid)', 'execute'),
    true);
  perform pg_temp.check('no client reads the raw tables',
    (select count(*)::integer from (values ('raw.signal_message_queue'), ('raw.signal_message_state'),
                                           ('raw.signal_message_runs')) t (name)
     where has_table_privilege('authenticated', t.name, 'select')
        or has_table_privilege('anon', t.name, 'select')), 0);
  perform pg_temp.check('the reading jobs start inactive',
    (select count(*)::integer from cron.job where jobname in ('read-guest-messages', 'read-guest-messages-0440')
       and not active), 2);
  perform pg_temp.check('the reading jobs skip 03:00–04:40 UTC',
    (select string_agg(schedule, ' | ' order by jobname) from cron.job
     where jobname in ('read-guest-messages', 'read-guest-messages-0440')),
    '*/2 0-2,5-23 * * * | 40-58/2 4 * * *');
end $$;

rollback;
