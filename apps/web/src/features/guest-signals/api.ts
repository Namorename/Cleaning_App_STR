import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@str-ops/shared';

import {
  findingListSchema,
  type FindingKind,
  type FindingStatus,
  placeProblemListSchema,
  type PlaceProblem,
  type RejectReason,
  reviewListSchema,
  type Review,
  runStatusSchema,
  type RunStatus,
  SETTINGS_OFF,
  settingsSchema,
  SIGNAL_KIND,
  type Finding,
  type SignalSettings,
} from './schema';
import {
  anyCategoryLow,
  departureBounds,
  findingStatusesOf,
  LOW_RATING_MAX,
  type ReviewFilters,
} from './review-filters';

export type Client = SupabaseClient<Database>;
type Priority = Database['public']['Enums']['problem_priority'];

/** The office reads signals and findings through row level security: manager and admin only. */
const REVIEW_COLUMNS =
  'id, channel, rating, category_ratings, arrival_date, departure_date, submitted_at, stay_exact, ' +
  'external_reservation_id, property_id, room_id, is_hidden, has_public_text, has_private_text, ' +
  'public_text, private_text, category_comments, text_truncated';

/** A place and its house: a room is a place with a parent (the core never reads a PMS's column). */
const PLACE_COLUMNS = 'name, parent_id, parent:parent_id(name)';

// guest_signals points at properties twice (the listing and the room): the
// embed names its key, or PostgREST cannot choose.
const REVIEW_PLACE = `place:properties!guest_signals_property_id_fkey(${PLACE_COLUMNS})`;

// The signal is joined `!inner`: the section shows one kind of signal, and
// the filter on the embed drops the findings of the other kind with it.
const FINDING_COLUMNS =
  'id, signal_id, property_id, kind, subject, urgency, summary, summary_i18n, evidence, ' +
  'evidence_source, confidence, detector, status, reject_reason, problem_id, decided_mode, ' +
  'decided_at, created_at, ' +
  `place:properties(${PLACE_COLUMNS}), ` +
  `signal:guest_signals!inner(kind, ${REVIEW_COLUMNS})`;

/** How many findings one tab lists; the queue is small (≈ 1–3 a day, docs §5.1). */
export const FINDINGS_LIMIT = 200;

