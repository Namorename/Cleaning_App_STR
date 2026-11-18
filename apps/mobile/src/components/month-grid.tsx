import type { Language } from '@str-ops/shared';
import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useLanguage } from '@/hooks/use-language';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { INTL_LOCALES } from '@/i18n';
import {
  WEEK_DAYS,
  dayDate,
  monthWeeks,
  shiftMonth,
  todayDay,
  type DayMark,
} from '@/lib/calendar-month';

import { IconButton } from './icon-button';
import { Text } from './text';

export type { DayMark } from '@/lib/calendar-month';

/**
 * A month as a grid of days, Monday first — a calendar to pick a day from, in
 * plain React Native (no date library, so it ships over the air).
 *
 * Props:
 * - `month` — the month shown, `YYYY-MM`.
 * - `selectedDay` — the day picked, `YYYY-MM-DD`, drawn filled; null for none.
 * - `marks` — what each day holds, keyed by `YYYY-MM-DD`: `count` is drawn
 *   under the day's number (nothing for 0), `isAttention` as a dot. Days of
 *   other months are ignored.
 * - `onSelectDay(day)` — a day was pressed, `YYYY-MM-DD`. The grid keeps no
 *   selection of its own: the caller passes it back as `selectedDay`.
 * - `onMonthChange(month)` — an arrow was pressed, `YYYY-MM` of the month
 *   before or after. The caller passes it back as `month`.
 * - `today` — the day framed as today, `YYYY-MM-DD`; the phone's own today by
 *   default (a test pins it).
 * - `markLabel(mark)` — what the reader hears of a day's mark after its date,
 *   such as «3 уборки, есть уборки без исполнителя»; without it the mark is
 *   drawn only. The count says nothing by itself: what is counted is the
 *   caller's word.
 * - `testID` — the grid's own; each day is `month-grid-day-YYYY-MM-DD`.
 *
 * Each day is a button the reader hears by its full date, «сегодня» on today,
 * and the mark's words, selected when picked. The weekday row is decoration
 * for the eye: every day already says its weekday.
 */
export interface MonthGridProps {
  month: string;
  selectedDay: string | null;
  marks?: Readonly<Record<string, DayMark>>;
  onSelectDay: (day: string) => void;
  onMonthChange: (month: string) => void;
  today?: string;
  markLabel?: (mark: DayMark) => string;
  testID?: string;
}

/** A Monday: the weekday row is read off the seven days from it. */
const A_MONDAY = new Date(2024, 0, 1);

function capitalized(text: string, language: Language): string {
  return text.charAt(0).toLocaleUpperCase(INTL_LOCALES[language]) + text.slice(1);
}

/** «Ноябрь 2026»: the month standing alone, as a heading. */
function monthTitle(month: string, language: Language): string {
  const first = dayDate(`${month}-01`);
  const name = new Intl.DateTimeFormat(INTL_LOCALES[language], { month: 'long' }).format(first);
  return `${capitalized(name, language)} ${first.getFullYear()}`;
}

/** «Пн» … «Вс» in her language. */
function weekdayNames(language: Language): string[] {
  const format = new Intl.DateTimeFormat(INTL_LOCALES[language], { weekday: 'short' });
  return Array.from({ length: WEEK_DAYS }, (_, offset) =>
    capitalized(
      format.format(new Date(A_MONDAY.getFullYear(), A_MONDAY.getMonth(), A_MONDAY.getDate() + offset)),
      language,
    ),
  );
}

