-- More demo cleanings for Apple's App Review (owner's word of 2026-10-14,
-- 21:35: exactly this write, nothing else). The beta review of iOS 1.2.0 (2)
-- was turned down on 2026-10-13 and goes again with a new build: the reviewer
-- may sign in on any day up to 1 November, and the phone lets the demo cleaner
-- start a cleaning on its own day only, so every one of those days needs one.
--
-- What is written, and how — as demo-cleanings.sql (2026-10-10) did it:
--   - one cleaning («Уборка после выезда», type 'cleaning', the panel's default)
--     a day on 2026-10-19..2026-11-01, on listing 900000000001, for the one
--     active cleaner linked to it;
--   - through public.save_task, the call behind the panel's «Новая уборка», as
--     the company's manager (her id in the claims, as the SQL suites do it): the
--     same checks, the same author stamp, the same push rules as a click;
--   - no hours, as a cleaning written by hand in the panel: the server opens it
--     at 00:00 of its day in the listing's zone (task_start_not_before), and the
--     day ends it;
--   - the note below for the reviewer; the checklist is copied when she starts.
-- A day that already holds her live job on the listing (20 and 22 October hold
-- a cleaning, 25 October a mid-stay, all written in the panel on 2026-10-10) is
-- skipped, and so is an id that is already there: a second run writes nothing.
-- The ids are fixed, so the undo (demo-cleanings-2-undo.sql) removes exactly
-- these rows.
--
-- Who hears of it: a new cleaning with a name on it is pushed to that person
-- alone (push_on_task_change), and only inside her week (task_horizon_days):
-- written on 14 October, the 19 and 21 October cleanings are queued for her as
-- «cleaning_assigned», sent at 07:00 Prague when written in quiet hours
-- (21:00-07:00). Nobody else is told: the office does not hear of its own
-- writes, and free-work pushes are for cleanings without a name. The generator
-- and the syncs touch only cleanings of bookings; the launch reset leaves the
-- demo listing alone (docs/launch-reset.md).
--
-- Run once, outside 03:00-04:40 UTC, the owner confirming the tool call:
--   npx supabase db query --linked -f docs/one-off-writes/demo-cleanings-2.sql
-- Before and after:
--   node scripts/cloud-read.mjs docs/rollout/demo_cleanings_2_probe.sql
do $$
declare
  c_property constant bigint := 900000000001;
  -- The company's one active manager in the cloud on 2026-10-10.
  c_manager  constant uuid := '4c9decf5-3500-4178-ba81-67944f4052b9';
  c_note     constant text :=
    'Demo cleaning for App Review: open it, tap Accept, then Start, go through the checklist, take a photo, finish.';
  v_cleaner  uuid;
  v_cleaners integer;
  v_written  integer := 0;
  v_day      record;
begin
  if not exists (select 1 from public.properties p
                 where p.id = c_property and p.status = 'active'
                   and p.timezone = 'Europe/Prague') then
    raise exception 'Listing % is not the active demo listing in Europe/Prague', c_property;
  end if;
  if not exists (select 1 from public.profiles pr
                 where pr.id = c_manager and pr.is_active and pr.role in ('manager', 'admin')) then
    raise exception 'Profile % is not an active manager', c_manager;
  end if;

  select count(*), min(pr.id::text)::uuid into v_cleaners, v_cleaner
  from public.property_cleaners pc
  join public.profiles pr on pr.id = pc.cleaner_id
  where pc.property_id = c_property and pr.is_active and pr.role = 'cleaner';
  if v_cleaners <> 1 then
    raise exception 'Expected one active cleaner on listing %, found %', c_property, v_cleaners;
  end if;
  if exists (select 1 from public.property_cleaners pc
             where pc.cleaner_id = v_cleaner and pc.property_id <> c_property) then
    raise exception 'The demo cleaner is linked to another listing as well';
  end if;

  -- The manager's session, for this transaction only: is_manager() and the
  -- company come from her profile, and the rows are stamped as hers.
  perform set_config('request.jwt.claims',
                     json_build_object('sub', c_manager, 'role', 'authenticated')::text,
                     true);

  for v_day in
    select planned.id, planned.day
    from (values
      ('00336c33-a83c-4787-800c-61d36125eba8'::uuid, date '2026-10-19'),
      ('6f39851a-23cb-4269-9a3e-5a16916f0480'::uuid, date '2026-10-20'),
      ('86211dbe-775d-41a7-b088-bba1ec989d93'::uuid, date '2026-10-21'),
      ('ee98e92e-9d2e-4c10-88e1-93938a3cb581'::uuid, date '2026-10-22'),
      ('b4343dcf-9ebb-4f13-bbbf-a2b411d1fe7f'::uuid, date '2026-10-23'),
      ('23007aed-ba00-454d-bf6f-987a0d7dd2ab'::uuid, date '2026-10-24'),
      ('066f65d3-c5c2-4654-9b65-cf2d50d6c0e6'::uuid, date '2026-10-25'),
      ('9202ba83-301e-4c0c-b979-47d48342d0e4'::uuid, date '2026-10-26'),
      ('73b04a47-e16d-439f-a721-39e289d49a65'::uuid, date '2026-10-27'),
      ('fc56b4b4-0a3f-45c0-9939-d9e028281174'::uuid, date '2026-10-28'),
      ('4211dbaf-7331-4c7b-963b-5491a3b145f9'::uuid, date '2026-10-29'),
      ('b2256db8-7220-4bbf-beef-bb1272a8551b'::uuid, date '2026-10-30'),
      ('bc4c1e7a-e900-44fc-b968-bbc1243ebb04'::uuid, date '2026-10-31'),
      ('d1335385-96f2-4816-bc21-bbd5efacd2ae'::uuid, date '2026-11-01')
    ) as planned (id, day)
    order by planned.day
  loop
    continue when exists (select 1 from public.tasks t where t.id = v_day.id);
    continue when exists (select 1 from public.tasks t
                          where t.property_id = c_property
                            and t.assignee_id = v_cleaner
                            and t.scheduled_date = v_day.day
                            and t.status not in ('cancelled', 'expired'));
    perform public.save_task(
      p_id             => v_day.id,
      p_property_id    => c_property,
      p_type           => 'cleaning'::public.task_type,
      p_scheduled_date => v_day.day,
      p_assignee_id    => v_cleaner,
      p_notes          => c_note
    );
    v_written := v_written + 1;
  end loop;

  raise notice 'demo cleanings written: %', v_written;
end;
$$;
