-- Texts of reviews without the guest notice (the owner's decisions of
-- 2026-11-01 and 2026-11-02): the notice is deferred and disabled
-- (docs/guest-signals.md §5.5), and texts go on without it. Step 5
-- (20261030110000) made the notice's date a hard gate: no texts without
-- signal_settings.notice_published_at, and texts only for stays from that day.
--
-- The line between the history and the stays whose texts may be kept is now
--
--   coalesce(notice_published_at, texts_enabled_at)
--
-- read as a Prague day: a review keeps a text only if its stay began on or
-- after it. The history before the line keeps its ratings only, as before.
--
-- - signal_settings.texts_enabled_at: the moment texts first went on. Set by
--   update_signal_settings when a call switches texts on and it is still
--   empty — so never ahead of now — and never moved after, as the notice's
--   date is never moved: texts off and on again keep the first day, a pause
--   never opens the history.
-- - notice_published_at stays as it was: the notice may come back, and then
--   its date (set once, not in the future) draws the line.
-- - Reviews only. Messages keep their gate: their texts still need the
--   notice (the owner's decision of 2026-11-02 frees the reviews' texts), so
--   the model, which needs texts, cannot read messages before the notice and
--   the data protection lawyer's opinion. Messages keep no text at all
--   either way (the owner's decision 3 of 2026-10-31).
-- - The check signal_settings_texts_need_notice becomes
--   signal_settings_texts_have_a_line: texts on need the notice, or, for
--   reviews, their first day. A row that keeps texts today has the notice by
--   the old rule; no row is rewritten.
-- - review_text_allowed() and cut_signal_stay_links() read the line instead of
--   the notice. guest_signals.stay_after_notice keeps its name and now says
--   whether the stay began on or after the line, as the cut saw it.
-- - update_signal_settings(): no refusal for the reviews' texts without the
--   notice (serverErrors.signalTextsNeedNotice stays for messages). When the
--   notice gets its first date on another day than the texts' first day, the
--   line moves to it. A stay already cut forgets its side of the old line
--   where that side may now be wrong, and its month answers alone — never
--   later than the real day. Moved later, every text the new line no longer
--   allows is erased at once, with what was drawn from it. Same signature
--   and grants: a caller of the old version lands in this one unchanged.
--
-- Nothing in raw is touched and no grant changes (table_grants.sql, rollout
-- step 5a): signal_settings stays select-only for authenticated, the three
-- functions keep their rights.
--
-- Rollback: docs/one-off-writes/guest-signal-texts-boundary-rollback.sql.
-- The new column takes ACCESS EXCLUSIVE on signal_settings for a moment (no
-- default, no rewrite; the new check reads the table, which had no row in the
-- cloud on 2026-11-01). Push outside 03:00–04:40 UTC.

set local lock_timeout = '3s';

alter table public.signal_settings
  add column texts_enabled_at timestamptz;

alter table public.signal_settings
  drop constraint signal_settings_texts_need_notice;

alter table public.signal_settings
  add constraint signal_settings_texts_have_a_line
    check (not texts_enabled or notice_published_at is not null
           or (kind = 'review' and texts_enabled_at is not null));

/**
 * Whether a review may keep a text at all, by the company's switches — one
 * answer for store_review_texts (what is written) and review_load_state
 * (what sync-guest-signals asks the PMS for).
 *
 * Only stays that began on or after the line: the day the guest notice went
 * live, or, while there is none, the day texts first went on (20261102100000).
 * Not the submission date — Booking takes reviews up to three months after
 * departure. A stay without a known arrival keeps no text. This also keeps
 * the history and the weekly re-read of 100 days from turning old texts into
 * findings. The exact arrival while there is one; after the cut, what it said
 * then. A stay cut before the line had a day says nothing; its month still
 * answers when the whole month came after the line (the first of the month
 * is never later than the real day).
 *
 * Never for a review hidden on the channel, nor for a place in the archive:
 * those keep their ratings only (the owner's decisions of 2026-10-17); nor
 * past the text's 18 months. Never for anything but a review, and only by
 * the reviews' own switches.
 *
 * Internal: no grants.
 */
create or replace function public.review_text_allowed(
  p_review   public.guest_signals,
  p_settings public.signal_settings
)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_review.kind = 'review'
     and p_settings.kind = 'review'
     and coalesce(p_settings.texts_enabled, false)
     and coalesce(p_settings.notice_published_at, p_settings.texts_enabled_at) is not null
     and coalesce(case when p_review.stay_exact
                       then p_review.arrival_date
                            >= (coalesce(p_settings.notice_published_at, p_settings.texts_enabled_at)
                                at time zone 'Europe/Prague')::date
                       else coalesce(p_review.stay_after_notice,
                                     p_review.arrival_date
                                     >= (coalesce(p_settings.notice_published_at, p_settings.texts_enabled_at)
                                         at time zone 'Europe/Prague')::date)
                  end, false)
     and (p_review.text_purge_after is null or p_review.text_purge_after > current_date)
     and not p_review.is_hidden
     and not exists (select 1 from public.properties p
                     where p.id in (p_review.property_id, p_review.room_id) and p.status = 'archived')
$$;

/**
 * The cut (the owner's decision of 2026-10-17, late; 20261030110000 says it
 * all): a settled review, or one at its last day, keeps its place, its
 * rating and its month and loses its exact days and its booking. What it
 * keeps of the texts' line is whether its stay began on or after it
 * (stay_after_notice): the notice's day, or, while there is none, the day
 * texts first went on (20261102100000). Null while the line has no day.
 *
 * Two statements on purpose: the reviews are locked first, in id order, and
 * whether each is settled is read after, in a snapshot that sees what a
 * reading or a decision just committed.
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
    where g.id = any (p_signal_ids)
      and g.stay_exact
      and (public.signal_stay_link_ends(g.kind, g.submitted_at) <= current_date
           or (not exists (select 1 from public.signal_findings f
                           where f.signal_id = g.id and f.status = 'candidate')
               and not ((g.public_text is not null or g.private_text is not null
                         or g.category_comments is not null)
                        and (g.rules_version is null
                             or (coalesce(s.model_enabled, false)
                                 and g.submitted_at >= s.model_since
                                 and g.analysed_at is null and g.analysis_attempts < 3)))))
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
    set created_at = public.signal_month_of(f.created_at)
    where f.signal_id = any (v_cut);
  end if;

  return cardinality(v_cut);
end;
$$;

/**
 * The company's switches. Null means "not part of this call", as in
 * update_host_settings. The gates (texts, model, tasks, the notice) are the
 * admin's: they follow the owner's actions, not a manager's preference. So is
 * auto (the owner's decision of 2026-10-17): only an admin puts a kind into
 * it, and only with its record (≥ 50 decisions, ≥ 90 % in 60 days); a
 * manager may take a kind out — a brake, never an accelerator.
 *
 * The reviews' texts go on without the guest notice (the owner's decisions of
 * 2026-11-01 and 2026-11-02, 20261102100000). The first time they do,
 * texts_enabled_at is set to now: the line of the texts while the notice has
 * no date. The messages' texts still need the notice.
 *
 * Texts off erases the texts kept so far, at once, with what was drawn from
 * them (the owner's decision of 2026-10-17), and takes the model off with
 * them unless the same call asks otherwise (which is then refused). It keeps
 * texts_enabled_at: texts on again keep their line.
 *
 * The notice is deferred. If it comes back, its date is set once and not in
 * the future, and draws the line from then on. Moved later than the texts'
 * first day, the line takes with it every text it no longer allows.
 *
 * One kind of signal a call (P4): `p_kind` null means "the reviews" — the
 * only kind loaded today, and what a caller that says nothing of a kind
 * means. The ceiling on auto's problems a day is a setting of its own (P9),
 * the admin's like the other ceilings.
 */
create or replace function public.update_signal_settings(
  p_sync_enabled        boolean default null,
  p_texts_enabled       boolean default null,
  p_tasks_enabled       boolean default null,
  p_model_enabled       boolean default null,
  p_auto_kinds          text[] default null,
  p_daily_model_cap     integer default null,
  p_min_confidence      numeric default null,
  p_notice_published_at timestamptz default null,
  p_daily_auto_cap      integer default null,
  p_kind                public.guest_signal_kind default null
)
returns public.signal_settings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host       uuid := public.current_host_id();
  v_signal     public.guest_signal_kind := coalesce(p_kind, 'review');
  v_row        public.signal_settings;
  v_kind       text;
  v_record     record;
  v_model      boolean;
  v_old_day    date;
  v_new_day    date;
  v_line_moves boolean;
  v_is_admin   boolean := public.auth_role() = 'admin' and public.is_active_user();
begin
  if not public.is_manager() then
    raise exception 'Only a manager changes guest signal settings'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.forbidden';
  end if;

  insert into public.signal_settings (host_id, kind) values (v_host, v_signal) on conflict do nothing;
  select * into v_row from public.signal_settings
  where host_id = v_host and kind = v_signal
  for update;

  -- The gates and the money are the admin's: the ceiling on model calls and
  -- the confidence floor decide what is paid for and what reaches people;
  -- auto decides what reaches a technician with nobody looking.
  if not v_is_admin and (p_texts_enabled is not null or p_model_enabled is not null
                         or p_tasks_enabled is not null or p_notice_published_at is not null
                         or p_daily_model_cap is not null or p_min_confidence is not null
                         or p_daily_auto_cap is not null
                         or (p_auto_kinds is not null and not (p_auto_kinds <@ v_row.auto_kinds))) then
    raise exception 'Only an admin switches the guest signal gates'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.signalGateAdminOnly';
  end if;

  -- The notice's date is set once, never ahead of now: moving it earlier would
  -- widen the stays whose texts are kept.
  if p_notice_published_at is not null then
    if p_notice_published_at > now()
       or (v_row.notice_published_at is not null
           and p_notice_published_at <> v_row.notice_published_at) then
      raise exception 'The notice date is set once and not in the future'
        using errcode = 'check_violation', hint = 'serverErrors.signalNoticeDateFixed';
    end if;
  end if;
  -- Messages keep their gate (the owner's decision of 2026-11-02 frees the
  -- reviews' texts only): their texts need the notice, and the model reads
  -- messages only after the data protection lawyer's opinion.
  if v_signal <> 'review' and coalesce(p_texts_enabled, v_row.texts_enabled)
     and coalesce(p_notice_published_at, v_row.notice_published_at) is null then
    raise exception 'Texts of messages need the published guest notice'
      using errcode = 'check_violation', hint = 'serverErrors.signalTextsNeedNotice';
  end if;
  -- The notice's first date, on another day than the texts' first day, takes
  -- the line over.
  v_old_day := (v_row.texts_enabled_at at time zone 'Europe/Prague')::date;
  v_new_day := (p_notice_published_at at time zone 'Europe/Prague')::date;
  v_line_moves := coalesce(v_row.notice_published_at is null and v_new_day <> v_old_day, false);
  -- Texts off with nothing said about the model: the model goes off too, it
  -- would have nothing to read.
  v_model := case when p_texts_enabled is false and p_model_enabled is null then false
                  else coalesce(p_model_enabled, v_row.model_enabled) end;
  if v_model and not coalesce(p_texts_enabled, v_row.texts_enabled) then
    raise exception 'The model needs the texts switched on'
      using errcode = 'check_violation', hint = 'serverErrors.signalModelNeedsTexts';
  end if;

  if p_auto_kinds is not null then
    foreach v_kind in array p_auto_kinds loop
      if not (v_kind = any (array['repair', 'safety', 'pests', 'access'])) then
        raise exception 'Kind % never makes a problem', v_kind
          using errcode = 'check_violation', hint = 'serverErrors.signalKindNoTask',
                detail = jsonb_build_object('kind', v_kind)::text;
      end if;
      if not (v_kind = any (v_row.auto_kinds)) then
        select * into v_record
        from public.signal_finding_record(v_host, v_signal, v_kind::public.signal_finding_kind);
        if v_record.decisions < 50 or v_record.approved * 10 < v_record.decisions * 9 then
          raise exception 'Kind % has not earned auto yet', v_kind
            using errcode = 'check_violation', hint = 'serverErrors.signalAutoNotEarned',
                  detail = jsonb_build_object('kind', v_kind, 'decisions', v_record.decisions,
                                              'approved', v_record.approved)::text;
        end if;
      end if;
    end loop;
  end if;

  update public.signal_settings
  set sync_enabled        = coalesce(p_sync_enabled, sync_enabled),
      texts_enabled       = coalesce(p_texts_enabled, texts_enabled),
      -- The first time texts go on their line is drawn: now, never ahead of
      -- it, and never moved after (texts off and on again keep it).
      texts_enabled_at    = case when p_texts_enabled and v_signal = 'review' and texts_enabled_at is null
                                 then now() else texts_enabled_at end,
      tasks_enabled       = coalesce(p_tasks_enabled, tasks_enabled),
      model_enabled       = v_model,
      -- Each time the model goes on it reads back 14 days and no further (the
      -- owner's decision of 2026-10-18 for the first time; the same for a
      -- later one, so a month off never comes back as a month of cards).
      model_since         = case when v_model and not v_row.model_enabled
                                 then now() - interval '14 days' else model_since end,
      auto_kinds          = coalesce(p_auto_kinds, auto_kinds),
      daily_model_cap     = coalesce(p_daily_model_cap, daily_model_cap),
      daily_auto_cap      = coalesce(p_daily_auto_cap, daily_auto_cap),
      min_confidence      = coalesce(p_min_confidence, min_confidence),
      notice_published_at = coalesce(p_notice_published_at, notice_published_at),
      updated_by          = (select auth.uid())
  where host_id = v_host and kind = v_signal
  returning * into v_row;

  -- The line moved to the notice's day. A stay cut to its month kept only
  -- which side of the old line it began on: moved later, a stay after the old
  -- line may be before the new one; moved earlier, a stay before the old line
  -- may be after the new one. Those answers go, and their month answers alone
  -- (review_text_allowed) — never later than the real day. Moved later, every
  -- text the new line no longer allows goes at once, with what was drawn from
  -- it: the history before the line keeps its ratings only.
  if v_line_moves then
    update public.guest_signals g
    set stay_after_notice = null
    where g.host_id = v_host and g.kind = v_signal
      and not g.stay_exact and g.stay_after_notice = (v_new_day > v_old_day);
    if v_new_day > v_old_day then
      perform public.erase_signal_texts(array(
        select g.id from public.guest_signals g
        where g.host_id = v_host and g.kind = v_signal
          and (g.public_text is not null or g.private_text is not null or g.category_comments is not null)
          and not public.review_text_allowed(g, v_row)));
    end if;
  end if;

  -- Texts off: what was kept goes now, not in 18 months. A load running at
  -- this moment stores nothing more (store_review_texts reads the switch);
  -- the nightly purge sweeps whatever raced it.
  if p_texts_enabled is false then
    perform public.erase_signal_texts(array(
      select g.id from public.guest_signals g where g.host_id = v_host and g.kind = v_signal));
  end if;

  -- A review that waited only for a reader this call took away (texts or
  -- the model off) is settled now: its stay goes to its month at once, not
  -- at the nightly sweep.
  perform public.cut_signal_stay_links(array(
    select g.id from public.guest_signals g
    where g.host_id = v_host and g.kind = v_signal and g.stay_exact));

  return v_row;
end;
$$;

-- The rights are those of 20261030110000; create or replace keeps them, and
-- they are said again so this file reads whole.
revoke all on function public.review_text_allowed(public.guest_signals, public.signal_settings) from public, anon, authenticated, service_role;
revoke all on function public.cut_signal_stay_links(uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.update_signal_settings(boolean, boolean, boolean, boolean, text[], integer, numeric, timestamptz, integer, public.guest_signal_kind) from public, anon;
grant execute on function public.update_signal_settings(boolean, boolean, boolean, boolean, text[], integer, numeric, timestamptz, integer, public.guest_signal_kind) to authenticated;
