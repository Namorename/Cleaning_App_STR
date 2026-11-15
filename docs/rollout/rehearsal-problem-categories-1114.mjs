// Rehearsal of the rollout of the level above high (20261115090000) and of the catalogue
// (20261115100000), and of every rollback, in the order docs/rollout/wagner-problem-catalog-1114.md
// gives, on a throwaway database inside the local Supabase container, apart from the stand:
//
//   node docs/rollout/rehearsal-db-1028.mjs create                  # every migration of this tree
//   node docs/rollout/rehearsal-problem-categories-1114.mjs
//   node docs/rollout/rehearsal-db-1028.mjs drop
//
// The throwaway database is built from scratch with every migration of this tree, both new ones
// included. From there, in order:
//   1. the catalogue rollback, then the level's: the probes must read exactly what the cloud read
//      before (2026-11-15, CLOUD_BEFORE_*), and each version row goes as `migration repair
//      --status reverted` would take it; the level's rollback refuses while the catalogue is there;
//   2. on that cloud-like state an old phone files two tasks; the level's migration is applied
//      alone, in one transaction as `db push` applies it; the probes read AFTER_LEVEL; an old phone
//      files, reads and edits as before, a critical task included;
//   3. the catalogue's migration the same way: the probes read AFTER_BOTH;
//   4. the suites of the level, the catalogue, the grants, the tasks, the API, the push and the
//      analytics, against it;
//   5. the client's data: loaded once (27: critical 6, high 7, normal 6, low 8), refused a second
//      time; the switch on; the cleaner files P1, P2 and P3 tasks and a typed one; the rolled-back
//      probe of the cloud answers PROBE OK and leaves nothing;
//   6. the rollback of the client (switch off, categories archived), the catalogue's, the level's —
//      a critical task becomes high first — back to CLOUD_BEFORE_*; and a second push of both.
// Read-only towards the stand: its database (`postgres`) is never touched.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DB = 'rehearsal_1028';
const LEVEL = { file: 'supabase/migrations/20261115090000_problem_critical.sql', version: '20261115090000', name: 'problem_critical' };
const CATALOGUE = { file: 'supabase/migrations/20261115100000_problem_categories.sql', version: '20261115100000', name: 'problem_categories' };
const WAGNER = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a';
const VERA = 'f1149001-0000-4000-8000-000000000001';
const HUGO = 'f1149002-0000-4000-8000-000000000002';
const FLOOD = 'd2e00844-d88c-4324-ab60-dbed5bb56a59'; // P1 «Затопление»: critical
const WIFI = '2ca940fd-288f-43f5-a6df-93145e10cd67'; // P2: high
const TAPS = '7bed8f05-ae67-43c3-82d5-01bf1b4a26c6'; // P3: normal

const PROBE_CATALOGUE = 'docs/rollout/probe_problem_categories.sql';
const PROBE_LEVEL = 'docs/rollout/probe_problem_critical.sql';

// The functions the level replaces, as the cloud runs them (probe_problem_critical.sql, 2026-11-15).
const UNCHANGED_BODIES =
  'analytics_checkouts_by_property(11) b0d460e22720d01af2ac5dd045668fa9; ' +
  'analytics_cleanings_by_cleaner(11) b5c53ef4822e5e96bf64cb8ef2bd7937; ' +
  'analytics_cleanings_by_property(11) 896cf4dd8247b68eb46fd361768d0dd2; ';
const LEVEL_FUNCTIONS = (report, update) =>
  'analytics_checkouts_by_property(12) b0d460e22720d01af2ac5dd045668fa9; ' +
  'analytics_cleanings_by_cleaner(12) b5c53ef4822e5e96bf64cb8ef2bd7937; ' +
  'analytics_cleanings_by_property(12) 896cf4dd8247b68eb46fd361768d0dd2; ' +
  'analytics_problem_rows(11) c622f02a9f62dde2f0471c0c29ae3fe5; ' +
  'analytics_problems_by_property(12) fb0921a9ddee93da4f4715ea6bdcbfa9; ' +
  'analytics_problems_by_technician(12) f6bc83a896c8bbec0a48888cff9e5588; ' +
  'analytics_series(11) fbfde0acd178a751ac75447ec2cabe6f; ' +
  'analytics_summary(10) 95055ae27a516fb7b74f57ee0c5d7d29; ' +
  'api_task_json(2) 8372d98b9f24186c8aa210fc4463d710; ' +
  'api_v1_create_task(11) 1ff29f1d922b299e5cb339f844780e39; ' +
  'api_v1_list_tasks(12) 1a40211088b95d73f7cf9358bcc01880; ' +
  'problems_critical_follows_priority(0) b8ffdbcb1fb119c266c6554078eba920; ' +
  `${report}; ${update}`;
