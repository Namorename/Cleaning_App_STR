import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { stopWatchingConnection } from '@/lib/online';
import { createAppQueryClient } from '@/lib/query-client';
import { serverErrorText } from '@/lib/server-error';
import { signedInWithQueue, signedOutOfQueue } from '@/testing/queue-person';
import { withClient } from '@/testing/restored-cache';

import type { CleaningTask } from '../schema';
import { acceptVariables, useAcceptTask, useClaimTask } from '../use-tasks';

/**
 * A take or an accept replayed from the queue after the office moved the job
 * (night journal, review of bc7dcc9..dab5237, LOW): her move landed, its
 * answer was lost without signal, and the office moved the job back to
 * «assigned», to another day or flat — or the office moved it before her move
 * arrived. Either way the job is hers, and «a colleague took it» or «given to
 * someone else, cancelled» would be a lie. So would any refusal once her job
 * is started or done, and «already taken» once it is cancelled (LOW-6 of the
 * review of dab5237..cb747a5). Through the app's own client: the
 * queue, its retries and its pause without signal, against a server held here
 * as one row.
 */

const CLEANER = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const COLLEAGUE = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const DAY_SHE_SAW = '2026-11-10';
const NEW_DAY = '2026-11-12';
const STEP_MS = 5_000;
/** Longer than a look for the server and a refusal's one more try together. */
const LONG_ENOUGH_MS = 60_000;

type Row = Record<string, unknown>;
interface Answer {
  data: unknown;
  error: unknown;
}

/** PostgREST's answer to a request that got none: supabase-js resolves, it does not throw. */
const mockNoSignal: Answer = {
  data: null,
  error: { message: 'TypeError: Network request failed', details: '', hint: '', code: '' },
};

/** The server: the task's row, and what goes wrong with the next request. */
const mockServer: {
  row: Row;
  /** The next move lands, and its answer is lost on the way back. */
  losesNextAnswer: boolean;
  /** What reading the row answers instead of the row; null for the row. */
  readFailure: Answer | null;
} = { row: {}, losesNextAnswer: false, readFailure: null };

type Filter = (row: Row) => boolean;

/** A PostgREST builder over the one row: filters, then the move or the read. */
function mockBuilder(filters: readonly Filter[], run: (filters: readonly Filter[]) => Answer) {
  const answer = () => Promise.resolve(run(filters));
  return {
    eq: (column: string, value: unknown) =>
      mockBuilder([...filters, (row) => row[column] === value], run),
    in: (column: string, values: readonly unknown[]) =>
      mockBuilder([...filters, (row) => values.includes(row[column])], run),
    select: () => answer(),
    then: (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) =>
      answer().then(resolve, reject),
  };
}

function mockMove(patch: Row) {
  return (filters: readonly Filter[]): Answer => {
    const matches = filters.every((filter) => filter(mockServer.row));
    if (matches) {
      mockServer.row = { ...mockServer.row, ...patch };
    }
    if (mockServer.losesNextAnswer) {
      mockServer.losesNextAnswer = false;
      return mockNoSignal;
    }
    return { data: matches ? [mockServer.row] : [], error: null };
  };
}

function mockRead(filters: readonly Filter[]): Answer {
  if (mockServer.readFailure !== null) {
    return mockServer.readFailure;
  }
  return {
    data: filters.every((filter) => filter(mockServer.row)) ? [mockServer.row] : [],
    error: null,
  };
}

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: '7c9e6679-7425-40de-944b-e07fc1f90ae7' } } },
        error: null,
      }),
    },
    from: () => ({
      update: (patch: Row) => mockBuilder([], mockMove(patch)),
      select: () => mockBuilder([], mockRead),
    }),
  },
}));

/** The job as her card showed it. */
const CARD = {
  id: '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b',
  type: 'cleaning',
  status: 'assigned',
  priority: 1,
  scheduled_date: DAY_SHE_SAW,
  due_at: null,
  assignee_id: CLEANER,
  property_id: 412432,
  property: { name: 'CZ - Nadrazni Apt 6', effective_cleaner_notes: null },
  time_from: '10:00:00',
  time_to: '15:00:00',
  guests_count: null,
  started_at: null,
  completed_at: null,
  is_parallel: false,
} as const;

const SHE_SAW = acceptVariables(CARD as unknown as CleaningTask);

/** The office moves the job: back to «assigned», on another day, still hers. */
function officeMovesIt(changes: Row = {}): void {
  mockServer.row = {
    ...mockServer.row,
    status: 'assigned',
    assignee_id: CLEANER,
    scheduled_date: NEW_DAY,
    ...changes,
  };
}

let client: QueryClient;
/** Whether a look for the server finds it. */
let hasSignal: boolean;

