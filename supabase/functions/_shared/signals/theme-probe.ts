/**
 * The arithmetic of the accuracy probe (docs/property-intelligence-plan.md §7.3,
 * Э2): which reviews are read, which are checked by a person, and what the
 * answers add up to. No function imports this file: scripts/theme-probe.ts and
 * scripts/theme-probe-check.ts do. It holds ids, ratings and labels, never a text.
 *
 * A complaint is rare in a good review and common in a bad one, so a plain random
 * draw would be mostly silence: reviews are drawn evenly from three bands of
 * rating, and what is said about all reviews is weighted back by how many each
 * band really has.
 */

import type { IssueTheme } from "./themes.ts";

export const PROBE_PER_BAND = 100;
/** Reviews read a second time, to see how far a reading repeats itself. */
export const PROBE_REREADS = 30;
/** Reviews a person checks. */
export const PROBE_CHECKS = 100;
/** The owner's ceiling for the probe: one dollar, in millionths. */
export const PROBE_CEILING_MICRO_USD = 1_000_000;
export const PROBE_SEED = 20261106;

/** The thresholds of Э2. */
export const PRECISION_MIN = 0.85;
export const OTHER_MAX = 0.1;
/** A theme this frequent among the labels checked counts as a frequent theme. */
const FREQUENT_THEME_MIN = 5;

export const BANDS = ["low", "mid", "high"] as const;
export type Band = (typeof BANDS)[number];

/** Rated 7 or less, 8 to 9, or 10; a review with no rating goes with the middle. */
export function bandOf(rating: number | null): Band {
  if (rating === null) {
    return "mid";
  }
  if (rating <= 7) {
    return "low";
  }
  return rating < 10 ? "mid" : "high";
}

/** A row of the sample on disk: no text, no name. */
export interface ProbeRow {
  readonly n: number;
  /** The PMS's id of the review: what the local check reads the text by, and only that. */
  readonly reviewId: string;
  readonly band: Band;
  readonly month: string;
  readonly channel: string;
  readonly rating: number | null;
  readonly themes: readonly IssueTheme[];
  /** The themes of the second reading, for the rows read twice. */
  readonly themesAgain?: readonly IssueTheme[];
}

/** A person's word on one review: the themes that stand, and the ones the model missed. */
export interface ProbeVerdict {
  readonly n: number;
  readonly right: readonly IssueTheme[];
  readonly wrong: readonly IssueTheme[];
  readonly missed: readonly IssueTheme[];
}

/** A small generator of numbers, so a draw can be repeated. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], seed: number): T[] {
  const random = generator(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/** The draw: up to `perBand` of each band, the same every time for the same input. */
export function drawSample<T>(
  items: readonly T[],
  ratingOf: (item: T) => number | null,
  perBand: number,
  seed: number,
): T[] {
  return BANDS.flatMap((band, index) =>
    shuffled(items.filter((item) => bandOf(ratingOf(item)) === band), seed + index).slice(0, perBand)
  );
}

/**
 * What a person checks: mostly reviews with labels, since a label is what can be
 * wrong, and a fifth without, since a silent review is where a miss hides.
 */
export function pickForCheck(rows: readonly ProbeRow[], count: number, seed: number): ProbeRow[] {
  const labelled = shuffled(rows.filter((row) => row.themes.length > 0), seed);
  const silent = shuffled(rows.filter((row) => row.themes.length === 0), seed + 1);
  const silentCount = Math.min(silent.length, Math.round(count / 5));
  const picked = [...labelled.slice(0, count - silentCount), ...silent.slice(0, silentCount)];
  return shuffled(picked, seed + 2);
}

export interface ProbeSummary {
  readonly read: number;
  readonly byBand: Readonly<Record<Band, { read: number; withTheme: number; labels: number }>>;
  /** Share of all reviews with a complaint, weighted by the bands' real sizes. */
  readonly coverageWeighted: number;
  readonly labels: number;
  readonly byTheme: Readonly<Record<string, number>>;
  readonly otherShare: number;
  /** Rows read twice whose themes came back the same. */
  readonly repeatedSame: number;
  readonly repeated: number;
}

