import {
  dehydrate,
  onlineManager,
  useMutation,
  type MutationOptions,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { sendMessage, type SendMessageVariables } from '@/features/chat/api';
import { chatMutationKeys } from '@/features/chat/keys';
import { useSendMessage } from '@/features/chat/use-chat';
import { reportProblem } from '@/features/problems/api';
import { problemMutationKeys } from '@/features/problems/keys';
import { useReportProblem, type ReportWithPhotosVariables } from '@/features/problems/use-problems';
import { completeStep, type CompleteStepVariables } from '@/features/steps/api';
import { stepMutationKeys, useCompleteStep } from '@/features/steps/use-steps';
import { saveSupplyRequest, type SaveSupplyRequestVariables } from '@/features/supplies/api';
import { supplyMutationKeys } from '@/features/supplies/keys';
import { useSaveSupplyRequest } from '@/features/supplies/use-supplies';
import { startTask } from '@/features/tasks/api';
import { taskMutationKeys, useStartTask } from '@/features/tasks/use-tasks';
import { PROBE_INTERVAL_MS, stopWatchingConnection } from '@/lib/online';
import { createAppQueryClient } from '@/lib/query-client';
import { withClient } from '@/testing/restored-cache';

/**
 * How a field action — a cleaning started, a step done with her comment, a
 * supply request, a report, a message — tries again when the network fails
 * it (lib/move-retry.ts). A failure that is the network's never ends it:
 * without signal it waits on disk however long that lasts, and a server whose
 * health answers while the action does not is asked again at every look, for
 * ever. TanStack counts every failure of the action, outages included, so a
 * budget on those would end it after a stairwell or two — silently, since an
 * action that failed is not kept on disk and its screen has long gone (the
 * verification review of f3217a7..c466bf5). Only an upload has a budget
 * (features/media/attach-retry.ts): it keeps its file and a «Повторить» tile.
 * A refusal still gets its few more tries and then fails, so the screen can
 * say why.
 */

jest.mock('@/features/steps/api', () => ({
  ...jest.requireActual('@/features/steps/api'),
  completeStep: jest.fn(),
}));
jest.mock('@/features/supplies/api', () => ({
  ...jest.requireActual('@/features/supplies/api'),
  saveSupplyRequest: jest.fn(),
}));
jest.mock('@/features/tasks/api', () => ({
  ...jest.requireActual('@/features/tasks/api'),
  startTask: jest.fn(),
}));
jest.mock('@/features/problems/api', () => ({
  ...jest.requireActual('@/features/problems/api'),
  reportProblem: jest.fn(),
}));
jest.mock('@/features/chat/api', () => ({
  ...jest.requireActual('@/features/chat/api'),
  sendMessage: jest.fn(),
}));

/** Longer than every look for the server this file waits for. */
const LONG_ENOUGH_MS = 15 * 60_000;
const STEP_MS = 5_000;
/** Far more failures than any budget a move ever had (four, at c466bf5). */
const MANY_FAILURES = 10;
/**
 * The most a move the network keeps failing is sent over LONG_ENOUGH_MS:
 * once, then about once per look for the server — never in a loop.
 */
const MOST_TRIES = Math.ceil(LONG_ENOUGH_MS / PROBE_INTERVAL_MS) + 2;

const TASK_ID = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';
const STEP_ID = '5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f';

const noAnswer = () => new TypeError('Network request failed');

let client: QueryClient;

beforeEach(() => {
  jest.useFakeTimers();
  onlineManager.setOnline(true);
  // A look for the server finds it.
  global.fetch = jest.fn(async () => ({ ok: true }) as Response);
  client = createAppQueryClient();
});

afterEach(() => {
  client.clear();
  stopWatchingConnection();
  onlineManager.setOnline(true);
  jest.useRealTimers();
});

async function letTimePass(total: number = LONG_ENOUGH_MS): Promise<void> {
  for (let elapsed = 0; elapsed < total; elapsed += STEP_MS) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(STEP_MS);
    });
  }
}

/** Signal that comes and goes: every other look for the server finds it. */
function flappingSignal(): void {
  let looks = 0;
  global.fetch = jest.fn(async () => {
    looks += 1;
    if (looks % 2 === 0) {
      throw noAnswer();
    }
    return { ok: true } as Response;
  });
}

