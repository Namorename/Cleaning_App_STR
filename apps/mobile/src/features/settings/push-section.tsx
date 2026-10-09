import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Switch, View } from 'react-native';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { MIN_TOUCH_TARGET, Spacing, type Theme } from '@/constants/theme';
import { roleOf } from '@/features/auth/role';
import { useSession } from '@/features/auth/session';
import { useTheme } from '@/hooks/use-theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { wordContext } from '@/i18n';
import { serverErrorText, type ServerErrorText } from '@/lib/server-error';

import { PermissionNotice } from './permission-notice';
import { isPushEnabled, kindsFor, type PushKind, type PushPreferences } from './schema';
import { FailureNote, SettingsSection, failureOf } from './section';
import { usePushPreferences, useSetPushPreference } from './use-settings';

/**
 * One switch per event that sends a push, all on until she turns one off.
 *
 * The choice lives on the server and is checked when a push is sent, so a
 * switch turned off also stops what is already waiting in the queue. What the
 * phone itself allows — the system permission, Android's channels — is a
 * layer of its own, said above the switches (docs/f11-plan.md §3.2).
 *
 * Only the kinds her role can receive are offered (`kindsFor`): a new task
 * goes to the head technician alone, and nobody else sees its switch; a
 * technician gets no switch for a cleaning, and reads the others as work.
 */
export function PushSection() {
  const { t } = useTranslation();
  const { userId, session } = useSession();
  const kinds = kindsFor(roleOf(session?.user ?? null));
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
      <PermissionNotice />
      {preferences.data !== undefined ? (
        <PushSwitches kinds={kinds} preferences={preferences.data} onChange={onChange} />
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
  /** The kinds offered to her, in the order they are listed. */
  kinds: readonly PushKind[];
  preferences: PushPreferences | null;
  onChange: (kind: PushKind, enabled: boolean) => void;
}

function PushSwitches({ kinds, preferences, onChange }: PushSwitchesProps) {
  const { t } = useTranslation();

  return (
    <View>
      {kinds.map((kind) => (
        <PushRow
          key={kind}
          kind={kind}
          label={t(`settings.notifications.kinds.${kind}`, { context: wordContext() })}
          isOn={isPushEnabled(preferences, kind)}
          onChange={onChange}
        />
      ))}
    </View>
  );
}

interface PushRowProps {
  kind: PushKind;
  label: string;
  isOn: boolean;
  onChange: (kind: PushKind, enabled: boolean) => void;
}

/**
 * One kind: the whole row, at least 48 dp, is the switch — for a finger
 * anywhere on its words and for a screen reader, which hears the words, the
 * role and the state once. The system switch in it is only its picture for the
 * reader, and still answers a tap of its own: it claims its touch, so the row
 * does not toggle a second time.
 */
function PushRow({ kind, label, isOn, onChange }: PushRowProps) {
  const theme = useTheme();
  const styles = useThemedStyles(createStyles);

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: isOn }}
      onPress={() => onChange(kind, !isOn)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text style={layout.label}>{label}</Text>
      <Switch
        testID={`push-switch-${kind}`}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        value={isOn}
        onValueChange={(enabled) => onChange(kind, enabled)}
        trackColor={{ true: theme.primary }}
      />
    </Pressable>
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

  if (failure === null) {
    return <Text tone="secondary">{t('settings.notifications.loading')}</Text>;
  }
  return (
    <View style={layout.failed}>
      <FailureNote failure={{ ...failure, text: t('settings.notifications.loadFailed') }} />
      <Button variant="secondary" label={t('common.retry')} onPress={onRetry} />
    </View>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  label: { flex: 1 },
  failed: { gap: Spacing.sm },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    row: {
      minHeight: MIN_TOUCH_TARGET,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.xs,
    },
    pressed: { backgroundColor: theme.surfaceAlt },
  });
