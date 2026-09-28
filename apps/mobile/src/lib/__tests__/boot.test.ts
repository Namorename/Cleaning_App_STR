import * as Notifications from 'expo-notifications';

import { initSentry } from '../sentry';

// Imported for what it does: every test file starts with its own modules, so
// this runs once, here, after the mock below is in place.
import '../../boot';

/**
 * What runs before anything renders (index.js → src/boot.ts): crash reports,
 * so a failure while drawing the first screen is caught, and the foreground
 * handler, without which a push arriving while the app is open is not shown.
 */

jest.mock('../sentry', () => ({ initSentry: jest.fn(() => false), reportError: jest.fn() }));

test('starting the app starts crash reports and the push handler', () => {
  expect(initSentry).toHaveBeenCalledTimes(1);
  expect(Notifications.setNotificationHandler).toHaveBeenCalledTimes(1);
});
