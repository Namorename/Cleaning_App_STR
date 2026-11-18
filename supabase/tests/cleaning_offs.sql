-- Cleanings taken off (20261118120000): the office cancels a cleaning in any status and returns
-- it; a cleaner declines one she has not started, or interrupts one she has.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- What is being protected:
-- - cancel_cleaning takes a cleaning off in every status and keeps who, the status before and
--   the closing of a done or lapsed one; the steps and photos stay; a second cancel changes
--   nothing; the reason is optional, trimmed, at most 500 characters, and lives with the
--   cleaning (task_off_notes, the office's alone), never in the journal, which keeps codes only;
-- - restore_cleaning gives back the status, the person (unless she is switched off since) and
--   the closing; it refuses a cancel the office did not make through it, and a booking that has
--   another cleaning of the place meanwhile;
-- - only the office cancels and returns, within its own company, never a repair; a cleaner hands
--   back only her own cleaning, declined before the start and interrupted after it, an interrupt
--   with a reason; the body of both is no client's;
-- - the marks are written by those functions alone: neither a cleaner nor a manager writes them
--   by hand; a new person on the job clears a hand-back, leaving «cancelled» clears a cancel;
-- - an interrupted cleaning keeps its start, its steps and its photos, and whoever takes it next
--   — with the phone of before — goes on from them and finishes it;
-- - the generator writes no new cleaning while the booking keeps the departure the office
--   cancelled, leaves work started and handed back where it is, and gives no cleaning handed
--   back to the listing's regular cleaner;
-- - a hand-back tells every active manager and admin of the company with a phone, and the
--   cleaners of the listing that it is free, never the one who handed it back;
-- - a cancelled cleaning leaves the counters and the free queue; API v1 keeps it in its
--   unfiltered list, with its status, as v1 always did;
-- - task_offs is the office's alone, a made-up row reads nobody's words; a direct insert carries
--   no mark; an old phone reads a hand-back as free work.
--
-- Fixture ids live in the 900118xxx range and under f118…. The listings are in UTC, so today
-- in the listing is today in the test.
begin;

alter default privileges for role postgres grant execute on functions to authenticated;

-- ---------- helpers ----------

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

/** A statement's translated hint, or its SQLSTATE, or 'no error'. */
create or replace function pg_temp.refusal(statement text)
returns text language plpgsql as $$
declare
  v_hint text;
begin
  execute statement;
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return case when v_hint like 'serverErrors.%' then v_hint else sqlstate end;
end $$;

/** How many rows a statement reached: a policy that filters a row out says 0. */
create or replace function pg_temp.affected(statement text)
returns integer language plpgsql as $$
declare
  v_rows integer;
begin
  execute statement;
  get diagnostics v_rows = row_count;
  return v_rows;
end $$;

create or replace function pg_temp.host() returns uuid language sql immutable as $$
  select 'f1180000-0000-4000-8000-00000000000a'::uuid $$;
create or replace function pg_temp.other_host() returns uuid language sql immutable as $$
  select 'f1180000-0000-4000-8000-00000000000b'::uuid $$;

create or replace function pg_temp.uid(n integer) returns uuid language sql immutable as $$
  select ('f11800' || lpad(n::text, 2, '0') || '-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.boss()   returns uuid language sql immutable as $$ select pg_temp.uid(1) $$;
create or replace function pg_temp.ada()    returns uuid language sql immutable as $$ select pg_temp.uid(2) $$;
create or replace function pg_temp.ina()    returns uuid language sql immutable as $$ select pg_temp.uid(3) $$;
create or replace function pg_temp.milo()   returns uuid language sql immutable as $$ select pg_temp.uid(4) $$;
create or replace function pg_temp.anna()   returns uuid language sql immutable as $$ select pg_temp.uid(5) $$;
create or replace function pg_temp.bella()  returns uuid language sql immutable as $$ select pg_temp.uid(6) $$;
create or replace function pg_temp.cara()   returns uuid language sql immutable as $$ select pg_temp.uid(7) $$;
create or replace function pg_temp.hector() returns uuid language sql immutable as $$ select pg_temp.uid(8) $$;
create or replace function pg_temp.olga()   returns uuid language sql immutable as $$ select pg_temp.uid(9) $$;

create or replace function pg_temp.who(person uuid) returns text language sql immutable as $$
  select case person
    when pg_temp.boss() then 'boss' when pg_temp.ada() then 'ada' when pg_temp.ina() then 'ina'
    when pg_temp.milo() then 'milo' when pg_temp.anna() then 'anna' when pg_temp.bella() then 'bella'
    when pg_temp.cara() then 'cara' when pg_temp.hector() then 'hector' when pg_temp.olga() then 'olga'
    else coalesce(person::text, '-') end $$;

create or replace function pg_temp.as_user(person uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims', '{"sub":"' || person || '","role":"authenticated"}', true)
$$;
-- The server: the generator, the nightly pass, the API (auth.uid() is null).
create or replace function pg_temp.as_server() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '{}', true) $$;
-- Somebody's identity without row level security: a direct call of a function on a row the
-- policies would not show her.
create or replace function pg_temp.claims_only(person uuid) returns void language sql as $$
  select set_config('role', 'postgres', true),
         set_config('request.jwt.claims', '{"sub":"' || person || '","role":"authenticated"}', true)
$$;

create or replace function pg_temp.tid(n integer) returns uuid language sql immutable as $$
  select ('f1181000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.sid(n integer) returns uuid language sql immutable as $$
  select ('f1182000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
create or replace function pg_temp.mid(n integer) returns uuid language sql immutable as $$
  select ('f1183000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;
-- The eight cleanings of the status matrix.
create or replace function pg_temp.matrix() returns uuid[] language sql immutable as $$
  select array(select pg_temp.tid(n) from generate_series(1, 8) n) $$;

-- "status person" of a cleaning.
create or replace function pg_temp.state(p_task uuid) returns text language sql as $$
  select t.status::text || ' ' || pg_temp.who(t.assignee_id) from public.tasks t where t.id = p_task $$;
-- "status cancelled_from cancelled_by has_cancelled_at".
create or replace function pg_temp.offmark(p_task uuid) returns text language sql as $$
  select t.status::text || ' ' || coalesce(t.cancelled_from::text, '-') || ' '
         || pg_temp.who(t.cancelled_by) || ' ' || (t.cancelled_at is not null)::text
  from public.tasks t where t.id = p_task $$;
-- "release_kind released_by has_released_at".
create or replace function pg_temp.release(p_task uuid) returns text language sql as $$
  select coalesce(t.release_kind, '-') || ' ' || pg_temp.who(t.released_by) || ' '
         || (t.released_at is not null)::text
  from public.tasks t where t.id = p_task $$;
-- How many of the cleanings carry any mark of an office cancel.
create or replace function pg_temp.cancel_marks(p_ids uuid[]) returns integer language sql as $$
  select count(*)::integer from public.tasks t
  where t.id = any (p_ids)
    and (t.cancelled_at is not null or t.cancelled_by is not null or t.cancelled_from is not null
         or t.cancel_departure is not null or t.cancelled_closing is not null) $$;
-- "how worker source closer cause closer_source" of a cleaning; 'none' for no row.
create or replace function pg_temp.closing(p_task uuid) returns text language sql as $$
  select coalesce((select coalesce(c.closed_how, '-') || ' ' || pg_temp.who(c.completed_by) || ' '
                          || coalesce(c.worker_source, '-') || ' ' || pg_temp.who(c.closed_by) || ' '
                          || coalesce(c.closed_cause, '-') || ' ' || coalesce(c.closer_source, '-')
                   from public.task_closings c where c.task_id = p_task), 'none') $$;
-- The steps and photos of some cleanings, as they stand.
create or replace function pg_temp.kept(p_ids uuid[]) returns text language sql as $$
  select (select count(*) from public.task_steps s where s.task_id = any (p_ids))::text || ' steps, '
      || (select count(*) from public.task_media m
          where m.task_id = any (p_ids) and m.deleted_at is null and m.purged_at is null)::text || ' photos, '
      || (select count(*) from public.task_steps s
          where s.task_id = any (p_ids) and s.completed_at is not null)::text || ' completed' $$;

create or replace function pg_temp.events(p_task uuid, p_kind text) returns integer language sql as $$
  select count(*)::integer from public.task_events e where e.task_id = p_task and e.kind::text = p_kind $$;
-- The words written with a cancel ('cancelled' event) or a hand-back ('unassigned' event): they
-- live with the cleaning (task_off_notes), never in the journal, which holds codes only.
create or replace function pg_temp.event_reason(p_task uuid, p_kind text) returns text language sql as $$
  select n.reason from public.task_off_notes n
  where n.task_id = p_task
    and n.kind = any (case p_kind when 'cancelled' then array['cancelled']
                                  else array['declined', 'interrupted'] end)
  order by n.id desc limit 1 $$;
-- "cause actor reason" of the latest event of a kind, the reason from its note.
create or replace function pg_temp.event(p_task uuid, p_kind text) returns text language sql as $$
  select coalesce(e.cause, '-') || ' ' || pg_temp.who(e.actor_id) || ' '
         || coalesce(pg_temp.event_reason(p_task, p_kind), '-')
  from public.task_events e where e.task_id = p_task and e.kind::text = p_kind
  order by e.id desc limit 1 $$;
create or replace function pg_temp.event_params(p_task uuid, p_kind text) returns jsonb language sql as $$
  select e.params from public.task_events e where e.task_id = p_task and e.kind::text = p_kind
  order by e.id desc limit 1 $$;

-- What the push queue holds for a cleaning, as "Name kind", by name. Read as postgres: the
-- queue lives in raw, closed to every client.
create or replace function pg_temp.pushes(p_task uuid) returns text[] language sql as $$
  select coalesce(array_agg(coalesce(pr.full_name, '?') || ' ' || o.kind::text
                            order by pr.full_name, o.kind::text), '{}')
  from raw.push_outbox o
  left join public.profiles pr on pr.id = o.recipient_id
  where o.task_id = p_task $$;
create or replace function pg_temp.clear_pushes() returns void language sql as $$
  delete from raw.push_outbox where host_id in (pg_temp.host(), pg_temp.other_host()) $$;

-- The digest the Edge Function would send for the key (a plain sha256 stands in for the HMAC).
create or replace function pg_temp.digest() returns text language sql immutable as $$
  select encode(sha256(convert_to('offs-1118-key', 'UTF8')), 'hex') $$;

-- The generator's days: a window of its own, well clear of today.
create or replace function pg_temp.d0() returns date language sql stable as $$
  select current_date + 40 $$;
create or replace function pg_temp.run() returns jsonb language sql as $$
  select public.generate_cleaning_tasks(pg_temp.d0() - 2, pg_temp.d0() + 8) $$;
-- A booking's cleanings, as "status@day person", the day counted from d0.
create or replace function pg_temp.cleanings(p_reservation bigint) returns text language sql as $$
  select coalesce(string_agg(t.status::text || '@' || (t.scheduled_date - pg_temp.d0())::text
                             || ' ' || pg_temp.who(t.assignee_id),
                             ', ' order by t.status::text, t.scheduled_date), 'none')
  from public.tasks t where t.reservation_id = p_reservation and t.type = 'cleaning' $$;

-- ---------- fixtures ----------

-- The generator writes its cleanings under default_host_id(), the oldest company: the suite's
-- company is the oldest for the length of the transaction, so its bookings' cleanings are its own.
insert into public.hosts (id, name, created_at) values
  (pg_temp.host(), 'Cleaning offs company', '2000-01-01 00:00+00'),
  (pg_temp.other_host(), 'Cleaning offs elsewhere', now());

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
select pg_temp.uid(u.n), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       lower(u.name) || '.offs1118@test.local', 'x', now(), now(),
       jsonb_build_object('full_name', u.name), jsonb_build_object('role', u.role)
from (values (1, 'Boss', 'manager'), (2, 'Ada', 'admin'), (3, 'Ina', 'manager'),
             (4, 'Milo', 'manager'), (5, 'Anna', 'cleaner'), (6, 'Bella', 'cleaner'),
             (7, 'Cara', 'cleaner'), (8, 'Hector', 'head_tech'), (9, 'Olga', 'manager')) u(n, name, role);

update public.profiles
set host_id = case when id = pg_temp.olga() then pg_temp.other_host() else pg_temp.host() end
where id in (select pg_temp.uid(n) from generate_series(1, 9) n);

insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time)
select 900118000 + p.n, case when p.n = 9 then pg_temp.other_host() else pg_temp.host() end,
       p.name, 'UTC', '15:00', '10:00'
from (values (1, 'Offs flat'), (2, 'Push flat'), (3, 'Interrupt flat'), (4, 'Generator flat'),
             (5, 'Auto flat'), (6, 'Rebooked flat'), (7, 'Interrupted booking flat'),
             (8, 'Counter flat'), (9, 'Elsewhere flat')) p(n, name);
-- A room of the interrupted booking's listing, for the relocate pass.
insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time,
                               parent_id, hostaway_unit_id)
values (public.property_id_for_unit(900118010), pg_temp.host(), 'Interrupted booking room', 'UTC',
        '15:00', '10:00', 900118007, 900118010);

-- Anna and Bella take free work on the flats of the matrix, the pushes, the interrupt and the
-- counters; Cara on the matrix's flat alone.
insert into public.property_cleaners (host_id, property_id, cleaner_id, mode)
select pg_temp.host(), 900118000 + p.n, c.id, 'claim'
from (values (1), (2), (3), (8)) p(n)
cross join (values (pg_temp.anna()), (pg_temp.bella())) c(id);
insert into public.property_cleaners (host_id, property_id, cleaner_id, mode)
values (pg_temp.host(), 900118001, pg_temp.cara(), 'claim');

-- Phones: everybody but Milo. Ina is switched off below, phone and all.
insert into public.push_tokens (token, profile_id, host_id, platform)
select 'ExponentPushToken[offs1118-' || pg_temp.who(x.id) || ']', x.id,
       case when x.id = pg_temp.olga() then pg_temp.other_host() else pg_temp.host() end, 'ios'
from (values (pg_temp.boss()), (pg_temp.ada()), (pg_temp.ina()), (pg_temp.anna()),
             (pg_temp.bella()), (pg_temp.cara()), (pg_temp.hector()), (pg_temp.olga())) x(id);

update public.profiles set is_active = false where id = pg_temp.ina();

select (public.create_api_key(pg_temp.ada(), 'Offs key', 'woom_offsAAA', pg_temp.digest(),
                              'read_only')) ->> 'id' as offs_key \gset

-- ---------- 1. the office cancels, in every status ----------

-- Done by her own hand, and lapsed by the night: each with the closing of its own road.
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id) values
  (pg_temp.tid(7), pg_temp.host(), 900118001, 'cleaning', 'assigned', current_date, pg_temp.anna()),
  (pg_temp.tid(8), pg_temp.host(), 900118001, 'cleaning', 'assigned', current_date, pg_temp.anna());
select pg_temp.as_user(pg_temp.anna());
update public.tasks set status = 'in_progress' where id = pg_temp.tid(7);
update public.tasks set status = 'done' where id = pg_temp.tid(7);
select pg_temp.as_server();
update public.tasks set status = 'expired' where id = pg_temp.tid(8);

insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id,
                          started_at) values
  (pg_temp.tid(1), pg_temp.host(), 900118001, 'cleaning', 'unassigned', current_date, null, null),
  (pg_temp.tid(2), pg_temp.host(), 900118001, 'cleaning', 'assigned', current_date, pg_temp.anna(), null),
  (pg_temp.tid(3), pg_temp.host(), 900118001, 'cleaning', 'accepted', current_date, pg_temp.anna(), null),
  (pg_temp.tid(4), pg_temp.host(), 900118001, 'cleaning', 'in_progress', current_date, pg_temp.anna(),
   now() - interval '1 hour'),
  (pg_temp.tid(5), pg_temp.host(), 900118001, 'cleaning', 'paused', current_date, pg_temp.anna(),
   now() - interval '1 hour'),
  (pg_temp.tid(6), pg_temp.host(), 900118001, 'cleaning', 'blocked', current_date, pg_temp.anna(),
   now() - interval '1 hour'),
  (pg_temp.tid(9), pg_temp.host(), 900118001, 'cleaning', 'unassigned', current_date, null, null),
  (pg_temp.tid(10), pg_temp.host(), 900118001, 'cleaning', 'assigned', current_date, pg_temp.cara(), null),
  (pg_temp.tid(11), pg_temp.host(), 900118001, 'cleaning', 'unassigned', current_date, null, null),
  (pg_temp.tid(12), pg_temp.host(), 900118001, 'cleaning', 'assigned', current_date, pg_temp.anna(), null),
  (pg_temp.tid(13), pg_temp.host(), 900118001, 'cleaning', 'assigned', current_date, pg_temp.anna(), null),
  (pg_temp.tid(15), pg_temp.host(), 900118001, 'cleaning', 'assigned', current_date, pg_temp.anna(), null);

-- One step and one photo on each cleaning of the matrix; the one under way has its step done.
insert into public.task_steps (id, task_id, host_id, sort_order, type, required, completed_at,
                               completed_by)
select pg_temp.sid(n), pg_temp.tid(n), pg_temp.host(), 1, 'photos_after', false,
       case when n = 4 then now() - interval '30 minutes' end,
       case when n = 4 then pg_temp.anna() end
from generate_series(1, 8) n;
insert into public.task_media (id, host_id, task_id, step_id, kind, storage_path, mime_type,
                               byte_size, created_by, uploaded_at)
select pg_temp.mid(n), pg_temp.host(), pg_temp.tid(n), pg_temp.sid(n), 'photo',
       pg_temp.host() || '/' || pg_temp.tid(n) || '/' || pg_temp.mid(n) || '.jpg', 'image/jpeg',
       1000, pg_temp.anna(), now()
from generate_series(1, 8) n;

select pg_temp.check('before: the done one is closed by her own hand',
  pg_temp.closing(pg_temp.tid(7)), 'worker anna recorded anna - recorded');
select pg_temp.check('before: the expired one by the night',
  pg_temp.closing(pg_temp.tid(8)), 'auto - - - night_pass recorded');
select pg_temp.closing(pg_temp.tid(7)) as closing7, pg_temp.closing(pg_temp.tid(8)) as closing8 \gset

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('the office cancels a cleaning nobody holds: the row comes back cancelled',
  (public.cancel_cleaning(pg_temp.tid(1))).status::text, 'cancelled');
select pg_temp.check('with a reason, the row names the status before',
  (public.cancel_cleaning(pg_temp.tid(2), '  Owner stays  ')).cancelled_from::text, 'assigned');
select pg_temp.check('the six others, a blank reason among them, in one go',
  (select count(*)::int
   from generate_series(3, 8) n,
        lateral public.cancel_cleaning(pg_temp.tid(n), case when n = 3 then '   ' end) c
   where c.status = 'cancelled'),
  6);
select pg_temp.as_server();

select pg_temp.check('unassigned: cancelled, from unassigned, by the manager',
  pg_temp.offmark(pg_temp.tid(1)), 'cancelled unassigned boss true');
select pg_temp.check('assigned: cancelled, from assigned, by the manager',
  pg_temp.offmark(pg_temp.tid(2)), 'cancelled assigned boss true');
select pg_temp.check('accepted: cancelled, from accepted, by the manager',
  pg_temp.offmark(pg_temp.tid(3)), 'cancelled accepted boss true');
select pg_temp.check('in progress: cancelled, from in_progress, by the manager',
  pg_temp.offmark(pg_temp.tid(4)), 'cancelled in_progress boss true');
select pg_temp.check('paused: cancelled, from paused, by the manager',
  pg_temp.offmark(pg_temp.tid(5)), 'cancelled paused boss true');
select pg_temp.check('blocked: cancelled, from blocked, by the manager',
  pg_temp.offmark(pg_temp.tid(6)), 'cancelled blocked boss true');
select pg_temp.check('done: cancelled, from done, by the manager',
  pg_temp.offmark(pg_temp.tid(7)), 'cancelled done boss true');
select pg_temp.check('expired: cancelled, from expired, by the manager',
  pg_temp.offmark(pg_temp.tid(8)), 'cancelled expired boss true');
select pg_temp.check('the person stays on the cancelled row, for the return',
  (select string_agg(distinct pg_temp.who(t.assignee_id), ',') from public.tasks t
   where t.id = any (pg_temp.matrix()) and t.id <> pg_temp.tid(1)),
  'anna');
select pg_temp.check('a cleaning of no booking holds no departure',
  (select count(*)::int from public.tasks t
   where t.id = any (pg_temp.matrix()) and t.cancel_departure is not null),
  0);
select pg_temp.check('the done one keeps its closing on the row: her work, closed by her',
  (select (t.cancelled_closing ->> 'closed_how') || ' '
          || pg_temp.who((t.cancelled_closing ->> 'completed_by')::uuid) || ' '
          || pg_temp.who((t.cancelled_closing ->> 'closed_by')::uuid)
   from public.tasks t where t.id = pg_temp.tid(7)),
  'worker anna anna');
select pg_temp.check('the expired one keeps the night''s',
  (select (t.cancelled_closing ->> 'closed_how') || ' ' || (t.cancelled_closing ->> 'closed_cause')
   from public.tasks t where t.id = pg_temp.tid(8)),
  'auto night_pass');
select pg_temp.check('a live one has no closing to keep',
  (select count(*)::int from public.tasks t
   where t.id = any ((pg_temp.matrix())[1:6]) and t.cancelled_closing is not null),
  0);
select pg_temp.check('the cancel itself is stamped the manager''s, as every cancel is',
  pg_temp.closing(pg_temp.tid(7)), 'manager - - boss - recorded');
select pg_temp.check('the steps and the photos stay with the cancelled cleanings',
  pg_temp.kept(pg_temp.matrix()), '8 steps, 8 photos, 1 completed');
select pg_temp.check('the journal says the manager cancelled it',
  pg_temp.event(pg_temp.tid(4), 'cancelled'), 'manager boss -');
select pg_temp.check('and from what',
  pg_temp.event_params(pg_temp.tid(4), 'cancelled') ->> 'from', 'in_progress');
select pg_temp.check('the reason is kept, trimmed, on the cancelled event',
  pg_temp.event_reason(pg_temp.tid(2), 'cancelled'), 'Owner stays');
select pg_temp.check('a blank reason is no reason',
  pg_temp.event_reason(pg_temp.tid(3), 'cancelled'), null::text);
select pg_temp.check('no reason at all is fine',
  pg_temp.event_reason(pg_temp.tid(1), 'cancelled'), null::text);
select pg_temp.check('the row itself holds no words',
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'tasks' and column_name like '%reason%'),
  0);

