-- The reads of review texts from the PMS on the fly (20261104200000,
-- docs/guest-review-text.md). Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - a person reads at most 30 texts in ten minutes; the 31st is refused and
--   still counted; another person has a limit of their own;
-- - the count is all that is kept: a person, a window and a number — the
--   table has no column for a review or a text;
-- - only the function's service role may count: a client role can neither
--   call the counter nor read or write the counts.
--
-- Fixture ids live under b62….
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('b6200001-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','reader.one@test.local','x',now(),now(),
   '{"full_name":"Reader One"}'::jsonb, '{"role":"manager"}'::jsonb),
  ('b6200002-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','reader.two@test.local','x',now(),now(),
   '{"full_name":"Reader Two"}'::jsonb, '{"role":"manager"}'::jsonb);

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $fn$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok — %', label;
end;
$fn$;

-- 30 reads go through, the 31st is refused; within one transaction now() is
-- one instant, so every read falls into the same window.
do $$
declare
  v_allowed integer := 0;
  v_last boolean;
begin
  for i in 1..31 loop
    v_last := public.take_review_text_read('b6200001-0000-4000-8000-000000000001');
    if v_last then
      v_allowed := v_allowed + 1;
    end if;
  end loop;
  perform pg_temp.check('thirty reads in ten minutes go through', v_allowed, 30);
  perform pg_temp.check('the thirty-first is refused', v_last, false);
end;
$$;

select pg_temp.check(
  'the refused read is counted too',
  (select reads from raw.review_text_reads
    where user_id = 'b6200001-0000-4000-8000-000000000001'),
  31);

select pg_temp.check(
  'another person has a limit of their own',
  public.take_review_text_read('b6200002-0000-4000-8000-000000000002'),
  true);

select pg_temp.check(
  'the window starts on a ten-minute boundary',
  (select bool_and(extract(epoch from window_start)::bigint % 600 = 0) from raw.review_text_reads),
  true);

-- Only counts: the table names a person, a window and a number.
select pg_temp.check(
  'the counts keep no review and no text',
  (select array_agg(column_name::text order by ordinal_position)
     from information_schema.columns
    where table_schema = 'raw' and table_name = 'review_text_reads'),
  array['user_id', 'window_start', 'reads']);

-- A window older than a day goes on the next read.
update raw.review_text_reads
   set window_start = window_start - interval '2 days'
 where user_id = 'b6200002-0000-4000-8000-000000000002';
select public.take_review_text_read('b6200001-0000-4000-8000-000000000001');
select pg_temp.check(
  'a day-old window is gone',
  (select count(*) from raw.review_text_reads
    where user_id = 'b6200002-0000-4000-8000-000000000002'),
  0::bigint);

do $$
begin
  perform public.take_review_text_read(null);
  raise exception 'FAIL a read without a reader was counted';
exception
  when invalid_parameter_value then
    raise notice 'ok — a read without a reader is refused';
end;
$$;

-- The client roles: no door to the counter, none to the counts.
select pg_temp.check(
  'authenticated may not call the counter',
  has_function_privilege('authenticated', 'public.take_review_text_read(uuid)', 'execute'),
  false);
select pg_temp.check(
  'anon may not call the counter',
  has_function_privilege('anon', 'public.take_review_text_read(uuid)', 'execute'),
  false);
select pg_temp.check(
  'the service role calls it',
  has_function_privilege('service_role', 'public.take_review_text_read(uuid)', 'execute'),
  true);
select pg_temp.check(
  'authenticated reads no counts',
  has_table_privilege('authenticated', 'raw.review_text_reads', 'select'),
  false);
select pg_temp.check(
  'authenticated writes no counts',
  has_table_privilege('authenticated', 'raw.review_text_reads', 'insert'),
  false);

rollback;