/** What TanStack does with a `retry` option after `failureCount` failures (retryer.js). */
function willRetry(retry: unknown, failureCount: number, error: unknown): boolean {
  if (typeof retry === 'function') {
    return retry(failureCount, error) === true;
  }
  if (typeof retry === 'number') {
    return failureCount < retry;
  }
  return retry === true;
}

/** The `retry` an action restored from disk runs with: only what its key registered decides. */
function registeredRetry(mutationKey: QueryKey): unknown {
  const options: MutationOptions<unknown, unknown, unknown, unknown> = { mutationKey };
  return client.defaultMutationOptions(options).retry;
}

/** The wait before another try an action restored from disk runs with. */
function registeredRetryDelay(mutationKey: QueryKey): unknown {
  const options: MutationOptions<unknown, unknown, unknown, unknown> = { mutationKey };
  return client.defaultMutationOptions(options).retryDelay;
}

/** What TanStack waits before another try with a `retryDelay` option (retryer.js). */
function delayOf(retryDelay: unknown, failureCount: number, error: unknown): unknown {
  return typeof retryDelay === 'function' ? retryDelay(failureCount, error) : retryDelay;
}

/** A move of the app's, with no retry of its own: the client's default decides. */
async function makeMove(move: jest.Mock) {
  const { result } = await renderHook(
    () => useMutation({ mutationKey: ['moves', 'test'], mutationFn: move }),
    { wrapper: withClient(client) },
  );
  await act(async () => {
    result.current.mutate('t1');
  });
  await letTimePass();
  return result;
}

/**
 * Every field action the app queues, as a restart replays it: its key and
 * nothing else, so only what is registered for the key decides.
 */
const QUEUED: readonly (readonly [string, QueryKey])[] = [
  ['taking a cleaning', taskMutationKeys.claim],
  ['accepting it', taskMutationKeys.accept],
  ['starting it', taskMutationKeys.start],
  ['finishing it', taskMutationKeys.finish],
  ['opening a step', stepMutationKeys.open],
  ['completing a step', stepMutationKeys.complete],
  ['reopening a step', stepMutationKeys.reopen],
  ['skipping a step', stepMutationKeys.skip],
  ['a supply request', supplyMutationKeys.save],
  ['withdrawing it', supplyMutationKeys.delete],
  ['a report', problemMutationKeys.report],
  ['a report’s edit', problemMutationKeys.update],
  ['a message', chatMutationKeys.send],
  ['a thread read', chatMutationKeys.read],
];

describe('restored from disk', () => {
  test.each(QUEUED)(
    '%s: no network failure ends it, however many came before, with signal or without',
    (_name, mutationKey) => {
      const retry = registeredRetry(mutationKey);

      for (let failureCount = 0; failureCount <= 5 * MANY_FAILURES; failureCount += 1) {
        for (const isOnline of [true, false]) {
          onlineManager.setOnline(isOnline);
          expect(willRetry(retry, failureCount, noAnswer())).toBe(true);
        }
      }
    },
  );

  // Sleeping out a backoff, a move is not paused, and only a paused move is
  // on disk: closed meanwhile, the phone would forget it.
  test.each(QUEUED)(
    '%s: after a network failure it waits paused, not in a backoff',
    (_name, mutationKey) => {
      const retryDelay = registeredRetryDelay(mutationKey);

      for (let failureCount = 0; failureCount <= MANY_FAILURES; failureCount += 1) {
        expect(delayOf(retryDelay, failureCount, noAnswer())).toBe(0);
      }
    },
  );
});

const STEP_DONE: CompleteStepVariables = {
  taskId: TASK_ID,
  stepId: STEP_ID,
  payload: { comment: 'Пятно на ковре в спальне, не отходит' },
  deviceCompletedAt: '2026-10-09T08:30:00.000Z',
};
const SUPPLY: SaveSupplyRequestVariables = {
  requestId: '6d7e8f9a-0b1c-4d2e-9f3a-4b5c6d7e8f9a',
  items: [],
  priority: 'normal',
  note: 'Кончились мешки для мусора',
  taskId: TASK_ID,
};
const REPORT: ReportWithPhotosVariables = {
  problemId: '7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b',
  title: 'Кран течёт',
  description: 'На кухне',
  priority: 'normal',
  taskId: TASK_ID,
  propertyId: null,
  photos: [],
};
const MESSAGE: SendMessageVariables = {
  messageId: '8f9a0b1c-2d3e-4f4a-9b5c-6d7e8f9a0b1c',
  body: 'Ключа нет в сейфе',
  subject: { kind: 'task', id: TASK_ID },
};

