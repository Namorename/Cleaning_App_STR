import { QueryClient } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react-native';

import { withClient } from '@/testing/restored-cache';

import { mediaMutationKeys, useFailedVideoAttach, type AttachMediaVariables } from '../use-media';

jest.mock('@/features/chat/api', () => ({ sendMessage: jest.fn() }));
jest.mock('../api', () => ({}));
jest.mock('../file', () => ({ discardFile: jest.fn() }));
jest.mock('../local-store', () => ({}));
jest.mock('@/features/auth/session', () => ({ useSession: () => ({ userId: 'u1' }) }));

const STEP = 'b1c2d3e4-1111-4111-8111-b1c2d3e40001';

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

/** An upload the queue gave up on, the way the recording screen's would end. */
async function failedAttach(client: QueryClient, vars: AttachMediaVariables, error: Error) {
  const mutation = client.getMutationCache().build(client, {
    mutationKey: mediaMutationKeys.attach,
    mutationFn: async () => {
      throw error;
    },
  });
  await act(async () => {
    await mutation.execute(vars).catch(() => undefined);
  });
}

// The recording screen hands a video to the queue and goes back; the refusal
// comes later, to a screen that did not start the upload. The step's screen
// reads it from the queue itself.
test('the step hears of its own video’s refusal, not of another step’s or of a photo’s', async () => {
  // Arrange
  const client = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });
  const refused = new Error('too long');

  // Act
  await failedAttach(client, variables({ stepId: 'another-step' }), new Error('other step'));
  await failedAttach(client, variables({ kind: 'photo', mediaId: 'p1' }), new Error('a photo'));
  await failedAttach(client, variables(), refused);
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
  const client = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });
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

test('and nothing while nothing was refused', async () => {
  const client = new QueryClient();

  const { result } = await renderHook(() => useFailedVideoAttach(STEP), {
    wrapper: withClient(client),
  });

  expect(result.current).toBeNull();
});