-- A second cancel, by another manager, with other words: the row as it was.
select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('a second cancel answers the row as it is: the first manager stays its author',
  pg_temp.who((public.cancel_cleaning(pg_temp.tid(2), 'Other words')).cancelled_by), 'boss');
select pg_temp.as_server();
select pg_temp.check('and writes no second cancelled event: the words are the first ones',
  pg_temp.events(pg_temp.tid(2), 'cancelled')::text || ' ' || pg_temp.event_reason(pg_temp.tid(2), 'cancelled'),
  '1 Owner stays');

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('a reason of 501 characters is refused',
  pg_temp.refusal(format('select public.cancel_cleaning(%L, %L)', pg_temp.tid(9), repeat('x', 501))),
  'serverErrors.reasonTooLong');
select pg_temp.as_server();
select pg_temp.check('and the cleaning stays as it was',
  pg_temp.offmark(pg_temp.tid(9)), 'unassigned - - false');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('500 characters are a reason',
  (public.cancel_cleaning(pg_temp.tid(9), repeat('y', 500))).status::text, 'cancelled');
select pg_temp.as_server();
select pg_temp.check('kept whole',
  char_length(pg_temp.event_reason(pg_temp.tid(9), 'cancelled')), 500);

-- ---------- 2. the office returns it ----------

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('the office returns a cancelled cleaning: the row comes back as it was',
  pg_temp.state((public.restore_cleaning(pg_temp.tid(2))).id), 'assigned anna');
