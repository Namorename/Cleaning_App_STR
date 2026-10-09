import { announcedSecondsLeft, clockText, measuredSeconds, secondsLeft } from '../recording';

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
