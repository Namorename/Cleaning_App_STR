import { problemLevelTone, type ProblemLevel } from '@str-ops/shared';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/badge';
import { BottomSheet } from '@/components/bottom-sheet';
import { ListRow } from '@/components/list-row';
import { Text } from '@/components/text';
import { TextField } from '@/components/text-field';
import { BUTTON_HEIGHT, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { currentLanguage } from '@/i18n';

import {
  categoryLevel,
  categoryName,
  indexCategories,
  matchCategories,
  type ProblemCategory,
} from './categories';

interface CategoryPickerProps {
  categories: readonly ProblemCategory[];
  selectedId: string | null;
  /** Shown while the selected category is not in the list: the task's own title. */
  fallbackName: string;
  onSelect: (category: ProblemCategory, name: string) => void;
  isDisabled?: boolean;
}

/**
 * What broke, picked from the company's catalogue (hosts.problem_report_mode =
 * catalog, docs/problem-categories.md).
 *
 * A field that opens the list in a sheet from the bottom, as the choice of a
 * place does (`PropertyPicker`, decisions §2). The search box is always there
 * and takes the keyboard as the sheet opens: she types the first letters and the
 * list narrows at once (`matchCategories`). Each row carries its urgency as a
 * chip — the word and the tone, never colour alone.
 */
export function CategoryPicker({
  categories,
  selectedId,
  fallbackName,
  onSelect,
  isDisabled = false,
}: CategoryPickerProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const language = currentLanguage();

  const index = useMemo(() => indexCategories(categories), [categories]);
  const shown = useMemo(() => matchCategories(index, query), [index, query]);

  const label = t('problems.categoryLabel');
  const selected = categories.find((category) => category.id === selectedId) ?? null;
  const value =
    selected !== null
      ? categoryName(selected, language)
      : selectedId !== null
        ? fallbackName
        : t('problems.pickCategory');

  // The search starts empty the next time: what she typed was for this look.
  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const choose = (category: ProblemCategory) => {
    onSelect(category, categoryName(category, language));
    close();
  };

  return (
    <View style={styles.field}>
      <Text tone="secondary">{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityValue={{ text: value }}
        accessibilityState={{ disabled: isDisabled }}
        disabled={isDisabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.box, pressed && styles.boxPressed]}
      >
        <Text tone={selectedId === null ? 'secondary' : 'default'} numberOfLines={2}>
          {value}
        </Text>
      </Pressable>

      <BottomSheet isVisible={isOpen} title={label} onClose={close}>
        <TextField
          label={t('problems.searchCategories')}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
        <FlatList
          data={shown}
          keyExtractor={(category) => category.id}
          keyboardShouldPersistTaps="handled"
          style={styles.list}
          renderItem={({ item }) => (
            <CategoryRow
              category={item}
              name={categoryName(item, language)}
              isSelected={item.id === selectedId}
              onChoose={choose}
            />
          )}
          ListEmptyComponent={
            <Text tone="secondary" style={styles.empty}>
              {t('problems.noCategoryMatch')}
            </Text>
          }
        />
      </BottomSheet>
    </View>
  );
}

interface CategoryRowProps {
  category: ProblemCategory;
  name: string;
  isSelected: boolean;
  onChoose: (category: ProblemCategory) => void;
}

function CategoryRow({ category, name, isSelected, onChoose }: CategoryRowProps) {
  const { t } = useTranslation();
  const priority = categoryLevel(category);
  const priorityWord = priority === null ? null : t(`problems.priorities.${priority}`);

  return (
    <ListRow
      title={name}
      isSelected={isSelected}
      onPress={() => onChoose(category)}
      accessibilityLabel={
        priorityWord === null
          ? name
          : t('problems.categoryOption', { name, priority: priorityWord })
      }
      right={priority === null ? undefined : <PriorityChip priority={priority} />}
    />
  );
}

interface PriorityChipProps {
  /** On the scale of four: «Критическая» is the strongest chip there is. */
  priority: ProblemLevel;
  testID?: string;
}

/** The urgency a category files a task with: shown, never chosen. */
export function PriorityChip({ priority, testID }: PriorityChipProps) {
  const { t } = useTranslation();
  return (
    <Badge
      label={t(`problems.priorities.${priority}`)}
      tone={problemLevelTone(priority)}
      testID={testID}
    />
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    field: { gap: Spacing.xs },
    // Drawn like a text field (components/text-field.tsx), as the place's box is.
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
    // Edge to edge of the sheet: a row's press reaches its sides.
    list: { flexGrow: 0, flexShrink: 1, marginHorizontal: -Spacing.lg },
    empty: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.lg },
  });
