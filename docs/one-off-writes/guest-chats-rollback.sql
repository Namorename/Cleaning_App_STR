-- Rollback of 20261110120000_guest_chats (docs/guest-chats.md, docs/rollout/guest-chats-1110.md).
-- Only by the owner's word, never inside 03:00–04:40 UTC. One statement:
--   npx supabase db query --linked -f docs/one-off-writes/guest-chats-rollback.sql
--   npx supabase migration repair --status reverted 20261110120000 --linked
--
-- Removes: the chat jobs, the queue and its state, the message signals (their cards go with them by
-- cascade; the manager's feedback rows keep their counts with finding_id null), the chat episodes,
-- the columns, constraints and functions of the migration. Restores quality_theme_rows and
-- quality_meta as 20261106120000 wrote them (generated, byte for byte).
-- Keeps: problems a manager made from a chat card (source 'message' is valid since 20261030110000);
-- the 'message' row of signal_settings, turned off; the money journal raw.signal_message_runs when
-- a reading spent anything, so a rollback and a second push cannot hand the ceilings back.
do $rollback$
begin
  perform cron.unschedule(j.jobid) from cron.job j
  where j.jobname in ('read-guest-messages', 'read-guest-messages-0440', 'purge-guest-message-links');

  alter table public.signal_settings
    drop constraint if exists signal_settings_messages_switch_on_messages,
    drop constraint if exists signal_settings_messages_need_a_person;
  update public.signal_settings set tasks_enabled = false where kind = 'message' and tasks_enabled;

  delete from public.issue_facts where origin = 'message';
  delete from public.guest_signals where kind = 'message';

  drop function if exists public.apply_guest_message_reading(public.signal_provider, jsonb, jsonb, jsonb, text, timestamptz, bigint, bigint, jsonb, uuid);
  drop function if exists public.finish_guest_conversation(public.signal_provider, text, timestamptz, text, uuid);
  drop function if exists public.guest_message_failure_passes(text);
  drop function if exists public.fail_guest_message_reading(bigint, bigint, jsonb, jsonb);
  drop function if exists public.reserve_guest_message_reading(public.signal_provider, text, bigint, uuid);
  drop function if exists public.guest_conversation_stay(public.signal_provider, text, text, text, uuid);
  drop function if exists public.claim_guest_conversations(public.signal_provider, integer, uuid);
  drop function if exists public.queue_polled_conversations(public.signal_provider, jsonb, uuid);
  drop function if exists public.collect_guest_message_events(public.signal_provider, uuid);
  drop function if exists public.guest_message_state(public.signal_provider, uuid);
  drop function if exists public.guest_message_status();
  drop function if exists public.purge_guest_message_links();

  execute $q$
create or replace function public.quality_theme_rows(
  p_host      uuid,
  p_today     date,
  p_grain     text,
  p_from      date,
  p_prev_from date,
  p_prev_to   date,
  p_property  bigint
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with facts as (
    select f.property_id, f.theme, f.layer, f.month,
           coalesce(f.week, f.month) as day,
           case when p_grain = 'week' then f.week >= p_from else f.month >= p_from end as is_cur,
           case when p_grain = 'week' then f.week between p_prev_from and p_prev_to
                else f.month between p_prev_from and p_prev_to end as is_prev
    from public.issue_facts f
    left join public.guest_signals g on g.id = f.signal_id
    where f.host_id = p_host
      and f.layer <> 'guest_message'
      and not coalesce(g.is_hidden, false)
      and not public.analytics_is_test_listing(f.property_id)
      and (p_property is null or f.property_id = p_property)
  ),
  said as (
    select x.property_id, x.theme,
           count(*) filter (where x.is_cur and x.layer = 'guest_review') as reviews,
           count(*) filter (where x.is_prev and x.layer = 'guest_review') as reviews_prev,
           count(*) filter (where x.is_cur and x.layer = 'guest_review'
                              and x.month <= public.quality_settled_to(p_today)) as reviews_settled,
           count(*) filter (where x.is_cur and x.layer = 'found_at_work') as found,
           count(*) filter (where x.is_prev and x.layer = 'found_at_work') as found_prev,
           count(*) filter (where x.is_cur and x.layer = 'staff_report') as reported,
           count(*) filter (where x.is_prev and x.layer = 'staff_report') as reported_prev,
           count(*) filter (where x.day >= p_today - 90) as recent,
           count(*) filter (where x.day between p_today - 360 and p_today - 91) as older,
           max(x.day) as last_on
    from facts x
    group by x.property_id, x.theme
  ),
  work as (
    select coalesce(l.parent_id, l.id) as property_id, t.theme,
           count(*) filter (where pr.status not in ('resolved', 'cancelled') and pr.archived_at is null)
             as open_work,
           count(*) filter (where pr.created_at >= p_today - 180) as work_180,
           (max(pr.resolved_at) at time zone 'Europe/Prague')::date as closed_on
    from public.problem_themes t
    join public.problems pr on pr.id = t.problem_id
    join public.properties l on l.id = pr.property_id
    where pr.host_id = p_host
      and pr.status <> 'cancelled'
      and (p_property is null or coalesce(l.parent_id, l.id) = p_property)
    group by 1, 2
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'property_id', s.property_id,
           'theme', s.theme,
           'seasonal', th.is_seasonal,
           'reviews', s.reviews,
           'reviews_prev', s.reviews_prev,
           'reviews_settled', s.reviews_settled,
           'found', s.found,
           'found_prev', s.found_prev,
           'reported', s.reported,
           'reported_prev', s.reported_prev,
           'recent', s.recent,
           'older', s.older,
           'last_on', s.last_on,
           'open_work', coalesce(w.open_work, 0),
           'work_180', coalesce(w.work_180, 0),
           'closed_on', w.closed_on
         ) order by s.property_id, th.sort_order), '[]'::jsonb)
  from said s
  join public.issue_themes th on th.code = s.theme
  left join work w on w.property_id = s.property_id and w.theme = s.theme
