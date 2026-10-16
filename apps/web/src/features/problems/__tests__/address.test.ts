import { describe, expect, test } from 'vitest';

import {
  problemChatHref,
  problemHref,
  problemsHref,
  readProblemPageAddress,
  readProblemsAddress,
  readProblemsView,
  writeProblemPageAddress,
  writeProblemsAddress,
  type ProblemsAddress,
} from '../address';
import { EMPTY_PROBLEM_FILTERS, NO_PLACE, type ProblemFilters } from '../filters';

const ID = '11111111-1111-4111-8111-111111111111';
const PETR = '55555555-5555-4555-8555-555555555555';

const read = (query: string) => readProblemsAddress(new URLSearchParams(query));
const at = (
  view: ProblemsAddress['view'],
  patch: Partial<ProblemFilters> = {},
): ProblemsAddress => ({
  view,
  filters: { ...EMPTY_PROBLEM_FILTERS, ...patch },
});

describe('the address of «Задания»', () => {
  test('a bare address is the board, nothing filtered', () => {
    expect(read('')).toEqual(at('board'));
    expect(writeProblemsAddress(at('board'))).toBe('');
  });

  test('reads and writes the list and the archive, and drops anything else', () => {
    expect(read('view=list')).toEqual(at('list'));
    expect(writeProblemsAddress(at('archive'))).toBe('view=archive');
    expect(read('view=kanban')).toEqual(at('board'));
    expect(readProblemsView(['list', 'archive'])).toBe('board');
    expect(readProblemsView(undefined)).toBe('board');
  });

  // 10.10, the owner: filters by listing, assignee and date. A link keeps them.
  test('keeps the search and the filters beside the view, and reads back what it wrote', () => {
    const filtered = at('list', {
      query: 'замок',
      place: { kind: 'place', name: 'CZ - Royal — 1 - 2109' },
      assigneeId: PETR,
      dateFrom: '2026-10-01',
      dateTo: '2026-10-09',
    });

    const written = writeProblemsAddress(filtered);

    expect(written).toBe(
      `view=list&q=%D0%B7%D0%B0%D0%BC%D0%BE%D0%BA&place=CZ+-+Royal+%E2%80%94+1+-+2109&assignee=${PETR}&from=2026-10-01&to=2026-10-09`,
    );
    expect(read(written)).toEqual(filtered);
  });

  // A listing's name can be anything, so «Без объекта» is the parameter with
  // no name at all rather than a word a listing could be called.
  test('«Без объекта» and «Не назначено» go into the address and come back', () => {
    const special = at('board', { place: NO_PLACE, assigneeId: 'nobody' });

    expect(writeProblemsAddress(special)).toBe('place=&assignee=nobody');
    expect(read('place=&assignee=nobody')).toEqual(special);
  });

  // The review of 2981da8..db36705: such a link emptied the board.
  test('a range written the wrong way round is read the right way round', () => {
    expect(read('from=2026-10-10&to=2026-10-01')).toEqual(
      at('board', { dateFrom: '2026-10-01', dateTo: '2026-10-10' }),
    );
  });

  test('a value the address cannot mean is ignored, never thrown, and the rest stays', () => {
    expect(read('view=list&assignee=petr&from=yesterday&to=2026-13-40&q=kran')).toEqual(
      at('list', { query: 'kran' }),
    );
  });

  // «К списку заданий» returns to the view the manager came from: the page of
  // a task carries it in its own address.
  test('a task’s page carries the view it was opened from, and leads back to it', () => {
    expect(problemHref(ID, 'board')).toBe(`/problems/${ID}`);
    expect(problemHref(ID, 'list')).toBe(`/problems/${ID}?view=list`);
    expect(problemsHref('board')).toBe('/problems');
    expect(problemsHref('archive')).toBe('/problems?view=archive');
  });

  test('a task opened from a filtered view carries the filters, and leads back to them', () => {
    const filtered = at('list', { assigneeId: 'nobody', dateFrom: '2026-10-01' });

    expect(problemHref(ID, filtered)).toBe(
      `/problems/${ID}?view=list&assignee=nobody&from=2026-10-01`,
    );
    expect(problemsHref(filtered)).toBe('/problems?view=list&assignee=nobody&from=2026-10-01');
  });
});

describe('the address of a task’s page', () => {
  test('keeps the view it was opened from, and the conversation open beside it', () => {
    const page = (query: string) => readProblemPageAddress(new URLSearchParams(query));
    expect(page('')).toEqual({ ...at('board'), chat: false });
    expect(page('view=list&chat=1')).toEqual({ ...at('list'), chat: true });
    expect(writeProblemPageAddress({ ...at('board'), chat: false })).toBe('');
    expect(writeProblemPageAddress({ ...at('board'), chat: true })).toBe('chat=1');
    expect(writeProblemPageAddress({ ...at('archive'), chat: true })).toBe('view=archive&chat=1');
    expect(writeProblemPageAddress({ ...at('list'), chat: false })).toBe('view=list');
  });

  test('keeps the filters it was opened with while the conversation opens and closes', () => {
    const query = 'view=list&place=Karl%C3%ADn+3&chat=1';
    const address = readProblemPageAddress(new URLSearchParams(query));

    expect(address).toEqual({
      ...at('list', { place: { kind: 'place', name: 'Karlín 3' } }),
      chat: true,
    });
    expect(writeProblemPageAddress(address)).toBe(query);
    expect(writeProblemPageAddress({ ...address, chat: false })).toBe(
      'view=list&place=Karl%C3%ADn+3',
    );
  });

  test('only «1» opens the conversation', () => {
    expect(readProblemPageAddress(new URLSearchParams('chat=yes')).chat).toBe(false);
    expect(readProblemPageAddress(new URLSearchParams('chat=0')).chat).toBe(false);
  });

  // The mark «Новое сообщение» in a list leads to the conversation itself.
  test('a link to a task’s conversation carries the view the list is, and its filters', () => {
    expect(problemChatHref(ID, 'board')).toBe(`/problems/${ID}?chat=1`);
    expect(problemChatHref(ID, 'list')).toBe(`/problems/${ID}?view=list&chat=1`);
    expect(problemChatHref(ID, at('archive', { assigneeId: PETR }))).toBe(
      `/problems/${ID}?view=archive&assignee=${PETR}&chat=1`,
    );
  });
});
