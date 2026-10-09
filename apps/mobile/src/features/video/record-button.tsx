import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { Radius, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

/** Bigger than the 56 dp main button: the one thing on this screen to press. */
export const RECORD_BUTTON_SIZE = 72;
const RING_WIDTH = 4;
const DOT_SIZE = 56;
const SQUARE_SIZE = 28;
const SQUARE_RADIUS = 6;

interface RecordButtonProps {
  isRecording: boolean;
  isDisabled: boolean;
  onPress: () => void;
}

/**
 * The camera's own button: a round dot to start, a square to stop, the word
 * under it. The shape changes with the state as well as the word, so neither
 * colour nor reading is needed to tell them apart.
 */
export function RecordButton({ isRecording, isDisabled, onPress }: RecordButtonProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const label = isRecording ? t('video.stop') : t('video.record');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled }}
      disabled={isDisabled}
      onPress={onPress}
      style={layout.target}
    >
      <View style={[styles.ring, isDisabled && styles.ringDisabled]}>
        <View
          style={[
            isRecording ? layout.square : layout.dot,
            isDisabled ? styles.markDisabled : styles.mark,
          ]}
        />
      </View>
      <Text variant="button" tone={isDisabled ? 'muted' : 'default'} align="center">
        {label}
      </Text>
    </Pressable>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  target: {
    minWidth: RECORD_BUTTON_SIZE,
    minHeight: RECORD_BUTTON_SIZE,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  dot: { width: DOT_SIZE, height: DOT_SIZE, borderRadius: Radius.pill },
  square: { width: SQUARE_SIZE, height: SQUARE_SIZE, borderRadius: SQUARE_RADIUS },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    ring: {
      width: RECORD_BUTTON_SIZE,
      height: RECORD_BUTTON_SIZE,
      borderRadius: Radius.pill,
      borderWidth: RING_WIDTH,
      borderColor: theme.text,
      alignItems: 'center',
      justifyContent: 'center',
    },
    ringDisabled: { borderColor: theme.textMuted },
    mark: { backgroundColor: theme.danger },
    markDisabled: { backgroundColor: theme.surfaceAlt },
  });
