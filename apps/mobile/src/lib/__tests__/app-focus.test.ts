import { focusManager, onlineManager } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { subscribeFocusToAppState } from '../app-focus';
import { checkConnection } from '../online';

/**
 * Coming back to the app after no signal, the server is looked for at once:
 * what she tapped in the stairwell goes out now, not at the next tick of the
 * watch.
 */

jest.mock('../online', () => ({ checkConnection: jest.fn(() => Promise.resolve()) }));

type Listener = (status: string) => void;

function captureListener(): Listener {
  const spy = jest.spyOn(AppState, 'addEventListener');
  subscribeFocusToAppState();
  return spy.mock.calls[spy.mock.calls.length - 1][1] as Listener;
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  onlineManager.setOnline(true);
});

test('back in front while offline: the server is looked for at once', () => {
  const onChange = captureListener();
  onlineManager.setOnline(false);

  onChange('active');

  expect(checkConnection).toHaveBeenCalledTimes(1);
  expect(focusManager.isFocused()).toBe(true);
});

test('back in front while online: nothing to look for', () => {
  const onChange = captureListener();

  onChange('active');

  expect(checkConnection).not.toHaveBeenCalled();
});

test('going to the background looks for nothing', () => {
  const onChange = captureListener();
  onlineManager.setOnline(false);

  onChange('background');

  expect(checkConnection).not.toHaveBeenCalled();
});