select pg_temp.check('the seven others in one go',
  (select count(*)::int
   from generate_series(1, 8) n, lateral public.restore_cleaning(pg_temp.tid(n)) r
   where n <> 2 and r.status <> 'cancelled'),
  7);
select pg_temp.as_server();

select pg_temp.check('unassigned comes back unassigned, nobody on it',
  pg_temp.state(pg_temp.tid(1)), 'unassigned -');
select pg_temp.check('accepted comes back accepted, hers',
  pg_temp.state(pg_temp.tid(3)), 'accepted anna');
select pg_temp.check('in progress comes back in progress, hers',
  pg_temp.state(pg_temp.tid(4)), 'in_progress anna');
select pg_temp.check('paused comes back paused, hers',
  pg_temp.state(pg_temp.tid(5)), 'paused anna');
select pg_temp.check('blocked comes back blocked, hers',
  pg_temp.state(pg_temp.tid(6)), 'blocked anna');
select pg_temp.check('done comes back done, hers',
  pg_temp.state(pg_temp.tid(7)), 'done anna');
select pg_temp.check('expired comes back expired, hers',
  pg_temp.state(pg_temp.tid(8)), 'expired anna');
select pg_temp.check('the marks of the cancel go with the return',
  pg_temp.cancel_marks(pg_temp.matrix()), 0);
