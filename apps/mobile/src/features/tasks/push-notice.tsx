import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { IconButton } from '@/components/icon-button';
import { Text } from '@/components/text';
import { Radius, Spacing, statusTone } from '@/constants/theme';
import type { PushNotice as Notice } from '@/features/push/destination';
import { useTheme } from '@/hooks/use-theme';
import { wordContext } from '@/i18n';

interface PushNoticeProps {
  notice: Notice;
  onDismiss: () => void;
}

/**
 * Why a tap on a push landed on her list rather than on the cleaning: it was
 * taken off her, cancelled, or moved away from her. Said once, in words, in
 * the urgent tone, and gone when she has read it: «Скрыть» is the close icon
 * on a 48 dp target, named in words for the reader.
 */
export function PushNotice({ notice, onDismiss }: PushNoticeProps) {
  const { t } = useTranslation();
  const tone = statusTone(useTheme(), 'phone.pushNotice');

  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: tone.bg }]}>
      <Text weight={700} color={tone.fg} style={styles.text}>
        {t(`tasks.pushNotice.${notice}`, { context: wordContext() })}
      </Text>
      <IconButton
        icon="action.close"
        accessibilityLabel={t('tasks.pushNotice.dismiss')}
        onPress={onDismiss}
      />
    </View>
  );
}

/** Sizes only: the colours are the tone's. */
const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
    borderRadius: Radius.lg,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
    paddingVertical: Spacing.xs,
  },
  text: { flex: 1 },
});
