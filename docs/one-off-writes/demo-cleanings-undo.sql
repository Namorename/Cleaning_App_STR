-- Undo of demo-cleanings.sql: removes exactly the demo cleanings that script
-- wrote, by their fixed ids, on the demo listing only. NOT to be run without
-- the owner's word (2026-10-10: the undo is written, not run).
--
-- A cleaning the reviewer has photographed or written about holds media rows
-- and files in storage, or a chat thread: deleting it would delete the rows and
-- leave the files with no row (CLAUDE.md, «строка раньше файла»). Such a run is
-- refused whole and nothing is deleted; cancel those cleanings in the panel
-- instead, and let the retention take the files.
--
-- An id the script skipped (a day that already held her cleaning) matches no
-- row, so the 20, 22 and 25 October cleanings written in the panel are not
-- touched. A second run deletes nothing.
--
--   npx supabase db query --linked -f docs/one-off-writes/demo-cleanings-undo.sql
--   node scripts/cloud-read.mjs docs/rollout/demo_cleanings_probe.sql
do $$
declare
  c_ids constant uuid[] := array[
    '62eb1d16-7d10-4481-b13b-d031a85f6cff',
    '03b79fea-e407-43d2-a815-e5ed3b0599e3',
    'd998c04e-4aa7-45ee-8919-ac3848f8e021',
    '78cb80a3-2617-4eae-9025-6e422c05d30f',
    '003b24cd-8efe-428e-9134-2158e5fa5501',
    'b6f1b85c-5d7c-4920-a2ea-7c61374fd4c2',
    '1a3f6276-3cbf-4928-b28d-0ba21618b2f9',
    'df1702de-c693-43d1-b54d-3ba891b18456',
    '8c917d06-2f01-4a2a-8c3a-486b40419bbf',
    '9f9bfc35-de42-4443-baa5-829ac406dde8',
    '6f772181-7cf1-4caf-a565-8716bf34d228'
  ]::uuid[];
  v_deleted integer;
begin
  if exists (select 1 from public.task_media m where m.task_id = any (c_ids)) then
    raise exception 'A demo cleaning holds media; cancel it in the panel instead';
  end if;
  if exists (select 1 from public.chat_threads c where c.task_id = any (c_ids)) then
    raise exception 'A demo cleaning holds a chat thread; cancel it in the panel instead';
  end if;

  delete from public.tasks t
  where t.id = any (c_ids)
    and t.property_id = 900000000001;
  get diagnostics v_deleted = row_count;

  raise notice 'demo cleanings deleted: %', v_deleted;
end;
$$;