select pg_temp.check('the done one has its own closing back',
  pg_temp.closing(pg_temp.tid(7)), :'closing7');
select pg_temp.check('the expired one too',
  pg_temp.closing(pg_temp.tid(8)), :'closing8');
select pg_temp.check('work under way keeps its start',
  (select started_at from public.tasks where id = pg_temp.tid(4)), now() - interval '1 hour');
select pg_temp.check('the steps and the photos are where they were',
  pg_temp.kept(pg_temp.matrix()), '8 steps, 8 photos, 1 completed');
select pg_temp.check('the journal says it was reopened from cancelled',
  pg_temp.event_params(pg_temp.tid(2), 'reopened') ->> 'from', 'cancelled');

select (select count(*) from public.task_events e where e.task_id = pg_temp.tid(2)) as events2 \gset
select pg_temp.as_user(pg_temp.ada());
select pg_temp.check('returning a returned one answers the row as it is',
  pg_temp.state((public.restore_cleaning(pg_temp.tid(2))).id), 'assigned anna');
select pg_temp.as_server();
select pg_temp.check('and writes nothing in the journal',
  (select count(*) from public.task_events e where e.task_id = pg_temp.tid(2)), :events2::bigint);

-- Cara is switched off while her cleaning is cancelled.
select pg_temp.as_user(pg_temp.boss());
select public.cancel_cleaning(pg_temp.tid(10)) is not null as cancelled \gset
select pg_temp.as_server();
update public.profiles set is_active = false where id = pg_temp.cara();
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('returned after its person was switched off, it is free work, nobody on it',
  pg_temp.state((public.restore_cleaning(pg_temp.tid(10))).id), 'unassigned -');
select pg_temp.as_server();

-- A cancel the office did not make through cancel_cleaning: the system's, and the old panel's
-- direct write.
update public.tasks set status = 'cancelled' where id = pg_temp.tid(11);
select pg_temp.as_user(pg_temp.boss());
update public.tasks set status = 'cancelled' where id = pg_temp.tid(12);
select pg_temp.check('a cancel by the system is not the office''s to return',
  pg_temp.refusal(format('select public.restore_cleaning(%L)', pg_temp.tid(11))),
  'serverErrors.taskChangedMeanwhile');
select pg_temp.as_server();
select pg_temp.check('the old panel''s direct cancel writes no office mark',
  pg_temp.offmark(pg_temp.tid(12)), 'cancelled - - false');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('so it is not returned here either',
  pg_temp.refusal(format('select public.restore_cleaning(%L)', pg_temp.tid(12))),
  'serverErrors.taskChangedMeanwhile');
select pg_temp.as_server();
select pg_temp.check('both stay cancelled',
  pg_temp.state(pg_temp.tid(11)) || ', ' || pg_temp.state(pg_temp.tid(12)), 'cancelled -, cancelled anna');

-- ---------- 3. who may ----------

insert into public.problems (id, host_id, property_id, reported_by, title) values
  ('f1184000-0000-4000-8000-000000000001', pg_temp.host(), 900118001, pg_temp.anna(), 'Tap leaks');
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, problem_id) values
  (pg_temp.tid(14), pg_temp.host(), 900118001, 'maintenance', 'unassigned', current_date,
   'f1184000-0000-4000-8000-000000000001');

select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('a cleaner cancels nothing',
  pg_temp.refusal(format('select public.cancel_cleaning(%L)', pg_temp.tid(13))),
  'serverErrors.managerOnly');
select pg_temp.check('and returns nothing',
  pg_temp.refusal(format('select public.restore_cleaning(%L)', pg_temp.tid(12))),
  'serverErrors.managerOnly');
select pg_temp.as_user(pg_temp.hector());
select pg_temp.check('nor does the head technician cancel',
  pg_temp.refusal(format('select public.cancel_cleaning(%L)', pg_temp.tid(13))),
  'serverErrors.managerOnly');
select pg_temp.check('or return',
  pg_temp.refusal(format('select public.restore_cleaning(%L)', pg_temp.tid(12))),
  'serverErrors.managerOnly');
select pg_temp.as_user(pg_temp.olga());
select pg_temp.check('a manager of another company does not find the cleaning to cancel',
  pg_temp.refusal(format('select public.cancel_cleaning(%L)', pg_temp.tid(13))),
  'serverErrors.taskNotFound');
select pg_temp.check('nor to return',
  pg_temp.refusal(format('select public.restore_cleaning(%L)', pg_temp.tid(9))),
  'serverErrors.taskNotFound');
select pg_temp.check('nor to decline',
  pg_temp.refusal(format('select public.decline_cleaning(%L)', pg_temp.tid(13))),
  'serverErrors.taskNotFound');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('a repair of a task is not a cleaning to cancel',
  pg_temp.refusal(format('select public.cancel_cleaning(%L)', pg_temp.tid(14))),
  'serverErrors.taskNotFound');
select pg_temp.check('nor to return',
  pg_temp.refusal(format('select public.restore_cleaning(%L)', pg_temp.tid(14))),
  'serverErrors.taskNotFound');
select pg_temp.as_server();
select pg_temp.check('every refusal left them as they were',
  pg_temp.state(pg_temp.tid(13)) || ', ' || pg_temp.state(pg_temp.tid(14)) || ', '
  || pg_temp.state(pg_temp.tid(12)),
  'assigned anna, unassigned -, cancelled anna');

select pg_temp.as_user(pg_temp.bella());
select pg_temp.check('a colleague does not decline her cleaning',
  pg_temp.refusal(format('select public.decline_cleaning(%L)', pg_temp.tid(13))),
  'serverErrors.taskChangedMeanwhile');
select pg_temp.check('nor interrupt it',
  pg_temp.refusal(format('select public.interrupt_cleaning(%L, %L)', pg_temp.tid(4), 'Not mine')),
  'serverErrors.taskChangedMeanwhile');
select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('a cleaning under way is interrupted, not declined',
  pg_temp.refusal(format('select public.decline_cleaning(%L)', pg_temp.tid(4))),
  'serverErrors.taskChangedMeanwhile');
select pg_temp.check('a cleaning not started is declined, not interrupted',
  pg_temp.refusal(format('select public.interrupt_cleaning(%L, %L)', pg_temp.tid(3), 'Tired')),
  'serverErrors.taskChangedMeanwhile');
select pg_temp.check('an interrupt without a reason is refused',
  pg_temp.refusal(format('select public.interrupt_cleaning(%L, null)', pg_temp.tid(4))),
  'serverErrors.reasonRequired');
select pg_temp.check('a blank reason is none',
  pg_temp.refusal(format('select public.interrupt_cleaning(%L, %L)', pg_temp.tid(4), '   ')),
  'serverErrors.reasonRequired');
select pg_temp.check('a decline with 501 characters is refused',
  pg_temp.refusal(format('select public.decline_cleaning(%L, %L)', pg_temp.tid(13), repeat('z', 501))),
  'serverErrors.reasonTooLong');
