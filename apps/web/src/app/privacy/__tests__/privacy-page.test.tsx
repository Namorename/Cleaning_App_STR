import type { Language } from '@str-ops/shared';
import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { expectPageTitle } from '@/components/page-header.expect';

// The marker that keeps the operator's details out of a client bundle; Next
// resolves it at build time, the tests have nothing to guard.
vi.mock('server-only', () => ({}));

import PrivacyPage, { generateMetadata } from '../page';
import { PrivacyPolicy } from '../privacy-policy';
import type { OperatorDetails } from '../operator';
import { PRIVACY_SETTINGS, type PrivacySettings } from '../settings';

const OPERATOR_ENV = [
  'PRIVACY_OPERATOR_NAME',
  'PRIVACY_OPERATOR_ID',
  'PRIVACY_OPERATOR_ADDRESS',
  'PRIVACY_CONTACT_EMAIL',
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
});

/** The deployment as it stands before the owner fills anything in. */
function emptyOperatorEnv(): void {
  for (const name of OPERATOR_ENV) {
    vi.stubEnv(name, '');
  }
}

async function renderPage(lang?: string | string[]): Promise<void> {
  const searchParams = Promise.resolve(lang === undefined ? {} : { lang });
  render(await PrivacyPage({ searchParams }));
}

const PAGE: Record<Language, { title: string; tab: string; sections: string[] }> = {
  cs: {
    title: 'Zásady ochrany osobních údajů aplikace woom',
    tab: 'Zásady ochrany osobních údajů — woom',
    sections: [
      '1. Kdo vaše údaje zpracovává',
      '2. Jaké údaje zpracováváme a proč',
      '3. Právní základy',
      '4. Kdo vaše údaje dostává',
      '5. Jak dlouho údaje uchováváme',
      '6. Push oznámení',
      '7. Vaše práva',
      '8. Jak údaje chráníme',
      '9. Změny',
    ],
  },
  en: {
    title: 'Privacy policy of the woom app',
    tab: 'Privacy policy — woom',
    sections: [
      '1. Who processes your data',
      '2. What data we process and why',
      '3. Legal bases',
      '4. Who receives your data',
      '5. How long we keep data',
      '6. Push notifications',
      '7. Your rights',
      '8. How we protect data',
      '9. Changes',
    ],
  },
  ru: {
    title: 'Политика конфиденциальности приложения woom',
    tab: 'Политика конфиденциальности — woom',
    sections: [
      '1. Кто обрабатывает ваши данные',
      '2. Какие данные мы обрабатываем и зачем',
      '3. Правовые основания',
      '4. Кто получает ваши данные',
      '5. Как долго мы храним данные',
      '6. Push-уведомления',
      '7. Ваши права',
      '8. Как мы защищаем данные',
      '9. Изменения',
    ],
  },
};

/** The page's headings in document order, as a screen reader lists them. */
function headings(): { level: number; name: string }[] {
  return screen.getAllByRole('heading').map((heading) => ({
    level: Number(heading.tagName.slice(1)),
    name: heading.textContent ?? '',
  }));
}

/**
 * Decision 17 (docs/f11-plan.md): the privacy policy is a public page of the
 * panel, Czech first, with English and Russian; the text is
 * docs/privacy-policy-draft.md up to its section 9.
 */
