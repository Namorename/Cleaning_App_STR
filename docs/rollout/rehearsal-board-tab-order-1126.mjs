// Rehearsal of the rollout of a person's own order of the board tabs
// (docs/rollout/board-tab-order-1126.md) and of its rollback, on throwaway databases inside the local
// Supabase container (docs/rollout/rehearsal-db-1030.mjs): the stand's own database is never written.
//
//   node docs/rollout/rehearsal-board-tab-order-1126.mjs
//
// 1. A database at the cloud's head (20261126150000); its probe is the cloud's of 2026-11-26.
// 2. Data shaped as an office's: a company, two managers, a board.
// 3. 20261126160000 as db push applies it: the probe reads «after» (the local stand's probe); each
//    manager saves her order through save_board_tab_order as herself; the two orders are apart.
// 4. The rollback: the probe reads «before» again, the company's rows are untouched; run twice, the
//    second run says there is nothing to undo.
// 5. The migration again: the probe reads the first «after».
// 6. Every SQL suite against that database — every migration of the tree.
// The database is dropped at the end. Exit code 0 is GREEN.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DB = 'rehearsal_t1126';
const TOOL = 'docs/rollout/rehearsal-db-1030.mjs';
const PROBE = 'docs/rollout/probe_board_tab_order_1126.sql';
const UNDO = 'docs/one-off-writes/board-tab-order-rollback.sql';
const VERSION = '20261126160000';
const NAME = 'board_tab_order';
const HOST = 'b7a11260-0000-4000-8000-00000000000a';
const ANNA = 'b7a11261-0000-4000-8000-000000000001';
const BORIS = 'b7a11262-0000-4000-8000-000000000002';
const BOARD = 'b7a11263-0000-4000-8000-000000000003';

// The cloud's probe, 2026-11-26 (node scripts/cloud-read.mjs docs/rollout/probe_board_tab_order_1126.sql).
const CLOUD_BEFORE = {
  head: '20261126150000',
  table_grants: '-',
  rls: null,
  policies: null,
  functions: null,
  constraints: 0,
};
// The probe of the local stand with the migration, 2026-11-26.
const AFTER = {
  head: '20261126160000',
  table_grants: 'authenticated:INSERT,authenticated:SELECT,authenticated:UPDATE',
  rls: true,
  policies:
    'person adds own board tab order a 6fcc408687c63c2b33a0e3c05fe6aa44; ' +
    'person changes own board tab order w 0784a42848d580c8e62aeab8609bbf97; ' +
    'person reads own board tab order r 4e01f9f20119e3f517e0f4aba6d8a814',
  functions:
    'board_tab_ids_valid false 111c437fd852086d1f52bd67cb1e6f89 authenticated; ' +
    'save_board_tab_order false 0684f73b2e5f48a50c3ccd3968ad77d4 authenticated',
  constraints: 4,
};
const FIELDS = Object.keys(CLOUD_BEFORE);

const projectId = readFileSync('supabase/config.toml', 'utf8').match(
  /^project_id\s*=\s*"([^"]+)"/m,
);
const CONTAINER = `supabase_db_${projectId[1]}`;

let red = 0;
const say = (ok, what) => {
  if (!ok) red += 1;
  process.stdout.write(`${ok ? 'ok  ' : 'RED '} ${what}\n`);
};

