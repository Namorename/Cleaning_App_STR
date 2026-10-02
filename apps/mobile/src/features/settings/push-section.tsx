import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { FontSize, MIN_TOUCH_TARGET, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText, type ServerErrorText } from '@/lib/server-error';

import { PUSH_KINDS, isPushEnabled, type PushKind, type PushPreferences } from './schema';
import { FailureNote, SettingsSection, failureOf } from './section';
import { usePushPreferences, useSetPushPreference } from './use-settings';

/**
 * One switch per event that sends a push, all on until she turns one off.
 *
 * The choice lives on the server and is checked when a push is sent, so a
 * switch turned off also stops what is already waiting in the queue. What the
 * phone itself allows — the system permission, Android's channels — is a
 * layer of its own, shown by the native build (docs/f11-plan.md §3.2).
 */
export function PushSection() {
  const { t } = useTranslation();
  const { userId } = useSession();
  const preferences = usePushPreferences();
  const choose = useSetPushPreference();

  const onChange = (kind: PushKind, enabled: boolean) => {
    if (userId !== null) {
      choose.mutate({ userId, kind, enabled });
    }
  };

  return (
    <SettingsSection
      title={t('settings.notifications.heading')}
      hint={t('settings.notifications.hint')}
    >
      {preferences.data !== undefined ? (
        <PushSwitches preferences={preferences.data} onChange={onChange} />
      ) : (
        <PushLoading
          failure={preferences.isError ? serverErrorText(preferences.error) : null}
          onRetry={() => void preferences.refetch()}
        />
      )}
      {choose.isError ? (
        <FailureNote failure={failureOf(choose.error, 'settings.notifications.saveFailed')} />
      ) : null}
    </SettingsSection>
  );
}

interface PushSwitchesProps {
  preferences: PushPreferences | null;
  onChange: (kind: PushKind, enabled: boolean) => void;
}

function PushSwitches({ preferences, onChange }: PushSwitchesProps) {
  const { t } = useTranslation();
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <View>
      {PUSH_KINDS.map((kind) => {
        const label = t(`settings.notifications.kinds.${kind}`);
        return (
          <View key={kind} style={styles.row}>
            {/* The switch carries the same words; read once, not twice. */}
            <Text
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              style={styles.rowLabel}
            >
              {label}
            </Text>
            <Switch
              accessibilityLabel={label}
              value={isPushEnabled(preferences, kind)}
              onValueChange={(enabled) => onChange(kind, enabled)}
              trackColor={{ true: theme.primary }}
            />
          </View>
        );
      })}
    </View>
  );
}

interface PushLoadingProps {
  /** Why the first read failed; null while it is still on its way. */
  failure: ServerErrorText | null;
  onRetry: () => void;
}

/** Before her row has ever arrived: on its way, or failed with a way to ask again. */
function PushLoading({ failure, onRetry }: PushLoadingProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  if (failure === null) {
    return <Text style={styles.status}>{t('settings.notifications.loading')}</Text>;
  }
  return (
    <View style={styles.failed}>
      <FailureNote failure={{ ...failure, text: t('settings.notifications.loadFailed') }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.retry')}
        onPress={onRetry}
        style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
      >
        <Text style={styles.retryText}>{t('common.retry')}</Text>
      </Pressable>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      minHeight: MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
    },
    rowLabel: { flex: 1, color: theme.text, fontSize: FontSize.body },
    status: { color: theme.textSecondary, fontSize: FontSize.body },
    failed: { gap: Spacing.sm },
    retry: { minHeight: MIN_TOUCH_TARGET, justifyContent: 'center', alignSelf: 'flex-start' },
    retryText: { color: theme.primary, fontSize: FontSize.body, fontWeight: '600' },
    pressed: { opacity: 0.6 },
  });
