import AsyncStorage from '@react-native-async-storage/async-storage';
import { MutationObserver, onlineManager, type QueryClient } from '@tanstack/react-query';

import { setPushPreference } from '@/features/settings/api';
import { settingsMutationKeys } from '@/features/settings/keys';
import type { PushChoice } from '@/features/settings/use-settings';
import { reopenStep, skipStep, type StepVariables } from '@/features/steps/api';
import { stepMutationKeys } from '@/features/steps/use-steps';
import { claimTask } from '@/features/tasks/api';
import { taskMutationKeys, type ClaimVariables } from '@/features/tasks/use-tasks';
import { stopWatchingConnection } from '@/lib/online';
import { resumeSavedMoves } from '@/lib/query-client';
import {
  PARKED_ON_DISK,
  parkedVariablesOf,
  phoneLeftWith,
  queuedVariables,
  savedMove,
  settleRealTime as settle,
  startApp as startAppWith,
  type RunningApp,
} from '@/testing/phone-queue';
import { signedOutOfQueue } from '@/testing/queue-person';

/**
 * The moves parked on disk for their author (lib/parked-moves.ts) and the
 * turns of the queue they leave (lib/move-queue.ts), as the review of
 * dab5237..cb747a5 found them: two taps that send the same were one move, a
 * move the disk refused to park held the next person's line for good, a store
 * that could not be read was written over, and a move made with nobody signed
 * in went out with no session.
 *
 * Who sent a call is read off the session auth holds when it is made
 * (`mockAuth.userId`): that is the token the request goes out with.
 */

type AuthListener = (event: string, session: { user: { id: string } } | null) => void;

const mockAuth: { listener: AuthListener | null; userId: string | null } = {
  listener: null,
  userId: null,
};

jest.mock('@/lib/supabase', () => ({
  SESSION_STORAGE_KEY: 'sb-project-auth-token',
  supabase: {
    auth: {
      onAuthStateChange: (listener: AuthListener) => {
        mockAuth.listener = listener;
        return { data: { subscription: { unsubscribe: jest.fn() } } };
      },
    },
  },
}));
jest.mock('@/features/tasks/api', () => ({
  ...jest.requireActual('@/features/tasks/api'),
  claimTask: jest.fn(),
}));
jest.mock('@/features/steps/api', () => ({
  ...jest.requireActual('@/features/steps/api'),
  skipStep: jest.fn(),
  reopenStep: jest.fn(),
}));
jest.mock('@/features/settings/api', () => ({
  ...jest.requireActual('@/features/settings/api'),
  setPushPreference: jest.fn(),
}));

const ANNA = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const BORIS = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const ANNAS_TASK = '3f2a1c4e-5b6d-4e8f-9a0b-1c2d3e4f5a6b';
const BORIS_TASK = '6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d';
const ANNAS_CLAIM: ClaimVariables = { taskId: ANNAS_TASK, cleanerId: ANNA };
const BORIS_CLAIM: ClaimVariables = { taskId: BORIS_TASK, cleanerId: BORIS };
const STEP: StepVariables = { taskId: ANNAS_TASK, stepId: 'b1c2d3e4-1111-4111-8111-b1c2d3e40001' };
const UNREADABLE_ON_DISK = `${PARKED_ON_DISK}.unreadable`;
/** Between two taps of a person. */
const TAP_GAP_MS = 1_000;

const pushChoice = (enabled: boolean): PushChoice => ({
  userId: ANNA,
  kind: 'cleaning_new',
  enabled,
});

/** A move as this build saves it, tapped at `submittedAt`. */
function savedAt(submittedAt: number, ...move: Parameters<typeof savedMove>) {
  const saved = savedMove(...move);
  return { ...saved, state: { ...(saved.state as object), submittedAt } };
}

const annasClaim = () => savedMove(taskMutationKeys.claim, ANNAS_CLAIM, 'task-moves', ANNA);

/** Who was signed in when each call went out, by what it sent. */
let sent: { what: unknown; by: string | null }[] = [];
const noteSent = (what: unknown): void => {
  sent = [...sent, { what, by: mockAuth.userId }];
};

