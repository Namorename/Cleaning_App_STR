-- Window 3, Б2: a non-manager reads only the properties the rule gives her.
--
-- The rule is staff_property_ids() (20260924140000); this file swaps the one
-- read policy of properties for staff onto it. Managers keep reading through
-- "managers write properties" (for all), untouched.
--
-- What changes for the phone is the embed, never a list: task, problem and
-- supply visibility go through definer helpers (cleans_property,
-- task_is_beyond_horizon, task_is_stale, chat_participates) and do not read
-- properties under the caller. A property the rule withholds comes back from
-- PostgREST as a null embed, which every schema of the phone has accepted
-- since its first commit -- so a wrong rule would show "Объект 123" and a
-- blank key-box note, not an empty screen. The cases are in rls_smoke.sql.
--
-- ORDER OF THE BRANCHES. Permissive policies are OR-ed in descending order of
-- their names. "field staff read their properties" sorts after "managers
-- write properties", so a manager's is_manager() comes first and the set is
-- never built for her: it is an InitPlan, evaluated only when reached
-- (rls_smoke.sql counts the calls). A name sorting above "managers..." would
-- put the rule first for every manager read.
--
-- host_id = current_host_id() stays in the policy: the rule has no company
-- filter of its own, and the conjunct shared by both policies is what goes
-- into the index condition of every read.
--
-- LOCKS. drop/create policy take ACCESS EXCLUSIVE on public.properties, which
-- every task feed embeds. This file does nothing else, so the lock is held
-- for milliseconds; lock_timeout makes a busy table fail the push instead of
-- queueing the feeds.

set local lock_timeout = '3s';

drop policy "active staff read properties" on public.properties;

create policy "field staff read their properties"
  on public.properties for select
  to authenticated
  using (public.is_active_user()
         and host_id = public.current_host_id()
         and id = any (array(select public.staff_property_ids())));
