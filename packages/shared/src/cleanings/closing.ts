/**
 * Who did a cleaning and who closed it (20261106125500), in the screen's language:
 * «Выполнила: Анна» with how that is known in small print, «Отменил: менеджер Пётр»,
 * «Отменена автоматически: бронь отменена», «Не состоялась: закрыта автоматически (ночной
 * проход)», and «не указано» where the past does not say. Shared by the panel and the phone.
 */
import type { ClosedHow, Translate } from '../problems/closing';

export const WORKER_SOURCES = ['recorded', 'derived', 'assigned', 'manager'] as const;
export type WorkerSource = (typeof WORKER_SOURCES)[number];

export interface CleaningPerson {
  readonly id: string;
  readonly name: string | null;
  readonly role: string | null;
}

/** The computed field `closing:task_closing`; null while the cleaning is live. */
export interface CleaningClosing {
  readonly completed_by: CleaningPerson | null;
  readonly worker_source: WorkerSource | null;
  readonly closed_by: CleaningPerson | null;
  readonly closed_how: ClosedHow | null;
  readonly closed_cause: string | null;
  readonly closer_source: 'recorded' | 'derived' | null;
  readonly closed_at: string | null;
}

/** One line, and how it is known in small print when that is worth saying. */
export interface ClosingLine {
  readonly text: string;
  readonly note: string | null;
}

const ROLES = ['cleaner', 'tech', 'head_tech', 'manager', 'admin'] as const;
const K = 'tasks.closing';

function nameOf(person: CleaningPerson | null | undefined, t: Translate): string {
  return person?.name ?? t(`${K}.someone`);
}

function roleOf(person: CleaningPerson | null | undefined, t: Translate): string {
  const role = person?.role;
  return role !== null && role !== undefined && (ROLES as readonly string[]).includes(role)
    ? t(`${K}.roles.${role}`)
    : t(`${K}.roles.manager`);
}

function sourceNote(source: string | null, t: Translate): string | null {
  return source !== null && (WORKER_SOURCES as readonly string[]).includes(source)
    ? t(`${K}.sources.${source}`)
    : null;
}

function workerLine(c: CleaningClosing | null, t: Translate): ClosingLine | null {
  if (c?.closed_how === 'manager_self' && c.completed_by === null) {
    return null;
  }
  return c?.completed_by
    ? {
        text: t(`${K}.worker`, { name: nameOf(c.completed_by, t) }),
        note: sourceNote(c.worker_source, t),
      }
    : { text: t(`${K}.notStatedWorker`), note: null };
}

function derivedNote(c: CleaningClosing | null, t: Translate): string | null {
  return c?.closer_source === 'derived' ? t(`${K}.derivedCloser`) : null;
}

function doneCloser(c: CleaningClosing | null, t: Translate): ClosingLine | null {
  const by = c?.closed_by;
  switch (c?.closed_how) {
    case 'worker':
      return null;
    case 'manager':
    case 'manager_for':
      return { text: t(`${K}.closer`, { role: roleOf(by, t), name: nameOf(by, t) }), note: null };
    case 'manager_self':
      return { text: t(`${K}.alone`, { name: nameOf(by, t) }), note: null };
    case 'auto':
      return { text: t(`${K}.auto`), note: derivedNote(c, t) };
    default:
      return { text: t(`${K}.notStatedCloser`), note: null };
  }
}

function cancelLine(c: CleaningClosing | null, t: Translate): ClosingLine {
  const by = c?.closed_by;
  switch (c?.closed_how) {
    case 'worker':
    case 'manager':
    case 'manager_for':
    case 'manager_self':
      return {
        text: t(`${K}.cancelledBy`, { role: roleOf(by, t), name: nameOf(by, t) }),
        note: null,
      };
    case 'auto': {
      const cause =
        c.closed_cause === null ? '' : t(`${K}.causes.${c.closed_cause}`, { defaultValue: '' });
      return {
        text: cause === '' ? t(`${K}.cancelledAuto`) : t(`${K}.cancelledAutoCause`, { cause }),
        note: derivedNote(c, t),
      };
    }
    default:
      return { text: t(`${K}.cancelledUnknown`), note: null };
  }
}

function lapseLine(c: CleaningClosing | null, t: Translate): ClosingLine {
  const by = c?.closed_by;
  switch (c?.closed_how) {
    case 'auto':
      return { text: t(`${K}.lapsedAuto`), note: derivedNote(c, t) };
    case 'worker':
    case 'manager':
    case 'manager_for':
    case 'manager_self':
      return { text: t(`${K}.lapsedBy`, { role: roleOf(by, t), name: nameOf(by, t) }), note: null };
    default:
      return { text: t(`${K}.lapsedUnknown`), note: null };
  }
}

/** The lines for a closed cleaning; none for a live one. */
export function cleaningClosingLines(
  status: string,
  closing: CleaningClosing | null,
  t: Translate,
): ClosingLine[] {
  switch (status) {
    case 'done':
      return [workerLine(closing, t), doneCloser(closing, t)].filter(
        (line): line is ClosingLine => line !== null,
      );
    case 'cancelled':
      return [cancelLine(closing, t)];
    case 'expired':
      return [lapseLine(closing, t)];
    default:
      return [];
  }
}

/** A finished cleaning that says «не указано» can have its worker named afterwards. */
export function isWorkerNameable(status: string, closing: CleaningClosing | null): boolean {
  return (
    status === 'done' && closing?.completed_by == null && closing?.closed_how !== 'manager_self'
  );
}
