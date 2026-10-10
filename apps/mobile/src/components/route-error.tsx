import { router, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';

import { Spacing, type Theme } from '@/constants/theme';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { forgetSavedQueries } from '@/lib/query-client';
import { reportError } from '@/lib/sentry';

import { useScreenEdgePadding } from './bottom-inset';
import { Button } from './button';
import { Text } from './text';

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
 * translations and the colour scheme — its `Text` and `Button` find no fonts'
 * provider there and draw in the system font, which is always loaded.
 */
export function RouteError({ error, retry }: ErrorBoundaryProps) {
  // A screen that fails on every retry — a step, the recording screen — must
  // not leave her nowhere to go but closing the app (night of 2026-10-10).
  const onBack = router.canGoBack() ? () => router.back() : undefined;
  return <ErrorScreen error={error} retry={retry} onBack={onBack} />;
}

interface ErrorScreenProps extends ErrorBoundaryProps {
  /** Only the root has it: drop the saved lists, then draw again. */
  onResetSaved?: () => void;
  /** A screen opened over another: back to it. The root has nothing under it. */
  onBack?: () => void;
}

function ErrorScreen({ error, retry, onResetSaved, onBack }: ErrorScreenProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  // A screen's own boundary is drawn under the system's bar: at a large font
  // its buttons reach the bottom, and stop clear of it. The root's is drawn
  // above the SafeAreaProvider and knows no inset (bottom-inset.ts).
  const end = useScreenEdgePadding(Spacing.xl);
  const detail = describe(error);

  // A caught error never reaches the crash handler: this is its only way to
  // the report. Once per error, not per redraw.
  useEffect(() => reportError(error), [error]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, end]}
      accessibilityLiveRegion="polite"
    >
      <Text variant="title" align="center" accessibilityRole="alert">
        {t('common.screenFailed')}
      </Text>
      {detail !== '' ? (
        <Text
          variant="caption"
          tone="secondary"
          align="center"
          numberOfLines={DETAIL_LINES}
          selectable
        >
          {detail}
        </Text>
      ) : null}
      <Button label={t('common.retry')} onPress={() => void retry()} />
      {onBack !== undefined ? (
        <Button variant="outline" label={t('common.back')} onPress={onBack} />
      ) : null}
      {onResetSaved !== undefined ? (
        <>
          <Button variant="secondary" label={t('common.resetSaved')} onPress={onResetSaved} />
          <Text variant="caption" tone="secondary" align="center">
            {t('common.resetSavedHint')}
          </Text>
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
  });
