-- The reviews' texts line, before and after guest-signal-texts-line-1102.sql (read only:
-- node scripts/cloud-read.mjs docs/rollout/texts_line_1102.sql). Counts, flags and codes only.
--
-- texts_outside_rule follows review_text_allowed (20261102100000) word for word, inline (the
-- reader may not call the function): an exact stay answers by its arrival, a cut stay by
-- stay_after_notice, or its month while it has none. A cut stay's arrival is the first of its
-- month, so comparing it to the line alone would count the texts of cut November stays
-- wrongly.
with s as (
  select * from public.signal_settings where kind = 'review'
), line as (
  select (coalesce(notice_published_at, texts_enabled_at) at time zone 'Europe/Prague')::date as day from s
), texted as (
  select g.*
  from public.guest_signals g
  where g.kind = 'review'
    and (g.public_text is not null or g.private_text is not null or g.category_comments is not null)
)
select json_build_object(
  'settings', (select json_build_object('texts', texts_enabled, 'tasks', tasks_enabled, 'model', model_enabled,
                                        'sync', sync_enabled, 'auto_kinds', auto_kinds,
                                        'daily_auto_cap', daily_auto_cap, 'texts_enabled_at', texts_enabled_at,
                                        'notice_published_at', notice_published_at)
                 from s),
  'line_day', (select day from line),
  'signals', (select count(*) from public.guest_signals where kind = 'review'),
  'exact', (select count(*) from public.guest_signals where kind = 'review' and stay_exact),
  'november_cut', (select json_build_object(
                     'after', count(*) filter (where stay_after_notice is true),
                     'before', count(*) filter (where stay_after_notice is false),
                     'unsaid', count(*) filter (where stay_after_notice is null))
                   from public.guest_signals
                   where kind = 'review' and not stay_exact and arrival_date = date '2026-11-01'),
  'texts', (select count(*) from texted),
  'texts_by_stay', (select json_build_object(
                      'exact_from_line', count(*) filter (where stay_exact and arrival_date >= (select day from line)),
                      'exact_before_line', count(*) filter (where stay_exact and arrival_date < (select day from line)),
                      'cut_after', count(*) filter (where not stay_exact and stay_after_notice is true),
                      'cut_before_or_unsaid', count(*) filter (where not stay_exact and stay_after_notice is not true))
                    from texted),
  'texts_outside_rule', (select count(*) from texted g
                         where not (
                           coalesce((select texts_enabled from s), false)
                           and (select day from line) is not null
                           and coalesce(case when g.stay_exact then g.arrival_date >= (select day from line)
                                             else coalesce(g.stay_after_notice, g.arrival_date >= (select day from line))
                                        end, false)
                           and (g.text_purge_after is null or g.text_purge_after > current_date)
                           and not g.is_hidden
                           and not exists (select 1 from public.properties p
                                           where p.id in (g.property_id, g.room_id) and p.status = 'archived'))),
  'findings', (select json_object_agg(status, n)
                 from (select status, count(*) as n from public.signal_findings group by status) f),
  'findings_auto', (select count(*) from public.signal_findings where decided_mode = 'auto'),
  'problems_from_signals', (select count(*) from public.problems where source <> 'staff'),
  'messages', (select count(*) from public.guest_signals where kind = 'message'),
  'message_settings', (select count(*) from public.signal_settings where kind = 'message'),
  'last_runs', (select json_agg(json_build_object('stage', stage, 'ran_at', ran_at, 'ok', is_ok,
                                                  'counts', counts, 'errors', errors) order by ran_at desc)
                  from (select * from raw.signal_runs where not (counts ? 'reserved')
                        order by ran_at desc limit 3) r)
) as texts_line_1102;
