import { Constants } from '@str-ops/shared';

import { TASK_PUSH_KINDS, readPushData } from '../payload';

/**
 * What a push carries for the phone to decide where a tap leads — the shape
 * send-push writes (supabase/functions/send-push/run.ts, pushData). Never
 * text: the text is the system's to show, the data is only for routing.
 */

const TASK_ID = '0b3f5c1e-8d2a-4f6b-9c7d-1e2f3a4b5c6d';
const PROBLEM_ID = '5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d';
const THREAD_ID = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';

test('the cleaning kinds are every push kind but the chat message and the digest', () => {
  const expected = Constants.public.Enums.push_kind.filter(
    (kind) => kind !== 'chat_message' && kind !== 'daily_digest',
  );

  expect([...TASK_PUSH_KINDS].sort()).toEqual([...expected].sort());
});

test.each(TASK_PUSH_KINDS)('a %s push names the cleaning', (kind) => {
  expect(readPushData({ kind, taskId: TASK_ID })).toEqual({ kind, taskId: TASK_ID });
});

test('a chat push names the subject and the thread', () => {
  const data = { kind: 'chat_message', subject: 'problem', id: PROBLEM_ID, threadId: THREAD_ID };

  expect(readPushData(data)).toEqual(data);
});

test('a chat push without its thread still opens the chat', () => {
  expect(readPushData({ kind: 'chat_message', subject: 'task', id: TASK_ID })).toEqual({
    kind: 'chat_message',
    subject: 'task',
    id: TASK_ID,
  });
});

test('the morning digest carries nothing else', () => {
  expect(readPushData({ kind: 'daily_digest' })).toEqual({ kind: 'daily_digest' });
});

test.each([
  ['a kind a newer server sends', { kind: 'supply_ready', taskId: TASK_ID }],
  ['a cleaning without its id', { kind: 'cleaning_new' }],
  ['an id that is not one', { kind: 'cleaning_new', taskId: 'task-1' }],
  ['a subject the app does not open', { kind: 'chat_message', subject: 'supply', id: TASK_ID }],
  ['nothing at all', undefined],
  ['a string', 'cleaning_new'],
])('%s reads as nothing', (_name, data) => {
  expect(readPushData(data)).toBeNull();
});
