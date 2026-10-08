import { statusIcon, type StatusKey } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { Button } from '@/components/button';
import { Icon } from '@/components/icon';
import { Text } from '@/components/text';
import { Radius, Spacing, statusTone } from '@/constants/theme';
import { usePushPermission } from '@/features/push/use-push-permission';
import { useTheme } from '@/hooks/use-theme';

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
  const status: StatusKey =
    state === 'granted' ? 'phone.permission.channelOff' : NOTICE_STATUS[state];
  const tone = statusTone(theme, status);
  // Colour is never the only cue: the urgent notice carries its tone's glyph.
  const glyph = statusIcon(status);

  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: tone.bg }]}>
      <View style={styles.message}>
        {glyph !== null ? <Icon name={glyph} color={tone.fg} /> : null}
        <View style={styles.lines}>
          {lines.map((line) => (
            <Text key={line} color={tone.fg}>
              {line}
            </Text>
          ))}
        </View>
      </View>
      <Button variant="secondary" label={actionLabel} onPress={onAction} isBusy={isRequesting} />
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

/** Sizes only: the colours are the tone's. */
const styles = StyleSheet.create({
  notice: {
    gap: Spacing.sm,
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  message: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  lines: { flex: 1, gap: Spacing.xs },
});
