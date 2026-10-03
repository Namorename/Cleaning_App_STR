import { Pressable, StyleSheet, View } from 'react-native';

import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { Text } from './text';

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: string;
}

export interface SegmentedTabsProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** The name of the whole row, said before its choices, such as `common.theme.label`. */
  accessibilityLabel: string;
  /**
   * `tabs` switches what a screen shows; `radio` picks a setting. The same
   * row, said to a screen reader as what it does.
   */
  semantics?: 'tabs' | 'radio';
  isDisabled?: boolean;
}

/**
 * Two to four choices side by side in a pill. Every choice is a full touch
 * target; the chosen one is lifted onto the card colour with a frame and the
 * heaviest weight, so it stands out by more than colour (plan §3).
 */
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  semantics = 'tabs',
  isDisabled = false,
}: SegmentedTabsProps<T>) {
  const styles = useThemedStyles(createStyles);
  const isRadio = semantics === 'radio';

  return (
    <View
      accessibilityRole={isRadio ? 'radiogroup' : 'tablist'}
      accessibilityLabel={accessibilityLabel}
      style={styles.row}
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
              disabled: isDisabled,
            }}
            disabled={isDisabled}
            onPress={() => {
              if (!isSelected) {
                onChange(option.value);
              }
            }}
            style={({ pressed }) => [
              styles.segment,
              isSelected && styles.selected,
              pressed && !isSelected && styles.pressed,
            ]}
          >
            <Text
              align="center"
              tone={isSelected ? 'default' : 'secondary'}
              weight={isSelected ? 800 : undefined}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: Spacing.xs,
      padding: Spacing.xs,
      borderRadius: Radius.pill,
      backgroundColor: theme.surfaceAlt,
    },
    segment: {
      flex: 1,
      minHeight: MIN_TOUCH_TARGET,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: Spacing.sm,
      borderRadius: Radius.pill,
    },
    selected: {
      backgroundColor: theme.card,
      borderWidth: 1,
      borderColor: theme.border,
    },
    pressed: { opacity: 0.7 },
  });
