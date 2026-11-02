-- Rollback of 20261102100000_guest_signal_texts_boundary — texts of reviews
-- without the guest notice (docs/rollout-plan-1028.md §9.8). A WRITE to the
-- cloud: only on the owner's word, never in 03:00–04:40 UTC.
--
-- It takes the schema back to 20261030110000: texts need
-- notice_published_at again (the check signal_settings_texts_need_notice and
-- the refusal serverErrors.signalTextsNeedNotice), and review_text_allowed(),
-- cut_signal_stay_links() and update_signal_settings() get their bodies of
-- 20261030110000 back, word for word. Their rights do not change (create or
-- replace keeps them).
--
-- Order (§9.8, «Откаты»):
--   1. the panel first: it reads signal_settings.texts_enabled_at. Revert the
--      step's commits in main (Vercel deploys the panel) BEFORE this file — a
--      select of a dropped column answers 42703 and the card of switches goes
--      empty;
--   2. the Edge Functions sync-guest-signals and classify-guest-signals from
--      the commit before the step (09d6664): they read texts_enabled_at too;
--   3. texts off in «Гости → Настройки» wherever they are on without the
--      notice's date — that erases the texts kept so far (the old rule cannot
--      keep them: they have no notice). This file refuses while such a row is
--      left;
--   4. this file, one statement:
--        npx supabase db query --linked -f docs/one-off-writes/guest-signal-texts-boundary-rollback.sql
--   5. the history: npx supabase migration repair --status reverted 20261102100000 --linked
--   6. the probes: rollout_1030_fingerprint.sql and rollout_1030_functions.sql
--      EQUAL head of rollout_1102_expected.json, postpush_texts_boundary_1102.sql
--      as before the push (§9.8).
--
-- The data: a stay cut while the line was the texts' first day kept whether
-- it began after it (stay_after_notice). Without a notice that answer means
-- nothing to the old rule, and a notice dated later would read it as its
-- own: such answers go back to null, as the old rule leaves them. Then every
-- text the old rule would not keep goes, with what was drawn from it — none,
-- normally: a notice that moved the line later erased them at once, and only
-- a cut racing that call can leave one. texts_enabled_at goes with its column.
-- A second run finds nothing to do and changes nothing.
do $rollback$
begin
  perform set_config('lock_timeout', '3s', true);

  if exists (select 1 from public.signal_settings
             where texts_enabled and notice_published_at is null) then
    raise exception 'Texts are on without the guest notice; switch them off first (see the header)';
  end if;

  update public.guest_signals g
  set stay_after_notice = null
  from public.signal_settings s
  where s.host_id = g.host_id and s.kind = g.kind
    and s.notice_published_at is null
    and g.stay_after_notice is not null;

  -- The bodies of 20261030110000, word for word.
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
     and p_settings.notice_published_at is not null
     and coalesce(case when p_review.stay_exact
                       then p_review.arrival_date
                            >= (p_settings.notice_published_at at time zone 'Europe/Prague')::date
                       else coalesce(p_review.stay_after_notice,
                                     p_review.arrival_date
                                     >= (p_settings.notice_published_at at time zone 'Europe/Prague')::date)
                  end, false)
     and (p_review.text_purge_after is null or p_review.text_purge_after > current_date)
     and not p_review.is_hidden
     and not exists (select 1 from public.properties p
                     where p.id in (p_review.property_id, p_review.room_id) and p.status = 'archived')
$$;

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
           g.arrival_date >= (s.notice_published_at at time zone 'Europe/Prague')::date as after_notice
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
  v_host     uuid := public.current_host_id();
  v_signal   public.guest_signal_kind := coalesce(p_kind, 'review');
  v_row      public.signal_settings;
  v_kind     text;
  v_record   record;
  v_model    boolean;
  v_is_admin boolean := public.auth_role() = 'admin' and public.is_active_user();
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
  if coalesce(p_texts_enabled, v_row.texts_enabled)
     and coalesce(p_notice_published_at, v_row.notice_published_at) is null then
    raise exception 'Texts need the published guest notice'
      using errcode = 'check_violation', hint = 'serverErrors.signalTextsNeedNotice';
  end if;
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

  -- What the old rule does not keep goes now, by the old rule itself.
  perform public.erase_signal_texts(array(
    select g.id
    from public.guest_signals g
    join public.signal_settings s on s.host_id = g.host_id and s.kind = g.kind
    where (g.public_text is not null or g.private_text is not null or g.category_comments is not null)
      and not public.review_text_allowed(g, s)));

  alter table public.signal_settings drop constraint if exists signal_settings_texts_have_a_line;
  alter table public.signal_settings drop constraint if exists signal_settings_texts_need_notice;
  alter table public.signal_settings
    add constraint signal_settings_texts_need_notice
      check (not texts_enabled or notice_published_at is not null);
  alter table public.signal_settings drop column if exists texts_enabled_at;
end $rollback$;
