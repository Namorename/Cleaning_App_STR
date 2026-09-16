import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { filterProperties, propertyLabel, type ReportProperty } from './schema';

/** Below this the list fits on screen and a search box is only in the way. */
const SEARCH_FROM = 8;

interface PropertyPickerProps {
  properties: readonly ReportProperty[];
  selectedId: number | null;
  onSelect: (propertyId: number) => void;
  isLoading?: boolean;
}

/**
 * Where it happened.
 *
 * Until now a report filed from the list of problems carried no place at all —
 * the route only had one when it came from a task — and three of the four
 * reports on the live database have neither a place nor a task. A manager
 * reading "the tap is dripping" then has to go and ask which tap.
 *
 * Folded away until she taps it, because most of the form is about what broke,
 * not where. The search box appears only when the list is long enough to need
 * it: a cleaner with two listings should not meet a search box, one with
 * thirty rooms should.
 */
export function PropertyPicker({
  properties,
  selectedId,
  onSelect,
  isLoading = false,
}: PropertyPickerProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = properties.find((property) => property.id === selectedId) ?? null;
  const shown = filterProperties(properties, query);

  if (!isOpen) {
    const label = selected === null ? t('problems.pickPlace') : propertyLabel(selected);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('problems.place')}
        accessibilityValue={{ text: label }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.field, pressed && styles.fieldPressed]}
      >
        <Text style={selected === null ? styles.hint : styles.value}>
          {isLoading && properties.length === 0 ? t('problems.loadingPlaces') : label}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.picker}>
      {properties.length >= SEARCH_FROM ? (
        <TextInput
          accessibilityLabel={t('problems.searchPlaces')}
          autoFocus
          onChangeText={setQuery}
          placeholder={t('problems.searchPlaces')}
          placeholderTextColor={styles.hint.color}
          style={styles.search}
          value={query}
        />
      ) : null}

      {shown.length === 0 ? (
        <Text style={styles.hint}>
          {properties.length > 0
            ? t('problems.noPlaceMatch')
            : isLoading
              ? t('problems.loadingPlaces')
              : t('problems.noPlaces')}
        </Text>
      ) : (
        shown.map((property) => {
          const label = propertyLabel(property);
          return (
            <Pressable
              key={property.id}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: property.id === selectedId }}
              onPress={() => {
                onSelect(property.id);
                setQuery('');
                setOpen(false);
              }}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Text style={styles.rowText}>{label}</Text>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    field: {
      minHeight: MIN_TOUCH_TARGET,
      justifyContent: 'center',
      paddingHorizontal: Spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      borderRadius: Radius.md,
      backgroundColor: theme.card,
    },
    fieldPressed: { opacity: 0.7 },
    value: { color: theme.text, fontSize: FontSize.body },
    hint: { color: theme.textSecondary, fontSize: FontSize.body, padding: Spacing.sm },
    picker: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      borderRadius: Radius.md,
      backgroundColor: theme.card,
      overflow: 'hidden',
    },
    search: {
      minHeight: MIN_TOUCH_TARGET,
      paddingHorizontal: Spacing.md,
      color: theme.text,
      fontSize: FontSize.body,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    row: {
      minHeight: MIN_TOUCH_TARGET,
      justifyContent: 'center',
      paddingHorizontal: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
    },
    rowPressed: { backgroundColor: theme.background },
    rowText: { color: theme.text, fontSize: FontSize.body },
  });
