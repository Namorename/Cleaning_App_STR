// Rehearsal of the catalogue's rollout and of both rollbacks (docs/rollout/wagner-problem-catalog-1114.md
// §Репетиция) on a throwaway database inside the local Supabase container, apart from the stand:
//
//   node docs/rollout/rehearsal-db-1028.mjs create                  # every migration of this tree
//   node docs/rollout/rehearsal-problem-categories-1114.mjs
//   node docs/rollout/rehearsal-db-1028.mjs drop
//
// The throwaway database is built from scratch with every migration of this tree, the new one
// included. From there, in order:
//   1. the core rollback must leave exactly what the cloud showed before (the probe of 01:39 UTC
//      2026-11-15, CLOUD_BEFORE), and the version row goes as `migration repair --status reverted`
//      would take it;
//   2. on that cloud-like state an old phone files two tasks; then the migration is applied in one
//      transaction as `db push` applies it, and the probe must read AFTER; the old tasks are untouched;
//   3. the suites of the catalogue, the grants matrix, the tasks and the API, against it;
//   4. the client's data: loaded once (27), refused a second time; the switch on; a cleaner of the
//      company reads the catalogue and files tasks with and without a category;
//   5. the rollback of the client (switch off, categories deleted or archived), then the core
//      rollback again, back to CLOUD_BEFORE; and a second push after it.
// Read-only towards the stand: its database (`postgres`) is never touched.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DB = 'rehearsal_1028';
const MIGRATION = 'supabase/migrations/20261115100000_problem_categories.sql';
const VERSION = '20261115100000';
const WAGNER = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a';
const VERA = 'f1149001-0000-4000-8000-000000000001';
const HUGO = 'f1149002-0000-4000-8000-000000000002';
const WIFI = '2ca940fd-288f-43f5-a6df-93145e10cd67';
const TAPS = '7bed8f05-ae67-43c3-82d5-01bf1b4a26c6';

const OLD_FUNCTIONS =
  'report_problem(uuid,text,text,problem_priority,bigint,uuid) e784ff29e45d88711ff3e3c86bb137be; ' +
  'update_problem(uuid,text,text,problem_priority) ccb9c738ec64849bfc33798f8ad57592';
const NEW_FUNCTIONS =
  'problem_category_for_report(uuid) 4c19b6d036bf5fd0a04bc28f969568a7; ' +
  'report_problem(uuid,text,text,problem_priority,bigint,uuid,uuid) 38cd7fc3930a8ad9a52f3b9b55cfd05e; ' +
  'update_problem(uuid,text,text,problem_priority,uuid) 5b4e08cf15fceda10ed5d53fefd48b26';

// The cloud's answer to docs/rollout/probe_problem_categories.sql, 2026-11-15 01:39 UTC.
const CLOUD_BEFORE = {
  head: '20261111140000',
  applied: 132,
  functions: OLD_FUNCTIONS,
  client_execute: 'report_problem:authenticated, update_problem:authenticated',
  columns: null,
  catalogue_table: false,
  catalogue_client_grants: null,
  catalogue_rls: null,
  catalogue_policies: null,
};
const AFTER = {
  head: VERSION,
  applied: 133,
  functions: NEW_FUNCTIONS,
  client_execute: 'report_problem:authenticated, update_problem:authenticated',
  columns: 'hosts.problem_report_mode, problems.category_id',
  catalogue_table: true,
  catalogue_client_grants: 'authenticated:SELECT',
  catalogue_rls: true,
  catalogue_policies: 'staff read the categories',
};

const projectId = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m);
if (!projectId) {
  console.error('no project_id in supabase/config.toml');
  process.exit(1);
}
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

