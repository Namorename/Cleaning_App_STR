-- The rollout's write probe of 20261118120000, in the cloud, rolled back by its own end: one
-- statement, a DO block that always raises — «PROBE OK …» or «PROBE FAIL …» — so nothing it wrote
-- stays (the cleaning, the journal, the push queue, the generator's trace).
--   npx supabase db query --linked -f docs/one-off-writes/probe_cleaning_offs_write.sql
-- Not in 03:00–04:40 UTC. On a real cleaning nobody has started, within the next week, with an
-- active cleaner: she declines it; the office hears it and reads why; a manager cancels it; the
-- generator, run over its departure, writes the booking no new cleaning; «Вернуть» gives it back.
do $$
declare
  v_task   uuid;
  v_who    uuid;
  v_res    bigint;
  v_place  bigint;
  v_host   uuid;
  v_boss   uuid;
  v_dep    date;
  v_status text;
  v_pushes integer;
  v_reason text;
  v_live   integer;
  v_back   text;
begin
  select t.id, t.assignee_id, t.reservation_id, t.property_id, t.host_id
    into v_task, v_who, v_res, v_place, v_host
  from public.tasks t
  join public.profiles p on p.id = t.assignee_id and p.is_active
  where t.status in ('assigned', 'accepted') and t.problem_id is null and t.type = 'cleaning'
    and t.reservation_id is not null
    and t.scheduled_date between current_date + 1 and current_date + 7
  order by t.scheduled_date, t.id
  limit 1;
  if v_task is null then
    raise exception 'PROBE FAIL no cleaning to probe';
  end if;
  select p.id into v_boss from public.profiles p
  where p.host_id = v_host and p.role in ('manager', 'admin') and p.is_active
  order by p.created_at limit 1;
  select r.departure_date into v_dep from public.reservations r where r.id = v_res;

  -- She declines it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_who, 'role', 'authenticated')::text, true);
  perform public.decline_cleaning(v_task, 'probe');
  select status::text into v_status from public.tasks where id = v_task;
  select count(*) into v_pushes from raw.push_outbox
  where task_id = v_task and kind::text = 'cleaning_declined' and settled_at is null;

  -- The office reads why, and cancels it.
  perform set_config('request.jwt.claims', json_build_object('sub', v_boss, 'role', 'authenticated')::text, true);
  select public.task_offs(t) #>> '{released,reason}' into v_reason from public.tasks t where t.id = v_task;
  perform public.cancel_cleaning(v_task, 'probe cancel');

  -- The generator, as the night runs it, over the booking's departure.
  perform set_config('request.jwt.claims', '{}', true);
  perform public.generate_cleaning_tasks(v_dep - 1, v_dep + 1);
  select count(*) into v_live from public.tasks
  where reservation_id = v_res and property_id = v_place and type = 'cleaning'
    and status not in ('cancelled', 'expired');

  -- «Вернуть».
  perform set_config('request.jwt.claims', json_build_object('sub', v_boss, 'role', 'authenticated')::text, true);
  perform public.restore_cleaning(v_task);
  select status::text || ':' || coalesce(assignee_id::text, '-') into v_back from public.tasks where id = v_task;

  if v_status = 'unassigned' and v_reason = 'probe' and v_live = 0 and v_back = 'unassigned:-' then
    raise exception 'PROBE OK declined=% office_pushes=% reason=% live_after_generator=% restored=%',
      v_status, v_pushes, v_reason, v_live, split_part(v_back, ':', 1);
  end if;
  raise exception 'PROBE FAIL declined=% office_pushes=% reason=% live_after_generator=% restored=%',
    v_status, v_pushes, v_reason, v_live, v_back;
end $$;
