-- CLIENT:Wagnerstays — READ-ONLY copy of what wagner-chat-cards-delete.sql deletes (owner,
-- 2026-11-26, «В2б»): every card from a chat of the company that no task was made from or linked
-- to (signal_findings of a 'message' signal with problem_id null), whole rows, plus the links that
-- the delete loosens (signal_feedback.finding_id goes null; issue_facts.finding_id would cascade
-- and is set aside first). No guest text is stored in these rows (docs/guest-chats.md §3).
--
--   node scripts/cloud-read.mjs docs/one-off-writes/wagner-chat-cards-backup.sql \
--     > ~/.str-ops/backups/2026-11-26-chat-cards/backup.json
--
-- The restore: node docs/one-off-writes/wagner-chat-cards-restore.mjs <backup.json> <restore.sql>,
-- then npx supabase db query --linked -f <restore.sql> (README in the backup folder).
with cards as (
  select f.*
  from public.signal_findings f
  join public.guest_signals s on s.id = f.signal_id
  where s.kind = 'message'
    and f.host_id = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a'
    and f.problem_id is null
)
select json_build_object(
  'taken_at', now(),
  'host', 'ce77c272-c330-4b74-ac98-c7d36cba8b2a',
  'count', (select count(*) from cards),
  'by_status', (select json_object_agg(x.status, x.n)
                from (select status::text as status, count(*) as n from cards group by 1) x),
  'findings', (select coalesce(json_agg(to_jsonb(c) order by c.id), '[]'::json) from cards c),
  'feedback', (select coalesce(json_agg(json_build_object('id', b.id, 'finding_id', b.finding_id) order by b.id), '[]'::json)
               from public.signal_feedback b where b.finding_id in (select id from cards)),
  'labels', (select coalesce(json_agg(json_build_object('id', i.id, 'finding_id', i.finding_id) order by i.id), '[]'::json)
             from public.issue_facts i where i.finding_id in (select id from cards))
) as backup;