/** The last line a statement prints, compared as text. */
function check(label, sql, want) {
  const res = psql(sql);
  const got = res.ok ? res.out.trim().split('\n').at(-1) ?? '' : `ERROR ${res.err.trim().split('\n')[0]}`;
  if (got !== String(want)) {
    fail(label, `got ${got}, want ${want}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

function mustRefuse(label, sql, pattern) {
  const res = psql(sql);
  if (res.ok || !pattern.test(res.err)) {
    fail(label, res.ok ? 'it ran' : res.err.trim().split('\n')[0]);
  } else {
    console.log(`ok   ${label}`);
  }
}

function probeFile(path) {
  const body = readFileSync(path, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*--/.test(line))
    .join('\n')
    .replace(/;\s*$/, '');
  const res = psql(`select row_to_json(x) from (${body}) x;`);
  if (!res.ok) {
    console.error(`probe ${path} failed\n${res.err}`);
    process.exit(1);
  }
  return JSON.parse(res.out.trim());
}

function expectProbe(label, want) {
  const got = probeFile('docs/rollout/probe_problem_categories.sql');
  const wrong = Object.keys(want).filter((key) => JSON.stringify(got[key]) !== JSON.stringify(want[key]));
  if (wrong.length > 0) {
    fail(label, wrong.map((key) => `${key}: got ${JSON.stringify(got[key])}, want ${JSON.stringify(want[key])}`).join('\n     '));
  } else {
    console.log(`ok   ${label}`);
  }
}

const asVera = `set role authenticated; set request.jwt.claims to '{"sub":"${VERA}","role":"authenticated"}';\n`;
const file = (path) => readFileSync(path, 'utf8');
const problem = (id, column) => `select ${column} from public.problems where id = '${id}';`;

// ---------- 0. the database is this tree's ----------
check('the throwaway database carries the new migration', 'select max(version) from supabase_migrations.schema_migrations;', VERSION);

// ---------- seed: the client's company with a cleaner, a head technician, a flat ----------
must('seed the client company', `
insert into public.hosts (id, name, default_language) values ('${WAGNER}', 'Primary host (rehearsal)', 'ru');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at,
                        raw_user_meta_data, raw_app_meta_data) values
  ('${VERA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'vera.rehearsal@test.local', 'x', now(), now(), '{"full_name":"Vera"}', '{"role":"cleaner"}'),
  ('${HUGO}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'hugo.rehearsal@test.local', 'x', now(), now(), '{"full_name":"Hugo"}', '{"role":"head_tech"}');
update public.profiles set host_id = '${WAGNER}' where id in ('${VERA}', '${HUGO}');
insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time)
  values (900003101, '${WAGNER}', 'Rehearsal flat', 'Europe/Prague', '15:00', '10:00');
insert into public.property_cleaners (host_id, property_id, cleaner_id, mode)
  values ('${WAGNER}', 900003101, '${VERA}', 'claim');
insert into public.push_tokens (token, profile_id, host_id, platform)
  values ('ExponentPushToken[rehearsal-hugo]', '${HUGO}', '${WAGNER}', 'android');
`);

// ---------- 1. the core rollback leaves the cloud's state ----------
must('core rollback (docs/one-off-writes/problem-categories-rollback.sql)', file('docs/one-off-writes/problem-categories-rollback.sql'));
must('migration repair --status reverted', `delete from supabase_migrations.schema_migrations where version = '${VERSION}';`);
expectProbe('after the core rollback the probe reads what the cloud read before', CLOUD_BEFORE);

// ---------- 2. an old phone files two tasks; the push ----------
must('an old phone files two tasks, by the six arguments', `${asVera}
select public.report_problem(p_id => 'f1149101-0000-4000-8000-000000000001', p_title => 'Течёт кран',
  p_priority => 'high', p_property_id => 900003101);
select public.report_problem(p_id => 'f1149101-0000-4000-8000-000000000002', p_title => 'Скрипит дверь',
  p_priority => 'normal', p_property_id => 900003101);`);
must('the migration, in one transaction, as db push applies it',
  `${file(MIGRATION)}\ninsert into supabase_migrations.schema_migrations (version, name) values ('${VERSION}', 'problem_categories');`,
  ['--single-transaction']);
expectProbe('after the push the probe reads AFTER', AFTER);
check('every company reports by free text after the push', `select count(*) from public.hosts where problem_report_mode <> 'free_text';`, 0);
check('the tasks filed before keep their titles, urgencies, no category',
  `select string_agg(title || '/' || priority || '/' || coalesce(category_id::text, '-'), ', ' order by title)
   from public.problems where id::text like 'f1149101-%';`,
  'Скрипит дверь/normal/-, Течёт кран/high/-');

// ---------- 3. the suites against it ----------
// The suites read the whole push queue (head_tech_push.sql: pg_temp.queued()) and expect it
// empty; the two tasks above queued Hugo's pushes.
must('the rehearsal\'s own pushes out of the queue', `delete from raw.push_outbox where recipient_id = '${HUGO}';`);
for (const suite of ['problem_categories.sql', 'table_grants.sql', 'problems.sql', 'api_v1.sql', 'head_tech_push.sql']) {
  const res = psql(file(`supabase/tests/${suite}`), []);
  const all = res.out + res.err;
  const passed = (all.match(/NOTICE:\s+ok/g) ?? []).length;
  if (!res.ok || /ERROR:|FAIL/.test(all)) {
    fail(`suite ${suite}`, (all.split('\n').find((line) => /ERROR:|FAIL/.test(line)) ?? '').trim());
  } else {
    console.log(`ok   suite ${suite}: ${passed} checks`);
  }
}

// ---------- 4. the client's data and switch ----------
must('the client catalogue (docs/one-off-writes/wagner-problem-categories.sql)', file('docs/one-off-writes/wagner-problem-categories.sql'));
const loaded = probeFile('docs/rollout/probe_wagner_problem_categories.sql');
console.log(`     probe: ${JSON.stringify(loaded)}`);
check('27 categories, live', `select count(*) from public.problem_categories where host_id = '${WAGNER}' and archived_at is null;`, 27);
check('P1 6, P2 7, P3 6, P4 8 by the owner\'s order',
  `select string_agg(n::text, ',' order by g) from (
     select case when sort_order <= 6 then 1 when sort_order <= 13 then 2 when sort_order <= 19 then 3 else 4 end as g,
            count(*) as n
     from public.problem_categories where host_id = '${WAGNER}' group by 1) x;`,
  '6,7,6,8');
check('variant A: high 13, normal 6, low 8', `select string_agg(priority || ' ' || n, ', ' order by priority) from (
     select priority::text, count(*) n from public.problem_categories where host_id = '${WAGNER}' group by 1) x;`,
  'high 13, low 8, normal 6');
mustRefuse('the load script refuses a second run', file('docs/one-off-writes/wagner-problem-categories.sql'), /runs once/);
must('the switch on (wagner-problem-report-mode-catalog.sql)', file('docs/one-off-writes/wagner-problem-report-mode-catalog.sql'));
check('the client reports by catalogue', `select problem_report_mode from public.hosts where id = '${WAGNER}';`, 'catalog');
check('every other company still by free text', `select count(*) from public.hosts where id <> '${WAGNER}' and problem_report_mode <> 'free_text';`, 0);

check('the cleaner reads the switch with her company', `${asVera} select problem_report_mode from public.hosts;`, 'catalog');
check('and the 27 categories', `${asVera} select count(*) from public.problem_categories where archived_at is null;`, 27);
must('she files Wi-Fi as low and Taps as high, and one typed task', `${asVera}
select public.report_problem('f1149101-0000-4000-8000-000000000003', 'Wi-Fi', 'Роутер мигает', 'low',
  900003101, null, '${WIFI}');
select public.report_problem('f1149101-0000-4000-8000-000000000004', 'Taps', null, 'high',
  900003101, null, '${TAPS}');
select public.report_problem(p_id => 'f1149101-0000-4000-8000-000000000005', p_title => 'Сломан стул',
  p_priority => 'low', p_property_id => 900003101);`);
check('the server files Wi-Fi as the catalogue says (variant A: high)', problem('f1149101-0000-4000-8000-000000000003', `title || '/' || priority`), 'Wi-Fi/high');
check('and Taps as normal, whatever the phone sent', problem('f1149101-0000-4000-8000-000000000004', `title || '/' || priority || '/' || (title_i18n ->> 'cs')`), 'Смесители/normal/Vodovodní baterie');
check('a task without a category is filed as before', problem('f1149101-0000-4000-8000-000000000005', `title || '/' || priority || '/' || coalesce(category_id::text, '-')`), 'Сломан стул/low/-');
check('the head technician is woken for Wi-Fi, not for Taps',
  `select string_agg((params ->> 'problem_id') || ':' || urgent, ', ' order by params ->> 'problem_id')
   from raw.push_outbox where kind = 'problem_new' and params ->> 'problem_id' in
     ('f1149101-0000-4000-8000-000000000003', 'f1149101-0000-4000-8000-000000000004');`,
  'f1149101-0000-4000-8000-000000000003:true, f1149101-0000-4000-8000-000000000004:false');

// ---------- 5. rolling back: the client, then the core ----------
mustRefuse('the data rollback refuses while the switch is on', file('docs/one-off-writes/wagner-problem-categories-rollback.sql'), /free-text/);
must('the switch off (wagner-problem-report-mode-free-text.sql)', file('docs/one-off-writes/wagner-problem-report-mode-free-text.sql'));
const undone = must('the client rollback (wagner-problem-categories-rollback.sql)', file('docs/one-off-writes/wagner-problem-categories-rollback.sql'));
console.log(`     ${(undone.out + undone.err).trim().split('\n').filter((line) => /deleted/.test(line)).join(' ')}`);
check('no live category of the client', `select count(*) from public.problem_categories where host_id = '${WAGNER}' and archived_at is null;`, 0);
check('the two a task points at are archived, the rest gone', `select count(*) from public.problem_categories where host_id = '${WAGNER}';`, 2);
must('core rollback again', file('docs/one-off-writes/problem-categories-rollback.sql'));
must('migration repair --status reverted', `delete from supabase_migrations.schema_migrations where version = '${VERSION}';`);
expectProbe('back to what the cloud read before', CLOUD_BEFORE);
check('the tasks filed under a category keep their titles and urgencies',
  `select string_agg(title || '/' || priority, ', ' order by title) from public.problems where id::text like 'f1149101-%';`,
  'Wi-Fi/high, Скрипит дверь/normal, Сломан стул/low, Смесители/normal, Течёт кран/high');
must('a second push after the rollback',
  `${file(MIGRATION)}\ninsert into supabase_migrations.schema_migrations (version, name) values ('${VERSION}', 'problem_categories');`,
  ['--single-transaction']);
expectProbe('and the probe reads AFTER again', AFTER);

console.log(failures === 0 ? '\nREHEARSAL GREEN' : `\nREHEARSAL RED: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
