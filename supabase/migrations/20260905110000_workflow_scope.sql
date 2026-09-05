-- F16. The kinds of process a workflow template can describe.
--
-- Alone in its own file: PostgreSQL refuses to use a new enum value inside the
-- transaction that created it, and the CLI runs every file in its own.
--
-- Deliberately not `task_type`. That enum carries `maintenance`, which has no
-- process of its own, while the process for fixing a reported problem (F9) is
-- something a manager configures separately from cleaning. The mapping from a
-- task's type to its process lives in one function, `workflow_scope_for()`, in
-- the next migration.

create type public.workflow_scope as enum ('cleaning', 'midstay', 'problem', 'inspection');

comment on type public.workflow_scope is
  'Which process a template describes: an ordinary cleaning, a mid-stay cleaning, fixing a problem (F9), an inspection.';
