import { describe, expect, test } from 'vitest';

import { safeCellText, toCsv } from '../csv';

describe('safeCellText', () => {
  test('keeps a cell that a spreadsheet would run as a formula literal', () => {
    expect(safeCellText('=HYPERLINK("https://evil.example")')).toBe(
      "'=HYPERLINK(\"https://evil.example\")",
    );
    expect(safeCellText('+1')).toBe("'+1");
    expect(safeCellText('-5 шт')).toBe("'-5 шт");
    expect(safeCellText('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(safeCellText('\tтаб')).toBe("'\tтаб");
    expect(safeCellText('Мешки')).toBe('Мешки');
  });
});

describe('toCsv', () => {
  test('neutralises formulas in text cells but leaves numbers as numbers', () => {
    expect(toCsv([['=cmd|calc', -5]]).slice(1)).toBe("'=cmd|calc,-5\r\n");
  });

  test('quotes what needs quoting, keeps numbers bare, marks the encoding', () => {
    const csv = toCsv([
      ['Название', 'Кол-во'],
      ['Мешки, 60 л', 2],
      ['Средство "Универсал"', 1.5],
      [null, 'две\nстроки'],
    ]);

    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1)).toBe(
      'Название,Кол-во\r\n"Мешки, 60 л",2\r\n"Средство ""Универсал""",1.5\r\n,"две\nстроки"\r\n',
    );
  });
});
