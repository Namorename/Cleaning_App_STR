-- Window 3, security fix found by its preflight (2026-09-25): a deactivated
-- account could make itself an active manager again, and anyone could move
-- her own profile to another company.
--
-- 1. is_manager() answered NULL, not false, for a caller without an active
--    profile: auth_role() filters on is_active and finds no row. Every guard
--    that reads `if not public.is_manager() then ...` skips on NULL. For the
--    privilege guard on profiles that meant a deactivated cleaner — who can
--    still sign in, deactivation does not ban the login — could send
--    PATCH /rest/v1/profiles?id=eq.<self> {"is_active": true, "role": "manager"}
--    and the "update own profile" policy let it through unreverted. From then
--    on she read every property, every office note, every reservation. Seen in
--    a rolled-back experiment on the local stack; the same functions are in the
--    cloud. The rest of the 36 `if not is_manager()` guards were not reachable
--    this way (they filter by current_host_id(), NULL for her too), but they
--    all get a plain boolean now. No caller compares the result with NULL.
--
-- 2. guard_profile_privileges froze email always and role and is_active for
--    non-managers, but never host_id. current_host_id() follows the profile,
--    so a member of staff who knew another company's hosts.id could move
--    herself into it with the same PATCH, and a manager would stay a manager
--    there. One company in production today, so it was not reachable yet.
--    Moving a person between companies is server-side work: manage-staff
--    writes through the service key, has no auth.uid(), and passes straight
--    through as before.
--
-- Only function bodies change; signatures, owners and ACLs stay.

set local lock_timeout = '3s';

create or replace function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.auth_role() in ('manager', 'admin'), false)
$$;

-- Unchanged from 20260911120000 except for host_id, frozen for every client.
create or replace function public.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    return new;
  end if;

  new.email := old.email;
  new.host_id := old.host_id;

  if not public.is_manager() then
    new.role := old.role;
    new.is_active := old.is_active;
  end if;

  return new;
end;
$$;
