const { availableParallelism } = require('node:os');
const path = require('node:path');

/**
 * lucide-react-native publishes each icon as an ES module (`.mjs`): that is
 * what Jest's React Native environment resolves the package's `exports` to,
 * and the preset transforms no `.mjs`. Jest reads the package's CommonJS build
 * instead — the same icons, the same components. The app's bundler keeps the
 * ES modules.
 */
const LUCIDE_CJS = path.dirname(require.resolve('lucide-react-native'));

/**
 * Workers: half the machine, never more than four. Jest's default is every
 * core but one, and each worker pays for loading React Native on its own; on
 * a 16 GB laptop that shares the cores with the panel's tests and a build,
 * seven of them starved one another until the first test of a file ran past
 * its budget.
 */
const MAX_WORKERS = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));

/**
 * Per test. A test here takes tens of milliseconds once the file has warmed up
 * (jest.setup.ts); this is the ceiling for a machine under load, not a budget
 * any test is expected to use. Kept above the `waitFor` timeout set in
 * jest.setup.ts, so a wait that never succeeds reports what it was waiting
 * for instead of a bare "Exceeded timeout".
 */
const TEST_TIMEOUT_MS = 15_000;

/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  maxWorkers: MAX_WORKERS,
  testTimeout: TEST_TIMEOUT_MS,
  moduleNameMapper: {
    '^lucide-react-native/icons$': path.join(LUCIDE_CJS, 'icons', 'index.js'),
    '^lucide-react-native/icons/(.+)$': path.join(LUCIDE_CJS, 'icons', '$1.js'),
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg)',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
};
