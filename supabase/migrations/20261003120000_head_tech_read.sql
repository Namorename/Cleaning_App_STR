-- The head technician: what he reads (docs/tech-plan.md, 3.2, path «В»; owner's
-- decisions 4, 5 and 7 of 2026-10-01).
--
-- He sees every task of his company (problems) with its history, the archived
-- ones too; the repairs that answer them, with their steps and photos; the
-- places those tasks are about — photos, descriptions, addresses and door
-- codes, of those places only; and the conversation of every task, in which he
-- also writes. He does not see cleanings, inspections or mid-stay cleanings,
-- nor their steps, photos and conversations; bookings; the free queue (no
-- links, 20261003110000); colleagues' addresses and phones; places with no
-- task; supply requests; the office's notes. A manual repair with no task
-- behind it is the office's and stays out of his sight.
--
-- - is_head_tech(), written as is_manager(): the role is the profile's, which
--   only manage-staff writes, from app_metadata — never user_metadata — and an
--   inactive profile has no role at all.
-- - One SELECT policy each on problems, tasks (repairs of problems), task_steps
--   and task_media (of those repairs), and properties (the places of his
--   tasks, through head_tech_property_ids(), and the house above a room among
--   them). A problem's own photos and a message's photos follow by themselves:
--   their policies ask whether the caller reads the problem or the message.
--   Every name starts with "head tech", so it sorts right after the managers'
--   (permissive policies are OR'ed in descending order of name): the manager
--   never reaches it. The role is asked as (select public.is_head_tech()), an
--   InitPlan: once a query, not once a row, for everybody else. And each keeps
--   host_id = current_host_id(), which is hoisted into the index condition.
-- - chat_participates and its twin chat_participates_as: the head technician
--   takes part in the conversation of every task of his company, archived ones
--   too, and has an inbox with the office like any field worker. The twins
--   change together (supabase/tests/chat.sql asks both about everybody). The
--   push about a chat message still writes to cleaners and technicians only:
--   whether the head technician hears of every conversation is the push
--   stage's question.
-- - staff_directory(): his colleagues' names, roles and whether they still
--   work here, for the history of a task and for choosing a technician.
--   profiles stay closed to him: an address and a phone are not his to read.
--
-- No table changes and no grants on tables: every table already grants SELECT
-- to authenticated. The new policies take a brief lock on five tables.

set local lock_timeout = '3s';

-- ---------- who he is ----------

create or replace function public.is_head_tech()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() = 'head_tech', false)
$$;

comment on function public.is_head_tech() is
  'The caller is the active head technician of his company (20261003120000). '
  'Called in policies as (select public.is_head_tech()): once a query.';

-- The places his tasks are about, and the listing above any of them: the phone
-- names a room by its house and reads the key box through the parent, as for
-- field staff (staff_property_ids).
create or replace function public.head_tech_property_ids()
returns setof bigint
language sql
stable
security definer
set search_path = ''
as $$
  with tie as (
    select pr.property_id as id
    from public.problems pr
    where pr.host_id = (select public.current_host_id())
      and pr.property_id is not null
  )
  select s.id
  from (
    select tie.id from tie
    union
    select p.parent_id
    from public.properties p
    join tie on tie.id = p.id
    where p.parent_id is not null
  ) s
  where (select public.is_head_tech());
$$;

comment on function public.head_tech_property_ids() is
  'The places the head technician reads: those his company''s tasks are about, '
  'and the listing above any of them (decision 4 of 2026-10-01, 20261003120000). '
  'Nothing for anybody else.';

