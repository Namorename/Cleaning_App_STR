-- Read-only (node scripts/cloud-read.mjs docs/rollout/probe_chat_cards_1126.sql): what the one-off
-- cleanup of the cards from chats (docs/one-off-writes/wagner-chat-cards-delete.sql) would touch,
-- by company, as counts and statuses only — no text, no person, no guest.
--
-- A card from a chat is a signal_findings row whose signal is a guest_signals row of kind
-- 'message'. A card a task was made from or linked to (problem_id set) is the task's link to its
-- conversation («Сообщение гостя», the badge «Из чата») and is kept; its labels too.
with chat_cards as (
  select f.id, f.host_id, f.status::text as status, f.problem_id, f.decided_mode
  from public.signal_findings f
  join public.guest_signals s on s.id = f.signal_id
  where s.kind = 'message'
)
select json_build_object(
  'head', (select max(version) from supabase_migrations.schema_migrations),
  'hosts', (select json_agg(json_build_object('host', h.id, 'name_len', char_length(h.name)))
            from public.hosts h),
  'chats_switch', (select json_agg(json_build_object(
                     'host', s.host_id, 'messages_enabled', s.messages_enabled,
                     'tasks_enabled', s.tasks_enabled, 'enabled_at', s.messages_enabled_at))
                   from public.signal_settings s where s.kind = 'message'),
  'jobs', (select json_agg(json_build_object('job', j.jobname, 'active', j.active))
           from cron.job j where j.jobname like 'read-guest-messages%'),
  'cards_by_status', (select json_object_agg(x.k, x.n) from (
                        select host_id || ' ' || status || ' ' || (problem_id is not null)::text as k,
                               count(*) as n
                        from chat_cards group by 1) x),
  'cards_total', (select count(*) from chat_cards),
  'cards_to_delete', (select count(*) from chat_cards where problem_id is null),
  'cards_kept_for_tasks', (select count(*) from chat_cards where problem_id is not null),
  'labels_of_cards_to_delete', (select count(*) from public.issue_facts i
                                where i.finding_id in (select id from chat_cards where problem_id is null)),
  'labels_message_total', (select count(*) from public.issue_facts i where i.origin = 'message'),
  'feedback_of_cards_to_delete', (select count(*) from public.signal_feedback b
                                  where b.finding_id in (select id from chat_cards where problem_id is null)),
  'tasks_from_chats', (select count(*) from public.problems p where p.source = 'message'),
  'tasks_linked_to_kept_cards', (select count(distinct problem_id) from chat_cards where problem_id is not null),
  'review_cards_total', (select count(*) from public.signal_findings f
                         join public.guest_signals s on s.id = f.signal_id where s.kind <> 'message'),
  'boards', (select json_build_object('boards', count(*),
                                      'archived', count(*) filter (where archived_at is not null))
             from public.manager_boards),
  'cards', (select json_object_agg(k, n) from (
              select column_key as k, count(*) as n from public.manager_board_cards group by 1) c)
) as probe;
