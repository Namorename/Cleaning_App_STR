// Rehearsal of the rollout of 2026-11-26 (docs/rollout/boards-dates-chats-1126.md) on a throwaway
// database inside the local Supabase container (docs/rollout/rehearsal-db-1030.mjs): the stand's
// own database is never written.
//
//   node docs/rollout/rehearsal-boards-dates-chats-1126.mjs
//
// 1. A database at the cloud's head (20261126100000); its probe is the cloud's of 2026-11-26 in
//    every schema field.
// 2. Synthetic data shaped as the cloud's: the company, its two boards (one archived) with cards in
//    all four columns, 186 cards from chats (178 to delete in three statuses, 8 a task stands on),
//    23 verdicts on cards to delete, cards from reviews.
// 3. 20261126120000 as db push applies it: every card bound to its board's column of its key; its
//    rollback: the probe reads «before» again (the push kind stays: Postgres keeps an enum value);
//    the push again: the probe reads the first «after».
// 4. 20261126130000 the same way.
// 5. The one-off writes and their undos: the boards closed, shared again, closed; chats off; the
//    backup; the delete (178 gone; tasks, reviews, verdicts kept); the restore (186 back, the
//    verdicts linked again); the delete once more.
// 6. A second throwaway database with every migration of the tree: all SQL suites.
// Both databases are dropped at the end. Exit code 0 is GREEN.

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DB = 'rehearsal_b1126';
const SUITES_DB = 'rehearsal_b1126s';
const TOOL = 'docs/rollout/rehearsal-db-1030.mjs';
const PROBE = 'docs/rollout/probe_boards_dates_1126.sql';
const HOST = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a';
const BOARDS = ['46c61e02-833b-46de-b641-e77eeb8bef20', '75481ee1-4982-4ed6-acd6-44e6cf4cb2a8'];

// The cloud's probe, 2026-11-26 (node scripts/cloud-read.mjs docs/rollout/probe_boards_dates_1126.sql).
const CLOUD_BEFORE = JSON.parse(
  readFileSync(new URL('./probe_boards_dates_1126.before.json', import.meta.url), 'utf8'),
)[0];
const SCHEMA = ['functions', 'client_execute', 'policies', 'new_columns', 'new_table_grants', 'board_triggers'];

const projectId = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m);
const CONTAINER = `supabase_db_${projectId[1]}`;

let red = 0;
const say = (ok, what) => {
  if (!ok) red += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'RED '} ${what}\n`);
};

function tool(...args) {
  const res = spawnSync('node', [TOOL, ...args], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (res.status !== 0) {
    process.stdout.write(`${res.stdout}${res.stderr}`);
    throw new Error(`${TOOL} ${args.join(' ')} failed`);
  }
  return res.stdout;
}

function psql(sql, database = DB) {
  const res = spawnSync(
    'docker',
    ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-X', '-A', '-t'],
    { input: sql, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
  );
  return { ok: res.status === 0, out: res.stdout ?? '', err: res.stderr ?? '' };
}

function must(label, sql) {
  const res = psql(sql);
  if (!res.ok) {
    process.stdout.write(`${res.out}${res.err}`);
    throw new Error(`FAILED: ${label}`);
  }
  return res.out.trim();
}

function probe() {
  const query = readFileSync(PROBE, 'utf8').replace(/^--.*$/gm, '').trim();
  return JSON.parse(must('probe', `select row_to_json(t) from (${query}) t;`));
}

function same(left, right, fields) {
  return fields.every((key) => JSON.stringify(left?.[key]) === JSON.stringify(right?.[key]));
}

const file = (path) => readFileSync(path, 'utf8');
const migration = (version, name) =>
  `${file(`supabase/migrations/${version}_${name}.sql`)}\n` +
  `insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}');`;
const repair = (version) => `delete from supabase_migrations.schema_migrations where version = '${version}';`;
const keysQuery =
  'select json_object_agg(k, n) from (select column_key k, count(*) n from public.manager_board_cards group by 1 order by 1) x;';