export function summarize(
  rows: readonly ProbeRow[],
  population: Readonly<Record<Band, number>>,
): ProbeSummary {
  const byBand = {
    low: { read: 0, withTheme: 0, labels: 0 },
    mid: { read: 0, withTheme: 0, labels: 0 },
    high: { read: 0, withTheme: 0, labels: 0 },
  };
  const byTheme: Record<string, number> = {};
  let repeated = 0;
  let repeatedSame = 0;

  for (const row of rows) {
    const band = byBand[row.band];
    band.read += 1;
    band.labels += row.themes.length;
    band.withTheme += row.themes.length > 0 ? 1 : 0;
    for (const theme of row.themes) {
      byTheme[theme] = (byTheme[theme] ?? 0) + 1;
    }
    if (row.themesAgain !== undefined) {
      repeated += 1;
      const first = [...row.themes].sort().join();
      repeatedSame += first === [...row.themesAgain].sort().join() ? 1 : 0;
    }
  }

  const total = BANDS.reduce((sum, band) => sum + population[band], 0);
  const coverageWeighted = total === 0 ? 0 : BANDS.reduce((sum, band) => {
    const { read, withTheme } = byBand[band];
    return sum + (read === 0 ? 0 : (withTheme / read) * (population[band] / total));
  }, 0);
  const labels = BANDS.reduce((sum, band) => sum + byBand[band].labels, 0);

  return {
    read: rows.length,
    byBand,
    coverageWeighted,
    labels,
    byTheme,
    otherShare: labels === 0 ? 0 : (byTheme.other ?? 0) / labels,
    repeatedSame,
    repeated,
  };
}

export interface ProbeAccuracy {
  readonly checked: number;
  readonly labelsChecked: number;
  /** Labels that stood, of all labels a person ruled on. */
  readonly precision: number;
  /** Complaints found by the model, of all a person saw in those reviews. */
  readonly recall: number;
  readonly byTheme: Readonly<Record<string, { right: number; wrong: number; missed: number }>>;
  /** Themes with enough labels to say something, and how they did. */
  readonly frequent: readonly { readonly theme: string; readonly precision: number; readonly labels: number }[];
  readonly passes: boolean;
}

export function accuracyOf(verdicts: readonly ProbeVerdict[], otherShare: number): ProbeAccuracy {
  const byTheme: Record<string, { right: number; wrong: number; missed: number }> = {};
  const tally = (themes: readonly string[], key: "right" | "wrong" | "missed"): void => {
    for (const theme of themes) {
      byTheme[theme] = byTheme[theme] ?? { right: 0, wrong: 0, missed: 0 };
      byTheme[theme][key] += 1;
    }
  };
  for (const verdict of verdicts) {
    tally(verdict.right, "right");
    tally(verdict.wrong, "wrong");
    tally(verdict.missed, "missed");
  }

  const sums = Object.values(byTheme).reduce(
    (all, one) => ({
      right: all.right + one.right,
      wrong: all.wrong + one.wrong,
      missed: all.missed + one.missed,
    }),
    { right: 0, wrong: 0, missed: 0 },
  );
  const labelsChecked = sums.right + sums.wrong;
  const precision = labelsChecked === 0 ? 0 : sums.right / labelsChecked;
  const seen = sums.right + sums.missed;

  const frequent = Object.entries(byTheme)
    .filter(([, one]) => one.right + one.wrong >= FREQUENT_THEME_MIN)
    .map(([theme, one]) => ({
      theme,
      labels: one.right + one.wrong,
      precision: one.right / (one.right + one.wrong),
    }))
    .sort((a, b) => b.labels - a.labels);

  return {
    checked: verdicts.length,
    labelsChecked,
    precision,
    recall: seen === 0 ? 0 : sums.right / seen,
    byTheme,
    frequent,
    passes: labelsChecked > 0 && otherShare <= OTHER_MAX &&
      frequent.every((one) => one.precision >= PRECISION_MIN),
  };
}

/** One review as two readers saw it: labels above the confidence floor, no text. */
export interface AgreementRow {
  readonly n: number;
  readonly band: Band;
  readonly language: string;
  readonly working: readonly IssueTheme[];
  readonly reference: readonly IssueTheme[];
}

export interface AgreementCounts {
  /** Themes both named, only the working model named, only the reference named. */
  readonly both: number;
  readonly onlyWorking: number;
  readonly onlyReference: number;
  /** Of what the working model named, how much the reference named too. */
  readonly precision: number | null;
  /** Of what the reference named, how much the working model named too. */
  readonly recall: number | null;
}

export interface AgreementPart extends AgreementCounts {
  readonly reviews: number;
  /** Reviews where the two sets of themes are exactly the same. */
  readonly sameSet: number;
  /** Reviews where both found a complaint, or neither did. */
  readonly sameVerdict: number;
}

