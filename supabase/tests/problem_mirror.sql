-- A problem's status follows its current repair, and nothing else.
-- Run: npm run test:rls
-- Runs inside a transaction and rolls back — the database stays clean.
--
-- The cases under test (20260923130000), all reproduced on 2026-09-23:
--
-- * The nightly sweep, written for cleanings with one day of grace, closed a
--   repair the technician had started: the problem jumped from in_progress to
--   open, the technician could no longer finish it and lost the report and
--   its chat. A repair now ends only by its technician or a manager.
-- * The mirror copied the status of whichever task row changed. A write to a
--   superseded attempt, a deleted fix task, a task moved to another problem,
--   or a multi-row statement in an unlucky row order all moved the problem.
--   Now only the problem's current attempt speaks for it.
-- * An archived problem could be handed out again, and its tasks then
--   rewrote its status inside the archive.
--
-- Fixture ids live in the 9000095xx / f93... ranges: real Hostaway ids are
-- present after F2 and would collide on the primary key.
begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                        created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values
  ('f9200001-0000-4000-8000-0000000000e1','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','rep.mirror@test.local','x',now(),now(),
   '{"full_name":"Reporter"}'::jsonb, '{"role":"cleaner"}'::jsonb),
  ('f9200002-0000-4000-8000-0000000000e2','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tech1.mirror@test.local','x',now(),now(),
   '{"full_name":"Tech One"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('f9200003-0000-4000-8000-0000000000e3','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','tech2.mirror@test.local','x',now(),now(),
   '{"full_name":"Tech Two"}'::jsonb, '{"role":"tech"}'::jsonb),
  ('f9200004-0000-4000-8000-0000000000e4','00000000-0000-0000-0000-000000000000',
   'authenticated','authenticated','boss.mirror@test.local','x',now(),now(),
   '{"full_name":"Boss"}'::jsonb, '{"role":"manager"}'::jsonb);

-- UTC listings, so that current_date is the listing's own date at any hour.
insert into public.properties (id, name, timezone, check_in_time, check_out_time)
select 900009500 + n, 'Mirror flat ' || n, 'UTC', '15:00', '10:00'
from generate_series(1, 16) n;

insert into public.property_cleaners (property_id, cleaner_id, mode)
select 900009500 + n, 'f9200001-0000-4000-8000-0000000000e1', 'claim'
from generate_series(1, 16) n;

