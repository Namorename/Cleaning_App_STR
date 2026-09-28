import * as Notifications from 'expo-notifications';

import { foregroundBehavior, installForegroundHandler } from '../foreground';
import { showingThread } from '../open-thread';

/**
 * A push that arrives while the app is open. Without a handler the system
 * shows nothing at all; with one, it shows everything but a message in the
 * thread she is reading — that one is already on her screen.
 */

const THREAD_ID = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';
const OTHER_THREAD_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const TASK_ID = '0b3f5c1e-8d2a-4f6b-9c7d-1e2f3a4b5c6d';

const message = (threadId: string) => ({
  kind: 'chat_message',
  subject: 'task',
  id: TASK_ID,
  threadId,
});

const shown = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: true,
  shouldSetBadge: false,
};

let stopShowing: (() => void) | null = null;

afterEach(() => {
  stopShowing?.();
  stopShowing = null;
});

test('a push about a cleaning is shown and heard', () => {
  expect(foregroundBehavior({ kind: 'cleaning_new', taskId: TASK_ID })).toEqual(shown);
});

test('a message in the thread she is reading is neither shown nor heard', () => {
  stopShowing = showingThread(THREAD_ID);

  expect(foregroundBehavior(message(THREAD_ID))).toEqual({
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  });
});

test('a message in another thread is shown', () => {
  stopShowing = showingThread(THREAD_ID);

  expect(foregroundBehavior(message(OTHER_THREAD_ID))).toEqual(shown);
});

test('once she leaves the thread, its messages are shown again', () => {
  showingThread(THREAD_ID)();

  expect(foregroundBehavior(message(THREAD_ID))).toEqual(shown);
});

test('leaving a thread does not silence the one opened after it', () => {
  const leaveFirst = showingThread(OTHER_THREAD_ID);
  stopShowing = showingThread(THREAD_ID);

  // The first screen's cleanup runs after the second screen took over.
  leaveFirst();

  expect(foregroundBehavior(message(THREAD_ID)).shouldShowBanner).toBe(false);
});

test('data the app cannot read is still shown, never hidden', () => {
  expect(foregroundBehavior({ kind: 'something_new' })).toEqual(shown);
  expect(foregroundBehavior(undefined)).toEqual(shown);
});

test('the handler answers from the data at once', async () => {
  installForegroundHandler();
  const handler = (Notifications.setNotificationHandler as jest.Mock).mock.calls[0][0];

  const behavior = await handler.handleNotification({
    request: { content: { data: { kind: 'daily_digest' } } },
  });

  expect(behavior).toEqual(shown);
});
