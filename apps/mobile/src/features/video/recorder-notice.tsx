import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/text';
import { Radius, Spacing, type Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

/** MB as the company counts them, 10^6 bytes (20261003170000_video_limits.sql). */
const BYTES_PER_MB = 1_000_000;

/**
 * Why the camera is waiting: too little room for a recording, or one the app
 * going away cut off before it was worth keeping.
 */
export type Trouble =
  { kind: 'lowSpace'; neededBytes: number; freeBytes: number } | { kind: 'cutShort' };

interface RecorderNoticeProps {
  trouble: Trouble;
}

/**
 * A recording that did not happen, said above the button that tries again.
 * In the urgent tone, as a refresh that failed is said over a list.
 */
export function RecorderNotice({ trouble }: RecorderNoticeProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const ink = theme.tone.urgent.fg;

  return (
    <View style={styles.notice} accessibilityLiveRegion="polite">
      {trouble.kind === 'lowSpace' ? (
        <>
          <Text accessibilityRole="alert" color={ink} weight={700}>
            {t('video.lowSpaceTitle')}
          </Text>
          <Text color={ink}>
            {t('video.lowSpace', {
              needed: Math.ceil(trouble.neededBytes / BYTES_PER_MB),
              free: Math.floor(trouble.freeBytes / BYTES_PER_MB),
            })}
          </Text>
        </>
      ) : (
        <Text accessibilityRole="alert" color={ink}>
          {t('video.cutShort')}
        </Text>
      )}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    notice: {
      alignSelf: 'stretch',
      gap: Spacing.xs,
      borderRadius: Radius.lg,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      backgroundColor: theme.tone.urgent.bg,
    },
  });
