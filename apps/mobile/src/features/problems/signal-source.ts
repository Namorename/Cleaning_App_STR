import type { Tone } from '@str-ops/shared';
import type { TFunction } from 'i18next';
import { z } from 'zod';

import { localizedText } from '@/features/steps/schema';

/**
 * Tasks made from what a guest sent — a review or a message — on the phone
 * (docs/guest-signals.md §7.1), behind one switch.
 *
 * Off until migration 20261030110000 is in the cloud: a select of a column the
 * server does not have answers 42703 and empties the screen, so while this is
 * false the phone asks for nothing new and shows nothing new. The OTA that
 * follows the migration turns it on; signal_settings.tasks_enabled goes on
 * only after that OTA has reached the phones.
 */
export const GUEST_SIGNAL_SOURCE_ENABLED = false;

/**
 * The columns a task from a guest signal adds to a select, whatever the switch
 * says: the select-string test resolves them against the schema either way.
 */
export const GUEST_SIGNAL_COLUMN_LIST = 'source, title_i18n, source_facts, ';

/** The columns the selects ask for: the list above, or nothing while the switch is off. */
export const GUEST_SIGNAL_SOURCE_COLUMNS = GUEST_SIGNAL_SOURCE_ENABLED
  ? GUEST_SIGNAL_COLUMN_LIST
  : '';

/** `problem_source`: somebody on the staff reported it, or it was found in what a guest sent. */
export const PROBLEM_SOURCES = ['staff', 'review', 'message'] as const;
export type ProblemSource = (typeof PROBLEM_SOURCES)[number];

/** Who made a task from a signal: a manager confirmed it, or it was made on its own. */
export const SIGNAL_MODES = ['manager', 'auto'] as const;
export type SignalMode = (typeof SIGNAL_MODES)[number];

/** What a technician may know of the signal: never a quote (the owner's decision 3). */
export interface SourceFacts {
  readonly kind: string;
  readonly subject: string;
  readonly channel: string | null;
  /** «2026-10»: the month the guest left for a review, the month it was sent for a message. */
  readonly period_month: string | null;
  readonly mode: SignalMode | null;
}

export interface SignalSourced {
  readonly title: string;
  /** Absent from a build that does not ask for it (the switch off) and from older saved copies. */
  readonly source?: ProblemSource;
  readonly title_i18n?: Readonly<Record<string, string>> | null;
  readonly source_facts?: SourceFacts | null;
}

/**
 * Each fact read on its own: a value a newer server spells differently costs
 * that fact, not the month or who confirmed the task.
 */
const sourceFactsSchema = z.object({
  kind: z.string().catch(''),
  subject: z.string().catch(''),
  channel: z.string().nullable().catch(null).default(null),
  period_month: z.string().nullable().catch(null).default(null),
  mode: z.enum(SIGNAL_MODES).nullable().catch(null).default(null),
});

/**
 * The three keys a task from a guest signal adds to a problem as the phone
 * reads it (problems/schema.ts, board/schema.ts). Every one is optional: absent
 * while the switch is off and from a copy an older build saved on the phone
 * (lib/read-cached.ts). A source a newer server invents reads as `staff` — an
 * ordinary task, no label, no crash.
 */
export const signalSourceFields = {
  source: z.enum(PROBLEM_SOURCES).catch('staff').optional(),
  title_i18n: z.record(z.string(), z.string()).nullable().catch(null).optional(),
  source_facts: sourceFactsSchema.nullable().catch(null).optional(),
};

/** The plaques are flags beside the status, like the archive: no colour of their own. */
export const SIGNAL_BADGE_TONE: Tone = 'neutral';

/** Where a task came from and the month it speaks of, per kind of signal. */
const SIGNAL_WORDS = {
  review: { from: 'problems.source.review', when: 'problems.source.reviewLeft' },
  message: { from: 'problems.source.message', when: 'problems.source.messageSent' },
} as const;

/** True for a task found in what a guest sent. */
function isFromSignal(
  problem: SignalSourced,
): problem is SignalSourced & { source: keyof typeof SIGNAL_WORDS } {
  return problem.source === 'review' || problem.source === 'message';
}

/** The title in the reader's language when the task has it, else as written. */
export function shownTitle(problem: SignalSourced, language: string): string {
  return localizedText(problem.title, problem.title_i18n ?? {}, language);
}

/**
 * «Из отзыва гостя · Гость выехал: 2026-10», «Из сообщения гостя · Отправлено:
 * 2026-10», or null for a task somebody reported.
 */
export function signalLabel(problem: SignalSourced, t: TFunction): string | null {
  if (!isFromSignal(problem)) {
    return null;
  }
  const words = SIGNAL_WORDS[problem.source];
  const month = problem.source_facts?.period_month;
  return month ? `${t(words.from)} · ${t(words.when, { month })}` : t(words.from);
}

/**
 * The plaques of a task from a guest signal (the owner's decision 7 of
 * 2026-10-31): «Создано автоматически» on every one, and «Подтвердил менеджер»
 * beside it when a manager confirmed it. None on a task somebody reported.
 */
export function signalBadges(problem: SignalSourced, t: TFunction): readonly string[] {
  if (!isFromSignal(problem)) {
    return [];
  }
  const auto = t('problems.source.auto');
  return problem.source_facts?.mode === 'manager' ? [auto, t('problems.source.confirmed')] : [auto];
}
