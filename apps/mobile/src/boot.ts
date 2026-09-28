import { installForegroundHandler } from '@/features/push/foreground';
import { initSentry } from '@/lib/sentry';

/**
 * What must run before the first screen is drawn, imported by the entry
 * (index.js) ahead of the router:
 * - crash reports, so a failure while drawing the first screen is caught;
 * - the foreground handler: without one a push arriving while the app is
 *   open is not shown at all.
 *
 * This entry exists only from build 1.1.0 on — both need native modules the
 * 1.0.0 build does not have, and its runtime version keeps this bundle away
 * from it.
 */
initSentry();
installForegroundHandler();
