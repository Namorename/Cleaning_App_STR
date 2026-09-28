import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { onlineManager } from '@tanstack/react-query';

import { watchNetwork } from '../network';
import { checkConnection, goOffline } from '../online';

/**
 * The radio as a hint, the server as the authority.
 *
 * NetInfo knows at once when the phone loses its network — that pauses the
 * moves without waiting for one to fail. It does not know whether the server
 * answers (a hotel's Wi-Fi login page, a weak signal), so a network coming
 * back only makes the app look for the server; the look decides.
 */

jest.mock('../online', () => ({
  goOffline: jest.fn(),
  checkConnection: jest.fn(async () => undefined),
}));

type Listener = (state: Partial<NetInfoState>) => void;

function watch(): { listener: Listener; stop: () => void } {
  const stop = watchNetwork();
  const calls = (NetInfo.addEventListener as jest.Mock).mock.calls;
  return { listener: calls[calls.length - 1][0] as Listener, stop };
}

beforeEach(() => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
});

afterEach(() => {
  onlineManager.setOnline(true);
});

test("the phone never asks a third party's server whether it is online", () => {
  watch().stop();

  expect(NetInfo.configure).toHaveBeenCalledWith(
    expect.objectContaining({ reachabilityShouldRun: expect.any(Function) }),
  );
  const { reachabilityShouldRun } = (NetInfo.configure as jest.Mock).mock.calls[0][0];
  expect(reachabilityShouldRun()).toBe(false);
});

test('losing the network pauses the moves at once', () => {
  const { listener, stop } = watch();

  listener({ isConnected: false });

  expect(goOffline).toHaveBeenCalledTimes(1);
  stop();
});

test('the network coming back makes the app look for the server', () => {
  const { listener, stop } = watch();
  onlineManager.setOnline(false);

  listener({ isConnected: true });

  expect(checkConnection).toHaveBeenCalledTimes(1);
  expect(onlineManager.isOnline()).toBe(false);
  stop();
});

test('a network event while already online asks nothing', () => {
  const { listener, stop } = watch();

  listener({ isConnected: true });

  expect(checkConnection).not.toHaveBeenCalled();
  expect(goOffline).not.toHaveBeenCalled();
  stop();
});

test('a network not known yet changes nothing: the app does not start offline', () => {
  const { listener, stop } = watch();

  listener({ isConnected: null });

  expect(goOffline).not.toHaveBeenCalled();
  expect(checkConnection).not.toHaveBeenCalled();
  stop();
});

test('stopping the watch unsubscribes', () => {
  const unsubscribe = jest.fn();
  (NetInfo.addEventListener as jest.Mock).mockReturnValueOnce(unsubscribe);

  watchNetwork()();

  expect(unsubscribe).toHaveBeenCalledTimes(1);
});
