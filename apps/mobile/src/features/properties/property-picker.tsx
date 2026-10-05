import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/bottom-sheet';
import { ListRow } from '@/components/list-row';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { BUTTON_HEIGHT, Radius, Spacing, type Theme } from '@/constants/theme';
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
 * Until it existed a report filed from the list of reports carried no place
 * at all — the route only had one when it came from a task — and three of the
 * four reports on the live database had neither a place nor a task. A manager
 * reading "the tap is dripping" then has to go and ask which tap.
 *
 * A field that opens her places in a sheet from the bottom (owner's variant 1,
 * docs/design/decisions.md §2): unfolded inside the form, the list was thirty
 * rows for a cleaner with thirty rooms. The search box appears only when the
 * list is long enough to need it: a cleaner with two listings should not meet
 * a search box, one with thirty rooms should.
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

  const label = t('problems.place');
  const selected = properties.find((property) => property.id === selectedId) ?? null;
  const value =
    selected !== null
      ? propertyLabel(selected)
      : isLoading && properties.length === 0
        ? t('problems.loadingPlaces')
        : t('problems.pickPlace');

  // The search starts empty the next time: what she typed was for this look.
  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const choose = (propertyId: number) => {
    onSelect(propertyId);
    close();
  };

  return (
    <View style={styles.field}>
      <Text tone="secondary">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.box, pressed && styles.boxPressed]}
      >
        <Text tone={selected === null ? 'secondary' : 'default'} numberOfLines={2}>
          {value}
        </Text>
      </Pressable>

      <BottomSheet isVisible={isOpen} title={label} onClose={close}>
        {properties.length >= SEARCH_FROM ? (
          <TextField
            label={t('problems.searchPlaces')}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
          />
        ) : null}
        <PlaceList
          places={filterProperties(properties, query)}
          selectedId={selectedId}
          onChoose={choose}
          emptyText={
            properties.length > 0
              ? t('problems.noPlaceMatch')
              : isLoading
                ? t('problems.loadingPlaces')
                : t('problems.noPlaces')
          }
          styles={styles}
        />
      </BottomSheet>
    </View>
  );
}

interface PlaceListProps {
  places: readonly ReportProperty[];
  selectedId: number | null;
  onChoose: (propertyId: number) => void;
  /** Said instead of an empty sheet: nothing matches, nothing yet, nothing at all. */
  emptyText: string;
  styles: ReturnType<typeof createStyles>;
}

/** Her places, one 64 dp row each; a long list scrolls inside the sheet. */
function PlaceList({ places, selectedId, onChoose, emptyText, styles }: PlaceListProps) {
  return (
    <FlatList
      data={places}
      keyExtractor={(place) => String(place.id)}
      keyboardShouldPersistTaps="handled"
      style={styles.list}
      renderItem={({ item }) => (
        <ListRow
          title={propertyLabel(item)}
          isSelected={item.id === selectedId}
          onPress={() => onChoose(item.id)}
        />
      )}
      ListEmptyComponent={
        <Text tone="secondary" style={styles.empty}>
          {emptyText}
        </Text>
      }
    />
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    field: { gap: Spacing.xs },
    // Drawn like a text field (components/text-field.tsx): 56 high, the
    // outline she has to find.
    box: {
      minHeight: BUTTON_HEIGHT,
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: theme.border,
      borderRadius: Radius.lg,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
      backgroundColor: theme.card,
    },
    boxPressed: { backgroundColor: theme.surfaceAlt },
    // Edge to edge of the sheet: a row's press reaches its sides, and its
    // words line up with the sheet's title.
    list: { flexGrow: 0, flexShrink: 1, marginHorizontal: -Spacing.lg },
    empty: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.lg },
  });
