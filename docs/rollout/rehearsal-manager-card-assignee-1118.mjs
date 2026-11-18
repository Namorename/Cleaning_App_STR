// Rehearsal of the rollout of the boards' assignee (20261118230000), of its data script and of their
// rollbacks, in the order docs/rollout/manager-card-assignee-1118.md gives, on a throwaway database
// inside the local Supabase container, apart from the stand:
//
//   node docs/rollout/rehearsal-db-1028.mjs create                  # every migration of this tree
//   node docs/rollout/rehearsal-manager-card-assignee-1118.mjs
//   node docs/rollout/rehearsal-db-1028.mjs drop
//
// In order: the rollback back to the cloud's «before»; a board and a card made there, as in the
// cloud; the migration alone as db push applies it; the suites; the old clients' calls; the data
// script — the old card becomes its owner's, a second run writes nothing; an assignment with its
// journal line and its push; the assignee works on the card and not on the board; the data's undo;
// the migration's rollback back to «before»; a second push. Read-only towards the stand.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DB = 'rehearsal_1028';
const MIGRATION = {
  file: 'supabase/migrations/20261118230000_manager_card_assignee.sql',
  version: '20261118230000',
  name: 'manager_card_assignee',
};
const PROBE = 'docs/rollout/probe_manager_card_assignee.sql';
const DATA = 'docs/one-off-writes/manager-cards-owner-assignee.sql';
const DATA_UNDO = 'docs/one-off-writes/manager-cards-owner-assignee-rollback.sql';
const UNDO = 'docs/one-off-writes/manager-card-assignee-rollback.sql';
const HOST = 'b0a2ea00-0000-4000-8000-00000000000a';
const MILA = 'b0a2ea01-0000-4000-8000-000000000001'; // manager, the board's owner
const INA = 'b0a2ea02-0000-4000-8000-000000000002'; // another manager
const OLGA = 'b0a2ea03-0000-4000-8000-000000000003'; // cleaner
const BOARD = 'b0a2ea10-0000-4000-8000-000000000001';
const OLD_CARD = 'b0a2ea11-0000-4000-8000-000000000001'; // made before the migration
const NEW_CARD = 'b0a2ea11-0000-4000-8000-000000000002'; // made after it, by an old client
const UNTOUCHED = 'b0a2ea11-0000-4000-8000-000000000003'; // made before it, never assigned by a person

