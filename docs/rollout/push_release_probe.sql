-- Who holds a push token now — for the owner's offline sign-out test of
-- release_push_token (2026-10-14). Read-only, one statement, no token text:
--
--   node scripts/cloud-read.mjs docs/rollout/push_release_probe.sql
--
-- Read it before the test and again a minute after the network is back:
-- the row of the phone that signed out (its token_md5) must be gone, and the
-- other rows must stay as they were. Signing in again brings a row back,
-- with the same token_md5 when the phone's token is the same.
select left(md5(t.token), 8) as token_md5,
       left(t.profile_id::text, 8) as profile,
       t.platform,
       t.app_version,
       t.created_at,
       t.updated_at
  from public.push_tokens t
 order by t.updated_at desc
