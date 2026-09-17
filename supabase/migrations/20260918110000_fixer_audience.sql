-- A repair taken away takes the report with it.
--
-- `fixer reads problems of own tasks` (20260910120000) asks only whether a task
-- pointing at this problem is assigned to the caller. It does not ask whether
-- that task is still a repair anybody is doing. `tasks_one_fix_per_problem`
-- deliberately lets a cancelled attempt be replaced -- the index excludes
-- 'cancelled' and 'expired' -- so after a reassignment BOTH technicians match:
-- the one holding the live repair, and the one whose attempt was cancelled
-- weeks ago. The second keeps reading the report for ever, and nothing says so.
--
-- Today that is a read of a title and a description. It stops being only that
-- with F29: the conversation about a breakage hangs off the report, and its
-- audience is the report's audience, so a technician taken off the job would
-- keep not just reading but WRITING into it. The leak is older than the chat;
-- the chat is what makes it worth closing now.
--
-- 'done' is NOT in the exclusion list, and that is the deliberate half. A
-- technician who finished the repair stays reachable for the question that
-- comes after it -- "did you put the old tap somewhere?" -- and the index's own
-- list is about which attempt is LIVE, not about who may still be asked.
--
-- The reporter's arm is untouched: she filed it, she reads it until it is
-- archived.

drop policy "fixer reads problems of own tasks" on public.problems;

create policy "fixer reads problems of own tasks"
  on public.problems for select
  to authenticated
  using (host_id = public.current_host_id()
         and archived_at is null
         and public.is_active_user()
         and exists (select 1
                     from public.tasks t
                     where t.problem_id = problems.id
                       and t.assignee_id = (select auth.uid())
                       and t.status not in ('cancelled', 'expired')));
