import type { Language } from '@str-ops/shared';
import { render, screen, within } from '@testing-library/react';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test, vi } from 'vitest';

// The marker that keeps the operator's details out of a client bundle; Next
// resolves it at build time, the tests have nothing to guard.
vi.mock('server-only', () => ({}));

import type { OperatorDetails } from '../operator';
import { PrivacyPolicy } from '../privacy-policy';
import { PRIVACY_SETTINGS } from '../settings';

const OPERATOR: OperatorDetails = {
  name: 'Příklad s.r.o.',
  id: '12345678',
  address: 'Vzorová 1, 110 00 Praha 1',
  email: 'soukromi@example.cz',
};

const MIGRATIONS = path.resolve(__dirname, '../../../../../../supabase/migrations');

/** Every migration, in the order the database applies them. */
const ALL_SQL = readdirSync(MIGRATIONS)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(path.join(MIGRATIONS, name), 'utf8'))
  .join('\n');

function sqlOf(file: string): string {
  return readFileSync(path.join(MIGRATIONS, file), 'utf8');
}

const TASK_EVENTS_SQL = sqlOf('20261015100000_task_events.sql');
const PROBLEM_EVENTS_SQL = sqlOf('20261003140000_problem_events.sql');

function enumLabels(sql: string, type: string): string[] {
  const body = new RegExp(`create type public\\.${type} as enum \\(([\\s\\S]*?)\\n\\);`).exec(
    sql,
  )?.[1];
  if (body === undefined) {
    throw new Error(`No enum ${type}`);
  }
  // Comments beside the labels carry quotes and semicolons of their own.
  const labels = body
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
  return [...labels.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

function tableBody(sql: string, table: string): string {
  const body = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1];
  if (body === undefined) {
    throw new Error(`No table ${table}`);
  }
  return body;
}

/** The policies any migration creates on a table, by name. */
function policiesOn(table: string): string[] {
  return [...ALL_SQL.matchAll(/create policy "([^"]+)"\s+on public\.(\w+)/g)]
    .filter((match) => match[2] === table)
    .map((match) => match[1]);
}

/** Every grant any migration makes on a table, as written. */
function grantsOn(table: string): string[] {
  return [...ALL_SQL.matchAll(/grant ([^;]*?) on (?:table )?public\.(\w+) to ([^;]+);/g)]
    .filter((match) => match[2] === table)
    .map((match) => `${match[1]} to ${match[3]}`);
}

/**
 * The words that name each kind of event in the paragraph's list, per language.
 * A kind the journal gains later fails the test until the text says it.
 * `status_changed` is any other move of a status — the paragraph's "statuses".
 */
const CLEANING_KINDS: Record<string, Record<Language, string>> = {
  created: { en: 'created', cs: 'vytvoření', ru: 'создана' },
  assigned: { en: 'given to someone', cs: 'přidělení někomu', ru: 'назначена кому-то' },
  reassigned: { en: 'given to someone', cs: 'přidělení někomu', ru: 'назначена кому-то' },
  unassigned: { en: 'taken off them', cs: 'odebrání', ru: 'или снята' },
  accepted: { en: 'accepted', cs: 'přijetí', ru: 'принята' },
  started: { en: 'started', cs: 'zahájení', ru: 'начата' },
  completed: { en: 'finished', cs: 'dokončení', ru: 'завершена' },
  cancelled: { en: 'cancelled', cs: 'zrušení', ru: 'отменена' },
  expired: { en: 'expired', cs: 'propadnutí', ru: 'просрочена' },
  moved: {
    en: 'moved to another day or place',
    cs: 'přesunutí na jiný den nebo jiné místo',
    ru: 'перенесена на другой день или объект',
  },
  reopened: { en: 'reopened', cs: 'znovuotevření', ru: 'возвращена в работу' },
  status_changed: { en: 'statuses', cs: 'stavy', ru: 'статусы' },
};

const TASK_KINDS: Record<string, Record<Language, string>> = {
  reported: { en: 'reported', cs: 'nahlášení', ru: 'сообщено' },
  assigned: { en: 'given to someone', cs: 'přidělení někomu', ru: 'назначено кому-то' },
  reassigned: { en: 'given to someone', cs: 'přidělení někomu', ru: 'назначено кому-то' },
  unassigned: { en: 'taken off them', cs: 'odebrání', ru: 'или снято' },
  taken_off: { en: 'taken off them', cs: 'odebrání', ru: 'или снято' },
  rescheduled: {
    en: 'moved to another day or time',
    cs: 'přesunutí na jiný den nebo čas',
    ru: 'перенесено на другой день или время',
  },
  accepted: { en: 'accepted', cs: 'přijetí', ru: 'принято' },
  started: { en: 'started', cs: 'zahájení', ru: 'начато' },
  completed: { en: 'finished', cs: 'dokončení', ru: 'завершено' },
  attempt_cancelled: { en: 'cancelled', cs: 'zrušení', ru: 'отменено' },
  resolved: { en: 'resolved', cs: 'vyřešení', ru: 'решено' },
  cancelled: { en: 'cancelled', cs: 'zrušení', ru: 'отменено' },
  reopened: { en: 'reopened', cs: 'znovuotevření', ru: 'открыто снова' },
  archived: { en: 'put in the archive', cs: 'přesunutí do archivu', ru: 'убрано в архив' },
  unarchived: { en: 'brought back', cs: 'nebo zpět', ru: 'или возвращено' },
  status_changed: { en: 'statuses', cs: 'stavy', ru: 'статусы' },
};

const ROW: Record<Language, { what: string; examples: string; why: string }> = {
  en: {
    what: 'Work log',
    examples: 'what happened to cleanings, tasks and repairs, who did it and when',
    why: 'reports to the company’s owner, sorting out disputed cases',
  },
  cs: {
    what: 'Záznam práce',
    examples: 'co se dělo s úklidy, úkoly a opravami, kdo to udělal a kdy',
    why: 'přehledy pro majitele společnosti, vyjasnění sporných případů',
  },
  ru: {
    what: 'Журнал работы',
    examples: 'что происходило с уборками, заданиями и ремонтами, кто это сделал и когда',
    why: 'отчёты владельцу компании, разбор спорных случаев',
  },
};

/** What the paragraph says, sentence by sentence, about the facts the schema holds. */
const CLAIMS: Record<
  Language,
  { lead: string; noText: string; readers: string; period: string; deletion: string }
> = {
  en: {
    lead: 'Work log.',
    noText: 'It records no text you write, no photos or videos and no location.',
    readers:
      'The managers of your company see the whole log; the head technician also sees the part about tasks and repairs. Other staff cannot see it, and nobody can change it in the app.',
    period: 'We keep each entry for 24 months from the event and then delete it.',
    deletion: 'If your account is deleted (section 5), the entries stay but no longer name you.',
  },
  cs: {
    lead: 'Záznam práce.',
    noText: 'Nezaznamenává žádný text, který píšete, žádné fotografie ani videa a žádnou polohu.',
    readers:
      'Manažeři vaší společnosti vidí celý záznam; hlavní technik vidí navíc část o úkolech a opravách. Ostatní pracovníci ho nevidí a v aplikaci ho nikdo nemůže změnit.',
    period: 'Každý záznam uchováváme 24 měsíců od události, potom ho smažeme.',
    deletion: 'Pokud bude váš účet smazán (oddíl 5), záznamy zůstanou, ale už v nich nebude vaše jméno.',
  },
  ru: {
    lead: 'Журнал работы.',
    noText: 'Тексты, которые вы пишете, фото, видео и местоположение в журнал не попадают.',
    readers:
      'Менеджеры вашей компании видят весь журнал; главный техник — ещё и часть о заданиях и ремонтах. Другие сотрудники его не видят, и изменить его в приложении нельзя никому.',
    period: 'Каждую запись храним 24 месяца с момента события, затем удаляем.',
    deletion: 'Если вашу учётную запись удалят (раздел 5), записи останутся, но без вашего имени.',
  },
};

const LANGUAGES = ['en', 'cs', 'ru'] as const;

function renderPolicy(language: Language): HTMLElement {
  render(<PrivacyPolicy language={language} operator={OPERATOR} settings={PRIVACY_SETTINGS} />);
  return screen.getByRole('region', { name: /^2\. / });
}

/** The work log's two list items — section 2's only list: cleanings, then tasks and their repairs. */
function workLogItems(section: HTMLElement): [string, string] {
  const items = within(within(section).getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '');
  expect(items).toHaveLength(2);
  return [items[0], items[1]];
}

/**
 * The owner's decision of 15.10: the policy says that work is logged — two
 * journals, `task_events` (cleanings, inspections and repairs set up without a
 * task) and `problem_events` (tasks and the repairs on them) — and keeps each
 * entry for 24 months (docs/privacy-policy-draft.md, «Журнал работы»).
 */
describe('the work log in the privacy policy', () => {
  test.each(LANGUAGES)('%s: section 2 has a row for the work log', (language) => {
    const section = renderPolicy(language);

    const table = within(section).getByRole('table');
    const row = within(table).getByRole('rowheader', { name: ROW[language].what }).closest('tr');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent(ROW[language].examples);
    expect(row).toHaveTextContent(ROW[language].why);
  });

  test.each(LANGUAGES)('%s: the paragraph under the table says what the log holds', (language) => {
    const section = renderPolicy(language);
    const text = section.textContent ?? '';

    const lead = within(section).getByText(CLAIMS[language].lead);
    expect(lead.tagName).toBe('STRONG');
    for (const claim of Object.values(CLAIMS[language])) {
      expect(text).toContain(claim);
    }
    expect(text).not.toMatch(/\[|\]|\{\{|\}\}|<\/?b>/);
  });

  test.each(LANGUAGES)('%s: each kind of cleaning event is named', (language) => {
    const [cleanings] = workLogItems(renderPolicy(language));

    for (const words of Object.values(CLEANING_KINDS)) {
      if (words[language] === CLEANING_KINDS.status_changed[language]) {
        continue;
      }
      expect(cleanings).toContain(words[language]);
    }
  });

  test.each(LANGUAGES)('%s: each kind of task and repair event is named', (language) => {
    const section = renderPolicy(language);
    const [, tasks] = workLogItems(section);

    for (const words of Object.values(TASK_KINDS)) {
      if (words[language] === TASK_KINDS.status_changed[language]) {
        continue;
      }
      expect(tasks).toContain(words[language]);
    }
    expect(section.textContent).toContain(TASK_KINDS.status_changed[language]);
  });
});

/** The facts of the schema the paragraph stands on; a change here is a change of the text. */
describe('the work log text matches the journals in the schema', () => {
  test('the paragraph names every kind of each journal, and no other', () => {
    expect(enumLabels(TASK_EVENTS_SQL, 'task_event_kind').sort()).toEqual(
      Object.keys(CLEANING_KINDS).sort(),
    );
    expect(enumLabels(PROBLEM_EVENTS_SQL, 'problem_event_kind').sort()).toEqual(
      Object.keys(TASK_KINDS).sort(),
    );
    expect(ALL_SQL).not.toMatch(/alter type public\.(task|problem)_event_kind/);
  });

  test('cleanings are every task without a task of the board; repairs go to the tasks journal', () => {
    expect(TASK_EVENTS_SQL).toMatch(
      /create trigger tasks_journal_cleaning_insert\s+after insert on public\.tasks\s+for each row\s+when \(new\.problem_id is null\)/,
    );
    expect(TASK_EVENTS_SQL).toMatch(
      /create trigger tasks_journal_cleaning_update[\s\S]*?when \(new\.problem_id is null/,
    );
    expect(PROBLEM_EVENTS_SQL).toMatch(
      /create trigger tasks_journal_repair[\s\S]*?when \(new\.problem_id is not null and new\.type = 'maintenance'\)/,
    );
  });

  test('managers read the whole log, the head technician the tasks journal, nobody else', () => {
    expect(policiesOn('task_events')).toEqual(['managers read task events']);
    expect(policiesOn('problem_events').sort()).toEqual([
      'head tech reads problem events',
      'managers read problem events',
    ]);
    expect(ALL_SQL).not.toMatch(/(alter|drop) policy [^;]* on public\.(task|problem)_events/);
  });

  test('nobody writes or changes a journal from the app: clients may only read', () => {
    expect(grantsOn('task_events')).toEqual(['select to authenticated, service_role']);
    expect(grantsOn('problem_events')).toEqual(['select to authenticated, service_role']);
  });

  test('an entry keeps no text a person writes', () => {
    const textColumns = (table: string, sql: string) =>
      tableBody(sql, table)
        .split('\n')
        .filter((line) => /^\s+\w+\s+(text|varchar|character varying)\b/.test(line))
        .map((line) => line.trim().split(/\s+/)[0]);

    expect(textColumns('problem_events', PROBLEM_EVENTS_SQL)).toEqual([]);
    // The one text column is a code from a fixed list, not words anyone types.
    expect(textColumns('task_events', TASK_EVENTS_SQL)).toEqual(['cause']);
    expect(tableBody(TASK_EVENTS_SQL, 'task_events')).toMatch(
      /cause\s+text\s+constraint task_events_cause_known check \(cause in \(/,
    );
  });

  test('a deleted account leaves the entries without a name', () => {
    for (const [table, sql] of [
      ['task_events', TASK_EVENTS_SQL],
      ['problem_events', PROBLEM_EVENTS_SQL],
    ] as const) {
      expect(tableBody(sql, table)).toMatch(
        /actor_id\s+uuid references public\.profiles \(id\) on delete set null/,
      );
    }
  });
});
