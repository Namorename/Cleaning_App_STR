/**
 * Who did a task's work and who closed it (20261106125000), in the words of the screen's
 * language. The panel and the phone say it alike: «Выполнил: Иван», «Закрыл: менеджер Пётр»,
 * «Закрыл менеджер сам: Пётр», «Закрыто автоматически», and «не указано» where the past
 * does not say.
 */

/** problems.closed_how. */
export const CLOSED_HOWS = ['worker', 'manager', 'manager_for', 'manager_self', 'auto'] as const;
export type ClosedHow = (typeof CLOSED_HOWS)[number];

export interface ClosingPerson {
  readonly name: string | null;
  readonly role: string | null;
}

/** The computed field `closing:closing_people`: the names behind the two ids. */
export interface ClosingPeople {
  readonly completed_by: ClosingPerson | null;
  readonly closed_by: ClosingPerson | null;
}

/** What a task row needs to say it. */
export interface ClosingRow {
  readonly status: string;
  readonly archived_at: string | null;
  readonly completed_by: string | null;
  readonly closed_how: ClosedHow | null;
  readonly closed_cause: string | null;
  readonly closing: ClosingPeople | null;
  /** How completed_by is known (20261106125500); absent from a row read before it. */
  readonly completed_by_source?: string | null;
}

export type Translate = (key: string, options?: Record<string, string>) => string;

const ROLES = ['cleaner', 'tech', 'head_tech', 'manager', 'admin'] as const;

/** Closed: resolved, cancelled, or put in the archive. */
export function isTaskClosed(row: Pick<ClosingRow, 'status' | 'archived_at'>): boolean {
  return row.status === 'resolved' || row.status === 'cancelled' || row.archived_at !== null;
}

function nameOf(person: ClosingPerson | null | undefined, t: Translate): string {
  return person?.name ?? t('problems.closing.someone');
}

function roleOf(person: ClosingPerson | null | undefined, t: Translate): string {
  const role = person?.role;
  return role !== null && role !== undefined && (ROLES as readonly string[]).includes(role)
    ? t(`problems.closing.roles.${role}`)
    : t('problems.closing.roles.manager');
}

function workerLine(row: ClosingRow, t: Translate): string | null {
  // Only a fix has a worker; a manager who closed alone says it in his own line.
  if (row.status !== 'resolved' || row.closed_how === 'manager_self') {
    return null;
  }
  return row.completed_by === null
    ? t('problems.closing.notStatedWorker')
    : t('problems.closing.worker', { name: nameOf(row.closing?.completed_by, t) });
}

function closerLine(row: ClosingRow, t: Translate): string | null {
  const closer = row.closing?.closed_by;
  switch (row.closed_how) {
    case 'worker':
      // Her finish closed it: «Выполнил» says both, unless nothing was fixed.
      return row.status === 'resolved'
        ? null
        : t('problems.closing.closer', { role: roleOf(closer, t), name: nameOf(closer, t) });
    case 'manager':
    case 'manager_for':
      return t('problems.closing.closer', { role: roleOf(closer, t), name: nameOf(closer, t) });
    case 'manager_self':
      return t('problems.closing.alone', { name: nameOf(closer, t) });
    case 'auto': {
      const cause =
        row.closed_cause === null
          ? ''
          : t(`problems.closing.causes.${row.closed_cause}`, { defaultValue: '' });
      return cause === '' ? t('problems.closing.auto') : t('problems.closing.autoCause', { cause });
    }
    default:
      return t('problems.closing.notStatedCloser');
  }
}

const SOURCES = ['recorded', 'derived', 'assigned', 'manager'] as const;

/** How the worker is known, in small print under her line; null when no worker is named. */
export function closingSourceNote(row: ClosingRow, t: Translate): string | null {
  const source = row.completed_by_source ?? null;
  return row.completed_by !== null &&
    source !== null &&
    (SOURCES as readonly string[]).includes(source)
    ? t(`problems.closing.sources.${source}`)
    : null;
}

/** A resolved task that says «не указано» can have its worker named afterwards. */
export function isProblemWorkerNameable(row: ClosingRow): boolean {
  return (
    row.status === 'resolved' && row.completed_by === null && row.closed_how !== 'manager_self'
  );
}

/** The lines for a closed task, worker first; none for an open one. */
export function closingLines(row: ClosingRow, t: Translate): string[] {
  if (!isTaskClosed(row)) {
    return [];
  }
  return [workerLine(row, t), closerLine(row, t)].filter((line): line is string => line !== null);
}
