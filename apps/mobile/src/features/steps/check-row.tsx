import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

interface CheckRowProps {
  /** What is to be done; also its name for a screen reader. */
  label: string;
  /** A quieter line under it, such as «Необязательный пункт». */
  note?: string;
  accessibilityHint?: string;
  isChecked: boolean;
  isDisabled: boolean;
  onToggle: () => void;
}

/**
 * One thing to tick off — a line of the manager's note, an item of a
 * checklist: a checkbox the size of a finger, its box filled with a check once
 * done and its words quieter. Not a `Button`: it is a checkbox to the reader,
 * with its state.
 */
export function CheckRow({
  label,
  note,
  accessibilityHint,
  isChecked,
  isDisabled,
  onToggle,
}: CheckRowProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked: isChecked, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onToggle}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={[styles.box, isChecked && styles.boxChecked]}>
        {isChecked ? (
          <Icon testID="check-tick" name="status.done" size="small" tone="onPrimary" />
        ) : null}
      </View>
      <View style={styles.words}>
        <Text variant="title" weight={600} tone={isChecked ? 'secondary' : 'default'}>
          {label}
        </Text>
        {note !== undefined ? (
          <Text variant="caption" tone="secondary">
            {note}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

/** The box holds only the check: it does not grow with the type. */
const BOX_SIZE = 26;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      minHeight: MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    pressed: { opacity: 0.75 },
    box: {
      width: BOX_SIZE,
      height: BOX_SIZE,
      borderRadius: Radius.md / 2,
      borderWidth: 2,
      borderColor: theme.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    boxChecked: { backgroundColor: theme.primary, borderColor: theme.primary },
    words: { flex: 1, gap: 2 },
  });
