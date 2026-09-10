import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, test } from 'vitest';

import { columnName, xlsxBytes } from '../xlsx';

describe('columnName', () => {
  test('counts in letters the way spreadsheets do', () => {
    expect(columnName(0)).toBe('A');
    expect(columnName(25)).toBe('Z');
    expect(columnName(26)).toBe('AA');
    expect(columnName(27)).toBe('AB');
    expect(columnName(701)).toBe('ZZ');
  });
});

describe('xlsxBytes', () => {
  test('packs the parts a spreadsheet opens, with strings inline and numbers as numbers', () => {
    const parts = unzipSync(
      xlsxBytes('Закупка: осень/2026', [
        ['Название', 'Кол-во'],
        ['Мешки <60 л> & "прочее"', 2.5],
        [null, 3],
      ]),
    );

    expect(Object.keys(parts).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);

    const sheet = strFromU8(parts['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain(
      '<c r="A1" t="inlineStr"><is><t xml:space="preserve">Название</t></is></c>',
    );
    expect(sheet).toContain(
      '<t xml:space="preserve">Мешки &lt;60 л&gt; &amp; &quot;прочее&quot;</t>',
    );
    expect(sheet).toContain('<c r="B2"><v>2.5</v></c>');
    expect(sheet).toContain('<row r="3"><c r="B3"><v>3</v></c></row>');

    const hostile = strFromU8(
      unzipSync(xlsxBytes('x', [['=HYPERLINK("https://evil.example")', -1]]))[
        'xl/worksheets/sheet1.xml'
      ],
    );
    expect(hostile).toContain(
      '<t xml:space="preserve">\'=HYPERLINK(&quot;https://evil.example&quot;)</t>',
    );
    expect(hostile).toContain('<c r="B1"><v>-1</v></c>');

    const workbook = strFromU8(parts['xl/workbook.xml']);
    expect(workbook).toContain('<sheet name="Закупка  осень 2026" sheetId="1" r:id="rId1"/>');
  });
});
