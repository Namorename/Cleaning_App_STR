-- Where the app said a file came from.
--
-- Its own file because a type is its own thing in this repository, and because
-- what it is worth saying about it does not fit on the column.
--
-- Read it as a DECLARATION, never as proof. The server cannot see a camera: it
-- has its own clock, the id of whoever called, and whatever the phone said.
-- `device_taken_at` is the phone's word too. A modified build can always claim
-- 'camera', and no schema can forbid photographing a photo off a screen.
--
-- What it does buy is real, and is the reason the gallery stayed shut until
-- now: an honest build stops quietly passing a picked file off as one taken on
-- the spot, and `hosts.gallery_allowed` stops being a client-side switch that
-- only hides a button.
--
-- 'unknown' is the third value on purpose. A build older than this column says
-- nothing, and saying nothing must not become a claim — least of all the
-- flattering one.

create type public.media_source as enum ('camera', 'gallery', 'unknown');

comment on type public.media_source is
  'Where the app said a file came from: taken with the camera here, chosen from the phone gallery, or not declared (a build older than the column).';
