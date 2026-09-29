-- F11, M3a: which events become a push, and for whom (docs/f11-plan.md,
-- «М3 — проект перед кодом»).
--
-- The generator moves and cancels cleanings silently, the office hands them
-- out from the panel, colleagues write in a conversation. Each such change is
-- written here as a row of raw.push_outbox, and the sender (M3b and the Edge
-- Function send-push) turns the rows into pushes. A row holds the recipient,
-- the kind of event, the cleaning or the conversation, and the parameters —
-- dates, the kind of job, who acted — but never text: the language is chosen
-- when the push is sent (docs/f11-plan.md, owner's word 1).
--
-- Who is told:
-- - the person the change is about: the new cleaner, the one it was taken
--   from, the one whose cleaning moved or was cancelled; for free work, everyone
--   who may take it; for a message, the thread's people other than the office;
-- - never the person who made the change;
-- - only about a cleaning inside the week she can see ([today − grace,
--   today + horizon] in the listing's timezone, the window of the task
--   policies), judged on the old day and the new one;
-- - only a person with a registered phone and an active profile. Until the first
--   phone registers, none of this writes anything.
--
-- Who acted: auth.uid(). The generator runs through PostgREST with the secret
-- key and the sweep runs under pg_cron, both with no user; a manager acts
-- through save_task, assign_problem, set_property_status or a direct update.
-- A row the generator writes is a NEW cleaning; one the office writes with a
-- name on it is an ASSIGNMENT.
--
-- The trigger on tasks is per STATEMENT with transition tables: the generator
-- changes hundreds of rows in one statement, and a per-row trigger would add a
-- call per row inside its 8-second budget. PostgreSQL allows transition tables
-- only on a single-event trigger without a column list, hence two triggers on
-- one function. The functions are security definers: raw is closed to the
-- people whose writes fire them.
--
-- Quiet hours: 21:00-07:00 in Prague. What is urgent — a cleaning of today or
-- tomorrow taken off her, cancelled or moved, or a booking cancelled while she
-- cleans — goes a minute after the change; the rest waits for seven. The minute
-- lets a burst of changes to one cleaning settle into one push (the sender
-- folds them).
--
-- Every row about a cleaning names the flat it was about when it was written
-- (params.property): the one taken off her is named as she had it, not where
-- the cleaning went after.
--
-- New table and functions, three new triggers. Creating a trigger takes a
-- SHARE ROW EXCLUSIVE lock on tasks, chat_messages and reservations for a
-- moment; hence the lock timeout.

set local lock_timeout = '3s';

-- ---------- named constants ----------

create or replace function public.push_timezone()
returns text language sql immutable parallel safe set search_path = ''
as $$ select 'Europe/Prague' $$;

comment on function public.push_timezone() is
  'The zone quiet hours and the morning summary are kept in. One company, one '
  'zone for now; hosts.timezone arrives with multitenancy (F25).';

create or replace function public.push_quiet_start()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 21 $$;

create or replace function public.push_quiet_end()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 7 $$;

create or replace function public.push_digest_hour()
returns integer language sql immutable parallel safe set search_path = ''
as $$ select 7 $$;

create or replace function public.push_settle()
returns interval language sql immutable parallel safe set search_path = ''
as $$ select interval '60 seconds' $$;

create or replace function public.push_lifetime()
returns interval language sql immutable parallel safe set search_path = ''
as $$ select interval '30 minutes' $$;

comment on function public.push_lifetime() is
  'A push not sent this long after it was due is dropped: after an outage the '
  'phone must not receive a heap of stale news.';

-- ---------- when a push may go ----------

create or replace function public.push_send_after(
  p_urgent boolean,
  p_at     timestamptz default now()
)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
    when p_urgent then p_at + public.push_settle()
    when extract(hour from p_at at time zone public.push_timezone()) >= public.push_quiet_start() then
      (((p_at at time zone public.push_timezone())::date + 1)
        + make_time(public.push_quiet_end(), 0, 0)) at time zone public.push_timezone()
    when extract(hour from p_at at time zone public.push_timezone()) < public.push_quiet_end() then
      ((p_at at time zone public.push_timezone())::date
        + make_time(public.push_quiet_end(), 0, 0)) at time zone public.push_timezone()
    else p_at + public.push_settle()
  end
$$;

comment on function public.push_send_after(boolean, timestamptz) is
  'When a push written now may be sent: a minute on, or at seven in the '
  'morning when it can wait and it is quiet hours in Prague.';

-- ---------- the queue ----------

create table raw.push_outbox (
  id            bigint generated always as identity primary key,
  host_id       uuid not null references public.hosts (id) on delete cascade,
  recipient_id  uuid not null references public.profiles (id) on delete cascade,
  kind          public.push_kind not null,
  -- The cleaning or repair the push is about, when it is about one.
  task_id       uuid references public.tasks (id) on delete cascade,
  -- The conversation, for chat_message.
  thread_id     uuid references public.chat_threads (id) on delete cascade,
  -- Rows with the same recipient and key fold into one push: 'task:<id>',
  -- 'thread:<id>', 'digest:<date>'.
  collapse_key  text not null,
  -- Parameters of the text (i18n keys push.*): dates, the kind of job, who
  -- acted, the author's name. Never the text itself.
  params        jsonb not null default '{}',
  urgent        boolean not null default false,
  created_at    timestamptz not null default now(),
  send_after    timestamptz not null,
  expire_at     timestamptz not null,
  -- The sender's lease (M3b): a row claimed and not settled is not claimed
  -- again until the lease runs out. The lease has an owner, so a run that
  -- outlived it cannot let go of what the next run holds; and a moment, the
  -- send's, against which a phone found dead is judged.
  claimed_until timestamptz,
  claimed_at    timestamptz,
  claimed_by    uuid,
  settled_at    timestamptz,
  outcome       text check (outcome in ('sent', 'collapsed', 'muted', 'expired', 'skipped', 'failed')),
  constraint push_outbox_settled check ((settled_at is null) = (outcome is null))
);

create index push_outbox_pending_idx on raw.push_outbox (send_after) where settled_at is null;
create index push_outbox_group_idx on raw.push_outbox (recipient_id, collapse_key) where settled_at is null;
create index push_outbox_task_idx on raw.push_outbox (task_id) where task_id is not null;
create index push_outbox_thread_idx on raw.push_outbox (thread_id) where thread_id is not null;
-- One morning summary a person a day, however often the hourly job runs.
create unique index push_outbox_digest_once on raw.push_outbox (recipient_id, collapse_key)
  where kind = 'daily_digest';

comment on table raw.push_outbox is
  'Pushes waiting to be sent (docs/f11-plan.md, M3). Written by triggers, read '
  'and settled by the sender. Closed to clients like the rest of raw.';

-- ---------- tasks ----------

create or replace function public.push_on_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  v_office boolean := v_actor is not null and coalesce(public.is_manager(), false);
  -- Asked once a statement, not once a row: a SQL function with its own
  -- search_path is never inlined, and a dozen such calls a row cost 0.3-0.5 ms
  -- a row with an event (measured 2026-09-28, 660 rows, rolled back).
  v_grace      integer := public.task_grace_days();
  v_horizon    integer := public.task_horizon_days();
  v_lifetime   interval := public.push_lifetime();
  v_now_after  timestamptz := public.push_send_after(true);
  v_calm_after timestamptz := public.push_send_after(false);
begin
  -- Everything below is about people with a phone. Without one registered in
  -- the company the statement has nobody to tell: the common case until the
  -- first phone arrives, and the whole cost of this trigger then.
  if not exists (select 1 from public.push_tokens) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    with ev as materialized (
      -- A new row with a name on it: new work from the generator, an
      -- assignment from the office.
      select n.host_id, n.assignee_id as recipient_id,
             (case when v_actor is null then 'cleaning_new' else 'cleaning_assigned' end)::public.push_kind as kind,
             n.id as task_id, n.property_id,
             n.scheduled_date as day_a, n.scheduled_date as day_b,
             jsonb_build_object('date', n.scheduled_date, 'type', n.type,
                                'property', n.property_id) as params
      from new_rows n
      where n.assignee_id is not null
        and n.status in ('assigned', 'accepted')
    ),
    free as materialized (
      -- Only what a cleaner may take from the queue (apps/mobile tasks/api.ts,
      -- FREE_TASK_TYPES): an inspection or maintenance is the office's.
      select n.host_id, n.id as task_id, n.property_id, n.scheduled_date, n.type
      from new_rows n
      where n.assignee_id is null
        and n.status = 'unassigned'
        and n.type in ('cleaning', 'midstay')
    )
    insert into raw.push_outbox (host_id, recipient_id, kind, task_id, collapse_key,
                                 params, urgent, send_after, expire_at)
    select e.host_id, e.recipient_id, e.kind, e.task_id, 'task:' || e.task_id,
           e.params, w.urgent,
           case when w.urgent then v_now_after else v_calm_after end,
           case when w.urgent then v_now_after else v_calm_after end + v_lifetime
    from (
      select * from ev
      union all
      -- Free work: everyone who may take it. The listing rule is the twin of
      -- the one in the policies, asked only after the week and the phones have
      -- cut the candidates down — and only of phones linked to the listing, or
      -- to the listing a room belongs to (owner's word 2026-09-29): nobody
      -- else may take it, and asking every phone of the company cost a call a
      -- phone a cleaning. A narrowing, not a second rule: the rule decides.
      select f.host_id, tk.profile_id, 'cleaning_free'::public.push_kind, f.task_id, f.property_id,
             f.scheduled_date, f.scheduled_date,
             jsonb_build_object('date', f.scheduled_date, 'type', f.type, 'property', f.property_id)
      from free f
      join public.properties p on p.id = f.property_id
      -- The candidates come from the listing's own people: a lateral join, so
      -- the rule below is asked of them alone. As a qual beside the rule the
      -- narrowing would be ordered by cost, and the rule, cheaper on paper
      -- than a subquery, went first for every phone.
      join lateral (
        select distinct pc.cleaner_id as profile_id
        from public.property_cleaners pc
        where pc.property_id in (f.property_id, p.parent_id)
          and exists (select 1 from public.push_tokens t where t.profile_id = pc.cleaner_id)
      ) tk on true
      join public.profiles pr on pr.id = tk.profile_id and pr.host_id = f.host_id
      where f.scheduled_date between (now() at time zone p.timezone)::date - v_grace
                                 and (now() at time zone p.timezone)::date + v_horizon
        and public.cleans_property_as(tk.profile_id, f.property_id)
    ) e
    join public.properties p on p.id = e.property_id
    join public.profiles pr on pr.id = e.recipient_id and pr.is_active
    cross join lateral (
      select (now() at time zone p.timezone)::date as today
    ) d
    cross join lateral (
      -- Urgent is what changes her day: taken off her, cancelled or moved,
      -- today or tomorrow (§1.4). New, handed-over and free work can wait out
      -- quiet hours: it goes at seven, before the day starts.
      select (e.kind in ('cleaning_cancelled', 'cleaning_moved', 'cleaning_unassigned')
              and (e.day_a in (d.today, d.today + 1) or e.day_b in (d.today, d.today + 1))) as urgent
    ) w
    where e.recipient_id is distinct from v_actor
      and (e.day_a between d.today - v_grace and d.today + v_horizon
           or e.day_b between d.today - v_grace and d.today + v_horizon)
      and exists (select 1 from public.push_tokens t where t.profile_id = e.recipient_id)
    order by e.task_id, e.recipient_id, e.kind;

    return null;
  end if;

  -- UPDATE
  with pair as materialized (
    select o.id, n.host_id, n.property_id, n.type,
           o.status as old_status, n.status as new_status,
           o.assignee_id as old_assignee, n.assignee_id as new_assignee,
           o.scheduled_date as old_day, n.scheduled_date as new_day,
           o.property_id as old_property,
           o.time_from as old_from, n.time_from as new_from,
           o.time_to as old_to, n.time_to as new_to
    from old_rows o
    join new_rows n on n.id = o.id
    where o.status is distinct from n.status
       or o.assignee_id is distinct from n.assignee_id
       or o.scheduled_date is distinct from n.scheduled_date
       or o.property_id is distinct from n.property_id
       or o.time_from is distinct from n.time_from
       or o.time_to is distinct from n.time_to
  ),
  ev as (
    -- Handed to her — work already under way or paused included: she now
    -- holds what somebody else started.
    select x.host_id, x.new_assignee as recipient_id, 'cleaning_assigned'::public.push_kind as kind,
           x.id as task_id, x.property_id, x.new_day as day_a, x.new_day as day_b,
           jsonb_build_object('date', x.new_day, 'type', x.type, 'property', x.property_id) as params
    from pair x
    where x.new_assignee is not null
      and x.new_assignee is distinct from x.old_assignee
      and x.new_status in ('assigned', 'accepted', 'in_progress', 'paused', 'blocked')
    union all
    -- Taken from her, and not by being cancelled or closed.
    select x.host_id, x.old_assignee, 'cleaning_unassigned', x.id, x.property_id,
           x.old_day, x.old_day,
           jsonb_build_object('date', x.old_day, 'type', x.type, 'property', x.old_property)
    from pair x
    where x.old_assignee is not null
      and x.new_assignee is distinct from x.old_assignee
      and x.old_status not in ('done', 'cancelled', 'expired')
      and x.new_status not in ('done', 'cancelled', 'expired')
    union all
    -- Cancelled while open, work under way included.
    select x.host_id, x.old_assignee, 'cleaning_cancelled', x.id, x.property_id,
           x.old_day, x.old_day,
           jsonb_build_object('date', x.old_day, 'type', x.type, 'property', x.old_property)
    from pair x
    where x.new_status = 'cancelled'
      and x.old_status not in ('done', 'cancelled', 'expired')
      and x.old_assignee is not null
    union all
    -- Moved to another day or room while hers and not started.
    select x.host_id, x.new_assignee, 'cleaning_moved', x.id, x.property_id,
           x.old_day, x.new_day,
           jsonb_build_object('from_date', x.old_day, 'to_date', x.new_day,
                              'from_property', x.old_property, 'to_property', x.property_id,
                              'property', x.property_id, 'type', x.type,
                              'by', case when v_office then 'office' else 'booking' end)
    from pair x
    where x.new_assignee is not null
      and x.new_assignee = x.old_assignee
      and x.old_status in ('assigned', 'accepted')
      and x.new_status in ('assigned', 'accepted')
      and (x.new_day is distinct from x.old_day or x.property_id is distinct from x.old_property)
    union all
    -- The hours changed on the same day and room. Only today's and
    -- tomorrow's: the filter below keeps those.
    select x.host_id, x.new_assignee, 'cleaning_window', x.id, x.property_id,
           x.new_day, x.new_day,
           jsonb_build_object('date', x.new_day, 'time_from', x.new_from, 'time_to', x.new_to,
                              'type', x.type, 'property', x.property_id)
    from pair x
    where x.new_assignee is not null
      and x.new_assignee = x.old_assignee
      and x.old_status in ('assigned', 'accepted')
      and x.new_status in ('assigned', 'accepted')
      and x.new_day = x.old_day
      and x.property_id = x.old_property
      and (x.new_from is distinct from x.old_from or x.new_to is distinct from x.old_to)
  ),
  free as materialized (
    -- Free work newly in reach: it became free, or free work moved (the
    -- audience below keeps a move only when it came into the week). Only what
    -- a cleaner may take from the queue, as on INSERT.
    select x.host_id, x.id as task_id, x.property_id, x.new_day, x.old_day, x.type, x.old_assignee,
           (x.old_status is distinct from 'unassigned' or x.old_assignee is not null) as became_free
    from pair x
    where x.new_status = 'unassigned'
      and x.new_assignee is null
      and x.type in ('cleaning', 'midstay')
      and (x.old_status is distinct from 'unassigned' or x.old_assignee is not null
           or x.old_day is distinct from x.new_day)
  )
  insert into raw.push_outbox (host_id, recipient_id, kind, task_id, collapse_key,
                               params, urgent, send_after, expire_at)
  select e.host_id, e.recipient_id, e.kind, e.task_id, 'task:' || e.task_id,
         e.params, w.urgent,
         case when w.urgent then v_now_after else v_calm_after end,
         case when w.urgent then v_now_after else v_calm_after end + v_lifetime
  from (
    select * from ev
    union all
    select f.host_id, tk.profile_id, 'cleaning_free'::public.push_kind, f.task_id, f.property_id,
           f.new_day, f.new_day,
           jsonb_build_object('date', f.new_day, 'type', f.type, 'property', f.property_id)
    from free f
    join public.properties p on p.id = f.property_id
    -- Only phones linked to the listing or its house, as on INSERT.
    join lateral (
      select distinct pc.cleaner_id as profile_id
      from public.property_cleaners pc
      where pc.property_id in (f.property_id, p.parent_id)
        and exists (select 1 from public.push_tokens t where t.profile_id = pc.cleaner_id)
    ) tk on true
    join public.profiles pr on pr.id = tk.profile_id and pr.host_id = f.host_id
    where f.new_day between (now() at time zone p.timezone)::date - v_grace
                        and (now() at time zone p.timezone)::date + v_horizon
      and (f.became_free
           or f.old_day not between (now() at time zone p.timezone)::date - v_grace
                                and (now() at time zone p.timezone)::date + v_horizon)
      -- Not the one it was just taken from: she hears it was taken off her,
      -- and "free" would read as an offer of her own cleaning back.
      and tk.profile_id is distinct from f.old_assignee
      and public.cleans_property_as(tk.profile_id, f.property_id)
  ) e
  join public.properties p on p.id = e.property_id
  join public.profiles pr on pr.id = e.recipient_id and pr.is_active
  cross join lateral (
    select (now() at time zone p.timezone)::date as today
  ) d
  cross join lateral (
    -- Urgent: taken off her, cancelled or moved, today or tomorrow (as above).
    select (e.kind in ('cleaning_cancelled', 'cleaning_moved', 'cleaning_unassigned')
            and (e.day_a in (d.today, d.today + 1) or e.day_b in (d.today, d.today + 1))) as urgent
  ) w
  where e.recipient_id is distinct from v_actor
    and (e.day_a between d.today - v_grace and d.today + v_horizon
         or e.day_b between d.today - v_grace and d.today + v_horizon)
    -- The hours matter today and tomorrow only.
    and (e.kind <> 'cleaning_window' or e.day_b in (d.today, d.today + 1))
    and exists (select 1 from public.push_tokens t where t.profile_id = e.recipient_id)
  order by e.task_id, e.recipient_id, e.kind;

  return null;
end;
$$;

comment on function public.push_on_task_change() is
  'Statement trigger on tasks: writes raw.push_outbox rows for the people a '
  'change of a cleaning or repair is about (docs/f11-plan.md, M3).';

create trigger tasks_push_insert
  after insert on public.tasks
  referencing new table as new_rows
  for each statement
  execute function public.push_on_task_change();

create trigger tasks_push_update
  after update on public.tasks
  referencing old table as old_rows new table as new_rows
  for each statement
  execute function public.push_on_task_change();

-- ---------- conversations ----------

create or replace function public.push_on_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_thread public.chat_threads;
begin
  select th.* into v_thread
  from public.chat_threads th
  where th.id = new.thread_id;

  -- The company inbox (direct threads) has no screen on the phone yet
  -- (layer 6 of the chat, docs/chat-plan.md): a push would lead nowhere.
  if v_thread.kind = 'direct' then
    return null;
  end if;

  insert into raw.push_outbox (host_id, recipient_id, kind, task_id, thread_id, collapse_key,
                               params, urgent, send_after, expire_at)
  select v_thread.host_id, c.who, 'chat_message', v_thread.task_id, v_thread.id,
         'thread:' || v_thread.id,
         jsonb_build_object('subject', v_thread.kind, 'task_id', v_thread.task_id,
                            'problem_id', v_thread.problem_id, 'author_name', new.author_name),
         false,
         public.push_send_after(false),
         public.push_send_after(false) + public.push_lifetime()
  from (
    -- The cleaner of the cleaning.
    select t.assignee_id as who
    from public.tasks t
    where v_thread.kind = 'task' and t.id = v_thread.task_id
    union
    -- The reporter of a report, and whoever holds its live repair.
    select pb.reported_by
    from public.problems pb
    where v_thread.kind = 'problem' and pb.id = v_thread.problem_id
    union
    select t.assignee_id
    from public.tasks t
    where v_thread.kind = 'problem' and t.problem_id = v_thread.problem_id
      and t.status not in ('cancelled', 'expired')
    union
    -- Whoever has written here before.
    select m.author_id
    from public.chat_messages m
    where m.thread_id = v_thread.id and m.id <> new.id
  ) c
  -- Field staff only: the office reads the panel, which asks on its own.
  join public.profiles pr on pr.id = c.who and pr.is_active and pr.role in ('cleaner', 'tech')
  where c.who is not null
    and c.who <> new.author_id
    and exists (select 1 from public.push_tokens t where t.profile_id = c.who)
    -- Only someone who may still read the thread (the twin of the policy):
    -- a colleague who wrote once and has since lost the listing is not told.
    and public.chat_participates_as(c.who, v_thread.kind, v_thread.task_id,
                                    v_thread.problem_id, v_thread.profile_id)
  order by c.who;

  return null;
end;
$$;

comment on function public.push_on_chat_message() is
  'Row trigger on chat_messages: writes raw.push_outbox rows for the field staff '
  'of the thread other than the author (docs/f11-plan.md, M3).';

create trigger chat_messages_push
  after insert on public.chat_messages
  for each row
  execute function public.push_on_chat_message();

-- ---------- a booking cancelled while she cleans ----------

create or replace function public.push_on_booking_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Still a live booking: nothing to say.
  if new.status in ('new', 'modified') then
    return null;
  end if;

  -- The generator leaves work under way alone (20260927120000), so nothing
  -- else tells her. Always urgent: she is in the flat now.
  insert into raw.push_outbox (host_id, recipient_id, kind, task_id, collapse_key,
                               params, urgent, send_after, expire_at)
  select t.host_id, t.assignee_id, 'booking_cancelled_live', t.id, 'task:' || t.id,
         jsonb_build_object('date', t.scheduled_date, 'type', t.type),
         true,
         public.push_send_after(true),
         public.push_send_after(true) + public.push_lifetime()
  from public.tasks t
  join public.profiles pr on pr.id = t.assignee_id and pr.is_active
  where t.reservation_id = new.id
    and t.status in ('in_progress', 'paused')
    and exists (select 1 from public.push_tokens tk where tk.profile_id = t.assignee_id)
  order by t.assignee_id;

  return null;
end;
$$;

comment on function public.push_on_booking_status() is
  'Row trigger on reservations: a booking that stops being live while its '
  'cleaning is under way tells the cleaner (docs/f11-plan.md, M3).';

-- The sync rewrites every column of every booking; only a real change of
-- status may fire.
create trigger reservations_push_status
  after update of status on public.reservations
  for each row
  when (old.status is distinct from new.status)
  execute function public.push_on_booking_status();

-- ---------- the morning summary ----------

create or replace function public.enqueue_daily_digest(p_at timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_local   timestamp := p_at at time zone public.push_timezone();
  v_day     date := (p_at at time zone public.push_timezone())::date;
  -- Asked once, not once a row: a SQL function with its own search_path is
  -- never inlined (as in push_on_task_change).
  v_grace   integer := public.task_grace_days();
  v_horizon integer := public.task_horizon_days();
  v_count   integer;
begin
  -- The job runs every hour so that the change to winter time cannot move the
  -- summary; only the run inside seven o'clock in Prague writes anything.
  if extract(hour from v_local) <> public.push_digest_hour() then
    return 0;
  end if;

  with free_work as materialized (
    -- Free work, counted once a listing, over the days her queue shows it:
    -- from the day of grace (yesterday's, still hers to take, as the claim
    -- policy's task_is_stale has it) to the end of the week — the queue on
    -- her phone and the audience of the push about free work (cleanings
    -- only). Free work that walks into the week by the calendar alone sends
    -- no push of its own (owner's word 2026-09-29), so the morning counts it.
    select t.host_id, t.property_id, p.parent_id, count(*) as free
    from public.tasks t
    join public.properties p on p.id = t.property_id
    where t.status = 'unassigned'
      and t.assignee_id is null
      and t.type in ('cleaning', 'midstay')
      and t.scheduled_date between (p_at at time zone p.timezone)::date - v_grace
                               and (p_at at time zone p.timezone)::date + v_horizon
    group by t.host_id, t.property_id, p.parent_id
  )
  insert into raw.push_outbox (host_id, recipient_id, kind, collapse_key,
                               params, urgent, send_after, expire_at)
  select pr.host_id, pr.id, 'daily_digest', 'digest:' || v_day,
         jsonb_build_object('date', v_day, 'today', s.today, 'new_in_week', s.new_in_week,
                            'free', f.free),
         false, p_at, p_at + public.push_lifetime()
  from public.profiles pr
  left join public.push_preferences pp on pp.profile_id = pr.id
  cross join lateral (
    -- Her work not yet started, counted in each listing's own day: what is
    -- hers today, and what came into her week today.
    select count(*) filter (where t.scheduled_date = (p_at at time zone p.timezone)::date) as today,
           count(*) filter (where t.scheduled_date = (p_at at time zone p.timezone)::date
                                                     + v_horizon) as new_in_week
    from public.tasks t
    join public.properties p on p.id = t.property_id
    where t.assignee_id = pr.id
      and t.status in ('assigned', 'accepted')
  ) s
  cross join lateral (
    -- The free work of the listings she works, unless she switched free work
    -- off. The rule is asked once a listing, not once a cleaning: it is a
    -- function call, and the week of a big claim team holds hundreds of
    -- cleanings (measured 2026-09-29, 300 listings, a claim team of five a
    -- listing: asked per cleaning, the summary took 98 s).
    -- Asked only of a listing she is linked to, or its house, as the push
    -- about free work does: nobody else may take its free work.
    -- A lateral join, and the rule is asked of its row: as a plain qual the
    -- rule would be ordered first by its cost and asked of every listing.
    select coalesce(sum(w.free), 0)::integer as free
    from free_work w
    join lateral (
      select pc.cleaner_id
      from public.property_cleaners pc
      where pc.cleaner_id = pr.id
        and pc.property_id in (w.property_id, w.parent_id)
      limit 1
    ) linked on true
    where w.host_id = pr.host_id
      and not coalesce('cleaning_free' = any (pp.muted), false)
      and public.cleans_property_as(linked.cleaner_id, w.property_id)
  ) f
  where pr.is_active
    and pr.role in ('cleaner', 'tech')
    and exists (select 1 from public.push_tokens tk where tk.profile_id = pr.id)
    and (s.today > 0 or s.new_in_week > 0 or f.free > 0)
  order by pr.id
  on conflict (recipient_id, collapse_key) where kind = 'daily_digest' do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.enqueue_daily_digest(timestamptz) is
  'At seven in Prague: one summary a person with work — what is hers today, '
  'what came into her week, and the free cleanings she may take, as her queue '
  'shows them (unless she switched free work off). Once a day, however often '
  'it is called.';

-- ---------- grants ----------
--
-- The constants and the quiet-hours rule touch no data: like the horizon, they
-- stay readable. Everything that writes the queue is closed to clients; the
-- triggers fire regardless, and the summary is the cron's.

revoke all on function public.push_timezone() from public, anon;
revoke all on function public.push_quiet_start() from public, anon;
revoke all on function public.push_quiet_end() from public, anon;
revoke all on function public.push_digest_hour() from public, anon;
revoke all on function public.push_settle() from public, anon;
revoke all on function public.push_lifetime() from public, anon;
revoke all on function public.push_send_after(boolean, timestamptz) from public, anon;
grant execute on function public.push_timezone() to authenticated, service_role;
grant execute on function public.push_quiet_start() to authenticated, service_role;
grant execute on function public.push_quiet_end() to authenticated, service_role;
grant execute on function public.push_digest_hour() to authenticated, service_role;
grant execute on function public.push_settle() to authenticated, service_role;
grant execute on function public.push_lifetime() to authenticated, service_role;
grant execute on function public.push_send_after(boolean, timestamptz) to authenticated, service_role;

revoke all on function public.push_on_task_change() from public, anon, authenticated;
revoke all on function public.push_on_chat_message() from public, anon, authenticated;
revoke all on function public.push_on_booking_status() from public, anon, authenticated;
revoke all on function public.enqueue_daily_digest(timestamptz) from public, anon, authenticated;
grant execute on function public.enqueue_daily_digest(timestamptz) to service_role;
