// Rehearsal of the rollout of the office-wide cards (20261119090000) and of its rollback, in the
// order docs/rollout/manager-cards-office-wide-1119.md gives, on a throwaway database inside the
// local Supabase container, apart from the stand:
//
//   node docs/rollout/rehearsal-db-1028.mjs create                  # every migration of this tree
//   node docs/rollout/rehearsal-manager-cards-office-wide-1119.mjs
//   node docs/rollout/rehearsal-db-1028.mjs drop
//
// In order: the rollback back to the cloud's «before»; a board and a card of Mila's made there, which
// Ina, another manager, may not touch; the migration alone as db push applies it; the suites; Ina
// works on Mila's cards and not on the board; a cleaner and a person switched off reach nothing; the
// rollback — Ina is refused again, and what she made stays; a second push. Read-only towards the stand.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DB = 'rehearsal_1028';
const MIGRATION = {
  file: 'supabase/migrations/20261119090000_manager_cards_office_wide.sql',
  version: '20261119090000',
  name: 'manager_cards_office_wide',
};
const PROBE = 'docs/rollout/probe_manager_card_assignee.sql';
const UNDO = 'docs/one-off-writes/manager-cards-office-wide-rollback.sql';
const HOST = 'b0a2eb00-0000-4000-8000-00000000000a';
const MILA = 'b0a2eb01-0000-4000-8000-000000000001'; // manager, the board's owner
const INA = 'b0a2eb02-0000-4000-8000-000000000002'; // another manager
const OLGA = 'b0a2eb03-0000-4000-8000-000000000003'; // cleaner
const DORA = 'b0a2eb04-0000-4000-8000-000000000004'; // manager switched off
const BOARD = 'b0a2eb10-0000-4000-8000-000000000001';
const CARD = 'b0a2eb11-0000-4000-8000-000000000001'; // Mila's
const INA_CARD = 'b0a2eb11-0000-4000-8000-000000000002'; // made by Ina once the rule is open

