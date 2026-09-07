-- Every table in public, with only the privileges `authenticated` needs.
--
-- Found on 2026-09-07 while checking the cloud after the checklist push: the
-- seven relations older than F16 — profiles, properties, reservations,
-- property_cleaners, tasks, hosts and the expired_tasks_review view — still
-- carried the full set that hosted Supabase hands to new tables through
-- default privileges: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE,
-- UPDATE. The early migrations granted DML and never revoked, and `hosts`
-- got `grant select` on top of defaults that had already given everything.
--
-- Row level security does not cover all of these. TRUNCATE ignores policies
-- entirely: any signed-in account could empty a production table in one
-- request, and PostgREST is not the only client that can reach the database.
-- TRIGGER lets a role attach its own code to writes made by others. Neither
-- has any use for an application role.
--
-- The remedy is the one 20260907140000 settled on for the checklist tables:
-- take everything back, then grant exactly what is wanted. And, as
-- 20260825030000 did for anon, change the defaults so the next table starts
-- with nothing — a migration then has to say what it grants, and the
-- table_grants test suite refuses a relation nobody has decided on.
--
-- Local Postgres hands out a smaller set (TRUNCATE, REFERENCES, TRIGGER,
-- MAINTAIN) through the same mechanism, so the suite is red on both stacks
-- before this file and green after. Verify on the cloud after the push all
-- the same:
--   select table_name, string_agg(privilege_type, ',')
--   from information_schema.role_table_grants
--   where table_schema = 'public' and grantee = 'authenticated'
--   group by 1;

revoke all on all tables in schema public from anon, authenticated;

-- Written directly by a manager under her own policies.
grant select, insert, update, delete
  on public.profiles, public.properties, public.reservations,
     public.property_cleaners, public.tasks
  to authenticated;

-- Read by everyone signed in; written only through RPC or by the server.
grant select
  on public.hosts,
     public.workflow_templates, public.workflow_steps, public.task_steps,
     public.checklist_modules, public.checklist_items,
     public.expired_tasks_review
  to authenticated;

-- The next table created by a migration carries no client grant until the
-- migration says so.
alter default privileges in schema public revoke all on tables from authenticated;
