import { DUE_DAYS_AHEAD } from '@str-ops/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { MonthGrid } from '@/components/month-grid';
import { Text } from '@/components/text';
import { Spacing } from '@/constants/theme';
import { formatCalendarDate } from '@/features/tasks/format';
import { monthOf, shiftDay, todayDay } from '@/lib/calendar-month';

/**
 * The day a task is to be done (owner, 2026-11-26; 20261126130000), picked on the month grid the
 * phone already has (components/month-grid.tsx): no native picker, so it ships over the air.
 */

/**
 * The days the phone offers, as the server allows them (problem_due_check): from yesterday to a
 * year ahead — a day short of it, since at night the phone's day is a day past the server's.
 */
export function dueRange(today: string): { first: string; last: string } {
  return { first: shiftDay(today, -1), last: shiftDay(today, DUE_DAYS_AHEAD - 1) };
}

export function isDueInRange(day: string, today: string): boolean {
  const { first, last } = dueRange(today);
  return day >= first && day <= last;
}

interface DueGridProps {
  value: string | null;
  /** A day of the range was pressed; one out of it is refused here, in words. */
  onPick: (day: string) => void;
  /** The phone's today, `YYYY-MM-DD`; a test pins it. */
  today?: string;
  testID?: string;
}

/** The month grid of the planned day: a press outside the range is said, not sent. */
export function DueGrid({ value, onPick, today = todayDay(), testID }: DueGridProps) {
  const { t } = useTranslation();
  const [month, setMonth] = useState(() => monthOf(value ?? today));
  const [isRefused, setRefused] = useState(false);

  const pick = (day: string) => {
    const isInRange = isDueInRange(day, today);
    setRefused(!isInRange);
    if (isInRange) {
      onPick(day);
    }
  };

  return (
    <View style={layout.field}>
      <MonthGrid
        month={month}
        selectedDay={value}
        onSelectDay={pick}
        onMonthChange={setMonth}
        today={today}
        testID={testID}
      />
      {isRefused ? (
        <Text tone="danger" accessibilityLiveRegion="polite">
          {t('serverErrors.problemDueInvalid', { days: DUE_DAYS_AHEAD })}
        </Text>
      ) : null}
    </View>
  );
}

interface DueFieldProps {
  value: string | null;
  onChange: (day: string | null) => void;
  isDisabled?: boolean;
  /** The phone's today, `YYYY-MM-DD`; a test pins it. */
  today?: string;
}

/**
 * «Дата выполнения» on the office's form: the day or «Без даты», what it does, and «Выбрать дату» /
 * «Изменить дату», which opens the grid; a day picked closes it. «Убрать дату» while one is set.
 */
export function DueField({ value, onChange, isDisabled = false, today }: DueFieldProps) {
  const { t } = useTranslation();
  const [isOpen, setOpen] = useState(false);

  const pick = (day: string) => {
    onChange(day);
    setOpen(false);
  };

  return (
    <View style={layout.field} testID="problem-due-field">
      <Text tone="secondary">{t('problems.due.label')}</Text>
      <Text accessibilityLiveRegion="polite" testID="problem-due-value">
        {value === null ? t('problems.due.none') : formatCalendarDate(value)}
      </Text>
      <Text variant="caption" tone="secondary">
        {t('problems.due.hint')}
      </Text>
      {isOpen ? <DueGrid value={value} onPick={pick} today={today} testID="problem-due" /> : null}
      <View style={layout.actions}>
        <Button
          variant="outline"
          label={value === null ? t('problems.due.pick') : t('problems.due.change')}
          isDisabled={isDisabled}
          onPress={() => setOpen((open) => !open)}
        />
        {value === null ? null : (
          <Button
            variant="outline"
            label={t('problems.due.clear')}
            isDisabled={isDisabled}
            onPress={() => onChange(null)}
          />
        )}
      </View>
    </View>
  );
}

/** Sizes only: the colours are the components'. */
const layout = StyleSheet.create({
  field: { gap: Spacing.xs },
  actions: { gap: Spacing.sm },
});
