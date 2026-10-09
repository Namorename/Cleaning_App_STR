import type { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { createAppQueryClient } from '@/lib/query-client';
import { withClient } from '@/testing/restored-cache';

import { mediaMutationKeys, useFailedVideoAttach, type AttachMediaVariables } from '../use-media';

jest.mock('@/features/chat/api', () => ({ sendMessage: jest.fn() }));
jest.mock('../api', () => ({}));
jest.mock('../file', () => ({ discardFile: jest.fn() }));
jest.mock('../local-store', () => ({}));
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));

const STEP = 'b1c2d3e4-1111-4111-8111-b1c2d3e40001';

/** Longer than the five minutes TanStack keeps a mutation nobody watches by default. */
const SIX_MINUTES = 6 * 60_000;

function variables(overrides: Partial<AttachMediaVariables> = {}): AttachMediaVariables {
  return {
    taskId: 't1',
    stepId: STEP,
    uri: 'file:///documents/task-media/m1.mp4',
    mediaId: 'm1',
    kind: 'video',
    mimeType: 'video/mp4',
    byteSize: 21_000_000,
    width: null,
    height: null,
    durationSec: 12.3,
    takenAt: '2026-10-09T08:00:00.000Z',
    source: 'camera',
    ...overrides,
  };
}

/**
 * An upload the queue gave up on, the way the recording screen's would end:
 * built in the app's own cache, so it takes the defaults registered for the
 * key, the time it is kept among them. One attempt: the retries are not what
 * this file is about.
 */
async function failedAttach(client: QueryClient, vars: AttachMediaVariables, error: Error) {
  const mutation = client.getMutationCache().build(client, {
    mutationKey: mediaMutationKeys.attach,
    mutationFn: async () => {
      throw error;
    },
    retry: false,
  });
  await act(async () => {
    await mutation.execute(vars).catch(() => undefined);
  });
}

let client: QueryClient;

beforeEach(() => {
  client = createAppQueryClient();
});

afterEach(() => {
  client.clear();
  jest.useRealTimers();
});

// The recording screen hands a video to the queue and goes back; the refusal
// comes later, to a screen that did not start the upload. The step's screen
// reads it from the queue itself. The step's own refusal comes first: read
// without the filter, the latest attempt — another step's, a photo's — would
// be the one said.
test('the step hears of its own video’s refusal, not of another step’s or of a photo’s', async () => {
  // Arrange
  const refused = new Error('too long');

  // Act
  await failedAttach(client, variables(), refused);
  await failedAttach(client, variables({ stepId: 'another-step' }), new Error('other step'));
  await failedAttach(client, variables({ kind: 'photo', mediaId: 'p1' }), new Error('a photo'));
  const { result } = await renderHook(() => useFailedVideoAttach(STEP), {
    wrapper: withClient(client),
  });

  // Assert
  expect(result.current).toBe(refused);
});

// She is back on the step long after the recording screen handed the video
// over, and nobody watched the upload meanwhile: the refusal is still there
// to be said, not collected after TanStack's default five minutes.
test('a refusal is still there to be said after minutes nobody watched the queue', async () => {
  // Arrange
  jest.useFakeTimers();
  const refused = new Error('too long');
  await failedAttach(client, variables(), refused);

  // Act
  await act(async () => {
    jest.advanceTimersByTime(SIX_MINUTES);
  });
  const { result } = await renderHook(() => useFailedVideoAttach(STEP), {
    wrapper: withClient(client),
  });

  // Assert
  expect(result.current).toBe(refused);
});

// A refused video and a new one recorded after it: the step speaks of the
// new one, which went through, not of the old one the server turned down.
test('a newer video sent to the step outweighs an older refusal', async () => {
  // Arrange
  await failedAttach(client, variables(), new Error('too long'));
  const retaken = client.getMutationCache().build(client, {
    mutationKey: mediaMutationKeys.attach,
    mutationFn: async () => ({}),
  });

  // Act
  await act(async () => {
    await retaken.execute(variables({ mediaId: 'm2' }));
  });
  const { result } = await renderHook(() => useFailedVideoAttach(STEP), {
    wrapper: withClient(client),
  });

  // Assert
  expect(result.current).toBeNull();
});

// She removed the video; its upload, still running, failed afterwards — the
// row was gone under it. That failure is about a video she no longer has.
test('a video removed meanwhile does not speak of its upload’s later failure', async () => {
  // Arrange: the upload is on its way.
  let failUpload: (error: Error) => void = () => undefined;
  const upload = client.getMutationCache().build(client, {
    mutationKey: mediaMutationKeys.attach,
    mutationFn: () =>
      new Promise((_resolve, reject: (error: Error) => void) => {
        failUpload = reject;
      }),
    retry: false,
  });
  const running = upload.execute(variables()).catch(() => undefined);
  const removal = client.getMutationCache().build(client, {
    mutationKey: mediaMutationKeys.remove,
    mutationFn: async () => ({}),
  });

  // Act: removed, then the upload fails.
  await act(async () => {
    await removal.execute({ taskId: 't1', mediaId: 'm1' });
    failUpload(new Error('row gone'));
    await running;
  });
  const { result } = await renderHook(() => useFailedVideoAttach(STEP), {
    wrapper: withClient(client),
  });

  // Assert
  expect(result.current).toBeNull();
});

test('and nothing while nothing was refused', async () => {
  const { result } = await renderHook(() => useFailedVideoAttach(STEP), {
    wrapper: withClient(client),
  });

  expect(result.current).toBeNull();
});
