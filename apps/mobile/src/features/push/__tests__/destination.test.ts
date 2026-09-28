import type { CleaningTask } from '@/features/tasks/schema';

import { destinationOf, staleAfter } from '../destination';
import { TASK_PUSH_KINDS, type PushData } from '../payload';

/**
 * Where a tap on a push leads, and what it makes stale.
 *
 * A cleaning that is no longer hers — taken off her, cancelled — is not
 * opened: the server already hides it, and the screen would first draw the
 * copy cached in the lists as if it still were. She lands on her list with a
 * line saying what happened instead.
 */

const TASK_ID = '0b3f5c1e-8d2a-4f6b-9c7d-1e2f3a4b5c6d';
const PROBLEM_ID = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';
const THREAD_ID = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';

const found = jest.fn(async () => ({ id: TASK_ID }) as CleaningTask);
const gone = jest.fn(async () => null);
const unreachable = jest.fn(async () => {
  throw new TypeError('Network request failed');
});

const toTask = { pathname: '/task/[id]', params: { id: TASK_ID } };

describe('destinationOf', () => {
  test.each(['cleaning_new', 'cleaning_assigned', 'cleaning_window', 'cleaning_free'] as const)(
    '%s opens the cleaning',
    async (kind) => {
      await expect(destinationOf({ kind, taskId: TASK_ID }, gone)).resolves.toEqual(toTask);
    },
  );

  test('a booking cancelled during the cleaning opens the cleaning she is in', async () => {
    await expect(
      destinationOf({ kind: 'booking_cancelled_live', taskId: TASK_ID }, gone),
    ).resolves.toEqual(toTask);
  });

  test.each([
    ['cleaning_unassigned', 'unassigned'],
    ['cleaning_cancelled', 'cancelled'],
  ] as const)('%s lands on her list, saying so', async (kind, notice) => {
    await expect(destinationOf({ kind, taskId: TASK_ID }, found)).resolves.toEqual({
      pathname: '/(tabs)',
      params: { notice },
    });
  });

  test('a moved cleaning that is still hers opens', async () => {
    await expect(
      destinationOf({ kind: 'cleaning_moved', taskId: TASK_ID }, found),
    ).resolves.toEqual(toTask);
    expect(found).toHaveBeenCalledWith(TASK_ID);
  });

  test('a moved cleaning that is no longer hers lands on her list, saying so', async () => {
    await expect(destinationOf({ kind: 'cleaning_moved', taskId: TASK_ID }, gone)).resolves.toEqual(
      { pathname: '/(tabs)', params: { notice: 'movedAway' } },
    );
  });

  test('without signal a moved cleaning opens, and the screen says what it can', async () => {
    await expect(
      destinationOf({ kind: 'cleaning_moved', taskId: TASK_ID }, unreachable),
    ).resolves.toEqual(toTask);
  });

  test('a chat message opens its conversation', async () => {
    const data: PushData = {
      kind: 'chat_message',
      subject: 'problem',
      id: PROBLEM_ID,
      threadId: THREAD_ID,
    };

    await expect(destinationOf(data, gone)).resolves.toEqual({
      pathname: '/chat/[subject]/[id]',
      params: { subject: 'problem', id: PROBLEM_ID },
    });
  });

  test('the morning digest opens her list', async () => {
    await expect(destinationOf({ kind: 'daily_digest' }, gone)).resolves.toEqual({
      pathname: '/(tabs)',
    });
  });

  test('every cleaning kind has a destination', async () => {
    for (const kind of TASK_PUSH_KINDS) {
      await expect(destinationOf({ kind, taskId: TASK_ID }, found)).resolves.toBeDefined();
    }
  });
});

describe('staleAfter', () => {
  test('a push about a cleaning makes the cleanings and their steps stale', () => {
    expect(staleAfter({ kind: 'cleaning_moved', taskId: TASK_ID })).toEqual([['tasks'], ['steps']]);
  });

  test("a chat message makes the unread marks and that thread's messages stale", () => {
    expect(
      staleAfter({ kind: 'chat_message', subject: 'task', id: TASK_ID, threadId: THREAD_ID }),
    ).toEqual([
      ['chat', 'unread'],
      ['chat', 'messages', THREAD_ID],
    ]);
  });

  test('a chat message without its thread still makes the marks stale', () => {
    expect(staleAfter({ kind: 'chat_message', subject: 'task', id: TASK_ID })).toEqual([
      ['chat', 'unread'],
    ]);
  });

  test('the digest and anything unreadable make the cleanings stale', () => {
    expect(staleAfter({ kind: 'daily_digest' })).toEqual([['tasks']]);
    expect(staleAfter(null)).toEqual([['tasks']]);
  });
});
