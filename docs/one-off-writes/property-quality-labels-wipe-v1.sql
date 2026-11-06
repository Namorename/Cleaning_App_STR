-- The labels of themes-v1 go; themes-v2 stays (docs/rollout/property-quality-1106.md).
-- A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
--   npx supabase db query --linked -f docs/one-off-writes/property-quality-labels-wipe-v1.sql
--
-- Refuses unless the panel counts themes-v2 and that reading has no week left: labels paid for
-- cannot be read again by the old version while its weeks stand closed, and this reopens them.
-- The journal's rows stay, with what they cost: the budget is one-off.
do $wipe$
begin
  if not exists (select 1 from public.signal_settings
                 where kind = 'review' and history_shown_detector = 'claude-haiku-5-5@themes-v2') then
    raise exception 'The panel does not count themes-v2';
  end if;
  if coalesce((select (r.counts ->> 'weeks_left')::integer
               from raw.signal_history_runs r
               where r.part = 'reviews' and r.status = 'done'
                 and r.detector = 'claude-haiku-5-5@themes-v2' and r.counts ? 'weeks_left'
               order by r.finished_at desc
               limit 1), 1) > 0 then
    raise exception 'themes-v2 still has weeks to read';
  end if;

  delete from public.issue_facts
  where origin = 'history' and detector = 'claude-haiku-5-5@themes-v1';

  update raw.signal_history_runs
  set status = 'failed', errors = errors || '[{"code": "labels_wiped", "count": 1}]'::jsonb
  where part = 'reviews' and status = 'done' and detector = 'claude-haiku-5-5@themes-v1';
end;
$wipe$;