select pg_temp.as_user(pg_temp.boss());
select public.cancel_cleaning(pg_temp.tid(15)) is not null as cancelled \gset
select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('a cleaning the office cancelled is not hers to decline',
  pg_temp.refusal(format('select public.decline_cleaning(%L)', pg_temp.tid(15))),
  'serverErrors.taskChangedMeanwhile');
select pg_temp.as_server();
select pg_temp.check('every refusal left hers as they were',
  pg_temp.state(pg_temp.tid(13)) || ', ' || pg_temp.state(pg_temp.tid(4)) || ', '
  || pg_temp.state(pg_temp.tid(3)) || ', ' || pg_temp.state(pg_temp.tid(15)),
  'assigned anna, in_progress anna, accepted anna, cancelled anna');

select pg_temp.check('the staff may call the four',
  (select count(*)::int
   from unnest(array['public.cancel_cleaning(uuid,text)', 'public.restore_cleaning(uuid)',
                     'public.decline_cleaning(uuid,text)', 'public.interrupt_cleaning(uuid,text)']) f
   where has_function_privilege('authenticated', f, 'execute')),
  4);
select pg_temp.check('anon calls none of them',
  (select count(*)::int
   from unnest(array['public.cancel_cleaning(uuid,text)', 'public.restore_cleaning(uuid)',
                     'public.decline_cleaning(uuid,text)', 'public.interrupt_cleaning(uuid,text)',
                     'public.hand_back_cleaning(uuid,text,text)', 'public.task_offs(public.tasks)']) f
   where has_function_privilege('anon', f, 'execute')),
  0);
select pg_temp.check('the body of a hand-back is no client''s',
  has_function_privilege('authenticated', 'public.hand_back_cleaning(uuid,text,text)', 'execute'),
  false);
select pg_temp.check('nothing here is PUBLIC''s',
  (select count(*)::int from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('cancel_cleaning', 'restore_cleaning', 'decline_cleaning',
                       'interrupt_cleaning', 'hand_back_cleaning', 'task_offs')
     and (p.proacl is null or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0))),
  0);

-- ---------- 4. and 8. a cleaner hands it back, and who hears of it ----------

insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id,
                          started_at, completed_at, completed_by) values
  (pg_temp.tid(20), pg_temp.host(), 900118002, 'cleaning', 'assigned', current_date, pg_temp.anna(),
   null, null, null),
  (pg_temp.tid(21), pg_temp.host(), 900118002, 'cleaning', 'accepted', current_date + 1, pg_temp.anna(),
   null, null, null),
  (pg_temp.tid(22), pg_temp.host(), 900118002, 'cleaning', 'in_progress', current_date, pg_temp.anna(),
   now() - interval '1 hour', null, null),
  (pg_temp.tid(23), pg_temp.host(), 900118002, 'cleaning', 'assigned', current_date, pg_temp.anna(),
   null, null, null),
  (pg_temp.tid(24), pg_temp.host(), 900118002, 'cleaning', 'done', current_date, pg_temp.anna(),
   now() - interval '2 hours', now() - interval '1 hour', pg_temp.anna());
select pg_temp.clear_pushes();

select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('she declines her assigned cleaning: the row comes back declined',
  (public.decline_cleaning(pg_temp.tid(20), 'Sick child')).release_kind, 'declined');
select pg_temp.as_server();
select pg_temp.check('declined: free work, nobody on it',
  pg_temp.state(pg_temp.tid(20)), 'unassigned -');
select pg_temp.check('the mark says declined, by her, when',
  pg_temp.release(pg_temp.tid(20)), 'declined anna true');
select pg_temp.check('the journal: taken off her by her decline, in her words',
  pg_temp.event(pg_temp.tid(20), 'unassigned'), 'declined anna Sick child');
select pg_temp.check('and says whose it was',
  pg_temp.who((pg_temp.event_params(pg_temp.tid(20), 'unassigned') ->> 'from')::uuid), 'anna');
select pg_temp.check('the change of person says it all: no second event for the status',
  (select count(*)::int from public.task_events e
   where e.task_id = pg_temp.tid(20) and e.kind::text not in ('created', 'assigned', 'unassigned')),
  0);
select pg_temp.check('every active manager and admin with a phone hears of it, and the colleague that it is free',
  pg_temp.pushes(pg_temp.tid(20)),
  array['Ada cleaning_declined', 'Bella cleaning_free', 'Boss cleaning_declined']);
select pg_temp.check('the push names her, and not in words: her id and her name as parameters',
  (select (o.params ->> 'by_name') || ' ' || pg_temp.who((o.params ->> 'by')::uuid) || ' '
          || (o.params ->> 'date') || ' ' || o.urgent::text
   from raw.push_outbox o
   where o.task_id = pg_temp.tid(20) and o.recipient_id = pg_temp.boss()),
  'Anna anna ' || current_date || ' true');

select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('a replay of the decline answers the row as it is',
  pg_temp.state((public.decline_cleaning(pg_temp.tid(20), 'Sick child')).id), 'unassigned -');
select pg_temp.as_server();
select pg_temp.check('and writes no second event, no second push',
  pg_temp.events(pg_temp.tid(20), 'unassigned')::text || ' '
  || cardinality(pg_temp.pushes(pg_temp.tid(20)))::text,
  '1 3');

select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('an accepted cleaning is declined too, without a reason',
  (public.decline_cleaning(pg_temp.tid(21))).release_kind, 'declined');
select pg_temp.as_server();
select pg_temp.check('declined from accepted: free work, the mark hers',
  pg_temp.state(pg_temp.tid(21)) || ' / ' || pg_temp.release(pg_temp.tid(21)),
  'unassigned - / declined anna true');
select pg_temp.check('the journal holds no words she did not give',
  pg_temp.event(pg_temp.tid(21), 'unassigned'), 'declined anna -');

select pg_temp.clear_pushes();
select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('she interrupts a cleaning under way, with a reason',
  (public.interrupt_cleaning(pg_temp.tid(22), '  Allergy  ')).release_kind, 'interrupted');
select pg_temp.as_server();
select pg_temp.check('interrupted: free work, its start kept',
  pg_temp.state(pg_temp.tid(22)) || ' / '
  || ((select started_at from public.tasks where id = pg_temp.tid(22)) = now() - interval '1 hour')::text,
  'unassigned - / true');
select pg_temp.check('the mark says interrupted, by her',
  pg_temp.release(pg_temp.tid(22)), 'interrupted anna true');
select pg_temp.check('the journal: interrupted, in her words, trimmed',
  pg_temp.event(pg_temp.tid(22), 'unassigned'), 'interrupted anna Allergy');
select pg_temp.check('the office hears it was interrupted, the colleague that it is free',
  pg_temp.pushes(pg_temp.tid(22)),
  array['Ada cleaning_interrupted', 'Bella cleaning_free', 'Boss cleaning_interrupted']);

select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('a paused cleaning of hers is interrupted too',
  (public.interrupt_cleaning(pg_temp.tid(5), 'Called away')).release_kind, 'interrupted');
select pg_temp.check('and a blocked one',
  (public.interrupt_cleaning(pg_temp.tid(6), 'No keys')).release_kind, 'interrupted');
select pg_temp.as_server();
select pg_temp.check('both free work now, their starts kept',
  pg_temp.state(pg_temp.tid(5)) || ', ' || pg_temp.state(pg_temp.tid(6)) || ' / '
  || (select count(*) from public.tasks t
      where t.id in (pg_temp.tid(5), pg_temp.tid(6)) and t.started_at = now() - interval '1 hour')::text,
  'unassigned -, unassigned - / 2');

select pg_temp.clear_pushes();
select pg_temp.as_user(pg_temp.boss());
select public.cancel_cleaning(pg_temp.tid(23)) is not null as cancelled \gset
select public.cancel_cleaning(pg_temp.tid(24)) is not null as cancelled \gset
select pg_temp.as_server();
select pg_temp.check('a live cleaning cancelled by the office: she hears it',
  pg_temp.pushes(pg_temp.tid(23)), array['Anna cleaning_cancelled']);
select pg_temp.check('a done one cancelled: nobody hears anything',
  pg_temp.pushes(pg_temp.tid(24)), '{}'::text[]);
