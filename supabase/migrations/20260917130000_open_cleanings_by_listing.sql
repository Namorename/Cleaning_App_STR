-- Units 6.1: the registry counts the cleanings standing in a listing's rooms.
--
-- The "cleanings" column showed 0 against all nine multi-unit listings, and
-- the bulk "take out of service" dialog said "0 cleanings at stake", because
-- the panel grouped tasks by property_id and a room is a property of its own.
--
-- The server was already right for ONE listing: property_open_cleanings folds
-- rooms through parent_id, so the dialog opened on a single listing read the
-- true number while the list beside it read zero. The two disagreed on screen.
--
-- The fix is the same rule for the whole company in one read, not the rule
-- rewritten in TypeScript. A predicate that lives in two places is a predicate
-- that starts disagreeing, and the copy in the client is the weaker one --
-- the same reasoning that put the report listing behind a view in
-- 20260917100000 rather than behind a filter in the panel.
--
-- Invoker, not definer. Row security on tasks already holds a caller to her
-- own company, and the registry that asks this is a manager's screen; a
-- definer here would be a second function answering about rows the caller may
-- not read, which is exactly what 20260917120000 has just taken away.
--
-- The fold asks hostaway_unit_id, never a bare parent_id: that column carries
-- two relations, and a part of a combined listing is a listing of its own with
-- its own calendar. Its cleanings stay its own.

create or replace function public.open_cleanings_by_listing()
returns table (property_id bigint, cleanings integer)
language sql
stable
set search_path = ''
as $$
  select case when p.hostaway_unit_id is not null then p.parent_id else p.id end,
         count(*)::integer
  from public.tasks t
  join public.properties p on p.id = t.property_id
  where t.type = 'cleaning'
    and t.status in ('unassigned', 'assigned')
  group by 1;
$$;

comment on function public.open_cleanings_by_listing() is
  'Open cleanings per listing for the whole company, rooms folded into their listing. The single-listing twin is property_open_cleanings; the two are read side by side on the registry and must agree.';

revoke all on function public.open_cleanings_by_listing() from public, anon;
grant execute on function public.open_cleanings_by_listing()
  to authenticated, service_role;
