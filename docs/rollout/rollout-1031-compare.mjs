// Compares a cloud read of rollout_1030_fingerprint.sql or rollout_1030_functions.sql with the
// state the rehearsal of 31.10 expects (docs/rollout-plan-1028.md §9.7, step 5; the expected
// values are in rollout_1031_expected.json next to this file, taken from throwaway databases
// that matched the cloud at 20261030103000 part for part).
//
//   node scripts/cloud-read.mjs <plan tree>/docs/rollout/rollout_1030_fingerprint.sql > fp.json
//   node <plan tree>/docs/rollout/rollout-1031-compare.mjs <head|step5> fp.json
//
// Prints EQUAL, or each part (or function) that differs; exits 1 on any difference.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [state, readPath] = process.argv.slice(2);
const expected = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'rollout_1031_expected.json'), 'utf8'));
if (!expected.states[state] || !readPath) {
  console.error(`usage: node rollout-1031-compare.mjs <${Object.keys(expected.states).join('|')}> <cloud-read output>`);
  process.exit(2);
}

// cloud-read prints [{"catalog_fingerprint": …}] or [{"fns": …}]; psql -At on a rehearsal
// database prints the bare object.
const read = JSON.parse(readFileSync(readPath, 'utf8'));
const row = Array.isArray(read) ? read[0] : read;
const bare = row.catalog_fingerprint ?? row.fns ?? row;
const kind = 'head' in bare && 'functions' in bare ? 'fingerprint' : 'functions';
const actual = bare;
const want = expected.states[state][kind];

const differences = [];
for (const key of new Set([...Object.keys(want), ...Object.keys(actual)])) {
  const a = JSON.stringify(actual[key]);
  const w = JSON.stringify(want[key]);
  if (a !== w) differences.push(`${key}: cloud ${a ?? 'absent'}, expected ${w ?? 'absent'}`);
}
if (differences.length === 0) {
  console.log(`EQUAL: ${kind} of ${state}`);
} else {
  console.log(`${differences.length} difference(s) in the ${kind} of ${state}:`);
  for (const line of differences) console.log(`  ${line}`);
  process.exit(1);
}
