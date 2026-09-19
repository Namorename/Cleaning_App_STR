import {
  CHAT_MEDIA_UPLOAD_WINDOW_MS,
  chatMessageSchema,
  chatUnreadThreadSchema,
  isOwnMessage,
  isPastUploadWindow,
  newestMessageAt,
  subjectKey,
  unreadSubjects,
  type ChatMessage,
} from '../schema';

const THREAD = '11111111-1111-4111-8111-111111111111';
const ME = '22222222-2222-4222-8222-222222222222';
const HER = '33333333-3333-4333-8333-333333333333';

function message(overrides: Partial<ChatMessage> & { id: string }): ChatMessage {
  return chatMessageSchema.parse({
    thread_id: THREAD,
    author_id: ME,
    author_name: 'Maria Test',
    author_role: 'cleaner',
    body: 'Поняла',
    media_expected: 0,
    created_at: '2026-09-18T10:00:00+00:00',
    ...overrides,
  });
}

test('a message keeps its author as they were, even after the account is gone', () => {
  const orphan = message({
    id: '44444444-4444-4444-8444-444444444444',
    author_id: null,
    author_name: 'Olga Former',
    author_role: 'manager',
  });

  expect(orphan.author_name).toBe('Olga Former');
  expect(isOwnMessage(orphan, ME)).toBe(false);
});

test('own is only what the reader wrote', () => {
  expect(isOwnMessage(message({ id: '44444444-4444-4444-8444-444444444444' }), ME)).toBe(true);
  expect(
    isOwnMessage(message({ id: '44444444-4444-4444-8444-444444444444', author_id: HER }), ME),
  ).toBe(false);
});

test('the newest message drawn is the latest by time, whatever order the rows came in', () => {
  const rows = [
    message({ id: '44444444-4444-4444-8444-444444444444', created_at: '2026-09-18T10:05:00+00:00' }),
    message({ id: '55555555-5555-4555-8555-555555555555', created_at: '2026-09-18T10:09:00+00:00' }),
    message({ id: '66666666-6666-4666-8666-666666666666', created_at: '2026-09-18T10:07:00+00:00' }),
  ];

  expect(newestMessageAt(rows)).toBe('2026-09-18T10:09:00+00:00');
  expect(newestMessageAt([])).toBeNull();
});

test('a task and a problem with the same id have different keys', () => {
  expect(subjectKey({ kind: 'task', id: THREAD })).not.toBe(
    subjectKey({ kind: 'problem', id: THREAD }),
  );
});

test('the subjects with something unread are split by kind', () => {
  const rows = [
    { kind: 'task', task_id: THREAD, problem_id: null },
    { kind: 'problem', task_id: null, problem_id: HER },
  ].map((row, index) =>
    chatUnreadThreadSchema.parse({
      thread_id: `4444444${index}-4444-4444-8444-444444444444`,
      last_message_at: '2026-09-18T10:07:00+00:00',
      ...row,
    }),
  );

  const subjects = unreadSubjects(rows);

  expect([...subjects.tasks]).toEqual([THREAD]);
  expect([...subjects.problems]).toEqual([HER]);
  expect(unreadSubjects([]).problems.size).toBe(0);
});

describe('the upload window of a photo', () => {
  const SENT = '2026-09-18T10:00:00+00:00';
  const sentAgo = (ms: number) => Date.parse(SENT) + ms;

  test('a message just sent is not late', () => {
    expect(isPastUploadWindow(SENT, sentAgo(1000))).toBe(false);
  });

  test('nor is one an hour short of the window', () => {
    expect(isPastUploadWindow(SENT, sentAgo(CHAT_MEDIA_UPLOAD_WINDOW_MS - 3_600_000))).toBe(false);
  });

  test('past the window it is', () => {
    expect(isPastUploadWindow(SENT, sentAgo(CHAT_MEDIA_UPLOAD_WINDOW_MS + 1))).toBe(true);
  });

  test('a message the server has not confirmed yet is never late', () => {
    expect(isPastUploadWindow(null, sentAgo(CHAT_MEDIA_UPLOAD_WINDOW_MS * 10))).toBe(false);
  });

  test('an unreadable date is not treated as ancient', () => {
    expect(isPastUploadWindow('not a date', sentAgo(CHAT_MEDIA_UPLOAD_WINDOW_MS * 10))).toBe(false);
  });
});