function tool(...args) {
  const res = spawnSync('node', [TOOL, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (res.status !== 0) {
    process.stdout.write(`${res.stdout}${res.stderr}`);
    throw new Error(`${TOOL} ${args.join(' ')} failed`);
  }
  return res.stdout;
}

function psql(sql) {
  const res = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      CONTAINER,
      'psql',
      '-U',
      'postgres',
      '-d',
      DB,
      '-v',
      'ON_ERROR_STOP=1',
      '-q',
      '-X',
      '-A',
      '-t',
    ],
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
  const query = readFileSync(PROBE, 'utf8')
    .replace(/^--.*$/gm, '')
    .trim()
    .replace(/;$/, '');
  return JSON.parse(must('probe', `select row_to_json(t) from (${query}) t;`));
}

const same = (left, right) =>
  FIELDS.every((key) => JSON.stringify(left?.[key]) === JSON.stringify(right?.[key]));
const differing = (left, right) =>
  FIELDS.filter((key) => JSON.stringify(left?.[key]) !== JSON.stringify(right?.[key])).join(', ');

const push =
  `${readFileSync(`supabase/migrations/${VERSION}_${NAME}.sql`, 'utf8')}\n` +
  `insert into supabase_migrations.schema_migrations (version, name) values ('${VERSION}', '${NAME}');`;
const undo =
  `${readFileSync(UNDO, 'utf8')}\n` +
  `delete from supabase_migrations.schema_migrations where version = '${VERSION}';`;

const SEED = `
insert into public.hosts (id, name) values ('${HOST}', 'Rehearsal company');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at,
                        raw_user_meta_data, raw_app_meta_data)
values ('${ANNA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'anna.rehearsal1126@test.local', 'x', now(), now(), '{"full_name": "Anna"}', '{"role": "manager"}'),
       ('${BORIS}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
        'boris.rehearsal1126@test.local', 'x', now(), now(), '{"full_name": "Boris"}', '{"role": "admin"}');
update public.profiles set host_id = '${HOST}' where id in ('${ANNA}', '${BORIS}');
insert into public.manager_boards (id, host_id, title, owner_id, shared)
values ('${BOARD}', '${HOST}', 'Board one', '${ANNA}', true);
`;
const COMPANY = `select json_build_object(
  'profiles', (select count(*) from public.profiles where host_id = '${HOST}'),
  'boards', (select count(*) from public.manager_boards where host_id = '${HOST}'))::text;`;

// The claims are set in a block, so the only rows printed are the statement's own.
const asPerson = (id, sql) => `begin;
set local role authenticated;
do $$ begin perform set_config('request.jwt.claims', '{"sub": "${id}", "role": "authenticated"}', true); end $$;
${sql}
commit;`;

try {
  // ---------- 1. the cloud's head ----------
  tool(DB, 'drop');
  tool(DB, 'create', '--until', '20261126150000');
  const before = probe();
  say(same(before, CLOUD_BEFORE), `before = the cloud's probe ${differing(before, CLOUD_BEFORE)}`);

  // ---------- 2. an office ----------
  must('seed', SEED);
  const company = must('company', COMPANY);

  // ---------- 3. the migration ----------
  must('push', push);
  const after = probe();
  say(same(after, AFTER), `pushed = the stand's probe ${differing(after, AFTER)}`);
  must(
    'anna saves',
    asPerson(ANNA, `select public.save_board_tab_order(array['${BOARD}', 'mine', 'tech']);`),
  );
  must(
    'boris saves',
    asPerson(BORIS, `select public.save_board_tab_order(array['tech', 'mine']);`),
  );
  say(
    must(
      'anna reads',
      asPerson(
        ANNA,
        "select string_agg(array_to_string(tab_ids, ','), ';') from public.board_tab_orders;",
      ),
    ) === `${BOARD},mine,tech`,
    'each person reads her own order, and only hers',
  );
  say(
    must(
      'boris reads',
      asPerson(
        BORIS,
        "select string_agg(array_to_string(tab_ids, ','), ';') from public.board_tab_orders;",
      ),
    ) === 'tech,mine',
    "the other person's order is apart",
  );

  // ---------- 4. the rollback ----------
  must('undo', undo);
  const undone = probe();
  say(same(undone, before), `rolled back = before ${differing(undone, before)}`);
  say(must('company', COMPANY) === company, "the company's rows are untouched");
  const again = psql(undo);
  say(
    again.ok && /nothing to undo/.test(again.err + again.out),
    'a second rollback says there is nothing to undo',
  );

  // ---------- 5. the migration again ----------
  must('push again', push);
  say(same(probe(), after), 'pushed again = the first push');

  // ---------- 6. every suite ----------
  const suites = spawnSync('node', [TOOL, DB, 'suites'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const last = (suites.stdout ?? '').trim().split('\n').at(-1) ?? '';
  for (const line of (suites.stdout ?? '').split('\n').filter((l) => l.startsWith('RED'))) {
    process.stdout.write(`${line}\n`);
  }
  say(suites.status === 0, `all SQL suites on every migration: ${last}`);
} finally {
  tool(DB, 'drop');
}

process.stdout.write(red === 0 ? 'GREEN\n' : `RED: ${red}\n`);
process.exit(red === 0 ? 0 : 1);