const SEED = `
insert into public.hosts (id, name) values ('${HOST}', 'Rehearsal company');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at,
                        raw_user_meta_data, raw_app_meta_data)
values ('b1126000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated',
        'authenticated', 'owner.rehearsal1126@test.local', 'x', now(), now(),
        '{"full_name": "Owner"}', '{"role": "admin"}');
update public.profiles set host_id = '${HOST}' where id = 'b1126000-0000-4000-8000-000000000001';
insert into public.manager_boards (id, host_id, title, owner_id, archived_at, created_at)
values ('${BOARDS[0]}', '${HOST}', 'Board one', 'b1126000-0000-4000-8000-000000000001', null, now() - interval '8 days'),
       ('${BOARDS[1]}', '${HOST}', 'Board two', 'b1126000-0000-4000-8000-000000000001', now(), now() - interval '7 days');
insert into public.manager_board_cards (id, host_id, board_id, title, column_key, created_by)
select gen_random_uuid(), '${HOST}', (case when n % 5 = 0 then '${BOARDS[1]}' else '${BOARDS[0]}' end)::uuid,
       'Card ' || n, (array['open', 'assigned', 'in_progress', 'resolved'])[1 + n % 4],
       'b1126000-0000-4000-8000-000000000001'
from generate_series(1, 24) n;
insert into public.problems (id, host_id, title, reported_by)
select ('b1126300-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '${HOST}', 'Task ' || n,
       'b1126000-0000-4000-8000-000000000001'
from generate_series(1, 8) n;
insert into public.guest_signals (id, host_id, provider, kind, external_key, conversation_key, external_listing_id,
                                  channel, submitted_at, stay_exact, stay_phase)
select ('b1126100-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '${HOST}', 'hostaway',
       (case when n <= 186 then 'message' else 'review' end)::public.guest_signal_kind,
       md5('signal' || n) || md5('k' || n),
       case when n <= 186 then md5('conv' || n) || md5('c' || n) end, '900112001', 'airbnb',
       now() - interval '2 days', true, case when n <= 186 then 'stay' end
from generate_series(1, 196) n;
insert into public.signal_findings (id, host_id, signal_id, kind, subject, summary, summary_i18n, detector,
                                    evidence_source, status, decided_mode, problem_id, decided_at, reject_reason)
select ('b1126200-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, '${HOST}',
       ('b1126100-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'repair', 'hot_water', 'hot_water', '{}',
       case when n <= 186 then 'claude-haiku-5-5@themes-v1-msg' else 'claude-haiku-5-5@themes-v1' end,
       case when n <= 186 then 'message' else 'public' end,
       (case when n <= 141 then 'candidate' when n <= 155 then 'already_fixed' when n <= 178 then 'rejected'
             when n <= 184 then 'task_created' when n <= 186 then 'duplicate' else 'candidate' end)::public.signal_finding_status,
       case when n between 142 and 186 then 'manager' end,
       case when n between 179 and 186 then ('b1126300-0000-4000-8000-' || lpad((n - 178)::text, 12, '0'))::uuid end,
       case when n between 142 and 186 then now() - interval '1 day' end,
       (case when n between 156 and 178 then 'not_worth' end)::public.signal_reject_reason
from generate_series(1, 196) n;
insert into public.signal_feedback (host_id, finding_id, provider, signal_kind, kind, subject, detector, verdict, decided_at)
select '${HOST}', ('b1126200-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, 'hostaway', 'message', 'repair',
       'hot_water', 'claude-haiku-5-5@themes-v1-msg', 'false_positive', now()
from generate_series(156, 178) n;
insert into public.signal_settings (host_id, kind, messages_enabled, tasks_enabled, messages_enabled_at)
values ('${HOST}', 'message', true, true, now() - interval '15 days') on conflict (host_id, kind)
do update set messages_enabled = true, tasks_enabled = true;
select cron.schedule('read-guest-messages', '*/2 * * * *', 'select 1');
select cron.schedule('read-guest-messages-0440', '40 4 * * *', 'select 1');
select cron.alter_job(j.jobid, active => true) from cron.job j where j.jobname like 'read-guest-messages%';
`;

