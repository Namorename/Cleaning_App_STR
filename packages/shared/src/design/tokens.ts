/**
 * The design tokens of «Абрикос» — direction A, chosen by the owner on
 * 2026-10-02: terracotta and honey on apricot cream, Nunito, pills.
 *
 * One source for both apps. The panel's generator writes its CSS variables
 * from here, and the phone's `constants/theme.ts` becomes an adapter over it
 * (5.2). Pure data with no `react-native` and no DOM, so a Node script, Jest
 * and both bundlers read the same file.
 *
 * The values are `docs/design/directions.json`, direction `a`, where the page
 * that measured them took them from. The deliberate departures are the phone's
 * main button (`cta*`, decisions §3) and the tonal secondary button, which the
 * page drew and measured from the primary ramp but did not name as roles.
 * Every pair a person reads is measured by the guards in
 * `apps/mobile/src/constants/__tests__/design-*.test.ts`: change a value here
 * and they say whether it still reads, in both themes.
 */

export type HexColor = `#${string}`;

export const THEME_NAMES = ['light', 'dark'] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/** The semantic colours of one theme. */
export interface ThemeColors {
  /** The screen and the page behind everything. */
  readonly bg: HexColor;
  /** Cards, sheets, dialogs, the panel's tables. */
  readonly surface: HexColor;
  /** A step off the surface: hover, the active menu item, an inactive control, the 7-day calendar. */
  readonly surfaceAlt: HexColor;
  readonly text: HexColor;
  readonly textSecondary: HexColor;
  /** The quietest text that still reads (≥ 4.5:1 on every surface); the disabled label. */
  readonly textMuted: HexColor;
  /** The outline of a control the user has to find (≥ 3:1). */
  readonly border: HexColor;
  /** A decorative hairline, deliberately quieter than `border`. */
  readonly divider: HexColor;
  /** Buttons, links, the active tab, the «now» stripe; the panel's main button. */
  readonly primary: HexColor;
  readonly onPrimary: HexColor;
  readonly primaryPressed: HexColor;
  /** Honey: only a fill under `onAccent` — the active tab's pill, the «today» pill. */
  readonly accent: HexColor;
  readonly onAccent: HexColor;
  readonly focusRing: HexColor;
  /** Error text and the destructive outline; never a fill like the main button. */
  readonly danger: HexColor;
  readonly onDanger: HexColor;
  readonly link: HexColor;
  /** The darkening under a caption on a photo, at `scrimAlpha`. */
  readonly scrim: HexColor;
  readonly onScrim: HexColor;
  readonly scrimAlpha: number;
  /** The tonal secondary button (directions.json, shape.button): a primary tint, no outline. */
  readonly secondary: HexColor;
  readonly onSecondary: HexColor;
  /**
   * The phone's main button only. Deeper than `primary` so that its label holds
   * 4.5:1 under the street veil (decisions §3); the panel stays on `primary`.
   */
  readonly cta: HexColor;
  readonly onCta: HexColor;
  readonly ctaPressed: HexColor;
}

export const RAMP_STEPS = [
  '50',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '700',
  '800',
  '900',
  '950',
] as const;
export type RampStep = (typeof RAMP_STEPS)[number];
export type Ramp = Readonly<Record<RampStep, HexColor>>;

/** Terracotta (OKLCH hue 38°) and honey (76°): the analogous pair of the direction. */
export const RAMPS = {
  primary: {
    '50': '#fff4f1',
    '100': '#ffe5dc',
    '200': '#f89c7f',
    '300': '#e78c70',
    '400': '#cd6c4e',
    '500': '#c15330',
    '600': '#a64221',
    '700': '#983512',
    '800': '#862700',
    '900': '#55200f',
    '950': '#381b12',
  },
  accent: {
    '50': '#fff9f1',
    '100': '#ffe7c7',
    '200': '#fbbe61',
    '300': '#edb154',
    '400': '#c68c27',
    '500': '#a36e00',
    '600': '#895c00',
    '700': '#734d00',
    '800': '#573900',
    '900': '#4c3202',
    '950': '#402900',
  },
} as const satisfies Readonly<Record<'primary' | 'accent', Ramp>>;

/** Warm greys on hue 42°, one scale per theme. */
export const NEUTRALS = {
  light: {
    '50': '#fff9f6',
    '100': '#f8efeb',
    '200': '#f1e6e1',
    '300': '#e1d4cf',
    '400': '#b6a9a4',
    '500': '#897c77',
    '600': '#6f625e',
    '700': '#5d524d',
    '800': '#443b37',
    '900': '#312927',
    '950': '#1e1816',
  },
  dark: {
    '50': '#f6f1f0',
    '100': '#ebe5e2',
    '200': '#d6cfcc',
    '300': '#c1b8b5',
    '400': '#a29894',
    '500': '#857b77',
    '600': '#605551',
    '700': '#4a403c',
    '800': '#372c28',
    '900': '#2a1f1b',
    '950': '#1e1511',
  },
} as const satisfies Readonly<Record<ThemeName, Ramp>>;

