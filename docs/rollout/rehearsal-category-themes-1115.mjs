// Rehearsal of the rollout of the manager's four levels (20261115140000) and of the themes of
// categories (20261115150000), with the client's bindings and every rollback, in the order
// docs/rollout/category-themes-1115.md gives, on a throwaway database inside the local Supabase
// container, apart from the stand:
//
//   node docs/rollout/rehearsal-db-1028.mjs create                  # every migration of this tree
//   node docs/rollout/rehearsal-category-themes-1115.mjs
//   node docs/rollout/rehearsal-db-1028.mjs drop
//
// In order: the client's catalogue and switch as the cloud has them; both rollbacks back to the
// cloud's «before»; catalogue tasks filed and themed by the dictionary as tonight (Доставка →
// bed_comfort, the old mistake); each migration alone as db push applies it; the suites; the
// bindings, the recompute, a manager's own theme kept, the night's episodes; the rollbacks in
// reverse, back to «before»; a second push of both.
// Read-only towards the stand: its database (`postgres`) is never touched.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const DB = 'rehearsal_1028';
const LEVELS = { file: 'supabase/migrations/20261115140000_manager_critical.sql', version: '20261115140000', name: 'manager_critical' };
const THEMES = { file: 'supabase/migrations/20261115150000_category_themes.sql', version: '20261115150000', name: 'category_themes' };
const WAGNER = 'ce77c272-c330-4b74-ac98-c7d36cba8b2a';
const VERA = 'f1159001-0000-4000-8000-000000000001';
const MILA = 'f1159002-0000-4000-8000-000000000002';
const FLOOD = 'd2e00844-d88c-4324-ab60-dbed5bb56a59'; // Затопление → plumbing
const DELIVERY = '53254afb-447f-46df-ac19-e265389a9d9b'; // Доставка → no quality issue
const DECOR = '0e170fe9-4973-48fb-bc0b-23f548340527'; // Декор → unbound, the dictionary
const WIFI = '2ca940fd-288f-43f5-a6df-93145e10cd67'; // Wi-Fi → wifi, but a manager chose by hand
const PROBE = 'docs/rollout/probe_category_themes.sql';

const CLIENT_EXECUTE =
  'add_signal_finding:authenticated, approve_signal_finding:authenticated, launch_resolution_plan:authenticated, ' +
  'problem_theme:authenticated, resolution_plan:authenticated, save_resolution_plan:authenticated';