export function MonthGrid({
  month,
  selectedDay,
  marks,
  onSelectDay,
  onMonthChange,
  today,
  markLabel,
  testID,
}: MonthGridProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const styles = useThemedStyles(createStyles);
  const weeks = useMemo(() => monthWeeks(month), [month]);
  const title = useMemo(() => monthTitle(month, language), [month, language]);
  const weekdays = useMemo(() => weekdayNames(language), [language]);
  // Built once per language, not once per day: the grid has up to 42 of them.
  const dayFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(INTL_LOCALES[language], {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }),
    [language],
  );
  const shownToday = today ?? todayDay();
  const todayWord = t('office.calendar.today');

  const labelOf = (day: string, mark: DayMark | undefined): string =>
    [
      dayFormat.format(dayDate(day)),
      day === shownToday ? todayWord : null,
      mark === undefined || markLabel === undefined ? null : markLabel(mark),
    ]
      .filter((part): part is string => part !== null && part !== '')
      .join(', ');

  return (
    <View testID={testID} style={styles.grid}>
      <View style={styles.header}>
        <IconButton
          icon="action.back"
          accessibilityLabel={t('office.calendar.previousMonth')}
          onPress={() => onMonthChange(shiftMonth(month, -1))}
        />
        <Text variant="title" align="center" accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        <IconButton
          icon="action.next"
          accessibilityLabel={t('office.calendar.nextMonth')}
          onPress={() => onMonthChange(shiftMonth(month, 1))}
        />
      </View>
      <View
        style={styles.row}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {weekdays.map((name) => (
          <Text key={name} variant="caption" tone="secondary" align="center" style={styles.weekday}>
            {name}
          </Text>
        ))}
      </View>
      {weeks.map((week, row) => (
        <View key={week.find((day) => day !== null) ?? row} style={styles.row}>
          {week.map((day, column) =>
            day === null ? (
              <View key={`empty-${column}`} style={styles.cell} />
            ) : (
              <DayCell
                key={day}
                day={day}
                label={labelOf(day, marks?.[day])}
                mark={marks?.[day]}
                isSelected={day === selectedDay}
                isToday={day === shownToday}
                onPress={onSelectDay}
              />
            ),
          )}
        </View>
      ))}
    </View>
  );
}

interface DayCellProps {
  day: string;
  /** What the reader hears: the date, «сегодня», the mark's words. */
  label: string;
  mark: DayMark | undefined;
  isSelected: boolean;
  isToday: boolean;
  onPress: (day: string) => void;
}

/** One day: its number, the count under it, a dot for attention; filled when picked, framed today. */
const DayCell = memo(function DayCell({
  day,
  label,
  mark,
  isSelected,
  isToday,
  onPress,
}: DayCellProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const count = mark?.count ?? 0;
  const ink = isSelected ? theme.onPrimary : undefined;

  return (
    <Pressable
      testID={`month-grid-day-${day}`}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: isSelected }}
      onPress={() => onPress(day)}
      style={({ pressed }) => [
        styles.cell,
        styles.day,
        isToday && styles.today,
        isSelected && styles.selected,
        pressed && !isSelected && styles.pressed,
      ]}
    >
      <Text align="center" color={ink} weight={isSelected || isToday ? 800 : undefined}>
        {String(dayDate(day).getDate())}
      </Text>
      <Text variant="caption" align="center" tone="secondary" color={ink}>
        {count > 0 ? String(count) : ' '}
      </Text>
      {mark?.isAttention === true ? (
        <View testID={`month-grid-attention-${day}`} style={[styles.dot, isSelected && styles.dotOnSelected]} />
      ) : null}
    </Pressable>
  );
});

/** The attention dot: a shape of its own, so it is not colour alone. */
const DOT = 6;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    grid: { gap: Spacing.xs },
    header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    title: { flex: 1 },
    row: { flexDirection: 'row', gap: 2 },
    weekday: { flex: 1 },
    cell: { flex: 1, minHeight: MIN_TOUCH_TARGET },
    day: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Spacing.xs,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: 'transparent',
    },
    today: { borderColor: theme.primary },
    selected: { backgroundColor: theme.primary, borderColor: theme.primary },
    pressed: { backgroundColor: theme.surfaceAlt },
    dot: {
      position: 'absolute',
      top: Spacing.xs,
      right: Spacing.xs,
      width: DOT,
      height: DOT,
      borderRadius: DOT / 2,
      backgroundColor: theme.tone.urgent.mark,
    },
    dotOnSelected: { borderWidth: 1, borderColor: theme.onPrimary },
  });
