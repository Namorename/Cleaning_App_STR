-- F8. What a piece of media is.
--
-- Alone in its own file, like every new enum (see 20260904120000): an enum
-- value added in the same transaction as the code that uses it is not usable
-- by that code yet.
--
-- Two kinds, because the rules differ in kind and not in degree: a photo is
-- one of several and is measured in pixels and bytes, a video is one per
-- step and is measured in seconds. Which step accepts which is decided by
-- the step type, not here.

create type public.media_kind as enum ('photo', 'video');

comment on type public.media_kind is
  'A photo or a video attached to a task step. Photos go on photos_before/photos_after steps, videos on video steps.';
