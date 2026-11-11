-- Where a task from a guest came from, as each person may know it (the owner's word of 2026-11-11).
--
-- A task made from a guest's review or chat message carries its source on screen in both apps — the
-- review's star and the chat's bubble, each in its own colour and with its word — and, on the task's
-- page, the stay it speaks of. Nothing is stored anew: everything below is read, when the page asks,
-- through the links that already exist (task → its finding → the guest signal → the booking), and lives
-- as long as they do.
--
--   public.problem_guest_origin(p_problem_id)  the task's page, both apps. By role:
--     everybody who may read the task  the source and the stay: the days while the signal keeps them,
--                                      the months once the cut has taken them (cut_signal_stay_links);
--     the head technician, the office  the guest's name from the booking while the signal is linked to
--                                      it, and why not when it is not; the channel, the rating and the
--                                      day the guest sent it;
--     the office alone                 the PMS's numbers to find it in Hostaway — the booking while
--                                      linked, the conversation while signal_findings keeps it (decision
--                                      10 of 2026-10-31) — and the signal for «Показать текст из
--                                      Hostaway» (guest-review-text, unchanged).
--   public.api_task_json               API v1 Task gets `source` and `guest_stay` (no name: the API never
--                                      gives a guest's, registry.json → forbidden guests:read_personal).
--
-- What is unchanged, on purpose: the storage rules. The days and the booking of a signal still go when
-- its card is decided (the owner's decision of 2026-10-17); the guest's name still goes from the booking
-- 90 days after departure (purge_guest_data); the conversation's number 30 days after the decision.
-- After each, the page shows what is left and says why the rest is not there.
--
-- Additive: four new functions, one replaced (the API's task, its old keys as they were). Rollback: drop
-- the four and restore api_task_json from 20261106125500 (docs/rollout/task-source-1111.md).

/**
 * The stay of a guest signal as a task shows it: the exact days while the signal keeps them
 * (`stay_exact`), the months once the cut has left only the first of each, null when the PMS named no
 * stay. {"precision": "day", "arrival": "2026-10-03", "departure": "2026-10-07"} or
 * {"precision": "month", "arrival": "2026-10", "departure": "2026-10"}.
 *
 * Internal: no grants.
 */
create or replace function public.guest_stay_json(p_signal public.guest_signals)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case
           when p_signal.id is null
                or (p_signal.arrival_date is null and p_signal.departure_date is null) then null
           when p_signal.stay_exact then jsonb_build_object(
             'precision', 'day',
             'arrival', to_char(p_signal.arrival_date, 'YYYY-MM-DD'),
             'departure', to_char(p_signal.departure_date, 'YYYY-MM-DD'))
           else jsonb_build_object(
             'precision', 'month',
             'arrival', to_char(p_signal.arrival_date, 'YYYY-MM'),
             'departure', to_char(p_signal.departure_date, 'YYYY-MM'))
         end
$$;

/**
 * The guest signal a task was made from: the one its finding of origin points to (one per task,
 * signal_findings_one_origin). Null for a report of the staff, or when the finding is gone.
 *
 * Internal: no grants.
 */
create or replace function public.problem_origin_signal(p_problem_id uuid)
returns public.guest_signals
language sql
stable
set search_path = ''
as $$
  select g.*
  from public.signal_findings f
  join public.guest_signals g on g.id = f.signal_id
  where f.problem_id = p_problem_id and f.status = 'task_created'
  limit 1
$$;

/**
 * Where a task from a guest came from, as the caller may know it, or null: for a report of the staff,
 * and for a task the caller may not read. The task is read under the rules of its own policies, written
 * out here because a definer sees every row: the office and the head technician of the company; the
 * reporter and whoever holds its live repair while it is not archived.
 *
 * {
 *   "source": "review" | "message",
 *   "stay": guest_stay_json() | null,
 *   -- the head technician and the office:
 *   "channel": "airbnb" | "booking" | …,
 *   "guest": {"state": "shown", "name": "…"}   the booking's name, read now
 *          | {"state": "erased", "name": null} the booking is linked, its name gone (90 days)
 *          | {"state": "cut", "name": null}    the card was decided: the booking is no longer linked
 *          | {"state": "none", "name": null},  no booking was ever found for it
 *   "rating": 0–10 | null (a review's),
 *   "sent": {"precision": "day" | "month", "on": "2026-10-09" | "2026-10"} | null,
 *   -- the office alone:
 *   "booking_id": "<the PMS's id of the booking>" | null,
 *   "conversation_id": "<the PMS's id of the conversation>" | null,
 *   "signal_id": uuid | null,
 *   "has_text": boolean
 * }
 *
 * Nothing is written and nothing is kept: the name comes from public.reservations at the moment of
 * the call.
 */
create or replace function public.problem_guest_origin(p_problem_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_office  boolean := public.is_manager();
  v_names   boolean := v_office or public.is_head_tech();
  v_problem public.problems;
  v_finding public.signal_findings;
  v_signal  public.guest_signals;
  v_booking public.reservations;
  v_out     jsonb;
begin
  select p.* into v_problem
  from public.problems p
  where p.id = p_problem_id
    and p.host_id = public.current_host_id()
    and (v_names
         or (p.archived_at is null
             and public.is_active_user()
             and (p.reported_by = v_uid
                  or exists (select 1 from public.tasks t
                             where t.problem_id = p.id
                               and t.assignee_id = v_uid
                               and t.status not in ('cancelled', 'expired')))));
  if not found or v_problem.source = 'staff' then
    return null;
  end if;

  select f.* into v_finding
  from public.signal_findings f
  where f.problem_id = v_problem.id and f.status = 'task_created'
  limit 1;
  if v_finding.id is not null then
    select g.* into v_signal from public.guest_signals g where g.id = v_finding.signal_id;
  end if;
  if v_signal.reservation_id is not null then
    select r.* into v_booking
    from public.reservations r
    where r.id = v_signal.reservation_id and r.host_id = v_problem.host_id;
  end if;

  v_out := jsonb_build_object('source', v_problem.source, 'stay', public.guest_stay_json(v_signal));

  if v_names then
    v_out := v_out || jsonb_build_object(
      'channel', coalesce(v_signal.channel::text, v_problem.source_facts ->> 'channel'),
      'guest', case
                 when v_booking.id is not null and nullif(btrim(v_booking.guest_name), '') is not null
                   then jsonb_build_object('state', 'shown', 'name', btrim(v_booking.guest_name))
                 when v_booking.id is not null
                   then jsonb_build_object('state', 'erased', 'name', null)
                 when v_signal.id is not null and not v_signal.stay_exact
                   then jsonb_build_object('state', 'cut', 'name', null)
                 else jsonb_build_object('state', 'none', 'name', null)
               end,
      'rating', v_signal.rating,
      'sent', case
                when v_signal.id is null then null
                when v_signal.stay_exact then jsonb_build_object(
                  'precision', 'day',
                  'on', to_char((v_signal.submitted_at at time zone 'Europe/Prague')::date, 'YYYY-MM-DD'))
                else jsonb_build_object(
                  'precision', 'month',
                  'on', to_char((v_signal.submitted_at at time zone 'Europe/Prague')::date, 'YYYY-MM'))
              end);
  end if;

  if v_office then
    v_out := v_out || jsonb_build_object(
      'booking_id', coalesce(v_booking.id::text, v_signal.external_reservation_id),
      'conversation_id', v_finding.external_conversation_id,
      'signal_id', v_signal.id,
      'has_text', coalesce(v_signal.has_public_text or v_signal.has_private_text, false));
  end if;

  return v_out;
end;
$$;

comment on function public.problem_guest_origin(uuid) is
  'Where a task from a guest came from, by the caller''s role: source and stay for all who may read '
  'the task; name, channel, rating, day sent for the head technician and the office; PMS numbers for '
  'the office. Reads only, keeps nothing (20261111120000).';

/**
 * The stay of a task for API v1: as the page shows it to everybody, never the name.
 *
 * Internal: no grants.
 */
create or replace function public.api_task_guest_stay(p public.problems)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when p.source = 'staff' then null
              else public.guest_stay_json(public.problem_origin_signal(p.id)) end
$$;

-- A task says where it came from and the stay it speaks of (a copy of 20261106125500 with the two
-- fields added).
create or replace function public.api_task_json(p public.problems, p_scopes text[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'title', public.api_mask_codes(p.title),
    'description', public.api_mask_codes(p.description),
    'text_masked', public.api_mask_codes(p.title) is distinct from p.title
                   or public.api_mask_codes(p.description) is distinct from p.description
                   or public.api_mask_codes(p.cancel_reason) is distinct from p.cancel_reason,
    'priority', p.priority,
    'status', p.status,
    'property_id', p.property_id,
    'cleaning_id', p.task_id,
    'reported_by', p.reported_by,
    'archived', p.archived_at is not null,
    'cancel_reason', public.api_mask_codes(p.cancel_reason),
    'work', (select jsonb_build_object(
                      'cleaning_id', w.id,
                      'status', w.status,
                      'assignee_id', w.assignee_id,
                      'scheduled_date', w.scheduled_date,
                      'time_from', public.api_hm(w.time_from),
                      'time_to', public.api_hm(w.time_to))
             from public.tasks w
             where w.problem_id = p.id and w.host_id = p.host_id and w.type = 'maintenance'
             order by w.created_at desc, w.id desc
             limit 1),
    'created_at', public.api_ts(p.created_at),
    'updated_at', public.api_ts(p.updated_at),
    'resolved_at', public.api_ts(p.resolved_at),
    'cancelled_at', public.api_ts(p.cancelled_at),
    'archived_at', public.api_ts(p.archived_at),
    'completed_by', public.api_task_person_json(p.completed_by, p.host_id, p_scopes),
    'completed_by_source', p.completed_by_source,
    'closed_by', public.api_task_person_json(p.closed_by, p.host_id, p_scopes),
    'closed_how', p.closed_how,
    'closed_cause', p.closed_cause,
    'closed_at', public.api_ts(p.closed_at),
    'source', p.source,
    'guest_stay', public.api_task_guest_stay(p))
$$;

-- Who may call what. The page's reader: a person signed in (the function decides what each sees).
revoke all on function public.problem_guest_origin(uuid) from public, anon, authenticated, service_role;
grant execute on function public.problem_guest_origin(uuid) to authenticated;
-- Building blocks: called only inside the functions above, which run as their owner.
revoke all on function public.guest_stay_json(public.guest_signals)
  from public, anon, authenticated, service_role;
revoke all on function public.problem_origin_signal(uuid) from public, anon, authenticated, service_role;
revoke all on function public.api_task_guest_stay(public.problems)
  from public, anon, authenticated, service_role;
-- As before (20261106125000): the API's helper of the operations alone.
revoke all on function public.api_task_json(public.problems, text[])
  from public, anon, authenticated, service_role;
