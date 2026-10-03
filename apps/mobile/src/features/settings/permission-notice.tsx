import type { StatusKey } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import {
  FontSize,
  MIN_TOUCH_TARGET,
  Radius,
  Spacing,
  statusTone,
  type Theme,
} from '@/constants/theme';
import { usePushPermission } from '@/features/push/use-push-permission';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';

/**
 * What the phone itself lets through, above her switches (docs/f11-plan.md
 * §3.2). The switches stay: they decide what the server sends, this decides
 * whether the phone shows any of it. Nothing is drawn while the phone lets
 * everything through.
 *
 * - never asked: "Turn on" brings up the system question here and now;
 * - refused, or a question the phone did not show: the phone's settings;
 * - an Android channel switched off: named, with the same way to the settings;
 * - an iPhone delivering quietly: where they go, and where to change it.
 */
export function PermissionNotice() {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);
  const { state, offChannels, isRequesting, request } = usePushPermission();

  if (state === null || (state === 'granted' && offChannels.length === 0)) {
    return null;
  }

  const lines =
    state === 'granted'
      ? offChannels.map((channel) =>
          t('settings.notifications.permission.channelOff', {
            channel: t(`settings.notifications.channels.${channel}`),
          }),
        )
      : [t(`settings.notifications.permission.${NOTICE_KEY[state]}`)];
  const canAsk = state === 'ask';
  const actionLabel = canAsk
    ? t('settings.notifications.permission.enable')
    : t('settings.notifications.permission.openSettings');
  const onAction = canAsk ? request : () => void Linking.openSettings();
  // Off or never asked is urgent; an iPhone delivering quietly is only a fact.
  const tone = statusTone(
    theme,
    state === 'granted' ? 'phone.permission.channelOff' : NOTICE_STATUS[state],
  );

  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: tone.bg }]}>
      {lines.map((line) => (
        <Text key={line} style={[styles.text, { color: tone.fg }]}>
          {line}
        </Text>
      ))}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        accessibilityState={{ disabled: isRequesting, busy: isRequesting }}
        disabled={isRequesting}
        onPress={onAction}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        {isRequesting ? (
          <ActivityIndicator color={theme.primary} />
        ) : (
          <Text style={styles.actionText}>{actionLabel}</Text>
        )}
      </Pressable>
    </View>
  );
}

const NOTICE_KEY = {
  ask: 'notAsked',
  blocked: 'off',
  provisional: 'provisional',
} as const;

const NOTICE_STATUS = {
  ask: 'phone.permission.notAsked',
  blocked: 'phone.permission.off',
  provisional: 'phone.permission.provisional',
} as const satisfies Readonly<Record<keyof typeof NOTICE_KEY, StatusKey>>;

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    notice: {
      gap: Spacing.xs,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    text: { fontSize: FontSize.body },
    action: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
    actionText: { color: theme.primary, fontSize: FontSize.body, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
