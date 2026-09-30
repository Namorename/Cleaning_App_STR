import { installForegroundHandler } from '@/features/push/foreground';

/**
 * What must run before the first screen is drawn, imported by the entry
 * (index.js) after crash reports and ahead of the router: the foreground
 * handler — without one a push arriving while the app is open is not shown
 * at all.
 *
 * This entry exists only from build 1.1.0 on — it needs a native module the
 * 1.0.0 build does not have, and its runtime version keeps this bundle away
 * from it.
 */
installForegroundHandler();
