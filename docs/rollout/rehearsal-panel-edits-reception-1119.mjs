// Rehearsal of the rollout of the panel's edits and the reception (docs/panel-edits-reception-1119.md)
// and of its rollback, on the local database, inside one transaction that is rolled back:
//
//   node docs/rollout/rehearsal-panel-edits-reception-1119.mjs
//
// The local database carries every migration of this tree (db reset or migration up). In order:
// the rollback (docs/one-off-writes/panel-edits-reception-rollback.sql) and the migration repair —
// the probe must read the cloud's «before», but for the value 'reception' of app_role, which stays;
// the four migrations again as db push applies them — the probe must read «after». Then rollback:
// the database is left as it was.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const PROBE = 'docs/rollout/probe_panel_edits_reception.sql';
const UNDO = 'docs/one-off-writes/panel-edits-reception-rollback.sql';
const MIGRATIONS = [
  ['20261119140000', 'problem_edit_text'],
  ['20261119141000', 'guest_chats_switch'],
  ['20261119142000', 'reception_role'],
  ['20261119143000', 'reception_rights'],
];

// The cloud's answer, 2026-11-19 (node scripts/cloud-read.mjs docs/rollout/probe_panel_edits_reception.sql).
const BEFORE = {
  head: "20261119090000",
  functions: "chat_participates(4) 47e5fe4b775bf169e31f51b980e41ca7; chat_participates_as(5) 1b1df35b6cd8c49ac7682c68bc0fe1d5; chat_unread_threads(2) ae74cb673a7f8ee4bf3c728fd3d47a9e; delete_manager_comment(1) 2b426551e6518325329b387704fb522f; delete_manager_step(1) 3416f9597ed38dede98c1a85df73e4e7; guard_profile_privileges(0) 2c16d31166bb335b61cf739c4e34c11f; guest_message_target(3) a241bc1d9be2344d5c05adf58356e9a2; is_manager(0) 45802a43e38a7525ac7ce04d5c4f6f42; journal_cleaning_time(0) fc0a0f792af585f6c1f7357597b042b4; journal_task_change(0) 8f50ad75f63df50c1a6818049080f012; manager_board_for_cards(1) 7266518986f831606d6a92f8815e9e56; manager_board_for_edit(2) d889671504b15b4093f503a4bdd12145; manager_card_for_edit(2) 2c1f8efc3ec2e3f6e1c0c24bc5925710; manager_step_card(1) 755b5a8fb942f553ce7d7616abf70065; push_on_task_change(0) 07b1522ce83dba073739dc9db496d456; save_manager_board(2) 1c1152328c04ee39fbb296a19d70a488; save_manager_card(9) 222f56971dade92d90b0953133d01a11; save_manager_comment(3) 11e4bb00b5e7b5458fa11923a475e7c2; save_manager_step(3) 32cf8041e6be25575477f6dcbd71947a; set_manager_board_archived(2) 94bd11315badc02a55c8ba57e8621b24; stamp_problem_closing(0) d42c96a0ede90a00866fa3c0fa6b5f30; stamp_task_closing(0) e2c45681f7b1b45d39963cb6db93c1df; update_host_settings(5) 2a2f6665d5071cfa1e093a0eb4c8682d; update_signal_settings(10) 5802e4b33c200a90db3d39e015ce58f8",
  policies: "manager_board_cards.the office reads the company's board cards 8f6358038f506203353195c49c0f76e9; manager_board_entries.the office reads the company's board journals 8f6358038f506203353195c49c0f76e9; manager_board_steps.the office reads the company's board steps 8f6358038f506203353195c49c0f76e9; manager_boards.the office reads the company's boards 8f6358038f506203353195c49c0f76e9; profiles.managers manage profiles 0632e38ba43f06e7c770a5bea3c65dda; profiles.managers read all profiles bb8ef5c9f6b52380b36755c707093e85; profiles.read own profile b3158818130bc2650ee2c7bd09b38a45; profiles.update own profile a7e6bac74873af04f399dcc47fc2e90e",
  client_execute: null,
  roles: "cleaner,tech,head_tech,manager,admin",
  reception_people: 0,
};
// The probe after the four migrations, from the local database of 2026-11-19.
const AFTER = {
  head: "20261119143000",
  functions: "chat_participates(4) f4f05b18a34a524c8cf1a4b4bedb5380; chat_participates_as(5) 83185783696a876ee3c2bfd9f4bf30a4; chat_unread_threads(2) 361679982b20fb99ce5685f494ee949b; delete_manager_comment(1) 946a32cdf686a374baf4ab8c8a7601c1; delete_manager_step(1) 8f50ec8fbb2d28b3f82cf2335fb767d1; edit_problem_text(3) f0c70021734704e27ea9fd0f0d0a3e6b; guard_profile_privileges(0) c9a9c3535ef159860dc418fdd205bb7a; guest_message_target(3) f9ce74a24ca6c3337108237eaa756987; is_full_manager(0) 45802a43e38a7525ac7ce04d5c4f6f42; is_manager(0) 3400e7b83a0273a86cf0e09005e02057; journal_cleaning_time(0) f0c47f31fbb6c37bfe73deea2eac6e28; journal_task_change(0) 3c4c851e8a4b5e7bc0dc75f3b1f6ed64; manager_board_for_cards(1) 4812bfe6a97795395039d09a1d2bd3ed; manager_board_for_edit(2) cc05857f46eb9c6f1ac7d2fa6a1115f1; manager_card_for_edit(2) def11495dcb39354ff2a37d2fec846c7; manager_step_card(1) eb2648d3294371c696be7246cc1bee84; push_on_task_change(0) 0226582e43eee71f34b0f5851a3cb338; reset_guest_chat_reading(2) de3d39ee701fb772cfec9c3b156b2ec2; save_manager_board(2) 96324684500c7db63cd5500369f14f40; save_manager_card(9) 08b0443313fe16702a8ab90706822abc; save_manager_comment(3) e7cbb22df2a3db1f10e16c068b0ba8dc; save_manager_step(3) cd28ba7aed2bc7846558527bb8e1279c; set_guest_chats(1) 7b3e88d0174d5e90c5c54bdb0887901f; set_manager_board_archived(2) fb11d1b7b4b88b22191de0f5c486cab0; stamp_problem_closing(0) 20a94f7270f59c9a868d1a51d42363f6; stamp_task_closing(0) 1db48d00d15f54b1130b55e693c482d7; update_host_settings(5) 899fc30f0e2960c8548be69b5c72a25f; update_signal_settings(10) e7326fce9d15abb62bfabd78c58af107",
  policies: "manager_board_cards.the office reads the company's board cards 4494945042e3f4bc5b9e26beabe14c45; manager_board_entries.the office reads the company's board journals 4494945042e3f4bc5b9e26beabe14c45; manager_board_steps.the office reads the company's board steps 4494945042e3f4bc5b9e26beabe14c45; manager_boards.the office reads the company's boards 4494945042e3f4bc5b9e26beabe14c45; profiles.managers manage profiles 208e3fae3f8063aea4ef3c60cd6543c2; profiles.managers read all profiles bb8ef5c9f6b52380b36755c707093e85; profiles.read own profile b3158818130bc2650ee2c7bd09b38a45; profiles.update own profile a7e6bac74873af04f399dcc47fc2e90e",
  client_execute: "edit_problem_text:false/true/true, is_full_manager:false/true/true, reset_guest_chat_reading:false/false/false, set_guest_chats:false/true/true",
  roles: "cleaner,tech,head_tech,reception,manager,admin",
  reception_people: 0,
};

