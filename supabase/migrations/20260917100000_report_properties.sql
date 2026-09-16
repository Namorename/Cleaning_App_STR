-- The places a person may file a report about.
--
-- The phone needs a list to show, and `properties` is not it: the read policy
-- on that table hands every active member of staff the whole company, because
-- a cleaner has to be able to read the listing of a task she is looking at.
-- Filtering that list in TypeScript would put the rule in two places and in
-- the weaker one — an intercepted request would still name any listing in the
-- company, and the rule itself ("a room is a row with a hostaway_unit_id, not
-- merely a row with a parent") would have to be restated in the client.
--
-- So the list is a view, and its predicate is literally the one
-- `resolve_report_property` already refuses by: `cleans_property` for a
-- cleaner — which walks the parent link, so rooms of a multi-unit listing come
-- along — and everything for a manager. The two cannot drift into a picker
-- that offers what the writer will not accept.
--
-- security_invoker so the row policies of the caller still apply: the view
-- narrows, it does not grant.

create view public.report_properties
with (security_invoker = on) as
select
  p.id,
  p.name,
  p.parent_id,
  p.hostaway_unit_id,
  parent.name as parent_name
from public.properties p
left join public.properties parent on parent.id = p.parent_id
where p.host_id = public.current_host_id()
  and p.status <> 'archived'
  and (public.cleans_property(p.id) or public.is_manager());

comment on view public.report_properties is
  'Listings and rooms the caller may file a problem or a supply request about.';

grant select on public.report_properties to authenticated, service_role;

-- The hosted project hands new public objects to anon through default
-- privileges while the local stack does not, so the local suite cannot see the
-- difference. Revoking explicitly costs nothing.
revoke all on public.report_properties from anon;
