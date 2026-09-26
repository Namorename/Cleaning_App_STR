import type { ErrorBoundaryProps } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { ListAction } from '@/components/list-action';
import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { forgetSavedQueries } from '@/lib/query-client';

/** The raw words shown under the sentence are for passing on, not for reading. */
const DETAIL_LINES = 3;

/**
 * What a screen draws instead of closing the app when drawing it throws.
 *
 * Without a boundary, a render error in a release build reaches the global
 * handler and expo-updates' error recovery tears React down: the app simply
 * closes and nobody can say why (the chat screen did that on 2026-09-24).
 * Here the cleaner reads one sentence in her language and can try again; the
 * error's own English words stay small underneath, for her to pass on.
 *
 * Routes export it as `ErrorBoundary`; the root exports `RootRouteError`. The
 * root's boundary draws outside every provider, so this reads nothing but the
 * translations and the colour scheme.
 */
export function RouteError({ error, retry }: ErrorBoundaryProps) {
  return <ErrorScreen error={error} retry={retry} />;
}

interface ErrorScreenProps extends ErrorBoundaryProps {
  /** Only the root has it: drop the saved lists, then draw again. */
  onResetSaved?: () => void;
}

function ErrorScreen({ error, retry, onResetSaved }: ErrorScreenProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const detail = describe(error);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.message} accessibilityRole="alert">
        {t('common.screenFailed')}
      </Text>
      {detail !== '' ? (
        <Text style={styles.detail} numberOfLines={DETAIL_LINES}>
          {detail}
        </Text>
      ) : null}
      <ListAction label={t('common.retry')} onPress={() => void retry()} />
      {onResetSaved !== undefined ? (
        <>
          <ListAction label={t('common.resetSaved')} onPress={onResetSaved} />
          <Text style={styles.detail}>{t('common.resetSavedHint')}</Text>
        </>
      ) : null}
    </ScrollView>
  );
}

/** JavaScript lets anything be thrown; the boundary must not throw on reading it. */
function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim();
}

let hasAppDrawn = false;

/** Called once the root layout has committed: from then on the root catches. */
export function markAppDrawn(): void {
  hasAppDrawn = true;
}

/**
 * The root's boundary. Until the app has drawn once it lets the error through:
 * a build that cannot draw its first screen must still crash, because that is
 * what makes expo-updates roll a broken OTA back to the one before. Anything
 * later — a screen opened, a cache restored — is caught like on any route.
 *
 * A screen that fails on what the cache restored from disk fails again on
 * every retry, because the retry restores the same thing. So the root also
 * offers to drop the saved lists — only the lists: what she tapped without
 * signal stays queued (`forgetSavedQueries`) — and then draws the app from a
 * fresh start. Drawn again either way: if the lists could not be dropped and
 * were the cause, this screen simply comes back.
 */
export function RootRouteError(props: ErrorBoundaryProps) {
  if (!hasAppDrawn) {
    throw props.error;
  }
  const { retry } = props;
  const onResetSaved = () => {
    void forgetSavedQueries().then(retry, retry);
  };
  return <ErrorScreen {...props} onResetSaved={onResetSaved} />;
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    content: {
      flexGrow: 1,
      justifyContent: 'center',
      gap: Spacing.md,
      padding: Spacing.xl,
    },
    message: { color: theme.text, fontSize: FontSize.title, textAlign: 'center' },
    detail: { color: theme.textSecondary, fontSize: FontSize.caption, textAlign: 'center' },
  });
