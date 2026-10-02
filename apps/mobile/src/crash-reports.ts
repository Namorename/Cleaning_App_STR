import { initSentry } from '@/lib/sentry';

/**
 * The first thing the app runs, imported by the entry (index.js) ahead of
 * everything else: crash reports. Its own module, and one that reads nothing
 * of the app's configuration — imports run in order, so a build missing that
 * configuration fails in a module imported after this one and the failure is
 * reported, instead of an app that dies at start in silence
 * (docs/f11-native-review.md, С-2).
 *
 * This entry exists only from build 1.1.0 on: Sentry needs a native module the
 * 1.0.0 build does not have, and its runtime version keeps this bundle away
 * from it.
 */
initSentry();