let app: RunningApp | undefined;
let client: QueryClient;

async function startApp(): Promise<void> {
  app?.stop();
  app = await startAppWith(settle);
  client = app.client;
}

/** Auth says so: who holds the session from now on, and the event the app hears. */
async function hear(event: string, userId: string | null): Promise<void> {
  mockAuth.userId = userId;
  mockAuth.listener?.(event, userId === null ? null : { user: { id: userId } });
  await settle();
}

/** Everything that resumes the queue — the start, signal back, the app in front. */
async function nudgeQueue(): Promise<void> {
  await client.resumePausedMutations();
  await resumeSavedMoves(client);
  await settle();
}

/** A move tapped on a screen: its key, what it sends — in the queue at once, its call on its way. */
function tapNow<T>(mutationKey: readonly unknown[], variables: T): void {
  const move = new MutationObserver<unknown, Error, T>(client, { mutationKey });
  move.mutate(variables).catch(() => undefined);
}

/** A move tapped on a screen, and whatever it sets off done. */
async function tap<T>(mutationKey: readonly unknown[], variables: T): Promise<void> {
  tapNow(mutationKey, variables);
  await settle();
}

beforeEach(async () => {
  await AsyncStorage.clear();
  onlineManager.setOnline(true);
  mockAuth.listener = null;
  mockAuth.userId = null;
  sent = [];
  jest.mocked(claimTask).mockImplementation(async (taskId: string) => {
    noteSent(taskId);
    return { id: taskId } as never;
  });
  jest.mocked(skipStep).mockImplementation(async () => {
    noteSent('skip');
    return {} as never;
  });
  jest.mocked(reopenStep).mockImplementation(async () => {
    noteSent('reopen');
    return {} as never;
  });
  jest.mocked(setPushPreference).mockImplementation(async (_kind, enabled) => {
    noteSent(enabled);
    return null as never;
  });
});

afterEach(() => {
  app?.stop();
  app = undefined;
  signedOutOfQueue();
  stopWatchingConnection();
  onlineManager.setOnline(true);
  jest.restoreAllMocks();
});

/**
 * Two taps that send the same are two moves: a move is told apart by when it
 * was tapped as well as by its key and what it sends (MEDIUM-1 of the review
 * of dab5237..cb747a5).
 */
describe('two taps that send the same', () => {
  test('her push switched off, on and off again without signal: all three parked, sent in that order once she is back', async () => {
    // Arrange: Anna signed in, no signal; a second between her taps.
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    await startApp();
    await hear('INITIAL_SESSION', ANNA);
    onlineManager.setOnline(false);
    jest.mocked(setPushPreference).mockRejectedValue(new TypeError('Network request failed'));

    // Act
    for (const enabled of [false, true, false]) {
      now += TAP_GAP_MS;
      await tap(settingsMutationKeys.push, pushChoice(enabled));
    }
    await hear('SIGNED_OUT', null);

    // Assert
    expect(await parkedVariablesOf(ANNA)).toEqual([
      pushChoice(false),
      pushChoice(true),
      pushChoice(false),
    ]);

    // Act: she is back, with signal.
    jest.mocked(setPushPreference).mockImplementation(async (_kind, enabled) => {
      noteSent(enabled);
      return null as never;
    });
    onlineManager.setOnline(true);
    await hear('SIGNED_IN', ANNA);
    await nudgeQueue();

    // Assert: her last choice, «off», is the one that stands.
    expect(sent.map(({ what }) => what)).toEqual([false, true, false]);
    expect(await parkedVariablesOf(ANNA)).toEqual([]);
  });

  test('a step skipped, reopened and skipped again: all three parked for her, none sent with his session', async () => {
    // Arrange
    const tapped = Date.now();
    await phoneLeftWith(
      [
        savedAt(tapped, stepMutationKeys.skip, STEP, undefined, ANNA),
        savedAt(tapped + TAP_GAP_MS, stepMutationKeys.reopen, STEP, undefined, ANNA),
        savedAt(tapped + 2 * TAP_GAP_MS, stepMutationKeys.skip, STEP, undefined, ANNA),
      ],
      ANNA,
    );
    await startApp();

    // Act
    await hear('SIGNED_IN', BORIS);
    await nudgeQueue();

    // Assert
    expect(sent).toEqual([]);
    expect(await parkedVariablesOf(ANNA)).toEqual([STEP, STEP, STEP]);

    // Act: Anna is back.
    await hear('SIGNED_OUT', null);
    await hear('SIGNED_IN', ANNA);
    await nudgeQueue();

    // Assert
    expect(sent).toHaveLength(3);
    expect(sent.filter(({ what }) => what === 'skip')).toHaveLength(2);
    expect(sent.every(({ by }) => by === ANNA)).toBe(true);
  });
});

