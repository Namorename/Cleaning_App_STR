import { describe, expect, test } from 'vitest';

import { toCsv } from '../csv';

describe('toCsv', () => {
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
