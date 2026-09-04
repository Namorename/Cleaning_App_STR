-- A cleaning that happens inside a stay, not at its end.
--
-- Alone in its own migration for the same reason as 'expired' in
-- 20260904120000: PostgreSQL will not let a new enum value be used in the
-- transaction that added it, and the CLI runs every migration file in a
-- transaction of its own.
--
-- Nothing generates one yet — the toggle on the booking that asks for regular
-- mid-stay cleanings is F22. The value is added now because a type is an enum
-- and enums are the part of a schema that is awkward to extend later, not
-- because the feature is being started.

alter type public.task_type add value if not exists 'midstay';
