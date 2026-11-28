'use client';

import { INTL_LOCALES, plannedDay, type Language } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { dateFormat } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';
import { cn } from '@/lib/utils';

type Translate = (key: string) => string;

/** The words of a day's heading: what the eye reads, and what a screen reader says. */
export interface DayDividerText {
  /** «Сегодня · пт 27.11», «Завтра · сб 28.11», «вс 29.11». */
  shown: string;
  /** «Сегодня, пятница, 27 ноября». */
  spoken: string;
}

function calendarDate(day: string): Date {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date);
}

/**
 * A day's heading in the interface language (Intl): the short weekday and the day and month as a
 * card writes them, «Сегодня» or «Завтра» before them; the year only when it is not this one. A
 * day gone by is only its date: the cards say what is late in their own way.
 */
export function dayDividerText(
  day: string,
  today: string,
  language: Language,
  t: Translate,
): DayDividerText {
  const locale = INTL_LOCALES[language];
  const date = calendarDate(day);
  const year: Intl.DateTimeFormatOptions =
    day.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' };
  const weekday = dateFormat(locale, { weekday: 'short' }).format(date);
  const digits = dateFormat(locale, { day: '2-digit', month: '2-digit', ...year }).format(date);
  const long = dateFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...year,
  }).format(date);
  const kind = plannedDay(day, today)?.kind;
  const word =
    kind === 'today'
      ? t('panel.dayDivider.today')
      : kind === 'tomorrow'
        ? t('panel.dayDivider.tomorrow')
        : null;
  const short = `${weekday} ${digits}`;
  return word === null
    ? { shown: short, spoken: long }
    : { shown: `${word} · ${short}`, spoken: `${word}, ${long}` };
}

interface DayDividerLook {
  /** The heading's level: 2 under the page's title. */
  level?: 2 | 3;
  className?: string;
}

type DayDividerProps = DayDividerLook &
  (
    | {
        /** The day of the items under it, `YYYY-MM-DD`. */
        day: string;
        /** Today, `YYYY-MM-DD`, in the zone the items count their days by. */
        today: string;
      }
    | {
        /** No day: the items under it have no date (a manager board's cards with no due date). */
        day: null;
        /** What stands for the day, said and shown alike: «Без срока». */
        label: string;
      }
  );

/**
 * The heading of a day in a list ordered by days (owner, 2026-11-27): a small muted line of words
 * and a hairline in the border's tone to the end of the row — no frame, no fill, no icon. It stands
 * before the first item of its day; with a little room above it, so the days breathe, and none
 * when it opens its list. It takes no pointer: a drag over it is its column's, a click falls
 * through, and the keyboard passes it by. A screen reader finds it as a heading and hears the day
 * in full. Those words are placed absolutely (`sr-only`), so the divider is positioned itself: in
 * a scrolling column they stay inside it rather than hanging on the page and lengthening it.
 *
 * Items with no date (owner, 2026-11-28: a manager board's cards with no due date, last in their
 * column) are headed the same way, by the words the list gives for them.
 */
export function DayDivider(props: DayDividerProps) {
  const { level = 2, className } = props;
  const { t } = useTranslation();
  const language = useLanguage();
  const text: DayDividerText =
    props.day === null
      ? { shown: props.label, spoken: props.label }
      : dayDividerText(props.day, props.today, language, t);
  const Heading = level === 3 ? 'h3' : 'h2';

  return (
    <div
      data-slot="day-divider"
      className={cn(
        'pointer-events-none relative flex items-center gap-2 pt-2 select-none first:pt-0',
        className,
      )}
    >
      <Heading className="min-w-0 truncate text-xs leading-4 font-normal text-muted-foreground">
        <span aria-hidden="true">{text.shown}</span>
        <span className="sr-only">{text.spoken}</span>
      </Heading>
      <span aria-hidden="true" className="h-px min-w-4 flex-1 bg-border" />
    </div>
  );
}
