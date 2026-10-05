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

describe('the address of a task’s page', () => {
  test('keeps the view it was opened from, and the conversation open beside it', () => {
    expect(readProblemPageAddress(new URLSearchParams(''))).toEqual({ view: 'board', chat: false });
    expect(readProblemPageAddress(new URLSearchParams('view=list&chat=1'))).toEqual({
      view: 'list',
      chat: true,
    });
    expect(writeProblemPageAddress({ view: 'board', chat: false })).toBe('');
    expect(writeProblemPageAddress({ view: 'board', chat: true })).toBe('chat=1');
    expect(writeProblemPageAddress({ view: 'archive', chat: true })).toBe('view=archive&chat=1');
    expect(writeProblemPageAddress({ view: 'list', chat: false })).toBe('view=list');
  });

  test('only «1» opens the conversation', () => {
    expect(readProblemPageAddress(new URLSearchParams('chat=yes')).chat).toBe(false);
    expect(readProblemPageAddress(new URLSearchParams('chat=0')).chat).toBe(false);
  });

  // The mark «Новое сообщение» in a list leads to the conversation itself.
  test('a link to a task’s conversation carries the view the list is', () => {
    expect(problemChatHref(ID, 'board')).toBe(`/problems/${ID}?chat=1`);
    expect(problemChatHref(ID, 'list')).toBe(`/problems/${ID}?view=list&chat=1`);
  });
});
