import {
  CARD_COLORS,
  isBoardColumn,
  isCardColor,
  localDay,
  type CardColorValues,
} from '@str-ops/shared';
import type { TFunction } from 'i18next';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { formatCalendarDate, formatClockTime } from '@/features/tasks/format';

import type { CardEntry } from './schema';

/** A card's colour in the phone's theme, or null for a card without one. */
export function useCardColor(color: string | null): CardColorValues | null {
  const scheme = useColorScheme();
  if (!isCardColor(color)) {
    return null;
  }
  return CARD_COLORS[scheme === 'dark' ? 'dark' : 'light'][color];
}

/** A due date, «пт, 20 ноября». */
export function formatDue(day: string): string {
  return formatCalendarDate(day);
}

/** A moment of the journal on the phone's own clock: «ср, 18 ноября, 14:05». */
export function formatStamp(instant: string): string {
  return `${formatCalendarDate(localDay(new Date(instant)))}, ${formatClockTime(instant)}`;
}

function dayFact(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function countFact(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function personFact(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

/**
 * A system line of the journal in words: the server keeps codes, dates, counts
 * and people's ids, never a person's words or name (the panel says them the same
 * way); `nameOf` names the people from the company's directory.
 */
export function entrySentence(
  entry: CardEntry,
  t: TFunction,
  nameOf: (id: string) => string | null = () => null,
): string {
  const { facts } = entry;
  const person = (id: string | null) =>
    id === null ? '—' : (nameOf(id) ?? t('boards.unknownPerson'));
  switch (entry.kind) {
    case 'assignee_changed': {
      const from = personFact(facts.from);
      const to = personFact(facts.to);
      if (from === null && to !== null) {
        return t('boards.entries.assigneeSet', { to: person(to) });
      }
      if (to === null && from !== null) {
        return t('boards.entries.assigneeRemoved', { from: person(from) });
      }
      return t('boards.entries.assigneeChanged', { from: person(from), to: person(to) });
    }
    case 'moved': {
      const to = typeof facts.to === 'string' && isBoardColumn(facts.to) ? facts.to : null;
      return t('boards.entries.moved', {
        column: to === null ? '—' : t(`problems.statuses.${to}`),
      });
    }
    case 'due_changed': {
      const from = dayFact(facts.from);
      const to = dayFact(facts.to);
      if (from === null && to !== null) {
        return t('boards.entries.dueSet', { to: formatDue(to) });
      }
      if (to === null && from !== null) {
        return t('boards.entries.dueRemoved', { from: formatDue(from) });
      }
      return t('boards.entries.dueChanged', {
        from: from === null ? '—' : formatDue(from),
        to: to === null ? '—' : formatDue(to),
      });
    }
    case 'step_done':
      return t('boards.entries.stepDone', {
        done: countFact(facts.done),
        total: countFact(facts.total),
      });
    case 'comment':
      return entry.body ?? '';
    default:
      return '';
  }
}
