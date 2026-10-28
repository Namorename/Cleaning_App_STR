import { isSafeHttpsUrl, parseKbMarkup, pickKbText, type KbBlock } from '@str-ops/shared';
import { describe, expect, test } from 'vitest';

const text = (value: string) => ({ kind: 'text', text: value }) as const;
const bold = (value: string) => ({ kind: 'bold', text: value }) as const;
const link = (value: string, href: string) => ({ kind: 'link', text: value, href }) as const;

describe('parseKbMarkup: blocks', () => {
  test('an empty text has no blocks', () => {
    expect(parseKbMarkup('')).toEqual([]);
    expect(parseKbMarkup('  \n\n \t\n')).toEqual([]);
  });

  test('a blank line ends a paragraph; a single line break stays inside it', () => {
    expect(parseKbMarkup('The boiler is in the hall.\nBehind the door.\n\nThe fuses are left.')).toEqual(
      [
        { kind: 'paragraph', lines: [[text('The boiler is in the hall.')], [text('Behind the door.')]] },
        { kind: 'paragraph', lines: [[text('The fuses are left.')]] },
      ] satisfies KbBlock[],
    );
  });

  test('Windows line ends read the same', () => {
    expect(parseKbMarkup('one\r\ntwo\r\n\r\nthree')).toEqual(parseKbMarkup('one\ntwo\n\nthree'));
  });

  test('a bullet list: "- " or "* " at the start of each line', () => {
    expect(parseKbMarkup('- towels\n* sheets\n- soap')).toEqual([
      { kind: 'bullets', items: [[text('towels')], [text('sheets')], [text('soap')]] },
    ]);
  });

  test('a numbered list counts on from its first number', () => {
    expect(parseKbMarkup('3. open\n3. turn\n3. close')).toEqual([
      { kind: 'numbered', start: 3, items: [[text('open')], [text('turn')], [text('close')]] },
    ]);
  });

  test('steps are numbers with a bracket, apart from a numbered list', () => {
    expect(parseKbMarkup('1) Turn the water off.\n2) Open the tap.\n\n1. a\n2. b')).toEqual([
      { kind: 'steps', start: 1, items: [[text('Turn the water off.')], [text('Open the tap.')]] },
      { kind: 'numbered', start: 1, items: [[text('a')], [text('b')]] },
    ]);
  });

  test('steps go on after a paragraph from the number written', () => {
    expect(parseKbMarkup('1) one\nA note.\n2) two')).toEqual([
      { kind: 'steps', start: 1, items: [[text('one')]] },
      { kind: 'paragraph', lines: [[text('A note.')]] },
      { kind: 'steps', start: 2, items: [[text('two')]] },
    ]);
  });

  test('an important note: "> " lines, one block until something else', () => {
    expect(parseKbMarkup('> Never leave the heater on.\n>Close the window.\nThen go.')).toEqual([
      {
        kind: 'important',
        lines: [[text('Never leave the heater on.')], [text('Close the window.')]],
      },
      { kind: 'paragraph', lines: [[text('Then go.')]] },
    ]);
  });

  test('a change of kind starts a new block without a blank line', () => {
    expect(parseKbMarkup('Take:\n- a key\n- a card')).toEqual([
      { kind: 'paragraph', lines: [[text('Take:')]] },
      { kind: 'bullets', items: [[text('a key')], [text('a card')]] },
    ]);
  });

  test('up to three spaces before a marker are allowed; a marker without text is text', () => {
    expect(parseKbMarkup('   - indented\n-\n1.')).toEqual([
      { kind: 'bullets', items: [[text('indented')]] },
      { kind: 'paragraph', lines: [[text('-')], [text('1.')]] },
    ]);
  });

  test('a number with more than three digits is no list', () => {
    expect(parseKbMarkup('2026. A year')).toEqual([
      { kind: 'paragraph', lines: [[text('2026. A year')]] },
    ]);
  });
});

