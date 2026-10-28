// Builds packages/shared/src/api/openapi.v1.json from the hand-written YAML and
// the scope registry (docs/api-v1.md §9).
//
//   npm run api:docs          — write the JSON
//   npm run api:docs -- --check — fail when the committed JSON is stale
//
// The parity test runs the same build in memory, so a stale file fails
// `npm run test:web` as well.
import { readFileSync, writeFileSync } from 'node:fs';

import { buildSpec, renderSpec } from '../packages/shared/src/api/build-spec.ts';
import { type ApiRegistry, effectiveScopes } from '../packages/shared/src/api/registry.ts';

const DIR = 'packages/shared/src/api';
const yaml = readFileSync(`${DIR}/openapi.v1.yaml`, 'utf8');
const registry = JSON.parse(readFileSync(`${DIR}/registry.json`, 'utf8')) as ApiRegistry;

const built = renderSpec(
  buildSpec({ yaml, registry, effective: (preset) => effectiveScopes(preset, [], registry) }),
);

const target = `${DIR}/openapi.v1.json`;
if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // A missing file is a stale file.
  }
  if (current !== built) {
    console.error(`${target} is stale: run npm run api:docs`);
    process.exit(1);
  }
  console.log(`${target} is up to date`);
} else {
  writeFileSync(target, built);
  console.log(`wrote ${target}`);
}
