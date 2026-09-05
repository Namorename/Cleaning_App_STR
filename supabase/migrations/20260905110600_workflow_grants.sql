-- F16. Take back what the hosted project handed out on its own.
--
-- The hosted Supabase project grants every privilege on a new table to
-- `authenticated` through default privileges; the local stack does not, so the
-- test suite could not see the difference (CLAUDE.md warns about exactly
-- this). Found on 2026-09-05 by reading role_table_grants in the cloud right
-- after db:push: the three F16 tables carried INSERT, UPDATE and DELETE for
-- authenticated on top of the SELECT the migration meant to give.
--
-- Row level security still refused those writes — no policy allows them — so
-- nothing was exposed. But the design of F16 is that progress is written only
-- through the step functions, and a rule that holds only because a second
-- mechanism happens to catch it is not a rule. The grants are made explicit
-- here so both stacks agree.

revoke insert, update, delete, truncate, references, trigger
  on public.workflow_templates, public.workflow_steps, public.task_steps
  from authenticated;

-- What authenticated is meant to have, stated once more so this file reads
-- as the whole truth about these tables.
grant select on public.workflow_templates, public.workflow_steps, public.task_steps
  to authenticated;
