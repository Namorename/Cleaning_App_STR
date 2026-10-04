import {
  CALENDAR_MARK_SHAPE,
  Constants,
  ICONS,
  NEUTRALS,
  RAMPS,
  STATUS_ICON,
  STATUS_TONE,
  STEP_CIRCLE,
  THEME_COLORS,
  THEME_NAMES,
  TONE_COLORS,
  TONE_ICON,
  TONE_NAMES,
  TOUCH_TARGET,
  problemPriorityTone,
  problemStatusTone,
  propertyStatusTone,
  supplyPriorityTone,
  supplyStatusTone,
  taskStatusTone,
  taskTypeTone,
  type Tone,
} from '@str-ops/shared';

/**
 * The shape of the design system, checked so that neither app can meet a
 * colour, a tone or an icon that one theme or one status forgot.
 *
 * The first phone build shipped a palette that existed in light mode only and
 * printed black on black in the dark; a status the database grows and the
 * contract does not know would paint the same way — as nothing. The tones of
 * the database's statuses are read from the generated `Constants`, not listed
 * by hand, so a new enum value fails here the day `db:types` brings it in.
 */

const HEX = /^#[0-9a-f]{6}$/;
const sortedKeys = (record: object): string[] => Object.keys(record).sort();
const toneSet: ReadonlySet<string> = new Set<string>(TONE_NAMES);

describe('both themes define the same tokens', () => {
  test('the same roles', () => {
    expect(sortedKeys(THEME_COLORS.dark)).toEqual(sortedKeys(THEME_COLORS.light));
  });

  test('the same tones, each with the same fields', () => {
    expect(sortedKeys(TONE_COLORS.dark)).toEqual(sortedKeys(TONE_COLORS.light));
    for (const tone of TONE_NAMES) {
      expect([tone, sortedKeys(TONE_COLORS.dark[tone])]).toEqual([
        tone,
        sortedKeys(TONE_COLORS.light[tone]),
      ]);
    }
  });

  test('the same neutral steps', () => {
    expect(sortedKeys(NEUTRALS.dark)).toEqual(sortedKeys(NEUTRALS.light));
  });

  test('exactly the thirteen tones, no stray one', () => {
    expect(sortedKeys(TONE_COLORS.light)).toEqual([...TONE_NAMES].sort());
  });
});

describe('every colour is #rrggbb, lowercase', () => {
  const colours = [
    ...THEME_NAMES.flatMap((theme) =>
      Object.entries(THEME_COLORS[theme])
        .filter(([role]) => role !== 'scrimAlpha')
        .map(([role, hex]) => [`${theme}.${role}`, hex]),
    ),
    ...THEME_NAMES.flatMap((theme) =>
      Object.entries(TONE_COLORS[theme]).flatMap(([tone, fields]) =>
        Object.entries(fields).map(([field, hex]) => [`${theme}.${tone}.${field}`, hex]),
      ),
    ),
    ...Object.entries({ ...RAMPS, neutralLight: NEUTRALS.light, neutralDark: NEUTRALS.dark }).flatMap(
      ([ramp, steps]) => Object.entries(steps).map(([step, hex]) => [`${ramp}.${step}`, hex]),
    ),
  ];

  test.each(colours)('%s', (_name, hex) => {
    expect(hex).toMatch(HEX);
  });

  test.each(THEME_NAMES)('the %s scrim is a real opacity', (theme) => {
    const alpha = THEME_COLORS[theme].scrimAlpha;
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });
});

// «Срочно» is a flag drawn round another status's mark and shares the red of
// «Просрочено» on purpose (directions.json, tones: urgent). The calendar's
// distinguishability guard counts them as one colour — true only while it is.
test.each(THEME_NAMES)('%s: «Срочно» shares the colours of «Просрочено»', (theme) => {
  expect(TONE_COLORS[theme].urgent).toEqual(TONE_COLORS[theme].overdue);
});

describe('the tone contract', () => {
  test('every status value has one of the thirteen tones', () => {
    const strays = Object.entries(STATUS_TONE).filter(([, tone]) => !toneSet.has(tone));
    expect(strays).toEqual([]);
  });

  test('every tone means something', () => {
    const used = new Set<string>(Object.values(STATUS_TONE));
    expect(TONE_NAMES.filter((tone) => !used.has(tone))).toEqual([]);
  });

  const { Enums } = Constants.public;
  const enums: readonly [string, readonly string[], (value: never) => Tone][] = [
    ['task_status', Enums.task_status, taskStatusTone],
    ['task_type', Enums.task_type, taskTypeTone],
    ['problem_status', Enums.problem_status, problemStatusTone],
    ['problem_priority', Enums.problem_priority, problemPriorityTone],
    ['supply_request_status', Enums.supply_request_status, supplyStatusTone],
    ['supply_priority', Enums.supply_priority, supplyPriorityTone],
    ['property_status', Enums.property_status, propertyStatusTone],
  ];

  test.each(enums)('every %s value has a tone', (_name, values, toneOf) => {
    const missing = values.filter((value) => !toneSet.has(toneOf(value as never)));
    expect(missing).toEqual([]);
  });
});

describe('what the tones point at exists', () => {
  test('every glyph of a tone or a status is in the icon map', () => {
    const meanings = [...Object.values(TONE_ICON), ...Object.values(STATUS_ICON)];
    expect(meanings.filter((meaning) => !(meaning in ICONS))).toEqual([]);
  });

  test('every status with its own glyph is a status of the contract', () => {
    expect(Object.keys(STATUS_ICON).filter((key) => !(key in STATUS_TONE))).toEqual([]);
  });

  test('every step state has a circle to draw', () => {
    const stepTones = Object.entries(STATUS_TONE)
      .filter(([key]) => key.startsWith('steps.'))
      .map(([, tone]) => tone);
    expect(stepTones.filter((tone) => !(tone in STEP_CIRCLE))).toEqual([]);
  });

  test.each(THEME_NAMES)('%s: a glyph drawn on a filled circle has its colour', (theme) => {
    for (const [tone, circle] of Object.entries(STEP_CIRCLE)) {
      const colours: Readonly<Record<string, string>> = TONE_COLORS[theme][tone as Tone];
      expect([tone, colours[circle.glyphColor]]).toEqual([tone, expect.stringMatching(HEX)]);
    }
  });

  test('every calendar mark is a tone', () => {
    expect(Object.keys(CALENDAR_MARK_SHAPE).filter((tone) => !toneSet.has(tone))).toEqual([]);
  });
});

// Floors from the standards, not the chosen values: a later tweak may raise a
// target, never drop it below what a gloved finger (owner, decision 5), Android
// (48 dp), WCAG 2.5.5 (44 px) or WCAG 2.5.8 (24 px, the calendar's chips by the
// owner's word, decision 15) can hit.
describe('touch targets', () => {
  test('the phone: buttons 56 for gloves, everything else 48, list rows above both', () => {
    expect(TOUCH_TARGET.phoneButton).toBeGreaterThanOrEqual(56);
    expect(TOUCH_TARGET.phoneMin).toBeGreaterThanOrEqual(48);
    expect(TOUCH_TARGET.phoneRow).toBeGreaterThanOrEqual(TOUCH_TARGET.phoneButton);
  });

  test('the panel: 44, the calendar’s chips and «+N» 24', () => {
    expect(TOUCH_TARGET.panelMin).toBeGreaterThanOrEqual(44);
    expect(TOUCH_TARGET.panelRow).toBeGreaterThanOrEqual(TOUCH_TARGET.panelMin);
    expect(TOUCH_TARGET.calendarChip).toBeGreaterThanOrEqual(24);
  });
});
