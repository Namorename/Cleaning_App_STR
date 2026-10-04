import {
  CALENDAR_MARK_SHAPE,
  STEP_CIRCLE,
  THEME_NAMES,
  TONE_COLORS,
  type ThemeName,
  type Tone,
} from '@str-ops/shared';

import { deltaE, minDeficiencyDeltaE } from '../../../../../packages/shared/src/testing/color-math';

/**
 * Two statuses side by side must not look like one — to a manager scanning a
 * month of the calendar, and to the one in twelve men who sees colour
 * differently.
 *
 * The rule is the comparison page's and the dataviz validator's (OKLab ΔE ×
 * 100, Machado 2009 at full severity): every pair of marks at least 15 apart
 * for normal vision and 8 under protanopia, deuteranopia and tritanopia alike;
 * 6–8 is tolerated only when the two marks also differ in shape, because then
 * the shape says what the colour cannot. The owner chose the statuses with
 * these numbers on the page (decisions, question 2); across the three
 * directions the worst calendar pair there was 15.0 and 7.6.
 */

const NORMAL_FLOOR = 15;
const DEFICIENCY_FLOOR = 8;
const DIFFERENT_SHAPE_FLOOR = 6;

interface Mark {
  readonly tone: Tone;
  readonly shape: string;
}

interface Verdict {
  readonly pair: string;
  readonly normal: number;
  readonly deficiency: number;
  readonly isSameShape: boolean;
}

function verdicts(theme: ThemeName, marks: readonly Mark[]): Verdict[] {
  const colours = TONE_COLORS[theme];
  return marks.flatMap((a, i) =>
    marks.slice(i + 1).map((b) => ({
      pair: `${a.tone} (${a.shape}) / ${b.tone} (${b.shape})`,
      normal: deltaE(colours[a.tone].mark, colours[b.tone].mark),
      deficiency: minDeficiencyDeltaE(colours[a.tone].mark, colours[b.tone].mark),
      isSameShape: a.shape === b.shape,
    })),
  );
}

function expectDistinguishable({ normal, deficiency, isSameShape }: Verdict): void {
  expect(normal).toBeGreaterThanOrEqual(NORMAL_FLOOR);
  expect(deficiency).toBeGreaterThanOrEqual(isSameShape ? DEFICIENCY_FLOOR : DIFFERENT_SHAPE_FLOOR);
}

const calendarMarks: readonly Mark[] = Object.entries(CALENDAR_MARK_SHAPE).map(([tone, shape]) => ({
  tone: tone as Tone,
  shape,
}));

const stepCircles: readonly Mark[] = Object.entries(STEP_CIRCLE).map(([tone, circle]) => ({
  tone: tone as Tone,
  shape: circle.draw,
}));

describe.each(THEME_NAMES)('%s theme', (theme) => {
  test.each(verdicts(theme, calendarMarks))('calendar: $pair', expectDistinguishable);

  test.each(verdicts(theme, stepCircles))('step circles: $pair', expectDistinguishable);
});

test('the calendar has all nine marks of the page, the steps all three circles', () => {
  expect(calendarMarks).toHaveLength(9);
  expect(stepCircles).toHaveLength(3);
});
