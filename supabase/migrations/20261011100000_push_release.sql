-- A phone let go of after a sign-out it could not confirm (owner's words of
-- 2026-10-11, 00:40 and 2026-10-12, 18:20; docs/f11-native-review.md, Т-3).
--
-- unregister_push_token runs as the person signing out, while her session is
-- still valid. Without signal the call is lost, the phone's session is gone all
-- the same, and the server goes on sending her pushes to a phone she has left;
-- a session that ends without the button (a refused refresh, a new password)
-- never makes the call at all. The phone now keeps such a token, with whose it
-- was, as "to be let go of" and sends release_push_token when it can — with no
-- session.
--
-- release_push_token(p_token, p_profile_id):
--   - deletes the row of that token only while it is bound to that profile:
--     once the next person on the phone has registered, the token is hers and
--     stays. No clock takes part — the phone's own was the earlier draft's
--     weak point;
--   - answers nothing, the same for her token, someone else's and one that is
--     not there, and raises nothing: it tells no caller whether a phone is
--     known, or whose;
--   - a call that says nothing (either argument null) does nothing.
--
-- anon is granted EXECUTE on this one function: the call has no session to
-- run as. It is the single exception to 20260825030000_revoke_anon (anon holds
-- nothing else in public, and still nothing on push_tokens), pinned by its
-- exact signature in supabase/tests/table_grants.sql and push_release.sql.

create or replace function public.release_push_token(p_token text, p_profile_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_tokens t
  where t.token = p_token
    and t.profile_id = p_profile_id
$$;

comment on function public.release_push_token(text, uuid) is
  'A phone lets go of its token after a sign-out it could not confirm: the row '
  'goes only while the token is bound to p_profile_id. Answers nothing; '
  'callable without a session.';

revoke all on function public.release_push_token(text, uuid) from public;
grant execute on function public.release_push_token(text, uuid)
  to anon, authenticated, service_role;
