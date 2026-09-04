-- The language a person wants to be spoken to in.
--
-- The app already picks its own language from the device. This column is for
-- the server side, where there is no device to ask: the push notifications of
-- F11 have to choose a language before the phone is involved.
--
-- Deliberately the only thing stored for translation. Listing names arrive
-- from Hostaway as they are and are not ours to translate; multilingual
-- checklists wait for F7, when their structure is known — inventing a shape
-- for them now would be guessing.

-- The languages the app actually ships translation files for. An enum rather
-- than free text: a code with no translation file behind it would surface as
-- a notification nobody can read, and there is no sensible fallback at send
-- time other than the default the sender would have used anyway.
create type public.app_language as enum ('en', 'ru', 'cs');

alter table public.profiles
  add column preferred_language public.app_language;

comment on column public.profiles.preferred_language is
  'Language for server-sent messages. Null means never chosen: fall back to the default rather than guessing.';

-- No new policy: "update own profile" from 20260824190100 already lets a
-- person edit her own row, and guard_profile_privileges() reverts only role
-- and is_active, so this column is hers to set and nobody else's.
