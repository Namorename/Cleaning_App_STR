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
  type ReviewSettings,
  runStatusSchema,
  type RunStatus,
  SETTINGS_OFF,
  settingsSchema,
  type Finding,
} from './schema';

export type Client = SupabaseClient<Database>;
type Priority = Database['public']['Enums']['problem_priority'];

/** The office reads reviews and findings through row level security: manager and admin only. */
const REVIEW_COLUMNS =
  'id, channel, rating, category_ratings, arrival_date, departure_date, submitted_at, stay_exact, ' +
  'external_reservation_id, property_id, room_id, is_hidden, public_text, private_text, ' +
  'category_comments, text_truncated';

// guest_reviews points at properties twice (the listing and the room): the
// embed names its key, or PostgREST cannot choose.
const REVIEW_PLACE =
  'place:properties!guest_reviews_property_id_fkey(name, hostaway_unit_id, parent:parent_id(name))';

const FINDING_COLUMNS =
  'id, review_id, property_id, kind, subject, urgency, summary, summary_i18n, evidence, ' +
  'evidence_source, confidence, detector, status, reject_reason, problem_id, decided_mode, ' +
  'decided_at, created_at, ' +
  'place:properties(name, hostaway_unit_id, parent:parent_id(name)), ' +
  `review:guest_reviews(${REVIEW_COLUMNS})`;

/** How many findings one tab lists; the queue is small (≈ 1–3 a day, docs §5.1). */
export const FINDINGS_LIMIT = 200;
export const REVIEWS_LIMIT = 200;

/** The findings of a tab, urgent first, newest first. */
export async function fetchFindings(
  client: Client,
  statuses: readonly FindingStatus[],
): Promise<Finding[]> {
  const { data, error } = await client
    .from('review_findings')
    .select(FINDING_COLUMNS)
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
    .from('review_findings')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'candidate');
  if (error) {
    throw error;
  }
  return count ?? 0;
}

/** «Все отзывы»: the newest reviews, rating and text. */
export async function fetchReviews(client: Client): Promise<Review[]> {
  const { data, error } = await client
    .from('guest_reviews')
    .select(`${REVIEW_COLUMNS}, ${REVIEW_PLACE}`)
    .order('submitted_at', { ascending: false })
    .limit(REVIEWS_LIMIT);
  if (error) {
    throw error;
  }
  return reviewListSchema.parse(data ?? []);
}

/** The tasks on a finding's place, open and since the guest left (review_place_problems). */
export async function fetchPlaceProblems(
  client: Client,
  findingId: string,
): Promise<PlaceProblem[]> {
  const { data, error } = await client.rpc('review_place_problems', { p_finding_id: findingId });
  if (error) {
    throw error;
  }
  return placeProblemListSchema.parse(data ?? []);
}

export async function fetchSettings(client: Client): Promise<ReviewSettings> {
  const { data, error } = await client
    .from('review_settings')
    .select(
      'sync_enabled, texts_enabled, tasks_enabled, model_enabled, auto_kinds, daily_model_cap, ' +
        'min_confidence, notice_published_at',
    )
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data === null ? SETTINGS_OFF : settingsSchema.parse(data);
}

export async function fetchRunStatus(client: Client): Promise<RunStatus> {
  const { data, error } = await client.rpc('review_run_status');
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
  const { error } = await client.rpc('approve_review_finding', {
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
  const { error } = await client.rpc('reject_review_finding', {
    p_finding_id: findingId,
    p_reason: reason,
  });
  if (error) {
    throw error;
  }
}

export interface AddFindingVariables {
  reviewId: string;
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
  const { error } = await client.rpc('add_review_finding', {
    p_review_id: v.reviewId,
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

/** Only what the call names changes (update_review_settings: null is "not part of this call"). */
export type SettingsChange = Partial<{
  syncEnabled: boolean;
  textsEnabled: boolean;
  tasksEnabled: boolean;
  modelEnabled: boolean;
  autoKinds: string[];
  dailyModelCap: number;
  minConfidence: number;
  noticePublishedAt: string;
}>;

export async function updateSettings(client: Client, change: SettingsChange): Promise<void> {
  const { error } = await client.rpc('update_review_settings', {
    p_sync_enabled: change.syncEnabled,
    p_texts_enabled: change.textsEnabled,
    p_tasks_enabled: change.tasksEnabled,
    p_model_enabled: change.modelEnabled,
    p_auto_kinds: change.autoKinds,
    p_daily_model_cap: change.dailyModelCap,
    p_min_confidence: change.minConfidence,
    p_notice_published_at: change.noticePublishedAt,
  });
  if (error) {
    throw error;
  }
}