-- Names, not profiles: the history of a task names who reported, assigned and
-- did it, and the choice of a technician names who can. Inactive people stay
-- in: a task outlives the job of the person who reported it.
create or replace function public.staff_directory()
returns table (id uuid, full_name text, role public.app_role, is_active boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.role, p.is_active
  from public.profiles p
  where p.host_id = (select public.current_host_id())
    and ((select public.is_head_tech()) or (select public.is_manager()))
  order by p.full_name, p.id;
$$;

comment on function public.staff_directory() is
  'The people of the caller''s company by name and role, for the head technician '
  'and the manager; nothing for anybody else. No address, no phone (20261003120000).';

revoke all on function public.is_head_tech() from public, anon;
revoke all on function public.head_tech_property_ids() from public, anon;
revoke all on function public.staff_directory() from public, anon;
grant execute on function public.is_head_tech() to authenticated, service_role;
grant execute on function public.head_tech_property_ids() to authenticated, service_role;
grant execute on function public.staff_directory() to authenticated, service_role;

-- ---------- what he reads ----------

create policy "head tech reads every problem"
  on public.problems for select
  to authenticated
  using ((select public.is_head_tech())
         and host_id = public.current_host_id());

create policy "head tech reads repairs of problems"
  on public.tasks for select
  to authenticated
  using ((select public.is_head_tech())
         and host_id = public.current_host_id()
         and problem_id is not null
         and type = 'maintenance');

create policy "head tech reads steps of repairs"
  on public.task_steps for select
  to authenticated
  using ((select public.is_head_tech())
         and host_id = public.current_host_id()
         and exists (select 1 from public.tasks t
                     where t.id = task_steps.task_id
                       and t.problem_id is not null
                       and t.type = 'maintenance'));

create policy "head tech reads media of repairs"
  on public.task_media for select
  to authenticated
  using ((select public.is_head_tech())
         and host_id = public.current_host_id()
         and task_id is not null
         and exists (select 1 from public.tasks t
                     where t.id = task_media.task_id
                       and t.problem_id is not null
                       and t.type = 'maintenance'));

create policy "head tech reads places with problems"
  on public.properties for select
  to authenticated
  using ((select public.is_head_tech())
         and host_id = public.current_host_id()
         and id = any (array(select public.head_tech_property_ids())));

-- ---------- the conversation of every task ----------

create or replace function public.chat_participates(
  p_kind       public.chat_thread_kind,
  p_task_id    uuid,
  p_problem_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- The caller is read ONCE. A policy calls this, so it runs per row of
  -- chat_threads; the first draft asked is_active_user(), current_host_id() and
  -- is_manager() separately, and each is its own definer call into profiles.
  -- Measured on 1500 threads that was 0.8 ms a row for a manager and 3.9 ms for
  -- a cleaner: a list whose cost grows with the company rather than with what
  -- the reader can actually see.
  with me as (
    select p.id, p.host_id, (p.role in ('manager', 'admin')) as is_manager,
           (p.role = 'head_tech') as is_head_tech
    from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  )
  select coalesce((
    select case p_kind
      when 'task' then exists (
        select 1 from public.tasks t
        where t.id = p_task_id
          and t.host_id = me.host_id
          and (me.is_manager
               or (not public.task_is_beyond_horizon(t.property_id, t.scheduled_date)
                   and (t.assignee_id = me.id
                        or public.cleans_property(t.property_id)))))
      when 'problem' then exists (
        select 1 from public.problems pb
        where pb.id = p_problem_id
          and pb.host_id = me.host_id
          and (me.is_manager
               -- The head technician takes part in the conversation of every
               -- task of his company, archived ones too (decisions 5 and 7 of
               -- 2026-10-01, 20261003120000).
               or me.is_head_tech
               or (pb.archived_at is null
                   and (pb.reported_by = me.id
                        -- The horizon belongs here too, and it is the one place
                        -- being a definer changes the answer. The policy this arm
                        -- reproduces, "fixer reads problems of own tasks", is a
                        -- POLICY expression: its exists() on tasks is row
                        -- filtered as the caller, and the task policies hide a
                        -- repair scheduled past the horizon even from its own
                        -- assignee. Here the same exists() runs as the owner and
                        -- would see it -- leaving a conversation readable whose
                        -- subject is not.
                        or exists (select 1 from public.tasks t
                                   where t.problem_id = pb.id
                                     and t.assignee_id = me.id
                                     -- A cancelled attempt takes the
                                     -- conversation with it (20260918110000).
                                     -- 'done' stays in: whoever finished the
                                     -- repair is still the person to ask.
                                     and t.status not in ('cancelled', 'expired')
                                     and not public.task_is_beyond_horizon(
                                           t.property_id, t.scheduled_date))))))
      when 'direct' then
        exists (select 1 from public.profiles pr
                where pr.id = p_profile_id
                  and pr.host_id = me.host_id
                  -- Field staff only. The company inbox is the office talking to
                  -- whoever goes to the flat; a thread whose subject is a manager
                  -- would be read by every other manager of the host, which is a
                  -- group chat and not an inbox. Manager to manager is out of
                  -- scope (docs/chat-plan.md).
                  and pr.role in ('cleaner', 'tech', 'head_tech'))
        -- `pr.is_active` is deliberately NOT tested. Dismissing somebody must not
        -- delete the company's own record of what was said to her: the office
        -- keeps the inbox, and she loses it through `me` above, which requires
        -- the CALLER to be active.
        and (p_profile_id = me.id or me.is_manager)
    end
    from me
  ), false)
  -- coalesce, not a bare case. An unknown kind, or no active profile for the
  -- caller, must answer NO -- and `if not <null>` does not fire, so a null would
  -- walk straight through the gates in open_thread and mark_thread_read.
$$;

create or replace function public.chat_participates_as(
  p_person_id  uuid,
  p_kind       public.chat_thread_kind,
  p_task_id    uuid,
  p_problem_id uuid,
  p_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- The person is read ONCE, as in chat_participates, whose body this is
  -- with the person as a parameter instead of auth.uid().
  with me as (
    select p.id, p.host_id, (p.role in ('manager', 'admin')) as is_manager,
           (p.role = 'head_tech') as is_head_tech
    from public.profiles p
    where p.id = p_person_id and p.is_active
  )
  select coalesce((
    select case p_kind
      when 'task' then exists (
        select 1 from public.tasks t
        where t.id = p_task_id
          and t.host_id = me.host_id
          and (me.is_manager
               or (not public.task_is_beyond_horizon(t.property_id, t.scheduled_date)
                   and (t.assignee_id = me.id
                        or public.cleans_property_as(me.id, t.property_id)))))
      when 'problem' then exists (
        select 1 from public.problems pb
        where pb.id = p_problem_id
          and pb.host_id = me.host_id
          and (me.is_manager
               -- The head technician takes part in the conversation of every
               -- task of his company, archived ones too (decisions 5 and 7 of
               -- 2026-10-01, 20261003120000).
               or me.is_head_tech
               or (pb.archived_at is null
                   and (pb.reported_by = me.id
                        -- The horizon belongs here too, and it is the one place
                        -- being a definer changes the answer. The policy this arm
                        -- reproduces, "fixer reads problems of own tasks", is a
                        -- POLICY expression: its exists() on tasks is row
                        -- filtered as the caller, and the task policies hide a
                        -- repair scheduled past the horizon even from its own
                        -- assignee. Here the same exists() runs as the owner and
                        -- would see it -- leaving a conversation readable whose
                        -- subject is not.
                        or exists (select 1 from public.tasks t
                                   where t.problem_id = pb.id
                                     and t.assignee_id = me.id
                                     -- A cancelled attempt takes the
                                     -- conversation with it (20260918110000).
                                     -- 'done' stays in: whoever finished the
                                     -- repair is still the person to ask.
                                     and t.status not in ('cancelled', 'expired')
                                     and not public.task_is_beyond_horizon(
                                           t.property_id, t.scheduled_date))))))
      when 'direct' then
        exists (select 1 from public.profiles pr
                where pr.id = p_profile_id
                  and pr.host_id = me.host_id
                  -- Field staff only. The company inbox is the office talking to
                  -- whoever goes to the flat; a thread whose subject is a manager
                  -- would be read by every other manager of the host, which is a
                  -- group chat and not an inbox. Manager to manager is out of
                  -- scope (docs/chat-plan.md).
                  and pr.role in ('cleaner', 'tech', 'head_tech'))
        -- `pr.is_active` is deliberately NOT tested. Dismissing somebody must not
        -- delete the company's own record of what was said to her: the office
        -- keeps the inbox, and she loses it through `me` above, which requires
        -- the CALLER to be active.
        and (p_profile_id = me.id or me.is_manager)
    end
    from me
  ), false)
  -- coalesce, not a bare case. An unknown kind, or no active profile for the
  -- caller, must answer NO -- and `if not <null>` does not fire, so a null would
  -- walk straight through the gates in open_thread and mark_thread_read.
$$;
