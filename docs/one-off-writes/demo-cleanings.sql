-- The demo cleaner's cleanings on the demo listing, for Apple's App Review
-- (owner's word of 2026-10-10, 22:09: exactly this write, nothing else). The
-- reviewer signs in as the demo cleaner; the phone shows her a week ahead and
-- lets her start a cleaning on its own day only, so every day of the review
-- needs one.
--
-- What is written, and how:
--   - one cleaning («Уборка после выезда», type 'cleaning', the panel's default)
--     a day on 2026-10-11..18, 20, 22 and 25, on listing 900000000001, for the
--     one active cleaner linked to it;
--   - through public.save_task, the call behind the panel's «Новая уборка», as
--     the company's manager (her id in the claims, as the SQL suites do it): the
--     same checks, the same author stamp, the same push rules as a click;
--   - no hours, as a cleaning written by hand in the panel: the server opens it
--     at 00:00 of its day in the listing's zone (task_start_not_before), and the
--     day ends it;
--   - the note below for the reviewer; the checklist is copied when she starts.
-- A day that already holds her live job on the listing (20, 22 and 25 October
-- were written in the panel on 2026-10-10) is skipped, and so is an id that is
-- already there: a second run writes nothing. The ids are fixed, so the undo
-- (demo-cleanings-undo.sql) removes exactly these rows.
--
-- Nothing reaches anyone's phone: a new cleaning with a name on it is pushed to
-- that person alone (push_on_task_change), and she has no phone registered.
-- The generator and the syncs touch only cleanings of bookings; the launch
-- reset leaves the demo listing alone (docs/launch-reset.md).
--
-- Run once, outside 03:00-04:40 UTC, the owner confirming the tool call:
--   npx supabase db query --linked -f docs/one-off-writes/demo-cleanings.sql
-- Before and after:
--   node scripts/cloud-read.mjs docs/rollout/demo_cleanings_probe.sql
do $$
declare
  c_property constant bigint := 900000000001;
  -- The company's one active manager in the cloud on 2026-10-10.
  c_manager  constant uuid := '4c9decf5-3500-4178-ba81-67944f4052b9';
  c_note     constant text :=
    'Demo cleaning for App Review: open it, start, go through the checklist, take a photo, finish.';
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
      ('62eb1d16-7d10-4481-b13b-d031a85f6cff'::uuid, date '2026-10-11'),
      ('03b79fea-e407-43d2-a815-e5ed3b0599e3'::uuid, date '2026-10-12'),
      ('d998c04e-4aa7-45ee-8919-ac3848f8e021'::uuid, date '2026-10-13'),
      ('78cb80a3-2617-4eae-9025-6e422c05d30f'::uuid, date '2026-10-14'),
      ('003b24cd-8efe-428e-9134-2158e5fa5501'::uuid, date '2026-10-15'),
      ('b6f1b85c-5d7c-4920-a2ea-7c61374fd4c2'::uuid, date '2026-10-16'),
      ('1a3f6276-3cbf-4928-b28d-0ba21618b2f9'::uuid, date '2026-10-17'),
      ('df1702de-c693-43d1-b54d-3ba891b18456'::uuid, date '2026-10-18'),
      ('8c917d06-2f01-4a2a-8c3a-486b40419bbf'::uuid, date '2026-10-20'),
      ('9f9bfc35-de42-4443-baa5-829ac406dde8'::uuid, date '2026-10-22'),
      ('6f772181-7cf1-4caf-a565-8716bf34d228'::uuid, date '2026-10-25')
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
