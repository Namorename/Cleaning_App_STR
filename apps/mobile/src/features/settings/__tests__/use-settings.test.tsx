import { QueryClient, dehydrate, hydrate, type DehydratedState } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { restoredFromDisk, withClient } from '@/testing/restored-cache';

import { fetchMyPushPreferences, setPushPreference } from '../api';
import { settingsKeys, settingsMutationKeys } from '../keys';
import {
  registerSettingsMutations,
  usePushPreferences,
  useSetPushPreference,
  type PushChoice,
} from '../use-settings';

jest.mock('../api', () => ({
  fetchMyPushPreferences: jest.fn(),
  setPushPreference: jest.fn(),
  saveMyLanguage: jest.fn(),
}));

jest.mock('@/features/auth/session', () => ({
  useSession: () => ({ userId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' }),
}));

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const fetchPreferences = jest.mocked(fetchMyPushPreferences);
const setPreference = jest.mocked(setPushPreference);

/** A client as the app builds it: the push write registered before anything runs. */
function appClient(): QueryClient {
  // gcTime Infinity schedules no collection timer, so nothing holds the worker.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  registerSettingsMutations(client);
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('usePushPreferences', () => {
  test('a row saved to disk without its list reads as everything on', async () => {
    // Arrange: the refresh never answers, so the hook shows what the disk gave.
    const client = restoredFromDisk(settingsKeys.push(ME), { profile_id: ME });
    fetchPreferences.mockReturnValue(new Promise(() => {}));

    // Act
    const { result } = await renderHook(() => usePushPreferences(), {
      wrapper: withClient(client),
    });

    // Assert
    expect(result.current.data).toEqual({ profile_id: ME, muted: [] });
    expect(result.current.isError).toBe(false);
  });

  test('a kind this build does not know is dropped from what the disk gave', async () => {
    const client = restoredFromDisk(settingsKeys.push(ME), {
      profile_id: ME,
      muted: ['chat_message', 'cleaning_teleported'],
    });
    fetchPreferences.mockReturnValue(new Promise(() => {}));

    const { result } = await renderHook(() => usePushPreferences(), {
      wrapper: withClient(client),
    });

    expect(result.current.data?.muted).toEqual(['chat_message']);
  });
});

describe('useSetPushPreference', () => {
  test('the switch moves at once and the server’s row settles it', async () => {
    // Arrange: her row has nothing muted; the write is held until we say.
    const client = appClient();
    client.setQueryData(settingsKeys.push(ME), { profile_id: ME, muted: [] });
    let answer: (row: { profile_id: string; muted: 'daily_digest'[] }) => void = () => {};
    setPreference.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const { result } = await renderHook(() => useSetPushPreference(), {
      wrapper: withClient(client),
    });

    // Act
    await act(async () => {
      result.current.mutate({ userId: ME, kind: 'daily_digest', enabled: false });
    });

    // Assert: shown off before the server has said anything.
    expect(client.getQueryData(settingsKeys.push(ME))).toEqual({
      profile_id: ME,
      muted: ['daily_digest'],
    });
    expect(setPreference).toHaveBeenCalledWith('daily_digest', false);

    // Act: the server agrees.
    await act(async () => {
      answer({ profile_id: ME, muted: ['daily_digest'] });
    });

    // Assert
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(client.getQueryData(settingsKeys.push(ME))).toEqual({
      profile_id: ME,
      muted: ['daily_digest'],
    });
  });

  test('a refused write puts the switch back and says why', async () => {
    // Arrange
    const client = appClient();
    client.setQueryData(settingsKeys.push(ME), { profile_id: ME, muted: ['chat_message'] });
    fetchPreferences.mockResolvedValue({ profile_id: ME, muted: ['chat_message'] });
    setPreference.mockRejectedValue(new Error('permission denied'));
    const { result } = await renderHook(() => useSetPushPreference(), {
      wrapper: withClient(client),
    });

    // Act
    await act(async () => {
      result.current.mutate({ userId: ME, kind: 'chat_message', enabled: true });
    });

    // Assert
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('permission denied');
    expect(client.getQueryData(settingsKeys.push(ME))).toEqual({
      profile_id: ME,
      muted: ['chat_message'],
    });
  });
});

describe('a choice made without signal', () => {
  /** The disk after a restart: one choice paused, waiting for signal. */
  function restoredWithPausedChoice(choice: PushChoice): QueryClient {
    const before = new QueryClient({ defaultOptions: { mutations: { gcTime: Infinity } } });
    before.getMutationCache().build(
      before,
      { mutationKey: settingsMutationKeys.push },
      {
        context: { wasEnabled: true },
        data: undefined,
        error: null,
        failureCount: 0,
        failureReason: null,
        isPaused: true,
        status: 'pending',
        variables: choice,
        submittedAt: Date.now(),
      },
    );
    const onDisk = JSON.parse(JSON.stringify(dehydrate(before))) as DehydratedState;
    before.clear();

    const client = appClient();
    hydrate(client, onDisk);
    return client;
  }

  test('is sent after a restart as the value she chose, and lands in the cache', async () => {
    // Arrange
    const client = restoredWithPausedChoice({ userId: ME, kind: 'cleaning_free', enabled: false });
    setPreference.mockResolvedValue({ profile_id: ME, muted: ['cleaning_free'] });

    // Act
    await act(async () => {
      await client.resumePausedMutations();
    });

    // Assert
    expect(setPreference).toHaveBeenCalledWith('cleaning_free', false);
    expect(client.getQueryData(settingsKeys.push(ME))).toEqual({
      profile_id: ME,
      muted: ['cleaning_free'],
    });
    client.clear();
  });

  test('a replay says the same thing again, never the opposite', async () => {
    // Arrange: the first attempt reached the server but its answer was lost.
    const choice: PushChoice = { userId: ME, kind: 'chat_message', enabled: false };
    const client = restoredWithPausedChoice(choice);
    setPreference.mockResolvedValue({ profile_id: ME, muted: ['chat_message'] });

    // Act: resumed once after the restart, then tapped again the same way.
    await act(async () => {
      await client.resumePausedMutations();
    });
    const { result } = await renderHook(() => useSetPushPreference(), {
      wrapper: withClient(client),
    });
    await act(async () => {
      await result.current.mutateAsync(choice);
    });

    // Assert
    expect(setPreference.mock.calls).toEqual([
      ['chat_message', false],
      ['chat_message', false],
    ]);
    client.clear();
  });
});
