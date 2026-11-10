-- May the word «включай темы новых отзывов» be given (docs/rollout/property-quality-1106.md, step 6)?
-- Read-only, counts and dates only:
--
--   node scripts/cloud-read.mjs docs/rollout/follow_readiness.sql
--
-- ready        true when the reading of the past has nothing left (weeks_left 0 in its last run),
--              nothing is running, the tick is active and following is still off;
-- weeks_left   what the last finished run of the reading said is left (0: the past is read);
-- running      runs of the reading under way;
-- tick_active  the tick read-signal-history-tick (it must stay on: following uses it);
-- follow       history_follow now (false before the word);
-- line         the texts' line, a Prague day: the week it falls in is opened again by the word;
-- line_week    that week's state: done (the word reopens it), open (read whole once following);
-- spent / budget  what the reading took and its one-off ceiling, millionths of a dollar.
with s as (
  select * from public.signal_settings where kind = 'review'
),
last_done as (
  select (r.counts ->> 'weeks_left')::integer as weeks_left
  from raw.signal_history_runs r
  where r.part = 'reviews' and r.status = 'done'
  order by r.finished_at desc
  limit 1
),
line as (
  select (coalesce(s.notice_published_at, s.texts_enabled_at) at time zone 'Europe/Prague')::date as day from s
)
select json_build_object(
  'ready', coalesce((select weeks_left from last_done), 1) = 0
           and not exists (select 1 from raw.signal_history_runs r where r.status = 'running')
           and coalesce((select j.active from cron.job j where j.jobname = 'read-signal-history-tick'), false)
           and not coalesce((select history_follow from s), false),
  'weeks_left', (select weeks_left from last_done),
  'running', (select count(*) from raw.signal_history_runs r where r.status = 'running'),
  'tick_active', (select j.active from cron.job j where j.jobname = 'read-signal-history-tick'),
  'follow', (select history_follow from s),
  'line', (select day from line),
  'line_week', (select case when exists (select 1 from raw.signal_history_runs r, line
                                         where r.part = 'reviews' and r.status = 'done'
                                           and line.day between r.slice_start and r.slice_end)
                            then 'done' else 'open' end),
  -- signal_history_spent()'s sum, written out: the function is closed to the reading role.
  'spent', (select coalesce(sum(coalesce(r.spent_micro_usd, r.reserved_micro_usd)), 0)
            from raw.signal_history_runs r where r.part = 'reviews'),
  'budget', (select history_budget_micro_usd from s)
) as out;
