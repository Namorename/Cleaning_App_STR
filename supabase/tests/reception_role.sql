-- The reception, the office's edit of any task, and guest chats from the panel
-- (20261119140000, 20261119141000, 20261119142000, 20261119143000).
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected (owner, 2026-11-19, CORE):
-- - the reception does what a manager does: reads the company's tasks and people, edits any task;
-- - but reads no manager board and writes none, writes nobody's profile but her own and never her
--   role, changes neither the company's switches nor the gates of guest signals; the video limits
--   («Процесс») are hers;
-- - a manager and an admin keep all of it;
-- - the office edits any task's title and description, in any status; a new title drops the
--   translations, a null description stays; a cleaner, a head technician, somebody switched off and
--   another company do not;
-- - chats go on and off by the admin alone, whole: the switch, its tasks, the reading state and
--   queue of the company, and the reading jobs once no company reads chats.
--
-- Fixture ids live under b0a2f5…. Dates are from current_date.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create or replace function pg_temp.refusal(statement text)
returns text language plpgsql as $$
declare
  v_hint text;
begin
  execute statement;
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return case when v_hint like 'serverErrors.%' then v_hint else sqlstate end;
end $$;

create or replace function pg_temp.host() returns uuid language sql immutable as $$
  select 'b0a2f500-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.other_host() returns uuid language sql immutable as $$
  select 'b0a2f500-0000-4000-8000-00000000000b'::uuid $$;