type Action = readonly [
  string,
  () => { mutate: (variables: never) => void; status: string },
  unknown,
  jest.Mock,
];

/** Each field action as her screen sends it: the hook, what it sends, and its call to the server. */
const FIELD_ACTIONS: readonly Action[] = [
  ['a step completed with her comment', useCompleteStep, STEP_DONE, jest.mocked(completeStep)],
  ['a cleaning started', useStartTask, TASK_ID, jest.mocked(startTask)],
  ['a supply request', useSaveSupplyRequest, SUPPLY, jest.mocked(saveSupplyRequest)],
  ['a report', useReportProblem, REPORT, jest.mocked(reportProblem)],
  ['a message', useSendMessage, MESSAGE, jest.mocked(sendMessage)],
];

describe.each(FIELD_ACTIONS)('%s, queued through a signal that comes and goes', (...action) => {
  const [, useAction, variables, server] = action;

  test('is still waiting after many failures, and on disk as paused', async () => {
    // Arrange: every time it is tried, the signal is gone again.
    flappingSignal();
    server.mockImplementation(async () => {
      throw noAnswer();
    });
    const { result } = await renderHook(useAction, { wrapper: withClient(client) });

    // Act
    await act(async () => {
      result.current.mutate(variables as never);
    });
    await letTimePass();

    // Assert
    expect(server.mock.calls.length).toBeGreaterThan(MANY_FAILURES);
    expect(server.mock.calls.length).toBeLessThanOrEqual(MOST_TRIES);
    expect(result.current.status).toBe('pending');
    const onDisk = dehydrate(client).mutations;
    expect(onDisk).toHaveLength(1);
    expect(onDisk[0].state.isPaused).toBe(true);
    expect(onDisk[0].state.variables).toEqual(variables);
  });
});

test('left unanswered while the server answers its look, it is asked again and again, never given up on', async () => {
  // Arrange
  const move = jest.fn(async () => {
    throw noAnswer();
  });

  // Act
  const result = await makeMove(move);

  // Assert
  expect(move.mock.calls.length).toBeGreaterThan(MANY_FAILURES);
  expect(move.mock.calls.length).toBeLessThanOrEqual(MOST_TRIES);
  expect(result.current.status).toBe('pending');
});

// Each outage is a stairwell of its own: the signal goes while the move is on
// its way, for half a minute, and the client learns it only from the failure.
// TanStack hands the retry the count of all of them.
test('failures counted across separate outages never add up to giving up', async () => {
  // Arrange
  const OUTAGES = 2 * MANY_FAILURES;
  let hasSignal = true;
  global.fetch = jest.fn(async () => {
    if (!hasSignal) {
      throw noAnswer();
    }
    return { ok: true } as Response;
  });
  const move = jest.fn(async () => {
    if (move.mock.calls.length > OUTAGES) {
      return;
    }
    hasSignal = false;
    setTimeout(() => {
      hasSignal = true;
    }, 30_000);
    throw noAnswer();
  });

  // Act
  const result = await makeMove(move);

  // Assert
  expect(move).toHaveBeenCalledTimes(OUTAGES + 1);
  expect(result.current.status).toBe('success');
});

// TanStack keeps on disk only what is paused; a move sleeping out a backoff
// is not, and a phone closed meanwhile would forget it.
test('between tries a move the network failed waits paused, on disk, not in a backoff', async () => {
  // Arrange: no signal; not even the server's health check answers.
  global.fetch = jest.fn(async () => {
    throw noAnswer();
  });
  const move = jest.fn(async (_taskId: string) => {
    throw noAnswer();
  });
  const { result } = await renderHook(
    () => useMutation({ mutationKey: ['moves', 'test'], mutationFn: move }),
    { wrapper: withClient(client) },
  );

  // Act: the first try fails, and hardly any time passes.
  await act(async () => {
    result.current.mutate('t1');
  });
  await act(async () => {
    await jest.advanceTimersByTimeAsync(10);
  });

  // Assert
  expect(move).toHaveBeenCalledTimes(1);
  const onDisk = dehydrate(client).mutations;
  expect(onDisk).toHaveLength(1);
  expect(onDisk[0].state.isPaused).toBe(true);
});