const projectId = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m);
const CONTAINER = `supabase_db_${projectId[1]}`;
const file = (path) => readFileSync(path, 'utf8');
const probeQuery = file(PROBE).replace(/^--.*$/gm, '').trim().replace(/;$/, '');
const probe = (marker) => `select '${marker}' || row_to_json(t)::text from (${probeQuery}) t;`;
const undo = file(UNDO).replace(/^begin;$/m, '').replace(/^commit;$/m, '');
const push = MIGRATIONS.map(
  ([version, name]) =>
    `${file(`supabase/migrations/${version}_${name}.sql`)}\n` +
    `insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}');`,
).join('\n');
const versions = MIGRATIONS.map(([version]) => `'${version}'`).join(', ');
const repair = `delete from supabase_migrations.schema_migrations where version in (${versions});`;

const sql = ['begin;', undo, repair, probe('UNDONE'), push, probe('PUSHED'), 'rollback;'].join('\n');
const res = spawnSync(
  'docker',
  ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-At'],
  { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
if (res.status !== 0) {
  console.error(res.stderr);
  process.exit(1);
}
const read = (marker) =>
  JSON.parse(res.stdout.split('\n').find((line) => line.startsWith(marker)).slice(marker.length));

function compare(label, got, want, skip = []) {
  const keys = Object.keys(want).filter((key) => !skip.includes(key));
  const diff = keys.filter((key) => String(got[key]) !== String(want[key]));
  for (const key of diff) {
    console.log(`  DIFF ${key}\n    want: ${want[key]}\n    got:  ${got[key]}`);
  }
  console.log(`${diff.length === 0 ? 'ok  ' : 'FAIL'} ${label}`);
  return diff.length === 0;
}

const undone = read('UNDONE');
const pushed = read('PUSHED');
const results = [
  compare('the rollback reads the cloud before, but for the enum value', undone, BEFORE, ['roles']),
  compare('the role stays in app_role, held by nobody', undone, {
    roles: AFTER.roles,
    reception_people: 0,
  }),
  compare('the four migrations again read after', pushed, AFTER),
];
if (!results.every(Boolean)) {
  console.log('RED');
  process.exit(1);
}

// The same rollback through the channel the cloud's will take: `db query -f` takes one statement,
// and commits. Then the migrations again, as push applies them, and the probe reads «after».
// Stopped half way, the local database stays rolled back: `npx supabase migration up` brings it on.
function run(label, command, args, input) {
  const out = spawnSync(command, args, { input, encoding: 'utf8', shell: process.platform === 'win32' });
  if (out.status !== 0) {
    console.error(`${label}:\n${out.stderr}\n${out.stdout}`);
    process.exit(1);
  }
  return out.stdout;
}
const psql = ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-At'];
run('db query --local -f', 'npx', ['supabase', 'db', 'query', '--local', '-f', UNDO]);
run('repair', 'docker', psql, repair);
const cliUndone = JSON.parse(run('probe', 'docker', psql, probe('').replace("select '' || ", 'select ')));
run('push again', 'docker', psql, push);
const cliPushed = JSON.parse(run('probe', 'docker', psql, probe('').replace("select '' || ", 'select ')));
const cli = [
  compare('through db query -f, the rollback reads the cloud before', cliUndone, BEFORE, ['roles']),
  compare('and the migrations again read after', cliPushed, AFTER),
];
const green = cli.every(Boolean);
console.log(green ? 'GREEN' : 'RED');
process.exit(green ? 0 : 1);
