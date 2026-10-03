-- The head technician's pushes (docs/tech-plan.md, 5; owner's decisions 5 and
-- 6 of 2026-10-01). The same queue, the same sender and the same rules as F11:
-- what a person switched off, quiet hours and urgency, a minute to settle, one
-- push a group, the language chosen when it is sent.
--
-- - «Новое задание» (problem_new, 20261003150000). A task reported in his
--   company reaches every active head technician with a phone — never the one
--   who reported it, nor whoever wrote the row. A task of high priority is
--   urgent and goes after the settling minute at any hour; the rest waits out
--   quiet hours. One push a task: the collapse key is 'problem:<id>'. The row
--   names the task, its priority, its place and who reported it — not its
--   title or description: the lock screen shows the place and the person, as a
--   message shows the place and its author (F11, owner's word 2). When it is
--   due, a task closed or put away since, or a recipient who is no longer the
--   head technician, is settled as skipped (claim_push_batch).
--
-- - A message in the conversation of any task reaches him: he takes part in
--   all of them (20261003120000). push_on_chat_message counts the head
--   technicians among the people of every task's thread and lets the role
--   through its field-staff filter. A cleaning's thread stays closed to him, so
--   it never names him.
--
-- - The morning summary is his too (enqueue_daily_digest). He holds no link to
--   a listing (20261003110000), so its line of free cleanings never comes.
--
-- - His dispatch reads as the office's. push_on_task_change said "moved by
--   the office" only for a manager, so a repair the head technician moved
--   through assign_problem told its technician "the booking changed". It now
--   asks head_tech_dispatching() as well. And a technician taken off through
--   unassign_problem — by the head technician or by a manager — hears that the
--   work was taken from him (cleaning_unassigned), not that it was cancelled;
--   cancel_problem and archive_problem still cancel it.
--
-- - chat_unread_threads: his unread list without ids asked chat_participates
--   of every thread of his company. A task's thread is his by being in his
--   company, as every work thread is a manager's, so it takes the same short
--   cut; a cleaning's thread and the inbox are still asked.
--
-- Bodies are copied from their latest migrations (push_on_task_change,
-- push_on_chat_message and enqueue_daily_digest from 20260928130000,
-- claim_push_batch from 20260928140000, chat_unread_threads from
-- 20260918160000) with only the changes above. Same signatures: their ACLs and
-- the generated types stay. One new function and one new trigger, on
-- problems: a brief SHARE ROW EXCLUSIVE lock; hence the lock timeout.

set local lock_timeout = '3s';

-- ---------- a new task ----------

create or replace function public.push_on_problem_reported()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  -- A leak at night cannot wait for seven; a squeaking door can.
  v_urgent boolean := new.priority = 'high';
  v_after  timestamptz := public.push_send_after(v_urgent);
begin
  insert into raw.push_outbox (host_id, recipient_id, kind, collapse_key,
                               params, urgent, send_after, expire_at)
  select new.host_id, h.id, 'problem_new', 'problem:' || new.id,
         jsonb_build_object('problem_id', new.id, 'priority', new.priority,
                            'property', new.property_id, 'reporter_name', rp.full_name),
         v_urgent, v_after, v_after + public.push_lifetime()
  from public.profiles h
  left join public.profiles rp on rp.id = new.reported_by
  where h.host_id = new.host_id
    and h.role = 'head_tech'
    and h.is_active
    -- Never the person who reported it, nor whoever wrote it.
    and h.id <> new.reported_by
    and h.id is distinct from v_actor
    and exists (select 1 from public.push_tokens t where t.profile_id = h.id)
  order by h.id;

  return null;
end;
$$;

comment on function public.push_on_problem_reported() is
  'Row trigger on problems: a reported task is queued as problem_new for every '
  'active head technician of the company with a phone but its reporter '
  '(20261003160000).';

create trigger problems_push_reported
  after insert on public.problems
  for each row
  execute function public.push_on_problem_reported();

revoke all on function public.push_on_problem_reported() from public, anon, authenticated;

-- ---------- what the head technician hears of, and how his dispatch reads ----------

create or replace function public.push_on_task_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := (select auth.uid());
  -- The office: a manager, or the head technician dispatching a repair through
  -- assign_problem or unassign_problem (20261003130000). His move reads as
  -- the office's, not as a booking's (20261003160000).
  v_office boolean := v_actor is not null
                      and (coalesce(public.is_manager(), false) or public.head_tech_dispatching());
  -- unassign_problem cancels the attempt under the dispatch setting, and
  -- nothing else cancels under it: for the technician the work is taken from
  -- him, not cancelled (20261003160000).
  v_taken_off boolean := coalesce(current_setting('str_ops.head_tech_dispatch', true), '') = 'on';
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
    -- Cancelled while open, work under way included. Taken off through
    -- unassign_problem, it is taken from her rather than cancelled.
    select x.host_id, x.old_assignee,
           (case when v_taken_off then 'cleaning_unassigned'
                 else 'cleaning_cancelled' end)::public.push_kind,
           x.id, x.property_id,
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
    union
    -- The head technician takes part in the conversation of every task of his
    -- company (20261003120000) and hears of it (decision 5 of 2026-10-01,
    -- 20261003160000).
    select h.id
    from public.profiles h
    where v_thread.kind = 'problem'
      and h.host_id = v_thread.host_id
      and h.role = 'head_tech'
      and h.is_active
  ) c
  -- Field staff only: the office reads the panel, which asks on its own.
  join public.profiles pr on pr.id = c.who and pr.is_active
                         and pr.role in ('cleaner', 'tech', 'head_tech')
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
    -- The head technician's too (20261003160000): his own work. He holds no
    -- link to a listing (20261003110000), so free work never comes into it.
    and pr.role in ('cleaner', 'tech', 'head_tech')
    and exists (select 1 from public.push_tokens tk where tk.profile_id = pr.id)
    and (s.today > 0 or s.new_in_week > 0 or f.free > 0)
  order by pr.id
  on conflict (recipient_id, collapse_key) where kind = 'daily_digest' do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------- at the moment of sending ----------

