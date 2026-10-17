/**
 * Guest reviews: the neutral shape every PMS adapter hands the database
 * (docs/reviews-to-tasks.md §2.3) and the readers' closed vocabulary. The
 * lists mirror the database's enums and review_subjects(); the database
 * checks every value again, so a drift here costs a finding, never a row.
 *
 * No guest name is ever part of a row. An adapter reads the names only to
 * strip them from the texts, in memory (redact.ts), and drops them.
 */

export const REVIEW_CHANNELS = ["airbnb", "booking", "vrbo", "direct", "google", "other"] as const;
export type ReviewChannel = (typeof REVIEW_CHANNELS)[number];

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

/** public.review_finding_kind. Only the first four make a problem. */
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

/** public.review_subjects(): duplicates are found by exact kind and subject. */
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

export const EVIDENCE_SOURCES = ["public", "private", "category_comment"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/** The texts of a review. Raw as an adapter read them; redacted before they go anywhere. */
export interface ReviewTexts {
  readonly publicText: string | null;
  readonly privateText: string | null;
  /** Category → the guest's comment on it. */
  readonly categoryComments: Readonly<Record<string, string>>;
}

/** One row for ingest_guest_reviews(). Dates are `YYYY-MM-DD`, times ISO 8601 UTC. */
export interface NeutralReviewRow {
  readonly external_id: string;
  readonly external_listing_id: string;
  readonly listing_id: number | null;
  readonly room_id: number | null;
  readonly external_reservation_id: string | null;
  readonly reservation_id: number | null;
  readonly channel: ReviewChannel;
  readonly rating: number | null;
  readonly category_ratings: Readonly<Record<string, number>>;
  readonly arrival_date: string | null;
  readonly departure_date: string | null;
  readonly submitted_at: string;
  readonly is_hidden: boolean;
  readonly has_public_text: boolean;
  readonly has_private_text: boolean;
  readonly has_host_reply: boolean;
  readonly external_updated_at: string | null;
  /** Only when texts are kept, and always redacted. */
  readonly public_text?: string | null;
  readonly private_text?: string | null;
  readonly category_comments?: Readonly<Record<string, string>> | null;
}

/** A review as an adapter read it. `row` carries no text; `texts` and the names live in memory only. */
export interface SourceReview {
  readonly row: NeutralReviewRow;
  readonly texts: ReviewTexts;
  /** The guest's names as the PMS gave them: used to strip them from the texts, then dropped. */
  readonly guestNames: readonly string[];
  /** The listing's names in the PMS, stripped from the texts too. */
  readonly listingNames: readonly string[];
}

export interface FetchedReviews {
  readonly reviews: readonly SourceReview[];
  /** Rows the PMS sent that could not be read; counted, never kept. */
  readonly skipped: number;
}

/** A PMS the reviews come from. The next one is a new value of review_source and an adapter. */
export interface ReviewSourceAdapter {
  readonly source: "hostaway";
  /** Published guest reviews sent in [since, until). */
  fetchPublished(since: Date, until: Date): Promise<FetchedReviews>;
  /** The room a stay took on a listing with rooms; null when the PMS does not say. */
  roomOf(review: SourceReview): Promise<number | null>;
}

/** A failure of the source with a code for the run's journal — never a review's text. */
export class ReviewSourceError extends Error {
  override readonly name = "ReviewSourceError";
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** The company's switches, as review_settings holds them. */
export interface ReviewSettings {
  readonly sync_enabled: boolean;
  readonly texts_enabled: boolean;
  readonly tasks_enabled: boolean;
  readonly model_enabled: boolean;
  readonly daily_model_cap: number;
  readonly notice_published_at: string | null;
}

/** A finding as apply_review_findings() takes it. Rules leave summary_i18n empty. */
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

/** A code and how many times it happened, for raw.review_runs.errors. */
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