/** The findings of a tab, urgent first, newest first. */
export async function fetchFindings(
  client: Client,
  statuses: readonly FindingStatus[],
): Promise<Finding[]> {
  const { data, error } = await client
    .from('signal_findings')
    .select(FINDING_COLUMNS)
    .eq('signal.kind', SIGNAL_KIND)
    .in('status', [...statuses])
    .order('urgency', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(FINDINGS_LIMIT);
  if (error) {
    throw error;
  }
  return findingListSchema.parse(data ?? []);
}

/** The number of candidates waiting: the menu's count (the owner's decision 7). */
export async function fetchCandidateCount(client: Client): Promise<number> {
  const { count, error } = await client
    .from('signal_findings')
    .select('id, signal:guest_signals!inner(kind)', { count: 'exact', head: true })
    .eq('signal.kind', SIGNAL_KIND)
    .eq('status', 'candidate');
  if (error) {
    throw error;
  }
  return count ?? 0;
}

/** «Все отзывы» by the page: a year of reviews is thousands (5 123 on 04.11), never all at once. */
export const REVIEWS_PAGE_SIZE = 50;

/**
 * The findings a review has, joined `!inner` only while the filter asks for
 * some: then a review without one of those findings is not listed.
 */
const REVIEW_FINDINGS = 'findings:signal_findings!inner(status)';

/** PostgREST answers a page past the end with 416 (the rows went away under the pager). */
const RANGE_NOT_SATISFIABLE = 'PGRST103';

export interface ReviewPage {
  reviews: Review[];
  /** All the reviews the filters let through, not only this page's. */
  total: number;
  /** The page these rows are: the screen may still show it while the next one loads. */
  page: number;
}

/**
 * One page of «Все отзывы», newest first, filtered on the server (the filters
 * in review-filters.ts). The order has the id after the time: a cut stay's
 * time is its month, shared by hundreds of reviews, and a page must not
 * shuffle them.
 */
export async function fetchReviewPage(
  client: Client,
  filters: ReviewFilters,
  page: number,
): Promise<ReviewPage> {
  const statuses = findingStatusesOf(filters);
  const columns =
    statuses.length === 0
      ? `${REVIEW_COLUMNS}, ${REVIEW_PLACE}`
      : `${REVIEW_COLUMNS}, ${REVIEW_PLACE}, ${REVIEW_FINDINGS}`;
  let query = client
    .from('guest_signals')
    .select(columns, { count: 'exact' })
    .eq('kind', SIGNAL_KIND);

  if (filters.channels.length > 0) {
    query = query.in('channel', filters.channels);
  }
  if (filters.placeIds.length > 0) {
    query = query.in('property_id', filters.placeIds);
  }
  if (filters.ratingMin !== null) {
    query = query.gte('rating', filters.ratingMin);
  }
  if (filters.ratingMax !== null) {
    query = query.lte('rating', filters.ratingMax);
  }
  const departure = departureBounds(filters);
  if (departure.from !== null) {
    query = query.gte('departure_date', departure.from);
  }
  if (departure.before !== null) {
    query = query.lt('departure_date', departure.before);
  }
  if (filters.withText) {
    query = query.eq('has_public_text', true);
  }
  if (filters.withPrivate) {
    query = query.eq('has_private_text', true);
  }
  if (filters.hiddenOnly) {
    query = query.eq('is_hidden', true);
  }
  if (filters.lowCategory === 'any') {
    query = query.or(anyCategoryLow());
  } else if (filters.lowCategory !== null) {
    query = query.lte(`category_ratings->${filters.lowCategory}`, LOW_RATING_MAX);
  }
  if (statuses.length > 0) {
    query = query.in('findings.status', statuses);
  }

  const from = page * REVIEWS_PAGE_SIZE;
  const { data, error, count } = await query
    .order('submitted_at', { ascending: false })
    .order('id', { ascending: false })
    .range(from, from + REVIEWS_PAGE_SIZE - 1);
  if (error) {
    if (error.code === RANGE_NOT_SATISFIABLE) {
      return { reviews: [], total: count ?? 0, page };
    }
    throw error;
  }
  return { reviews: reviewListSchema.parse(data ?? []), total: count ?? 0, page };
}

/** The tasks on a finding's place, open and since the guest left (signal_place_problems). */
export async function fetchPlaceProblems(
  client: Client,
  findingId: string,
): Promise<PlaceProblem[]> {
  const { data, error } = await client.rpc('signal_place_problems', { p_finding_id: findingId });
  if (error) {
    throw error;
  }
  return placeProblemListSchema.parse(data ?? []);
}

/** The switches of the section's kind of signal; all off while the company has no row yet. */
export async function fetchSettings(client: Client): Promise<SignalSettings> {
  const { data, error } = await client
    .from('signal_settings')
    .select(
      'sync_enabled, texts_enabled, tasks_enabled, model_enabled, auto_kinds, daily_model_cap, ' +
        'daily_auto_cap, min_confidence, notice_published_at, texts_enabled_at',
    )
    .eq('kind', SIGNAL_KIND)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data === null ? SETTINGS_OFF : settingsSchema.parse(data);
}

/** The last runs of the section's kind of signal: one row per stage (sync, classify). */
export async function fetchRunStatus(client: Client): Promise<RunStatus> {
  const { data, error } = await client.rpc('signal_run_status').eq('kind', SIGNAL_KIND);
  if (error) {
    throw error;
  }
  return runStatusSchema.parse(data ?? []);
}

export interface ApproveVariables {
  findingId: string;
  title?: string;
  priority?: Priority;
  description?: string;
  /** A technician to send at once; without one the task waits in «Открытые». */
  assigneeId?: string;
  scheduledDate?: string;
  /** «Это то же самое» / «Уже починено»: the task the finding joins. */
  linkProblemId?: string;
}

export async function approveFinding(client: Client, v: ApproveVariables): Promise<void> {
  const { error } = await client.rpc('approve_signal_finding', {
    p_finding_id: v.findingId,
    p_title: v.title,
    p_priority: v.priority,
    p_description: v.description,
    p_assignee_id: v.assigneeId,
    p_scheduled_date: v.assigneeId === undefined ? undefined : v.scheduledDate,
    p_link_problem_id: v.linkProblemId,
  });
  if (error) {
    throw error;
  }
}

export async function rejectFinding(
  client: Client,
  findingId: string,
  reason: RejectReason,
): Promise<void> {
  const { error } = await client.rpc('reject_signal_finding', {
    p_finding_id: findingId,
    p_reason: reason,
  });
  if (error) {
    throw error;
  }
}

export interface AddFindingVariables {
  signalId: string;
  kind: FindingKind;
  subject: string;
  title: string;
  priority?: Priority;
  description?: string;
  assigneeId?: string;
  scheduledDate?: string;
}

/** «Создать задание из отзыва» by hand: works without the rules and the model. */
export async function addFinding(client: Client, v: AddFindingVariables): Promise<void> {
  const { error } = await client.rpc('add_signal_finding', {
    p_signal_id: v.signalId,
    p_kind: v.kind,
    p_subject: v.subject,
    p_title: v.title,
    p_priority: v.priority,
    p_description: v.description,
    p_assignee_id: v.assigneeId,
    p_scheduled_date: v.assigneeId === undefined ? undefined : v.scheduledDate,
  });
  if (error) {
    throw error;
  }
}

/** Only what the call names changes (update_signal_settings: null is "not part of this call"). */
export type SettingsChange = Partial<{
  syncEnabled: boolean;
  textsEnabled: boolean;
  tasksEnabled: boolean;
  modelEnabled: boolean;
  autoKinds: string[];
  dailyModelCap: number;
  dailyAutoCap: number;
  minConfidence: number;
  noticePublishedAt: string;
}>;

/** The switches of the section's kind of signal, named every call: a kind left out means reviews. */
export async function updateSettings(client: Client, change: SettingsChange): Promise<void> {
  const { error } = await client.rpc('update_signal_settings', {
    p_sync_enabled: change.syncEnabled,
    p_texts_enabled: change.textsEnabled,
    p_tasks_enabled: change.tasksEnabled,
    p_model_enabled: change.modelEnabled,
    p_auto_kinds: change.autoKinds,
    p_daily_model_cap: change.dailyModelCap,
    p_daily_auto_cap: change.dailyAutoCap,
    p_min_confidence: change.minConfidence,
    p_notice_published_at: change.noticePublishedAt,
    p_kind: SIGNAL_KIND,
  });
  if (error) {
    throw error;
  }
}
