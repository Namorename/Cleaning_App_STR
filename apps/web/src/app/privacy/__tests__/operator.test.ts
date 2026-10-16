import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

const OPERATOR = path.resolve(__dirname, '../operator.ts');

/**
 * The operator's name, IČO, address and e-mail are the owner's own: the
 * module that reads them must stay out of every client bundle. `server-only`
 * makes an import from a client component a build error; the tests mock it,
 * so its presence is held here, in the source.
 */
describe('the operator’s details', () => {
  test('are read by a server-only module', () => {
    expect(readFileSync(OPERATOR, 'utf8')).toMatch(/^import 'server-only';$/m);
  });
});