select pg_temp.clear_pushes();
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('returned to her',
  pg_temp.state((public.restore_cleaning(pg_temp.tid(23))).id), 'assigned anna');
select pg_temp.as_server();
select pg_temp.check('she hears it is hers again',
  pg_temp.pushes(pg_temp.tid(23)), array['Anna cleaning_assigned']);

-- ---------- 11. a phone of before ----------

select pg_temp.check('the statuses an old phone parses are the nine it knows',
  enum_range(null::public.task_status)::text[],
  array['unassigned', 'assigned', 'accepted', 'in_progress', 'paused', 'blocked', 'done',
        'cancelled', 'expired']);
select pg_temp.as_user(pg_temp.bella());
select pg_temp.check('a colleague of the listing reads a declined and an interrupted cleaning as free work',
  (select string_agg(t.status::text || ' ' || pg_temp.who(t.assignee_id), ', ' order by t.id)
   from public.tasks t where t.id in (pg_temp.tid(20), pg_temp.tid(22))),
  'unassigned -, unassigned -');
select pg_temp.check('in her free queue, as the phone asks for it',
  (select count(*)::int from public.tasks t
   where t.type in ('cleaning', 'midstay') and t.status = 'unassigned' and t.assignee_id is null
     and t.scheduled_date >= current_date - public.task_grace_days()
     and t.id in (pg_temp.tid(20), pg_temp.tid(22))),
  2);
select pg_temp.as_server();

-- ---------- 5. interrupted with steps and photos, finished by another ----------

insert into public.workflow_templates (id, host_id, scope, property_id, name) values
  ('f1185000-0000-4000-8000-000000000001', pg_temp.host(), 'cleaning', 900118003, 'Interrupt flow');
insert into public.workflow_steps (template_id, host_id, sort_order, type, required, title) values
  ('f1185000-0000-4000-8000-000000000001', pg_temp.host(), 1, 'photos_before', false, 'Before'),
  ('f1185000-0000-4000-8000-000000000001', pg_temp.host(), 2, 'cleaner_comment', false, 'Comment'),
  ('f1185000-0000-4000-8000-000000000001', pg_temp.host(), 3, 'confirmation', true, 'Done');

-- Today, no hours: the start window opened at midnight.
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date, assignee_id) values
  (pg_temp.tid(30), pg_temp.host(), 900118003, 'cleaning', 'accepted', current_date, pg_temp.anna());

create or replace function pg_temp.step30(p_type text) returns uuid language sql as $$
  select s.id from public.task_steps s where s.task_id = pg_temp.tid(30) and s.type::text = p_type $$;
create or replace function pg_temp.steps30() returns text language sql as $$
  select string_agg(s.type::text || ':' || pg_temp.who(s.completed_by), ' ' order by s.sort_order)
  from public.task_steps s where s.task_id = pg_temp.tid(30) $$;

select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('she starts it',
  pg_temp.affected(format('update public.tasks set status = %L where id = %L and status in (%L, %L)',
                          'in_progress', pg_temp.tid(30), 'assigned', 'accepted')),
  1);
select pg_temp.as_server();
-- Two hours ago: a start a later one could not be mistaken for.
update public.tasks set started_at = now() - interval '2 hours' where id = pg_temp.tid(30);
insert into public.task_media (id, host_id, task_id, step_id, kind, storage_path, mime_type,
                               byte_size, created_by, uploaded_at)
values (pg_temp.mid(30), pg_temp.host(), pg_temp.tid(30), pg_temp.step30('photos_before'), 'photo',
        pg_temp.host() || '/' || pg_temp.tid(30) || '/' || pg_temp.mid(30) || '.jpg', 'image/jpeg',
        1000, pg_temp.anna(), now());
select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('she completes the photos before',
  (public.complete_task_step(pg_temp.step30('photos_before'))).completed_by, pg_temp.anna());
select pg_temp.check('and her comment',
  (public.complete_task_step(pg_temp.step30('cleaner_comment'), '{"text":"Kitchen done"}')).completed_by,
  pg_temp.anna());
select pg_temp.check('then interrupts it',
  pg_temp.state((public.interrupt_cleaning(pg_temp.tid(30), 'Cleaning products allergy')).id),
  'unassigned -');
select pg_temp.as_server();
select pg_temp.check('the start is kept',
  (select started_at from public.tasks where id = pg_temp.tid(30)), now() - interval '2 hours');
select pg_temp.check('her steps are kept, completed by her',
  pg_temp.steps30(), 'photos_before:anna cleaner_comment:anna confirmation:-');
select pg_temp.check('her photo is kept',
  (select count(*)::int from public.task_media m
   where m.task_id = pg_temp.tid(30) and m.deleted_at is null and m.purged_at is null),
  1);
select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('a replay of the interrupt answers the row as it is',
  (public.interrupt_cleaning(pg_temp.tid(30), 'Cleaning products allergy')).release_kind, 'interrupted');
select pg_temp.as_server();
select pg_temp.check('and writes no second event',
  pg_temp.events(pg_temp.tid(30), 'unassigned'), 1);

-- Bella takes it exactly as the phone of before does.
select pg_temp.as_user(pg_temp.bella());
select pg_temp.check('a colleague takes it from the queue as an old phone does',
  pg_temp.affected(format('update public.tasks set assignee_id = %L, status = %L where id = %L and status = %L',
                          pg_temp.bella(), 'accepted', pg_temp.tid(30), 'unassigned')),
  1);
select pg_temp.as_server();
select pg_temp.check('hers now, the hand-back mark cleared',
  pg_temp.state(pg_temp.tid(30)) || ' / ' || pg_temp.release(pg_temp.tid(30)),
  'accepted bella / - - false');
select pg_temp.as_user(pg_temp.bella());
select pg_temp.check('she starts it as an old phone does',
  pg_temp.affected(format('update public.tasks set status = %L where id = %L and status in (%L, %L)',
                          'in_progress', pg_temp.tid(30), 'assigned', 'accepted')),
  1);
select pg_temp.as_server();
select pg_temp.check('the start is still the first one',
  (select started_at from public.tasks where id = pg_temp.tid(30)), now() - interval '2 hours');
select pg_temp.check('the steps are the same three, not taken again',
  pg_temp.steps30(), 'photos_before:anna cleaner_comment:anna confirmation:-');
select pg_temp.as_user(pg_temp.bella());
select pg_temp.check('she completes the step left open',
  (public.complete_task_step(pg_temp.step30('confirmation'))).completed_by, pg_temp.bella());
select pg_temp.check('and finishes the cleaning',
  pg_temp.affected(format('update public.tasks set status = %L where id = %L', 'done', pg_temp.tid(30))),
  1);
select pg_temp.as_server();
select pg_temp.check('done, by her',
  (select t.status::text || ' ' || pg_temp.who(t.completed_by) from public.tasks t
   where t.id = pg_temp.tid(30)),
  'done bella');
select pg_temp.check('each step keeps who did it',
  pg_temp.steps30(), 'photos_before:anna cleaner_comment:anna confirmation:bella');

-- ---------- 6. nobody writes the marks by hand ----------

select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('her direct write of the marks on her own cleaning reaches the row',
  pg_temp.affected(format(
    'update public.tasks set released_at = now(), released_by = %L, release_kind = %L,
       cancelled_at = now(), cancelled_by = %L, cancelled_from = %L, cancel_departure = current_date,
       cancelled_closing = %L where id = %L',
    pg_temp.anna(), 'interrupted', pg_temp.anna(), 'assigned', '{}', pg_temp.tid(13))),
  1);
select pg_temp.as_server();
select pg_temp.check('and leaves every mark as it was',
  pg_temp.release(pg_temp.tid(13)) || ' / ' || pg_temp.offmark(pg_temp.tid(13)) || ' / '
  || pg_temp.cancel_marks(array[pg_temp.tid(13)])::text,
  '- - false / assigned - - false / 0');
select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('her own write back to unassigned is still refused: the functions are the one road',
  pg_temp.refusal(format('update public.tasks set assignee_id = null, status = %L where id = %L',
                         'unassigned', pg_temp.tid(13))),
  'serverErrors.transitionNotAllowed');
