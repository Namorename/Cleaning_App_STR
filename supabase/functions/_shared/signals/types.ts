/**
 * Guest signals: the readers' closed vocabulary and the shapes the core and
 * the database share (docs/guest-signals.md §2.2–§2.3). The lists mirror the
 * database's enums and signal_subjects(); the database checks every value
 * again, so a drift here costs a finding, never a row.
 *
 * What a PMS adapter hands the core lives in adapter.ts. No guest name is
 * ever part of a row: an adapter reads the names — from the review, and from
 * its booking (the owner's decision of 2026-10-18) — only to strip them from
 * the texts, in memory (redact.ts), and drops them.
 */

/** public.signal_channel. */
export const SIGNAL_CHANNELS = ["airbnb", "booking", "vrbo", "direct", "google", "other"] as const;
export type SignalChannel = (typeof SIGNAL_CHANNELS)[number];

/** The category ratings in one vocabulary for every channel. */
export const CATEGORY_KEYS = [
  "cleanliness",
  "accuracy",
  "checkin",
  "communication",
  "location",
  "value",
  "comfort",
  "facilities",
  "staff",
] as const;
export type CategoryKey = (typeof CATEGORY_KEYS)[number];

/** public.signal_finding_kind. Only the first four make a problem. */
export const FINDING_KINDS = [
  "repair",
  "safety",
  "pests",
  "access",
  "cleaning",
  "supplies",
  "noise",
  "neighbourhood",
  "wish",
  "other",
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];

/** public.signal_subjects(): duplicates are found by exact kind and subject. */
export const SUBJECTS = [
  "hot_water",
  "heating",
  "air_conditioning",
  "plumbing_leak",
  "drain_toilet",
  "electric",
  "appliance",
  "internet_tv",
  "lock_door",
  "window_blind",
  "furniture",
  "mould_damp",
  "other",
] as const;
export type Subject = (typeof SUBJECTS)[number];

export const URGENCIES = ["low", "normal", "high"] as const;
export type Urgency = (typeof URGENCIES)[number];

export const STILL_RELEVANT = ["likely", "fixed_during_stay", "unclear"] as const;
export type StillRelevant = (typeof STILL_RELEVANT)[number];

/**
 * Where a review's evidence was found. The database also knows "message";
 * the review readers never write it.
 */
export const EVIDENCE_SOURCES = ["public", "private", "category_comment"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/** The texts of a review. Raw as an adapter read them; redacted before they go anywhere. */
export interface ReviewTexts {
  readonly publicText: string | null;
  readonly privateText: string | null;
  /** Category → the guest's comment on it. */
  readonly categoryComments: Readonly<Record<string, string>>;
}

/** The company's switches for one kind of signal, as signal_settings holds them. */
export interface SignalSettings {
  readonly sync_enabled: boolean;
  readonly texts_enabled: boolean;
  readonly tasks_enabled: boolean;
  readonly model_enabled: boolean;
  /** The oldest signal the model reads (14 days before it went on); null while it never was. */
  readonly model_since: string | null;
  readonly daily_model_cap: number;
  readonly notice_published_at: string | null;
}

/** A finding as apply_signal_findings() takes it. Rules leave summary_i18n empty. */
export interface FindingInput {
  readonly kind: FindingKind;
  readonly subject: Subject;
  readonly urgency: Urgency;
  readonly still_relevant: StillRelevant;
  readonly summary_i18n: Readonly<Record<string, string>>;
  readonly evidence: string | null;
  readonly evidence_source: EvidenceSource | null;
  readonly confidence: number;
}

/** A code and how many times it happened, for raw.signal_runs.errors. */
export interface RunError {
  readonly code: string;
  readonly count: number;
}

/** Collects codes into the journal's shape: one entry a code, counted. */
export function countErrors(codes: readonly string[]): RunError[] {
  const counts = new Map<string, number>();
  for (const code of codes) {
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  return [...counts.entries()].map(([code, count]) => ({ code, count }));
}

export function isOneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}
