-- A terminal status for work whose day has passed.
--
-- Alone in its own migration on purpose: PostgreSQL will not let a new enum
-- value be *used* in the transaction that added it, and the CLI runs every
-- migration file in a transaction of its own. Everything that reads or writes
-- 'expired' therefore lives in the next file.
--
-- Distinct from 'cancelled', which means the booking went away. 'expired'
-- means the booking was real and the cleaning did not happen — the difference
-- a manager needs in order to ask why.

alter type public.task_status add value if not exists 'expired';