select pg_temp.as_server();
select pg_temp.check('and leaves it hers',
  pg_temp.state(pg_temp.tid(13)) || ' / ' || pg_temp.release(pg_temp.tid(13)),
  'assigned anna / - - false');

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('a manager''s direct write of a hand-back mark reaches the row',
  pg_temp.affected(format(
    'update public.tasks set released_at = null, released_by = null, release_kind = null where id = %L',
    pg_temp.tid(20))),
  1);
select pg_temp.check('and leaves the mark as it was',
  pg_temp.release(pg_temp.tid(20)), 'declined anna true');
select pg_temp.check('a manager''s direct write of the cancel marks reaches the row',
  pg_temp.affected(format(
    'update public.tasks set cancelled_at = null, cancelled_by = %L, cancelled_from = %L,
       cancel_departure = %L where id = %L',
    pg_temp.ada(), 'done', '2000-01-01', pg_temp.tid(9))),
  1);
select pg_temp.check('and leaves them as they were',
  pg_temp.offmark(pg_temp.tid(9)) || ' / '
  || coalesce((select cancel_departure::text from public.tasks where id = pg_temp.tid(9)), '-'),
  'cancelled unassigned boss true / -');
select pg_temp.check('the old panel''s reopen of an office-cancelled cleaning goes through',
  pg_temp.affected(format('update public.tasks set status = %L where id = %L',
                          'unassigned', pg_temp.tid(9))),
  1);
select pg_temp.check('and the marks of the cancel go with it',
  pg_temp.offmark(pg_temp.tid(9)) || ' / ' || pg_temp.cancel_marks(array[pg_temp.tid(9)])::text,
  'unassigned - - false / 0');
select pg_temp.check('a manager putting somebody on a declined cleaning reaches it',
  pg_temp.affected(format('update public.tasks set assignee_id = %L, status = %L where id = %L',
                          pg_temp.bella(), 'assigned', pg_temp.tid(21))),
  1);
select pg_temp.as_server();
select pg_temp.check('and the hand-back mark is cleared',
  pg_temp.state(pg_temp.tid(21)) || ' / ' || pg_temp.release(pg_temp.tid(21)),
  'assigned bella / - - false');

-- ---------- 10. the marks, for the office ----------