// The cloud's answer, 2026-11-18 21:40 UTC (node scripts/cloud-read.mjs docs/rollout/probe_manager_card_assignee.sql).
const BEFORE = {
  head: "20261118200000",
  applied: 138,
  assignee_column: null,
  journal_kinds: "CHECK ((kind = ANY (ARRAY['comment'::text, 'moved'::text, 'due_changed'::text, 'step_done'::text])))",
  push_kinds: "cleaning_new,cleaning_assigned,cleaning_unassigned,cleaning_cancelled,cleaning_moved,cleaning_window,cleaning_free,cleaning_declined,cleaning_interrupted,booking_cancelled_live,problem_new,chat_message,daily_digest",
  functions: "delete_manager_comment(1) 2b426551e6518325329b387704fb522f; delete_manager_step(1) 3416f9597ed38dede98c1a85df73e4e7; duplicate_manager_card(3) 909f93ad481b16c24c9332d0121f7362; manager_board_column(1) 51a8c80f5d28b6cca728dd7841105a4d; manager_board_for_edit(2) d889671504b15b4093f503a4bdd12145; manager_card_for_edit(2) 38f50be565214edc0495fba617a6ed83; manager_step_card(1) 755b5a8fb942f553ce7d7616abf70065; move_manager_card(2) 723afdf74ee7cd0ff4033f8a47818138; order_manager_steps(2) 11c0a417b3b40b1d16014cde65b8ad0e; save_manager_board(2) 1c1152328c04ee39fbb296a19d70a488; save_manager_card(9) 5ae77a48be21821ccbdfbb4b1b4f6efe; save_manager_comment(3) 11e4bb00b5e7b5458fa11923a475e7c2; save_manager_step(3) 32cf8041e6be25575477f6dcbd71947a; set_manager_board_archived(2) 94bd11315badc02a55c8ba57e8621b24; set_manager_card_state(2) 418ec55ee6987052df879864355d22dc; set_manager_step_done(2) 795ef857ed63da946946b15665c056fc",
  client_execute: "delete_manager_comment:authenticated, delete_manager_step:authenticated, duplicate_manager_card:authenticated, move_manager_card:authenticated, order_manager_steps:authenticated, save_manager_board:authenticated, save_manager_card:authenticated, save_manager_comment:authenticated, save_manager_step:authenticated, set_manager_board_archived:authenticated, set_manager_card_state:authenticated, set_manager_step_done:authenticated",
  push_functions: null,
  journal_triggers: null,
  titles_execute: null,
  client_grants: "manager_board_cards:authenticated:SELECT, manager_board_entries:authenticated:SELECT, manager_board_steps:authenticated:SELECT, manager_boards:authenticated:SELECT",
  task_statuses: "unassigned,assigned,accepted,in_progress,paused,blocked,done,cancelled,expired",
  problem_statuses: "open,assigned,in_progress,resolved,cancelled",
};
// The probe after the migration alone, from the rehearsal of 2026-11-18 (checked against the cloud after db push).
const AFTER = {
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

const assignee = (card) =>
  `${asServer} select coalesce((select p.full_name from public.manager_board_cards c left join public.profiles p on p.id = c.assignee_id where c.id = '${card}'), '?');`;

// ---------- 0. the tree ----------
check('the throwaway database carries the new migration', 'select max(version) from supabase_migrations.schema_migrations;', MIGRATION.version);

// ---------- 1. back to the cloud's «before», with a card made there ----------
must("the migration's rollback", file(UNDO));
must('migration repair --status reverted 20261118230000', repair(MIGRATION));
// A value of an enum cannot be dropped: after a rollback board_card_assigned stays, and a send-push
// of before sets such a row aside as skipped. Everything else reads as the cloud read before.
const ROLLED_BACK = {
  ...BEFORE,
  push_kinds: BEFORE.push_kinds.replace('problem_new', 'board_card_assigned,problem_new'),
};
expectProbe('after the rollback the probe reads what the cloud read before, the push kind aside', ROLLED_BACK);
must('a company: two managers and a cleaner', `${asServer}
insert into public.hosts (id, name) values ('${HOST}', 'Assignee rehearsal');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_user_meta_data, raw_app_meta_data)
values ('${MILA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mila.assignee1118@rehearsal.local', 'x', now(), now(), '{"full_name":"Mila"}', '{"role":"manager"}'),
       ('${INA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ina.assignee1118@rehearsal.local', 'x', now(), now(), '{"full_name":"Ina"}', '{"role":"manager"}'),
       ('${OLGA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'olga.assignee1118@rehearsal.local', 'x', now(), now(), '{"full_name":"Olga"}', '{"role":"cleaner"}');
update public.profiles set host_id = '${HOST}' where id in ('${MILA}', '${INA}', '${OLGA}');`);
must('before the migration Mila makes a board and a card',
  `${as(MILA)} select public.save_manager_board('${BOARD}', 'Ремонт'); select public.save_manager_card('${OLD_CARD}', '${BOARD}', 'Ванная', '', null, null, 'blue', 'open', '["Плитка"]'); select public.save_manager_card('${UNTOUCHED}', '${BOARD}', 'Кухня', '', null, null, null, 'open');`);

// ---------- 2. the migration alone, as db push applies it ----------
must('the migration alone, in one transaction', push(MIGRATION), ['--single-transaction']);
if (AFTER === null) {
  console.log('AFTER (fill in):', JSON.stringify(probeFile(PROBE)));
} else {
  expectProbe('after it the probe reads AFTER', AFTER);
}
check('the old card has no assignee yet', assignee(OLD_CARD), '?');

// ---------- 3. the suites ----------
for (const suite of ['manager_card_assignee.sql', 'manager_boards.sql', 'table_grants.sql', 'retention_keeps_work.sql',
  'tenant_isolation.sql', 'rls_smoke.sql', 'api_v1.sql', 'push_events.sql', 'push_sender.sql', 'head_tech_push.sql',
  'cleaning_offs.sql']) {
  const res = psql(file(`supabase/tests/${suite}`), []);
  const all = res.out + res.err;
  const passed = (all.match(/NOTICE:\s+ok/g) ?? []).length;
  if (!res.ok || /ERROR:|FAIL/.test(all)) fail(`suite ${suite}`, (all.split('\n').find((line) => /ERROR:|FAIL/.test(line)) ?? '').trim());
  else console.log(`ok   suite ${suite}: ${passed} checks`);
}

// ---------- 4. the old clients, the data script, an assignment ----------
must("an old client makes a card as before (the first stage's shape)",
  `${as(MILA)} select public.save_manager_card('${NEW_CARD}', '${BOARD}', 'Звонок', '', null, null, null, 'open');`);
check("it is the owner's from the start", assignee(NEW_CARD), 'Mila');
must('and edits the old card as before', `${as(MILA)} select public.save_manager_card('${OLD_CARD}', '${BOARD}', 'Ванная', 'план', null, null, 'blue');`);
check('which stays without an assignee', assignee(OLD_CARD), '?');
const answered = (res) => res.out.split('\n').map((line) => line.trim()).filter((line) => /^[0-9a-f-]{36}$/.test(line)).sort();
const given = answered(must('the data script', `${asServer} ${file(DATA)}`));
if (JSON.stringify(given) !== JSON.stringify([OLD_CARD, UNTOUCHED].sort())) fail('the data script answers the ids it gave', JSON.stringify(given));
else console.log('ok   the data script answers the ids it gave');
check("the old card is its owner's", assignee(OLD_CARD), 'Mila');
check('without a journal line or a push',
  `${asServer} select (select count(*) from public.manager_board_entries where kind = 'assignee_changed') + (select count(*) from raw.push_outbox where host_id = '${HOST}');`, '0');
const again = answered(must('a second run of it', `${asServer} ${file(DATA)}`));
if (again.length !== 0) fail('a second run answers no ids', JSON.stringify(again));
else console.log('ok   a second run answers no ids');
check('changed nothing', `${asServer} select count(*) from public.manager_board_cards where board_id = '${BOARD}' and assignee_id = '${MILA}';`, '3');
must('Mila gives the old card to Ina', `${as(MILA)} select public.set_manager_card_assignee('${OLD_CARD}', '${INA}');`);
check("one journal line, one push to Ina with the card's id only",
  `${asServer} select (select string_agg(kind || ' ' || facts::text, ';') from public.manager_board_entries where card_id = '${OLD_CARD}' and kind = 'assignee_changed') || ' | ' || (select string_agg(kind::text || ' ' || params::text, ';') from raw.push_outbox where host_id = '${HOST}');`,
  `assignee_changed {"to": "${INA}", "from": "${MILA}"} | board_card_assigned {"card_id": "${OLD_CARD}"}`);
must('Ina moves it, ticks its step, writes',
  `${as(INA)} select public.move_manager_card('${OLD_CARD}', 'in_progress'); select public.set_manager_step_done(s.id, true) from public.manager_board_steps s where s.card_id = '${OLD_CARD}'; select public.save_manager_comment('b0a2ea12-0000-4000-8000-000000000001', '${OLD_CARD}', 'Плитку купила');`);
refused('Ina does not rename the board', `${as(INA)} select public.save_manager_board('${BOARD}', 'Моё');`, /Only the owner of board/);
refused("nor touches Mila's other card", `${as(INA)} select public.move_manager_card('${NEW_CARD}', 'resolved');`, /its assignee or an admin/);
refused('a cleaner assigns nothing', `${as(OLGA)} select public.set_manager_card_assignee('${OLD_CARD}', '${OLGA}');`, /Only a manager may do this/);
check('nothing reached the work log',
  `${asServer} select (select count(*) from public.task_events e join public.tasks t on t.id = e.task_id where t.host_id = '${HOST}') + (select count(*) from public.problem_events e join public.problems p on p.id = e.problem_id where p.host_id = '${HOST}');`, '0');

// ---------- 5. the data's undo, then the migration's rollback ----------
refused("the data's undo refuses without the ids", `${asServer} ${file(DATA_UNDO)}`, /Fill in c_ids/);
must('Mila takes the old card back', `${as(MILA)} select public.set_manager_card_assignee('${OLD_CARD}', '${MILA}');`);
must("the data's undo with the ids it answered",
  `${asServer} ${file(DATA_UNDO).replace('c_ids constant uuid[] := null;', `c_ids constant uuid[] := array['${given.join("', '")}']::uuid[];`)}`);
check("the untouched card is nobody's again; one a person gave, and one the server gave, keep theirs",
  `${asServer} select string_agg(coalesce(p.full_name, '?'), ',' order by c.id) from public.manager_board_cards c left join public.profiles p on p.id = c.assignee_id where c.board_id = '${BOARD}';`, 'Mila,Mila,?');
must("the migration's rollback", file(UNDO));
must('migration repair --status reverted 20261118230000', repair(MIGRATION));
expectProbe('back to what the cloud read before, the push kind aside', ROLLED_BACK);
check('the cards, steps and comments are all there',
  `${asServer} select (select count(*) from public.manager_board_cards where board_id = '${BOARD}') || ' ' || (select count(*) from public.manager_board_entries e join public.manager_board_cards c on c.id = e.card_id where c.board_id = '${BOARD}' and e.kind = 'comment');`, '3 1');
must('a second push', push(MIGRATION), ['--single-transaction']);
if (AFTER !== null) expectProbe('and the probe reads AFTER again', AFTER);

console.log(failures === 0 ? '\nREHEARSAL GREEN' : `\nREHEARSAL RED: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
