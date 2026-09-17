-- Units 6.7: the cleaning window of a booking is not a client's to ask for.
--
-- public.reservation_cleaning_window is security definer and filters by
-- nothing but the two ids it is handed: no host_id, no assignment, no
-- horizon. Held by `authenticated`, it answers for ANY booking in the
-- database -- the departing guest's check-out time, the next guest's
-- check-in time, and how many people are arriving -- across tenants, to
-- anyone who can sign in and guess a booking id.
--
-- Nothing reaches it from a client. Every caller is inside
-- public.generate_cleaning_tasks, which is itself security definer and
-- therefore executes the call with the owner's privileges, not the
-- caller's; no policy names it, and neither application invokes it as an
-- RPC. Revoking the client grant costs nothing and closes the hole.
--
-- The hole is not new: the one-argument form carried the same grant from
-- 20260905092000, and 20260912150000 copied it onto the two-argument form
-- when the rooms arrived. With one company in the database it was theory.
-- It stops being theory the moment there are two.

revoke execute on function public.reservation_cleaning_window(bigint, bigint)
  from authenticated;