describe('the privacy policy page', () => {
  // Night of 2026-10-10, block 6: where the company allows the gallery, a
  // video may come from it, with whatever its file says of where it was made.
  test.each([
    ['cs', /místa natočení; ta neodstraňujeme/],
    ['en', /including where it was recorded; we do not remove it/],
    ['ru', /включая место съёмки, — мы их не удаляем/],
  ] as const)('%s: a video from the gallery keeps its metadata, and says so', async (language, said) => {
    emptyOperatorEnv();

    await renderPage(language);

    expect(screen.getByText(said)).toBeInTheDocument();
  });

  test.each(['cs', 'en', 'ru'] as const)(
    '%s: the title, then the nine sections in order',
    async (language) => {
      emptyOperatorEnv();

      await renderPage(language);

      expectPageTitle(PAGE[language].title);
      expect(headings()).toEqual([
        { level: 1, name: PAGE[language].title },
        ...PAGE[language].sections.map((name) => ({ level: 2, name })),
      ]);
      expect(screen.getByRole('main')).toHaveAttribute('lang', language);
    },
  );

  test('speaks Czech when the address names no language', async () => {
    emptyOperatorEnv();

    await renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(PAGE.cs.title);
    expect(screen.getByRole('main')).toHaveAttribute('lang', 'cs');
  });

  test.each([['de'], [['en', 'ru']], ['']])(
    'speaks Czech when the address names a language it does not have: %j',
    async (lang) => {
      emptyOperatorEnv();

      await renderPage(lang);

      expect(screen.getByRole('main')).toHaveAttribute('lang', 'cs');
    },
  );

  test('leads to the other two languages, each named in its own', async () => {
    emptyOperatorEnv();

    await renderPage('cs');

    const languages = screen.getByRole('navigation', {
      name: 'Tato stránka v dalších jazycích',
    });
    const links = within(languages).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['English', 'Русский']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/privacy?lang=en',
      '/privacy?lang=ru',
    ]);
    expect(links.map((link) => link.getAttribute('lang'))).toEqual(['en', 'ru']);
    expect(links.map((link) => link.getAttribute('hreflang'))).toEqual(['en', 'ru']);
  });

  test('from English, leads to Czech and Russian', async () => {
    emptyOperatorEnv();

    await renderPage('en');

    const languages = screen.getByRole('navigation', { name: 'This page in other languages' });
    expect(
      within(languages)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Čeština', 'Русский']);
  });

  test.each(['cs', 'en', 'ru'] as const)(
    '%s: the browser tab reads the page’s name',
    async (language) => {
      const metadata = await generateMetadata({
        searchParams: Promise.resolve({ lang: language }),
      });

      expect(metadata.title).toBe(PAGE[language].tab);
    },
  );

  test('the browser tab is Czech by default', async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) });

    expect(metadata.title).toBe(PAGE.cs.tab);
  });

  test('every table heads its columns and its rows', async () => {
    emptyOperatorEnv();

    await renderPage('en');

    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(3);
    expect(tables.map((table) => within(table).getAllByRole('columnheader').length)).toEqual([
      3, 3, 2,
    ]);
    expect(tables.map((table) => within(table).getAllByRole('rowheader').length)).toEqual([
      7, 6, 8,
    ]);
    expect(within(tables[1]).getByRole('rowheader', { name: 'Supabase' })).toBeInTheDocument();
  });
});

