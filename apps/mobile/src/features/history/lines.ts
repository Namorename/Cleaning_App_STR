import { z } from 'zod';

import {
  PART_SEPARATOR,
  formatDay,
  formatHours,
  formatLongDate,
  personName,
} from '@/features/board/format';
import { i18n } from '@/i18n';

import { JOURNAL_START, type ProblemEvent } from './schema';

/**
 * The words of a task's history (brief, item 3). The server writes ids, days,
 * hours and statuses (CLAUDE.md: no text on the server); every word here is
 * the phone's, in the reader's language. Each parameter is read on its own and
 * dropped if it is not the shape the migrations write, so one odd row is a
 * line with a neutral word, never a broken screen.
 */

const text = z.string().optional().catch(undefined);

/**
 * A day as the migrations write it, `YYYY-MM-DD`. Anything else would be an
 * invalid Date, and Intl throws a RangeError on one: dropped, like any odd
 * parameter, the line names no day.
 */
const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .catch(undefined);

/** A time as Postgres writes it, `HH:MM` or `HH:MM:SS`. */
const clockTime = z
  .string()
  .regex(/^\d{2}:\d{2}(:\d{2})?$/)
  .optional()
  .catch(undefined);

const paramsSchema = z.object({
  to: text,
  from: text,
  assignee: text,
  cause: text,
  date: calendarDay,
  from_date: calendarDay,
  time_from: clockTime,
  time_to: clockTime,
});

type Params = z.infer<typeof paramsSchema>;

function readParams(params: Readonly<Record<string, unknown>>): Params {
  return paramsSchema.parse(params);
}

type Names = ReadonlyMap<string, string>;

function nameOf(names: Names, id: string | undefined): string {
  return personName(names, id ?? null);
}

/** «пт, 9 октября», or «пт, 9 октября → сб, 10 октября» when the day moved. */
function dayOf({ from_date: fromDate, date }: Params): string | null {
  if (date === undefined) {
    return null;
  }
  return fromDate === undefined || fromDate === date
    ? formatDay(date)
    : `${formatDay(fromDate)} → ${formatDay(date)}`;
}

/** The line, then the day and the hours where the event has them. */
function withSchedule(line: string, params: Params): string {
  const hours = formatHours(params.time_from ?? null, params.time_to ?? null);
  return [line, dayOf(params), hours].filter((part) => part !== null).join(PART_SEPARATOR);
}

/** A job's status in the words the panel uses for it; one this build does not know, a dash. */
function jobStatus(status: string | undefined): string {
  const key = `panel.tasks.statuses.${status ?? ''}`;
  return status !== undefined && i18n.exists(key) ? i18n.t(key) : '—';
}

/**
 * A take-off by the switch of an account says so: params.cause =
 * 'account_disabled' (20261004100000). Anything else — the office's or the
 * head technician's «Снять», a cause this build does not know — reads as a
 * plain take-off. The panel decides the same (apps/web/src/features/problems/history.ts).
 */
function takenOffKey({ cause }: Params): string {
  return cause === 'account_disabled'
    ? 'problems.history.takenOffAccountDisabled'
    : 'problems.history.takenOff';
}

/** The kinds that are one fixed phrase each. */
const PLAIN: Readonly<Record<string, string>> = {
  reported: 'problems.history.reported',
  accepted: 'problems.history.accepted',
  started: 'problems.history.started',
  completed: 'problems.history.completed',
  resolved: 'problems.history.resolved',
  cancelled: 'problems.history.cancelled',
  reopened: 'problems.history.reopened',
  archived: 'problems.history.archived',
  unarchived: 'problems.history.unarchived',
};

/** What happened, in one line. */
export function historyWhat(event: ProblemEvent, names: Names): string {
  const params = readParams(event.params);
  const plain = PLAIN[event.kind];
  if (plain !== undefined) {
    return i18n.t(plain);
  }

  switch (event.kind) {
    case 'assigned':
      return withSchedule(
        i18n.t('problems.history.assigned', { to: nameOf(names, params.to) }),
        params,
      );
    case 'reassigned':
      return withSchedule(
        i18n.t('problems.history.reassigned', {
          from: nameOf(names, params.from),
          to: nameOf(names, params.to),
        }),
        params,
      );
    case 'unassigned':
      return i18n.t('problems.history.unassigned', { from: nameOf(names, params.from) });
    case 'rescheduled':
      return withSchedule(i18n.t('problems.history.rescheduled'), params);
    case 'attempt_cancelled':
      return params.assignee === undefined
        ? i18n.t('problems.history.attemptCancelled')
        : i18n.t('problems.history.attemptCancelledOf', { name: nameOf(names, params.assignee) });
    case 'taken_off':
      return i18n.t(takenOffKey(params), { name: nameOf(names, params.assignee) });
    case 'status_changed':
      return i18n.t('problems.history.statusChanged', {
        from: jobStatus(params.from),
        to: jobStatus(params.to),
      });
    default:
      return i18n.t('problems.history.unknown');
  }
}

/**
 * Who did it: by name; nobody at all — a trigger, the generator, the switch
 * of an account — is «Система»; a person the directory does not know is the
 * neutral «Сотрудник».
 */
export function historyWho(event: ProblemEvent, names: Names): string {
  return event.actor_id === null
    ? i18n.t('problems.history.system')
    : personName(names, event.actor_id);
}

/** Where every history begins: the journal started with the rollout (docs/tech-plan.md §3.1). */
export function historySince(): string {
  return i18n.t('problems.history.since', { date: formatLongDate(JOURNAL_START) });
}
