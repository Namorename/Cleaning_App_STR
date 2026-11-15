-- CLIENT:Wagnerstays — the server files a task by its category, and a task without one as before:
-- report_problem called as an active cleaner of the company, inside a transaction that ALWAYS
-- rolls back. Nothing it writes survives — not the two tasks, not the head technician's push in
-- raw.push_outbox (send-push reads committed rows only).
--
--   npx supabase db query --linked -f docs/rollout/probe_wagner_report_rolled_back.sql
--
-- It runs on the write-capable connection, so only on the owner's word (named in the rollout
-- prompt of 2026-11-14 as «пробы после выкатки»), never in 03:00–04:40 UTC. Its answer is an
-- ERROR on purpose; the message carries the result:
--
--   PROBE OK: she reads 27 categories; by category «Горячая вода» filed as high (sent low),
--   title Горячая вода, category kept; typed task filed as normal, title kept, no category
--
-- Anything else in the message (PROBE FAILED, or another error) — stop and roll back per
-- docs/rollout/wagner-problem-catalog-1114.md.
do $$
declare
  c_host constant uuid := 'ce77c272-c330-4b74-ac98-c7d36cba8b2a';
  v_cleaner  uuid;
  v_category public.problem_categories;
  v_visible  integer;
  v_with     public.problems;
  v_without  public.problems;
begin
  perform set_config('lock_timeout', '3s', true);

  select p.id into v_cleaner
  from public.profiles p
  where p.host_id = c_host and p.role = 'cleaner' and p.is_active
  order by p.created_at
  limit 1;
  select c.* into v_category
  from public.problem_categories c
  where c.host_id = c_host and c.archived_at is null and c.priority = 'high'
  order by c.sort_order
  limit 1;
  if v_cleaner is null or v_category.id is null then
    raise exception 'PROBE FAILED: no active cleaner (%), or no live high category (%)',
      v_cleaner, v_category.id;
  end if;

  -- As her, through the policies.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_cleaner, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible from public.problem_categories c where c.archived_at is null;
  -- The phone sends the shown name and an urgency; the server must ignore both.
  v_with := public.report_problem(gen_random_uuid(), 'probe: shown name', null, 'low',
                                  null, null, v_category.id);
  -- As an older phone calls it: by name, without p_category_id.
  v_without := public.report_problem(p_id => gen_random_uuid(), p_title => 'Probe: typed title',
                                     p_priority => 'normal');

  perform set_config('role', 'postgres', true);

  if v_with.priority = v_category.priority and v_with.title = v_category.name
     and v_with.category_id = v_category.id
     and v_without.priority = 'normal' and v_without.title = 'Probe: typed title'
     and v_without.category_id is null then
    raise exception 'PROBE OK: she reads % categories; by category «%» filed as % (sent low), title %, category kept; typed task filed as %, title kept, no category',
      v_visible, v_category.name, v_with.priority, v_with.title, v_without.priority;
  end if;
  raise exception 'PROBE FAILED: visible %, by category %/%/%, typed %/%/%',
    v_visible, v_with.priority, v_with.title, v_with.category_id,
    v_without.priority, v_without.title, v_without.category_id;
end $$;
