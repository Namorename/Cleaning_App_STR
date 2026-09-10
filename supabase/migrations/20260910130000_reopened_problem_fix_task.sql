-- A reopened problem can be handed out again.
--
-- The one-live-fix-per-problem index (20260908130000) left a finished task
-- counting as live: while a problem was closed for good that was harmless,
-- but a reopened problem carries its done task as history, and assigning a
-- technician tried to insert a second row next to it — "duplicate key value
-- violates unique constraint tasks_one_fix_per_problem". A finished attempt
-- is history like a cancelled one: it makes room for the next.

drop index public.tasks_one_fix_per_problem;

create unique index tasks_one_fix_per_problem
  on public.tasks (problem_id)
  where problem_id is not null and status not in ('done', 'cancelled', 'expired');
