/**
 * The React Native test environment, west of Greenwich: a test file that
 * names it in its docblock (`@jest-environment
 * ./src/testing/west-of-greenwich-env.js`) runs in Los Angeles. A calendar
 * date read as midnight UTC is the day before there, which is the mistake the
 * phone's date code must never make (features/tasks/format.ts).
 *
 * The zone is the worker process's own (Node redetects it when `TZ` is set),
 * so it is set for this file alone and given back when it ends: the next file
 * in the same worker runs where it always did.
 */
const ReactNativeEnvironment = require('@react-native/jest-preset/jest/react-native-env');

const WEST_OF_GREENWICH = 'America/Los_Angeles';

module.exports = class WestOfGreenwichEnvironment extends ReactNativeEnvironment {
  async setup() {
    this.savedTimeZone = process.env.TZ;
    process.env.TZ = WEST_OF_GREENWICH;
    await super.setup();
  }

  async teardown() {
    if (this.savedTimeZone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = this.savedTimeZone;
    }
    await super.teardown();
  }
};