// The cloud's answer, 2026-11-15 14:30 UTC.
const BEFORE = {
  head: '20261115100000',
  applied: 134,
  functions:
    'add_signal_finding(8) a59e985e86f53d0a168f6d92321db2b5; approve_signal_finding(7) cd86652711f85bd63ca45fe39ba0cd5b; ' +
    'launch_resolution_plan(2) f7c6bf07398542240f3fb23e69326097; problem_theme(1) 65af426845fdf6da74c05fe6358125d9; ' +
    'refresh_property_quality(1) 7346096d940c91bcd400bb0bf237c893; resolution_plan(1) 42cbb1219e96db6dc5c7d16a483c057d; ' +
    'save_resolution_plan(5) b93ab4223f01628d38b7dc5b0018a0cb',
  client_execute: CLIENT_EXECUTE,
  columns: 'problem_categories.critical, resolution_plan_steps.theme',
  theme_sources: "CHECK ((source = ANY (ARRAY['signal'::text, 'dict'::text, 'manual'::text])))",
};
const AFTER_LEVELS = {
  ...BEFORE,
  head: LEVELS.version,
  applied: 135,
  functions:
    'add_signal_finding(9) 440a35f554d69bbe0ebcff96b458ed70; approve_signal_finding(8) 2c33535377ba6f07c9be659bcb5b9b59; ' +
    'launch_resolution_plan(2) 08379adcaa1247d9494ed4ae122a673c; problem_theme(1) 65af426845fdf6da74c05fe6358125d9; ' +
    'refresh_property_quality(1) 7346096d940c91bcd400bb0bf237c893; resolution_plan(1) 3b25b99d2a09d09b790ae57bfe244298; ' +
    'save_resolution_plan(5) 117e13edc6aae7819f5132ef364b1291',
  columns: 'problem_categories.critical, resolution_plan_steps.critical, resolution_plan_steps.theme',
};
const AFTER_BOTH = {
  ...AFTER_LEVELS,
  head: THEMES.version,
  applied: 136,
  functions:
    'add_signal_finding(9) 440a35f554d69bbe0ebcff96b458ed70; approve_signal_finding(8) 2c33535377ba6f07c9be659bcb5b9b59; ' +
    'launch_resolution_plan(2) 08379adcaa1247d9494ed4ae122a673c; problem_theme(1) 9f6919b1dc4586ac862ac1218b51c7fd; ' +
    'refresh_category_themes(1) 2faa3adc4aad0f6955a73c97f1869121; refresh_property_quality(1) 32bec7ec084c031070cf48e3626c90f5; ' +
    'resolution_plan(1) 3b25b99d2a09d09b790ae57bfe244298; save_resolution_plan(5) 117e13edc6aae7819f5132ef364b1291',
  columns:
    'problem_categories.critical, problem_categories.not_quality, problem_categories.theme, ' +
    'resolution_plan_steps.critical, resolution_plan_steps.theme',
  theme_sources: "CHECK ((source = ANY (ARRAY['signal'::text, 'dict'::text, 'manual'::text, 'category'::text])))",
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
const asVera = `set role authenticated; set request.jwt.claims to '{"sub":"${VERA}","role":"authenticated"}';\n`;
const asMila = `set role authenticated; set request.jwt.claims to '{"sub":"${MILA}","role":"authenticated"}';\n`;
const push = (m) => `${file(m.file)}\ninsert into supabase_migrations.schema_migrations (version, name) values ('${m.version}', '${m.name}');`;
const repair = (m) => `delete from supabase_migrations.schema_migrations where version = '${m.version}';`;
const task = (n) => `f1159101-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;
const themeOf = (id) => `select coalesce((select t.source || ':' || t.theme from public.problem_themes t where t.problem_id = '${id}'), 'none');`;
const dictOf = (id) => `select coalesce('dict:' || public.issue_theme_of_text(p.title || ' ' || coalesce(p.description, '')), 'none') from public.problems p where p.id = '${id}';`;
const episodeOf = (id) => `select coalesce(string_agg(f.theme, ','), 'none') from public.issue_facts f where f.problem_id = '${id}' and f.origin = 'stream';`;

// ---------- 0. the tree, and the client as the cloud has it ----------
check('the throwaway database carries both new migrations', 'select max(version) from supabase_migrations.schema_migrations;', THEMES.version);
must('seed the client company', `
insert into public.hosts (id, name, default_language) values ('${WAGNER}', 'Primary host (rehearsal)', 'ru');
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, created_at, updated_at, raw_user_meta_data, raw_app_meta_data) values
  ('${VERA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'vera.themes@test.local', 'x', now(), now(), '{"full_name":"Vera"}', '{"role":"cleaner"}'),
  ('${MILA}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mila.themes@test.local', 'x', now(), now(), '{"full_name":"Mila"}', '{"role":"manager"}');
update public.profiles set host_id = '${WAGNER}' where id in ('${VERA}', '${MILA}');
insert into public.properties (id, host_id, name, timezone, check_in_time, check_out_time)
  values (900003201, '${WAGNER}', 'Rehearsal flat', 'Europe/Prague', '15:00', '10:00');
insert into public.property_cleaners (host_id, property_id, cleaner_id, mode) values ('${WAGNER}', 900003201, '${VERA}', 'claim');
`);
must('the client catalogue', file('docs/one-off-writes/wagner-problem-categories.sql'));
must('the switch on', file('docs/one-off-writes/wagner-problem-report-mode-catalog.sql'));

// ---------- 1. both rollbacks leave the cloud's state ----------
must('the themes rollback (category-themes-rollback.sql)', file('docs/one-off-writes/category-themes-rollback.sql'));
must('migration repair --status reverted 20261115150000', repair(THEMES));
expectProbe('after the themes rollback the probe reads the levels alone', AFTER_LEVELS);
must('the levels rollback (manager-critical-rollback.sql)', file('docs/one-off-writes/manager-critical-rollback.sql'));
must('migration repair --status reverted 20261115140000', repair(LEVELS));
expectProbe('after both rollbacks the probe reads what the cloud read before', BEFORE);

// ---------- 2. as tonight: catalogue tasks, themed by the dictionary ----------
must('she files Затопление, Доставка, Декор and Wi-Fi from the catalogue', `${asVera}
select public.report_problem('${task(1)}', 'x', 'Вода на полу', 'low', 900003201, null, p_category_id => '${FLOOD}');
select public.report_problem('${task(2)}', 'x', 'Нужно бельё на завтра', 'low', 900003201, null, p_category_id => '${DELIVERY}');
select public.report_problem('${task(3)}', 'x', null, 'low', 900003201, null, p_category_id => '${DECOR}');
select public.report_problem('${task(4)}', 'x', null, 'low', 900003201, null, p_category_id => '${WIFI}');`);
must('the night of before', `select public.refresh_property_quality('${WAGNER}');`);
check('the old mistake: «Доставка (бельё…)» is read as bed_comfort by the dictionary', themeOf(task(2)), 'dict:bed_comfort');

// ---------- 3. each migration alone, as db push applies it ----------
must('the levels migration alone, in one transaction', push(LEVELS), ['--single-transaction']);
expectProbe('after it the probe reads AFTER_LEVELS', AFTER_LEVELS);
must('the themes migration alone, in one transaction', push(THEMES), ['--single-transaction']);
expectProbe('after it the probe reads AFTER_BOTH', AFTER_BOTH);
check('the tasks keep the themes of the night until anything binds a category', themeOf(task(2)), 'dict:bed_comfort');

// ---------- 4. the suites ----------
// They hold every company at free text unless switched: the client's switch is off while they run.
must('the switch off for the suites', file('docs/one-off-writes/wagner-problem-report-mode-free-text.sql'));
// problem_categories.sql writes its own categories into the same company and is run on a clean
// database by test:rls; here the client's tasks already stand on its categories.
for (const suite of ['manager_critical.sql', 'category_themes.sql', 'problem_critical.sql',
  'guest_signals.sql', 'resolution_plans.sql', 'table_grants.sql', 'problems.sql', 'api_v1.sql']) {
  const res = psql(file(`supabase/tests/${suite}`), []);
  const all = res.out + res.err;
  const passed = (all.match(/NOTICE:\s+ok/g) ?? []).length;
  if (!res.ok || /ERROR:|FAIL/.test(all)) fail(`suite ${suite}`, (all.split('\n').find((line) => /ERROR:|FAIL/.test(line)) ?? '').trim());
  else console.log(`ok   suite ${suite}: ${passed} checks`);
}

must('the switch on again', file('docs/one-off-writes/wagner-problem-report-mode-catalog.sql'));

// ---------- 5. the client's bindings ----------
must('a manager gives the Wi-Fi task a theme by hand', `${asMila} select public.set_problem_theme('${task(4)}', 'other');`);
const bound = must('the bindings (wagner-category-themes.sql)', file('docs/one-off-writes/wagner-category-themes.sql'));
console.log(`     ${(bound.out + bound.err).trim().split('\n').filter((line) => /bound/.test(line)).join(' ')}`);
const probed = probeFile('docs/rollout/probe_wagner_category_themes.sql');
console.log(`     probe: ${JSON.stringify(probed)}`);
for (const [key, want] of [['live', 27], ['themed', 21], ['not_quality', 1], ['unbound', 5], ['mode', 'catalog']]) {
  if (probed[key] !== want) fail(`probe ${key}`, `got ${probed[key]}, want ${want}`);
  else console.log(`ok   probe ${key} ${want}`);
}
check("Затопление: its category's theme", themeOf(task(1)), 'category:plumbing');
check('Доставка: no quality issue, no theme', themeOf(task(2)), 'none');
const decorDict = psql(dictOf(task(3))).out.trim();
check('Декор: unbound, the dictionary as before', themeOf(task(3)), decorDict);
check("Wi-Fi: the manager's own choice stays", themeOf(task(4)), 'manual:other');
check('the panel shows «по категории» for Затопление', `${asMila} select public.problem_theme('${task(1)}')::text;`, '{"theme": "plumbing", "source": "category"}');
check('and «не проблема качества» for Доставка', `${asMila} select public.problem_theme('${task(2)}')::text;`, '{"theme": null, "source": "category", "not_quality": true}');
must('a second run writes the same', file('docs/one-off-writes/wagner-category-themes.sql'));
check('the same fingerprint', `select md5(string_agg(c.id || '|' || coalesce(c.theme, '-') || '|' || c.not_quality, E'\\n' order by c.sort_order)) from public.problem_categories c where c.host_id = '${WAGNER}';`, probed.bindings_md5);
must('the night', `select public.refresh_property_quality('${WAGNER}');`);
check('Затопление is an episode of plumbing', episodeOf(task(1)), 'plumbing');
check('Доставка is no episode', episodeOf(task(2)), 'none');
check('the night kept the hand', themeOf(task(4)), 'manual:other');

// ---------- 6. back, in reverse ----------
must('the bindings rollback', file('docs/one-off-writes/wagner-category-themes-rollback.sql'));
check('Затопление back to the dictionary', themeOf(task(1)), psql(dictOf(task(1))).out.trim());
check('Доставка back to the dictionary', themeOf(task(2)), 'dict:bed_comfort');
check('the switch stays on', `select problem_report_mode from public.hosts where id = '${WAGNER}';`, 'catalog');
must('the themes rollback', file('docs/one-off-writes/category-themes-rollback.sql'));
must('migration repair --status reverted 20261115150000', repair(THEMES));
must('the levels rollback', file('docs/one-off-writes/manager-critical-rollback.sql'));
must('migration repair --status reverted 20261115140000', repair(LEVELS));
expectProbe('back to what the cloud read before', BEFORE);
check("the manager's own theme survived it all", themeOf(task(4)), 'manual:other');
must('a second push of the levels', push(LEVELS), ['--single-transaction']);
must('and of the themes', push(THEMES), ['--single-transaction']);
expectProbe('and the probe reads AFTER_BOTH again', AFTER_BOTH);

console.log(failures === 0 ? '\nREHEARSAL GREEN' : `\nREHEARSAL RED: ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