test('without signal at all, waits for it however long, trying nothing more', async () => {
  // Arrange: not even the server's health check answers.
  global.fetch = jest.fn(async () => {
    throw noAnswer();
  });
  const move = jest.fn(async () => {
    throw noAnswer();
  });

  // Act
  const result = await makeMove(move);

  // Assert
  expect(move).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBe('pending');
  expect(onlineManager.isOnline()).toBe(false);
});

test('refused by the server, it gets its one more try, as before', async () => {
  const refusal = { message: 'Task is not yours', code: 'P0001' };
  const move = jest.fn(async () => {
    throw refusal;
  });

  const result = await makeMove(move);

  expect(move).toHaveBeenCalledTimes(2);
  expect(result.current.error).toBe(refusal);
});

/**
 * TanStack hands `retry` one count of every failure, outages included: after
 * a stairwell or two the first real refusal got no try at all (the
 * verification review of c466bf5..bc7dcc9, item 3). A move's refusals are
 * counted apart, by the move.
 */
describe('refusals keep their own count', () => {
  const OUTAGES = 5;
  const busy = { message: 'Could not serialize access', code: '40001' };

  /** The server: no answer `outages` times, then `refusals` refusals, then it goes through. */
  function serverAfter(outages: number, refusals: number, server: jest.Mock): void {
    server.mockReset();
    server.mockImplementation(async () => {
      const call = server.mock.calls.length;
      if (call <= outages) {
        throw noAnswer();
      }
      if (call <= outages + refusals) {
        throw busy;
      }
      return undefined;
    });
  }

  test('refused after several outages, a move still gets its one more try', async () => {
    // Arrange
    const move = jest.fn();
    serverAfter(OUTAGES, 1, move);

    // Act
    const result = await makeMove(move);

    // Assert
    expect(move).toHaveBeenCalledTimes(OUTAGES + 2);
    expect(result.current.status).toBe('success');
  });

  test('a message refused after several outages still gets its three more tries', async () => {
    // Arrange
    const server = jest.mocked(sendMessage);
    serverAfter(OUTAGES, 3, server);
    const { result } = await renderHook(useSendMessage, { wrapper: withClient(client) });

    // Act
    await act(async () => {
      result.current.mutate(MESSAGE);
    });
    await letTimePass();

    // Assert
    expect(server).toHaveBeenCalledTimes(OUTAGES + 4);
    expect(result.current.status).toBe('success');
  });

  test('outages after a refusal do not use up what is left of it', async () => {
    // Arrange: refused, then the signal goes, then refused again.
    const move = jest.fn(async () => {
      const call = move.mock.calls.length;
      if (call === 1) {
        throw busy;
      }
      if (call <= 1 + OUTAGES) {
        throw noAnswer();
      }
      throw busy;
    });

    // Act
    const result = await makeMove(move);

    // Assert: two refusals, the one more try spent on the second; then it fails.
    expect(move).toHaveBeenCalledTimes(OUTAGES + 2);
    expect(result.current.error).toBe(busy);
  });

  test('a move that failed for good, tapped again, gets its one more try again', async () => {
    // Arrange: refused twice — it fails, and the screen says why.
    const move = jest.fn();
    serverAfter(0, 3, move);
    const { result } = await renderHook(
      () => useMutation({ mutationKey: ['moves', 'test'], mutationFn: move }),
      { wrapper: withClient(client) },
    );
    await act(async () => {
      result.current.mutate('t1');
    });
    await letTimePass(60_000);
    expect(result.current.status).toBe('error');

    // Act: she taps it again; refused once more, then it goes through.
    await act(async () => {
      result.current.mutate('t1');
    });
    await letTimePass(60_000);

    // Assert
    expect(move).toHaveBeenCalledTimes(4);
    expect(result.current.status).toBe('success');
  });
});

// A report and a message had three more tries before the rule above: a
// refusal keeps them, and only a refusal.
test.each([
  ['a report', problemMutationKeys.report],
  ['a message', chatMutationKeys.send],
])('%s refused gets its three more tries, as before', (_name, mutationKey) => {
  const refusal = { message: 'Not allowed', code: '42501' };
  const retry = registeredRetry(mutationKey);

  expect(willRetry(retry, 2, refusal)).toBe(true);
  expect(willRetry(retry, 3, refusal)).toBe(false);
});
