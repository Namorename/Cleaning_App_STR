import { router } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import {
  RefreshControl,
  SectionList,
  StyleSheet,
  View,
  type SectionListRenderItemInfo,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ErrorBanner } from '@/components/error-banner';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { MonthGrid, type DayMark } from '@/components/month-grid';
import { Spacing, type Theme } from '@/constants/theme';
import { SectionHeading } from '@/features/tasks/section-heading';
import { useLanguage } from '@/hooks/use-language';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { monthOf, todayDay } from '@/lib/calendar-month';

import { OfficeFilters, PlaceSheet, type OfficeView } from './office-filters';
import { OfficeTaskRow } from './office-task-row';
import {
  NO_FILTER,
  dateOfDay,
  dayMarks,
  filterOffice,
  groupOfficeByDay,
  pickedDayOf,
  placesOf,
  rangeOfDate,
  rangeOfMonth,
  selectedDayOf,
  type DateChoice,
  type DateFilter,
  type OfficeDay,
  type OfficeFilter,
  type OfficeStatusFilter,
  type OfficeTask,
} from './schema';
import { useOfficeTasks } from './use-office';

const FIRST_DATE: DateFilter = { choice: 'today', day: null };

/**
 * The office's «Уборки» (owner, 2026-11-18): every cleaning of the company —
 * the panel's «Уборки», repairs left to «Задания» — as a list by day or a
 * month's calendar with the picked day under it, filtered by days, status and
 * place. Only the days on screen are read: the list's days, or the calendar's
 * month. A row opens the cleaning's office card (`/task/[id]`).
 */
export function OfficeCleaningsScreen() {
  const { t } = useTranslation();
  const language = useLanguage();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const today = todayDay(useNow());
  const [view, setView] = useState<OfficeView>('list');
  const [date, setDate] = useState<DateFilter>(FIRST_DATE);
  const [month, setMonth] = useState(() => monthOf(today));
  const [filter, setFilter] = useState<OfficeFilter>(NO_FILTER);
  const [isPickingPlace, setPickingPlace] = useState(false);

  const isCalendar = view === 'calendar';
  // The calendar's day: the one picked, or the first of the list's span.
  const selectedDay = selectedDayOf(date, today);
  const range = useMemo(
    () => (isCalendar ? rangeOfMonth(month) : rangeOfDate(date, today)),
    [isCalendar, month, date, today],
  );
  const query = useOfficeTasks(range);
  const rows = query.data;
  const shown = useMemo(
    () => (rows === undefined ? undefined : filterOffice(rows, filter)),
    [rows, filter],
  );
  const places = useMemo(() => placesOf(rows ?? []), [rows]);
  const marks = useMemo(() => (shown === undefined ? {} : dayMarks(shown)), [shown]);
  const sections = useMemo<OfficeDay[]>(() => {
    if (shown === undefined) {
      return [];
    }
    return isCalendar
      ? groupOfficeByDay(
          shown.filter((task) => task.scheduled_date === selectedDay),
          language,
        )
      : groupOfficeByDay(shown, language);
  }, [shown, isCalendar, selectedDay, language]);

  const { refetch } = query;
  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const onOpen = useCallback((taskId: string) => {
    router.push({ pathname: '/task/[id]', params: { id: taskId } });
  }, []);

  const onDateChange = useCallback((choice: DateChoice) => {
    setDate((current) => ({ ...current, choice }));
  }, []);

  const onSelectDay = useCallback(
    (day: string) => {
      setDate(dateOfDay(day, today));
    },
    [today],
  );

  // A month shown afresh opens on today when it holds today, on its first day otherwise.
  const onMonthChange = useCallback(
    (next: string) => {
      setMonth(next);
      setDate(dateOfDay(monthOf(today) === next ? today : `${next}-01`, today));
    },
    [today],
  );

  const onViewChange = useCallback(
    (next: OfficeView) => {
      setView(next);
      if (next === 'calendar') {
        setMonth(monthOf(selectedDay));
      }
    },
    [selectedDay],
  );

  const onStatusChange = useCallback((status: OfficeStatusFilter) => {
    setFilter((current) => ({ ...current, status }));
  }, []);

  const onPlaceChange = useCallback((place: string | null) => {
    setFilter((current) => ({ ...current, place }));
    setPickingPlace(false);
  }, []);

  const markLabel = useCallback(
    (mark: DayMark) =>
      [
        t('office.cleanings.dayCount', { count: mark.count }),
        mark.isAttention === true ? t('office.cleanings.dayAttention') : null,
      ]
        .filter((part) => part !== null)
        .join(', '),
    [t],
  );

  const renderItem = useCallback(
    ({ item }: SectionListRenderItemInfo<OfficeTask, OfficeDay>) => (
      <OfficeTaskRow task={item} onPress={onOpen} />
    ),
    [onOpen],
  );

  const isFiltered = filter.status !== NO_FILTER.status || filter.place !== null;
  // What the filters had to hide: the calendar's picked day, or the list's days.
  const readOnScreen = isCalendar
    ? (rows ?? []).filter((task) => task.scheduled_date === selectedDay).length
    : (rows?.length ?? 0);
  const empty = emptyOf({
    isPending: query.isPending,
    error: rows === undefined ? query.error : null,
    onRetry: onRefresh,
    isCalendar,
    isFiltered: isFiltered && readOnScreen > 0,
    onReset: () => setFilter(NO_FILTER),
    t,
  });

  const header = (
    <View style={styles.header}>
      {/* Error over cache: the list kept from the last read stays, the line says why it is old. */}
      {query.error !== null && rows !== undefined ? (
        <ErrorBanner title={t('common.refreshFailed')} error={query.error} />
      ) : null}
      <OfficeFilters
        view={view}
        onViewChange={onViewChange}
        date={date}
        pickedDay={pickedDayOf(date, today)}
        onDateChange={onDateChange}
        status={filter.status}
        onStatusChange={onStatusChange}
        place={filter.place}
        onPickPlace={() => setPickingPlace(true)}
      />
      {isCalendar ? (
        <MonthGrid
          testID="office-month-grid"
          month={month}
          selectedDay={selectedDay}
          marks={marks}
          today={today}
          markLabel={markLabel}
          onSelectDay={onSelectDay}
          onMonthChange={onMonthChange}
        />
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <SectionList
        sections={sections}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        keyExtractor={keyExtractor}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching}
            onRefresh={onRefresh}
            tintColor={theme.textSecondary}
            colors={[theme.textSecondary]}
          />
        }
      />
      <PlaceSheet
        isVisible={isPickingPlace}
        places={places}
        value={filter.place}
        onChange={onPlaceChange}
        onClose={() => setPickingPlace(false)}
      />
    </View>
  );
}