/** A theme counts as frequent, and can fail the check, from this many labels of the reference. */
export const AGREEMENT_FREQUENT_MIN = 10;
/** Below this, on precision or recall, a frequent theme is low and fails the check. */
export const AGREEMENT_LOW = 0.7;
/** The owner's acceptance of 2026-11-06, for two models: 85 % a theme is noise at 10–40 labels. */
export const AGREEMENT_OVERALL_MIN = 0.85;
export const AGREEMENT_VERDICT_MIN = 0.95;
export const AGREEMENT_SET_MIN = 0.8;

function counted(both: number, onlyWorking: number, onlyReference: number): AgreementCounts {
  return {
    both,
    onlyWorking,
    onlyReference,
    precision: both + onlyWorking === 0 ? null : both / (both + onlyWorking),
    recall: both + onlyReference === 0 ? null : both / (both + onlyReference),
  };
}

function partOf(rows: readonly AgreementRow[]): AgreementPart {
  let both = 0;
  let onlyWorking = 0;
  let onlyReference = 0;
  let sameSet = 0;
  let sameVerdict = 0;
  for (const row of rows) {
    const reference = new Set(row.reference);
    const working = new Set(row.working);
    const shared = [...working].filter((theme) => reference.has(theme)).length;
    both += shared;
    onlyWorking += working.size - shared;
    onlyReference += reference.size - shared;
    sameSet += shared === working.size && shared === reference.size ? 1 : 0;
    sameVerdict += (working.size > 0) === (reference.size > 0) ? 1 : 0;
  }
  return { reviews: rows.length, sameSet, sameVerdict, ...counted(both, onlyWorking, onlyReference) };
}

function byKey(
  rows: readonly AgreementRow[],
  keyOf: (row: AgreementRow) => string,
): Record<string, AgreementPart> {
  const keys = [...new Set(rows.map(keyOf))];
  return Object.fromEntries(keys.map((key) => [key, partOf(rows.filter((row) => keyOf(row) === key))]));
}

/**
 * How far the working model agrees with a stronger reader. The reference is no truth:
 * it is the better of two readers, so a precision here is agreement, not accuracy.
 * `weighted` brings the sample's even bands back to the real sizes of the bands.
 */
export function agreementOf(rows: readonly AgreementRow[], population: Readonly<Record<Band, number>>) {
  const byTheme: Record<string, AgreementCounts> = {};
  const themes = [...new Set(rows.flatMap((row) => [...row.working, ...row.reference]))].sort();
  for (const theme of themes) {
    const working = rows.filter((row) => row.working.includes(theme));
    const reference = rows.filter((row) => row.reference.includes(theme));
    const both = working.filter((row) => row.reference.includes(theme)).length;
    byTheme[theme] = counted(both, working.length - both, reference.length - both);
  }
  const total = BANDS.reduce((sum, band) => sum + population[band], 0);
  const weighted = (pick: (part: AgreementPart) => number): number =>
    BANDS.reduce((sum, band) => {
      const part = partOf(rows.filter((row) => row.band === band));
      return sum + (part.reviews === 0 ? 0 : (pick(part) / part.reviews) * (population[band] / total));
    }, 0);
  const frequent = Object.entries(byTheme)
    .filter(([, one]) => one.both + one.onlyReference >= AGREEMENT_FREQUENT_MIN)
    .map(([theme, one]) => ({ theme, ...one }));
  const labels = rows.flatMap((row) => row.reference);
  const overall = partOf(rows);
  const sameSet = weighted((part) => part.sameSet);
  const sameVerdict = weighted((part) => part.sameVerdict);
  const low = frequent.filter((one) => (one.precision ?? 1) < AGREEMENT_LOW || (one.recall ?? 1) < AGREEMENT_LOW);
  return {
    overall,
    weighted: { sameSet, sameVerdict },
    byBand: byKey(rows, (row) => row.band),
    byLanguage: byKey(rows, (row) => row.language),
    byTheme,
    frequent,
    low,
    referenceOtherShare: labels.length === 0 ? 0 : labels.filter((theme) => theme === "other").length / labels.length,
    passes: frequent.length > 0 && low.length === 0 &&
      (overall.precision ?? 0) >= AGREEMENT_OVERALL_MIN && (overall.recall ?? 0) >= AGREEMENT_OVERALL_MIN &&
      sameVerdict >= AGREEMENT_VERDICT_MIN && sameSet >= AGREEMENT_SET_MIN,
  };
}
