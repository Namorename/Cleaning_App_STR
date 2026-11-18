import { matchesAllTokens } from '@str-ops/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { ChoiceChips } from '@/components/choice-chips';
import { Icon } from '@/components/icon';
import { ListRow } from '@/components/list-row';
import { SegmentedTabs } from '@/components/segmented-tabs';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { formatDayHeading } from '@/features/tasks/format';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { statusFilterText } from './format';
import {
  OFFICE_STATUS_FILTERS,
  type DateChoice,
  type DateFilter,
  type OfficeStatusFilter,
  type PlaceOption,
} from './schema';

/** The office's two ways to see its cleanings. */
export type OfficeView = 'list' | 'calendar';

/** From this many places on, the sheet offers a search above them. */
const SEARCH_FROM = 8;

interface OfficeFiltersProps {
  view: OfficeView;
  onViewChange: (view: OfficeView) => void;
  date: DateFilter;
  /** The day picked in the calendar when it needs a chip of its own (`pickedDayOf`). */
  pickedDay: string | null;
  onDateChange: (choice: DateChoice) => void;
  status: OfficeStatusFilter;
  onStatusChange: (status: OfficeStatusFilter) => void;
  /** The place filtered by, or null for every place. */
  place: string | null;
  onPickPlace: () => void;
}

/**
 * Above the office's cleanings: the view, the days (the list's — the calendar
 * picks its own), the status, and the place behind a button that opens its
 * sheet. Each is a row of choices a screen reader names before reading them.
 */
export function OfficeFilters({
  view,
  onViewChange,
  date,
  pickedDay,
  onDateChange,
  status,
  onStatusChange,
  place,
  onPickPlace,
}: OfficeFiltersProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const views = [
    { value: 'list' as const, label: t('office.cleanings.list') },
    { value: 'calendar' as const, label: t('office.cleanings.calendar') },
  ];
  // The day picked in the calendar stays a chip of its own beside the three.
  const days: { value: DateChoice; label: string }[] = [
    { value: 'today', label: t('tasks.days.today') },
    { value: 'tomorrow', label: t('tasks.days.tomorrow') },
    { value: 'week', label: t('office.cleanings.week') },
    ...(pickedDay === null ? [] : [{ value: 'day' as const, label: formatDayHeading(pickedDay) }]),
  ];
  const statuses = OFFICE_STATUS_FILTERS.map((value) => ({
    value,
    label: statusFilterText(value, t),
  }));
  const placeLabel = t('office.cleanings.place', {
    name: place ?? t('office.cleanings.allPlaces'),
  });

  return (
    <View style={styles.filters}>
      <SegmentedTabs
        options={views}
        value={view}
        onChange={onViewChange}
        accessibilityLabel={t('office.cleanings.view')}
      />
      {view === 'list' ? (
        <ChoiceChips
          options={days}
          value={date.choice}
          onChange={onDateChange}
          accessibilityLabel={t('office.cleanings.date')}
        />
      ) : null}
      <ChoiceChips
        options={statuses}
        value={status}
        onChange={onStatusChange}
        accessibilityLabel={t('office.cleanings.status')}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={placeLabel}
        onPress={onPickPlace}
        style={({ pressed }) => [styles.picker, pressed && styles.pressed]}
      >
        <Text style={styles.pickerText} numberOfLines={1}>
          {placeLabel}
        </Text>
        <Icon name="action.expand" size="small" tone="secondary" />
      </Pressable>
    </View>
  );
}

interface PlaceSheetProps {
  isVisible: boolean;
  /** The places of the cleanings read, with their counts. */
  places: readonly PlaceOption[];
  value: string | null;
  onChange: (place: string | null) => void;
  onClose: () => void;
}

/**
 * Every place, or one of those the cleanings read stand at — the panel's
 * search rule over their names (any order, every word) once there are many.
 */
export function PlaceSheet({ isVisible, places, value, onChange, onClose }: PlaceSheetProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const found = useMemo(
    () => places.filter((place) => matchesAllTokens(place.key, query)),
    [places, query],
  );

  return (
    <BottomSheet
      testID="office-place-sheet"
      isVisible={isVisible}
      title={t('office.cleanings.placeTitle')}
      onClose={onClose}
    >
      {places.length >= SEARCH_FROM ? (
        <TextField
          label={t('problems.searchPlaces')}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
      ) : null}
      <ScrollView keyboardShouldPersistTaps="handled">
        <ListRow
          title={t('office.cleanings.allPlaces')}
          isSelected={value === null}
          right={value === null ? <Icon name="status.done" tone="primary" /> : undefined}
          onPress={() => onChange(null)}
        />
        {found.map((place) => (
          <ListRow
            key={place.key}
            title={place.key}
            subtitle={t('office.cleanings.dayCount', { count: place.count })}
            isSelected={place.key === value}
            right={place.key === value ? <Icon name="status.done" tone="primary" /> : undefined}
            onPress={() => onChange(place.key)}
          />
        ))}
        {found.length === 0 ? (
          <Text tone="secondary" align="center" style={layout.none}>
            {t('problems.noPlaceMatch')}
          </Text>
        ) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const layout = StyleSheet.create({
  none: { padding: Spacing.lg },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    filters: { gap: Spacing.xs, paddingTop: Spacing.sm },
    picker: {
      alignSelf: 'flex-start',
      maxWidth: '100%',
      minHeight: MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.lg,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: theme.border,
      backgroundColor: theme.card,
    },
    pickerText: { flexShrink: 1 },
    pressed: { backgroundColor: theme.surfaceAlt },
  });