/** The same move found twice — the app closed between parking it and dropping it from the queue. */
describe('one move found twice', () => {
  test('in the saved queue and parked: parked once, and sent once when she is back', async () => {
    // Arrange
    const claim = annasClaim();
    await phoneLeftWith([claim], ANNA);
    await AsyncStorage.setItem(PARKED_ON_DISK, JSON.stringify({ [ANNA]: [claim] }));
    await startApp();

    // Act
    await hear('SIGNED_IN', BORIS);

    // Assert
    expect(await parkedVariablesOf(ANNA)).toEqual([ANNAS_CLAIM]);

    // Act
    await hear('SIGNED_OUT', null);
    await hear('SIGNED_IN', ANNA);
    await nudgeQueue();

    // Assert
    expect(sent).toEqual([{ what: ANNAS_TASK, by: ANNA }]);
  });

  test('saved by an older build, with no author: parked once, and sent once when she is back', async () => {
    // Arrange: the old build's copy in the queue; the copy parked for the stamp's person.
    const old = savedMove(taskMutationKeys.claim, ANNAS_CLAIM, 'task-moves');
    await phoneLeftWith([old], ANNA);
    await AsyncStorage.setItem(
      PARKED_ON_DISK,
      JSON.stringify({ [ANNA]: [{ ...old, meta: { authorId: ANNA } }] }),
    );
    await startApp();

    // Act
    await hear('SIGNED_IN', BORIS);

    // Assert
    expect(await parkedVariablesOf(ANNA)).toEqual([ANNAS_CLAIM]);

    // Act
    await hear('SIGNED_OUT', null);
    await hear('SIGNED_IN', ANNA);
    await nudgeQueue();

    // Assert
    expect(sent).toEqual([{ what: ANNAS_TASK, by: ANNA }]);
  });
});

/**
 * A move of somebody else's that the disk refused to park stays in the queue
 * (MEDIUM-2 of the review of dab5237..cb747a5): it is never sent, it holds no
 * line of the next person's, and it is parked once the disk takes it.
 */
