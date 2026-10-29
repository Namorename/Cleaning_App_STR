// The public API's SQL on the LOCAL stand only — the database container of
// supabase/config.toml, never the cloud. Nothing is committed.
//
//   node scripts/api-stand.mjs check   — the migration (when the stand lacks it)
//                                        and supabase/tests/api_v1.sql in one
//                                        transaction, rolled back
//   node scripts/api-stand.mjs check-all — every suite of supabase/tests, each with
//                                        the migration in front, rolled back
//
// The HTTP side runs against the same stand, also inside a transaction that is
// never committed: scripts/api-stand-server.ts (docs/api-v1.md §14).
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const MIGRATION = 'supabase/migrations/20261028100000_public_api_v1.sql';
const SUITE = 'supabase/tests/api_v1.sql';

const project = readFileSync('supabase/config.toml', 'utf8').match(/^project_id\s*=\s*"([^"]+)"/m);
if (!project) {
  console.error('No project_id in supabase/config.toml');
  process.exit(1);
}
const container = `supabase_db_${project[1]}`;

function psql(input) {
  return spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q', '-At'],
    { input, encoding: 'utf8', shell: process.platform === 'win32' },
  );
}

const read = (path) => `${readFileSync(path, 'utf8')}\n`;

const probe = psql("select to_regclass('public.api_keys') is not null;");
if (probe.status !== 0) {
  console.error(`${probe.stdout ?? ''}${probe.stderr ?? ''}`.trim());
  process.exit(probe.status ?? 1);
}
const hasSchema = (probe.stdout ?? '').trim() === 't';

/**
 * One suite with the migration in front of it. The suite opens its own
 * transaction (a warning inside ours) and its closing rollback takes the
 * migration with it.
 */
function runSuite(suite) {
  const res = psql(`begin;\n${hasSchema ? '' : read(MIGRATION)}${read(suite)}`);
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  let passed = 0;
  for (const line of out.split('\n')) {
    if (/NOTICE:\s+ok /.test(line)) {
      passed += 1;
    } else if (/ERROR:|FAIL/.test(line)) {
      console.log(line.trimEnd());
    }
  }
  const ok = res.status === 0 && !/ERROR:|FAIL/.test(out);
  return { ok, passed, status: res.status };
}

const mode = process.argv[2];
if (mode === 'check') {
  const { ok, passed, status } = runSuite(SUITE);
  if (!ok) {
    console.error(`api_v1.sql failed after ${passed} checks (exit ${status}).`);
    process.exit(1);
  }
  console.log(`api_v1.sql: ${passed} checks passed; rolled back, the stand is unchanged`);
} else if (mode === 'check-all') {
  // Every suite of the repository, each with the migration in front: the API
  // must not break what was green before it.
  const suites = readdirSync('supabase/tests').filter((name) => name.endsWith('.sql')).sort();
  let failed = 0;
  let total = 0;
  for (const name of suites) {
    const { ok, passed } = runSuite(`supabase/tests/${name}`);
    total += passed;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name} (${passed})`);
    if (!ok) failed += 1;
  }
  console.log(`${suites.length - failed}/${suites.length} suites, ${total} checks; rolled back`);
  process.exit(failed === 0 ? 0 : 1);
} else {
  console.error('Usage: node scripts/api-stand.mjs check|check-all');
  process.exit(2);
}
