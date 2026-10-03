import type { Tone, ToneColors } from '@str-ops/shared';
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Text } from './text';

export interface BadgeProps {
  /** The word: a chip is never colour alone. */
  label: string;
  /** The tone of the contract — `taskStatusTone(status)` and the like. */
  tone: Tone;
  /** Before the word: where the status icon goes once the icons arrive (build 1.2.0). */
  left?: ReactNode;
  testID?: string;
}

/**
 * How each tone's chip is framed (tokens.ts, `ToneColors.border`): «Без
 * исполнителя» dashed and «Просрочено» solid, so the two read apart by their
 * shape too; the unread badge is filled with its mark.
 */
function chipBox(tone: Tone, colors: ToneColors): ViewStyle {
  if (tone === 'unread') {
    return { backgroundColor: colors.mark };
  }
  if (tone === 'unassigned' || tone === 'overdue') {
    return {
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
      borderStyle: tone === 'unassigned' ? 'dashed' : 'solid',
    };
  }
  return { backgroundColor: colors.bg };
}

/** A status, or a flag such as «Новое сообщение», as a pill in its tone. */
export function Badge({ label, tone, left, testID }: BadgeProps) {
  const theme = useTheme();
  const colors = theme.tone[tone];
  const box = useMemo(() => chipBox(tone, colors), [tone, colors]);
  const ink = tone === 'unread' ? (colors.onMark ?? colors.fg) : colors.fg;

  return (
    <View testID={testID} style={[styles.chip, box]}>
      {left}
      <Text variant="chip" color={ink}>
        {label}
      </Text>
    </View>
  );
}

/** Sizes only: the colours are the tone's. */
const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
});