create or replace function public.claim_push_batch(p_limit integer default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recipients uuid[];
  v_keys       text[];
  v_ids        bigint[];
  v_batch      jsonb;
  -- Whose lease this is: a run that outlives its lease must not let go of
  -- what the next run took over (record_push_results).
  v_lease      uuid := gen_random_uuid();
begin
  -- One sender at a time decides what is due; the lease below keeps the next
  -- one off what this one took once the transaction is over.
  perform pg_advisory_xact_lock(hashtext('public.claim_push_batch'));

  -- A group whose last row has outlived its lifetime is settled as a whole:
  -- never sent late, and never half-sent (a cancellation without the
  -- assignment it cancels would tell her about a job she never heard of).
  update raw.push_outbox o
  set settled_at = now(), outcome = 'expired', claimed_until = null
  from (
    select x.recipient_id, x.collapse_key
    from raw.push_outbox x
    where x.settled_at is null
    group by x.recipient_id, x.collapse_key
    having max(x.expire_at) < now()
       and not coalesce(bool_or(x.claimed_until > now()), false)
  ) dead
  where o.recipient_id = dead.recipient_id
    and o.collapse_key = dead.collapse_key
    and o.settled_at is null;

  -- The groups due now, none of it leased: every urgent row of the group due
  -- or, with none urgent, every row. An urgent change does not wait for seven
  -- behind a calm row about the same cleaning — it takes that row along.
  select array_agg(g.recipient_id order by g.due), array_agg(g.collapse_key order by g.due)
  into v_recipients, v_keys
  from (
    select x.recipient_id, x.collapse_key,
           coalesce(max(x.send_after) filter (where x.urgent), max(x.send_after)) as due
    from raw.push_outbox x
    where x.settled_at is null
    group by x.recipient_id, x.collapse_key
    having coalesce(max(x.send_after) filter (where x.urgent), max(x.send_after)) <= now()
       and not coalesce(bool_or(x.claimed_until > now()), false)
    order by 3
    limit greatest(p_limit, 0)
  ) g;

  if v_recipients is null then
    return '[]'::jsonb;
  end if;

  -- Checked now, not when the event was written. The kinds she switched off
  -- are not among these: a group is folded first and judged by what it folds
  -- into — muting one half of "given, then taken away" would send the other
  -- half, about work she never had.
  update raw.push_outbox o
  set settled_at = now(), outcome = v.outcome, claimed_until = null
  from (
    select x.id,
           case
             when not pr.is_active then 'skipped'
             when not exists (select 1 from public.push_tokens t where t.profile_id = x.recipient_id)
               then 'skipped'
             when x.kind = 'chat_message' and not coalesce((
                    select public.chat_participates_as(x.recipient_id, th.kind, th.task_id,
                                                       th.problem_id, th.profile_id)
                    from public.chat_threads th where th.id = x.thread_id), false)
               then 'skipped'
             -- Somebody took it since, it left her week, or she no longer
             -- cleans the listing: telling her it is free would send her after
             -- work that is not there, or not hers to take.
             when x.kind = 'cleaning_free' and not exists (
                    select 1 from public.tasks t
                    join public.properties p on p.id = t.property_id
                    where t.id = x.task_id and t.status = 'unassigned' and t.assignee_id is null
                      and t.type in ('cleaning', 'midstay')
                      and t.scheduled_date
                          between (now() at time zone p.timezone)::date - public.task_grace_days()
                              and (now() at time zone p.timezone)::date + public.task_horizon_days()
                      and public.cleans_property_as(x.recipient_id, t.property_id))
               then 'skipped'
             -- A new task that is no longer news: closed or put away since, or
             -- she is no longer the head technician (20261003160000).
             when x.kind = 'problem_new' and (pr.role <> 'head_tech' or not exists (
                    select 1 from public.problems pb
                    where pb.id = (x.params ->> 'problem_id')::uuid
                      and pb.host_id = pr.host_id
                      and pb.archived_at is null
                      and pb.status not in ('resolved', 'cancelled')))
               then 'skipped'
           end as outcome
    from raw.push_outbox x
    join unnest(v_recipients, v_keys) as g(recipient_id, collapse_key)
      on g.recipient_id = x.recipient_id and g.collapse_key = x.collapse_key
    join public.profiles pr on pr.id = x.recipient_id
    where x.settled_at is null
  ) v
  where o.id = v.id
    and v.outcome is not null;

  -- A group of nothing but kinds she switched off: whatever it folds into is
  -- one of them. Settled here, never handed out.
  update raw.push_outbox o
  set settled_at = now(), outcome = 'muted', claimed_until = null
  from (
    select x.recipient_id, x.collapse_key
    from raw.push_outbox x
    join unnest(v_recipients, v_keys) as g(recipient_id, collapse_key)
      on g.recipient_id = x.recipient_id and g.collapse_key = x.collapse_key
    left join public.push_preferences pp on pp.profile_id = x.recipient_id
    where x.settled_at is null
    group by x.recipient_id, x.collapse_key
    having bool_and(x.kind = any (coalesce(pp.muted, '{}')))
  ) m
  where o.recipient_id = m.recipient_id
    and o.collapse_key = m.collapse_key
    and o.settled_at is null;

  -- The rest is the sender's for the length of the lease: rows already due,
  -- and calm rows the group's urgent ones take along. An urgent row written a
  -- moment ago waits for its own group.
  with leased as (
    update raw.push_outbox o
    set claimed_until = now() + public.push_lease(),
        claimed_at = now(),
        claimed_by = v_lease
    from unnest(v_recipients, v_keys) as g(recipient_id, collapse_key)
    where o.recipient_id = g.recipient_id
      and o.collapse_key = g.collapse_key
      and o.settled_at is null
      and (o.send_after <= now() or not o.urgent)
    returning o.id
  )
  select array_agg(l.id) into v_ids from leased l;

  if v_ids is null then
    return '[]'::jsonb;
  end if;

  with located as (
    -- The flat a row is about: the one it was written about, else the
    -- cleaning's own, or, for a message about a report, the report's.
    select o.*,
           coalesce(
             (o.params ->> 'property')::bigint,
             (select t.property_id from public.tasks t where t.id = o.task_id),
             (select pb.property_id from public.problems pb
              where pb.id = (o.params ->> 'problem_id')::uuid)
           ) as property_id
    from raw.push_outbox o
    where o.id = any (v_ids)
  ),
  r as (
    -- And every place a row names: that flat and the two ends of a move.
    select l.*,
           array_remove(array[
             l.property_id,
             (l.params ->> 'from_property')::bigint,
             (l.params ->> 'to_property')::bigint
           ], null) as property_ids
    from located l
  ),
  places as (
    select u.recipient_id, u.collapse_key,
           jsonb_object_agg(p.id::text, jsonb_build_object(
             'name', p.name,
             'hostaway_unit_id', p.hostaway_unit_id,
             'parent', case when par.id is null then null
                            else jsonb_build_object('name', par.name) end)) as places
    from (select distinct r.recipient_id, r.collapse_key, unnest(r.property_ids) as property_id
          from r) u
    join public.properties p on p.id = u.property_id
    left join public.properties par on par.id = p.parent_id
    group by u.recipient_id, u.collapse_key
  ),
  groups as (
    select r.recipient_id, r.collapse_key, max(r.send_after) as due,
           jsonb_agg(jsonb_build_object(
             'id', r.id, 'kind', r.kind, 'task_id', r.task_id, 'thread_id', r.thread_id,
             'property_id', r.property_id, 'params', r.params, 'urgent', r.urgent,
             'created_at', r.created_at)
             order by r.id) as rows
    from r
    group by r.recipient_id, r.collapse_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'recipient_id', g.recipient_id,
           'collapse_key', g.collapse_key,
           'lease', v_lease,
           -- The kinds she switched off: the sender judges the folded push by them.
           'muted', to_jsonb(coalesce(
             (select pp.muted from public.push_preferences pp where pp.profile_id = g.recipient_id),
             '{}'::public.push_kind[])),
           'language', (
             select coalesce(pr.preferred_language,
                             (select t.language from public.push_tokens t
                              where t.profile_id = pr.id and t.language is not null
                              order by t.updated_at desc limit 1),
                             h.default_language,
                             'ru')
             from public.profiles pr
             left join public.hosts h on h.id = pr.host_id
             where pr.id = g.recipient_id),
           'tokens', (
             select coalesce(jsonb_agg(jsonb_build_object('token', t.token, 'platform', t.platform)
                                       order by t.updated_at desc, t.token), '[]'::jsonb)
             from public.push_tokens t where t.profile_id = g.recipient_id),
           'places', coalesce(pl.places, '{}'::jsonb),
           'rows', g.rows)
         order by g.due, g.recipient_id, g.collapse_key), '[]'::jsonb)
  into v_batch
  from groups g
  left join places pl on pl.recipient_id = g.recipient_id and pl.collapse_key = g.collapse_key;

  return v_batch;
