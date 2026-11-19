-- The reception: a new role (the owner's request of 2026-11-19, CORE;
-- docs/panel-edits-reception-1119.md §5).
--
-- One statement, in a file of its own. A value added to an enum cannot be used in the transaction
-- that adds it, and the CLI runs each migration file as one transaction: the rules that name
-- 'reception' come in 20261119143000.
--
-- Placed after 'head_tech', before 'manager', so the enum reads in the order of the roles. Nobody
-- holds the role until «Команда» hands it out; until 20261119143000 is_manager() is false for her.

alter type public.app_role add value if not exists 'reception' after 'head_tech';
