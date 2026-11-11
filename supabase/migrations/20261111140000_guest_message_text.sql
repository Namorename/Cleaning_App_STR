-- A task from a guest's chat shows the guest's own message (the owner's word of 2026-11-11), read from
-- Hostaway at the moment a manager or the head technician asks, and kept nowhere — as a review's text
-- is read for «Все отзывы» (guest-review-text). docs/guest-message-text.md.
--
-- 1. THE LINK OF A TASK. Until now a card lost its booking and its exact days the moment it was
--    decided (cut_signal_stay_links, the owner's decision of 2026-10-17), and its conversation's
--    number 30 days later (purge_guest_message_links). A card a task was made of now keeps them while
--    the guest's name lives: until the night the name goes from the booking, 91 days after the
--    departure (raw.purge_guest_data, 05:55 UTC; the cut runs at 05:00 the same night).
--      - signal_findings.task_link_ends: that night, set when the card becomes a task
--        (signal_findings_task_link, a trigger: every path that makes one goes through
--        create_signal_problem's update). Only for a signal whose stay is still exact: what was cut
--        before is never brought back, and a task made before this migration keeps its null — the
--        existing links stay as they are.
--      - While it lives, the signal keeps its booking, its days, its time and its id in the PMS
--        (cut_signal_stay_links), its key (purge_signal_data), the conversation's key
--        (purge_guest_message_links); the card keeps the conversation's number; the conversation's
--        line in the queue of chats stays. The night it ends — or the night the booking's name goes,
--        if the stay was shortened since — each of them goes by its own job as before, and the cut
--        erases task_link_ends too: kept, the date would tell the departure's day.
--      - A card with no task is cut as before. A card whose task is undone («ложное срабатывание»)
--        loses its date and is cut by the next night's sweep.
--
-- 2. THE READING. guest-message-text (Edge Function) asks guest_message_target() what to read: the
--    conversation's number and the message's id in the PMS, or its key while it has no id. It then
--    GETs the conversation from Hostaway, finds the message, and answers with it and at most two of
--    the guest's messages around it. The text passes through the function's memory into the answer
--    and nowhere else. The only thing written is how many such reads one person made in ten minutes
--    (raw.message_text_reads, take_message_text_read), as for reviews (20261104200000).
--
--    Who: an active manager, admin or head technician of the company — by task (the head technician
--    reads every task of the company); a card of «Гости» is the office's alone. A technician and a
--    maid never: the text is not theirs to read.
--
-- Additive: a column without a default, a trigger, a raw table, five new functions; three functions
-- replaced with their signatures and grants (their old rules kept for every signal without a task).
-- No grant to a client role. Rollback: docs/one-off-writes/guest-message-text-rollback.sql.

set local lock_timeout = '3s';

-- ===================================================================
-- 1. The link of a task
-- ===================================================================

alter table public.signal_findings
  -- The night the link of a task ends: the signal's booking, days, ids and the conversation are
  -- kept until then (cut_signal_stay_links, purge_signal_data, purge_guest_message_links). Null for
  -- a card without a task, and for a task made before 20261111140000 or after its stay was cut.
  add column task_link_ends date;

comment on column public.signal_findings.task_link_ends is
  'The night the link of the task made of this card ends: 91 days after the departure, when the '
  'guest''s name goes. Until then its signal keeps the booking, the days, the ids in the PMS and the '
  'conversation (20261111140000).';

/**
 * The night a task's link ends: the latest task_link_ends of the signal's cards that are still tasks,
 * or null when none is. Read by the cut and the nightly purges.
 *
 * Internal: no grants.
 */
create or replace function public.signal_task_link_ends(p_signal_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select max(f.task_link_ends)
  from public.signal_findings f
  where f.signal_id = p_signal_id and f.status = 'task_created' and f.task_link_ends is not null
$$;

/**
 * A card becomes a task: its link lives until the night the guest's name goes from the booking —
 * the booking's own departure, else the stay's, else the day the guest sent it, plus 91 days, as
 * raw.purge_guest_data counts them. The conversation's number lives as long. Nothing is set for a
 * signal already cut (its booking and days are gone and do not come back). A card that stops being
 * a task loses the date; one that already was a task keeps what it had.
 *
 * Internal: no grants (a trigger).
 */
create or replace function public.signal_findings_task_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_signal    public.guest_signals;
  v_departure date;
begin
  if new.status <> 'task_created' then
    new.task_link_ends := null;
    return new;
  end if;
  if tg_op = 'UPDATE' and old.status = 'task_created' then
    return new;
  end if;

  select g.* into v_signal from public.guest_signals g where g.id = new.signal_id;
  if v_signal.id is null or not v_signal.stay_exact then
    return new;
  end if;
  select r.departure_date into v_departure
  from public.reservations r
  where r.id = v_signal.reservation_id and r.host_id = v_signal.host_id;

  new.task_link_ends := coalesce(v_departure, v_signal.departure_date,
                                 (v_signal.submitted_at at time zone 'Europe/Prague')::date) + 91;
  if new.external_conversation_id is not null then
    new.conversation_link_ends := greatest(new.conversation_link_ends, new.task_link_ends);
  end if;
  return new;
end;
$$;

create trigger signal_findings_task_link
  before insert or update of status on public.signal_findings
  for each row execute function public.signal_findings_task_link();

/**
 * The cut (20261102100000), with one exception: a signal a task was made of keeps its booking and
 * its days until its task's link ends (signal_task_link_ends), whatever else would cut it — then it
 * is cut like any other. Every other signal is cut exactly as before.
 *
 * Internal: no grants.
 */
create or replace function public.cut_signal_stay_links(p_signal_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cut uuid[];
begin
  if coalesce(cardinality(p_signal_ids), 0) = 0 then
    return 0;
  end if;

  perform 1 from public.guest_signals g
  where g.id = any (p_signal_ids) and g.stay_exact
  order by g.id
  for update;

  with due as (
    select g.id,
           g.arrival_date >= (coalesce(s.notice_published_at, s.texts_enabled_at)
                              at time zone 'Europe/Prague')::date as after_notice
    from public.guest_signals g
    left join public.signal_settings s on s.host_id = g.host_id and s.kind = g.kind
    cross join lateral (select public.signal_task_link_ends(g.id) as ends) t
    where g.id = any (p_signal_ids)
      and g.stay_exact
      and case
            -- A task's link: its night, or the night the booking's name goes if the stay was
            -- shortened since (the very test of raw.purge_guest_data).
            when t.ends is not null then t.ends <= current_date
                                         or exists (select 1 from public.reservations r
                                                    where r.id = g.reservation_id
                                                      and r.departure_date < current_date - 90)
            else public.signal_stay_link_ends(g.kind, g.submitted_at) <= current_date
                 or (not exists (select 1 from public.signal_findings f
                                 where f.signal_id = g.id and f.status = 'candidate')
                     and not ((g.public_text is not null or g.private_text is not null
                               or g.category_comments is not null)
                              and (g.rules_version is null
                                   or (coalesce(s.model_enabled, false)
                                       and g.submitted_at >= s.model_since
                                       and g.analysed_at is null and g.analysis_attempts < 3))))
          end
  ),
  cut as (
    update public.guest_signals g
    set stay_exact              = false,
        stay_after_notice       = due.after_notice,
        reservation_id          = null,
        external_reservation_id = null,
        external_id             = null,
        external_updated_at     = null,
        arrival_date            = date_trunc('month', g.arrival_date::timestamp)::date,
        departure_date          = date_trunc('month', g.departure_date::timestamp)::date,
        submitted_at            = public.signal_month_of(g.submitted_at),
        created_at              = public.signal_month_of(g.created_at),
        analysed_at             = public.signal_month_of(g.analysed_at)
    from due
    where g.id = due.id
    returning g.id
  )
  select coalesce(array_agg(cut.id), '{}') into v_cut from cut;

  if cardinality(v_cut) > 0 then
    update public.signal_findings f
    set created_at = public.signal_month_of(f.created_at),
        -- The link's night is the departure's day + 91: kept past the cut it would tell the day the
        -- cut took. Gone, the purges of the same night take the rest (signal_task_link_ends is null).
        task_link_ends = null
    where f.signal_id = any (v_cut);
  end if;

  return cardinality(v_cut);
end;
$$;

/**
 * The nightly purge (20261030110000), with one exception: a signal whose task's link lives keeps its
 * key and its id in the PMS until the link ends — the message the task shows is found by them. The
 * texts of reviews go exactly as before.
 */
create or replace function public.purge_signal_data()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_erased jsonb;
  v_keys   integer;
begin
  v_erased := public.erase_signal_texts(array(
    select g.id
    from public.guest_signals g
    left join public.signal_settings s on s.host_id = g.host_id and s.kind = g.kind
    where (g.text_purge_after <= current_date
           or g.is_hidden
           or not coalesce(s.texts_enabled, false)
           or exists (select 1 from public.properties p
                      where p.id in (g.property_id, g.room_id) and p.status = 'archived'))
      and (g.public_text is not null or g.private_text is not null or g.category_comments is not null
           or exists (select 1 from public.signal_findings f
                      where f.signal_id = g.id
                        and f.detector <> 'manual'
                        and (f.evidence is not null or f.summary_i18n <> '{}'::jsonb)))));

  update public.guest_signals g
  set external_key        = 'purged:' || g.id::text,
      external_id         = null,
      external_updated_at = null
  where public.signal_retention_ends(g.kind, g.submitted_at) <= current_date
    and g.external_key not like 'purged:%'
    and coalesce(public.signal_task_link_ends(g.id) <= current_date, true);
  get diagnostics v_keys = row_count;

  return v_erased || jsonb_build_object('keys', v_keys);
end;
$$;

/**
 * Nightly (05:20 UTC): what a chat leaves behind ages out (20261110120000), with one exception: while
 * a task's link lives, its signal keeps the conversation's key, its card keeps the conversation's
 * number (set to the link's end when the task was made, signal_findings_task_link), and the
 * conversation keeps its line in the queue. Everything without a task goes as before: the key at the
 * message's 90 days, a card's number 30 days after the decision and never past its 89th day, a
 * conversation nobody wrote in for 90 days.
 */
create or replace function public.purge_guest_message_links()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_signals  integer;
  v_facts    integer;
  v_links    integer;
  v_queue    integer;
begin
  update public.guest_signals g
  set conversation_key = null
  where g.kind = 'message' and g.conversation_key is not null
    and (g.external_key like 'purged:%'
         or public.signal_retention_ends(g.kind, g.submitted_at) <= current_date)
    and coalesce(public.signal_task_link_ends(g.id) <= current_date, true);
  get diagnostics v_signals = row_count;

  update public.issue_facts f
  set conversation_key = null
  where f.conversation_key is not null and f.created_at < now() - interval '90 days';
  get diagnostics v_facts = row_count;

  -- A task's card keeps the number to its link's end; any other decided card 30 days.
  update public.signal_findings f
  set conversation_link_ends = least(f.conversation_link_ends,
                                     case when f.status = 'task_created' and f.task_link_ends is not null
                                          then f.task_link_ends
                                          else (f.decided_at at time zone 'Europe/Prague')::date + 30 end)
  where f.external_conversation_id is not null and f.decided_at is not null
    and f.status <> 'candidate';

  update public.signal_findings f
  set external_conversation_id = null, conversation_link_ends = null
  where f.external_conversation_id is not null and f.conversation_link_ends <= current_date;
  get diagnostics v_links = row_count;

  delete from raw.signal_message_queue q
  where q.state = 'idle' and q.updated_at < now() - interval '90 days'
    and not exists (select 1 from public.signal_findings f
                    where f.host_id = q.host_id
                      and f.external_conversation_id = q.external_conversation_id
                      and f.status = 'task_created'
                      and f.task_link_ends > current_date);
  get diagnostics v_queue = row_count;

  return jsonb_build_object('signals', v_signals, 'facts', v_facts, 'links', v_links, 'queue', v_queue);
end;
$$;

-- ===================================================================
-- 2. The reading
-- ===================================================================

create table raw.message_text_reads (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  window_start timestamptz not null,
  reads        integer not null default 0 check (reads >= 0),
  primary key (user_id, window_start)
);
create index message_text_reads_window_idx on raw.message_text_reads (window_start);
revoke all on raw.message_text_reads from public, anon, authenticated;

comment on table raw.message_text_reads is
  'Reads of guests'' messages from the PMS per person and ten minutes (guest-message-text). Counts '
  'only; kept a day.';

/**
 * Takes one read of a guest's message for a person and says whether it stays within the limit: 60 in
 * the current ten minutes. Each read of a conversation not read a moment ago is one request to
 * Hostaway; a person opening the chat tasks of a morning one by one stays far below it. Counted
 * either way, so a loop keeps failing until its window is over. Windows older than a day go on the
 * way.
 *
 * Only the function calls it, with the id of the person it has already checked: service_role only.
 */
create or replace function public.take_message_text_read(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_limit  constant integer := 60;
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / 600) * 600);
  v_reads  integer;
begin
  if p_user_id is null then
    raise exception 'A read of a guest''s message needs its reader'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.unknown';
  end if;

  delete from raw.message_text_reads where window_start < now() - interval '1 day';

  insert into raw.message_text_reads as r (user_id, window_start, reads)
  values (p_user_id, v_window, 1)
  on conflict (user_id, window_start) do update set reads = r.reads + 1
  returning r.reads into v_reads;

  return v_reads <= c_limit;
end;
$$;

/**
 * What guest-message-text may read for a person, by a task (`p_problem_id`) or by a card of «Гости»
 * (`p_finding_id`), exactly one of the two. The person is the one the function found behind the
 * session token; their role and company are read here, from profiles.
 *
 *   {"status": "forbidden"}  not an active manager, admin or head technician; or a card of «Гости»
 *                            asked by anybody but the office
 *   {"status": "not_found"}  no such task or card of the person's company made from a chat
 *   {"status": "expired"}    the conversation's number or the message's id and key are gone by
 *                            their terms (signal_findings_task_link, purge_guest_message_links)
 *   {"status": "ok", "provider": "hostaway", "conversation_id": "…",
 *    "message_id": "…" | null, "message_key": "<hmac>" | null}
 *
 * Never a text, a name or a booking: this table holds none of them. Reads only.
 */
create or replace function public.guest_message_target(
  p_user_id    uuid,
  p_problem_id uuid default null,
  p_finding_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_person  public.profiles;
  v_office  boolean;
  v_finding public.signal_findings;
  v_signal  public.guest_signals;
begin
  select p.* into v_person from public.profiles p where p.id = p_user_id;
  if v_person.id is null or not v_person.is_active or v_person.host_id is null
     or v_person.role::text not in ('manager', 'admin', 'head_tech') then
    return jsonb_build_object('status', 'forbidden');
  end if;
  v_office := v_person.role::text in ('manager', 'admin');

  if (p_problem_id is null) = (p_finding_id is null) then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_finding_id is not null and not v_office then
    return jsonb_build_object('status', 'forbidden');
  end if;

  if p_finding_id is not null then
    select f.* into v_finding
    from public.signal_findings f
    where f.id = p_finding_id and f.host_id = v_person.host_id;
  else
    select f.* into v_finding
    from public.problems pr
    join public.signal_findings f on f.problem_id = pr.id and f.status = 'task_created'
    where pr.id = p_problem_id and pr.host_id = v_person.host_id and pr.source = 'message';
  end if;
  if v_finding.id is not null then
    select g.* into v_signal
    from public.guest_signals g
    where g.id = v_finding.signal_id and g.host_id = v_finding.host_id and g.kind = 'message';
  end if;
  if v_signal.id is null then
    return jsonb_build_object('status', 'not_found');
  end if;

  if v_finding.external_conversation_id is null
     or v_finding.conversation_link_ends <= current_date
     or (v_signal.external_id is null and v_signal.external_key like 'purged:%') then
    return jsonb_build_object('status', 'expired');
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'provider', v_signal.provider,
    'conversation_id', v_finding.external_conversation_id,
    'message_id', v_signal.external_id,
    'message_key', case when v_signal.external_key like 'purged:%' then null else v_signal.external_key end);
end;
$$;

comment on function public.guest_message_target(uuid, uuid, uuid) is
  'What guest-message-text may read from the PMS for a person: the conversation and the message of a '
  'chat task or card, by role (manager, admin, head technician; «Гости» the office only). Ids only, '
  'never a text (20261111140000).';

-- Who may call what. The function's service role alone counts and asks.
revoke all on function public.take_message_text_read(uuid) from public, anon, authenticated;
grant execute on function public.take_message_text_read(uuid) to service_role;
revoke all on function public.guest_message_target(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.guest_message_target(uuid, uuid, uuid) to service_role;
-- Building blocks and the trigger: no caller but their owner.
revoke all on function public.signal_task_link_ends(uuid) from public, anon, authenticated, service_role;
revoke all on function public.signal_findings_task_link() from public, anon, authenticated, service_role;
-- As before (20261030110000, 20261102100000, 20261110120000); create or replace keeps them.
revoke all on function public.cut_signal_stay_links(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.purge_signal_data() from public, anon, authenticated;
grant execute on function public.purge_signal_data() to service_role;
revoke all on function public.purge_guest_message_links() from public, anon, authenticated;
grant execute on function public.purge_guest_message_links() to service_role;
