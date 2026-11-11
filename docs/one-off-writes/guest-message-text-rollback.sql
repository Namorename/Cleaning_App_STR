-- Takes «the guest's message of a chat task» away (20261111140000): the link of a task, the reader and
-- the count of reads. A WRITE to the cloud: only on the owner's word, never in 03:00–04:40 UTC, after
-- the panel is back on the commit before it (git revert on main), the phones on OTA №18 and the
-- function guest-message-text deleted (npx supabase functions delete guest-message-text):
--
--   npx supabase db query --linked -f docs/one-off-writes/guest-message-text-rollback.sql
--   npx supabase migration repair --status reverted 20261111140000 --linked
--
-- One statement: db query takes one. Nothing of a text was ever stored, so nothing of one is lost.
-- What changes back: the three functions the migration replaced get their bodies of 20261102100000
-- (the cut), 20261030110000 (purge_signal_data) and 20261110120000 (purge_guest_message_links),
-- copied verbatim; the signals a task's link kept exact are cut by the next night's sweep (05:00 UTC)
-- by the old rule, and their cards forget the conversation 30 days after the decision (05:20 UTC).
-- create or replace keeps every grant as it was.
do $rollback$
begin
  perform set_config('lock_timeout', '3s', true);

  drop trigger if exists signal_findings_task_link on public.signal_findings;
  drop function if exists public.signal_findings_task_link();
  drop function if exists public.guest_message_target(uuid, uuid, uuid);
  drop function if exists public.take_message_text_read(uuid);
  drop table if exists raw.message_text_reads;

  -- cut_signal_stay_links as 20261102100000 wrote it.
  execute $old_cut$
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
$old_cut$;

  -- purge_signal_data as 20261030110000 wrote it.
  execute $old_purge$
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
    and g.external_key not like 'purged:%';
  get diagnostics v_keys = row_count;

  return v_erased || jsonb_build_object('keys', v_keys);
end;
$$;
$old_purge$;

  -- purge_guest_message_links as 20261110120000 wrote it.
  execute $old_links$
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
         or public.signal_retention_ends(g.kind, g.submitted_at) <= current_date);
  get diagnostics v_signals = row_count;

  update public.issue_facts f
  set conversation_key = null
  where f.conversation_key is not null and f.created_at < now() - interval '90 days';
  get diagnostics v_facts = row_count;

  update public.signal_findings f
  set conversation_link_ends = least(f.conversation_link_ends,
                                     (f.decided_at at time zone 'Europe/Prague')::date + 30)
  where f.external_conversation_id is not null and f.decided_at is not null
    and f.status <> 'candidate';

  update public.signal_findings f
  set external_conversation_id = null, conversation_link_ends = null
  where f.external_conversation_id is not null and f.conversation_link_ends <= current_date;
  get diagnostics v_links = row_count;

  delete from raw.signal_message_queue q
  where q.state = 'idle' and q.updated_at < now() - interval '90 days';
  get diagnostics v_queue = row_count;

  return jsonb_build_object('signals', v_signals, 'facts', v_facts, 'links', v_links, 'queue', v_queue);
end;
$$;
$old_links$;

  drop function if exists public.signal_task_link_ends(uuid);
  alter table public.signal_findings drop column if exists task_link_ends;
end;
$rollback$;