create or replace function pg_temp.check(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'FAIL % — got %, want %', label, got, want;
  end if;
  raise notice 'ok  %', label;
end $$;

create function pg_temp.as_user(sub uuid) returns void language sql as $$
  select set_config('role', 'authenticated', true),
         set_config('request.jwt.claims',
           '{"sub":"' || sub || '","role":"authenticated"}', true)
$$;
create function pg_temp.as_postgres() returns void language sql as $$
  select set_config('role', 'postgres', true), set_config('request.jwt.claims', '', true)
$$;
create function pg_temp.rep()   returns uuid language sql immutable as $$ select 'f9200001-0000-4000-8000-0000000000e1'::uuid $$;
create function pg_temp.tech1() returns uuid language sql immutable as $$ select 'f9200002-0000-4000-8000-0000000000e2'::uuid $$;
create function pg_temp.tech2() returns uuid language sql immutable as $$ select 'f9200003-0000-4000-8000-0000000000e3'::uuid $$;
create function pg_temp.boss()  returns uuid language sql immutable as $$ select 'f9200004-0000-4000-8000-0000000000e4'::uuid $$;

create function pg_temp.pid(n integer) returns uuid language sql immutable as $$
  select ('f9300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid $$;

-- "status task,task,..." for problem n, tasks oldest first.
create function pg_temp.st(n integer) returns text language sql as $$
  select p.status::text || ' ' ||
         coalesce((select string_agg(t.status::text, ',' order by t.created_at, t.status::text)
                   from public.tasks t where t.problem_id = p.id), '-')
  from public.problems p where p.id = pg_temp.pid(n) $$;

-- Run a statement and report the refusal instead of aborting the transaction.
create function pg_temp.try(statement text) returns text language plpgsql as $$
declare
  v_hint text;
begin
  execute statement;
  return 'no error';
exception when others then
  get stacked diagnostics v_hint = pg_exception_hint;
  return coalesce(v_hint, sqlerrm);
end $$;

-- The reporter files problem n on flat n.
create function pg_temp.report(n integer) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(pg_temp.rep());
  perform public.report_problem(pg_temp.pid(n), 'Mirror ' || n, 'desc ' || n, 'normal',
                                900009500 + n);
  perform pg_temp.as_postgres();
end $$;

-- The manager hands problem n to a technician for today.
create function pg_temp.assign(n integer, tech uuid) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(pg_temp.boss());
  perform public.assign_problem(pg_temp.pid(n), tech, current_date);
  perform pg_temp.as_postgres();
end $$;

-- "Time passes": the live fix task of problem n moves d days into the past.
create function pg_temp.age(n integer, d integer) returns void language sql as $$
  update public.tasks set scheduled_date = scheduled_date - d
  where problem_id = pg_temp.pid(n) and status not in ('done', 'cancelled', 'expired') $$;

-- ---------------------------------------------------------------------------
--  The sweep leaves repairs alone
-- ---------------------------------------------------------------------------

-- 1: started, then left three days past its day.
select pg_temp.report(1);
select pg_temp.assign(1, pg_temp.tech1());
select pg_temp.as_user(pg_temp.tech1());
update public.tasks set status = 'in_progress' where problem_id = pg_temp.pid(1);
select pg_temp.as_postgres();
select pg_temp.age(1, 3);

-- 2: assigned and never started, on a listing archived afterwards.
select pg_temp.report(2);
select pg_temp.assign(2, pg_temp.tech1());
update public.properties set status = 'archived' where id = 900009502;
select pg_temp.age(2, 3);

select pg_temp.check('the sweep closes no repair, started or not',
  public.expire_stale_tasks(), '{"expired_unclaimed": 0, "expired_unfinished": 0}'::jsonb);
select pg_temp.check('a started repair past its day stays in progress',
  pg_temp.st(1), 'in_progress in_progress');
select pg_temp.check('a repair on an archived listing is not put back on the board',
  pg_temp.st(2), 'assigned assigned');

select pg_temp.as_user(pg_temp.tech1());
select pg_temp.check('the technician still reads the report',
  (select count(*)::int from public.problems where id = pg_temp.pid(1)), 1);
select pg_temp.check('and may still finish: the step gate answers, not taskClosed',
  pg_temp.try($q$update public.tasks set status = 'done' where problem_id = pg_temp.pid(1)$q$),
  'serverErrors.requiredStepsLeft');
select pg_temp.as_postgres();

-- Control: a cleaning just as stale on the same listing is still closed.
insert into public.tasks (property_id, type, status, scheduled_date, notes)
values (900009501, 'cleaning', 'unassigned', current_date - 3, 'stale cleaning beside a repair');
select pg_temp.check('a stale cleaning is still swept',
  public.expire_stale_tasks(), '{"expired_unclaimed": 1, "expired_unfinished": 0}'::jsonb);
select pg_temp.check('and it is expired',
  (select status::text from public.tasks where notes = 'stale cleaning beside a repair'), 'expired');

-- A live attempt closed on purpose still puts the problem back: the panel's
-- "take the technician off" is a cancel of the live task.
select pg_temp.report(3);
select pg_temp.assign(3, pg_temp.tech1());
select pg_temp.as_user(pg_temp.boss());
update public.tasks set status = 'cancelled' where problem_id = pg_temp.pid(3);
select pg_temp.as_postgres();
select pg_temp.check('a live attempt cancelled by a manager reopens the problem',
  pg_temp.st(3), 'open cancelled');

-- ---------------------------------------------------------------------------
--  Only the current attempt speaks
-- ---------------------------------------------------------------------------

-- 4: a finished attempt inserted by hand beside a live one is history.
select pg_temp.report(4);
select pg_temp.assign(4, pg_temp.tech1());
select pg_temp.as_user(pg_temp.boss());
insert into public.tasks (property_id, type, status, assignee_id, scheduled_date,
                          completed_at, problem_id)
values (900009504, 'maintenance', 'done', pg_temp.tech2(), current_date, now(), pg_temp.pid(4));
select pg_temp.as_postgres();
select pg_temp.check('an inserted finished attempt does not resolve the problem',
  pg_temp.st(4), 'assigned assigned,done');

-- 5: an old attempt rewritten after a newer one resolved the problem.
select pg_temp.report(5);
select pg_temp.assign(5, pg_temp.tech1());
select pg_temp.as_user(pg_temp.boss());
update public.tasks set status = 'expired' where problem_id = pg_temp.pid(5);
select pg_temp.as_postgres();
select pg_temp.check('a live attempt closed as expired reopens the problem',
  pg_temp.st(5), 'open expired');
select pg_temp.assign(5, pg_temp.tech2());
select pg_temp.as_user(pg_temp.boss());
select public.resolve_problem(pg_temp.pid(5));
update public.tasks set status = 'cancelled'
where problem_id = pg_temp.pid(5) and status = 'expired';
select pg_temp.as_postgres();
select pg_temp.check('a resolved problem survives a write to its old attempt',
  pg_temp.st(5), 'resolved cancelled,done');
select pg_temp.check('and keeps its resolved_at',
  (select resolved_at is not null from public.problems where id = pg_temp.pid(5)), true);

-- 6-8: moving and deleting.
select pg_temp.report(n) from generate_series(6, 8) n;
select pg_temp.assign(6, pg_temp.tech1());
select pg_temp.assign(8, pg_temp.tech1());
select pg_temp.as_user(pg_temp.boss());
update public.tasks set problem_id = pg_temp.pid(7) where problem_id = pg_temp.pid(6);
delete from public.tasks where problem_id = pg_temp.pid(8);
select pg_temp.as_postgres();
select pg_temp.check('the problem a live task left reads open', pg_temp.st(6), 'open -');
select pg_temp.check('the problem it arrived at follows it', pg_temp.st(7), 'assigned assigned');
select pg_temp.check('a deleted live task leaves its problem open', pg_temp.st(8), 'open -');

select pg_temp.as_user(pg_temp.boss());
update public.tasks set problem_id = pg_temp.pid(7)
where problem_id = pg_temp.pid(5) and status = 'cancelled';
select pg_temp.as_postgres();
select pg_temp.check('a history row arriving does not override a live attempt',
  pg_temp.st(7), 'assigned assigned,cancelled');

-- 9: one statement moves the live attempt and closes an old one: row order
-- must not matter. The finished attempt is written AFTER the live one, so a
-- table scan meets the live row first and the history row last -- the order
-- in which a mirror that copies whichever row changed ends on the wrong one.
select pg_temp.report(9);
select pg_temp.assign(9, pg_temp.tech1());
select pg_temp.as_user(pg_temp.boss());
insert into public.tasks (property_id, type, status, assignee_id, scheduled_date,
                          completed_at, problem_id)
values (900009509, 'maintenance', 'done', pg_temp.tech2(), current_date, now(), pg_temp.pid(9));
update public.tasks
set status = case when status = 'done' then 'cancelled'::public.task_status
                  else 'in_progress'::public.task_status end
where problem_id = pg_temp.pid(9);
select pg_temp.as_postgres();
select pg_temp.check('the live attempt decides, not the row order',
  split_part(pg_temp.st(9), ' ', 1), 'in_progress');

-- ---------------------------------------------------------------------------
--  Archived problems
-- ---------------------------------------------------------------------------

-- 10: archived, then handed out again: refused.
select pg_temp.report(10);
select pg_temp.assign(10, pg_temp.tech1());
select pg_temp.as_user(pg_temp.boss());
select public.archive_problem(pg_temp.pid(10));
select pg_temp.check('archiving still reads open: the task is cancelled before the stamp',
  pg_temp.st(10), 'open cancelled');
select pg_temp.check('an archived problem cannot be handed out',
  pg_temp.try($q$select public.assign_problem(pg_temp.pid(10), pg_temp.tech1(), current_date)$q$),
  'serverErrors.problemArchived');

-- Writes to its tasks inside the archive leave the status as it was.
update public.tasks set status = 'assigned' where problem_id = pg_temp.pid(10);
select pg_temp.check('a live attempt revived inside the archive does not move it',
  pg_temp.st(10), 'open assigned');
update public.tasks set status = 'expired' where problem_id = pg_temp.pid(10);
select pg_temp.as_postgres();
select pg_temp.check('nor does closing it again',
  pg_temp.st(10), 'open expired');

-- 11: a repair that was live on the problem when it was archived by hand and
-- is then finished: the work is not lost in the archive.
select pg_temp.report(11);
select pg_temp.as_user(pg_temp.boss());
select public.archive_problem(pg_temp.pid(11));
insert into public.tasks (property_id, type, status, assignee_id, scheduled_date, problem_id)
values (900009511, 'maintenance', 'assigned', pg_temp.tech1(), current_date, pg_temp.pid(11));
select pg_temp.as_postgres();
select pg_temp.check('a live attempt on an archived problem does not move it',
  pg_temp.st(11), 'open assigned');
update public.tasks set status = 'done', completed_at = now() where problem_id = pg_temp.pid(11);
select pg_temp.check('finishing it resolves the problem even in the archive',
  pg_temp.st(11), 'resolved done');

-- 12: a fix task made unassigned by hand is never swept either; the problem is
-- open, and handing it out again reuses the row.
select pg_temp.report(12);
select pg_temp.assign(12, pg_temp.tech1());
update public.tasks set status = 'unassigned', assignee_id = null
where problem_id = pg_temp.pid(12);
select pg_temp.age(12, 5);
select public.expire_stale_tasks();
select pg_temp.check('an unassigned repair past its day is not swept',
  pg_temp.st(12), 'open unassigned');
select pg_temp.assign(12, pg_temp.tech2());
select pg_temp.check('and handing it out reuses the row', pg_temp.st(12), 'assigned assigned');

-- ---------------------------------------------------------------------------
--  Leaving, closing and archiving in one write
-- ---------------------------------------------------------------------------

-- 13 -> 14: the live attempt of 13 is moved to 14 and finished in one UPDATE.
-- It closed on a problem it no longer belongs to: 13 is left open, and 14,
-- which never had it live, is not resolved by it.
select pg_temp.report(n) from generate_series(13, 14) n;
select pg_temp.assign(13, pg_temp.tech1());
select pg_temp.as_user(pg_temp.boss());
update public.tasks set problem_id = pg_temp.pid(14), status = 'done', completed_at = now()
where problem_id = pg_temp.pid(13);
select pg_temp.as_postgres();
select pg_temp.check('the problem a live task left while closing reads open',
  pg_temp.st(13), 'open -');
select pg_temp.check('and the problem it arrived at, finished, is not resolved by it',
  pg_temp.st(14), 'open done');

-- 15: archived by hand while assigned; its live task is deleted. The archive
-- keeps the status it had.
select pg_temp.report(15);
select pg_temp.assign(15, pg_temp.tech1());
update public.problems set archived_at = now() where id = pg_temp.pid(15);
select pg_temp.as_user(pg_temp.boss());
delete from public.tasks where problem_id = pg_temp.pid(15);
select pg_temp.as_postgres();
select pg_temp.check('a live task leaving an archived problem leaves its status alone',
  pg_temp.st(15), 'assigned -');

-- ---------------------------------------------------------------------------
--  Who may point a task at a problem
-- ---------------------------------------------------------------------------

-- An executor cannot attach her own task to a problem: the link would hand
-- her the report, its chat, and the problem's status through the mirror.
insert into public.tasks (property_id, type, status, assignee_id, scheduled_date, notes)
values (900009516, 'cleaning', 'assigned', pg_temp.tech2(), current_date, 'her own cleaning');
select pg_temp.as_user(pg_temp.tech2());
update public.tasks set problem_id = pg_temp.pid(13) where notes = 'her own cleaning';
select pg_temp.as_postgres();
select pg_temp.check('an executor''s problem_id write is ignored',
  (select problem_id from public.tasks where notes = 'her own cleaning'), null::uuid);
select pg_temp.check('and the problem does not move', pg_temp.st(13), 'open -');

-- A task never speaks for another company's problem, whoever wrote the link.
insert into public.hosts (id, name) values ('b9300000-0000-4000-8000-00000000000b', 'Other company');
insert into public.problems (id, host_id, reported_by, title)
values ('f9300000-0000-4000-8000-0000000000bb', 'b9300000-0000-4000-8000-00000000000b',
        pg_temp.rep(), 'Another company''s problem');
select pg_temp.as_user(pg_temp.boss());
insert into public.tasks (property_id, type, status, assignee_id, scheduled_date, problem_id)
values (900009516, 'maintenance', 'assigned', pg_temp.tech1(), current_date,
        'f9300000-0000-4000-8000-0000000000bb');
select pg_temp.as_postgres();
select pg_temp.check('another company''s problem is not moved by our task',
  (select status::text from public.problems where id = 'f9300000-0000-4000-8000-0000000000bb'),
  'open');

rollback;
