import { initSentry } from '../sentry';

// Imported for what it does: every test file starts with its own modules, so
// this runs once, here, after the mock below is in place.
import '../../crash-reports';

/**
 * The first thing the app runs (index.js → src/crash-reports.ts): crash
 * reports, before anything that reads the app's configuration — a build
 * missing it then reports its crash at start instead of dying in silence
 * (docs/f11-native-review.md, С-2).
 */

jest.mock('../sentry', () => ({ initSentry: jest.fn(() => false) }));

test('starting the app starts crash reports', () => {
  expect(initSentry).toHaveBeenCalledTimes(1);
});