$$;
$q$;
  execute $q$
create or replace function public.quality_meta(
  p_host   uuid,
  p_window text,
  p_today  date,
  p_b_grain text,
  p_b_from  date,
  p_b_prev_from date,
  p_b_prev_to   date,
  p_rate_from   date
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'window', p_window,
    'today', p_today,
    'grain', p_b_grain,
    'from', p_b_from,
    'prev_from', p_b_prev_from,
    'prev_to', p_b_prev_to,
    'rating_from', p_rate_from,
    -- Before this day there is no record of repairs: an old episode cannot be
    -- called unanswered.
    'work_from', (select (min(pr.created_at) at time zone 'Europe/Prague')::date
                  from public.problems pr where pr.host_id = p_host),
    -- From this day the bookings we hold are whole: the short windows count stays
    -- from them, and the table keeps the sync window. A percentile, because a few
    -- stray old rows must not read as a year of bookings.
    'held_from', (select percentile_disc(0.01) within group (order by r.departure_date)
                  from public.reservations r
                  where r.host_id = p_host and r.departure_date <= p_today
                    and r.status in ('new', 'modified') and not r.is_block),
    -- Reviews are compared only up to here (quality_settled_to).
    'settled_to', public.quality_settled_to(p_today),
    -- The texts' line: before it the reading labels a review, after it the stream's
    -- findings do, and a comparison across it compares two readers. Null while the
    -- reading is on and follows the new reviews: then one reader stands on both sides.
    'line', (select case when not (s.history_follow and s.history_enabled)
                         then (coalesce(s.notice_published_at, s.texts_enabled_at)
                               at time zone 'Europe/Prague')::date end
             from public.signal_settings s
             where s.host_id = p_host and s.kind = 'review'),
    'city_groups', (select h.quality_city_groups from public.hosts h where h.id = p_host),
    'history', public.quality_history_state(p_host)
  )
$$;
$q$;

  drop function if exists public.guest_messages_shown(uuid);
  drop function if exists public.guest_message_place(public.signal_provider, uuid, text);
  drop function if exists public.signal_message_month_start();
  drop function if exists public.message_theme_finding(text);

  alter table public.issue_facts
    drop constraint if exists issue_facts_message_is_a_chat,
    drop constraint if exists issue_facts_chat_has_no_signal,
    drop column if exists conversation_key,
    drop constraint if exists issue_facts_origin_check;
  alter table public.issue_facts
    add constraint issue_facts_origin_check check (origin in ('stream', 'history'));

  alter table public.signal_findings
    drop constraint if exists signal_findings_link_has_an_end,
    drop column if exists external_conversation_id,
    drop column if exists conversation_link_ends;

  alter table public.guest_signals
    drop constraint if exists guest_signals_phase_is_a_message,
    drop column if exists stay_phase;

  alter table public.signal_settings
    drop column if exists messages_enabled,
    drop column if exists messages_enabled_at,
    drop column if exists message_daily_budget_micro_usd,
    drop column if exists message_month_budget_micro_usd;

  drop table if exists raw.signal_message_queue;
  drop table if exists raw.signal_message_state;
  if not exists (select 1 from raw.signal_message_runs where coalesce(spent_micro_usd, reserved_micro_usd) > 0) then
    drop table raw.signal_message_runs;
  end if;
end
$rollback$;
