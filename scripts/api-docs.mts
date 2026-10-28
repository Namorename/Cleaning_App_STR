// Builds the public API's generated documentation (docs/api-v1.md §9–10):
//   packages/shared/src/api/openapi.v1.json — from the hand-written YAML and the
//     scope registry (tables, security, headers, code samples);
//   docs/api-coverage.md — from packages/shared/src/api/coverage.json.
//
//   npm run api:docs             — write both
//   npm run api:docs -- --check  — fail when either is stale
//
// The parity test builds the same in memory, so a stale file fails
// `npm run test:web` as well.
import { readFileSync, writeFileSync } from 'node:fs';

import { buildSpec, renderSpec } from '../packages/shared/src/api/build-spec.ts';
import { renderCoverageDoc } from '../packages/shared/src/api/coverage-doc.ts';
import type { Coverage } from '../packages/shared/src/api/parity.ts';
import { type ApiRegistry, effectiveScopes } from '../packages/shared/src/api/registry.ts';

const DIR = 'packages/shared/src/api';
const yaml = readFileSync(`${DIR}/openapi.v1.yaml`, 'utf8');
const registry = JSON.parse(readFileSync(`${DIR}/registry.json`, 'utf8')) as ApiRegistry;
const coverage = JSON.parse(readFileSync(`${DIR}/coverage.json`, 'utf8')) as Coverage;

const outputs: readonly [string, string][] = [
  [
    `${DIR}/openapi.v1.json`,
    renderSpec(buildSpec({ yaml, registry, effective: (preset) => effectiveScopes(preset, [], registry) })),
  ],
  ['docs/api-coverage.md', renderCoverageDoc(coverage)],
];

const isCheck = process.argv.includes('--check');
let stale = 0;
for (const [target, built] of outputs) {
  if (isCheck) {
    let current = '';
    try {
      current = readFileSync(target, 'utf8');
    } catch {
      // A missing file is a stale file.
    }
    if (current !== built) {
      console.error(`${target} is stale: run npm run api:docs`);
      stale += 1;
    } else {
      console.log(`${target} is up to date`);
    }
  } else {
    writeFileSync(target, built);
    console.log(`wrote ${target}`);
  }
}
process.exit(stale === 0 ? 0 : 1);
