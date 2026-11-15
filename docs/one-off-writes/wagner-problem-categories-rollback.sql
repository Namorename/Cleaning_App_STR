-- CLIENT:Wagnerstays — undo of wagner-problem-categories.sql. A WRITE to the cloud: only
-- on the owner's word, never in 03:00–04:40 UTC.
--
--   1. docs/one-off-writes/wagner-problem-report-mode-free-text.sql (this file refuses to
--      run while the company still reports by catalogue);
--   2. npx supabase db query --linked -f docs/one-off-writes/wagner-problem-categories-rollback.sql
--   3. probe: node scripts/cloud-read.mjs docs/rollout/probe_wagner_problem_categories.sql —
--      live 0.
--
-- A category no task was filed under is deleted. One a task points at is archived instead:
-- the task keeps its link for the statistics, and no phone offers the category again.
-- After that the load script refuses to run a second time (the company has categories);
-- loading again means deleting the archived ones by hand first, on the owner's word.
do $$
declare
  c_host constant uuid := 'ce77c272-c330-4b74-ac98-c7d36cba8b2a';
  c_ids constant uuid[] := array[
    '83ffda56-635c-4941-bedd-cb08b82e6675', 'd62b476c-b82e-4d8a-90e9-d414597c1279',
    'a1ca0593-1f46-4f4a-9229-d2b85f31cdd1', '37659104-f5d6-4596-bb00-01130bc371cb',
    'f5093c0c-58db-42bb-b5dc-ed6f5daa550c', 'd2e00844-d88c-4324-ab60-dbed5bb56a59',
    '2ca940fd-288f-43f5-a6df-93145e10cd67', 'bacca1bc-6f84-4c28-87f7-78f703bada4d',
    '9293427f-b55f-4710-9d8b-51b0a2cdd79e', '6268cb20-21c5-466b-8c25-3c597eb08502',
    'f530619c-43e8-4f38-a187-85498c28c053', '46d47fc5-72f2-46f7-a63c-2a7227dd6aca',
    '91292260-09af-497a-9d37-0d2b5b9094b2', '56e19d08-d142-4083-8b02-961546a1d6f2',
    '3cfd7ee1-4078-40dc-8d06-4b75ee250180', 'ddc74d9b-6388-49ee-9bb2-6611f951db6b',
    '1744627c-58f8-4682-ac8d-9a3648f16b5c', '8b4e8b0d-3fec-4833-8c79-80416c5cd97a',
    '7bed8f05-ae67-43c3-82d5-01bf1b4a26c6', '7a2fa5c7-6688-4658-b898-17a6bad801a8',
    '22168888-b535-420d-937f-5acd1bfe0661', 'e80960c4-e5fe-47b7-94b0-2cefda65e660',
    '0e170fe9-4973-48fb-bc0b-23f548340527', 'b9a0f74f-0535-4b71-aa15-8a946b25150f',
    '550e8872-7829-4235-8016-9c1040d0c3ab', 'b1d15e3f-5d86-45ad-845d-e339b05a373a',
    '53254afb-447f-46df-ac19-e265389a9d9b'
  ]::uuid[];
  v_archived integer;
  v_deleted  integer;
begin
  perform set_config('lock_timeout', '3s', true);

  if (select h.problem_report_mode from public.hosts h where h.id = c_host) = 'catalog' then
    raise exception 'The company still reports by catalogue: run wagner-problem-report-mode-free-text.sql first';
  end if;

  update public.problem_categories c
  set archived_at = now()
  where c.host_id = c_host and c.id = any (c_ids) and c.archived_at is null
    and exists (select 1 from public.problems p where p.category_id = c.id);
  get diagnostics v_archived = row_count;

  delete from public.problem_categories c
  where c.host_id = c_host and c.id = any (c_ids)
    and not exists (select 1 from public.problems p where p.category_id = c.id);
  get diagnostics v_deleted = row_count;

  raise notice 'categories deleted: %, archived (tasks point at them): %', v_deleted, v_archived;
end $$;
