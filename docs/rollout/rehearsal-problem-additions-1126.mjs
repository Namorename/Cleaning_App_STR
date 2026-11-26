// Rehearsal of the rollout of the office's additions (docs/problem-additions-1126.md) and of its
// rollback, on the local database, inside one transaction that is rolled back:
//
//   node docs/rollout/rehearsal-problem-additions-1126.mjs
//
// The local database carries every migration of this tree (db reset). In order, all in one
// transaction:
//   1. the rollback (docs/one-off-writes/problem-additions-rollback.sql) with no batch written yet
//      and the migration repair — the probe must read the cloud's «before» in every schema field;
//   2. the migration again as db push applies it — the probe must read «after»;
//   3. a batch written, the rollback again — the client levers and the closing's arguments go, the
//      table, the column and the sweep stay (its files keep their owner), resolve_problem is the
//      cloud's of before;
// then rollback: the database is left as it was. Exit code 0 is GREEN.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const PROBE = 'docs/rollout/probe_problem_additions_1126.sql';
const UNDO = 'docs/one-off-writes/problem-additions-rollback.sql';
const MIGRATION = ['20261126100000', 'problem_additions'];

// The cloud's answer, 2026-11-26 (node scripts/cloud-read.mjs ${PROBE}), schema fields.
const BEFORE = {
  "head": "20261119143000",
  "functions": "can_read_task_media(1) 3a8610b5467bd99d5cc09e1f135ddc89; can_upload_task_media(1) 7825f1d1919ac64ef3d5c103dcbd722b; confirm_task_media(1) 79e81e914be2ade9eb1b1a9f1ab70e99; mark_signal_false_positive(2) ca2e7913e03cca743f01dd5f2dadd0fe; remove_task_media(1) a0bc246c4416aff650ce5472676d5f76; resolve_problem(3) cb2070719826066c191ae63426fcdf26; send_message(6) 66d820ec8914a60f32b00a315dea6608; task_media_to_purge(1) 2cda15905c58c276b566f315f3ab883e",
  "client_execute": "resolve_problem(3):false/true",
  "policies": "task_media.assignee reads media of own tasks 3b25b63d3e44703f61b447c30af36be0; task_media.chat message media is read by whoever reads the message 04e15f3a34594f5733897422ef74c311; task_media.head tech reads media of repairs f226a029b9f942f9d1416b73a97a1344; task_media.managers read all task media a93eb6482f7cec454f94f4df015be230; task_media.problem media is read by whoever reads the problem 8a5c3fc6cb7541c6cdd6758fb7f2d9b0",
  "owner_check": "7fff751ffa46152fd722458edf2e8f8c",
  "addition_column": null,
  "additions_grants": null,
  "chat_triggers": "chat_messages_push,chat_messages_touch_thread"
};
// The probe after the migration, from the local database of 2026-11-26.
const AFTER = {
  "head": "20261126100000",
  "functions": "add_office_media(11) aa00963a045cee839583180e2471ec14; can_read_task_media(1) 3a8610b5467bd99d5cc09e1f135ddc89; can_upload_task_media(1) 7825f1d1919ac64ef3d5c103dcbd722b; confirm_task_media(1) 79e81e914be2ade9eb1b1a9f1ab70e99; journal_office_comment(0) 25c23a420c5da430a7280dd4e2f0f76a; mark_signal_false_positive(2) bd2432c4040a3af61d9bbc1bb517b53f; problem_addition_max_files(0) 68c02e318f650f5efb78cbfa1c972995; problem_closing_addition(4) 2ef653d7cc44ae353d2c5dfc2c5277cf; publish_office_media(1) 7aa754563708a4afa71a5648611afc95; publish_problem_addition(3) 73a2bc14f73096de1a3c255781f8ff58; remove_task_media(1) c8facf74a23b86ce5daa6befec97285a; resolve_problem(6) 740c8e036526c25e472e0a1401a7f43e; send_message(6) 66d820ec8914a60f32b00a315dea6608; task_media_to_purge(1) 10b7eaf4750b208b0d2d43f470306f14",
  "client_execute": "add_office_media(11):false/true, journal_office_comment(0):false/false, problem_addition_max_files(0):false/true, problem_closing_addition(4):false/false, publish_office_media(1):false/true, publish_problem_addition(3):false/false, resolve_problem(6):false/true",
  "policies": "problem_additions.staff read additions of tasks they read a77fedf00a7c8ba40d5df78e3a4f73fb; task_media.addition media is read by whoever reads the addition 565f335603aada8bde7b2bb97457a343; task_media.assignee reads media of own tasks 3b25b63d3e44703f61b447c30af36be0; task_media.chat message media is read by whoever reads the message 04e15f3a34594f5733897422ef74c311; task_media.head tech reads media of repairs f226a029b9f942f9d1416b73a97a1344; task_media.managers read all task media a93eb6482f7cec454f94f4df015be230; task_media.problem media is read by whoever reads the problem 8a5c3fc6cb7541c6cdd6758fb7f2d9b0",
  "owner_check": "1a3a928f814af16058820b51eba5f154",
  "addition_column": "addition_id",
  "additions_grants": "authenticated:SELECT",
  "chat_triggers": "chat_messages_journal_office,chat_messages_push,chat_messages_touch_thread"
};
const SCHEMA = Object.keys(BEFORE);

