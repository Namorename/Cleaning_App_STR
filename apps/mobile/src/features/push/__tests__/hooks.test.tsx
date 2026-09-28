import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { AppState } from 'react-native';

import { fetchTask } from '@/features/tasks/api';
import { withClient } from '@/testing/restored-cache';

import { usePermissionPrompt, usePushRefresh, usePushRegistration, usePushTaps } from '../hooks';
import { registerThisPhone } from '../registration';
import { isRegisteredFor } from '../token-store';

/**
 * The push wiring in the app's tree: registering the phone for whoever signs
 * in, refreshing what a push made stale, opening what a tap was about, and
 * asking — once a run — before the system does.
 */

jest.mock('../registration', () => ({ registerThisPhone: jest.fn(async () => true) }));
jest.mock('@/features/tasks/api', () => ({ fetchTask: jest.fn(async () => null) }));
jest.mock('../token-store', () => ({ isRegisteredFor: jest.fn(() => true) }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), navigate: jest.fn(), dismissAll: jest.fn(), canDismiss: jest.fn() },
}));

const mockRegister = jest.mocked(registerThisPhone);
const registered = jest.mocked(isRegisteredFor);
const canDismiss = router.canDismiss as jest.Mock;
const lastResponse = Notifications.useLastNotificationResponse as jest.Mock;
const getPermissions = Notifications.getPermissionsAsync as jest.Mock;

const ME = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const TASK_ID = '0b3f5c1e-8d2a-4f6b-9c7d-1e2f3a4b5c6d';
const THREAD_ID = '9f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a';

/** A tap on a push delivered at `date`: pushes about one thread or cleaning share an identifier. */
function tap(identifier: string, data: unknown, date = 1_000) {
  return {
    actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
    notification: { date, request: { identifier, content: { data } } },
  };
}

