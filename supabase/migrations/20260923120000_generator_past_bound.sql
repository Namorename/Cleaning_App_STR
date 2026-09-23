-- The generator writes no cleaning for a day already past its grace, and
-- a committed run now leaves a row in raw.generator_runs.
--
-- Found in production on 2026-09-23. The webhook path reconciles over the
-- dates of the booking it just wrote (departureRange,
-- supabase/functions/_shared/reservation-sync.ts), so an edit in Hostaway to a
-- booking that left long ago calls the generator with a window around that old
-- day. Booking 63925530, departure 08.08, edited 23.09: a fresh unassigned
-- cleaning for 08.08 appeared at 11:00 UTC and sits in the manager's queue
-- until the sweep closes it at 03:30 on 24.09. The guard of 20260918171000 could not stop it:
-- the booking had never had a cleaning, expired or otherwise, to compare with.
--
-- THE BOUNDARY IS task_is_stale(). The sweep closes a task when it holds, and
-- the claim policy refuses a task when it holds; a day the sweep would close
-- is a day the generator must not open. Writing `current_date - 1` here
-- instead would be a second definition of the grace period, and in UTC rather
-- than in the listing's timezone -- the two would drift apart at the first
-- change to task_grace_days(). Yesterday is still owed a cleaning; the day
-- before is not.
--
-- ON BIRTH ONLY. The bound is in the insert and not in _wanted. _wanted is
-- also what the cancel pass reads as "still wanted", and the nightly run at
-- 03:15 comes before the sweep at 03:30: dropping stale days from _wanted
-- would cancel every live cleaning that went stale since the last sweep,
-- turning the record "nobody did it" (expired) into "it was not needed"
-- (cancelled). The reschedule and assignment passes are untouched as well: a
-- live row follows its booking even onto a stale day, and the sweep closes it.
--
-- The answer gains one key, `past_bound`: cleanings the bookings asked for
-- that the bound refused. It is a count, not an error, and it is how a
-- verification after a rollout tells "the bound fired" from "nothing was owed".
-- Both callers (process-webhook-events, sync-reservations) hold the answer as
-- `unknown` and pass it through untouched, so a new key breaks neither.
--
-- The expired-day branch of 20260918171000 stays. An expired row's day is
-- stale by construction, so this bound now covers it too; keeping it costs
-- nothing and keeps the loop closed should the grace period ever change.
--
-- RUN TRACE. Until now the answer lived only in the HTTP body of the Edge
-- Function that called the generator, and pg_net keeps that body in
-- net._http_response for six hours -- an unlogged table, emptied by a crash,
-- and with no body at all when the call outlives pg_net's 120 s timeout. The
-- nights of 20.09 and 21.09 after 20260918171000 could not be proven that way:
-- by morning only cron's `succeeded` was left, and that says the request was
-- queued, not that the generator ran. From here on the generator writes its
-- own answer into raw.generator_runs before returning it, in the same
-- transaction as the tasks it changed: a row means the run was committed.
-- The converse holds except in one case, below.
--
-- HOW TO READ IT -- the rule changed, and it is the reason for this trace.
-- A row with zeros means the run happened and had nothing to do. NO ROW now
-- means one of three things, and no longer "did not happen or made zero",
-- which is what an empty morning meant before:
--   1. the generator was never called. The cron did not fire, or Hostaway or
--      the sync RPC failed first. Each step is its own transaction: a nightly
--      sync that failed partway keeps the booking batches it already wrote,
--      and their cleanings wait for the next successful call;
--   2. the generator failed, and its transaction rolled back with the row;
--   3. rarely, the run committed its tasks and only the trace failed. That
--      leaves WARNING "generate_cleaning_tasks: run trace not written" in the
--      Postgres log, and the run's work in public.tasks at that minute
--      (created_at / updated_at). Check both before calling a missing night a
--      failure.
-- Why a run failed: the Edge Function log (console.error) and the Postgres
-- log, for as long as the plan keeps logs; the HTTP body in
-- net._http_response, for six hours; per-booking fetch errors on the webhook
-- path, for good, in raw.webhook_events.last_error. A webhook batch whose
-- generator call committed but whose `processed` mark then failed is claimed
-- and reconciled again: one row per attempt.
--
-- Both callers write rows, and nothing in the row says which one. The nightly
-- sync (sync-reservations, cron at 03:15 UTC) fetches departures from today-7
-- to today+90, so its row is stamped 03:15-03:25 UTC with window_from on or
-- just after (ran_at at UTC)::date - 7 and a window about 97 days wide. A
-- webhook batch reconciles every booking departing between the earliest and
-- the latest departure it fetched: usually a narrow window, but one old
-- booking in the batch stretches it, and its past_bound then counts every
-- stale booking without a cleaning inside that span, not only the ones the
-- batch touched. A manual call of sync-reservations looks like a night at
-- another hour. Telling the callers apart exactly would need a header from
-- both Edge Functions -- two deploys for what the hour and window_from
-- already say.
--
-- past_bound will read 0 on nearly every nightly row: the defect this
-- migration fixes lives on the webhook path. The signal is in webhook rows.
--
-- Volume, measured in production on 23.09 before the rollout: webhook
-- batches that reached `processed` ran at 124-179 a day on the full days
-- 16.09-22.09, 233 a day on average over 28 days, and 541 at the busiest
-- (07.09, in the week 06.09-12.09 that stayed between 284 and 541). That is
-- an upper bound on webhook rows: a processed batch skips the generator only
-- when none of its bookings normalized. Kept 90 days: about 21 000 rows,
-- 49 000 if every day were the busiest.
--
-- WHY raw. The answer is counts and dates across every company -- the
-- generator has no host -- and nothing a client should read. raw is closed to
-- anon and authenticated as a schema (20260824190000_helpers.sql), is not
-- exposed through PostgREST, and needs no row policy for that reason;
-- supabase/tests/table_grants.sql now checks that it stays closed -- on the
-- local stack; in the cloud the same questions have to be asked after the
-- push. The table still revokes the client roles by name, because the hosted
-- defaults have surprised us before.
--
-- A TRACE NEVER COSTS A CLEANING. The insert sits in its own block and any
-- failure there becomes a warning; the run returns its answer and commits its
-- tasks either way. One failure would slip past that block: a wait for a lock
-- on raw.generator_runs. Both callers come through PostgREST, where
-- statement_timeout and lock_timeout are both 8 s; the statement timer starts
-- first and wins, and a cancelled statement (57014) is not caught by
-- `when others` -- the whole run would roll back. So the block takes its lock
-- with NOWAIT first: anything holding a conflicting lock (ALTER TABLE,
-- TRUNCATE, VACUUM FULL, a non-concurrent index build) costs the trace at
-- once, as a caught 55P03, and never the run. The purge's DELETE and
-- autovacuum take locks that do not conflict.
--
-- Signature unchanged, so create or replace replaces rather than overloads.
-- Unchanged from 20260918171000 apart from the bound, the owed/inserted split
-- that counts past_bound, and the trace written before the return.

