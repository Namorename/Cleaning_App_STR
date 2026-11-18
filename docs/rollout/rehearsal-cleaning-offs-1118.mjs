// Rehearsal of the rollout of the office cancel and a cleaner's hand-back (20261118120000) and of
// its rollback, in the order docs/rollout/cleaning-offs-1118.md gives, on a throwaway database
// inside the local Supabase container, apart from the stand:
//
//   node docs/rollout/rehearsal-db-1028.mjs create                  # every migration of this tree
//   node docs/rollout/rehearsal-cleaning-offs-1118.mjs
//   node docs/rollout/rehearsal-db-1028.mjs drop
//
// In order: the rollback back to the cloud's «before» (md5 of the six functions it replaces);
// a booking's cleaning written by the generator of before, accepted the old phone's way; the
// migration alone as db push applies it; the suites; the scenario of the owner's prompt — she
// declines, the generator keeps it from her regular cleaner, the office hears it, a colleague
// takes it the old phone's way, the office cancels it, the generator writes nothing for the
// booking, «Вернуть» gives it back to the colleague; the rollback again, back to «before»; a
// second push. Read-only towards the stand: its database (`postgres`) is never touched.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DB = 'rehearsal_1028';
const OFFS = { file: 'supabase/migrations/20261118120000_cleaning_offs.sql', version: '20261118120000', name: 'cleaning_offs' };
const HOST = 'f1189000-0000-4000-8000-00000000000a';
const MILA = 'f1189001-0000-4000-8000-000000000001'; // manager
const VERA = 'f1189002-0000-4000-8000-000000000002'; // the listing's regular ('auto') cleaner
const OLGA = 'f1189003-0000-4000-8000-000000000003'; // a colleague who takes free work
const FLAT = 900118901;
const STAY = 900118911;
const PROBE = 'docs/rollout/probe_cleaning_offs.sql';

// The cloud's answer, 2026-11-18 19:40 UTC.
const BEFORE = {
  head: '20261115150000',
  applied: 136,
  functions:
    'generate_cleaning_tasks(2) 31e0dad83f3e80859d8ffa783d43127d; ' +
    'guard_task_fields(0) 0cba3e932d34f99054513b97046b85ec; guard_task_transitions(0) bba9946e02cb9d2ab12536e9539d4c99; ' +
    'journal_task_change(0) c4f65f2dcfaa24537a1ab0aa04f7d69d; push_on_task_change(0) c420d5478143e08cb7d198a01b510938',
  comments:
    'generate_cleaning_tasks:none; guard_task_fields:none; guard_task_transitions:none; ' +
    'journal_task_change:7bd9833db58456ad43b7a53320becf9f; push_on_task_change:654e26af87ee0ede0b7e6d080189a56d',
  notes_table: null,
  insert_guard: 0,
  client_execute: null,
  columns: null,
  causes:
    "CHECK ((cause = ANY (ARRAY['manager'::text, 'head_tech'::text, 'staff'::text, 'staff_inactive'::text, " +
    "'booking_cancelled'::text, 'property_unavailable'::text, 'booking_changed'::text, 'system'::text])))",
  task_statuses: 'unassigned,assigned,accepted,in_progress,paused,blocked,done,cancelled,expired',
};
// The enum keeps the two kinds after a rollback (a value is not dropped): `push_kinds` is not compared.
const AFTER = {
  head: OFFS.version,
  applied: 137,
  functions:
    'cancel_cleaning(2) fd6d6ad50c21616d19a67d49f6c302f3; decline_cleaning(2) 2e2caa77441824d77e260cb0543c7142; ' +
    'generate_cleaning_tasks(2) 5e1c1f310eb1222cab856f9b8c0ffca8; guard_task_fields(0) 897793bc53c1fcb119f994aad9fe45cf; ' +
    'guard_task_marks_insert(0) 09a64ed6f5e755fafbdfef193a77ba98; guard_task_transitions(0) a13cd456b0ff3c5e2a425de8bbe21e34; ' +
    'hand_back_cleaning(3) 001a5643660454b3fff3be8d3d33740f; interrupt_cleaning(2) 0442cc17f668a7f0cffcb568d57fdb85; ' +
    'journal_task_change(0) 8f50ad75f63df50c1a6818049080f012; push_on_task_change(0) 07b1522ce83dba073739dc9db496d456; ' +
    'restore_cleaning(1) 052ec50671142fd9622569599c34f480; task_offs(1) 5c51a17663da15dba36e12ffd45663c0',
  comments:
    'generate_cleaning_tasks:none; guard_task_fields:8737c5c3120409543d15894c8dc47bd7; guard_task_transitions:none; ' +
    'journal_task_change:5731c0b79f0fd78e9f31b94439414917; push_on_task_change:654e26af87ee0ede0b7e6d080189a56d',
  notes_table: 'task_off_notes',
  insert_guard: 1,
  client_execute:
    'cancel_cleaning:authenticated, decline_cleaning:authenticated, interrupt_cleaning:authenticated, ' +
    'restore_cleaning:authenticated, task_offs:authenticated',
  columns:
    'tasks.cancel_departure, tasks.cancelled_at, tasks.cancelled_by, tasks.cancelled_closing, ' +
    'tasks.cancelled_from, tasks.release_kind, tasks.released_at, tasks.released_by',
  causes:
    "CHECK ((cause = ANY (ARRAY['manager'::text, 'head_tech'::text, 'staff'::text, 'staff_inactive'::text, " +
    "'booking_cancelled'::text, 'property_unavailable'::text, 'booking_changed'::text, 'system'::text, " +
    "'declined'::text, 'interrupted'::text])))",
  task_statuses: BEFORE.task_statuses,
};

