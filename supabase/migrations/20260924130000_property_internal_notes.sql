-- Window 3, M1: the office's note on a property moves to a table of its own.
--
-- properties.internal_notes is marked "Office only. Never leaves the manager
-- panel" (20260905092000), and the phone never asks for it -- yet row security
-- filters rows, not columns, so any active cleaner could read it with her own
-- token and the public key from the bundle:
-- GET /rest/v1/properties?select=internal_notes. Column privileges cannot fix
-- that: a cleaner and a manager are the same database role, and
-- effective_cleaner_notes(properties) takes the whole row, so a column grant
-- would cost the manager the column and every task feed of the phone its
-- computed field (docs/ROADMAP.md, «Перед запуском», А).
--
-- The rollout is M1 -> the panel -> M2 (docs/window3-plan.md, «Порядок
-- выката»). This file only adds: the table, its rights, and a copy of every
-- non-empty note. The old column stays until M2 drops it, so the panel still in
-- production keeps working until the new one replaces it.
--
-- host_id defaults to the WRITER's company, not to default_host_id() as the
-- tables of phase A do: this is the first table a client writes directly, and
-- the first company is the wrong answer for a manager of the second. The
-- policy checks it anyway, and the one foreign key to properties makes a note
-- on another company's flat impossible rather than merely refused.
--
-- LOCKS. The foreign key takes SHARE ROW EXCLUSIVE on public.properties until
-- this file commits, and every task feed of the phone reads properties. The
-- work takes milliseconds; lock_timeout makes a busy table fail the push
-- instead of queueing the feeds behind it.

set local lock_timeout = '3s';

create table public.property_internal_notes (
  property_id bigint primary key,
  host_id     uuid not null default public.current_host_id()
                references public.hosts(id) on delete restrict,
  notes       text not null check (btrim(notes) <> ''),
  updated_at  timestamptz not null default now(),
  -- The only key to properties. A second one on property_id alone would give
  -- PostgREST two paths between the tables and a 300 on any embed.
  foreign key (host_id, property_id)
    references public.properties(host_id, id) on delete cascade
);

comment on table public.property_internal_notes is
  'The office''s own note on a property. Only a manager of the property''s company reads or writes it; it never reaches the phone.';

create trigger property_internal_notes_touch
  before update on public.property_internal_notes
  for each row execute function public.touch_updated_at();

revoke all on public.property_internal_notes from public, anon, authenticated;
-- The panel writes it directly: an empty note deletes the row, any other
-- upserts it by property_id.
grant select, insert, update, delete on public.property_internal_notes to authenticated;
grant select, insert, update, delete on public.property_internal_notes to service_role;

alter table public.property_internal_notes enable row level security;

create policy "managers keep internal notes"
  on public.property_internal_notes for all
  to authenticated
  using (public.is_manager() and host_id = public.current_host_id())
  with check (public.is_manager() and host_id = public.current_host_id());

-- The copy. Trimmed, as the panel has always saved it; the company is the
-- property's own, stated rather than defaulted (there is no caller here).
insert into public.property_internal_notes (property_id, host_id, notes)
select p.id, p.host_id, btrim(p.internal_notes)
from public.properties p
where nullif(btrim(p.internal_notes), '') is not null;