create table raw.generator_runs (
  id          bigint generated always as identity primary key,
  ran_at      timestamptz not null default now(),
  -- Nullable on purpose: a call with an odd window still leaves its row.
  window_from date,
  window_to   date,
  -- The whole answer, so keys added later arrive without a migration here.
  answer      jsonb not null
);

create index generator_runs_ran_at_idx on raw.generator_runs (ran_at);

revoke all on table raw.generator_runs from public, anon, authenticated;

create or replace function public.generate_cleaning_tasks(from_date date, to_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_relocated   integer;
  v_created     integer;
  v_rescheduled integer;
  v_assigned    integer;
  v_cancelled   integer;
  v_past_bound  integer;
  v_answer      jsonb;
begin
  -- One row per cleaning owed: a booking on an ordinary listing owes one, a
  -- booking that took three rooms owes three. `p` is the thing being cleaned
  -- from here on — the room where there is one, the listing where there is
  -- not — and every column below is read off it.
  create temporary table _wanted on commit drop as
  select
    r.id             as reservation_id,
    p.id             as property_id,
    -- Carried for one reason: a cleaning finished before this migration stands
    -- on the listing and answers for every room at once. See the insert.
    r.property_id    as listing_id,
    r.departure_date as scheduled_date,
    (case when w.same_day_turnover then 1 else 0 end)::smallint as priority,
    w.window_from    as time_from,
    w.window_to      as time_to,
    w.guests_count,
    case
      when w.same_day_turnover and w.window_to is not null
      -- The next guest may arrive at that hour, so that is the hard deadline.
      -- Computed in the property's own timezone: a date is a calendar date
      -- there, not an instant in UTC.
      then (r.departure_date + w.window_to) at time zone p.timezone
    end as due_at,
    -- The regular cleaner: this property's own, the listing above it
    -- otherwise. Each arm matches at most one row — that is exactly what
    -- property_cleaners_one_auto guarantees, and it guarantees it per property,
    -- which is why the arms are a coalesce and not one widened WHERE.
    -- `pc.property_id in (p.id, p.parent_id)` would match both at once for a
    -- room carrying its own auto link under a listing that has one too, and a
    -- scalar subquery returning two rows does not mis-assign a cleaning — it
    -- aborts the whole nightly reconciliation with 21000.
    --
    -- Both arms are keyed off `p` and never off `r.property_id`, though the
    -- join makes those the same value today. `p` is the property being cleaned.
    -- A booking takes its rooms through public.reservation_units, and the
    -- fan-out over them is the next stage; the day this query stops being one
    -- row per booking, the first arm has to follow the room and not the
    -- booking. Keyed off `p` it follows whatever `p` becomes. Keyed off
    -- `r.property_id` it would quietly begin reading the listing in both arms,
    -- leaving the precedence below inert with every test still green.
    --
    -- A room's own 'claim' link does not stop the listing's auto link from
    -- reaching it. Inside a single listing a claim link has never stopped an
    -- auto link either: it puts a colleague in the queue, it does not empty
    -- the queue. Only an auto link answers "whose is this the moment it is
    -- made", so only an auto link on the room itself overrides the listing's.
    coalesce(
      (select pc.cleaner_id
       from public.property_cleaners pc
       where pc.property_id = p.id and pc.mode = 'auto'),
      (select pc.cleaner_id
       from public.property_cleaners pc
       where p.hostaway_unit_id is not null
         and pc.property_id = p.parent_id
         and pc.mode = 'auto')
    ) as auto_cleaner_id
  from public.reservations r
  -- No row in reservation_units means the booking named no rooms, and the
  -- listing itself is what gets cleaned. A left join says exactly that, and
  -- says it without a second branch to keep in step.
  left join public.reservation_units ru on ru.reservation_id = r.id
  join public.properties p on p.id = coalesce(ru.property_id, r.property_id)
  cross join lateral public.reservation_cleaning_window(r.id, p.id) w
  where r.departure_date between from_date and to_date
    and r.status in ('new', 'modified')
    and not r.is_block
    and p.status = 'active';


  -- Move a cleaning that still stands on the listing onto the room the booking
  -- turns out to have taken.
  --
  -- A booking can learn its room after its cleaning exists: Hostaway assigns
  -- the unit later, or a listing grows rooms it did not have. The row on the
  -- listing and the row owed on the room are then the same cleaning under two
  -- names, and moving it keeps its id and with it the cleaner's name, her
  -- photos, her steps and the problems filed against it.
  --
  -- Without this pass the insert below reads the listing row as "already
  -- served" and skips the room, and the cancel pass — which judges by the pair
  -- — then takes that very row away: the booking comes out of the run owing
  -- nothing, and tomorrow's run gives back a stranger with no cleaner on it.
  -- Measured against a copy of production, that pair cancelled 192 cleanings
  -- and created none, 96 of them with a cleaner's name on them.
  --
  -- Only untouched work, which is the rule the other three passes keep: a
  -- cleaning somebody has accepted or started stays where she accepted it, and
  -- the insert's listing branch below is what keeps it from being duplicated
  -- onto a room.
  with wanted_room as (
    -- The lowest room id the booking took: an arbitrary choice among them, but
    -- a stable one, and the same one the one-off backfill makes. The booking's
    -- other rooms are owed cleanings of their own and the insert writes them.
    select distinct on (reservation_id) reservation_id, property_id, listing_id
    from _wanted
    where property_id <> listing_id
    order by reservation_id, property_id
  ),
  relocated as (
    update public.tasks t
    set property_id = w.property_id
    from wanted_room w
    where t.reservation_id = w.reservation_id
      and t.property_id = w.listing_id
      and t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned')
      -- If the room already holds this booking's cleaning, the move would
      -- collide with the pair that names one. The listing row is then a
      -- duplicate of work that already exists where it belongs, and the cancel
      -- pass below is what clears it.
      and not exists (
        select 1 from public.tasks x
        where x.reservation_id = w.reservation_id
          and x.property_id = w.property_id
          and x.type = 'cleaning'
          and x.status not in ('cancelled', 'expired')
      )
    returning 1
  )
  select count(*) into v_relocated from relocated;

  -- Insert missing tasks. The partial unique index on reservation_id keeps
  -- this idempotent: a repeated run collides and does nothing.
  --
  -- `owed` is every cleaning the bookings ask for that the table does not yet
  -- answer. Those whose day is already past grace are counted as past_bound
  -- and not written; both numbers come from the one list, so they cannot
  -- disagree about what "missing" means.
  with owed as (
    select w.*,
           -- No cleaning is born for a day the sweep would close: task_is_stale
           -- is the one boundary the sweep and the claim policy already share.
           -- The bound sits here and not in _wanted on purpose -- see the header.
           public.task_is_stale(w.property_id, w.scheduled_date) as is_past
    from _wanted w
    where not exists (
      select 1 from public.tasks t
      where t.reservation_id = w.reservation_id
        and t.type = 'cleaning'
        -- Live work already exists for this booking -- or the very day was
        -- already tried and closed unfinished. The second half is what stops
        -- the nightly loop; the header of this migration says why.
        and (t.status not in ('cancelled', 'expired')
             or (t.status = 'expired' and t.scheduled_date = w.scheduled_date))
        and (t.property_id = w.property_id
             -- ...or it stands on the booking's own listing, which is where
             -- every cleaning stood before this migration. Such a row is the
             -- same cleaning recorded under the identity of the day, and it
             -- answers for every room the booking took.
             --
             -- Without this the ten cleanings finished last week on the nine
             -- multi-unit listings would each be created again, on a room, for
             -- work already done — and three of them would arrive already
             -- assigned to the cleaner who did it. History is not moved onto a
             -- room (it is not ours to restate), so it has to be read where it
             -- lies.
             --
             -- The branch cannot suppress work that is genuinely owed: after
             -- this migration the generator never puts a cleaning on a listing
             -- whose booking names rooms, so a row it matches is always one
             -- from before. On an ordinary listing w.property_id and
             -- w.listing_id are the same value and it says nothing new.
             or t.property_id = w.listing_id)
    )
  ),
  inserted as (
    insert into public.tasks (
      property_id, reservation_id, type, status, priority,
      scheduled_date, time_from, time_to, guests_count, due_at, assignee_id
    )
    select
      o.property_id, o.reservation_id, 'cleaning',
      (case when o.auto_cleaner_id is not null then 'assigned' else 'unassigned' end)
        ::public.task_status,
      o.priority, o.scheduled_date, o.time_from, o.time_to, o.guests_count,
      o.due_at, o.auto_cleaner_id
    from owed o
    where not o.is_past
    returning 1
  )
  select (select count(*) from inserted),
         (select count(*) from owed where is_past)
    into v_created, v_past_bound;

  -- Move tasks whose booking shifted, whose window changed, or whose guest
  -- count changed. Only untouched tasks: once a cleaner has accepted or
  -- started, rewriting the job underneath her is worse than leaving it for a
  -- human to sort out.
  with moved as (
    update public.tasks t
    set scheduled_date = w.scheduled_date,
        priority       = w.priority,
        time_from      = w.time_from,
        time_to        = w.time_to,
        guests_count   = w.guests_count,
        due_at         = w.due_at
    from _wanted w
    where t.reservation_id = w.reservation_id
      and t.property_id = w.property_id
      and t.type = 'cleaning'
      and t.status in ('unassigned', 'assigned')
      and (t.scheduled_date is distinct from w.scheduled_date
           or t.priority is distinct from w.priority
           or t.time_from is distinct from w.time_from
           or t.time_to is distinct from w.time_to
           or t.guests_count is distinct from w.guests_count
           or t.due_at is distinct from w.due_at)
    returning 1
  )
  select count(*) into v_rescheduled from moved;

  -- Hand over tasks that are still waiting on a listing with a default
  -- cleaner. This covers the link being switched to 'auto' after the task
  -- already existed — the same shape as a stale deadline, where state set once
  -- at creation was never revisited.
  --
  -- Only genuinely free work: a task someone already holds, whether claimed by
  -- a cleaner or handed over by the manager, is left exactly as it is.
  with taken as (
    update public.tasks t
    set assignee_id = w.auto_cleaner_id,
        status      = 'assigned'
    from _wanted w
    where t.reservation_id = w.reservation_id
      and t.property_id = w.property_id
      and t.type = 'cleaning'
      and t.status = 'unassigned'
      and t.assignee_id is null
      and w.auto_cleaner_id is not null
    returning 1
  )
  select count(*) into v_assigned from taken;

  -- Cancel tasks whose reservation no longer qualifies: cancelled, turned into
  -- an inquiry, became a block, moved out of the window entirely — or whose
  -- listing has since gone into maintenance or been archived.
  --
  -- Work already done or under way is never touched, and neither is work that
  -- expired: those are answers about what happened, not open questions.
  with dropped as (
    update public.tasks t
    set status = 'cancelled'
    where t.type = 'cleaning'
      and t.reservation_id is not null
      and t.status in ('unassigned', 'assigned')
      and t.scheduled_date between from_date and to_date
      and not exists (
        select 1 from _wanted w
        where w.reservation_id = t.reservation_id
          and w.property_id = t.property_id
      )
    returning 1
  )
  select count(*) into v_cancelled from dropped;

  drop table _wanted;

  v_answer := jsonb_build_object(
    'window_from', from_date,
    'window_to', to_date,
    'relocated', v_relocated,
    'created', v_created,
    'rescheduled', v_rescheduled,
    'assigned', v_assigned,
    'cancelled', v_cancelled,
    'past_bound', v_past_bound
  );

  -- The trace, in its own block: a failure here rolls back only this insert
  -- and is reported, never the run. See the header.
  begin
    lock table raw.generator_runs in row exclusive mode nowait;
    insert into raw.generator_runs (window_from, window_to, answer)
    values (from_date, to_date, v_answer);
  exception when others then
    raise warning 'generate_cleaning_tasks: run trace not written: % (SQLSTATE %)',
      sqlerrm, sqlstate;
  end;

  return v_answer;
end;
$function$;

revoke all on function public.generate_cleaning_tasks(date, date) from public, anon, authenticated;
grant execute on function public.generate_cleaning_tasks(date, date) to service_role;

-- Retention: ninety days, in plain SQL and without pg_net, like
-- expire-stale-tasks. cron.schedule is idempotent by name.
select cron.schedule(
  'purge-generator-runs',
  '45 3 * * *',
  $$delete from raw.generator_runs where ran_at < now() - interval '90 days'$$
);
