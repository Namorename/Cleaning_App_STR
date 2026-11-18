// Rehearsal of the rollout of the manager boards (20261118200000) and of its rollback, in the order
// docs/rollout/manager-boards-1118.md gives, on a throwaway database inside the local Supabase
// container, apart from the stand:
//
//   node docs/rollout/rehearsal-db-1028.mjs create                  # every migration of this tree
//   node docs/rollout/rehearsal-manager-boards-1118.mjs
//   node docs/rollout/rehearsal-db-1028.mjs drop
//
// In order: the rollback back to the cloud's «before»; the migration alone as db push applies it;
// the suites; the owner's scenario — a manager makes a board, a card with steps, moves it, ticks
// every step, writes in the journal; another manager reads it and changes nothing; a cleaner and
// a technician read nothing; the old phone's reads of cleanings and tasks answer as before; the
// rollback refuses while a board holds words; emptied, it goes back to «before»; a second push.
// Read-only towards the stand: its database (`postgres`) is never touched.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DB = 'rehearsal_1028';
const BOARDS = {
  file: 'supabase/migrations/20261118200000_manager_boards.sql',
  version: '20261118200000',
  name: 'manager_boards',
};
const HOST = 'b0a2d900-0000-4000-8000-00000000000a';
const MILA = 'b0a2d901-0000-4000-8000-000000000001'; // manager, the board's owner
const INA = 'b0a2d902-0000-4000-8000-000000000002'; // another manager
const OLGA = 'b0a2d903-0000-4000-8000-000000000003'; // cleaner
const TOM = 'b0a2d904-0000-4000-8000-000000000004'; // technician
const BOARD = 'b0a2d910-0000-4000-8000-000000000001';
const CARD = 'b0a2d911-0000-4000-8000-000000000001';
const PROBE = 'docs/rollout/probe_manager_boards.sql';

