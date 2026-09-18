import { describe, expect, test } from 'vitest';

import {
  chatMessageSchema,
  chatUnreadThreadSchema,
  isOwnMessage,
  newestMessageAt,
  subjectKey,
  unreadSubjects,
  type ChatMessage,
} from '../schema';

const THREAD = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const HER = '33333333-3333-4333-8333-333333333333';

const message = (overrides: Partial<ChatMessage> & { id: string }): ChatMessage =>
  chatMessageSchema.parse({
    thread_id: THREAD,
    author_id: ME,
    author_name: 'Olga Manager',
    author_role: 'manager',
    body: 'Ключи в боксе',
    media_expected: 0,
    created_at: '2026-09-18T10:00:00+00:00',
    ...overrides,
  });

describe('a message as the panel reads it', () => {
  test('keeps the author as they were, even after the account is gone', () => {
    const orphan = message({
      id: '44444444-4444-4444-8444-444444444444',
      author_id: null,
      author_name: 'Anna Former',
      author_role: 'cleaner',
    });

    expect(orphan.author_name).toBe('Anna Former');
    expect(isOwnMessage(orphan, ME)).toBe(false);
  });

  test('refuses a row without the role it was signed with', () => {
    expect(() =>
      chatMessageSchema.parse({
        id: '44444444-4444-4444-8444-444444444444',
        thread_id: THREAD,
        author_id: ME,
        author_name: 'Olga',
        body: 'x',
        media_expected: 0,
        created_at: '2026-09-18T10:00:00+00:00',
      }),
    ).toThrow();
  });

  test('is own only when the reader is known and wrote it', () => {
    const mine = message({ id: '44444444-4444-4444-8444-444444444444' });
    const hers = message({ id: '55555555-5555-4555-8555-555555555555', author_id: HER });

    expect(isOwnMessage(mine, ME)).toBe(true);
    expect(isOwnMessage(hers, ME)).toBe(false);
    expect(isOwnMessage(mine, null)).toBe(false);
  });
});

describe('a photo of a message', () => {
  const PHOTO = '77777777-7777-4777-8777-777777777777';

  test('is read with no file yet, which is what draws the hole', () => {
    const withPhoto = message({
      id: '44444444-4444-4444-8444-444444444444',
      media_expected: 1,
      task_media: [
        {
          id: PHOTO,
          storage_path: 'host/chat/thread/photo.jpg',
          uploaded_at: null,
          created_at: '2026-09-18T10:00:30+00:00',
        },
      ],
    });

    expect(withPhoto.task_media[0].uploaded_at).toBeNull();
  });

  test('is nothing at all when the embed brings no rows', () => {
    const wordsOnly = message({ id: '44444444-4444-4444-8444-444444444444' });

    expect(wordsOnly.task_media).toEqual([]);
  });

  test('refuses a row without the path its file lives at', () => {
    expect(() =>
      chatMessageSchema.parse({
        id: '44444444-4444-4444-8444-444444444444',
        thread_id: THREAD,
        author_id: ME,
        author_name: 'Olga',
        author_role: 'manager',
        body: '',
        media_expected: 1,
        created_at: '2026-09-18T10:00:00+00:00',
        task_media: [{ id: PHOTO, uploaded_at: null, created_at: '2026-09-18T10:00:30+00:00' }],
      }),
    ).toThrow();
  });
});

describe('the newest message drawn', () => {
  test('is the latest by time, whatever order the rows arrived in', () => {
    const rows = [
      message({
        id: '44444444-4444-4444-8444-444444444444',
        created_at: '2026-09-18T10:05:00+00:00',
      }),
      message({
        id: '55555555-5555-4555-8555-555555555555',
        created_at: '2026-09-18T10:09:00+00:00',
      }),
      message({
        id: '66666666-6666-4666-8666-666666666666',
        created_at: '2026-09-18T10:07:00+00:00',
      }),
    ];

    expect(newestMessageAt(rows)).toBe('2026-09-18T10:09:00+00:00');
  });

  test('is nothing for an empty thread, so nothing is marked read', () => {
    expect(newestMessageAt([])).toBeNull();
  });
});

describe('the subjects with something unread', () => {
  test('are split by kind, so a card looks itself up in one set', () => {
    const rows = [
      { kind: 'task', task_id: THREAD, problem_id: null },
      { kind: 'problem', task_id: null, problem_id: HER },
    ].map((row, index) =>
      chatUnreadThreadSchema.parse({
        thread_id: `4444444${index}-4444-4444-8444-444444444444`,
        profile_id: null,
        last_message_at: '2026-09-18T10:07:00+00:00',
        ...row,
      }),
    );

    const subjects = unreadSubjects(rows);

    expect([...subjects.tasks]).toEqual([THREAD]);
    expect([...subjects.problems]).toEqual([HER]);
    expect(unreadSubjects([]).tasks.size).toBe(0);
  });
});

describe('the subject key', () => {
  test('tells a task from a problem with the same id', () => {
    expect(subjectKey({ taskId: THREAD })).not.toBe(subjectKey({ problemId: THREAD }));
    expect(subjectKey({ taskId: THREAD })).toBe(subjectKey({ taskId: THREAD }));
  });
});
