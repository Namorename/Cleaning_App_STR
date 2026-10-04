-- Push «Новое задание» for the head technician (docs/tech-plan.md, 5; owner's
-- decision 6 of 2026-10-01): its kind, alone in this file. A value added to an
-- enum cannot be used in the transaction that adds it, and the CLI runs each
-- file as one transaction; the trigger that writes it is the next file
-- (20261003160000). Placed before chat_message: the settings screen lists the
-- kinds in the enum's order, the work first, the conversation and the morning
-- summary last. A phone muting it, or a sender that does not know it, is
-- handled where the kinds are read (push_preferences keeps unknown kinds; the
-- sender sets a row it cannot read aside as skipped).

alter type public.push_kind add value if not exists 'problem_new' before 'chat_message';