/**
 * The roles of both themes. Where a role comes from (directions.json,
 * `sources`): light `bg` and `surface` are the core colours, the greys are
 * `NEUTRALS.light` 200/950/700/600/500/300; dark ones are `NEUTRALS.dark` and
 * the primary ramp's light end. `danger` was solved for ≥ 5:1 (light) and ≥ 8:1
 * (dark) on every surface, `scrimAlpha` for a caption ≥ 5:1 over a white photo.
 *
 * `ctaPressed` is chosen in 5.2 (decisions §3 left it open): the primary ramp's
 * step on the far side of `cta` — 900 in light (a deep button lightens when
 * pressed), 100 in dark (a cream one darkens). Same hue as `cta` (38–40°), and
 * further from it (ΔE 8.5 light, 5.9 dark) than `primaryPressed` is from
 * `primary` (5.0), so the press shows at least as well as on the panel's
 * buttons; its label holds 12.86:1 and 14.94:1. A press lasts an instant and is
 * outside the street criterion (decisions §3): under the veil 3.90 and 4.19.
 */
export const THEME_COLORS = {
  light: {
    bg: '#f7ebdd',
    surface: '#fffcfb',
    surfaceAlt: '#f1e6e1',
    text: '#1e1816',
    textSecondary: '#5d524d',
    textMuted: '#6f625e',
    border: '#897c77',
    divider: '#e1d4cf',
    primary: '#983512',
    onPrimary: '#fffcfb',
    primaryPressed: '#862700',
    accent: '#fbbe61',
    onAccent: '#4c3202',
    focusRing: '#c15330',
    danger: '#be0769',
    onDanger: '#fffcfb',
    link: '#983512',
    scrim: '#1e1511',
    onScrim: '#fffcfb',
    scrimAlpha: 0.64,
    secondary: '#ffe5dc',
    onSecondary: '#862700',
    cta: '#3a0c00',
    onCta: '#fffcfb',
    ctaPressed: '#55200f',
  },
  dark: {
    bg: '#1e1511',
    surface: '#2a1f1b',
    surfaceAlt: '#372c28',
    text: '#f6f1f0',
    textSecondary: '#d6cfcc',
    textMuted: '#a29894',
    border: '#857b77',
    divider: '#4a403c',
    primary: '#e78c70',
    onPrimary: '#1e1511',
    primaryPressed: '#f89c7f',
    accent: '#edb154',
    onAccent: '#402900',
    focusRing: '#cd6c4e',
    danger: '#ffb0e1',
    onDanger: '#1e1511',
    link: '#e78c70',
    scrim: '#1e1511',
    onScrim: '#fffcfb',
    scrimAlpha: 0.64,
    secondary: '#381b12',
    onSecondary: '#f89c7f',
    cta: '#fffcfb',
    onCta: '#1e1511',
    ctaPressed: '#ffe5dc',
  },
} as const satisfies Readonly<Record<ThemeName, ThemeColors>>;

/**
 * The thirteen tones every status of both apps is drawn in (`STATUS_TONE`).
 * One shared set of meanings, tuned in lightness and chroma to the direction
 * (decisions, question 2): red is "not to plan", amber "going", green "done",
 * blue "assigned", violet "needs a person", wine "did not happen".
 */
export const TONE_NAMES = [
  'neutral',
  'unassigned',
  'assigned',
  'inProgress',
  'done',
  'overdue',
  'notHappened',
  'cancelled',
  'urgent',
  'today',
  'booking',
  'block',
  'unread',
] as const;
export type Tone = (typeof TONE_NAMES)[number];

/** The colours of one tone. */
export interface ToneColors {
  /** Text and glyph of a chip. */
  readonly fg: HexColor;
  /** A chip's tinted fill. */
  readonly bg: HexColor;
  /** A chip's frame — dashed «Без исполнителя», solid «Просрочено»; every chip inside «Сегодня». */
  readonly border: HexColor;
  /** The calendar mark (dot, diamond, ring, bar), a step circle, the badge's fill. */
  readonly mark: HexColor;
  /** What is drawn on a filled mark: ✓ on a done step, the date, the guest's name, the count. */
  readonly onMark?: HexColor;
  /** The stripes: 45° on «Не состоялась», 135° on «Блок» (`HATCH_ANGLE`). */
  readonly hatch?: HexColor;
}

