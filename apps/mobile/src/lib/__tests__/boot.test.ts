import * as Notifications from 'expo-notifications';

// Imported for what it does: every test file starts with its own modules, so
// this runs once, here.
import '../../boot';

/**
 * What runs before anything renders, after crash reports (index.js →
 * src/crash-reports.ts, then src/boot.ts): the foreground handler, without
 * which a push arriving while the app is open is not shown.
 */

test('starting the app installs the push handler', () => {
  expect(Notifications.setNotificationHandler).toHaveBeenCalledTimes(1);
});