/** The owner's own details, read on the server from the deployment's environment. */
describe('the operator’s details', () => {
  const VALUES: Record<(typeof OPERATOR_ENV)[number], { value: string; placeholder: string }> = {
    PRIVACY_OPERATOR_NAME: {
      value: 'Příklad s.r.o.',
      placeholder: '[doplnit: obchodní firma nebo jméno]',
    },
    PRIVACY_OPERATOR_ID: { value: '12345678', placeholder: '[doplnit: číslo]' },
    PRIVACY_OPERATOR_ADDRESS: {
      value: 'Vzorová 1, 110 00 Praha 1',
      placeholder: '[doplnit: adresa]',
    },
    PRIVACY_CONTACT_EMAIL: {
      value: 'soukromi@example.cz',
      placeholder: '[doplnit: e-mail pro dotazy k osobním údajům]',
    },
  };

  test.each(OPERATOR_ENV)('%s left empty is a bold placeholder', async (name) => {
    emptyOperatorEnv();

    await renderPage('cs');

    const placeholders = screen.getAllByText(VALUES[name].placeholder);
    expect(placeholders.length).toBeGreaterThan(0);
    for (const placeholder of placeholders) {
      expect(placeholder.tagName).toBe('STRONG');
    }
  });

  test.each(OPERATOR_ENV)('%s set replaces its placeholder', async (name) => {
    emptyOperatorEnv();
    vi.stubEnv(name, `  ${VALUES[name].value}  `);

    await renderPage('cs');

    const text = screen.getByRole('main').textContent ?? '';
    expect(text).toContain(VALUES[name].value);
    expect(text).not.toContain(VALUES[name].placeholder);
  });

  test('a value of blanks is no value', async () => {
    emptyOperatorEnv();
    vi.stubEnv('PRIVACY_OPERATOR_NAME', '   ');

    await renderPage('cs');

    expect(screen.getByText(VALUES.PRIVACY_OPERATOR_NAME.placeholder)).toBeInTheDocument();
  });

  test('the e-mail is a link to write to, in the operator’s section and in the rights', async () => {
    emptyOperatorEnv();
    vi.stubEnv('PRIVACY_CONTACT_EMAIL', 'soukromi@example.cz');

    await renderPage('cs');

    const links = screen.getAllByRole('link', { name: 'soukromi@example.cz' });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute('href', 'mailto:soukromi@example.cz');
    }
  });

  test('the operator stands in one sentence', async () => {
    emptyOperatorEnv();
    vi.stubEnv('PRIVACY_OPERATOR_NAME', 'Příklad s.r.o.');
    vi.stubEnv('PRIVACY_OPERATOR_ID', '12345678');
    vi.stubEnv('PRIVACY_OPERATOR_ADDRESS', 'Vzorová 1, 110 00 Praha 1');
    vi.stubEnv('PRIVACY_CONTACT_EMAIL', 'soukromi@example.cz');

    await renderPage('cs');

    expect(screen.getByRole('main').textContent).toContain(
      'Správce osobních údajů: Příklad s.r.o., IČO 12345678, Vzorová 1, 110 00 Praha 1. ' +
        'S dotazy k osobním údajům pište na soukromi@example.cz.',
    );
  });
});

const NOTHING_KNOWN: OperatorDetails = { name: null, id: null, address: null, email: null };

const NOTHING_SET: PrivacySettings = {
  effectiveDate: null,
  automaticDeletionDate: null,
  signInBlockDate: null,
  accountDeletedBy: null,
  accountRetentionMonths: null,
  vercelRegion: null,
  sentryRegion: null,
  serverLogRetention: null,
  exportFormat: null,
  processingAgreementsSigned: null,
  transferBasisChecked: null,
};

const EVERYTHING_SET: PrivacySettings = {
  effectiveDate: '2026-11-01',
  automaticDeletionDate: '2027-03-01',
  signInBlockDate: '2026-12-01',
  accountDeletedBy: {
    cs: 'administrátor společnosti',
    en: 'the company’s administrator',
    ru: 'администратор компании',
  },
  accountRetentionMonths: 6,
  vercelRegion: { cs: 'EU (Frankfurt)', en: 'EU (Frankfurt)', ru: 'ЕС (Франкфурт)' },
  sentryRegion: { cs: 'EU (Frankfurt)', en: 'EU (Frankfurt)', ru: 'ЕС (Франкфурт)' },
  serverLogRetention: { cs: 'nejvýše 7 dní', en: 'up to 7 days', ru: 'до 7 дней' },
  exportFormat: 'JSON',
  processingAgreementsSigned: true,
  transferBasisChecked: true,
};

const EVERYONE_KNOWN: OperatorDetails = {
  name: 'Příklad s.r.o.',
  id: '12345678',
  address: 'Vzorová 1, 110 00 Praha 1',
  email: 'soukromi@example.cz',
};

const MARKER: Record<Language, string> = { cs: 'doplnit', en: 'to fill in', ru: 'вписать' };

/**
 * What only the owner knows — the operator, the dates, the regions, the
 * periods, the export format, and the two statements the draft leaves in
 * square brackets — is never made up: until it is given, the page says, in
 * bold, what to write there.
 */