create or replace function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('b0a2f5' || lpad(n::text, 2, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.rita()   returns uuid language sql immutable as $$ select pg_temp.uid(1) $$;
create or replace function pg_temp.mila()   returns uuid language sql immutable as $$ select pg_temp.uid(2) $$;
create or replace function pg_temp.ada()    returns uuid language sql immutable as $$ select pg_temp.uid(3) $$;
create or replace function pg_temp.anna()   returns uuid language sql immutable as $$ select pg_temp.uid(4) $$;
create or replace function pg_temp.hector() returns uuid language sql immutable as $$ select pg_temp.uid(5) $$;
create or replace function pg_temp.rosa()   returns uuid language sql immutable as $$ select pg_temp.uid(6) $$;
create or replace function pg_temp.olga()   returns uuid language sql immutable as $$ select pg_temp.uid(7) $$;
create or replace function pg_temp.as_user(person uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', '{"sub":"' || person || '","role":"authenticated"}', true) $$;
create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;

/** A refusal as a person meets it; the server's role comes back after. */
create or replace function pg_temp.refused_by(person uuid, statement text) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_user(person);
  v := pg_temp.refusal(statement);
  perform pg_temp.as_server();
  return v;
end $$;

create or replace function pg_temp.board() returns uuid language sql immutable as $$
  select 'b0a2f510-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.card() returns uuid language sql immutable as $$
  select 'b0a2f520-0000-4000-8000-000000000001'::uuid $$;
create or replace function pg_temp.task(n integer) returns uuid language sql immutable as $$
  select ('b0a2f530-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

/** Whether a person is the office, and whether a manager or an admin. */
create or replace function pg_temp.office(person uuid) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_user(person);
  select public.is_manager()::text || ' ' || public.is_full_manager()::text into v;
  perform pg_temp.as_server();
  return v;
end $$;

/** What a person reads of the company's boards: boards, cards, steps, journal lines. */
create or replace function pg_temp.board_reads(person uuid) returns text language plpgsql as $$
declare
  v text;
begin
  perform pg_temp.as_user(person);
  select (select count(*) from public.manager_boards where host_id = pg_temp.host()) || ' ' ||
         (select count(*) from public.manager_board_cards where host_id = pg_temp.host()) || ' ' ||
         (select count(*) from public.manager_board_steps where host_id = pg_temp.host()) || ' ' ||
         (select count(*) from public.manager_board_entries where host_id = pg_temp.host())
    into v;
  perform pg_temp.as_server();
  return v;
end $$;

/** Every write a person could try on the board and its card, each with its refusal. */
create or replace function pg_temp.board_writes(person uuid) returns text language plpgsql as $$
declare
  v text[];
begin
  perform pg_temp.as_user(person);
  v := array[
    pg_temp.refusal(format('select public.save_manager_board(%L, ''x'')', 'b0a2f510-0000-4000-8000-000000000009')),
    pg_temp.refusal(format('select public.save_manager_board(%L, ''x'')', pg_temp.board())),
    pg_temp.refusal(format('select public.set_manager_board_archived(%L, true)', pg_temp.board())),
    pg_temp.refusal(format('select public.save_manager_card(%L, %L, ''x'', '''', null, null, null, ''open'')', 'b0a2f520-0000-4000-8000-000000000009', pg_temp.board())),
    pg_temp.refusal(format('select public.save_manager_card(%L, %L, ''x'', '''', null, null, null)', pg_temp.card(), pg_temp.board())),
    pg_temp.refusal(format('select public.move_manager_card(%L, ''resolved'')', pg_temp.card())),
    pg_temp.refusal(format('select public.set_manager_card_state(%L, ''archived'')', pg_temp.card())),
    pg_temp.refusal(format('select public.duplicate_manager_card(%L, %L, ''x'')', pg_temp.card(), 'b0a2f520-0000-4000-8000-000000000008')),
    pg_temp.refusal(format('select public.set_manager_card_assignee(%L, null)', pg_temp.card())),
    pg_temp.refusal(format('select public.save_manager_step(%L, %L, ''x'')', 'b0a2f540-0000-4000-8000-000000000009', pg_temp.card())),
    pg_temp.refusal(format('select public.save_manager_comment(%L, %L, ''x'')', 'b0a2f550-0000-4000-8000-000000000009', pg_temp.card()))];
  perform pg_temp.as_server();
  return (select string_agg(distinct x, ',') from unnest(v) x);
end $$;

-- ---------- fixtures ----------

insert into public.hosts (id, name) values
  (pg_temp.host(), 'Reception company'), (pg_temp.other_host(), 'Reception elsewhere');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
select pg_temp.uid(u.n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       lower(u.name) || '.reception1119@test.local', 'x', now(), now(),
       jsonb_build_object('full_name', u.name), jsonb_build_object('role', u.role)
from (values (1, 'Rita', 'reception'), (2, 'Mila', 'manager'), (3, 'Ada', 'admin'),
             (4, 'Anna', 'cleaner'), (5, 'Hector', 'head_tech'), (6, 'Rosa', 'reception'),
             (7, 'Olga', 'reception')) u(n, name, role);
update public.profiles
set host_id = case when id = pg_temp.olga() then pg_temp.other_host() else pg_temp.host() end
where id in (select pg_temp.uid(n) from generate_series(1, 7) n);
update public.profiles set is_active = false where id = pg_temp.rosa();

select pg_temp.as_user(pg_temp.mila());
select public.save_manager_board(pg_temp.board(), 'Mila board');
select public.save_manager_card(pg_temp.card(), pg_temp.board(), 'Bathroom', 'plan', null, null, 'blue', 'open', '["Tiles"]');
select public.save_manager_comment('b0a2f550-0000-4000-8000-000000000001', pg_temp.card(), 'Mila note');
select pg_temp.as_server();

-- Anna's report, with the model's translations of its title; an archived one; another company's.
insert into public.problems (id, host_id, reported_by, title, title_i18n, description, status)
values (pg_temp.task(1), pg_temp.host(), pg_temp.anna(), 'Kohoutek kape', '{"en": "Leaking tap", "ru": "Течёт кран"}',
        'Under the sink', 'open'),
       (pg_temp.task(2), pg_temp.host(), pg_temp.anna(), 'Broken chair', null, 'Leg', 'open'),
       (pg_temp.task(3), pg_temp.other_host(), pg_temp.olga(), 'Elsewhere', null, null, 'open');
update public.problems set archived_at = now() where id = pg_temp.task(2);

-- ===========================================================================
-- 1. Who is the office
-- ===========================================================================

select pg_temp.check('1.1 the reception is the office, but not a manager or an admin',
  pg_temp.office(pg_temp.rita()), 'true false');
select pg_temp.check('1.2 a manager and an admin are both',
  pg_temp.office(pg_temp.mila()) || ' / ' || pg_temp.office(pg_temp.ada()), 'true true / true true');
select pg_temp.check('1.3 a cleaner, a head technician and a reception switched off are neither',
  pg_temp.office(pg_temp.anna()) || ' / ' || pg_temp.office(pg_temp.hector()) || ' / ' || pg_temp.office(pg_temp.rosa()),
  'false false / false false / false false');

select pg_temp.as_user(pg_temp.rita());
select pg_temp.check('1.4 the reception reads the company''s tasks and nobody else''s',
  (select count(*)::int from public.problems where id in (pg_temp.task(1), pg_temp.task(2), pg_temp.task(3))), 2);
select pg_temp.check('1.5 and the company''s people, as a manager does',
  (select count(*)::int from public.profiles where host_id = pg_temp.host()), 6);
select pg_temp.as_server();

-- ===========================================================================
-- 2. The office edits any task
-- ===========================================================================

select pg_temp.as_user(pg_temp.rita());
select pg_temp.check('2.1 the reception renames a cleaner''s report; the translations go, the description stays',
  (select p.title || ' | ' || coalesce(p.title_i18n::text, 'none') || ' | ' || p.description
   from public.edit_problem_text(pg_temp.task(1), '  Tap leaks in the kitchen  ') p),
  'Tap leaks in the kitchen | none | Under the sink');
select pg_temp.as_server();
update public.problems set title_i18n = '{"en": "Tap leaks"}' where id = pg_temp.task(1);
select pg_temp.as_user(pg_temp.mila());
select pg_temp.check('2.2 the same title keeps its translations; an empty description clears it',
  (select coalesce(p.title_i18n ->> 'en', 'none') || ' | ' || coalesce(p.description, 'none')
   from public.edit_problem_text(pg_temp.task(1), 'Tap leaks in the kitchen', '') p),
  'Tap leaks | none');
select pg_temp.check('2.3 a manager edits an archived task too',
  (select p.title || ' | ' || p.description from public.edit_problem_text(pg_temp.task(2), 'Broken chair, leg', 'Front leg') p),
  'Broken chair, leg | Front leg');
select pg_temp.check('2.4 a title is needed, and no longer than the limit',
  array[pg_temp.refusal(format('select public.edit_problem_text(%L, ''  '')', pg_temp.task(1))),
        pg_temp.refusal(format('select public.edit_problem_text(%L, %L)', pg_temp.task(1), repeat('x', public.problem_title_max_length() + 1)))],
  array['serverErrors.problemTitleRequired', 'serverErrors.problemTitleTooLong']);
select pg_temp.check('2.5 another company''s task is not found',
  pg_temp.refusal(format('select public.edit_problem_text(%L, ''x'')', pg_temp.task(3))),
  'serverErrors.problemNotFound');
select pg_temp.as_server();

select pg_temp.check('2.6 a cleaner — its reporter — a head technician and a reception switched off may not',
  array[pg_temp.refused_by(pg_temp.anna(), format('select public.edit_problem_text(%L, ''x'')', pg_temp.task(1))),
        pg_temp.refused_by(pg_temp.hector(), format('select public.edit_problem_text(%L, ''x'')', pg_temp.task(1))),
        pg_temp.refused_by(pg_temp.rosa(), format('select public.edit_problem_text(%L, ''x'')', pg_temp.task(1)))],
  array['serverErrors.managerOnly', 'serverErrors.managerOnly', 'serverErrors.managerOnly']);
select pg_temp.check('2.7 another company''s reception does not find it',
  pg_temp.refused_by(pg_temp.olga(), format('select public.edit_problem_text(%L, ''x'')', pg_temp.task(1))),
  'serverErrors.problemNotFound');
select pg_temp.check('2.8 the edits wrote no journal line',
  (select count(*)::int from public.problem_events where problem_id = pg_temp.task(1) and kind <> 'reported'), 0);
select pg_temp.check('2.9 the title the cleaner sees is the office''s',
  (select title from public.problems where id = pg_temp.task(1)), 'Tap leaks in the kitchen');

-- ===========================================================================
-- 3. No manager board for the reception
-- ===========================================================================

select pg_temp.check('3.1 the reception reads no board, card, step or journal line',
  pg_temp.board_reads(pg_temp.rita()), '0 0 0 0');
select pg_temp.check('3.2 and every write on a board is refused to her',
  pg_temp.board_writes(pg_temp.rita()), 'serverErrors.managerOnly');
select pg_temp.check('3.3 a manager and an admin read the board as before',
  pg_temp.board_reads(pg_temp.mila()) || ' / ' || pg_temp.board_reads(pg_temp.ada()), '1 1 1 1 / 1 1 1 1');
select pg_temp.as_user(pg_temp.mila());
select pg_temp.check('3.4 nobody makes the reception a card''s assignee',
  pg_temp.refusal(format('select public.set_manager_card_assignee(%L, %L)', pg_temp.card(), pg_temp.rita())),
  'serverErrors.boardAssigneeInvalid');
select pg_temp.as_server();

-- ===========================================================================
-- 4. Profiles: her own, never her role
-- ===========================================================================

select pg_temp.as_user(pg_temp.rita());
update public.profiles set full_name = 'Anna Renamed' where id = pg_temp.anna();
update public.profiles set full_name = 'Rita R.', role = 'manager', is_active = true where id = pg_temp.rita();
select pg_temp.as_server();
select pg_temp.check('4.1 the reception writes no other profile',
  (select full_name from public.profiles where id = pg_temp.anna()), 'Anna');
select pg_temp.check('4.2 her own name she changes, her role she does not',
  (select full_name || ' ' || role::text from public.profiles where id = pg_temp.rita()), 'Rita R. reception');
select pg_temp.as_user(pg_temp.mila());
update public.profiles set full_name = 'Anna K.' where id = pg_temp.anna();
select pg_temp.as_server();
select pg_temp.check('4.3 a manager still manages the company''s profiles',
  (select full_name from public.profiles where id = pg_temp.anna()), 'Anna K.');

-- ===========================================================================
-- 5. Settings: «Процесс» yes, the company's switches and the gates no
-- ===========================================================================

select pg_temp.as_user(pg_temp.rita());
select pg_temp.check('5.1 the reception changes neither of the company''s switches',
  array[pg_temp.refusal('select public.update_host_settings(p_gallery_allowed => true)'),
        pg_temp.refusal('select public.update_host_settings(p_parallel_start_allowed => true)')],
  array['serverErrors.managerOnly', 'serverErrors.managerOnly']);
select pg_temp.check('5.2 the video limits are hers',
  (select h.video_max_sec from public.update_host_settings(p_video_max_sec => 200) h), 200);
select pg_temp.check('5.3 the gates of guest signals are not, not even taking a kind out of auto',
  pg_temp.refusal('select public.update_signal_settings(p_auto_kinds => ''{}''::text[])'),
  'serverErrors.forbidden');
select pg_temp.as_server();
select pg_temp.as_user(pg_temp.mila());
select pg_temp.check('5.4 a manager changes the switches and takes kinds out of auto as before',
  array[pg_temp.refusal('select public.update_host_settings(p_gallery_allowed => true)'),
        pg_temp.refusal('select public.update_signal_settings(p_auto_kinds => ''{}''::text[])')],
  array['no error', 'no error']);
select pg_temp.as_server();

-- ===========================================================================
-- 6. Guest chats from the panel
-- ===========================================================================

select pg_temp.check('6.1 only an admin switches chats',
  array[pg_temp.refused_by(pg_temp.mila(), 'select public.set_guest_chats(true)'),
        pg_temp.refused_by(pg_temp.rita(), 'select public.set_guest_chats(true)'),
        pg_temp.refused_by(pg_temp.anna(), 'select public.set_guest_chats(true)')],
  array['serverErrors.signalGateAdminOnly', 'serverErrors.signalGateAdminOnly', 'serverErrors.signalGateAdminOnly']);

-- Nobody reads chats yet; the jobs are off.
update public.signal_settings set messages_enabled = false where kind = 'message';
select cron.alter_job(j.jobid, active => false) from cron.job j
where j.jobname in ('read-guest-messages', 'read-guest-messages-0440');
insert into raw.signal_message_state (host_id, provider, events_seen_id) values
  (pg_temp.host(), 'hostaway', 7), (pg_temp.other_host(), 'hostaway', 9);

select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('6.2 on: the switch, its moment and its tasks',
  (select s.messages_enabled::text || ' ' || s.tasks_enabled::text || ' ' || (s.messages_enabled_at is not null)::text
   from public.set_guest_chats(true) s),
  'true true true');
select pg_temp.as_server();
select pg_temp.check('6.3 the company''s reading starts afresh, the other''s is kept',
  (select string_agg(coalesce(events_seen_id::text, '-'), ',' order by host_id)
   from raw.signal_message_state where host_id in (pg_temp.host(), pg_temp.other_host())),
  '9');
select pg_temp.check('6.4 the reading jobs run',
  (select bool_and(j.active) from cron.job j where j.jobname in ('read-guest-messages', 'read-guest-messages-0440')),
  true);

-- The other company reads chats too; queues of both.
insert into public.signal_settings (host_id, kind, messages_enabled, messages_enabled_at)
values (pg_temp.other_host(), 'message', true, now());
insert into raw.signal_message_queue (host_id, provider, external_conversation_id, external_listing_id, via, last_event_at)
values (pg_temp.host(), 'hostaway', 'c1', 'l1', 'webhook', now()),
       (pg_temp.other_host(), 'hostaway', 'c2', 'l2', 'webhook', now());
insert into raw.signal_message_state (host_id, provider, events_seen_id) values (pg_temp.host(), 'hostaway', 11);

select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('6.5 off: the switch and its tasks',
  (select s.messages_enabled::text || ' ' || s.tasks_enabled::text from public.set_guest_chats(false) s),
  'false false');
select pg_temp.as_server();
select pg_temp.check('6.6 the company''s queue and state are emptied, the other''s are kept',
  (select count(*)::text from raw.signal_message_queue where host_id = pg_temp.host()) || ' ' ||
  (select count(*)::text from raw.signal_message_state where host_id = pg_temp.host()) || ' ' ||
  (select count(*)::text from raw.signal_message_queue where host_id = pg_temp.other_host()) || ' ' ||
  (select count(*)::text from raw.signal_message_state where host_id = pg_temp.other_host()),
  '0 0 1 1');
select pg_temp.check('6.7 the jobs run on while another company reads chats',
  (select bool_and(j.active) from cron.job j where j.jobname in ('read-guest-messages', 'read-guest-messages-0440')),
  true);

update public.signal_settings set messages_enabled = false where host_id = pg_temp.other_host() and kind = 'message';
select pg_temp.as_user(pg_temp.ada());
select public.set_guest_chats(true);
select public.set_guest_chats(false);
select pg_temp.as_server();
select pg_temp.check('6.8 and stop once nobody does',
  (select bool_or(j.active) from cron.job j where j.jobname in ('read-guest-messages', 'read-guest-messages-0440')),
  false);

update public.signal_settings set updated_by = null where host_id = pg_temp.host() and kind = 'message';
select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('6.9 off again, or neither on nor off, changes nothing',
  (select coalesce(a.updated_by::text, 'none') || ' ' || coalesce(b.updated_by::text, 'none') || ' ' || a.messages_enabled::text
   from public.set_guest_chats(false) a, public.set_guest_chats(null) b),
  'none none false');
select pg_temp.as_server();

select pg_temp.check('6.10 the helper that empties the queue is nobody''s to call',
  (select bool_or(has_function_privilege(r, 'public.reset_guest_chat_reading(uuid, boolean)', 'EXECUTE'))
   from unnest(array['anon', 'authenticated', 'service_role']) r),
  false);
select pg_temp.check('6.11 the switch and the edit are the signed-in''s, never anon''s',
  (select string_agg(f || ':' || has_function_privilege('anon', f, 'EXECUTE')::text || '/'
                     || has_function_privilege('authenticated', f, 'EXECUTE')::text, ' ' order by f)
   from unnest(array['public.edit_problem_text(uuid, text, text)', 'public.set_guest_chats(boolean)']) f),
  'public.edit_problem_text(uuid, text, text):false/true public.set_guest_chats(boolean):false/true');

-- ===========================================================================
-- 7. The office by role: the reception closes a task as the office
-- ===========================================================================

update public.problems set status = 'open', archived_at = null where id = pg_temp.task(2);
select pg_temp.as_user(pg_temp.rita());
select public.resolve_problem(pg_temp.task(2), null, null);
select pg_temp.as_server();
select pg_temp.check('7.1 a task the reception closes says the office closed it, and who',
  (select p.status::text || ' ' || coalesce(p.closed_how, '-') || ' ' || (p.closed_by = pg_temp.rita())::text
   from public.problems p where p.id = pg_temp.task(2)),
  'resolved manager true');

rollback;
