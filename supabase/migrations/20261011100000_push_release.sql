-- A phone let go of after a sign-out it could not confirm (owner's word of
-- 2026-10-11, 00:40; docs/f11-native-review.md, Т-3).
--
-- unregister_push_token runs as the person signing out, while her session is
-- still valid. Without signal the call is lost, the phone's session is gone all
-- the same, and the server goes on sending her pushes to a phone she has left;
-- a session that ends without the button (a refused refresh, a new password)
-- never makes the call at all. The phone now keeps such a token as "to be let
-- go of" and sends release_push_token when it can — with no session.
--
-- release_push_token(p_token, p_since):
--   - deletes the row of that token only if it was not bound again after
--     p_since, the moment the phone let go of it: a later registration — the
--     next person on the phone, or she herself — stands;
--   - answers nothing, the same for a token that is there and one that is not,
--     and raises nothing: it tells no caller whether a phone is known;
--   - a call that says nothing (either argument null) does nothing.
--
-- `p_since` is the phone's own clock. A phone running behind lets go of
-- nothing (the binding then waits for the next sign-in on that phone, which
-- moves it); one running ahead could undo a registration made on the same
-- phone within that lead — the phone clears its pending release on any
-- registration of the same token, so only a registration whose answer was lost
-- is exposed.
--
-- anon is granted EXECUTE on this one function: the call has no session to
-- run as. It is the single exception to 20260825030000_revoke_anon (anon holds
-- nothing else in public, and still nothing on push_tokens), pinned by
-- supabase/tests/push_release.sql.

create or replace function public.release_push_token(p_token text, p_since timestamptz)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens t
  where t.token = p_token
    and t.updated_at <= p_since
$$;

comment on function public.release_push_token(text, timestamptz) is
  'A phone lets go of its token after a sign-out it could not confirm: the row '
  'goes only if the token was not bound again after p_since. Answers nothing; '
  'callable without a session.';

revoke all on function public.release_push_token(text, timestamptz) from public;
grant execute on function public.release_push_token(text, timestamptz)
  to anon, authenticated, service_role;