describe('the values only the owner knows', () => {
  test.each(['cs', 'en', 'ru'] as const)(
    '%s: with nothing given, each is a bold placeholder that says what to fill in',
    (language) => {
      const { container } = render(
        <PrivacyPolicy language={language} operator={NOTHING_KNOWN} settings={NOTHING_SET} />,
      );

      const marked = [...container.querySelectorAll('strong')].filter((element) =>
        element.textContent?.includes(MARKER[language]),
      );
      const mentions = (container.textContent ?? '').split(MARKER[language]).length - 1;
      // The operator's four details, the e-mail again under the rights, three
      // dates, who deletes and when, two regions, the log period, the export
      // format, and the two statements in brackets.
      expect(marked).toHaveLength(16);
      expect(mentions).toBe(16);
      for (const placeholder of marked) {
        expect(placeholder.textContent).toMatch(/^\[.+\]$/);
      }
    },
  );

  test.each(['cs', 'en', 'ru'] as const)(
    '%s: with everything given, no placeholder is left',
    (language) => {
      const { container } = render(
        <PrivacyPolicy language={language} operator={EVERYONE_KNOWN} settings={EVERYTHING_SET} />,
      );

      expect(container.textContent).not.toContain(MARKER[language]);
      expect(container.textContent).not.toMatch(/\[|\]/);
    },
  );

  test('a date is written out in the reader’s language', () => {
    render(<PrivacyPolicy language="en" operator={EVERYONE_KNOWN} settings={EVERYTHING_SET} />);

    expect(screen.getByRole('main').textContent).toContain('Effective from: 1 Nov 2026');
  });

  test.each([
    ['cs', 6, '6 měsíců po deaktivaci'],
    ['cs', 3, '3 měsíce po deaktivaci'],
    ['ru', 3, 'через 3 месяца после отключения'],
    ['ru', 6, 'через 6 месяцев после отключения'],
    ['en', 1, '1 month after the switch-off'],
  ] as const)('%s reads %i months as “%s”', (language, months, expected) => {
    render(
      <PrivacyPolicy
        language={language}
        operator={EVERYONE_KNOWN}
        settings={{ ...EVERYTHING_SET, accountRetentionMonths: months }}
      />,
    );

    expect(screen.getByRole('main').textContent).toContain(expected);
  });

  test('a confirmed statement is plain text, an unconfirmed one a bold placeholder', () => {
    const { unmount } = render(
      <PrivacyPolicy language="cs" operator={EVERYONE_KNOWN} settings={EVERYTHING_SET} />,
    );
    const confirmed = screen.getByText(/jsou uzavřeny smlouvy o zpracování osobních údajů/);
    expect(confirmed.tagName).not.toBe('STRONG');
    unmount();

    render(<PrivacyPolicy language="cs" operator={EVERYONE_KNOWN} settings={NOTHING_SET} />);
    expect(
      screen.getByText('[jsou uzavřeny smlouvy o zpracování osobních údajů — doplnit: potvrdit]')
        .tagName,
    ).toBe('STRONG');
  });

  test('the owner’s region and who deletes stand where the draft left them open', () => {
    render(<PrivacyPolicy language="ru" operator={EVERYONE_KNOWN} settings={EVERYTHING_SET} />);

    const vendors = screen.getAllByRole('table')[1];
    const vercel = within(vendors).getByRole('rowheader', { name: 'Vercel' }).closest('tr');
    expect(vercel).toHaveTextContent('ЕС (Франкфурт)');
    expect(screen.getByRole('main').textContent).toContain(
      'его выполняет администратор компании по вашему письму на адрес из раздела 1',
    );
  });
});