// The cloud's answer, 2026-11-19 (node scripts/cloud-read.mjs docs/rollout/probe_manager_card_assignee.sql).
const BEFORE = {
  head: "20261118230000",
  applied: 139,
  assignee_column: "assignee_id:uuid:notnull=false",
  journal_kinds: "CHECK ((kind = ANY (ARRAY['comment'::text, 'moved'::text, 'due_changed'::text, 'step_done'::text, 'assignee_changed'::text])))",
  push_kinds: "cleaning_new,cleaning_assigned,cleaning_unassigned,cleaning_cancelled,cleaning_moved,cleaning_window,cleaning_free,cleaning_declined,cleaning_interrupted,booking_cancelled_live,board_card_assigned,problem_new,chat_message,daily_digest",
  functions: "delete_manager_comment(1) 2b426551e6518325329b387704fb522f; delete_manager_step(1) 3416f9597ed38dede98c1a85df73e4e7; duplicate_manager_card(3) 22571005309b8e8ce98a3ab8d1b4a8a8; manager_board_column(1) 51a8c80f5d28b6cca728dd7841105a4d; manager_board_for_edit(2) d889671504b15b4093f503a4bdd12145; manager_card_for_edit(2) a8cf1cdb54d495c52287b4c5699804b6; manager_step_card(1) 755b5a8fb942f553ce7d7616abf70065; move_manager_card(2) 723afdf74ee7cd0ff4033f8a47818138; order_manager_steps(2) 11c0a417b3b40b1d16014cde65b8ad0e; save_manager_board(2) 1c1152328c04ee39fbb296a19d70a488; save_manager_card(9) 81b291bb834aaea4a82114745b5b662c; save_manager_comment(3) 11e4bb00b5e7b5458fa11923a475e7c2; save_manager_step(3) 32cf8041e6be25575477f6dcbd71947a; set_manager_board_archived(2) 94bd11315badc02a55c8ba57e8621b24; set_manager_card_assignee(2) e89ee4126ed94354750308675bb2a5f4; set_manager_card_state(2) 418ec55ee6987052df879864355d22dc; set_manager_step_done(2) 795ef857ed63da946946b15665c056fc",
  client_execute: "delete_manager_comment:authenticated, delete_manager_step:authenticated, duplicate_manager_card:authenticated, move_manager_card:authenticated, order_manager_steps:authenticated, save_manager_board:authenticated, save_manager_card:authenticated, save_manager_comment:authenticated, save_manager_step:authenticated, set_manager_board_archived:authenticated, set_manager_card_assignee:authenticated, set_manager_card_state:authenticated, set_manager_step_done:authenticated",
  push_functions: "push_board_card_titles 7b5f999f137163cee6803dbd8ceb785c; push_on_card_assigned 5795ee6007f20608c8caf36125d803ca",
  journal_triggers: "manager_board_entries_push_assigned",
  titles_execute: "service_role",
  client_grants: "manager_board_cards:authenticated:SELECT, manager_board_entries:authenticated:SELECT, manager_board_steps:authenticated:SELECT, manager_boards:authenticated:SELECT",
  task_statuses: "unassigned,assigned,accepted,in_progress,paused,blocked,done,cancelled,expired",
  problem_statuses: "open,assigned,in_progress,resolved,cancelled",
};
// The probe after the migration alone, from the rehearsal of 2026-11-19 (checked against the cloud after db push).
const AFTER = {
  head: "20261119090000",
  applied: 140,
  assignee_column: "assignee_id:uuid:notnull=false",
  journal_kinds: "CHECK ((kind = ANY (ARRAY['comment'::text, 'moved'::text, 'due_changed'::text, 'step_done'::text, 'assignee_changed'::text])))",
  push_kinds: "cleaning_new,cleaning_assigned,cleaning_unassigned,cleaning_cancelled,cleaning_moved,cleaning_window,cleaning_free,cleaning_declined,cleaning_interrupted,booking_cancelled_live,board_card_assigned,problem_new,chat_message,daily_digest",
  functions: "delete_manager_comment(1) 2b426551e6518325329b387704fb522f; delete_manager_step(1) 3416f9597ed38dede98c1a85df73e4e7; duplicate_manager_card(3) 22571005309b8e8ce98a3ab8d1b4a8a8; manager_board_column(1) 51a8c80f5d28b6cca728dd7841105a4d; manager_board_for_cards(1) 7266518986f831606d6a92f8815e9e56; manager_board_for_edit(2) d889671504b15b4093f503a4bdd12145; manager_card_for_edit(2) 2c1f8efc3ec2e3f6e1c0c24bc5925710; manager_step_card(1) 755b5a8fb942f553ce7d7616abf70065; move_manager_card(2) 723afdf74ee7cd0ff4033f8a47818138; order_manager_steps(2) 11c0a417b3b40b1d16014cde65b8ad0e; save_manager_board(2) 1c1152328c04ee39fbb296a19d70a488; save_manager_card(9) 222f56971dade92d90b0953133d01a11; save_manager_comment(3) 11e4bb00b5e7b5458fa11923a475e7c2; save_manager_step(3) 32cf8041e6be25575477f6dcbd71947a; set_manager_board_archived(2) 94bd11315badc02a55c8ba57e8621b24; set_manager_card_assignee(2) e89ee4126ed94354750308675bb2a5f4; set_manager_card_state(2) 418ec55ee6987052df879864355d22dc; set_manager_step_done(2) 795ef857ed63da946946b15665c056fc",
  client_execute: "delete_manager_comment:authenticated, delete_manager_step:authenticated, duplicate_manager_card:authenticated, move_manager_card:authenticated, order_manager_steps:authenticated, save_manager_board:authenticated, save_manager_card:authenticated, save_manager_comment:authenticated, save_manager_step:authenticated, set_manager_board_archived:authenticated, set_manager_card_assignee:authenticated, set_manager_card_state:authenticated, set_manager_step_done:authenticated",
  push_functions: "push_board_card_titles 7b5f999f137163cee6803dbd8ceb785c; push_on_card_assigned 5795ee6007f20608c8caf36125d803ca",
  journal_triggers: "manager_board_entries_push_assigned",
  titles_execute: "service_role",
  client_grants: "manager_board_cards:authenticated:SELECT, manager_board_entries:authenticated:SELECT, manager_board_steps:authenticated:SELECT, manager_boards:authenticated:SELECT",
  task_statuses: "unassigned,assigned,accepted,in_progress,paused,blocked,done,cancelled,expired",
  problem_statuses: "open,assigned,in_progress,resolved,cancelled",
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

const count = (sql) => `${asServer} ${sql}`;

// ---------- 0. the tree ----------
check('the throwaway database carries the new migration', 'select max(version) from supabase_migrations.schema_migrations;', MIGRATION.version);

// ---------- 1. back to the cloud's «before», with Mila's board ----------
must("the migration's rollback", file(UNDO));
must('migration repair --status reverted 20261119090000', repair(MIGRATION));
expectProbe('after the rollback the probe reads what the cloud read before', BEFORE);
must('a company: two managers, a cleaner, a manager switched off', `${asServer}
insert into public.hosts (id, name) values ('${HOST}', 'Office-wide rehearsal');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values ('${MILA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mila.office1119@rehearsal.local', 'x', now(), now(), '{"full_name":"Mila"}', '{"role":"manager"}'),
       ('${INA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ina.office1119@rehearsal.local', 'x', now(), now(), '{"full_name":"Ina"}', '{"role":"manager"}'),
       ('${OLGA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'olga.office1119@rehearsal.local', 'x', now(), now(), '{"full_name":"Olga"}', '{"role":"cleaner"}'),
       ('${DORA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dora.office1119@rehearsal.local', 'x', now(), now(), '{"full_name":"Dora"}', '{"role":"manager"}');
update public.profiles set host_id = '${HOST}' where id in ('${MILA}', '${INA}', '${OLGA}', '${DORA}');
update public.profiles set is_active = false where id = '${DORA}';`);
must('Mila makes a board and a card', `${as(MILA)} select public.save_manager_board('${BOARD}', 'Ремонт'); select public.save_manager_card('${CARD}', '${BOARD}', 'Ванная', '', null, null, 'blue', 'open', '["Плитка"]');`);
refused('before the migration Ina may not move Mila\'s card', `${as(INA)} select public.move_manager_card('${CARD}', 'in_progress');`, /Only the owner of board/);

// ---------- 2. the migration alone, as db push applies it ----------
must('the migration alone, in one transaction', push(MIGRATION), ['--single-transaction']);
if (AFTER === null) {
  console.log('AFTER (fill in):', JSON.stringify(probeFile(PROBE)));
} else {
  expectProbe('after it the probe reads AFTER', AFTER);
}

// ---------- 3. the suites ----------
for (const suite of ['manager_boards_office.sql', 'manager_boards.sql', 'manager_card_assignee.sql', 'table_grants.sql',
  'retention_keeps_work.sql', 'tenant_isolation.sql', 'rls_smoke.sql', 'api_v1.sql', 'push_events.sql',
  'head_tech_push.sql', 'cleaning_offs.sql']) {
  const res = psql(file(`supabase/tests/${suite}`), []);
  const all = res.out + res.err;
  const passed = (all.match(/NOTICE:\s+ok/g) ?? []).length;
  if (!res.ok || /ERROR:|FAIL/.test(all)) fail(`suite ${suite}`, (all.split('\n').find((line) => /ERROR:|FAIL/.test(line)) ?? '').trim());
  else console.log(`ok   suite ${suite}: ${passed} checks`);
}

// ---------- 4. Ina on Mila's board ----------
must('Ina moves Mila\'s card, edits it, ticks its step, writes, assigns it to herself',
  `${as(INA)} select public.move_manager_card('${CARD}', 'in_progress'); select public.save_manager_card('${CARD}', '${BOARD}', 'Ванная, плитка', '', null, null, 'teal'); select public.set_manager_step_done(s.id, true) from public.manager_board_steps s where s.card_id = '${CARD}'; select public.save_manager_comment('b0a2eb12-0000-4000-8000-000000000001', '${CARD}', 'Плитку купила'); select public.set_manager_card_assignee('${CARD}', '${INA}');`);
must('Ina makes a card on Mila\'s board, archives and returns it, copies Mila\'s',
  `${as(INA)} select public.save_manager_card('${INA_CARD}', '${BOARD}', 'Звонок', '', null, null, null, 'open'); select public.set_manager_card_state('${INA_CARD}', 'archived'); select public.set_manager_card_state('${INA_CARD}', 'active'); select public.duplicate_manager_card('${CARD}', 'b0a2eb11-0000-4000-8000-000000000003', 'Ванная (копия)');`);
check('her work is there under her name', count(`select string_agg(pg.full_name, ',' order by c.id) from public.manager_board_cards c join public.profiles pg on pg.id = c.created_by where c.board_id = '${BOARD}';`), 'Mila,Ina,Ina');
refused('Ina does not rename Mila\'s board', `${as(INA)} select public.save_manager_board('${BOARD}', 'Моё');`, /Only the owner of board/);
refused('nor archives it', `${as(INA)} select public.set_manager_board_archived('${BOARD}', true);`, /Only the owner of board/);
refused('a cleaner writes nothing', `${as(OLGA)} select public.move_manager_card('${CARD}', 'open');`, /Only a manager may do this/);
refused('nor a manager switched off', `${as(DORA)} select public.move_manager_card('${CARD}', 'open');`, /Only a manager may do this/);
check('nothing reached the work log',
  count(`select (select count(*) from public.task_events e join public.tasks t on t.id = e.task_id where t.host_id = '${HOST}') + (select count(*) from public.problem_events e join public.problems p on p.id = e.problem_id where p.host_id = '${HOST}');`), '0');

// ---------- 5. the rollback ----------
must("the migration's rollback", file(UNDO));
must('migration repair --status reverted 20261119090000', repair(MIGRATION));
expectProbe('back to what the cloud read before', BEFORE);
refused('Ina, no longer the assignee, is refused again', `${as(MILA)} select public.set_manager_card_assignee('${CARD}', '${MILA}'); ${as(INA)} select public.move_manager_card('${CARD}', 'resolved');`, /Only the owner of board/);
check('what she made stays: three cards, her comment', count(`select (select count(*) from public.manager_board_cards where board_id = '${BOARD}') || ' ' || (select count(*) from public.manager_board_entries where kind = 'comment' and author_id = '${INA}');`), '3 1');
must('a second push', push(MIGRATION), ['--single-transaction']);
if (AFTER !== null) expectProbe('and the probe reads AFTER again', AFTER);

console.log(failures === 0 ? '\nREHEARSAL GREEN' : `\nREHEARSAL RED: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