beforeEach(() => {
  jest.useFakeTimers();
  onlineManager.setOnline(true);
  hasSignal = true;
  global.fetch = jest.fn(async () => {
    if (!hasSignal) {
      throw new TypeError('Network request failed');
    }
    return { ok: true } as Response;
  });
  mockServer.row = { ...CARD };
  mockServer.losesNextAnswer = false;
  mockServer.readFailure = null;
  client = createAppQueryClient();
  signedInWithQueue(client, CLEANER);
});

afterEach(() => {
  client.clear();
  signedOutOfQueue();
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

/** Her move lands, its answer is lost in the stairwell, and the phone has no signal for a while. */
function answerLostThenNoSignal(): void {
  mockServer.losesNextAnswer = true;
  hasSignal = false;
}

/** The signal comes back, and the queue goes through. */
async function signalBack(): Promise<void> {
  hasSignal = true;
  await letTimePass();
}

async function claimHook() {
  const { result } = await renderHook(useClaimTask, { wrapper: withClient(client) });
  return result;
}

async function acceptHook() {
  const { result } = await renderHook(useAcceptTask, { wrapper: withClient(client) });
  return result;
}

const MOVED_TEXT =
  'Уборку перенесли на другой день или в другое место — проверьте её и примите снова.';
const CANCELLED_TEXT = 'Эту уборку отменили.';

describe('«Взять» replayed after the office moved the job', () => {
  beforeEach(() => {
    mockServer.row = { ...CARD, status: 'unassigned', assignee_id: null };
  });

  test('her take landed, then the office moved it: hers, and no refusal', async () => {
    // Arrange
    const result = await claimHook();
    answerLostThenNoSignal();

    // Act: the take lands and is paused; the office moves the job meanwhile.
    await act(async () => {
      result.current.mutate({ taskId: CARD.id, cleanerId: CLEANER });
    });
    await letTimePass(STEP_MS);
    expect(mockServer.row).toMatchObject({ status: 'accepted', assignee_id: CLEANER });
    expect(result.current.status).toBe('pending');
    officeMovesIt();
    await signalBack();

    // Assert
    expect(result.current.status).toBe('success');
    expect(result.current.data).toMatchObject({
      assignee_id: CLEANER,
      status: 'assigned',
      scheduled_date: NEW_DAY,
    });
  });

  test('the office gave it to her and moved it before her take arrived: hers, and no refusal', async () => {
    // Arrange
    officeMovesIt();
    const result = await claimHook();

    // Act
    await act(async () => {
      result.current.mutate({ taskId: CARD.id, cleanerId: CLEANER });
    });
    await letTimePass();

    // Assert
    expect(result.current.status).toBe('success');
    expect(result.current.data).toMatchObject({ assignee_id: CLEANER, scheduled_date: NEW_DAY });
  });

  test('given to a colleague, it is still «already taken»', async () => {
    officeMovesIt({ assignee_id: COLLEAGUE });
    const result = await claimHook();

    await act(async () => {
      result.current.mutate({ taskId: CARD.id, cleanerId: CLEANER });
    });
    await letTimePass();

    expect(result.current.status).toBe('error');
    expect(serverErrorText(result.current.error).text).toBe(
      'Уборку уже взяли, либо её срок истёк.',
    );
  });

  test.each([
    ['started', 'in_progress'],
    ['done', 'done'],
  ])('hers and %s since: the take landed, no refusal', async (_name, status) => {
    // Arrange: her job, moved past the take by the time it is replayed.
    mockServer.row = { ...CARD, status, assignee_id: CLEANER };
    const result = await claimHook();

    // Act
    await act(async () => {
      result.current.mutate({ taskId: CARD.id, cleanerId: CLEANER });
    });
    await letTimePass();

    // Assert
    expect(result.current.status).toBe('success');
    expect(result.current.data).toMatchObject({ assignee_id: CLEANER, status });
  });

  test('hers and cancelled since: told it was cancelled, not «already taken»', async () => {
    officeMovesIt({ status: 'cancelled' });
    const result = await claimHook();

    await act(async () => {
      result.current.mutate({ taskId: CARD.id, cleanerId: CLEANER });
    });
    await letTimePass();

    expect(result.current.status).toBe('error');
    expect(serverErrorText(result.current.error)).toEqual({ text: CANCELLED_TEXT, detail: null });
  });
});

describe('«Принять» replayed after the office moved the job', () => {
  test('her accept landed, then the office moved it: told it was moved, not «given away or cancelled»', async () => {
    // Arrange
    const result = await acceptHook();
    answerLostThenNoSignal();

    // Act
    await act(async () => {
      result.current.mutate(SHE_SAW);
    });
    await letTimePass(STEP_MS);
    expect(mockServer.row).toMatchObject({ status: 'accepted', scheduled_date: DAY_SHE_SAW });
    expect(result.current.status).toBe('pending');
    officeMovesIt();
    await signalBack();

    // Assert
    expect(result.current.status).toBe('error');
    expect(serverErrorText(result.current.error)).toEqual({ text: MOVED_TEXT, detail: null });
    // Nothing accepted a day she never saw.
    expect(mockServer.row).toMatchObject({ status: 'assigned', scheduled_date: NEW_DAY });
  });

  test('the office moved it before her accept arrived: told it was moved', async () => {
    // Arrange
    officeMovesIt();
    const result = await acceptHook();

    // Act
    await act(async () => {
      result.current.mutate(SHE_SAW);
    });
    await letTimePass();

    // Assert
    expect(result.current.status).toBe('error');
    expect(serverErrorText(result.current.error)).toEqual({ text: MOVED_TEXT, detail: null });
    expect(mockServer.row).toMatchObject({ status: 'assigned', scheduled_date: NEW_DAY });
  });

  test('moved to another flat, the same', async () => {
    officeMovesIt({ scheduled_date: DAY_SHE_SAW, property_id: 412433 });
    const result = await acceptHook();

    await act(async () => {
      result.current.mutate(SHE_SAW);
    });
    await letTimePass();

    expect(serverErrorText(result.current.error).text).toBe(MOVED_TEXT);
  });

  test('given to a colleague, it is still «given away, moved or cancelled»', async () => {
    officeMovesIt({ assignee_id: COLLEAGUE });
    const result = await acceptHook();

    await act(async () => {
      result.current.mutate(SHE_SAW);
    });
    await letTimePass();

    expect(serverErrorText(result.current.error).text).toBe(
      'Не удалось принять уборку — её могли передать, перенести или отменить.',
    );
  });

  test.each([
    ['started', 'in_progress'],
    ['done', 'done'],
  ])(
    'hers and %s since, on the day and in the flat she saw: the accept landed',
    async (_name, status) => {
      // Arrange: her job, moved past the accept by the time it is replayed.
      mockServer.row = { ...CARD, status };
      const result = await acceptHook();

      // Act
      await act(async () => {
        result.current.mutate(SHE_SAW);
      });
      await letTimePass();

      // Assert
      expect(result.current.status).toBe('success');
      expect(result.current.data).toMatchObject({ assignee_id: CLEANER, status });
    },
  );

  test('hers and cancelled since: told it was cancelled', async () => {
    officeMovesIt({ status: 'cancelled' });
    const result = await acceptHook();

    await act(async () => {
      result.current.mutate(SHE_SAW);
    });
    await letTimePass();

    expect(result.current.status).toBe('error');
    expect(serverErrorText(result.current.error)).toEqual({ text: CANCELLED_TEXT, detail: null });
  });
});

/**
 * The row read back after a move that matched none is the server's answer
 * like any other: a failure of it reaches the screen through
 * `serverErrorText`, and one that is the network's pauses the move.
 */
describe('the read-back after a move that matched no row', () => {
  beforeEach(() => {
    // Her take landed earlier; the queue replays it.
    mockServer.row = { ...CARD, status: 'accepted', assignee_id: CLEANER };
  });

  test('getting no answer, the move waits for signal and then lands, never refused', async () => {
    // Arrange
    mockServer.readFailure = mockNoSignal;
    hasSignal = false;
    const result = await claimHook();

    // Act
    await act(async () => {
      result.current.mutate({ taskId: CARD.id, cleanerId: CLEANER });
    });
    await letTimePass();

    // Assert: paused, not refused.
    expect(result.current.status).toBe('pending');
    expect(result.current.isPaused).toBe(true);

    // Act: the signal is back.
    mockServer.readFailure = null;
    await signalBack();

    // Assert
    expect(result.current.status).toBe('success');
    expect(result.current.data).toMatchObject({ assignee_id: CLEANER });
  });

  test('refused by the server, the screen gets its sentence, never the raw words as the message', async () => {
    // Arrange
    const refusal = {
      message: 'Only a manager may do this',
      details: '',
      hint: 'serverErrors.managerOnly',
      code: 'P0001',
    };
    mockServer.readFailure = { data: null, error: refusal };
    const result = await claimHook();

    // Act
    await act(async () => {
      result.current.mutate({ taskId: CARD.id, cleanerId: CLEANER });
    });
    await letTimePass();

    // Assert
    expect(result.current.status).toBe('error');
    expect(serverErrorText(result.current.error)).toEqual({
      text: 'Это действие доступно только менеджеру',
      detail: null,
    });
  });

  test('an answer nobody can translate is the general sentence, its words only beneath', async () => {
    // Arrange
    mockServer.readFailure = {
      data: null,
      error: { message: 'permission denied for table tasks', details: '', hint: '', code: '42501' },
    };
    const result = await claimHook();

    // Act
    await act(async () => {
      result.current.mutate({ taskId: CARD.id, cleanerId: CLEANER });
    });
    await letTimePass();

    // Assert
    expect(serverErrorText(result.current.error)).toEqual({
      text: 'Не удалось выполнить действие. Попробуйте ещё раз.',
      detail: 'permission denied for table tasks',
    });
  });
});