const CLIENT_EXECUTE_LEVEL =
  'analytics_checkouts_by_property:authenticated, analytics_cleanings_by_cleaner:authenticated, ' +
  'analytics_cleanings_by_property:authenticated, analytics_problems_by_property:authenticated, ' +
  'analytics_problems_by_technician:authenticated, analytics_series:authenticated, ' +
  'analytics_summary:authenticated, report_problem:authenticated, update_problem:authenticated';

// The cloud's answers, 2026-11-15 (01:39 and 11:55 UTC).
const CLOUD_BEFORE_CATALOGUE = {
  head: '20261111140000',
  applied: 132,
  functions:
    'report_problem(uuid,text,text,problem_priority,bigint,uuid) e784ff29e45d88711ff3e3c86bb137be; ' +
    'update_problem(uuid,text,text,problem_priority) ccb9c738ec64849bfc33798f8ad57592',
  client_execute: 'report_problem:authenticated, update_problem:authenticated',
  columns: null,
  catalogue_table: false,
  catalogue_client_grants: null,
  catalogue_rls: null,
  catalogue_policies: null,
};
const CLOUD_BEFORE_LEVEL = {
  head: '20261111140000',
  applied: 132,
  functions:
    UNCHANGED_BODIES +
    'analytics_problem_rows(10) 67b6265161da9b809fa8e8faba5d4b7b; ' +
    'analytics_problems_by_property(11) 969da76d7af817126bf300424fa026d1; ' +
    'analytics_problems_by_technician(11) 1ef3a898b4b595e2b4d95f07d38e0ea2; ' +
    'analytics_series(10) b0abe0cdd5a4af1e49948c7bff58a4d2; ' +
    'analytics_summary(9) f1aa70fda8068f04d87fa7c50a2a701c; ' +
    'api_task_json(2) 5349ab4404ef15e58a670dc45c2a4d04; ' +
    'api_v1_create_task(11) 2b209245b3e77c25bbdc80bc0f10d994; ' +
    'api_v1_list_tasks(12) f7ec64aabc169eb963da530f2fc5cf49; ' +
    'report_problem(6) e784ff29e45d88711ff3e3c86bb137be; ' +
    'update_problem(4) ccb9c738ec64849bfc33798f8ad57592',
  client_execute: CLIENT_EXECUTE_LEVEL,
  analytics_with_levels: 0,
  columns: null,
  constraints: null,
  triggers: null,
  priority_values: 'low,normal,high',
};
const AFTER_LEVEL = {
  head: LEVEL.version,
  applied: 133,
  functions: LEVEL_FUNCTIONS(
    'report_problem(7) 928acc389f64eec4b47a562cc3ca885c',
    'update_problem(5) e323a4adba166d0f4f913996f61ebc50',
  ),
  client_execute: CLIENT_EXECUTE_LEVEL,
  analytics_with_levels: 8,
  columns: 'problems.critical',
  constraints: 'problems_critical_is_high',
  triggers: 'problems_critical_follows_priority',
  priority_values: 'low,normal,high',
};
const AFTER_LEVEL_CATALOGUE = {
  ...CLOUD_BEFORE_CATALOGUE,
  head: LEVEL.version,
  applied: 133,
  functions:
    'report_problem(uuid,text,text,problem_priority,bigint,uuid,boolean) 928acc389f64eec4b47a562cc3ca885c; ' +
    'update_problem(uuid,text,text,problem_priority,boolean) e323a4adba166d0f4f913996f61ebc50',
};
const AFTER_BOTH_LEVEL = {
  ...AFTER_LEVEL,
  head: CATALOGUE.version,
  applied: 134,
  functions: LEVEL_FUNCTIONS(
    'report_problem(8) 6878fb6b87cfa6bc81833d07dc10848b',
    'update_problem(6) 42faceb56a6c534559f3e8fadeeb1c73',
  ),
};
const AFTER_BOTH_CATALOGUE = {
  head: CATALOGUE.version,
  applied: 134,
  functions:
    'problem_category_for_report(uuid) 4c19b6d036bf5fd0a04bc28f969568a7; ' +
    'report_problem(uuid,text,text,problem_priority,bigint,uuid,boolean,uuid) 6878fb6b87cfa6bc81833d07dc10848b; ' +
    'update_problem(uuid,text,text,problem_priority,boolean,uuid) 42faceb56a6c534559f3e8fadeeb1c73',
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

function expectProbe(label, path, want) {
  const got = probeFile(path);
  const wrong = Object.keys(want).filter((key) => JSON.stringify(got[key]) !== JSON.stringify(want[key]));
  if (wrong.length > 0) {
    fail(label, wrong.map((key) => `${key}: got ${JSON.stringify(got[key])}, want ${JSON.stringify(want[key])}`).join('\n     '));
  } else {
    console.log(`ok   ${label}`);
  }
}

function expectBoth(label, catalogue, level) {
  expectProbe(`${label} (probe_problem_categories)`, PROBE_CATALOGUE, catalogue);
  expectProbe(`${label} (probe_problem_critical)`, PROBE_LEVEL, level);
}

const asVera = `set role authenticated; set request.jwt.claims to '{"sub":"${VERA}","role":"authenticated"}';\n`;
const file = (path) => readFileSync(path, 'utf8');
const problem = (id, column) => `select ${column} from public.problems where id = '${id}';`;
const push = (migration) =>
  `${file(migration.file)}\ninsert into supabase_migrations.schema_migrations (version, name) values ('${migration.version}', '${migration.name}');`;
const repair = (migration) => `delete from supabase_migrations.schema_migrations where version = '${migration.version}';`;
const task = (n) => `f1149101-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

// ---------- 0. the database is this tree's ----------
check('the throwaway database carries both new migrations', 'select max(version) from supabase_migrations.schema_migrations;', CATALOGUE.version);

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

// ---------- 1. both rollbacks leave the cloud's state ----------
mustRefuse('the level\'s rollback refuses while the catalogue is there', file('docs/one-off-writes/problem-critical-rollback.sql'), /catalogue back first/);
must('the catalogue rollback (problem-categories-rollback.sql)', file('docs/one-off-writes/problem-categories-rollback.sql'));
must('migration repair --status reverted 20261115100000', repair(CATALOGUE));
expectBoth('after the catalogue rollback the probes read the level alone', AFTER_LEVEL_CATALOGUE, AFTER_LEVEL);
must('the level\'s rollback (problem-critical-rollback.sql)', file('docs/one-off-writes/problem-critical-rollback.sql'));
must('migration repair --status reverted 20261115090000', repair(LEVEL));
expectBoth('after both rollbacks the probes read what the cloud read before', CLOUD_BEFORE_CATALOGUE, CLOUD_BEFORE_LEVEL);

// ---------- 2. an old phone files two tasks; the level's push ----------
must('an old phone files two tasks, by the six arguments', `${asVera}
select public.report_problem(p_id => '${task(1)}', p_title => 'Течёт кран',
  p_priority => 'high', p_property_id => 900003101);
select public.report_problem(p_id => '${task(2)}', p_title => 'Скрипит дверь',
  p_priority => 'normal', p_property_id => 900003101);`);
must('the level\'s migration alone, in one transaction, as db push applies it', push(LEVEL), ['--single-transaction']);
expectBoth('after the level\'s push the probes read AFTER_LEVEL', AFTER_LEVEL_CATALOGUE, AFTER_LEVEL);
check('the tasks filed before are not critical, their urgencies as filed',
  `select string_agg(title || '/' || priority || '/' || critical, ', ' order by title)
   from public.problems where id::text like 'f1149101-%';`,
  'Скрипит дверь/normal/false, Течёт кран/high/false');
must('a new phone files a critical task; an old one files by the six arguments', `${asVera}
select public.report_problem('${task(3)}', 'Прорвало трубу', null, 'normal', 900003101, null, p_critical => true);
select public.report_problem(p_id => '${task(4)}', p_title => 'Нет Wi-Fi',
  p_priority => 'high', p_property_id => 900003101);`);
check('an old phone reads the critical task\'s priority as high, a value it parses',
  `${asVera} select string_agg(priority::text, ',' order by title) from public.problems where id in ('${task(3)}', '${task(4)}');`,
  'high,high');
check('the old phone\'s own task is high, not critical', problem(task(4), `priority || '/' || critical`), 'high/false');
must('an old phone corrects the critical task: it sends high back', `${asVera}
select public.update_problem('${task(3)}', 'Прорвало трубу', 'Вода на полу', 'high');`);
check('it stays critical', problem(task(3), `priority || '/' || critical || '/' || description`), 'high/true/Вода на полу');
check('the head technician was woken for the critical task as for a high one',
  `select string_agg(kind || ':' || urgent, ',') from raw.push_outbox where params ->> 'problem_id' = '${task(3)}';`,
  'problem_new:true');

// ---------- 3. the catalogue's push ----------
must('the catalogue\'s migration, in one transaction, as db push applies it', push(CATALOGUE), ['--single-transaction']);
expectBoth('after the catalogue\'s push the probes read AFTER_BOTH', AFTER_BOTH_CATALOGUE, AFTER_BOTH_LEVEL);
check('every company reports by free text after the push', `select count(*) from public.hosts where problem_report_mode <> 'free_text';`, 0);
check('the tasks filed before keep their titles, urgencies and flags, no category',
  `select string_agg(title || '/' || priority || '/' || critical || '/' || coalesce(category_id::text, '-'), ', ' order by title)
   from public.problems where id::text like 'f1149101-%';`,
  'Нет Wi-Fi/high/false/-, Прорвало трубу/high/true/-, Скрипит дверь/normal/false/-, Течёт кран/high/false/-');

// ---------- 4. the suites against it ----------
// The suites read the whole push queue (head_tech_push.sql: pg_temp.queued()) and expect it
// empty; the tasks above queued Hugo's pushes.
must('the rehearsal\'s own pushes out of the queue', `delete from raw.push_outbox where recipient_id = '${HUGO}';`);
for (const suite of [
  'problem_critical.sql',
  'problem_categories.sql',
  'table_grants.sql',
  'problems.sql',
  'api_v1.sql',
  'head_tech_push.sql',
  'analytics.sql',
  'analytics_series.sql',
]) {
  const res = psql(file(`supabase/tests/${suite}`), []);
  const all = res.out + res.err;
  const passed = (all.match(/NOTICE:\s+ok/g) ?? []).length;
  if (!res.ok || /ERROR:|FAIL/.test(all)) {
    fail(`suite ${suite}`, (all.split('\n').find((line) => /ERROR:|FAIL/.test(line)) ?? '').trim());
  } else {
    console.log(`ok   suite ${suite}: ${passed} checks`);
  }
}

// ---------- 5. the client's data and switch ----------
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
check('the owner\'s mapping: P1 critical, P2 high, P3 normal, P4 low', `select string_agg(g || ':' || levels, ' ' order by g) from (
     select case when sort_order <= 6 then 'P1' when sort_order <= 13 then 'P2' when sort_order <= 19 then 'P3' else 'P4' end as g,
            string_agg(distinct case when critical then 'critical' else priority::text end, ',') as levels
     from public.problem_categories where host_id = '${WAGNER}' group by 1) x;`,
  'P1:critical P2:high P3:normal P4:low');
if (loaded.by_level !== 'critical 6, high 7, normal 6, low 8') {
  fail('probe_wagner_problem_categories by_level', `got ${loaded.by_level}`);
} else {
  console.log('ok   probe_wagner_problem_categories: by_level critical 6, high 7, normal 6, low 8');
}
mustRefuse('the load script refuses a second run', file('docs/one-off-writes/wagner-problem-categories.sql'), /runs once/);
must('the switch on (wagner-problem-report-mode-catalog.sql)', file('docs/one-off-writes/wagner-problem-report-mode-catalog.sql'));
check('the client reports by catalogue', `select problem_report_mode from public.hosts where id = '${WAGNER}';`, 'catalog');
check('every other company still by free text', `select count(*) from public.hosts where id <> '${WAGNER}' and problem_report_mode <> 'free_text';`, 0);

check('the cleaner reads the switch with her company', `${asVera} select problem_report_mode from public.hosts;`, 'catalog');
check('and the 27 categories', `${asVera} select count(*) from public.problem_categories where archived_at is null;`, 27);
must('she files Затопление and Wi-Fi as low, Taps as high, and one typed task', `${asVera}
select public.report_problem('${task(5)}', 'Flooding', 'Вода из-под ванны', 'low',
  900003101, null, p_category_id => '${FLOOD}');
select public.report_problem('${task(6)}', 'Wi-Fi', 'Роутер мигает', 'low',
  900003101, null, p_category_id => '${WIFI}');
select public.report_problem('${task(7)}', 'Taps', null, 'high',
  900003101, null, p_category_id => '${TAPS}');
select public.report_problem(p_id => '${task(8)}', p_title => 'Сломан стул',
  p_priority => 'low', p_property_id => 900003101);`);
check('the server files Затопление (P1) as critical: high with the flag', problem(task(5), `title || '/' || priority || '/' || critical`), 'Затопление/high/true');
check('Wi-Fi (P2) as high', problem(task(6), `title || '/' || priority || '/' || critical`), 'Wi-Fi/high/false');
check('and Taps (P3) as normal, whatever the phone sent', problem(task(7), `title || '/' || priority || '/' || (title_i18n ->> 'cs')`), 'Смесители/normal/Vodovodní baterie');
check('a task without a category is filed as before', problem(task(8), `title || '/' || priority || '/' || critical || '/' || coalesce(category_id::text, '-')`), 'Сломан стул/low/false/-');
check('the head technician is woken for Затопление and Wi-Fi, not for Taps',
  `select string_agg((params ->> 'problem_id') || ':' || urgent, ', ' order by params ->> 'problem_id')
   from raw.push_outbox where kind = 'problem_new' and params ->> 'problem_id' in ('${task(5)}', '${task(6)}', '${task(7)}');`,
  `${task(5)}:true, ${task(6)}:true, ${task(7)}:false`);
const counted = psql('select count(*) || \'/\' || (select count(*) from raw.push_outbox) from public.problems;');
const probe = psql(file('docs/one-off-writes/wagner-probe-report-rolled-back.sql'));
if (probe.ok || !/PROBE OK/.test(probe.err)) {
  fail('the rolled-back probe of the cloud', (probe.err || 'it did not raise').trim().split('\n')[0]);
} else {
  console.log(`ok   the rolled-back probe: ${probe.err.trim().split('\n')[0].replace(/^.*?PROBE OK/, 'PROBE OK')}`);
}
check('and it leaves no task and no push behind', 'select count(*) || \'/\' || (select count(*) from raw.push_outbox) from public.problems;', counted.out.trim());

// ---------- 6. rolling back: the client, the catalogue, the level ----------
mustRefuse('the data rollback refuses while the switch is on', file('docs/one-off-writes/wagner-problem-categories-rollback.sql'), /free-text/);
must('the switch off (wagner-problem-report-mode-free-text.sql)', file('docs/one-off-writes/wagner-problem-report-mode-free-text.sql'));
const undone = must('the client rollback (wagner-problem-categories-rollback.sql)', file('docs/one-off-writes/wagner-problem-categories-rollback.sql'));
console.log(`     ${(undone.out + undone.err).trim().split('\n').filter((line) => /archived/.test(line)).join(' ')}`);
check('no live category of the client', `select count(*) from public.problem_categories where host_id = '${WAGNER}' and archived_at is null;`, 0);
check('all 27 archived, none deleted', `select count(*) from public.problem_categories where host_id = '${WAGNER}' and archived_at is not null;`, 27);
check('a report queued on a phone before the rollback is still filed on its archived category, critical', `${asVera}
select priority || '/' || critical || '/' || category_id from public.report_problem('${task(9)}', 'Flooding', null, 'low',
  900003101, null, p_category_id => '${FLOOD}');`, `high/true/${FLOOD}`);
mustRefuse('a category a task points at cannot be deleted', `delete from public.problem_categories where id = '${WIFI}';`, /violates foreign key constraint/);
mustRefuse('the level\'s rollback refuses while the catalogue is there', file('docs/one-off-writes/problem-critical-rollback.sql'), /catalogue back first/);
must('the catalogue rollback again', file('docs/one-off-writes/problem-categories-rollback.sql'));
must('migration repair --status reverted 20261115100000', repair(CATALOGUE));
expectBoth('back to the level alone', AFTER_LEVEL_CATALOGUE, AFTER_LEVEL);
check('the critical tasks are still critical before the level goes',
  `select count(*) from public.problems where critical and id::text like 'f1149101-%';`, 3);
must('the level\'s rollback again', file('docs/one-off-writes/problem-critical-rollback.sql'));
must('migration repair --status reverted 20261115090000', repair(LEVEL));
expectBoth('back to what the cloud read before', CLOUD_BEFORE_CATALOGUE, CLOUD_BEFORE_LEVEL);
check('every task keeps its title; the critical ones are high, as they read',
  `select string_agg(title || '/' || priority, ', ' order by title, id) from public.problems where id::text like 'f1149101-%';`,
  'Wi-Fi/high, Затопление/high, Затопление/high, Нет Wi-Fi/high, Прорвало трубу/high, Скрипит дверь/normal, Сломан стул/low, Смесители/normal, Течёт кран/high');
must('an old phone files after the rollback, by the six arguments', `${asVera}
select public.report_problem(p_id => '${task(10)}', p_title => 'После отката', p_priority => 'normal', p_property_id => 900003101);`);
must('a second push of the level', push(LEVEL), ['--single-transaction']);
must('and of the catalogue', push(CATALOGUE), ['--single-transaction']);
expectBoth('and the probes read AFTER_BOTH again', AFTER_BOTH_CATALOGUE, AFTER_BOTH_LEVEL);

console.log(failures === 0 ? '\nREHEARSAL GREEN' : `\nREHEARSAL RED: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