select pg_temp.as_user(pg_temp.boss());
select public.cancel_cleaning(pg_temp.tid(20), 'Guest left early') is not null as cancelled \gset
select pg_temp.check('the office reads who cancelled it, from what and why, and who declined it and why',
  (select concat_ws(' | ', o #>> '{cancelled,by,name}', o #>> '{cancelled,by,role}',
                    o #>> '{cancelled,from}', o #>> '{cancelled,reason}',
                    (o #>> '{cancelled,at}' is not null)::text,
                    o #>> '{released,kind}', o #>> '{released,by,name}', o #>> '{released,reason}',
                    (o #>> '{released,at}' is not null)::text)
   from (select public.task_offs(t) as o from public.tasks t where t.id = pg_temp.tid(20)) x),
  'Boss | manager | unassigned | Guest left early | true | declined | Anna | Sick child | true');
select pg_temp.check('an interrupted one: the hand-back alone',
  (select concat_ws(' | ', coalesce(o -> 'cancelled', 'null'::jsonb)::text, o #>> '{released,kind}',
                    o #>> '{released,by,name}', o #>> '{released,reason}')
   from (select public.task_offs(t) as o from public.tasks t where t.id = pg_temp.tid(22)) x),
  'null | interrupted | Anna | Allergy');
select pg_temp.check('a cleaning with neither mark: nothing',
  (select public.task_offs(t) from public.tasks t where t.id = pg_temp.tid(13)), null::jsonb);
select pg_temp.as_user(pg_temp.bella());
select pg_temp.check('a cleaner of the listing reads the row, not the marks',
  (select coalesce(public.task_offs(t)::text, 'null') from public.tasks t where t.id = pg_temp.tid(20)),
  'null');
select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('nor does the one who declined it',
  (select coalesce(public.task_offs(t)::text, 'null') from public.tasks t where t.id = pg_temp.tid(20)),
  'null');
select pg_temp.claims_only(pg_temp.olga());
select pg_temp.check('a manager of another company, handed the row, reads nothing',
  (select public.task_offs(t) from public.tasks t where t.id = pg_temp.tid(20)), null::jsonb);
-- The row is an argument anybody may make up (/rpc/task_offs): the function reads it again by id.
select pg_temp.check('nor with the row made up to carry her own company',
  (select public.task_offs(jsonb_populate_record(null::public.tasks,
            to_jsonb(t) || jsonb_build_object('host_id', pg_temp.other_host())))
   from public.tasks t where t.id = pg_temp.tid(20)),
  null::jsonb);
select pg_temp.as_server();

-- The words live with the cleaning, never in the journal: the privacy notice promises the
-- journal holds no text anybody writes (work-log.test.tsx; 20261118120000).
select pg_temp.check('the journal has no column for words',
  (select count(*)::int from information_schema.columns
   where table_schema = 'public' and table_name = 'task_events' and data_type = 'text'
     and column_name <> 'cause'),
  0);
select pg_temp.check('the journal says only the code of the hand-back',
  (select e.cause from public.task_events e
   where e.task_id = pg_temp.tid(20) and e.kind = 'unassigned' order by e.id desc limit 1),
  'declined');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('the office reads the words',
  (select count(*)::int from public.task_off_notes n where n.task_id = pg_temp.tid(20)), 2);
select pg_temp.as_user(pg_temp.bella());
select pg_temp.check('a cleaner of the listing reads none of them',
  (select count(*)::int from public.task_off_notes n where n.task_id = pg_temp.tid(20)), 0);
select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('nor the one who wrote them',
  (select count(*)::int from public.task_off_notes n where n.task_id = pg_temp.tid(20)), 0);
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('nobody writes them by hand',
  pg_temp.refusal($q$insert into public.task_off_notes (host_id, task_id, kind, reason)
                     values (pg_temp.host(), pg_temp.tid(20), 'cancelled', 'x')$q$),
  '42501');

-- A manager's direct insert carries no mark: the insert guard.
insert into public.tasks (id, host_id, property_id, type, status, scheduled_date,
                          cancelled_by, released_at, released_by, release_kind)
values (pg_temp.tid(41), pg_temp.host(), 900118008, 'cleaning', 'unassigned', current_date,
        pg_temp.boss(), now(), pg_temp.anna(), 'declined');
select pg_temp.as_server();
select pg_temp.check('a direct insert loses the marks it carried',
  (select concat_ws(' ', coalesce(cancelled_by::text, '-'), coalesce(released_at::text, '-'),
                    coalesce(released_by::text, '-'), coalesce(release_kind, '-'))
   from public.tasks where id = pg_temp.tid(41)),
  '- - - -');
-- Out of the way of the counts below, which count this listing.
delete from public.tasks where id = pg_temp.tid(41);

-- ---------- 9. a cancelled cleaning leaves the counts ----------

insert into public.tasks (id, host_id, property_id, type, status, scheduled_date) values
  (pg_temp.tid(40), pg_temp.host(), 900118008, 'cleaning', 'unassigned', current_date);

create or replace function pg_temp.counts40() returns text language sql as $$
  select concat_ws(' ',
    (public.analytics_summary(current_date, current_date,
                              p_property_ids => array[900118008::bigint]) ->> 'cleanings_planned'),
    coalesce((select o.cleanings from public.open_cleanings_by_listing() o
              where o.property_id = 900118008), 0),
    public.property_open_cleanings(900118008)) $$;
create or replace function pg_temp.queue40() returns integer language sql as $$
  select count(*)::integer from public.tasks t
  where t.type in ('cleaning', 'midstay') and t.status = 'unassigned' and t.assignee_id is null
    and t.scheduled_date >= current_date - public.task_grace_days()
    and t.id = pg_temp.tid(40) $$;
create or replace function pg_temp.api40(p_status text[]) returns integer language sql as $$
  select count(*)::integer
  from jsonb_array_elements(public.api_v1_list_cleanings(pg_temp.digest(), p_property_id => 900118008,
                                                         p_status => p_status)) c
  where (c ->> 'id')::uuid = pg_temp.tid(40) $$;

select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('before: planned, open on the listing, open to archive',
  pg_temp.counts40(), '1 1 1');
select pg_temp.as_user(pg_temp.bella());
select pg_temp.check('before: in her free queue', pg_temp.queue40(), 1);
select pg_temp.as_server();
select pg_temp.check('before: in the API''s list', pg_temp.api40(null), 1);

select pg_temp.as_user(pg_temp.boss());
select public.cancel_cleaning(pg_temp.tid(40)) is not null as cancelled \gset
select pg_temp.check('after the office cancel: out of the planned count, the open count, the archive count',
  pg_temp.counts40(), '0 0 0');
select pg_temp.as_user(pg_temp.bella());
select pg_temp.check('out of her free queue', pg_temp.queue40(), 0);
select pg_temp.as_server();
-- API v1 changes nothing of meaning inside v1 (docs/api-v1.md §8): its unfiltered list keeps the
-- cancelled, with their status, as before; a client that wants them out asks for the statuses.
select pg_temp.check('the API''s unfiltered list keeps it, as v1 always did',
  pg_temp.api40(null), 1);
select pg_temp.check('listed when the cancelled are asked for',
  pg_temp.api40(array['cancelled']), 1);
select pg_temp.check('and out when the live statuses are asked for',
  pg_temp.api40(array['unassigned', 'assigned', 'accepted', 'in_progress', 'done']), 0);

-- ---------- 7. the generator ----------

insert into public.reservations (id, host_id, property_id, arrival_date, departure_date, status,
                                 guest_name, is_block) values
  (900118101, pg_temp.host(), 900118004, pg_temp.d0() - 3, pg_temp.d0(),     'new', 'Guest One',   false),
  (900118102, pg_temp.host(), 900118006, pg_temp.d0() - 2, pg_temp.d0() + 1, 'new', 'Guest Two',   false),
  (900118103, pg_temp.host(), 900118007, pg_temp.d0() - 3, pg_temp.d0(),     'new', 'Guest Three', false),
  (900118104, pg_temp.host(), 900118005, pg_temp.d0() - 4, pg_temp.d0(),     'new', 'Guest Four',  false),
  (900118105, pg_temp.host(), 900118005, pg_temp.d0(),     pg_temp.d0() + 3, 'new', 'Guest Five',  false);

select pg_temp.as_server();
select pg_temp.run() as answer \gset gen_
select pg_temp.check('the first run writes one free cleaning per booking',
  concat_ws(' / ', pg_temp.cleanings(900118101), pg_temp.cleanings(900118102),
            pg_temp.cleanings(900118103), pg_temp.cleanings(900118104), pg_temp.cleanings(900118105)),
  'unassigned@0 - / unassigned@1 - / unassigned@0 - / unassigned@0 - / unassigned@3 -');
select t.id as c1 from public.tasks t where t.reservation_id = 900118101 \gset
select t.id as c2 from public.tasks t where t.reservation_id = 900118102 \gset
select t.id as c3 from public.tasks t where t.reservation_id = 900118103 \gset
select t.id as c4 from public.tasks t where t.reservation_id = 900118104 \gset
select t.id as c5 from public.tasks t where t.reservation_id = 900118105 \gset

-- The office cancels a booking's cleaning: it holds while the booking keeps the departure.
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('the office cancel of a booking''s cleaning holds the booking''s departure',
  (public.cancel_cleaning(:'c1')).cancel_departure - pg_temp.d0(), 0);
select pg_temp.as_server();
select pg_temp.run() as answer \gset gen_
select pg_temp.check('a run over the departure writes no new cleaning for the booking',
  pg_temp.cleanings(900118101), 'cancelled@0 -');
update public.reservations set departure_date = pg_temp.d0() + 2 where id = 900118101;
select pg_temp.run() as answer \gset gen_
select pg_temp.check('a new departure is a new cleaning; the cancelled one stays cancelled',
  pg_temp.cleanings(900118101), 'cancelled@0 -, unassigned@2 -');
select pg_temp.check('still the office''s cancel, of the old departure',
  pg_temp.offmark(:'c1') || ' '
  || ((select cancel_departure from public.tasks where id = :'c1') - pg_temp.d0())::text,
  'cancelled unassigned boss true 0');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('returned now, two would stand for one: refused',
  pg_temp.refusal(format('select public.restore_cleaning(%L)', :'c1')),
  'serverErrors.cleaningRestoreTaken');
select pg_temp.as_server();
select pg_temp.check('and it stays cancelled', pg_temp.state(:'c1'), 'cancelled -');

-- Regression: the booking cancelled and live again is written anew, as before.
update public.reservations set status = 'cancelled' where id = 900118102;
select pg_temp.run() as answer \gset gen_
select pg_temp.check('a cancelled booking''s cleaning is cancelled by the run, as before',
  pg_temp.cleanings(900118102), 'cancelled@1 -');
select pg_temp.check('the booking''s cancel, not the office''s',
  pg_temp.offmark(:'c2') || ' / ' || pg_temp.event(:'c2', 'cancelled'),
  'cancelled - - false / booking_cancelled - -');
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('a booking''s cancel is not returned by the office',
  pg_temp.refusal(format('select public.restore_cleaning(%L)', :'c2')),
  'serverErrors.taskChangedMeanwhile');
select pg_temp.as_server();
update public.reservations set status = 'new' where id = 900118102;
select pg_temp.run() as answer \gset gen_
select pg_temp.check('live again, the booking gets its cleaning written anew',
  pg_temp.cleanings(900118102), 'cancelled@1 -, unassigned@1 -');

-- Work started and handed back is a human's to place.
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('the office puts Anna on it, under way',
  pg_temp.affected(format('update public.tasks set assignee_id = %L, status = %L where id = %L',
                          pg_temp.anna(), 'in_progress', :'c3')),
  1);
select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('she interrupts it',
  (public.interrupt_cleaning(:'c3', 'Back pain')).release_kind, 'interrupted');
select pg_temp.as_server();
update public.reservations set departure_date = pg_temp.d0() + 3 where id = 900118103;
select pg_temp.run() as answer \gset gen_
select pg_temp.check('its booking leaves later: the run neither moves it nor writes a second',
  pg_temp.cleanings(900118103), 'unassigned@0 -');
insert into public.reservation_units (host_id, reservation_id, property_id)
values (pg_temp.host(), 900118103, public.property_id_for_unit(900118010));
select pg_temp.run() as answer \gset gen_
select pg_temp.check('its booking takes a room: the run neither takes it there nor cancels it',
  pg_temp.cleanings(900118103) || ' on '
  || (select property_id::text from public.tasks where id = :'c3'),
  'unassigned@0 - on 900118007');
update public.reservations set status = 'cancelled' where id = 900118103;
select pg_temp.run() as answer \gset gen_
select pg_temp.check('its booking is cancelled: the run leaves it for the office',
  pg_temp.cleanings(900118103), 'unassigned@0 -');
select pg_temp.check('started, handed back, as it was',
  pg_temp.release(:'c3') || ' / '
  || ((select started_at from public.tasks where id = :'c3') is not null)::text,
  'interrupted anna true / true');

-- A cleaning declined is not given back to the listing's regular cleaner.
select pg_temp.as_user(pg_temp.boss());
select pg_temp.check('the office gives Anna a cleaning of the auto flat',
  pg_temp.affected(format('update public.tasks set assignee_id = %L, status = %L where id = %L',
                          pg_temp.anna(), 'assigned', :'c4')),
  1);
select pg_temp.as_user(pg_temp.anna());
select pg_temp.check('she declines it',
  (public.decline_cleaning(:'c4', 'Too far')).release_kind, 'declined');
select pg_temp.as_server();
insert into public.property_cleaners (host_id, property_id, cleaner_id, mode)
values (pg_temp.host(), 900118005, pg_temp.anna(), 'auto');
select pg_temp.run() as answer \gset gen_
select pg_temp.check('the run does not give the declined cleaning back to her',
  pg_temp.cleanings(900118104) || ' / ' || pg_temp.release(:'c4'), 'unassigned@0 - / declined anna true');
select pg_temp.check('an ordinary free cleaning there goes to the regular cleaner, as before',
  pg_temp.cleanings(900118105), 'assigned@3 anna');

rollback;
