import { z } from 'zod';

import type { Language } from '@str-ops/shared';

/** public.review_finding_kind; the first four make a task (the owner's decision 2). */
export const FINDING_KINDS = [
  'repair',
  'safety',
  'pests',
  'access',
  'cleaning',
  'supplies',
  'noise',
  'neighbourhood',
  'wish',
  'other',
] as const;
export type FindingKind = (typeof FINDING_KINDS)[number];
export const TASK_KINDS = [
  'repair',
  'safety',
  'pests',
  'access',
] as const satisfies readonly FindingKind[];

/** public.review_subjects(). */
export const SUBJECTS = [
  'hot_water',
  'heating',
  'air_conditioning',
  'plumbing_leak',
  'drain_toilet',
  'electric',
  'appliance',
  'internet_tv',
  'lock_door',
  'window_blind',
  'furniture',
  'mould_damp',
  'other',
] as const;

export const FINDING_STATUSES = [
  'candidate',
  'task_created',
  'duplicate',
  'already_fixed',
  'rejected',
  'no_task',
  'dropped',
] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const REJECT_REASONS = [
  'false_positive',
  'not_property',
  'already_fixed',
  'duplicate',
  'not_worth',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

/** The screen's tabs of findings and the statuses each one lists (docs/reviews-to-tasks.md §4.4). */
export const FINDING_TABS = {
  found: ['candidate'],
  accepted: ['task_created'],
  rejected: ['rejected'],
  linked: ['duplicate', 'already_fixed'],
  dropped: ['dropped', 'no_task'],
} as const satisfies Record<string, readonly FindingStatus[]>;
export type FindingTab = keyof typeof FINDING_TABS;

const placeSchema = z
  .object({
    name: z.string(),
    hostaway_unit_id: z.number().nullable().default(null),
    parent: z.object({ name: z.string() }).nullable().default(null),
  })
  .nullable()
  .default(null);

const ratingsSchema = z.record(z.string(), z.number()).catch({});
const commentsSchema = z.record(z.string(), z.string()).nullable().catch(null);

/** A guest review as the office reads it. Dates are the month only once the stay is cut. */
export const reviewSchema = z.object({
  id: z.uuid(),
  channel: z.string(),
  rating: z.number().nullable(),
  category_ratings: ratingsSchema,
  arrival_date: z.string().nullable(),
  departure_date: z.string().nullable(),
  submitted_at: z.string(),
  stay_exact: z.boolean().default(false),
  external_reservation_id: z.string().nullable().default(null),
  property_id: z.number().nullable(),
  room_id: z.number().nullable().default(null),
  is_hidden: z.boolean().default(false),
  public_text: z.string().nullable().default(null),
  private_text: z.string().nullable().default(null),
  category_comments: commentsSchema.default(null),
  text_truncated: z.boolean().default(false),
  place: placeSchema,
});
export type Review = z.infer<typeof reviewSchema>;
export const reviewListSchema = z.array(reviewSchema);

/** A finding with its review alongside — the card has all it shows from one read. */
export const findingSchema = z.object({
  id: z.uuid(),
  review_id: z.uuid(),
  property_id: z.number().nullable(),
  kind: z.enum(FINDING_KINDS),
  subject: z.string(),
  urgency: z.enum(['low', 'normal', 'high']),
  summary: z.string(),
  summary_i18n: z.record(z.string(), z.string()).catch({}),
  evidence: z.string().nullable(),
  evidence_source: z.string().nullable(),
  confidence: z.number().nullable(),
  detector: z.string(),
  status: z.enum(FINDING_STATUSES),
  reject_reason: z.string().nullable(),
  problem_id: z.uuid().nullable(),
  decided_mode: z.string().nullable(),
  decided_at: z.string().nullable(),
  created_at: z.string(),
  place: placeSchema,
  review: reviewSchema.omit({ place: true }).nullable().default(null),
});
export type Finding = z.infer<typeof findingSchema>;
export const findingListSchema = z.array(findingSchema);

/** One row of review_place_problems(): a task on the finding's place. */
export const placeProblemSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  title_i18n: z.record(z.string(), z.string()).nullable().catch(null),
  source: z.string(),
  status: z.string(),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
  is_open: z.boolean(),
  can_link: z.boolean(),
});
export type PlaceProblem = z.infer<typeof placeProblemSchema>;
export const placeProblemListSchema = z.array(placeProblemSchema);

export const settingsSchema = z.object({
  sync_enabled: z.boolean(),
  texts_enabled: z.boolean(),
  tasks_enabled: z.boolean(),
  model_enabled: z.boolean(),
  auto_kinds: z.array(z.string()).default([]),
  daily_model_cap: z.number(),
  min_confidence: z.number(),
  notice_published_at: z.string().nullable(),
});
export type ReviewSettings = z.infer<typeof settingsSchema>;

/** All switches off: what a company has before anybody turned one on (no row yet). */
export const SETTINGS_OFF: ReviewSettings = {
  sync_enabled: false,
  texts_enabled: false,
  tasks_enabled: false,
  model_enabled: false,
  auto_kinds: [],
  daily_model_cap: 50,
  min_confidence: 0.6,
  notice_published_at: null,
};

export const runStatusSchema = z.array(
  z.object({
    stage: z.string(),
    last_run_at: z.string().nullable(),
    last_ok_at: z.string().nullable(),
  }),
);
export type RunStatus = z.infer<typeof runStatusSchema>;

/** How long without a clean run before the screen warns (docs §3.3). */
export const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

export function isTaskKind(kind: FindingKind): boolean {
  return (TASK_KINDS as readonly string[]).includes(kind);
}

/** The model's words in the panel's language, else in the company's; null when it has none (rules). */
export function findingWords(
  finding: Pick<Finding, 'summary' | 'summary_i18n'>,
  language: Language,
): string | null {
  if (Object.keys(finding.summary_i18n).length === 0) {
    return null;
  }
  return finding.summary_i18n[language] ?? finding.summary;
}

export function isModelReading(finding: Pick<Finding, 'detector'>): boolean {
  return finding.detector.startsWith('claude-');
}

/** "2026-10" of a stay's day: what is left of it once cut, and all a task keeps. */
export function monthOf(day: string | null): string | null {
  return day === null ? null : day.slice(0, 7);
}

/** The latest clean run of either job, and whether it is older than the warning allows. */
export function freshness(
  status: RunStatus,
  now: number = Date.now(),
): { lastOk: string | null; isStale: boolean } {
  const times = status
    .map((row) => row.last_ok_at)
    .filter((time): time is string => time !== null)
    .sort();
  const lastOk = times.length > 0 ? times[times.length - 1] : null;
  const anyRun = status.some((row) => row.last_run_at !== null);
  return {
    lastOk,
    isStale: anyRun && (lastOk === null || now - Date.parse(lastOk) > STALE_AFTER_MS),
  };
}