end;
$$;

-- ---------- his unread list ----------

create or replace function public.chat_unread_threads(
  p_task_ids    uuid[] default null,
  p_problem_ids uuid[] default null
)
returns table (
  thread_id       uuid,
  kind            public.chat_thread_kind,
  task_id         uuid,
  problem_id      uuid,
  profile_id      uuid,
  last_message_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $fn$
  -- `not materialized`: `me` is referenced three times, and a materialized
  -- CTE would turn the marker join into a hash over ALL of chat_reads instead
  -- of an index probe by the caller (seen in the layer 4 preflight).
  with me as not materialized (
    select p.id, p.host_id, (p.role in ('manager', 'admin')) as is_manager,
           (p.role = 'head_tech') as is_head_tech
    from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  ),
  -- Two branches, not one `or`. A definer SQL function cannot be inlined, so
  -- its body is planned once with the arrays as unknown parameters, and an
  -- `or` whose first disjunct mentions no column is not indexable: the phone's
  -- call with 60 ids walked every thread of every tenant (51 500 rows removed
  -- by filter in the preflight). Split on the parameter-only test, each branch
  -- gets a one-time filter and the ids branch a BitmapOr over the two partial
  -- indexes. No ids at all means the whole company; an empty array means
  -- nothing (`= any(null)` is as false as `= any('{}')`).
  candidates as (
    select th.*
    from me
    join public.chat_threads th on th.host_id = me.host_id
    where p_task_ids is null and p_problem_ids is null
    union all
    select th.*
    from me
    join public.chat_threads th on th.host_id = me.host_id
    where (p_task_ids is not null or p_problem_ids is not null)
      and (th.task_id = any (p_task_ids) or th.problem_id = any (p_problem_ids))
  )
  select th.id, th.kind, th.task_id, th.problem_id, th.profile_id, th.last_message_at
  from me
  join candidates th on true
  left join public.chat_reads r on r.thread_id = th.id and r.profile_id = me.id
  where th.last_message_at > coalesce(r.last_read_at, '-infinity')
    and th.last_author_id is distinct from me.id
    -- `case`, not `or`: SQL does not promise to short-circuit, and the whole
    -- point is that a manager never pays for the field-staff branch. Only
    -- work threads take the short cut: for those the manager branch of
    -- chat_participates is exactly "same host", which the join above already
    -- is. A direct thread is not -- its subject must still be field staff,
    -- so somebody promoted out of the field takes her inbox out of everyone's
    -- reach, and the rule is asked, not assumed.
    and case
          when me.is_manager and th.kind <> 'direct' then true
          -- The head technician takes part in the conversation of every task
          -- of his company (20261003120000): for a task's thread his branch of
          -- chat_participates is "same company", which the join already is. A
          -- cleaning's thread and the inbox are asked (20261003160000).
          when me.is_head_tech and th.kind = 'problem' then true
          else public.chat_participates(th.kind, th.task_id, th.problem_id, th.profile_id)
        end
  order by th.last_message_at desc
$fn$;
