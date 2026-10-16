import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

/**
 * The head technician reaches /knowledge and /settings alone (the owner's
 * decision of 2026-10-16), and only the proxy keeps him there: the shell lets
 * him in, and no page asks the role itself. The proxy's matcher passes a path
 * ending in .png and the like without the check, so a page whose dynamic
 * segment takes any text would open to him that way. Today's two dynamic
 * pages take an id (a UUID, a number) and answer such a path with «not
 * found».
 *
 * So every page of the panel is named here. A new one fails this test until
 * somebody has decided whether he may see it — and, for a free dynamic
 * segment, has made the page ask the role.
 */
const DECIDED = [
  '[...missing]',
  'analytics',
  'apartments',
  'calendar',
  'dashboard',
  'knowledge',
  'problems',
  'settings',
  'supplies',
  'tasks',
  'team',
];

describe('the pages of the panel', () => {
  test('are each a decided one', () => {
    const pages = readdirSync(join(__dirname, '../(panel)'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(pages).toEqual([...DECIDED].sort());
  });
});
