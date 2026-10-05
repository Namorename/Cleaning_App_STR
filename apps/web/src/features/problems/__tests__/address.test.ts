import { describe, expect, test } from 'vitest';

import {
  problemHref,
  problemsHref,
  readProblemsAddress,
  readProblemsView,
  writeProblemsAddress,
} from '../address';

const ID = '11111111-1111-4111-8111-111111111111';

describe('the address of «Задания»', () => {
  test('a bare address is the board', () => {
    expect(readProblemsAddress(new URLSearchParams(''))).toEqual({ view: 'board' });
    expect(writeProblemsAddress({ view: 'board' })).toBe('');
  });

  test('reads and writes the list and the archive, and drops anything else', () => {
    expect(readProblemsAddress(new URLSearchParams('view=list'))).toEqual({ view: 'list' });
    expect(writeProblemsAddress({ view: 'archive' })).toBe('view=archive');
    expect(readProblemsAddress(new URLSearchParams('view=kanban'))).toEqual({ view: 'board' });
    expect(readProblemsView(['list', 'archive'])).toBe('board');
    expect(readProblemsView(undefined)).toBe('board');
  });

  // «К списку заданий» returns to the view the manager came from: the page of
  // a task carries it in its own address.
  test('a task’s page carries the view it was opened from, and leads back to it', () => {
    expect(problemHref(ID, 'board')).toBe(`/problems/${ID}`);
    expect(problemHref(ID, 'list')).toBe(`/problems/${ID}?view=list`);
    expect(problemsHref('board')).toBe('/problems');
    expect(problemsHref('archive')).toBe('/problems?view=archive');
  });
});
