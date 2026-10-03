-- The technician and the cleanings (docs/tech-plan.md, §2; owner's word 2026-10-01).
--
-- A technician sees and does only the work handed to him; cleanings are not
-- his — nor the head technician's (§3). The database refuses every write that
-- would make one his, whoever writes it, and every rule below holds for both
-- roles:
--
-- - a link to a listing (property_cleaners): a trigger on any insert or update
--   of a link, so the RPC save_property_cleaner, the manager's direct write and
--   the server context are all refused — and so is any edit of an old link:
--   turned from 'claim' into 'auto' it would feed him the generator's
--   cleanings. An old link is only taken off.
--
-- - a cleaning, a mid-stay cleaning or an inspection with his name on it: a
--   trigger on tasks, on every insert and on every update that writes the
--   person or the kind of job. Its WHEN leaves out repairs and work nobody
--   holds, so the function is not even called for them. Every road meets it:
--   save_task, the manager's direct insert or PATCH, the take («Взять») of a
--   free cleaning through an old link, the generator. An old cleaning on him
--   is the office's to take off — handed to a cleaner, put back in the queue,
--   cancelled — and a write that keeps his name on it is refused.
--
--   A second trigger asks the same rule of the one write that names neither
--   and still hands him a cleaning: the status alone, from done, cancelled or
--   expired back to a live one, on a cleaning that carries his name — a closed
--   one from before the rule, or one closed while he was still a cleaner. A
--   manager's PATCH or the server could write it, and he could then start and
--   finish it. The office brings such a cleaning back by handing it to a
--   cleaner in the same write. Moves between live states, into a closed state
--   or between closed states do not wake it.
--
-- - a change of role to tech or head_tech while the person still holds links
--   or open cleanings (a cleaning, a mid-stay cleaning or an inspection that is
--   neither done, cancelled nor expired): a trigger on profiles, which both
--   paths that change a role hit — manage-staff, which upserts the row as the
--   service role, and a manager writing the row. The manager takes them off
--   first; nothing is lost quietly. Only a change into the role is asked: an
--   edit that keeps the role is an edit, whatever old rows the person holds,
--   so an old link in the cloud (one technician, docs/tech-plan.md §1) does not
--   stop an edit of his phone number.
--
-- What holds for the old rows, written before this file: nothing here removes
-- them, and reading does not ask the role (§2.4). Until the owner takes the
-- technician's links off in «Команда» — the gate before the push,
-- docs/tech-plan.md §12 — cleans_property stays true for him on those
-- listings: he reads their tasks, and only the table stops his take. A closed
-- cleaning on him stays his to read, with its listing.
--
-- The generator never meets the refusal in practice. It names a person only
-- through an 'auto' link — in its insert and in its hand-over pass; its other
-- passes write neither the person nor the kind, and the trigger does not wake
-- for them. No technician can hold an 'auto' link: a new one is refused, an
-- old 'claim' link cannot be turned into one, and nobody becomes a technician
-- while holding any link. A run that did meet one would roll back whole, which
-- is why the gate takes the old links off before the push. The second trigger
-- it cannot meet at all: it brings no closed cleaning back (its latest body,
-- 20260927120000). Of its passes only three write a status, and each reads
-- live rows alone — the reschedule (unassigned, assigned or accepted; an
-- accepted one that moves goes back to assigned), the hand-over (unassigned to
-- assigned) and the cancel (live to cancelled); the relocate and the refresh
-- write no status; and a booking whose cleaning was closed is owed a new row
-- from the insert, never the old one back.
--
-- What the rule costs the generator was measured through the call, rolled
-- back (docs/tech-plan.md §12): about 16 µs per cleaning handed out — 0.11 to
-- 0.12 s for 7200 of them in one round of 9000 — and nothing for the passes it
-- does not wake for.
--
-- With no links the rest follows and is proven by supabase/tests/tech_rules.sql,
-- not coded here: cleans_property is false for him, so he sees no free queue
-- and has nothing to take; the push about free work and the morning count of
-- it go to linked people only.
--
-- Reading tasks does not change (§2.4): a role in the hot policies would cost a
-- call on every row of a feed, and reading must not hide a cleaning already
-- handed out — it would be a cleaning nobody does.
--
-- The refusals follow CLAUDE.md: an English message, the i18n key in hint, the
-- parameters as JSON in detail. A role check and the write it guards meet on
-- the person's profile row: the link trigger, the tasks trigger and save_task
-- read it FOR SHARE, and the role change writes it, so whichever comes second
-- waits for the first and then sees what it wrote — a cleaning handed out
-- first is counted by the role guard, a role changed first is seen by the
-- trigger. That closes the race of a role change with a generator run or a
-- save. The read has a price: any update of the profile row of a person just
-- handed a cleaning — her language, phone or name, from her phone, the panel
-- or manage-staff — waits for that run or save to commit. Seconds at most (the
-- generator's budget is 8 s, a save takes milliseconds), and no deadlock: a
-- share lock is granted beside other share locks without queueing behind an
-- updater that waits, so the run never waits for the update it holds back,
-- and a profile write holds nothing else (its triggers only read).
--
-- save_task keeps its own check of the cleaning rule, on every save that names
-- a technician on such a job — a new task or an edit, whether or not it
-- changes the person or the kind: it answers before the questions about
-- duplicates (otherwise the panel would ask «save anyway?» about a save the
-- table then refuses), and costs nothing, since the role comes with the FOR
-- SHARE read that already checks the assignee. A repair still goes to anybody
-- on the spot (owner, 2026-10-01). Its body is copied from 20260928110000
-- with only that check; same signature, so its ACL and the generated types
-- stay. The triggers take a brief lock on property_cleaners, tasks and
-- profiles.

set local lock_timeout = '3s';

-- ---------- 1. a technician is linked to no listing ----------

create or replace function public.guard_link_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  select p.role into v_role
  from public.profiles p
  where p.id = new.cleaner_id
  for share;

  if v_role in ('tech', 'head_tech') then
    raise exception 'A technician is not linked to listings: % is %', new.cleaner_id, v_role
      using errcode = 'check_violation', hint = 'serverErrors.techNotLinkable';
  end if;

  return new;
end;
$$;

-- Any write of a link, not only of its person: an old link of a technician,
-- from before this file, turned from 'claim' into 'auto' would hand him the
-- listing's cleanings from the generator.
create trigger property_cleaners_no_tech
  before insert or update on public.property_cleaners
  for each row execute function public.guard_link_role();

comment on function public.guard_link_role() is
  'A technician or the head technician holds no link to a listing, and an old one '
  'is only taken off: cleanings are not their work (docs/tech-plan.md, 2.1; '
  '20261003110000).';

-- ---------- 2. no cleaning carries a technician's name ----------

create or replace function public.guard_cleaning_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.app_role;
begin
  -- FOR SHARE: a change of the person's role waits for this write, and this
  -- write for a change already under way.
  select p.role into v_role
  from public.profiles p
  where p.id = new.assignee_id
  for share;

  if v_role in ('tech', 'head_tech') then
    raise exception 'A % is not handed to a technician: % is %', new.type, new.assignee_id, v_role
      using errcode = 'check_violation',
            hint = 'serverErrors.cleaningNotForTech',
            detail = jsonb_build_object('type', new.type)::text;
  end if;

  return new;
end;
$$;

-- Wakes for a cleaning of any kind with a person on it, and only when the
-- write names the person or the kind; a repair, free work, and a change of
-- the status, the day or the hours never call it. Sorts after the guards on
-- tasks, so it sees the row as they leave it.
create trigger tasks_no_cleaning_for_tech
  before insert or update of assignee_id, type on public.tasks
  for each row
  when (new.type in ('cleaning', 'midstay', 'inspection') and new.assignee_id is not null)
  execute function public.guard_cleaning_assignee();

-- The write the trigger above does not see: the status alone, bringing a
-- closed cleaning with a person on it back to life. Only that move wakes it;
-- a write that also names the person or the kind calls the rule twice, and
-- the answer is the same. Sorts right after the one above.
create trigger tasks_no_cleaning_for_tech_revived
  before update of status on public.tasks
  for each row
  when (old.status in ('done', 'cancelled', 'expired')
        and new.status not in ('done', 'cancelled', 'expired')
        and new.type in ('cleaning', 'midstay', 'inspection')
        and new.assignee_id is not null)
  execute function public.guard_cleaning_assignee();

comment on function public.guard_cleaning_assignee() is
  'No cleaning, mid-stay cleaning or inspection is written with a technician or the '
  'head technician on it, whoever writes it: save_task, a manager directly, the '
  'take, the generator — nor brought back from closed while it carries his name '
  '(docs/tech-plan.md, 2.2; 20261003110000).';

-- ---------- 3. nobody becomes a technician with cleanings on them ----------

create or replace function public.guard_tech_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_links     integer;
  v_cleanings integer;
begin
  -- Only a change into a technician's role is asked: an edit that keeps the
  -- role is an edit, whatever old rows the person still holds. The privilege
  -- guard runs first (its name sorts first) and has already put back a role
  -- the caller may not change.
  if new.role not in ('tech', 'head_tech') or new.role = old.role then
    return new;
  end if;

  select count(*) into v_links
  from public.property_cleaners pc
  where pc.cleaner_id = new.id;

  select count(*) into v_cleanings
  from public.tasks t
  where t.assignee_id = new.id
    and t.type in ('cleaning', 'midstay', 'inspection')
    and t.status not in ('done', 'cancelled', 'expired');

  if v_links > 0 or v_cleanings > 0 then
    raise exception 'Person % still holds % listing links and % open cleanings',
      new.id, v_links, v_cleanings
      using errcode = 'check_violation',
            hint = 'serverErrors.techRoleBlocked',
            detail = jsonb_build_object('links', v_links, 'cleanings', v_cleanings)::text;
  end if;

  return new;
end;
$$;

create trigger profiles_guard_tech_role
  before update of role on public.profiles
  for each row execute function public.guard_tech_role_change();

comment on function public.guard_tech_role_change() is
  'Nobody becomes a technician or the head technician while holding listing links '
  'or open cleanings; the manager takes them off first (docs/tech-plan.md, 2.1; '
  '20261003110000). Both paths that change a role hit it: manage-staff and a '
  'manager writing the profile.';

revoke all on function public.guard_link_role() from public, anon, authenticated;
revoke all on function public.guard_cleaning_assignee() from public, anon, authenticated;
revoke all on function public.guard_tech_role_change() from public, anon, authenticated;

-- ---------- 4. save_task says so before its other questions ----------

create or replace function public.save_task(
  p_id              uuid,
  p_property_id     bigint,
  p_type            public.task_type,
  p_scheduled_date  date,
  p_title           text default null,
  -- Null, not '{}': the default is what an omitted argument means, and an
  -- omitted argument here says nothing about the translations rather than
  -- asking for them to be emptied.
  p_title_i18n      jsonb default null,
  p_assignee_id     uuid default null,
  p_time_from       time default null,
  p_time_to         time default null,
  p_notes           text default null,
  p_priority        integer default null,
  p_allow_duplicate boolean default false,
  -- The day the form was opened with. A booking may move its cleaning while
  -- the form is open, and the day the form then sends is not a manager's
  -- move but a stale one; with a move now holding (20260926160000) it would
  -- stay. Null — a caller that does not send it, the panel before this
  -- migration — says nothing: nothing is checked, and no move is recorded;
  -- the booking takes its cleaning back on the next run, as before.
  p_expected_date   date default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_host      uuid := public.current_host_id();
  v_task      public.tasks;
  v_title     text := nullif(btrim(coalesce(p_title, '')), '');
  v_property  bigint := p_property_id;
  v_type      public.task_type := p_type;
  v_status    public.task_status;
  v_arrival          date;
  v_departure        date;
  v_pinned_arrival   date;
  v_pinned_departure date;
  v_pinned_rooms     bigint[];
  v_booking_cleaning boolean := false;
  v_moves            boolean := false;
  v_priority         smallint;
  v_due_at           timestamptz;
  v_guests           smallint;
  v_window_from      time;
  v_window_to        time;
  v_lands            boolean;
  v_assignee_role    public.app_role;
begin
  if not public.is_manager() then
    raise exception 'Only a manager may do this'
      using errcode = 'insufficient_privilege', hint = 'serverErrors.managerOnly';
  end if;

  select t.* into v_task
  from public.tasks t
  where t.id = p_id and t.host_id = v_host
  for update;

  if found then
    if v_task.status in ('done', 'cancelled', 'expired') then
      raise exception 'Task is % and can no longer be edited', v_task.status
        using errcode = 'check_violation',
              hint = 'serverErrors.taskClosed',
              detail = jsonb_build_object('status', v_task.status)::text;
    end if;
    -- A save that lands on the day the task already stands on is no stale
    -- form: the replay of a move whose answer was lost, most often
    -- (20260927120000).
    if p_expected_date is not null
       and p_expected_date is distinct from v_task.scheduled_date
       and p_scheduled_date is distinct from v_task.scheduled_date then
      raise exception 'Task % was moved to % while the form was open', p_id, v_task.scheduled_date
        using errcode = 'check_violation',
              hint = 'serverErrors.taskMovedMeanwhile',
              detail = jsonb_build_object('date', v_task.scheduled_date)::text;
    end if;
    -- A generated task keeps the flat and the kind it was generated with.
    if v_task.reservation_id is not null or v_task.problem_id is not null then
      v_property := v_task.property_id;
      v_type     := v_task.type;
    end if;
  end if;

  -- No title is a title: the app calls the task by its type.
  if length(v_title) > public.task_title_max_length() then
    raise exception 'The title is longer than % characters', public.task_title_max_length()
      using errcode = 'check_violation',
            hint = 'serverErrors.taskTitleTooLong',
            detail = jsonb_build_object('limit', public.task_title_max_length())::text;
  end if;
  if p_title_i18n is not null and not public.is_localized_text(p_title_i18n) then
    raise exception 'Translations must be an object of language code to text'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.translationsInvalid';
  end if;
  if v_property is null
     or not exists (select 1 from public.properties pr
                    where pr.id = v_property and pr.host_id = v_host) then
    raise exception 'Listing % is not in this company', v_property
      using errcode = 'check_violation', hint = 'serverErrors.propertyNotFound';
  end if;
  if p_scheduled_date is null then
    raise exception 'A task needs a day'
      using errcode = 'check_violation', hint = 'serverErrors.taskDateRequired';
  end if;
  if p_assignee_id is not null then
    -- FOR SHARE: a change of the person's role waits for this save, and this
    -- save for a change already under way (20261003110000).
    select pr.role into v_assignee_role
    from public.profiles pr
    where pr.id = p_assignee_id and pr.host_id = v_host and pr.is_active
    for share;
    if not found then
      raise exception 'Assignee is not an active member of this company'
        using errcode = 'check_violation', hint = 'serverErrors.taskAssigneeInvalid';
    end if;
    -- Cleanings of every kind are a cleaner's; a repair goes to whoever is on
    -- the spot (docs/tech-plan.md, 2.2). The table refuses it too
    -- (tasks_no_cleaning_for_tech); asked here of the kind the task ends up
    -- with, on every save that names him, so the answer comes before the
    -- questions about duplicates below.
    if v_type in ('cleaning', 'midstay', 'inspection')
       and v_assignee_role in ('tech', 'head_tech') then
      raise exception 'A % is not handed to a technician', v_type
        using errcode = 'check_violation',
              hint = 'serverErrors.cleaningNotForTech',
              detail = jsonb_build_object('type', v_type)::text;
    end if;
  end if;

  -- Both questions below are asked when a task lands on a flat and a day —
  -- created, or moved there, or turned into another kind of job — and not
  -- again on every later edit of a pair the manager has already confirmed
  -- (20260926160000; before, the first one was asked on every save).
  v_lands := v_task.id is null
             or p_scheduled_date is distinct from v_task.scheduled_date
             or v_property is distinct from v_task.property_id
             or v_type is distinct from v_task.type;

  -- The same kind of job, on the same flat, on the same day. A job from a
  -- booking or from a report is not one of these — it was not written by
  -- hand — and a cancelled or expired one is out of the way by definition.
  if not coalesce(p_allow_duplicate, false)
     and v_lands
     and exists (select 1 from public.tasks t
                 where t.host_id = v_host
                   and t.property_id = v_property
                   and t.type = v_type
                   and t.scheduled_date = p_scheduled_date
                   and t.reservation_id is null
                   and t.problem_id is null
                   and t.status not in ('cancelled', 'expired')
                   and t.id <> p_id) then
    raise exception 'A % task for listing % on % already exists',
      v_type, v_property, p_scheduled_date
      using errcode = 'check_violation',
            hint = 'serverErrors.taskDuplicate',
            detail = jsonb_build_object('type', v_type, 'date', p_scheduled_date)::text;
  end if;

  -- A booking's cleaning on the same flat and day is the same question
  -- (20260926160000): the flat is already being cleaned.
  if not coalesce(p_allow_duplicate, false)
     and v_lands
     and v_type = 'cleaning'
     and exists (select 1 from public.tasks t
                 where t.host_id = v_host
                   and t.property_id = v_property
                   and t.type = 'cleaning'
                   and t.scheduled_date = p_scheduled_date
                   and t.reservation_id is not null
                   and t.status not in ('cancelled', 'expired')
                   and t.id <> p_id) then
    raise exception 'A cleaning for listing % on % already exists',
      v_property, p_scheduled_date
      using errcode = 'check_violation',
            hint = 'serverErrors.taskDuplicate',
            detail = jsonb_build_object('type', 'cleaning', 'date', p_scheduled_date)::text;
  end if;

  -- A booking's cleaning moved off its departure day holds there while the
  -- booking keeps the dates and the rooms it had at the move (the rooms since
  -- 20260927120000); moved back onto the departure, it follows the booking
  -- again. An edit that says nothing new about the day keeps what was. A move
  -- brings what the phone says about the next check-in to the new day
  -- (option B, 20260926160000), and the window with it: the window of a
  -- booking's cleaning is the server's, moved or not, as the generator writes
  -- it for every unmoved one nobody has started — so a save that keeps the day
  -- keeps the window, whatever times it sends and whatever the status
  -- (20260927120000).
  v_pinned_arrival   := v_task.pinned_arrival;
  v_pinned_departure := v_task.pinned_departure;
  v_pinned_rooms     := v_task.pinned_rooms;
  if v_task.reservation_id is not null and v_task.type = 'cleaning' then
    v_booking_cleaning := true;
    select r.arrival_date, r.departure_date into v_arrival, v_departure
    from public.reservations r
    where r.id = v_task.reservation_id;

    v_moves := p_expected_date is not null
               and p_scheduled_date is distinct from v_task.scheduled_date;
    if p_expected_date is null then
      null;  -- the old panel: no word on a move either way
    elsif p_scheduled_date = v_departure then
      v_pinned_arrival   := null;
      v_pinned_departure := null;
      v_pinned_rooms     := null;
    elsif v_moves then
      v_pinned_arrival   := v_arrival;
      v_pinned_departure := v_departure;
      v_pinned_rooms     := public.reservation_rooms(v_task.reservation_id);
    end if;

    if v_moves then
      select f.priority, f.due_at, f.guests_count, f.window_from, f.window_to
        into v_priority, v_due_at, v_guests, v_window_from, v_window_to
      from public.cleaning_turnover_on(v_task.reservation_id, v_task.property_id,
                                       p_scheduled_date) f;
    end if;
  end if;

  -- Handing the job out moves it out of the queue; taking the executor away
  -- puts it back, but only while nobody has started. A task already in
  -- progress keeps its status: the work happened, whatever the roster says.
  v_status := case
    when v_task.id is null then
      case when p_assignee_id is null then 'unassigned'::public.task_status
           else 'assigned'::public.task_status end
    when p_assignee_id is null and v_task.status in ('unassigned', 'assigned', 'accepted')
      then 'unassigned'::public.task_status
    when p_assignee_id is not null and v_task.status = 'unassigned'
      then 'assigned'::public.task_status
    -- What she accepted was this job, for her, on this day and flat
    -- (20260928110000). Another person, day, flat or kind of job has
    -- been accepted by nobody yet.
    when v_task.status = 'accepted'
         and (p_assignee_id is distinct from v_task.assignee_id or v_lands)
      then 'assigned'::public.task_status
    else v_task.status
  end;

  if v_task.id is null then
    insert into public.tasks (
      id, host_id, property_id, type, status, priority, assignee_id,
      scheduled_date, time_from, time_to, notes, title, title_i18n
    ) values (
      p_id, v_host, v_property, v_type, v_status, coalesce(p_priority, 0), p_assignee_id,
      p_scheduled_date, p_time_from, p_time_to, nullif(btrim(coalesce(p_notes, '')), ''),
      v_title, coalesce(p_title_i18n, '{}'::jsonb)
    )
    returning * into v_task;
  else
    update public.tasks t
    set property_id      = v_property,
        type             = v_type,
        status           = v_status,
        priority         = case when v_moves then v_priority
                                else coalesce(p_priority, t.priority) end,
        assignee_id      = p_assignee_id,
        scheduled_date   = p_scheduled_date,
        time_from        = case when v_moves then v_window_from
                                when v_booking_cleaning then t.time_from
                                else p_time_from end,
        time_to          = case when v_moves then v_window_to
                                when v_booking_cleaning then t.time_to
                                else p_time_to end,
        notes            = nullif(btrim(coalesce(p_notes, '')), ''),
        title            = v_title,
        -- Nothing sent means nothing said about the translations.
        title_i18n       = coalesce(p_title_i18n, t.title_i18n),
        due_at           = case when v_moves then v_due_at else t.due_at end,
        guests_count     = case when v_moves then v_guests else t.guests_count end,
        pinned_arrival   = v_pinned_arrival,
        pinned_departure = v_pinned_departure,
        pinned_rooms     = v_pinned_rooms
    where t.id = p_id
    returning * into v_task;
  end if;

  return v_task;
end;
$$;