// The owner's values of 2026-10-10. Only the two statements stay open: the
// owner accepts the suppliers' agreements himself and then confirms them.
describe('the values the owner gave', () => {
  test('as published', () => {
    expect(PRIVACY_SETTINGS).toMatchObject({
      effectiveDate: '2026-10-12',
      automaticDeletionDate: '2027-03-31',
      signInBlockDate: '2026-11-30',
      accountRetentionMonths: 6,
      exportFormat: 'CSV',
      // Confirmed by the owner on 2026-10-10, 21:00 (docs/privacy-dpa-links.md).
      processingAgreementsSigned: true,
      transferBasisChecked: true,
    });
  });

  test.each(['cs', 'en', 'ru'] as const)(
    '%s: with the operator\'s details set, nothing is left to fill in',
    (language) => {
      const { container } = render(
        <PrivacyPolicy language={language} operator={EVERYONE_KNOWN} settings={PRIVACY_SETTINGS} />,
      );

      expect(container.querySelectorAll('[data-placeholder]')).toHaveLength(0);
      expect(container.textContent).not.toContain(MARKER[language]);
      expect(container.textContent).not.toMatch(/\[|\]/);
    },
  );

  test('in force from 12 October 2026', () => {
    render(<PrivacyPolicy language="en" operator={EVERYONE_KNOWN} settings={PRIVACY_SETTINGS} />);

    expect(screen.getByRole('main').textContent).toContain('Effective from: 12 Oct 2026');
  });

  test.each([
    [
      'ru',
      'его выполняет оператор по вашему письму на адрес из раздела 1 или через 6 месяцев после отключения',
    ],
    [
      'en',
      'it is carried out by the controller at your request by e-mail to the address in section 1, or 6 months after the switch-off',
    ],
    [
      'cs',
      'provádí ho správce na vaši žádost zaslanou e-mailem na adresu z oddílu 1, nebo 6 měsíců po deaktivaci',
    ],
  ] as const)('%s: the operator deletes an account on a letter, or six months on', (language, text) => {
    render(
      <PrivacyPolicy language={language} operator={EVERYONE_KNOWN} settings={PRIVACY_SETTINGS} />,
    );

    expect(screen.getByRole('main').textContent).toContain(text);
  });

  test.each([
    ['ru', 'ЕС (Франкфурт)', 'ЕС (Франкфурт)'],
    ['en', 'EU (Frankfurt)', 'EU (Frankfurt)'],
    ['cs', 'EU (Frankfurt)', 'EU (Frankfurt)'],
  ] as const)(
    '%s: the panel and the crash reports stay in the EU',
    (language, vercel, sentry) => {
      render(
        <PrivacyPolicy language={language} operator={EVERYONE_KNOWN} settings={PRIVACY_SETTINGS} />,
      );

      const vendors = screen.getAllByRole('table')[1];
      const row = (name: string) =>
        within(vendors).getByRole('rowheader', { name }).closest('tr');
      expect(row('Vercel')).toHaveTextContent(vercel);
      expect(row('Sentry (Functional Software)')).toHaveTextContent(sentry);
    },
  );

  test.each([
    ['ru', 'по правилам поставщика, не дольше 7 дней'],
    ['en', 'according to the supplier’s rules, no longer than 7 days'],
    ['cs', 'podle pravidel dodavatele, nejvýše 7 dní'],
  ] as const)('%s: the suppliers keep server logs for a week at most', (language, text) => {
    render(
      <PrivacyPolicy language={language} operator={EVERYONE_KNOWN} settings={PRIVACY_SETTINGS} />,
    );

    expect(screen.getByRole('main').textContent).toContain(text);
  });
});

// The policy says where the panel's functions run; the project says it in
// apps/web/vercel.json (fra1, Frankfurt, since 2026-10-10). One cannot change
// without the other.
describe('the region the policy names is the region the panel is deployed to', () => {
  test('vercel.json pins the functions to fra1, and the policy says Frankfurt', () => {
    const config = JSON.parse(
      readFileSync(path.resolve(__dirname, '../../../../vercel.json'), 'utf8'),
    ) as { regions?: string[] };

    expect(config.regions).toEqual(['fra1']);
    expect(PRIVACY_SETTINGS.vercelRegion).toEqual({
      cs: 'EU (Frankfurt)',
      en: 'EU (Frankfurt)',
      ru: 'ЕС (Франкфурт)',
    });
  });
});