/** The listener most recently handed to a subscribe function. */
function lastListener<T>(subscribe: unknown, argument = 0): T {
  const calls = (subscribe as jest.Mock).mock.calls;
  return calls[calls.length - 1][argument] as T;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

beforeEach(() => {
  jest.clearAllMocks();
  lastResponse.mockReturnValue(null);
  registered.mockReturnValue(true);
  canDismiss.mockReturnValue(false);
});

describe('usePushRegistration', () => {
  test('nobody signed in: nothing is registered', async () => {
    await renderHook(() => usePushRegistration(null));

    expect(mockRegister).not.toHaveBeenCalled();
  });

  test('registers the phone for her once she is signed in', async () => {
    await renderHook(() => usePushRegistration(ME));

    expect(mockRegister).toHaveBeenCalledWith(ME);
  });

  test('coming back to the app tries again: she may have allowed pushes meanwhile', async () => {
    // React Native's jest setup already stands AppState in with a mock.
    await renderHook(() => usePushRegistration(ME));
    mockRegister.mockClear();

    lastListener<(status: string) => void>(AppState.addEventListener, 1)('active');

    expect(mockRegister).toHaveBeenCalledWith(ME);
  });

  test('a new token from the system is registered with it', async () => {
    await renderHook(() => usePushRegistration(ME));
    const device = { type: 'android', data: 'fcm-2' };

    lastListener<(token: unknown) => void>(Notifications.addPushTokenListener)(device);

    expect(mockRegister).toHaveBeenLastCalledWith(ME, device);
  });

  test("the token the phone's own registration fetched does not register it a second time", async () => {
    // Every token fetch also fires the token event; before this run's
    // registration succeeded, that event is the registration's own echo.
    registered.mockReturnValue(false);
    await renderHook(() => usePushRegistration(ME));
    mockRegister.mockClear();

    lastListener<(token: unknown) => void>(Notifications.addPushTokenListener)({
      type: 'android',
      data: 'fcm-1',
    });

    expect(mockRegister).not.toHaveBeenCalled();
  });

  test('a failure is reported, not thrown; no signal is not even reported', async () => {
    mockRegister.mockRejectedValueOnce(new Error('refused'));
    await renderHook(() => usePushRegistration(ME));
    await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));

    mockRegister.mockRejectedValueOnce(new TypeError('Network request failed'));
    lastListener<(token: unknown) => void>(Notifications.addPushTokenListener)({
      type: 'ios',
      data: 'apns',
    });
    await settle();

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});

describe('usePushRefresh', () => {
  test('a push arriving while the app is open makes what it names stale', async () => {
    const client = new QueryClient();
    const invalidate = jest.spyOn(client, 'invalidateQueries');
    await renderHook(() => usePushRefresh(), { wrapper: withClient(client) });

    lastListener<(n: unknown) => void>(Notifications.addNotificationReceivedListener)({
      request: {
        content: {
          data: { kind: 'chat_message', subject: 'task', id: TASK_ID, threadId: THREAD_ID },
        },
      },
    });

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chat', 'unread'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['chat', 'messages', THREAD_ID] });
  });
});

describe('usePushTaps', () => {
  test('a tap on a cleaning opens it, once her session is known', async () => {
    const client = new QueryClient();
    lastResponse.mockReturnValue(tap('n-1', { kind: 'cleaning_new', taskId: TASK_ID }));

    await renderHook(() => usePushTaps(ME), { wrapper: withClient(client) });

    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith({
        pathname: '/task/[id]',
        params: { id: TASK_ID },
      }),
    );
    expect(Notifications.clearLastNotificationResponse).toHaveBeenCalled();
  });

  test('a tap opens its screen without waiting for the lists to refresh', async () => {
    // An active list whose refetch never answers: a stalled connection.
    const client = new QueryClient();
    const observer = new QueryObserver(client, {
      queryKey: ['tasks', 'mine', ME],
      queryFn: () => new Promise<never>(() => undefined),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    lastResponse.mockReturnValue(tap('n-7', { kind: 'cleaning_new', taskId: TASK_ID }));

    await renderHook(() => usePushTaps(ME), { wrapper: withClient(client) });

    await waitFor(() => expect(router.navigate).toHaveBeenCalledTimes(1));
    expect(client.getQueryState(['tasks', 'mine', ME])?.isInvalidated).toBe(true);
    unsubscribe();
  });

  test('two pushes about one thread are two taps: each is followed', async () => {
    const client = new QueryClient();
    const message = { kind: 'chat_message', subject: 'task', id: TASK_ID, threadId: THREAD_ID };
    lastResponse.mockReturnValue(tap(`thread:${THREAD_ID}`, message, 1_000));
    const { rerender } = await renderHook(() => usePushTaps(ME), { wrapper: withClient(client) });
    await waitFor(() => expect(router.navigate).toHaveBeenCalledTimes(1));

    lastResponse.mockReturnValue(tap(`thread:${THREAD_ID}`, message, 2_000));
    await rerender({});

    await waitFor(() => expect(router.navigate).toHaveBeenCalledTimes(2));
  });

  test('the same tap is not followed twice when the tabs draw again', async () => {
    const client = new QueryClient();
    lastResponse.mockReturnValue(tap('n-2', { kind: 'cleaning_new', taskId: TASK_ID }));
    const first = await renderHook(() => usePushTaps(ME), { wrapper: withClient(client) });
    await waitFor(() => expect(router.navigate).toHaveBeenCalledTimes(1));
    await first.unmount();

    await renderHook(() => usePushTaps(ME), { wrapper: withClient(client) });
    await settle();

    expect(router.navigate).toHaveBeenCalledTimes(1);
  });

  test('signed out, a tap waits', async () => {
    const client = new QueryClient();
    lastResponse.mockReturnValue(tap('n-3', { kind: 'cleaning_new', taskId: TASK_ID }));

    await renderHook(() => usePushTaps(null), { wrapper: withClient(client) });
    await settle();

    expect(router.navigate).not.toHaveBeenCalled();
    expect(Notifications.clearLastNotificationResponse).not.toHaveBeenCalled();
  });

  test('a cleaning taken off her lands on her list, saying so, not on a second copy of it', async () => {
    // She is on some screen over the tabs: going to the list closes it.
    canDismiss.mockReturnValue(true);
    const client = new QueryClient();
    lastResponse.mockReturnValue(tap('n-4', { kind: 'cleaning_unassigned', taskId: TASK_ID }));

    await renderHook(() => usePushTaps(ME), { wrapper: withClient(client) });

    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith({
        pathname: '/(tabs)',
        params: { notice: 'unassigned' },
      }),
    );
    expect(router.dismissAll).toHaveBeenCalledTimes(1);
    expect(jest.mocked(router.dismissAll).mock.invocationCallOrder[0]).toBeLessThan(
      jest.mocked(router.navigate).mock.invocationCallOrder[0],
    );
  });

  test('a moved cleaning is looked up before it is opened', async () => {
    const client = new QueryClient();
    lastResponse.mockReturnValue(tap('n-5', { kind: 'cleaning_moved', taskId: TASK_ID }));

    await renderHook(() => usePushTaps(ME), { wrapper: withClient(client) });

    await waitFor(() => expect(router.navigate).toHaveBeenCalled());
    expect(fetchTask).toHaveBeenCalledWith(TASK_ID);
  });

  test('data the app cannot read only opens the app', async () => {
    const client = new QueryClient();
    lastResponse.mockReturnValue(tap('n-6', { kind: 'from_the_future' }));

    await renderHook(() => usePushTaps(ME), { wrapper: withClient(client) });
    await settle();

    expect(router.navigate).not.toHaveBeenCalled();
  });
});

describe('usePermissionPrompt', () => {
  const neverAsked = { status: 'denied', granted: false, canAskAgain: true, expires: 'never' };
  const allowed = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' };

  afterEach(() => {
    getPermissions.mockReset().mockResolvedValue(allowed);
  });

  test('a phone that allows pushes is not asked', async () => {
    await renderHook(() => usePermissionPrompt(ME));
    await settle();

    expect(router.push).not.toHaveBeenCalled();
  });

  test('a phone never asked is shown the explainer, once a run', async () => {
    getPermissions.mockResolvedValue(neverAsked);

    const first = await renderHook(() => usePermissionPrompt(ME));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/notifications'));
    await first.unmount();
    await renderHook(() => usePermissionPrompt(ME));
    await settle();

    expect(router.push).toHaveBeenCalledTimes(1);
  });
});

describe('the web build', () => {
  test('has no tapped push to follow, and asks the notifications module nothing', () => {
    const { useLastResponse } =
      jest.requireActual<typeof import('../last-response.web')>('../last-response.web');

    expect(useLastResponse()).toBeNull();
    expect(lastResponse).not.toHaveBeenCalled();
  });
});
