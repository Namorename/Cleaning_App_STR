import { chatMessageSchema, isOwnMessage, newestMessageAt, subjectKey, type ChatMessage } from '../schema';

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