const projectId = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m);
const CONTAINER = `supabase_db_${projectId[1]}`;

function psql(sql, extra = []) {
  const res = spawnSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', DB, '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-At', ...extra],
    { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return { ok: res.status === 0, out: res.stdout ?? '', err: res.stderr ?? '' };
}
let failures = 0;
function fail(label, detail) {
  failures += 1;
  console.error(`FAIL ${label}\n     ${detail}`);
}
function must(label, sql, extra = []) {
  const res = psql(sql, extra);
  if (!res.ok) {
    console.error(`FAILED: ${label}\n${(res.out + res.err).slice(-3000)}`);
    process.exit(1);
  }
  console.log(`ok   ${label}`);
  return res;
}
function check(label, sql, want) {
  const res = psql(sql);
  const got = res.ok ? res.out.trim().split('\n').at(-1) ?? '' : `ERROR ${res.err.trim().split('\n')[0]}`;
  if (got !== String(want)) fail(label, `got ${got}, want ${want}`);
  else console.log(`ok   ${label}`);
}
function probeFile(path) {
  const body = readFileSync(path, 'utf8').split('\n').filter((line) => !/^\s*--/.test(line)).join('\n').replace(/;\s*$/, '');
  const res = psql(`select row_to_json(x) from (${body}) x;`);
  if (!res.ok) {
    console.error(`probe ${path} failed\n${res.err}`);
    process.exit(1);
  }
  return JSON.parse(res.out.trim());
}
function expectProbe(label, want) {
  const got = probeFile(PROBE);
  const wrong = Object.keys(want).filter((key) => JSON.stringify(got[key]) !== JSON.stringify(want[key]));
  if (wrong.length > 0) fail(label, wrong.map((key) => `${key}: got ${JSON.stringify(got[key])}, want ${JSON.stringify(want[key])}`).join('\n     '));
  else console.log(`ok   ${label}`);
}
const file = (path) => readFileSync(path, 'utf8');
const as = (sub) => `set role authenticated; set request.jwt.claims to '{"sub":"${sub}","role":"authenticated"}';\n`;
const asServer = `reset role; set request.jwt.claims to '{}';\n`;
const push = (m) => `${file(m.file)}\ninsert into supabase_migrations.schema_migrations (version, name) values ('${m.version}', '${m.name}');`;
const repair = (m) => `delete from supabase_migrations.schema_migrations where version = '${m.version}';`;
// The booking leaves tomorrow in the flat's own calendar; the generator's window spans it.
const tomorrow = `((now() at time zone 'Europe/Prague')::date + 1)`;
const generate = `${asServer} select public.generate_cleaning_tasks(${tomorrow} - 1, ${tomorrow} + 1);`;
const cleaning = `(select t.id from public.tasks t where t.reservation_id = ${STAY} and t.status <> 'cancelled' order by t.created_at limit 1)`;
const stateOf = `select coalesce((select t.status || ':' || coalesce(p.full_name, '-') from public.tasks t left join public.profiles p on p.id = t.assignee_id where t.reservation_id = ${STAY} and t.status <> 'cancelled' order by t.created_at limit 1), 'none');`;
const cleaningsOfStay = `select count(*) filter (where status <> 'cancelled') || ' live, ' || count(*) filter (where status = 'cancelled') || ' cancelled' from public.tasks where reservation_id = ${STAY};`;
const outbox = (kind, who) => `select count(*) from raw.push_outbox where kind::text = '${kind}' and recipient_id = '${who}';`;

// ---------- 0. the tree ----------
check('the throwaway database carries the new migration', 'select max(version) from supabase_migrations.schema_migrations;', OFFS.version);

// ---------- 1. the rollback leaves the cloud's state; the migration alone, as db push applies it ----------
must('the rollback (cleaning-offs-rollback.sql)', file('docs/one-off-writes/cleaning-offs-rollback.sql'));
must('migration repair --status reverted 20261118120000', repair(OFFS));
expectProbe('after the rollback the probe reads what the cloud read before', BEFORE);
must('the migration alone, in one transaction', push(OFFS), ['--single-transaction']);
expectProbe('after it the probe reads AFTER', AFTER);

// ---------- 2. the suites, before the rehearsal's own company is there ----------
for (const suite of ['cleaning_offs.sql', 'task_events.sql', 'task_generation.sql', 'task_accept.sql',
  'task_lifecycle.sql', 'push_events.sql', 'push_recipients.sql', 'head_tech_push.sql', 'staff_disable.sql',
  'table_grants.sql', 'api_v1.sql']) {
  const res = psql(file(`supabase/tests/${suite}`), []);
  const all = res.out + res.err;
  const passed = (all.match(/NOTICE:\s+ok/g) ?? []).length;
  if (!res.ok || /ERROR:|FAIL/.test(all)) fail(`suite ${suite}`, (all.split('\n').find((line) => /ERROR:|FAIL/.test(line)) ?? '').trim());
  else console.log(`ok   suite ${suite}: ${passed} checks`);
}

// ---------- 3. as tonight: the schema of before, the generator of before, the old phone ----------
must('the rollback again', file('docs/one-off-writes/cleaning-offs-rollback.sql'));
must('migration repair --status reverted 20261118120000', repair(OFFS));
expectProbe('the probe reads before', BEFORE);
must('seed a company: a manager, a regular cleaner, a colleague, a flat, a booking leaving tomorrow', `
-- The oldest company: the generator writes its cleanings under default_host_id(), as the cloud's one company.
insert into public.hosts (id, name, default_language, created_at) values ('${HOST}', 'Rehearsal company', 'ru', '2000-01-01');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_user_meta_data, raw_app_meta_data) values
  ('${MILA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mila.offs@test.local', 'x', now(), now(), '{"full_name":"Mila"}', '{"role":"manager"}'),
  ('${VERA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vera.offs@test.local', 'x', now(), now(), '{"full_name":"Vera"}', '{"role":"cleaner"}'),
  ('${OLGA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'olga.offs@test.local', 'x', now(), now(), '{"full_name":"Olga"}', '{"role":"cleaner"}');
update public.profiles set host_id = '${HOST}' where id in ('${MILA}', '${VERA}', '${OLGA}');
insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time)
  values (${FLAT}, '${HOST}', 'Rehearsal flat', 'Europe/Prague', '15:00', '10:00');
insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values
  ('${HOST}', ${FLAT}, '${VERA}', 'auto'), ('${HOST}', ${FLAT}, '${OLGA}', 'claim');
insert into public.reservations (id, host_id, property_id, arrival_date, departure_date, status, guest_name, is_block)
  values (${STAY}, '${HOST}', ${FLAT}, ${tomorrow} - 3, ${tomorrow}, 'new', 'Synthetic Guest', false);
insert into public.push_tokens (token, profile_id, host_id, platform) values
  ('ExponentPushToken[rehearsal-mila]', '${MILA}', '${HOST}', 'android'),
  ('ExponentPushToken[rehearsal-olga]', '${OLGA}', '${HOST}', 'android'),
  ('ExponentPushToken[rehearsal-vera]', '${VERA}', '${HOST}', 'android');
`);
must('the generator of before writes the booking its cleaning', generate);
check('given to the regular cleaner', stateOf, 'assigned:Vera');
must('she accepts it the way the old phone does', `${as(VERA)} update public.tasks set status = 'accepted' where id = ${cleaning} and status in ('assigned', 'accepted');`);
check('accepted', stateOf, 'accepted:Vera');

// ---------- 4. the migration under her accepted cleaning ----------
must('the migration alone, in one transaction', push(OFFS), ['--single-transaction']);
expectProbe('after it the probe reads AFTER', AFTER);
check('the cleaning is as it was', stateOf, 'accepted:Vera');

// ---------- 5. the owner's scenario ----------
must('Vera declines it, saying why', `${as(VERA)} select public.decline_cleaning(${cleaning}, 'Заболела');`);
check('free work, nobody on it', stateOf, 'unassigned:-');
check('the office hears it (cleaning_declined for Mila)', outbox('cleaning_declined', MILA), 1);
check('Olga is offered it as free work', outbox('cleaning_free', OLGA), 1);
check('Vera is not offered her own cleaning back', outbox('cleaning_free', VERA), 0);
must('the generator runs', generate);
check('it does not give the cleaning back to her regular cleaner', stateOf, 'unassigned:-');
check('the office reads who and why', `${as(MILA)} select t.offs -> 'released' ->> 'reason' from (select public.task_offs(x) as offs from public.tasks x where x.id = ${cleaning}) t;`, 'Заболела');
check('a cleaner reads no marks', `${as(OLGA)} select coalesce(public.task_offs(x)::text, 'null') from public.tasks x where x.id = ${cleaning};`, 'null');
must('Olga takes it the way the old phone does', `${as(OLGA)} update public.tasks set assignee_id = '${OLGA}', status = 'accepted' where id = ${cleaning} and status = 'unassigned';`);
check('hers', stateOf, 'accepted:Olga');
must('Mila cancels it', `${as(MILA)} select public.cancel_cleaning(${cleaning}, 'Хозяин убирает сам');`);
check('the booking has no live cleaning, one cancelled', cleaningsOfStay, '0 live, 1 cancelled');
check('Olga is told', outbox('cleaning_cancelled', OLGA), 1);
must('the generator runs', generate);
check('it writes no new cleaning for the booking', cleaningsOfStay, '0 live, 1 cancelled');
must('Mila returns it', `${as(MILA)} select public.restore_cleaning((select id from public.tasks where reservation_id = ${STAY}));`);
check('back to Olga, accepted', stateOf, 'accepted:Olga');

// ---------- 6. back, and forth again ----------
must('the rollback', file('docs/one-off-writes/cleaning-offs-rollback.sql'));
must('migration repair --status reverted 20261118120000', repair(OFFS));
expectProbe('back to what the cloud read before', BEFORE);
check('the cleaning stays as it was', stateOf, 'accepted:Olga');
must('a second push', push(OFFS), ['--single-transaction']);
expectProbe('and the probe reads AFTER again', AFTER);

console.log(failures === 0 ? '\nREHEARSAL GREEN' : `\nREHEARSAL RED: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