export const TONE_COLORS = {
  light: {
    neutral: { fg: '#645651', bg: '#f9e9e3', border: '#8b7c76', mark: '#8b7c76' },
    unassigned: { fg: '#744593', bg: '#f5e8ff', border: '#9d69c2', mark: '#754197' },
    assigned: { fg: '#005d99', bg: '#e0f0ff', border: '#2384cd', mark: '#1f81c9' },
    inProgress: { fg: '#775300', bg: '#ffe6be', border: '#a77600', mark: '#af7c00' },
    done: { fg: '#005e3c', bg: '#c8fcdf', border: '#008b5b', mark: '#007a4f', onMark: '#fffcfb' },
    overdue: { fg: '#983850', bg: '#ffe7ea', border: '#c95c75', mark: '#d53265' },
    notHappened: {
      fg: '#8b3c77',
      bg: '#ffe5f6',
      border: '#b35b9c',
      mark: '#550e46',
      hatch: '#b2609c',
    },
    cancelled: { fg: '#6d635f', bg: '#f6eae6', border: '#877d79', mark: '#c0b5b0' },
    urgent: { fg: '#983850', bg: '#ffe7ea', border: '#c95c75', mark: '#d53265' },
    today: { fg: '#775213', bg: '#fce7c9', border: '#a97516', mark: '#fbbe61', onMark: '#4c3202' },
    booking: {
      fg: '#973d17',
      bg: '#ffe8e0',
      border: '#c8623b',
      mark: '#87320a',
      onMark: '#fffcfb',
    },
    block: { fg: '#645651', bg: '#f9e9e3', border: '#8b7c76', mark: '#f9e9e3', hatch: '#8e7f7a' },
    unread: { fg: '#fffcfb', bg: '#983512', border: '#983512', mark: '#983512', onMark: '#fffcfb' },
  },
  dark: {
    neutral: { fg: '#b5a7a2', bg: '#392d29', border: '#887b76', mark: '#877a75' },
    unassigned: { fg: '#b19edc', bg: '#332947', border: '#8870b8', mark: '#a17ae8' },
    assigned: { fg: '#7aaedf', bg: '#163149', border: '#4282bb', mark: '#3477b1' },
    inProgress: { fg: '#c9a266', bg: '#412a00', border: '#a37424', mark: '#c38600' },
    done: { fg: '#79b88d', bg: '#153722', border: '#3e8e5d', mark: '#44ab6d', onMark: '#1e1511' },
    overdue: { fg: '#dc939f', bg: '#44242a', border: '#b66272', mark: '#b65368' },
    notHappened: {
      fg: '#c996c7',
      bg: '#3c263c',
      border: '#a96da8',
      mark: '#fc98fa',
      hatch: '#a96da8',
    },
    cancelled: { fg: '#a29995', bg: '#362e2b', border: '#857c78', mark: '#b5aca8' },
    urgent: { fg: '#dc939f', bg: '#44242a', border: '#b66272', mark: '#b65368' },
    today: { fg: '#caa167', bg: '#3a2500', border: '#a67310', mark: '#edb154', onMark: '#402900' },
    booking: {
      fg: '#da997a',
      bg: '#41281c',
      border: '#b56944',
      mark: '#803300',
      onMark: '#f6f1f0',
    },
    block: { fg: '#b5a7a2', bg: '#392d29', border: '#887b76', mark: '#392d29', hatch: '#887b76' },
    unread: { fg: '#1e1511', bg: '#e78c70', border: '#e78c70', mark: '#e78c70', onMark: '#1e1511' },
  },
} as const satisfies Readonly<Record<ThemeName, Readonly<Record<Tone, ToneColors>>>>;

/** Corner radii; `pill` for buttons, chips and badges. Cards are `lg`. */
export const RADIUS = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

/** Spacing steps: the direction's "spacious" density. */
export const SPACING = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/**
 * Nunito, four weights — each a file of its own on the phone, where Android
 * ignores `fontWeight` over a loaded font (plan 2.2): the weight picks the
 * family. Its figures are tabular by default, so times and counts line up.
 */
export const FONT = {
  family: 'Nunito',
  weights: [400, 600, 700, 800],
} as const;

/** Type sizes, px / dp (the page's type scale; the button label from shape.button). */
export const FONT_SIZE = {
  caption: 13,
  body: 16,
  button: 17,
  title: 18,
  heading: 24,
  /** A dashboard tile's number. */
  display: 38,
} as const;

/** The weight of each kind of text. Nunito 400 reads thin: body and small text are 600. */
export const FONT_WEIGHT = {
  caption: 600,
  body: 600,
  chip: 700,
  button: 700,
  title: 700,
  heading: 800,
  display: 800,
} as const;

export const LINE_HEIGHT = 1.45;

/**
 * Touch targets, dp / px. The phone's buttons are 56 for a gloved finger
 * (owner, decision 5), every other phone target at least 48, list rows 64; the
 * panel's targets at least 44, its list rows 52; the calendar's chips and «+N»
 * keep a 24×24 hit area (WCAG 2.5.8, owner's «да» to question 15).
 */
export const TOUCH_TARGET = {
  phoneButton: 56,
  phoneMin: 48,
  phoneRow: 64,
  panelMin: 44,
  panelRow: 52,
  calendarChip: 24,
} as const;

/** Heights of the small pieces that are not targets. */
export const SIZE = {
  /** The unread badge: 20 high, 13/700, never mistaken for a button. */
  badge: 20,
  /** A calendar chip as drawn; its hit area is `TOUCH_TARGET.calendarChip`. */
  calendarChip: 20,
  /** The «now» stripe down a current card's left edge. */
  nowStripe: 3,
  /** The focus ring, and the surface-coloured gap between it and the control. */
  focusRing: 3,
  focusGap: 2,
} as const;
