// Runs the suites of this folder on the local stand with the draft migration
// 20261023100000_video_limits_live applied first, without its guard, inside
// the suite's own transaction: every suite ends in rollback, so the draft never
// stays on the stand (docs/video-limits-1023.md).
//
//   node supabase/tests/draft/run.mjs [suite.sql ...] [--prefix extra.sql ...]
//
// With no suite named, every *.sql of this folder runs. A --prefix file is
// applied after the draft and before the suite, in the same transaction (a
// stand's own leftovers can be hidden that way). At rollout the guard goes, the
// suites move up to supabase/tests (video_limits.sql and task_media.sql replace
// theirs) and this folder goes.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const DRAFT = join(ROOT, 'supabase', 'migrations', '20261023100000_video_limits_live.sql');
const GUARD_START = '-- >>> draft guard';
const GUARD_END = '-- <<< draft guard';

function withoutGuard(text) {
  const start = text.indexOf(GUARD_START);
  const end = text.indexOf(GUARD_END);
  if (start === -1 || end === -1) {
    // The guard is gone: the draft is a migration now, and the stand should have it.
    throw new Error('The draft has no guard any more: move the suites up to supabase/tests');
  }
  return text.slice(0, start) + text.slice(text.indexOf('\n', end) + 1);
}

function parseArgs(argv) {
  const suites = [];
  const prefixes = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--prefix') {
      prefixes.push(argv[i + 1]);
      i += 1;
    } else {
      suites.push(argv[i]);
    }
  }
  return { suites, prefixes };
}

const config = readFileSync(join(ROOT, 'supabase', 'config.toml'), 'utf8');
const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m);
if (!projectId) {
  console.error('No project_id in supabase/config.toml');
  process.exit(1);
}
const container = `supabase_db_${projectId[1]}`;

const { suites: named, prefixes } = parseArgs(process.argv.slice(2));
const suites =
  named.length > 0
    ? named
    : readdirSync(HERE)
        .filter((name) => name.endsWith('.sql'))
        .sort()
        .map((name) => join(HERE, name));
const draft = withoutGuard(readFileSync(DRAFT, 'utf8'));
const extra = prefixes.map((file) => readFileSync(file, 'utf8'));

let failed = 0;
for (const suite of suites) {
  const body = readFileSync(suite, 'utf8');
  const begin = body.search(/^begin;\s*$/m);
  if (begin === -1) {
    console.error(`${suite}: no "begin;" line`);
    failed += 1;
    continue;
  }
  const rest = body.slice(begin).replace(/^begin;\s*$/m, '');
  const input = ['begin;', draft, ...extra, rest].join('\n');
  const res = spawnSync(
    'docker',
    ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'],
    { input, encoding: 'utf8', shell: process.platform === 'win32' },
  );
  if (res.error) {
    console.error(`Could not run docker: ${res.error.message}`);
    process.exit(1);
  }
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const ok = out.split('\n').filter((line) => /NOTICE:\s+ok /.test(line)).length;
  const isFailed = res.status !== 0 || /ERROR:|FAIL/.test(out);
  for (const line of out.split('\n')) {
    if (/ERROR:|FAIL/.test(line)) {
      console.log(line.trimEnd());
    }
  }
  console.log(`${suite}: ${ok} ok, ${isFailed ? 'FAILED' : 'passed'}`);
  failed += isFailed ? 1 : 0;
}
process.exit(failed > 0 ? 1 : 0);
