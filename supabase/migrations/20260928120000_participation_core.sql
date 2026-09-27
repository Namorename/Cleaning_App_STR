-- F11: who takes part, asked about someone else (docs/f11-plan.md, §1.2).
--
-- A push about a chat message goes to the people who may read the thread, and
-- a push about free work to the cleaners who may take it. The triggers that
-- write those pushes (M3) run as the AUTHOR of the change, and the two rules
-- they need — chat_participates and cleans_property — read auth.uid(): they
-- answer "may I?", never "may Bara?". These are the same two rules with the
-- person as a parameter.
--
-- Twins, not a core the old functions wrap. Measured 2026-09-28 on the local
-- stack, rolled back, 20 000 calls five times over, the variants interleaved:
-- cleans_property as it is took 285 us a call; the same function as a wrapper
-- over a profile-parameter core took 1 664 us. PostgreSQL 17 plans the body of
-- a SQL function on every call, and a wrapper plans two bodies. cleans_property
-- sits in every cleaner policy on tasks and chat_participates in the policy on
-- chat_threads, so both keep their bodies. The price is two copies of each
-- rule; supabase/tests/chat.sql asks both versions about every person and every
-- subject of its fixture at several points of the story and fails on any
-- difference. Change one, change the other — the comments on all four say so.
--
-- Neither twin is for clients: each answers about anybody. EXECUTE goes to
-- service_role only; the push triggers are definers owned by postgres.
--
-- New functions only, and comments on the two old ones; no lock on any table.

create or replace function public.cleans_property_as(
  p_person_id         uuid,
  target_property_id  bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.property_cleaners pc
    where pc.property_id = target_property_id
      and pc.cleaner_id = p_person_id
  ) or exists (
    select 1
    from public.properties p
    join public.property_cleaners pc on pc.property_id = p.parent_id
    where p.id = target_property_id
      and p.hostaway_unit_id is not null
      and pc.cleaner_id = p_person_id
  );
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
    select p.id, p.host_id, (p.role in ('manager', 'admin')) as is_manager
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
                  and pr.role in ('cleaner', 'tech'))
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

comment on function public.cleans_property_as(uuid, bigint) is
  'cleans_property asked about a given person rather than the caller. A twin, '
  'not a core: change both together (supabase/tests/chat.sql holds them equal).';
comment on function public.chat_participates_as(uuid, public.chat_thread_kind, uuid, uuid, uuid) is
  'chat_participates asked about a given person rather than the caller: may '
  'she read this conversation? A twin, not a core: change both together '
  '(supabase/tests/chat.sql holds them equal).';
comment on function public.cleans_property(bigint) is
  'Does the caller clean this listing, or the listing this room belongs to? '
  'Its twin cleans_property_as (20260928120000) must change with it.';
comment on function public.chat_participates(public.chat_thread_kind, uuid, uuid, uuid) is
  'The audience of a thread is the audience of its subject. The policies and '
  'the RPCs call it; its twin chat_participates_as (20260928120000) states the '
  'same rule about a given person and must change with it.';

revoke all on function public.cleans_property_as(uuid, bigint) from public, anon, authenticated;
revoke all on function public.chat_participates_as(uuid, public.chat_thread_kind, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cleans_property_as(uuid, bigint) to service_role;
grant execute on function public.chat_participates_as(uuid, public.chat_thread_kind, uuid, uuid, uuid)
  to service_role;
