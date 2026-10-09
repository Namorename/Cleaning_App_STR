/**
 * Everything but the clock stays real: timers, ticks and frames run as they
 * would, so a screen still renders and settles under the test.
 */
const REAL = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

/**
 * Pins «today» to the day a test's dates were written for, so a line that
 * names the year only off the current one (history, board) reads the same in
 * any year the test runs. Undo with `jest.useRealTimers()`.
 */
export function pinToday(now: Date): void {
  jest.useFakeTimers({ now, doNotFake: [...REAL] });
}
