import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  FontSize,
  MIN_TOUCH_TARGET,
  Radius,
  Spacing,
  statusTone,
  type Theme,
} from '@/constants/theme';
import type { PushNotice as Notice } from '@/features/push/destination';
import { useThemedStyles } from '@/hooks/use-themed-styles';

interface PushNoticeProps {
  notice: Notice;
  onDismiss: () => void;
}

/**
 * Why a tap on a push landed on her list rather than on the cleaning: it was
 * taken off her, cancelled, or moved away from her. Said once, in words, and
 * gone when she has read it.
 */
export function PushNotice({ notice, onDismiss }: PushNoticeProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  return (
    <View accessibilityLiveRegion="polite" style={styles.notice}>
      <Text style={styles.text}>{t(`tasks.pushNotice.${notice}`)}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('tasks.pushNotice.dismiss')}
        onPress={onDismiss}
        hitSlop={Spacing.sm}
        style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
      >
        <Text style={styles.dismissText}>{t('tasks.pushNotice.dismiss')}</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      marginBottom: Spacing.md,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      backgroundColor: statusTone(theme, 'phone.pushNotice').bg,
    },
    text: {
      flex: 1,
      color: statusTone(theme, 'phone.pushNotice').fg,
      fontSize: FontSize.body,
      fontWeight: '600',
    },
    dismiss: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center' },
    dismissText: { color: theme.primary, fontSize: FontSize.body, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
