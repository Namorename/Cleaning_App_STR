-- Undo of demo-cleanings-2.sql: removes exactly the demo cleanings that script
-- wrote, by their fixed ids, on the demo listing only. NOT to be run without
-- the owner's word (2026-10-14: the undo is written, not run).
--
-- A cleaning the reviewer has photographed or written about holds media rows
-- and files in storage, or a chat thread: deleting it would delete the rows and
-- leave the files with no row (CLAUDE.md, «строка раньше файла»). Such a run is
-- refused whole and nothing is deleted; cancel those cleanings in the panel
-- instead, and let the retention take the files.
--
-- An id the script skipped (a day that already held her job) matches no row, so
-- the 20, 22 and 25 October jobs written in the panel are not touched. A second
-- run deletes nothing.
--
--   npx supabase db query --linked -f docs/one-off-writes/demo-cleanings-2-undo.sql
--   node scripts/cloud-read.mjs docs/rollout/demo_cleanings_2_probe.sql
do $$
declare
  c_ids constant uuid[] := array[
    '00336c33-a83c-4787-800c-61d36125eba8',
    '6f39851a-23cb-4269-9a3e-5a16916f0480',
    '86211dbe-775d-41a7-b088-bba1ec989d93',
    'ee98e92e-9d2e-4c10-88e1-93938a3cb581',
    'b4343dcf-9ebb-4f13-bbbf-a2b411d1fe7f',
    '23007aed-ba00-454d-bf6f-987a0d7dd2ab',
    '066f65d3-c5c2-4654-9b65-cf2d50d6c0e6',
    '9202ba83-301e-4c0c-b979-47d48342d0e4',
    '73b04a47-e16d-439f-a721-39e289d49a65',
    'fc56b4b4-0a3f-45c0-9939-d9e028281174',
    '4211dbaf-7331-4c7b-963b-5491a3b145f9',
    'b2256db8-7220-4bbf-beef-bb1272a8551b',
    'bc4c1e7a-e900-44fc-b968-bbc1243ebb04',
    'd1335385-96f2-4816-bc21-bbd5efacd2ae'
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
