import { readFileSync } from 'node:fs';
import path from 'node:path';

import { licenseBlocks } from '../license-blocks';
import { NUNITO_LICENSE } from '../nunito-license';

/**
 * The font's licence must ship with the app as its authors wrote it (OFL,
 * condition 2). The copy in the bundle is checked against the installed
 * package, so a new version of the font with a new line cannot drift past it.
 */

function packageLicense(): string {
  const root = path.dirname(require.resolve('@expo-google-fonts/nunito/package.json'));
  return readFileSync(path.join(root, 'LICENSE_FONT'), 'utf8');
}

/** The same text whatever the line endings and trailing spaces. */
function normalized(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}

function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== '' && !/^-+$/.test(word));
}

test('is the package’s licence, word for word', () => {
  expect(NUNITO_LICENSE).toBe(normalized(packageLicense()));
});

test('carries the copyright line and the OFL 1.1', () => {
  expect(NUNITO_LICENSE).toMatch(/^Copyright 2014 The Nunito Project Authors/);
  expect(NUNITO_LICENSE).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007');
});

describe('on a phone screen', () => {
  const blocks = licenseBlocks(NUNITO_LICENSE);

  test('the hard-wrapped lines flow as paragraphs', () => {
    for (const block of blocks) {
      if (block.kind !== 'rule') {
        expect(block.text).not.toContain('\n');
      }
    }
  });

  test('the sections are headings, the dashed lines rules', () => {
    const headings = blocks.flatMap((block) => (block.kind === 'heading' ? [block.text] : []));
    expect(headings).toEqual([
      'SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007',
      'PREAMBLE',
      'DEFINITIONS',
      'PERMISSION & CONDITIONS',
      'TERMINATION',
      'DISCLAIMER',
    ]);
    expect(blocks.filter((block) => block.kind === 'rule')).toHaveLength(2);
  });

  test('begins with the copyright line', () => {
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      text: 'Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)',
    });
  });

  test('not a word of the licence is lost', () => {
    const shown = blocks.flatMap((block) => (block.kind === 'rule' ? [] : words(block.text)));
    expect(shown).toEqual(words(NUNITO_LICENSE));
  });
});
