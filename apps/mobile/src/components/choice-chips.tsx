import { Pressable, ScrollView, StyleSheet } from 'react-native';

import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import type { SegmentOption } from './segmented-tabs';
import { Text } from './text';

export interface ChoiceChipsProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The name of the whole row, said before its choices, such as «Статус». */
  accessibilityLabel: string;
  /** `tabs` filters what a screen shows; `radio` picks a value, as on a form. */
  semantics?: 'tabs' | 'radio';
}

/**
 * One choice of many in a row of pills — more than `SegmentedTabs` holds
 * (two to four). The row scrolls sideways rather than squeezing its words at
 * 320 dp and the largest font. Every pill is a full touch target; the chosen
 * one is drawn as a segmented row draws it: on the card colour, framed, at the
 * heaviest weight — more than colour tells it apart.
 */
export function ChoiceChips<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  semantics = 'tabs',
}: ChoiceChipsProps<T>) {
  const styles = useThemedStyles(createStyles);
  const isRadio = semantics === 'radio';

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole={isRadio ? 'radiogroup' : 'tablist'}
      accessibilityLabel={accessibilityLabel}
      contentContainerStyle={styles.row}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole={isRadio ? 'radio' : 'tab'}
            accessibilityLabel={option.label}
            accessibilityState={{
              selected: isSelected,
              ...(isRadio ? { checked: isSelected } : {}),
            }}
            onPress={() => {
              if (!isSelected) {
                onChange(option.value);
              }
            }}
            style={({ pressed }) => [
              styles.chip,
              isSelected && styles.selected,
              pressed && !isSelected && styles.pressed,
            ]}
          >
            <Text tone={isSelected ? 'default' : 'secondary'} weight={isSelected ? 800 : undefined}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    row: { gap: Spacing.xs, paddingVertical: Spacing.xs },
    chip: {
      minHeight: MIN_TOUCH_TARGET,
      justifyContent: 'center',
      paddingHorizontal: Spacing.lg,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: 'transparent',
      backgroundColor: theme.surfaceAlt,
    },
    selected: { backgroundColor: theme.card, borderColor: theme.border },
    pressed: { opacity: 0.7 },
  });