const projectId = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m);
const CONTAINER = `supabase_db_${projectId[1]}`;
const file = (path) => readFileSync(path, 'utf8');
const probeQuery = file(PROBE).replace(/^--.*$/gm, '').trim().replace(/;$/, '');
const probe = (marker) => `select '${marker}' || row_to_json(t)::text from (${probeQuery}) t;`;
const undo = file(UNDO);
const [version, name] = MIGRATION;
const push =
  `${file(`supabase/migrations/${version}_${name}.sql`)}\n` +
  `insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}');`;
const repair = `delete from supabase_migrations.schema_migrations where version = '${version}';`;

// A batch of the office on a task of its own: written by postgres, as a manager's would be.
const batch = `insert into public.hosts (id, name) values ('00000000-0000-4000-8000-0000000001a0', 'Rehearsal');
insert into public.problems (id, host_id, title, source, source_facts)
  values ('00000000-0000-4000-8000-0000000001a1', '00000000-0000-4000-8000-0000000001a0', 'Rehearsal',
          'review', '{}');
insert into public.problem_additions (id, host_id, problem_id)
  values ('00000000-0000-4000-8000-0000000001a6', '00000000-0000-4000-8000-0000000001a0',
          '00000000-0000-4000-8000-0000000001a1');`;

const sql = [
  'begin;',
  undo,
  repair,
  probe('UNDONE'),
  push,
  probe('PUSHED'),
  batch,
  undo,
  probe('KEPT'),
  'rollback;',
].join('\n');
const res = spawnSync(
  'docker',
  ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-At'],
  { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
if (res.status !== 0) {
  process.stderr.write(res.stderr);
  process.stdout.write('RED: the rehearsal did not run through\n');
  process.exit(1);
}

const rows = Object.fromEntries(
  res.stdout
    .split('\n')
    .filter((line) => /^(UNDONE|PUSHED|KEPT)\{/.test(line))
    .map((line) => {
      const at = line.indexOf('{');
      return [line.slice(0, at), JSON.parse(line.slice(at))];
    }),
);

let red = 0;
const say = (ok, what) => {
  if (!ok) red += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'RED '} ${what}\n`);
};
for (const key of SCHEMA) {
  say(JSON.stringify(rows.UNDONE?.[key]) === JSON.stringify(BEFORE[key]), `undone = before: ${key}`);
}
for (const key of SCHEMA) {
  say(JSON.stringify(rows.PUSHED?.[key]) === JSON.stringify(AFTER[key]), `pushed = after: ${key}`);
}
const kept = rows.KEPT ?? {};
const resolveBefore = (BEFORE.functions ?? '').split('; ').find((part) => part.startsWith('resolve_problem('));
say((kept.functions ?? '').includes(resolveBefore ?? 'none'), 'kept: resolve_problem is the cloud\'s of before');
say(!/add_office_media|publish_office_media|journal_office_comment/.test(kept.functions ?? ''), 'kept: the client levers and the trigger are gone');
say(kept.chat_triggers === BEFORE.chat_triggers, 'kept: the chat triggers are the cloud\'s of before');
say(kept.addition_column === 'addition_id' && kept.owner_check === AFTER.owner_check, 'kept: the files keep their owner');
say(kept.additions_grants === AFTER.additions_grants, 'kept: the table and its grants stay');

process.stdout.write(red === 0 ? 'GREEN\n' : `RED: ${red}\n`);
process.exit(red === 0 ? 0 : 1);
