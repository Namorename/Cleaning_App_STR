-- Layer 4 of the conversation (docs/chat-plan.md): what is unread.
--
-- Unread is a comparison of two dates on the reader's side: the thread's
-- tail is newer than my marker and the last word was not mine. The marker
-- lives in chat_reads, and send_message moves the author's own marker, so
-- the sequence me -> her -> me cannot lose her message behind my own.
--
-- The plan said "a security_invoker view". Measured on 1500 threads, 30000
-- messages and 5000 markers (2026-09-18, layer 4 preflight):
--
--   * a manager's unread count through such a view      498 ms
--     (the chat_threads policy calls chat_participates per row, and the
--      chat_reads policy calls is_manager() per matched row)
--   * the same question inside a definer function        1.4 ms
--   * a cleaner's marks for the 60 tasks on her screen  20 ms
--     (chat_participates runs only for the matched rows)
--   * a cleaner's marks over the whole host             805 ms
--     (chat_participates is 0.5 ms a row for field staff: it walks
--      tasks, the horizon and property_cleaners for each thread)
--
-- So the question is answered by ONE definer function that reads the caller
-- once and asks the rule only where the rule is not already known. A manager
-- reads every thread of the company by the first branch of chat_participates;
-- for field staff the function is meant to be called WITH the ids on screen,
-- and the phone always does. Called without ids by a cleaner it is still
-- correct -- every row goes through chat_participates -- only slow, and it
-- gets slower with the size of the company rather than with what she can
-- see. That is the shape layer 6 must not adopt for a badge on a tab.

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
    select p.id, p.host_id, (p.role in ('manager', 'admin')) as is_manager
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
          else public.chat_participates(th.kind, th.task_id, th.problem_id, th.profile_id)
        end
  order by th.last_message_at desc
$fn$;

comment on function public.chat_unread_threads(uuid[], uuid[]) is
  'The threads with something the caller has not read: tail newer than the caller''s marker and the last word not hers. With ids, only those subjects; without, the whole company (managers) -- field staff should always pass the ids on screen.';

revoke all on function public.chat_unread_threads(uuid[], uuid[]) from public, anon;
grant execute on function public.chat_unread_threads(uuid[], uuid[])
  to authenticated, service_role;
