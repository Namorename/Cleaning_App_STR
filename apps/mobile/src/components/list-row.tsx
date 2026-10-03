import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ROW_HEIGHT, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

import { Text } from './text';

export interface ListRowProps {
  title: string;
  /** A quieter second line: a place, a time, the current value. */
  subtitle?: string;
  /** Leading slot: where an icon goes once the icons arrive (build 1.2.0). */
  left?: ReactNode;
  /** Trailing slot: a value, a badge, later a chevron. */
  right?: ReactNode;
  /** Makes the row a button; without it the row is plain text. */
  onPress?: () => void;
  /** What the reader hears; both lines by default. */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  isSelected?: boolean;
  isDisabled?: boolean;
}

/** A row of a list: 64 dp (decisions §1, «Форма»), title over a quieter line. */
export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  isSelected = false,
  isDisabled = false,
}: ListRowProps) {
  const styles = useThemedStyles(createStyles);
  const body = (
    <>
      {left}
      <View style={styles.lines}>
        <Text>{title}</Text>
        {subtitle !== undefined ? (
          <Text variant="caption" tone="secondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </>
  );

  if (onPress === undefined) {
    return <View style={styles.row}>{body}</View>;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? [title, subtitle].filter(Boolean).join(', ')}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected: isSelected, disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      minHeight: ROW_HEIGHT,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingHorizontal: Spacing.lg,
      paddingVertical: Spacing.sm,
    },
    lines: { flex: 1, gap: 2 },
    pressed: { backgroundColor: theme.surfaceAlt },
  });