interface EmptyInput {
  isPending: boolean;
  /** A read that never landed: nothing kept to show. */
  error: Error | null;
  onRetry: () => void;
  isCalendar: boolean;
  /** Filters hide rows that were read: the way back is offered. */
  isFiltered: boolean;
  onReset: () => void;
  t: ReturnType<typeof useTranslation>['t'];
}

/** Loading, a failure, or nothing: three answers the office has to tell apart. */
function emptyOf({
  isPending,
  error,
  onRetry,
  isCalendar,
  isFiltered,
  onReset,
  t,
}: EmptyInput): ReactElement {
  if (isPending && error === null) {
    return <LoadingState label={t('tasks.loading')} />;
  }
  if (error !== null) {
    return <ErrorState error={error} title={t('tasks.loadFailed')} onRetry={onRetry} />;
  }
  if (isFiltered) {
    return (
      <EmptyState
        title={t('office.cleanings.emptyFiltered')}
        action={{ label: t('office.cleanings.resetFilters'), onPress: onReset }}
      />
    );
  }
  return (
    <EmptyState title={t(isCalendar ? 'office.cleanings.emptyDay' : 'office.cleanings.empty')} />
  );
}

function renderSectionHeader({ section }: { section: OfficeDay }) {
  return <SectionHeading section={section} />;
}

function keyExtractor(task: OfficeTask): string {
  return task.id;
}

function Separator() {
  return <View style={layout.separator} />;
}

const layout = StyleSheet.create({
  separator: { height: Spacing.sm },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    header: { gap: Spacing.md },
    content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, flexGrow: 1 },
  });
