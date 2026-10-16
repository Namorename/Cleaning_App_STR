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

/** SQL without its `--` comments, which carry quotes and semicolons of their own. */
function withoutComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
}

function enumLabels(sql: string, type: string): string[] {
  const body = new RegExp(`create type public\\.${type} as enum \\(([\\s\\S]*?)\\n\\);`).exec(
    sql,
  )?.[1];
  if (body === undefined) {
    throw new Error(`No enum ${type}`);
  }
  return [...withoutComments(body).matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
}

function tableBody(sql: string, table: string): string {
  const body = new RegExp(`create table public\\.${table} \\(([\\s\\S]*?)\\n\\);`).exec(sql)?.[1];
  if (body === undefined) {
    throw new Error(`No table ${table}`);
  }
  return body;
}

/** The body each function has now: its last definition across the migrations. */
const LATEST_BODIES: ReadonlyMap<string, string> = new Map(
  [
    ...ALL_SQL.matchAll(
      /create (?:or replace )?function public\.(\w+)\([\s\S]*?\$\$([\s\S]*?)\$\$;/g,
    ),
  ].map((match) => [match[1], withoutComments(match[2])]),
);

function latestBody(name: string): string {
  const body = LATEST_BODIES.get(name);
  if (body === undefined) {
    throw new Error(`No function ${name}`);
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

/** The log's one name on the whole page, and its row of section 2. */
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
  {
    lead: string;
    actor: string;
    cause: string;
    hours: string;
    noText: string;
    readers: string;
    period: string;
    deletion: string;
  }
> = {
  en: {
    lead: 'Work log.',
    actor:
      'Each entry records who made the change (your account, a colleague’s, a manager’s or the head technician’s, or the system)',
    cause:
      'the reason for a cancellation, a take-off or a move (for example, that an account was switched off or a booking was cancelled)',
    hours: 'the dates, repair visit hours, places, urgency and statuses involved.',
    noText: 'It records no text you write, no photos or videos and no geolocation of your phone.',
    readers:
      'The managers of your company see the whole log; the head technician also sees the part about tasks and the repairs done on them. Other staff cannot see it, and nobody can change it in the app.',
    period:
      'For now the log is kept without a time limit: automatic deletion of entries older than 24 months is being introduced (section 5).',
    deletion:
      'If your account is deleted (section 5), the entries stay but are no longer linked to your account: where an entry records whom the work was given to or taken from, only the deleted account’s identifier remains, and it no longer leads to your name.',
  },
  cs: {
    lead: 'Záznam práce.',
    actor:
      'Každý záznam obsahuje, kdo změnu provedl (váš účet, účet kolegy, manažera nebo hlavního technika, nebo systém)',
    cause:
      'důvod zrušení, odebrání nebo přesunu (například že byl účet deaktivován nebo rezervace zrušena)',
    hours: 'dotčená data, hodiny návštěvy opravy, místa, naléhavost a stavy.',
    noText:
      'Nezaznamenává žádný text, který píšete, žádné fotografie ani videa a žádnou geolokaci telefonu.',
    readers:
      'Manažeři vaší společnosti vidí celý záznam; hlavní technik vidí navíc část o úkolech a opravách k nim. Ostatní pracovníci ho nevidí a v aplikaci ho nikdo nemůže změnit.',
    period:
      'Zatím záznam uchováváme bez časového omezení: automatické mazání záznamů starších než 24 měsíců zavádíme (oddíl 5).',
    deletion:
      'Pokud bude váš účet smazán (oddíl 5), záznamy zůstanou, ale už nebudou spojeny s vaším účtem: kde záznam uvádí, komu byla práce přidělena nebo odebrána, zůstane jen identifikátor smazaného účtu, který už nevede k vašemu jménu.',
  },
  ru: {
    lead: 'Журнал работы.',
    actor:
      'В каждой записи — кто внёс изменение (ваша учётная запись, учётная запись коллеги, менеджера или главного техника либо система)',
    cause:
      'причина отмены, снятия или переноса (например, что учётную запись отключили или бронь отменили)',
    hours: 'а также даты, часы визита по ремонту, объекты, срочность и статусы.',
    noText: 'Тексты, которые вы пишете, фото, видео и геолокация телефона в журнал не попадают.',
    readers:
      'Менеджеры вашей компании видят весь журнал; главный техник — ещё и часть о заданиях и ремонтах по ним. Другие сотрудники его не видят, и изменить его в приложении нельзя никому.',
    period:
      'Пока журнал хранится без ограничения срока: автоматическое удаление записей старше 24 месяцев вводится (раздел 5).',
    deletion:
      'Если вашу учётную запись удалят (раздел 5), записи останутся, но больше не будут связаны с вашей учётной записью: там, где запись говорит, кому работу дали или у кого сняли, останется только идентификатор удалённой учётной записи, и он уже не ведёт к вашему имени.',
  },
};

/** Section 5's row: the same name, and the same honest period — no deletion runs yet. */
const RETENTION: Record<Language, { period: string; oldName: string; promise: string }> = {
  en: {
    period:
      'Currently without a time limit. Automatic deletion of entries older than 24 months is being introduced',
    oldName: 'Activity log',
    promise: 'and then delete it',
  },
  cs: {
    period: 'Nyní bez časového omezení. Automatické mazání záznamů starších než 24 měsíců zavádíme',
    oldName: 'Protokol činností',
    promise: 'potom ho smažeme',
  },
  ru: {
    period:
      'Сейчас — без ограничения срока. Автоматическое удаление записей старше 24 месяцев вводится',
    oldName: 'Журнал действий',
    promise: 'затем удаляем',
  },
};

/** The head technician on the rest of the page: a role, a recipient, and the basis for the log. */
const ELSEWHERE: Record<Language, { roles: string; headTech: string; interest: string }> = {
  en: {
    roles: 'role (cleaner, technician, head technician, manager)',
    headTech:
      'the head technician — all of the company’s tasks and the repairs done on them, with their photos, checklist marks and messages, and the part of the work log about them;',
    interest: 'reports to the company’s owner and sorting out disputed cases from the work log',
  },
  cs: {
    roles: 'role (uklízečka, technik, hlavní technik, manažer)',
    headTech:
      'hlavní technik — všechny úkoly společnosti a opravy k nim, včetně fotografií, odškrtnutých kroků a zpráv, a část záznamu práce o nich;',
    interest: 'přehledy pro majitele společnosti a vyjasnění sporných případů ze záznamu práce',
  },
  ru: {
    roles: 'роль (горничная, техник, главный техник, менеджер)',
    headTech:
      'главный техник — все задания компании и ремонты по ним, с фото, отметками шагов и перепиской, а также часть журнала работы о них;',
    interest: 'отчёты владельцу компании и разбор спорных случаев по журналу работы',
  },
};

const LANGUAGES = ['en', 'cs', 'ru'] as const;

/** The page in one language, with every value the owner gave; returns its `main`. */
function renderPage(language: Language): HTMLElement {
  render(<PrivacyPolicy language={language} operator={OPERATOR} settings={PRIVACY_SETTINGS} />);
  return screen.getByRole('main');
}

function section(number: number): HTMLElement {
  return screen.getByRole('region', { name: new RegExp(`^${number}\\. `) });
}

/** The work log's two list items — section 2's only list: cleanings, then tasks and their repairs. */
function workLogItems(): [string, string] {
  const items = within(within(section(2)).getByRole('list'))
    .getAllByRole('listitem')
    .map((item) => item.textContent ?? '');
  expect(items).toHaveLength(2);
  return [items[0], items[1]];
}

/**
 * The owner's decisions of 15.10 and 16.10: the policy says that work is logged
 * — two journals, `task_events` (cleanings, inspections and repairs set up
 * without a task) and `problem_events` (tasks and the repairs on them) — and,
 * like section 5, that nothing deletes the log by age yet: deletion of entries
 * older than 24 months is being introduced (docs/privacy-policy-draft.md).
 */
describe('the work log in the privacy policy', () => {
  test.each(LANGUAGES)('%s: section 2 has a row for the work log', (language) => {
    renderPage(language);

    const table = within(section(2)).getByRole('table');
    const row = within(table).getByRole('rowheader', { name: ROW[language].what }).closest('tr');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent(ROW[language].examples);
    expect(row).toHaveTextContent(ROW[language].why);
  });

  test.each(LANGUAGES)('%s: the paragraph under the table says what the log holds', (language) => {
    renderPage(language);
    const text = section(2).textContent ?? '';

    const lead = within(section(2)).getByText(CLAIMS[language].lead);
    expect(lead.tagName).toBe('STRONG');
    for (const claim of Object.values(CLAIMS[language])) {
      expect(text).toContain(claim);
    }
  });

  test.each(LANGUAGES)('%s: each kind of cleaning event is named', (language) => {
    renderPage(language);
    const [cleanings] = workLogItems();

    for (const words of Object.values(CLEANING_KINDS)) {
      if (words[language] === CLEANING_KINDS.status_changed[language]) {
        continue;
      }
      expect(cleanings).toContain(words[language]);
    }
  });

  test.each(LANGUAGES)('%s: each kind of task and repair event is named', (language) => {
    renderPage(language);
    const [, tasks] = workLogItems();

    for (const words of Object.values(TASK_KINDS)) {
      if (words[language] === TASK_KINDS.status_changed[language]) {
        continue;
      }
      expect(tasks).toContain(words[language]);
    }
    expect(section(2).textContent).toContain(TASK_KINDS.status_changed[language]);
  });
});

describe('the rest of the page agrees with the paragraph', () => {
  test.each(LANGUAGES)(
    '%s: section 5 names the log the same and promises no deletion that does not run',
    (language) => {
      const main = renderPage(language);

      const table = within(section(5)).getByRole('table');
      const row = within(table).getByRole('rowheader', { name: ROW[language].what }).closest('tr');
      expect(row).toHaveTextContent(RETENTION[language].period);
      expect(main.textContent).not.toContain(RETENTION[language].oldName);
      expect(main.textContent).not.toContain(RETENTION[language].promise);
    },
  );

  test.each(LANGUAGES)('%s: the head technician is a role and a recipient', (language) => {
    renderPage(language);

    expect(section(2).textContent).toContain(ELSEWHERE[language].roles);
    const recipients = within(section(4))
      .getAllByRole('listitem')
      .map((item) => item.textContent);
    expect(recipients).toContain(ELSEWHERE[language].headTech);
    expect(within(section(4)).getByText(ELSEWHERE[language].headTech.split(' — ')[0]).tagName).toBe(
      'STRONG',
    );
  });

  test.each(LANGUAGES)('%s: legitimate interest covers what the log is for', (language) => {
    renderPage(language);

    expect(section(3).textContent).toContain(ELSEWHERE[language].interest);
  });

  test.each(LANGUAGES)('%s: nothing is left to fill in and no mark is printed', (language) => {
    const main = renderPage(language);

    expect(main.textContent).not.toMatch(/\[|\]|\{\{|\}\}|<\/?b>/);
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

  test('the journals are written from ids, days, hours, statuses, urgency and codes only', () => {
    const writers = [...LATEST_BODIES]
      .filter(([, body]) => /insert into public\.(task|problem)_events/.test(body))
      .map(([name]) => name)
      .sort();
    expect(writers).toEqual([
      'journal_problem_change',
      'journal_repair_change',
      'journal_task_change',
    ]);

    // Every column of tasks and problems the journals read: none of them is text a person types.
    const allowed = [
      'archived_at',
      'assignee_id',
      'host_id',
      'id',
      'priority',
      'problem_id',
      'property_id',
      'reservation_id',
      'scheduled_date',
      'status',
      'time_from',
      'time_to',
    ];
    for (const name of writers) {
      const columns = new Set(
        [...latestBody(name).matchAll(/\b(?:new|old)\.(\w+)/g)].map((match) => match[1]),
      );
      expect([...columns].filter((column) => !allowed.includes(column))).toEqual([]);
      // The causes a server function names for its write are codes, never words.
      const settings = [...latestBody(name).matchAll(/current_setting\('([\w.]+)'/g)].map(
        (match) => match[1],
      );
      expect(
        settings.filter(
          (setting) =>
            ![
              'str_ops.task_cause',
              'str_ops.take_off_cause',
              'str_ops.head_tech_dispatch',
            ].includes(setting),
        ),
      ).toEqual([]);
    }
    expect(latestBody('journal_task_change')).toMatch(
      /if v_named not in \('manager', 'head_tech', 'staff', 'staff_inactive', 'booking_cancelled',\s+'property_unavailable', 'booking_changed', 'system'\) then\s+v_named := null;/,
    );
    expect(latestBody('take_off_repairs')).toMatch(
      /if p_cause is not null and p_cause <> 'account_disabled' then/,
    );
  });

  test('a deleted account leaves its entries without a link to it', () => {
    for (const [table, sql] of [
      ['task_events', TASK_EVENTS_SQL],
      ['problem_events', PROBLEM_EVENTS_SQL],
    ] as const) {
      expect(tableBody(sql, table)).toMatch(
        /actor_id\s+uuid references public\.profiles \(id\) on delete set null/,
      );
    }
    // The identifiers kept in `params` lead nowhere once the account is gone:
    // deleting the account deletes its profile, which holds the name.
    expect(ALL_SQL).toMatch(/id\s+uuid primary key references auth\.users\(id\) on delete cascade/);
  });
});