const STATUSES = {
  task_statuses: 'unassigned,assigned,accepted,in_progress,paused,blocked,done,cancelled,expired',
  problem_statuses: 'open,assigned,in_progress,resolved,cancelled',
};
// The cloud's answer, 2026-11-18 19:20 UTC (node scripts/cloud-read.mjs docs/rollout/probe_manager_boards.sql).
const BEFORE = {
  head: '20261118120000',
  applied: 137,
  tables: null,
  client_grants: null,
  policies: null,
  functions: null,
  client_execute: null,
  ...STATUSES,
};
const TABLES = ['manager_board_cards', 'manager_board_entries', 'manager_board_steps', 'manager_boards'];
const AFTER = {
  head: BOARDS.version,
  applied: 138,
  tables: TABLES.map((name) => `${name}:rls=true`).join(', '),
  client_grants: TABLES.map((name) => `${name}:authenticated:SELECT`).join(', '),
  policies:
    "manager_board_cards:the office reads the company's board cards; " +
    "manager_board_entries:the office reads the company's board journals; " +
    "manager_board_steps:the office reads the company's board steps; " +
    "manager_boards:the office reads the company's boards",
  functions:
    'delete_manager_comment(1) 2b426551e6518325329b387704fb522f; delete_manager_step(1) 3416f9597ed38dede98c1a85df73e4e7; ' +
    'duplicate_manager_card(3) 14ea0c4efb7f3e2e8654e5b10c086ba4; manager_board_column(1) 51a8c80f5d28b6cca728dd7841105a4d; ' +
    'manager_board_for_edit(2) d889671504b15b4093f503a4bdd12145; manager_card_for_edit(2) 38f50be565214edc0495fba617a6ed83; ' +
    'manager_step_card(1) 755b5a8fb942f553ce7d7616abf70065; move_manager_card(2) 723afdf74ee7cd0ff4033f8a47818138; ' +
    'order_manager_steps(2) 11c0a417b3b40b1d16014cde65b8ad0e; save_manager_board(2) 02f3798437ef0c7b0f265c5279b28be7; ' +
    'save_manager_card(9) 980fe1802e924ac2a0822417f1c0d514; save_manager_comment(3) 419fc15967e99c75ff03207b7d481c28; ' +
    'save_manager_step(3) 1d4ffe47605bd21ae2fb72d27d4a8383; set_manager_board_archived(2) 4645f1c132870ad9c0f37ec70830609c; ' +
    'set_manager_card_state(2) 418ec55ee6987052df879864355d22dc; set_manager_step_done(2) 795ef857ed63da946946b15665c056fc',
  client_execute: [
    'delete_manager_comment',
    'delete_manager_step',
    'duplicate_manager_card',
    'move_manager_card',
    'order_manager_steps',
    'save_manager_board',
    'save_manager_card',
    'save_manager_comment',
    'save_manager_step',
    'set_manager_board_archived',
    'set_manager_card_state',
    'set_manager_step_done',
  ]
    .map((name) => `${name}:authenticated`)
    .join(', '),
  ...STATUSES,
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
  const got = res.ok ? (res.out.trim().split('\n').at(-1) ?? '') : `ERROR ${res.err.trim().split('\n')[0]}`;
  if (got !== String(want)) fail(label, `got ${got}, want ${want}`);
  else console.log(`ok   ${label}`);
}
function refused(label, sql, pattern) {
  const res = psql(sql);
  if (res.ok || !pattern.test(res.err)) fail(label, `got ${res.ok ? 'no error' : res.err.trim().split('\n')[0]}`);
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
const reads = (who) => `${as(who)} select (select count(*) from public.manager_boards) || ' ' || (select count(*) from public.manager_board_cards) || ' ' || (select count(*) from public.manager_board_steps) || ' ' || (select count(*) from public.manager_board_entries);`;

// ---------- 0. the tree ----------
check('the throwaway database carries the new migration', 'select max(version) from supabase_migrations.schema_migrations;', BOARDS.version);

// ---------- 1. the rollback leaves the cloud's state; the migration alone, as db push applies it ----------
must('the rollback (manager-boards-rollback.sql)', file('docs/one-off-writes/manager-boards-rollback.sql'));
must('migration repair --status reverted 20261118200000', repair(BOARDS));
expectProbe('after the rollback the probe reads what the cloud read before', BEFORE);
must('the migration alone, in one transaction', push(BOARDS), ['--single-transaction']);
expectProbe('after it the probe reads AFTER', AFTER);

// ---------- 2. the suites, before the rehearsal's own company is there ----------
for (const suite of ['manager_boards.sql', 'table_grants.sql', 'retention_keeps_work.sql', 'tenant_isolation.sql',
  'rls_smoke.sql', 'api_v1.sql', 'cleaning_offs.sql', 'problems.sql', 'task_lifecycle.sql']) {
  const res = psql(file(`supabase/tests/${suite}`), []);
  const all = res.out + res.err;
  const passed = (all.match(/NOTICE:\s+ok/g) ?? []).length;
  if (!res.ok || /ERROR:|FAIL/.test(all)) fail(`suite ${suite}`, (all.split('\n').find((line) => /ERROR:|FAIL/.test(line)) ?? '').trim());
  else console.log(`ok   suite ${suite}: ${passed} checks`);
}

// ---------- 3. the company of the rehearsal ----------
must('a company: two managers, a cleaner, a technician', `${asServer}
insert into public.hosts (id, name) values ('${HOST}', 'Boards rehearsal');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values ('${MILA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mila.boards1118@rehearsal.local', 'x', now(), now(), '{"full_name":"Mila"}', '{"role":"manager"}'),
       ('${INA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ina.boards1118@rehearsal.local', 'x', now(), now(), '{"full_name":"Ina"}', '{"role":"manager"}'),
       ('${OLGA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'olga.boards1118@rehearsal.local', 'x', now(), now(), '{"full_name":"Olga"}', '{"role":"cleaner"}'),
       ('${TOM}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tom.boards1118@rehearsal.local', 'x', now(), now(), '{"full_name":"Tom"}', '{"role":"tech"}');
update public.profiles set host_id = '${HOST}' where id in ('${MILA}', '${INA}', '${OLGA}', '${TOM}');`);

// ---------- 4. the owner's scenario ----------
must('Mila makes a board', `${as(MILA)} select public.save_manager_board('${BOARD}', 'Ремонт на Виноградской');`);
must('and a card with three steps, blue, due in three days', `${as(MILA)} select public.save_manager_card('${CARD}', '${BOARD}', 'Ванная', 'План: https://example.com/plan', current_date + 3, null, 'blue', null, '["Сантехник", "Плитка", "Уборка"]');`);
must('she moves it to «В работе»', `${as(MILA)} select public.move_manager_card('${CARD}', 'in_progress');`);
must('she ticks every step', `${as(MILA)} select public.set_manager_step_done(s.id, true) from public.manager_board_steps s where s.card_id = '${CARD}' order by s.sort_order;`);
must('she writes in the journal', `${as(MILA)} select public.save_manager_comment('b0a2d912-0000-4000-8000-000000000001', '${CARD}', 'Сантехник был во вторник');`);
check('the journal: one move, three ticks, one comment', `${asServer} select string_agg(kind, ',' order by created_at, id) from public.manager_board_entries where card_id = '${CARD}';`, 'moved,step_done,step_done,step_done,comment');
check('the last tick says 3/3, without the step\'s words', `${asServer} select facts::text from public.manager_board_entries where card_id = '${CARD}' and kind = 'step_done' order by created_at desc, id desc limit 1;`, '{"done": 3, "total": 3}');
check('Ina reads it all', reads(INA), '1 1 3 5');
refused('Ina changes nothing', `${as(INA)} select public.move_manager_card('${CARD}', 'resolved');`, /Only the owner of board/);
check('a cleaner reads nothing', reads(OLGA), '0 0 0 0');
check('a technician reads nothing', reads(TOM), '0 0 0 0');
refused('a cleaner writes nothing', `${as(OLGA)} select public.save_manager_board('b0a2d910-0000-4000-8000-000000000009', 'x');`, /Only a manager may do this/);
check('the old phone\'s read of cleanings answers as before', `${as(OLGA)} select count(*) from public.tasks where assignee_id = '${OLGA}';`, '0');
check('and of tasks', `${as(MILA)} select count(*) >= 0 from public.problems;`, 't');
check('nothing reached the work log', `${asServer} select (select count(*) from public.task_events e join public.tasks t on t.id = e.task_id where t.host_id = '${HOST}') + (select count(*) from public.problem_events e join public.problems p on p.id = e.problem_id where p.host_id = '${HOST}');`, '0');

// ---------- 5. the rollback refuses while a board holds words; emptied, it goes back ----------
refused('the rollback refuses while a board exists', file('docs/one-off-writes/manager-boards-rollback.sql'), /holds 1 board/);
expectProbe('and leaves AFTER as it was', AFTER);
must('the boards emptied by hand (the owner\'s word, after an export)', `${asServer}
delete from public.manager_board_entries; delete from public.manager_board_steps;
delete from public.manager_board_cards; delete from public.manager_boards;`);
must('the rollback', file('docs/one-off-writes/manager-boards-rollback.sql'));
must('migration repair --status reverted 20261118200000', repair(BOARDS));
expectProbe('back to what the cloud read before', BEFORE);
must('a second push', push(BOARDS), ['--single-transaction']);
expectProbe('and the probe reads AFTER again', AFTER);

console.log(failures === 0 ? '\nREHEARSAL GREEN' : `\nREHEARSAL RED: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
