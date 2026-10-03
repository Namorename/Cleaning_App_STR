import { readFileSync } from 'node:fs';
import path from 'node:path';

import { SUPPORTED_LANGUAGES, translations } from '@str-ops/shared';
import { describe, expect, test } from 'vitest';

const LAYOUT = path.resolve(__dirname, '../../app/layout.tsx');

/**
 * The owner's decision 8 (docs/design/decisions.md): the panel is «woom» —
 * lowercase, the same word in every language. The logo's text and the
 * sign-in card read it from `panel.title`, the browser tab from the root
 * layout's metadata.
 */
describe('the panel’s name', () => {
  test.each(SUPPORTED_LANGUAGES)('%s calls the panel «woom»', (language) => {
    expect(translations[language].panel.title).toBe('woom');
  });

  test('is the browser tab’s title', () => {
    // The root layout loads next/font, which only Next compiles: its source
    // is read instead, as the font's guard does (lib/design/__tests__).
    expect(readFileSync(LAYOUT, 'utf8')).toMatch(/\btitle: 'woom',/);
  });
});
