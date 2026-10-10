import { useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';

import { IconButton } from '@/components/icon-button';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

export interface RecordHeaderProps {
  title: string;
  /**
   * Back to the step, through the screen's guard: a recording not sent is
   * asked about first. None once the recording is sent — the screen is
   * already on its way, and a second back would go past the step.
   */
  onBack?: () => void;
}

/**
 * The header of a video step's camera, drawn by the screen itself.
 *
 * The system's header is hidden on this screen (`headerShown: false` in the
 * root layout). On Android, a header updated in the moment «Отправить» takes
 * the screen off the stack brought the app down: react-native-screens asks
 * the screen's stack whether to draw the back arrow and finds none (Sentry,
 * 2026-10-09 and 10-10: «ScreenStackFragment added into a non-stack
 * container»). A hidden header returns before that question; this one is
 * plain views, under the status bar's inset.
 */
export function RecordHeader({ title, onBack }: RecordHeaderProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const top = useContext(SafeAreaInsetsContext)?.top ?? 0;
  const inset = useMemo(() => ({ paddingTop: top }), [top]);

  return (
    <View style={[styles.bar, inset]}>
      {onBack === undefined ? null : (
        <IconButton icon="action.back" accessibilityLabel={t('common.back')} onPress={onBack} />
      )}
      <Text variant="title" accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {title}
      </Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.xs,
      backgroundColor: theme.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    title: { flex: 1, paddingHorizontal: Spacing.xs },
  });
