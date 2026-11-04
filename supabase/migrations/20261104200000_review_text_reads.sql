-- The panel reads a review's own words from the PMS on the fly
-- (supabase/functions/guest-review-text, docs/guest-review-text.md): the
-- text passes through the function's memory to the manager's page and is
-- never stored. What is stored is how many such reads one person made in a
-- window of ten minutes — so that a stolen session or a loop cannot pull the
-- texts out by the thousand. No review, no text, no address: a person, a
-- window and a number, gone after a day.
--
-- Nothing else changes: no table a client reads, no grant to a client role.
-- The person is a profile, as in the other raw queues (raw.push_outbox): a
-- key to auth.users would lock the table every sign-in writes.

set local lock_timeout = '3s';

create table raw.review_text_reads (
  user_id      uuid not null references public.profiles (id) on delete cascade,
  window_start timestamptz not null,
  reads        integer not null default 0 check (reads >= 0),
  primary key (user_id, window_start)
);
create index review_text_reads_window_idx on raw.review_text_reads (window_start);
revoke all on raw.review_text_reads from public, anon, authenticated;

comment on table raw.review_text_reads is
  'Reads of review texts from the PMS per person and ten minutes (guest-review-text). Counts only; kept a day.';

/**
 * Takes one read of a review's text for a person and says whether it stays
 * within the limit: 120 in the current ten minutes (a manager reading
 * through a month of reviews, quickly, stays below it; the function keeps a
 * month's page of the PMS for ten minutes, so most reads cost Hostaway
 * nothing, and the rest one request or two). The read is counted
 * either way, so a loop keeps failing until its window is over. Windows older
 * than a day go on the way.
 *
 * Only the function calls it, with the id of the person it has already
 * checked (an active manager or admin of the company): service_role only.
 */
create or replace function public.take_review_text_read(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_limit  constant integer := 120;
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / 600) * 600);
  v_reads  integer;
begin
  if p_user_id is null then
    raise exception 'A read of a review text needs its reader'
      using errcode = 'invalid_parameter_value', hint = 'serverErrors.unknown';
  end if;

  delete from raw.review_text_reads where window_start < now() - interval '1 day';

  insert into raw.review_text_reads as r (user_id, window_start, reads)
  values (p_user_id, v_window, 1)
  on conflict (user_id, window_start) do update set reads = r.reads + 1
  returning r.reads into v_reads;

  return v_reads <= c_limit;
end;
$$;

revoke all on function public.take_review_text_read(uuid) from public, anon, authenticated;
grant execute on function public.take_review_text_read(uuid) to service_role;
