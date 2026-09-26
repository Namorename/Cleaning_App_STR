-- The "#" rule as a computed field the calendar can select with a booking.
--
-- A booking whose guest name begins with "#" is the office's own work, and
-- the generator treats it as a block since 20260926102000. The calendar has to
-- draw it as one (docs/f10-plan.md, §2). The owner's decision of 2026-09-26
-- (option a): the flag comes from the server, so the rule stays one function
-- and never gets a TypeScript copy that would drift from it on the first odd
-- space — JavaScript's \s and ICU's [[:space:]] are different sets.
--
-- PostgREST offers a function as a column of a table when it takes that
-- table's row and writes nothing: `select=…,is_service_booking` on
-- reservations. This is that function, and all it does is hand the row's
-- guest name to is_service_booking(text).
--
-- It is an overload of the same name. The generator and the cleaning window
-- call the text rule with a column, which resolves by type; a bare literal
-- resolves to text too, because an unknown argument prefers the string
-- category. supabase/tests/service_booking_field.sql holds both.
--
-- Grants are stated rather than left to the defaults: authenticated reads it
-- with the booking (the manager's panel), service_role may, anon may not.
-- No table changes, no lock beyond the catalog.

create or replace function public.is_service_booking(booking public.reservations)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select public.is_service_booking(booking.guest_name)
$$;

comment on function public.is_service_booking(public.reservations) is
  'The "#" rule of a booking row, as a computed field for PostgREST: '
  'is_service_booking(text) of its guest name.';

revoke all on function public.is_service_booking(public.reservations) from public, anon;
grant execute on function public.is_service_booking(public.reservations) to authenticated, service_role;