describe('parseKbMarkup: inside a line', () => {
  test('**bold**', () => {
    expect(parseKbMarkup('Press **firmly** twice.')).toEqual([
      { kind: 'paragraph', lines: [[text('Press '), bold('firmly'), text(' twice.')]] },
    ]);
  });

  // As in Markdown: bold opens on a letter and closes on one, so arithmetic
  // and a lone pair of stars are left alone.
  test('stars without a pair, or with nothing inside, stay as typed', () => {
    expect(parseKbMarkup('2 ** 3 and ****')).toEqual([
      { kind: 'paragraph', lines: [[text('2 ** 3 and ****')]] },
    ]);
  });

  test('bold does not run across a line break', () => {
    expect(parseKbMarkup('**half\nline**')).toEqual([
      { kind: 'paragraph', lines: [[text('**half')], [text('line**')]] },
    ]);
  });

  test('a link [text](https://…)', () => {
    expect(parseKbMarkup('See [the manual](https://example.com/boiler.pdf) first.')).toEqual([
      {
        kind: 'paragraph',
        lines: [[text('See '), link('the manual', 'https://example.com/boiler.pdf'), text(' first.')]],
      },
    ]);
  });

  test('a bare https address is a link; the full stop after it is not part of it', () => {
    expect(parseKbMarkup('Video: https://youtu.be/abc123.')).toEqual([
      {
        kind: 'paragraph',
        lines: [[text('Video: '), link('https://youtu.be/abc123', 'https://youtu.be/abc123'), text('.')]],
      },
    ]);
  });

  test('only https is a link: http, javascript and data stay text', () => {
    const source =
      '[a](http://example.com) [b](javascript:alert(1)) [c](data:text/html,x) http://example.com';
    expect(parseKbMarkup(source)).toEqual([{ kind: 'paragraph', lines: [[text(source)]] }]);
  });

  test('HTML is text, never markup', () => {
    const source = '<b>bold</b> <script>alert(1)</script> <img src=x onerror=alert(1)>';
    expect(parseKbMarkup(source)).toEqual([{ kind: 'paragraph', lines: [[text(source)]] }]);
  });

  test('markup works inside lists, steps and the important note', () => {
    expect(parseKbMarkup('- **hot** water\n1) open https://example.com/a\n> **Stop** here')).toEqual([
      { kind: 'bullets', items: [[bold('hot'), text(' water')]] },
      {
        kind: 'steps',
        start: 1,
        items: [[text('open '), link('https://example.com/a', 'https://example.com/a')]],
      },
      { kind: 'important', lines: [[bold('Stop'), text(' here')]] },
    ]);
  });

  test('parentheses inside an address stay with it; an unpaired one after it does not', () => {
    expect(parseKbMarkup('[w](https://en.wikipedia.org/wiki/Foo_(bar)) (see https://x.cz/a_(b))')).toEqual([
      {
        kind: 'paragraph',
        lines: [
          [
            link('w', 'https://en.wikipedia.org/wiki/Foo_(bar)'),
            text(' (see '),
            link('https://x.cz/a_(b)', 'https://x.cz/a_(b)'),
            text(')'),
          ],
        ],
      },
    ]);
  });

  test('a line separator inside a list item keeps it an item', () => {
    expect(parseKbMarkup('- one more')).toEqual([
      { kind: 'bullets', items: [[text('one more')]] },
    ]);
  });

  // Each of these used to send the reader back over the whole line.
  test.each([
    ['a long run of spaces before the end', `a${' '.repeat(19998)}b`],
    ['a long run after a bullet', `- ${' '.repeat(19990)}x`],
    ['thousands of addresses with no end', 'https://'.repeat(2500)],
    ['thousands of short ones', 'https://a.b/'.repeat(1700)],
  ])('%s is read in one pass', (_name, source) => {
    const started = performance.now();
    parseKbMarkup(source);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  // Thousands of openers whose closer is far away or never comes: each one
  // must not search the rest of the line again.
  test('a long line of unmatched marks is read in one pass', () => {
    const source = `${'[a **b '.repeat(3000)}]`;
    const started = performance.now();
    const blocks = parseKbMarkup(source);
    expect(performance.now() - started).toBeLessThan(500);
    expect(blocks).toEqual([{ kind: 'paragraph', lines: [[text(source)]] }]);
  });
});

describe('isSafeHttpsUrl', () => {
  test.each([
    'https://example.com',
    'https://example.com/a/b?c=d#e',
    'https://sub.example.co.uk:8443/path',
    'https://www.youtube.com/watch?v=abc',
    'https://kotel.cz/návod',
    'HTTPS://EXAMPLE.COM/A',
  ])('takes %s', (url) => {
    expect(isSafeHttpsUrl(url)).toBe(true);
  });

  test.each([
    'http://example.com',
    'javascript:alert(1)',
    'data:text/html,x',
    'file:///etc/passwd',
    'intent://scan',
    'https://',
    'https://localhost',
    'https://user:pass@example.com',
    'https://example.com@evil.com',
    'https://exa mple.com',
    'https://example.com/a b',
    'https://example.com/\u0000',
    'https://.example.com',
    'https://example..com',
    'https://-example.com',
    'https://example.com:99999',
    'https://exam‮ple.com',
    'https://exam​ple.com',
    'https://example.com／path',
    'https://example．com',
    `https://example.com/${'a'.repeat(2048)}`,
  ])('refuses %s', (url) => {
    expect(isSafeHttpsUrl(url)).toBe(false);
  });
});

describe('pickKbText', () => {
  const original = { language: 'ru', title: 'Котёл', body: 'В коридоре.' } as const;
  const translations = {
    en: { title: 'Boiler', body: 'In the hall.' },
    cs: { title: 'Kotel', body: 'V chodbě.' },
  };

  test('the reader’s own language first', () => {
    expect(pickKbText(original, translations, 'cs')).toEqual({
      language: 'cs',
      title: 'Kotel',
      body: 'V chodbě.',
      isOriginal: false,
    });
  });

  test('the original when it is in the reader’s language', () => {
    expect(pickKbText(original, translations, 'ru')).toEqual({ ...original, isOriginal: true });
  });

  // The owner's decision of 2026-10-17 (step 2): the phone's language if there
  // is a translation, else the author's — never a third language in between.
  test('without a translation in her language, the original, not English', () => {
    expect(pickKbText(original, { en: translations.en }, 'cs')).toEqual({
      ...original,
      isOriginal: true,
    });
  });

  test('the original with no translation at all', () => {
    expect(pickKbText(original, {}, 'cs')).toEqual({ ...original, isOriginal: true });
  });

  test('a translation with a title and no text does not hide the original’s text', () => {
    expect(pickKbText(original, { cs: { title: 'Kotel', body: ' ' } }, 'cs')).toEqual({
      ...original,
      isOriginal: true,
    });
  });

  test('a translation without a title is no translation', () => {
    expect(pickKbText(original, { cs: { title: '  ', body: 'x' } }, 'cs')).toEqual({
      ...original,
      isOriginal: true,
    });
  });
});
