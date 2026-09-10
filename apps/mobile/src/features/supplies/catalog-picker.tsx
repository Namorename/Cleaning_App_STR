import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { catalogItemName, filterCatalog, type CatalogItem } from './schema';

interface CatalogPickerProps {
  catalog: readonly CatalogItem[];
  /** The language the names are shown in. */
  language: string;
  onPick: (item: CatalogItem) => void;
}

/**
 * The company's list, unfolded under a line of the request.
 *
 * Inline rather than a modal: the list is a few dozen names at most, and
 * she keeps the rest of the form in view. A search box narrows it by any
 * language the name is written in.
 */
export function CatalogPicker({ catalog, language, onPick }: CatalogPickerProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const [query, setQuery] = useState('');
  const shown = filterCatalog(catalog, query);

  return (
    <View style={styles.picker}>
      <TextInput
        accessibilityLabel={t('supplies.searchCatalog')}
        autoFocus
        onChangeText={setQuery}
        placeholder={t('supplies.searchCatalog')}
        placeholderTextColor={styles.hint.color}
        style={styles.search}
        value={query}
      />
      {shown.length === 0 ? (
        <Text style={styles.hint}>{t('supplies.catalogNoMatch')}</Text>
      ) : (
        shown.map((item) => {
          const name = catalogItemName(item, language);
          const unit = t(`supplies.units.${item.unit}`);
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${name}, ${unit}`}
              onPress={() => onPick(item)}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
            >
              <Text style={styles.rowText}>{name}</Text>
              <Text style={styles.rowUnit}>{unit}</Text>
            </Pressable>
          );
        })
      )}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    picker: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.border,
      borderRadius: Radius.md,
      backgroundColor: theme.background,
      overflow: 'hidden',
    },
    search: {
      minHeight: MIN_TOUCH_TARGET,
      paddingHorizontal: Spacing.md,
      fontSize: FontSize.body,
      color: theme.text,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
    },
    hint: { color: theme.textSecondary, fontSize: FontSize.body, padding: Spacing.md },
    row: {
      minHeight: MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.md,
      gap: Spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.divider,
    },
    rowPressed: { backgroundColor: theme.card },
    rowText: { flex: 1, color: theme.text, fontSize: FontSize.title },
    rowUnit: { color: theme.textSecondary, fontSize: FontSize.body },
  });