const COUNT = `select json_build_object(
  'chat', (select count(*) from public.signal_findings f join public.guest_signals s on s.id = f.signal_id where s.kind = 'message'),
  'review', (select count(*) from public.signal_findings f join public.guest_signals s on s.id = f.signal_id where s.kind <> 'message'),
  'kept', (select count(*) from public.signal_findings f join public.guest_signals s on s.id = f.signal_id where s.kind = 'message' and f.problem_id is not null),
  'tasks', (select count(*) from public.problems where host_id = '${HOST}'),
  'feedback', (select count(*) from public.signal_feedback where host_id = '${HOST}'),
  'feedback_linked', (select count(*) from public.signal_feedback where host_id = '${HOST}' and finding_id is not null),
  'chats_on', (select messages_enabled from public.signal_settings where host_id = '${HOST}' and kind = 'message'),
  'jobs_on', (select count(*) from cron.job where jobname like 'read-guest-messages%' and active));`;

try {
  // ---------- 1. the cloud's head ----------
  tool(DB, 'drop');
  tool(DB, 'create', '--until', '20261126100000');
  const before = probe();
  say(before.head === '20261126100000', 'the database stands at the cloud head');
  for (const key of SCHEMA) {
    say(same(before, CLOUD_BEFORE, [key]), `before = the cloud's probe: ${key}`);
  }

  // ---------- 2. data shaped as the cloud's ----------
  must('seed', SEED);
  const keysBefore = must('keys', keysQuery);

  // ---------- 3. the boards' migration ----------
  must('push 120000', migration('20261126120000', 'board_columns'));
  const after1 = probe();
  say(after1.head === '20261126120000', 'pushed: head 20261126120000');
  say(
    must('bound', `select bool_and(c.column_id is not null and col.board_id = c.board_id and col.legacy_key = c.column_key)::text
                   from public.manager_board_cards c join public.manager_board_columns col on col.id = c.column_id;`) === 'true',
    "every card bound to its board's column of its key",
  );
  say(must('keys after', keysQuery) === keysBefore, 'no card lost or moved (cards by key as before)');
  say(must('columns', 'select count(*)::text from public.manager_board_columns;') === '8', 'four columns a board');
  say(must('shared', 'select string_agg(shared::text, \',\') from public.manager_boards;') === 'true,true',
      'the boards stay shared until the one-off write');
  must('undo 120000', `${file('docs/one-off-writes/board-columns-rollback.sql')}\n${repair('20261126120000')}`);
  const undone1 = probe();
  for (const key of SCHEMA) {
    say(same(undone1, before, [key]), `rolled back = before: ${key}`);
  }
  say(must('keys undone', keysQuery) === keysBefore, 'rolled back: the cards keep their keys');
  must('push 120000 again', migration('20261126120000', 'board_columns'));
  say(same(probe(), after1, SCHEMA), 'pushed again = the first push');

  // ---------- 4. the planned day ----------
  must('push 130000', migration('20261126130000', 'problem_due_date'));
  const after2 = probe();
  say(after2.head === '20261126130000', 'pushed: head 20261126130000');
  must('undo 130000', `${file('docs/one-off-writes/problem-due-date-rollback.sql')}\n${repair('20261126130000')}`);
  say(same(probe(), after1, SCHEMA), "rolled back = after the boards' push");
  must('push 130000 again', migration('20261126130000', 'problem_due_date'));
  say(same(probe(), after2, SCHEMA), 'pushed again = the first push');

  // ---------- 5. the one-off writes ----------
  must('boards private', file('docs/one-off-writes/manager-boards-private.sql'));
  say(must('closed', 'select string_agg(shared::text, \',\') from public.manager_boards;') === 'false,false',
      "both boards their owner's alone");
  must('boards shared', file('docs/one-off-writes/manager-boards-private-rollback.sql'));
  say(must('shared', 'select string_agg(shared::text, \',\') from public.manager_boards;') === 'true,true',
      'undone: shared again');
  must('boards private again', file('docs/one-off-writes/manager-boards-private.sql'));
  say(!psql(file('docs/one-off-writes/manager-boards-private.sql')).ok, 'a second run stops: they are no longer shared');

  const start = JSON.parse(must('count', COUNT));
  say(start.chat === 186 && start.kept === 8 && start.review === 10,
      'seeded: 186 cards from chats, 8 a task stands on, 10 from reviews');
  say(!psql(file('docs/one-off-writes/wagner-chat-cards-delete.sql')).ok, 'the delete refuses while chats are on');
  must('chats off', file('docs/one-off-writes/wagner-chats-off.sql'));
  const off = JSON.parse(must('count', COUNT));
  say(off.chats_on === false && off.jobs_on === 0, 'chats off, the reading jobs off');

  const backupRow = JSON.parse(must('backup', file('docs/one-off-writes/wagner-chat-cards-backup.sql')));
  const dir = mkdtempSync(join(tmpdir(), 'rehearsal-chat-cards-'));
  const backupPath = join(dir, 'backup.json');
  writeFileSync(backupPath, JSON.stringify([{ backup: backupRow }]));
  say(backupRow.count === 178 && backupRow.feedback.length === 23, 'the backup holds 178 cards and 23 verdicts');

  must('delete', file('docs/one-off-writes/wagner-chat-cards-delete.sql'));
  const gone = JSON.parse(must('count', COUNT));
  say(gone.chat === 8 && gone.kept === 8, 'deleted: 178 gone, the 8 a task stands on kept');
  say(gone.review === 10 && gone.tasks === 8, 'the cards from reviews and the tasks untouched');
  say(gone.feedback === 23 && gone.feedback_linked === 0, 'the verdicts stay, unlinked');

  const restorePath = join(dir, 'restore.sql');
  const made = spawnSync('node', ['docs/one-off-writes/wagner-chat-cards-restore.mjs', backupPath, restorePath], {
    encoding: 'utf8',
  });
  say(made.status === 0, `the restore statement is written (${(made.stdout || made.stderr).trim()})`);
  must('restore', file(restorePath));
  const back = JSON.parse(must('count', COUNT));
  say(back.chat === 186 && back.feedback_linked === 23, 'restored: 186 cards, the verdicts linked again');
  must('restore twice', file(restorePath));
  say(JSON.parse(must('count', COUNT)).chat === 186, 'a second restore changes nothing');
  must('delete again', file('docs/one-off-writes/wagner-chat-cards-delete.sql'));
  say(JSON.parse(must('count', COUNT)).chat === 8, 'deleted again after the restore');

  // ---------- 6. every SQL suite on every migration ----------
  tool(DB, 'drop');
  tool(SUITES_DB, 'drop');
  tool(SUITES_DB, 'create');
  const suites = spawnSync('node', [TOOL, SUITES_DB, 'suites'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const last = (suites.stdout ?? '').trim().split('\n').at(-1) ?? '';
  for (const line of (suites.stdout ?? '').split('\n').filter((l) => l.startsWith('RED'))) {
    process.stdout.write(`     ${line}\n`);
  }
  say(suites.status === 0, `all SQL suites on every migration: ${last}`);
} catch (error) {
  red += 1;
  process.stdout.write(`RED  ${error instanceof Error ? error.message : String(error)}\n`);
} finally {
  tool(DB, 'drop');
  tool(SUITES_DB, 'drop');
}

process.stdout.write(red === 0 ? 'GREEN\n' : `RED: ${red}\n`);
process.exit(red === 0 ? 0 : 1);
