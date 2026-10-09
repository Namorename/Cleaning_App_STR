import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet } from 'react-native';

import { Button } from '@/components/button';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { reportError } from '@/lib/sentry';

import type { RecordingPermission } from './use-recording-permissions';

interface PermissionScreenProps {
  /** What the phone refused: the camera, the microphone, or both. */
  missing: readonly RecordingPermission[];
  /** The phone still shows its question for everything missing. */
  canAsk: boolean;
  onAsk: () => void;
}

/** The title for what is missing: «Нет доступа к камере», to the microphone, or to both. */
function titleKey(missing: readonly RecordingPermission[]): string {
  if (missing.length > 1) {
    return 'video.permission.bothTitle';
  }
  return missing[0] === 'microphone'
    ? 'video.permission.microphoneTitle'
    : 'video.permission.cameraTitle';
}

/**
 * A recording the phone does not allow, said plainly: which of the two is
 * missing, why a video needs it, and the one way past. While the phone still
 * asks, its question comes back with «Разрешить доступ»; once it has stopped
 * asking, only its settings can change the answer.
 */
export function PermissionScreen({ missing, canAsk, onAsk }: PermissionScreenProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={layout.content}>
      <Text variant="title" align="center" accessibilityRole="alert">
        {t(titleKey(missing))}
      </Text>
      <Text tone="secondary" align="center">
        {t('video.permission.why')}
      </Text>
      {canAsk ? (
        <Button label={t('video.permission.allow')} onPress={onAsk} />
      ) : (
        <Text align="center">{t('video.permission.inSettings')}</Text>
      )}
      <Button
        variant={canAsk ? 'outline' : 'primary'}
        label={t('video.permission.openSettings')}
        onPress={() => {
          Linking.openSettings().catch(reportError);
        }}
      />
    </ScrollView>
  );
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
  },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
  });
