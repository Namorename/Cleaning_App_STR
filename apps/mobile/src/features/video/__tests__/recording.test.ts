import {
  announcedSecondsLeft,
  cameraEnd,
  clockText,
  measuredSeconds,
  secondsLeft,
} from '../recording';

describe('measuredSeconds', () => {
  test('is the time between asking and stopping, to a tenth of a second', () => {
    expect(measuredSeconds(1_000, 13_345, 90)).toBe(12.3);
    expect(measuredSeconds(1_000, 13_351, 90)).toBe(12.4);
  });

  // The camera stops at the limit itself; what our timer adds for its start-up
  // must not turn into a refusal for a video that is exactly as long as allowed.
  test('is never longer than the limit', () => {
    expect(measuredSeconds(0, 90_800, 90)).toBe(90);
  });

  test('and never below nothing, whatever the clock did', () => {
    expect(measuredSeconds(5_000, 4_000, 90)).toBe(0);
  });
});

describe('the countdown', () => {
  test('counts whole seconds down from the limit and stops at nothing', () => {
    expect(secondsLeft(0, 90)).toBe(90);
    expect(secondsLeft(999, 90)).toBe(90);
    expect(secondsLeft(1_000, 90)).toBe(89);
    expect(secondsLeft(95_000, 90)).toBe(0);
  });

  test('tells the reader every ten seconds, and holds between', () => {
    expect(announcedSecondsLeft(0, 90)).toBe(90);
    expect(announcedSecondsLeft(9_999, 90)).toBe(90);
    expect(announcedSecondsLeft(10_000, 90)).toBe(80);
    expect(announcedSecondsLeft(85_000, 90)).toBe(10);
    expect(announcedSecondsLeft(120_000, 90)).toBe(0);
  });

  test('reads as minutes and seconds', () => {
    expect(clockText(90)).toBe('1:30');
    expect(clockText(65)).toBe('1:05');
    expect(clockText(9)).toBe('0:09');
    expect(clockText(0)).toBe('0:00');
  });
});

// The camera ends a recording itself at either limit, and also when a call or
// the system takes it: only the first two are a limit.
describe('cameraEnd', () => {
  const CAP = 43_650_000;

  test('within a second of the length limit, it was the limit', () => {
    expect(cameraEnd(89, 90, 1_000_000, CAP)).toBe('limit');
    expect(cameraEnd(88.9, 90, 1_000_000, CAP)).toBe('interrupted');
  });

  test('from 95 % of the size cap up, it was the limit', () => {
    expect(cameraEnd(30, 90, 41_467_500, CAP)).toBe('limit');
    expect(cameraEnd(30, 90, 41_467_499, CAP)).toBe('interrupted');
  });

  test('a size that could not be read leaves only the length to say', () => {
    expect(cameraEnd(30, 90, null, CAP)).toBe('interrupted');
    expect(cameraEnd(89.5, 90, null, CAP)).toBe('limit');
  });
});
