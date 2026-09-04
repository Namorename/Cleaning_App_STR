-- A listing belongs to at most one combined object.
--
-- The hierarchy lived in a link table, which allowed a flat to have two
-- parents at once. That never happens: a room belongs to one house, and the
-- combined listing 571441 is exactly 566761 + 566769 and nothing else. A shape
-- that permits what the business forbids has to be checked everywhere it is
-- read, and the check is eventually forgotten in one of those places.
--
-- Moved onto the child, where it belongs. The table is dropped rather than
-- kept in parallel: it holds no rows in either environment, and two ways to
-- express the same relation is how they start disagreeing.

alter table public.properties
  add column parent_id bigint references public.properties(id) on delete set null,
  add constraint properties_parent_not_self check (parent_id is distinct from id);

comment on column public.properties.parent_id is
  'The combined listing this one is a unit of. Null for a standalone listing or for a parent.';

-- Read on every calendar row that groups units under their parent.
create index properties_parent_idx on public.properties (parent_id)
  where parent_id is not null;

/**
 * Keep the hierarchy exactly two levels deep.
 *
 * Carried over from guard_property_link_cycles in 20260824190200 and for the
 * same reason: the task generator expands a parent into its units, and a
 * parent that is itself a unit either loops or produces the cleaning twice.
 * A single parent_id makes A -> B -> A impossible on its own, but not
 * A -> B -> C, so the rule is still needed.
 */
create or replace function public.guard_property_hierarchy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.parent_id is null then
    return new;
  end if;

  if exists (select 1 from public.properties p
             where p.id = new.parent_id and p.parent_id is not null) then
    raise exception 'Объект % сам является юнитом — родителем быть не может', new.parent_id
      using errcode = 'check_violation';
  end if;

  if exists (select 1 from public.properties p where p.parent_id = new.id) then
    raise exception 'У объекта % есть свои юниты — юнитом быть не может', new.id
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger properties_guard_hierarchy
  before insert or update of parent_id on public.properties
  for each row execute function public.guard_property_hierarchy();

-- Nothing to carry over: the link table is empty in both environments, checked
-- against the hosted project on 2026-09-05 before dropping it.
drop table public.property_links;
drop function public.guard_property_link_cycles();
