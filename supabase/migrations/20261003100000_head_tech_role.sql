-- The head technician: a new role (docs/tech-plan.md, §3; owner's word 2026-10-01).
--
-- One statement, in a file of its own. A value added to an enum cannot be used
-- in the transaction that adds it, and the CLI runs each migration file as one
-- transaction: the rules that name 'head_tech' come in the next files.
--
-- Placed after 'tech' so the enum reads in the order of the roles. Nobody holds
-- the role until the panel's «Команда» knows it (docs/tech-plan.md, 3.5): until
-- then is_manager() is false for him and he would see nothing but his profile.

alter type public.app_role add value if not exists 'head_tech' after 'tech';