describe('a move the disk refused to park', () => {
  const setItem = jest.mocked(AsyncStorage.setItem);
  const write = setItem.getMockImplementation();

  /** The disk refuses to write the parked store — full of videos, say. */
  function diskFull(): void {
    setItem.mockImplementation(async (key, value) => {
      if (key === PARKED_ON_DISK) {
        throw new Error('No space left on device');
      }
      return write?.(key, value);
    });
  }

  /** The disk takes writes again. */
  function diskBack(): void {
    if (write !== undefined) {
      setItem.mockImplementation(write);
    }
  }

  afterEach(diskBack);

  test('the next person’s move of its line still goes, it is never sent, and it is parked once the disk takes writes again', async () => {
    // Arrange: Anna's take, restored without signal; the parked store refuses every write.
    await phoneLeftWith([annasClaim()], ANNA);
    onlineManager.setOnline(false);
    await startApp();
    await hear('INITIAL_SESSION', ANNA);
    diskFull();
    await hear('SIGNED_OUT', null);
    await hear('SIGNED_IN', BORIS);
    onlineManager.setOnline(true);

    // Act: Boris takes a cleaning — the same line as Anna's take.
    await tap(taskMutationKeys.claim, BORIS_CLAIM);
    await nudgeQueue();

    // Assert
    expect(sent).toEqual([{ what: BORIS_TASK, by: BORIS }]);
    expect(queuedVariables(client)).toEqual([ANNAS_CLAIM]);

    // Act: the disk takes writes again.
    diskBack();
    await nudgeQueue();

    // Assert
    expect(await parkedVariablesOf(ANNA)).toEqual([ANNAS_CLAIM]);
    expect(queuedVariables(client)).toEqual([]);
    expect(sent).toEqual([{ what: BORIS_TASK, by: BORIS }]);
  });

  /**
   * The parking owed is retried at a resume, for the person the queue is
   * sorted for — read when its turn on the disk comes, not when it was asked
   * for (the review of 7553530..8a58d77, LOW): asked for Boris and run once
   * Anna had signed in, it parked her fresh moves, and her sort brought them
   * straight back.
   */
  test('asked for at his resume and run once she has signed in: none of her moves go to the store', async () => {
    // Arrange: Anna's take, left in the queue under Boris's session: the disk refused to park it.
    await phoneLeftWith([annasClaim()], ANNA);
    onlineManager.setOnline(false);
    jest.mocked(skipStep).mockRejectedValue(new TypeError('Network request failed'));
    await startApp();
    diskFull();
    await hear('SIGNED_IN', BORIS);
    diskBack();
    const writesBefore = setItem.mock.calls.length;

    // Act: his queue resumed, the parking asked for; before its turn, Anna signs in and skips a step.
    void client.resumePausedMutations();
    mockAuth.userId = ANNA;
    mockAuth.listener?.('SIGNED_IN', { user: { id: ANNA } });
    tapNow(stepMutationKeys.skip, STEP);
    await settle();

    // Assert: both her moves wait in the queue for signal; neither was ever in the store.
    const parkedForAnna = setItem.mock.calls
      .slice(writesBefore)
      .filter(([key]) => key === PARKED_ON_DISK)
      .flatMap(([, value]) => (JSON.parse(value) as Record<string, unknown[]>)[ANNA] ?? []);
    expect(parkedForAnna).toEqual([]);
    expect(queuedVariables(client)).toEqual([ANNAS_CLAIM, STEP]);
  });
});

/**
 * A store that cannot be read is taken as empty, and the next parking writes
 * over it: what it held is kept aside first — the latest such text only
 * (LOW-3 of the review of dab5237..cb747a5).
 */
describe('a parked store that cannot be read', () => {
  test.each([
    ['not JSON', '{"7c9e6679'],
    ['not a store', '["a list"]'],
  ])('%s: kept aside before the next parking writes over it', async (_name, raw) => {
    // Arrange: an earlier unreadable store already kept aside.
    await AsyncStorage.setItem(UNREADABLE_ON_DISK, 'an older unreadable store');
    await AsyncStorage.setItem(PARKED_ON_DISK, raw);
    await phoneLeftWith([annasClaim()], ANNA);
    await startApp();

    // Act
    await hear('SIGNED_IN', BORIS);

    // Assert
    expect(await AsyncStorage.getItem(UNREADABLE_ON_DISK)).toBe(raw);
    expect(await parkedVariablesOf(ANNA)).toEqual([ANNAS_CLAIM]);
  });
});

/** A move made while nobody is signed in has no session to go with (LOW-1). */
describe('nobody signed in', () => {
  test('a move made then is not sent, and goes with the session of the first person signed in', async () => {
    // Arrange
    await startApp();

    // Act
    await tap(taskMutationKeys.claim, ANNAS_CLAIM);
    await client.resumePausedMutations();
    await settle();

    // Assert
    expect(sent).toEqual([]);

    // Act
    await hear('SIGNED_IN', ANNA);
    await nudgeQueue();

    // Assert
    expect(sent).toEqual([{ what: ANNAS_TASK, by: ANNA }]);
  });
});
