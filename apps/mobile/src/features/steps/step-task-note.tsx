import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

interface StepTaskNoteProps {
  lines: readonly string[];
  checked: readonly number[];
  onToggle: (index: number) => void;
  disabled: boolean;
}

/**
 * The manager's note, one line per tick.
 *
 * Each line is a checkbox the size of a finger: the cleaner reads it at the
 * door with a bag in the other hand. The order of lines is the order of the
 * note; the indexes go to the server as they are.
 */
export function StepTaskNote({ lines, checked, onToggle, disabled }: StepTaskNoteProps) {
  const styles = useThemedStyles(createStyles);

  return (
    <View style={styles.list}>
      {lines.map((line, index) => {
        const isChecked = checked.includes(index);

        return (
          <Pressable
            key={`${index}-${line}`}
            accessibilityRole="checkbox"
            accessibilityLabel={line}
            accessibilityState={{ checked: isChecked, disabled }}
            disabled={disabled}
            onPress={() => onToggle(index)}
            style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
          >
            <View style={[styles.box, isChecked && styles.boxChecked]}>
              {isChecked ? <Text style={styles.tick}>✓</Text> : null}
            </View>
            <Text style={[styles.line, isChecked && styles.lineChecked]}>{line}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const BOX_SIZE = 26;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    list: { gap: Spacing.xs },
    row: {
      minHeight: MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    rowPressed: { opacity: 0.75 },
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
    tick: { color: theme.onPrimary, fontSize: FontSize.body, fontWeight: '700' },
    line: { flex: 1, color: theme.text, fontSize: FontSize.title },
    lineChecked: { color: theme.textSecondary },
  });
