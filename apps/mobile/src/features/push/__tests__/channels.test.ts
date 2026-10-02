import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { DEFAULT_PUSH_CHANNEL, PUSH_CHANNELS, ensureChannels } from '../channels';

/**
 * Android shows a push only in a channel that exists on the phone, and send-push
 * names one of two (run.ts: `channelId: urgent ? 'urgent' : 'general'`). A
 * channel's importance and sound are fixed the day it is made; only its name
 * follows her language.
 */

const setChannel = Notifications.setNotificationChannelAsync as jest.Mock;
const originalOS = Platform.OS;

function runOn(os: typeof Platform.OS) {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
}

afterEach(() => {
  runOn(originalOS);
  setChannel.mockClear();
});

test('the channels are the two send-push names, and the default is one of them', () => {
  expect(PUSH_CHANNELS).toEqual(['urgent', 'general']);
  expect(PUSH_CHANNELS).toContain(DEFAULT_PUSH_CHANNEL);
});

// Both pop up as a banner (owner, 2026-09-30: she can quiet «Остальные» in
// Android or switch kinds off in «Настройки»); only the urgent one buzzes.
test('on Android both channels are made to pop up, urgent with a buzz, named in her language', async () => {
  runOn('android');

  await ensureChannels();

  expect(setChannel).toHaveBeenCalledTimes(2);
  expect(setChannel).toHaveBeenCalledWith(
    'urgent',
    expect.objectContaining({
      name: 'Срочные уведомления',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: expect.any(Array),
    }),
  );
  expect(setChannel).toHaveBeenCalledWith(
    'general',
    expect.objectContaining({
      name: 'Остальные уведомления',
      importance: Notifications.AndroidImportance.HIGH,
    }),
  );
  const general = setChannel.mock.calls.find(([id]) => id === 'general')?.[1];
  expect(general).not.toHaveProperty('vibrationPattern');
});

test('no channel names a sound: the phone plays its own', async () => {
  runOn('android');

  await ensureChannels();

  for (const [, input] of setChannel.mock.calls) {
    expect(input).not.toHaveProperty('sound');
  }
});

test('an iPhone has no channels to make', async () => {
  runOn('ios');

  await ensureChannels();

  expect(setChannel).not.toHaveBeenCalled();
});
