import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';

import { useScreenEdgePadding } from '@/components/bottom-inset';
import { Button } from '@/components/button';
import { FailureText } from '@/components/failure-text';
import { LoadingState } from '@/components/loading-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { pickVideoFromGallery, type PickedVideo } from '@/features/media/capture';
import { discardFile } from '@/features/media/file';
import type { VideoLimits } from '@/features/media/schema';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { noteStep, reportError } from '@/lib/sentry';

import { galleryVideoRefusal, type GalleryRefusal } from './gallery-video';

export interface GalleryPhaseProps {
  limits: VideoLimits;
  /** A video that may go: on to the same preview as a recording. */
  onPicked: (video: PickedVideo) => void;
  /** She backed out of the gallery, or chose to go back. */
  onLeave: () => void;
}

type State =
  | { kind: 'picking' }
  | { kind: 'refused'; refusal: GalleryRefusal }
  | { kind: 'failed'; error: unknown };

/**
 * A video step's video chosen from the gallery, where the company allows the
 * gallery (night of 2026-10-10, block 6) — in place of the camera.
 *
 * The gallery opens at once. What it hands over is held to the step before
 * anything is registered (`galleryVideoRefusal`): a refusal says, in her
 * words, the number to meet, lets the copy go and offers another choice or
 * the way back. Backing out of the gallery goes back to the step. Nothing of
 * the camera is asked for on this way in.
 */
export function GalleryPhase({ limits, onPicked, onLeave }: GalleryPhaseProps) {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  // The way back clears the system's bar (components/bottom-inset.ts).
  const edge = useScreenEdgePadding(Spacing.xl);
  const [state, setState] = useState<State>({ kind: 'picking' });
  const [attempt, setAttempt] = useState(0);
  // What the answer is handed to: the latest, without opening the gallery again.
  const latest = useRef({ limits, onPicked, onLeave });
  useEffect(() => {
    latest.current = { limits, onPicked, onLeave };
  });

  useEffect(() => {
    let isCurrent = true;
    pickVideoFromGallery().then(
      (video) => {
        if (!isCurrent) {
          // The screen went while the gallery was open: the copy is nobody's.
          if (video !== null) {
            discardFile(video.uri);
          }
          return;
        }
        if (video === null) {
          latest.current.onLeave();
          return;
        }
        const refusal = galleryVideoRefusal(video, latest.current.limits);
        if (refusal === null) {
          latest.current.onPicked(video);
          return;
        }
        discardFile(video.uri);
        noteStep('video.gallery', 'refused', { reason: refusal.key });
        setState({ kind: 'refused', refusal });
      },
      (error: unknown) => {
        if (isCurrent) {
          reportError(error);
          setState({ kind: 'failed', error });
        }
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [attempt]);

  if (state.kind === 'picking') {
    return <LoadingState label={t('video.openingGallery')} />;
  }

  const again = () => {
    setState({ kind: 'picking' });
    setAttempt((count) => count + 1);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[layout.content, edge]}>
      {state.kind === 'refused' ? (
        <Text accessibilityRole="alert" align="center">
          {t(state.refusal.key, { limit: state.refusal.limit })}
        </Text>
      ) : isLibraryDenied(state.error) ? (
        <Text accessibilityRole="alert" align="center">
          {t('steps.galleryDenied')}
        </Text>
      ) : (
        <FailureText error={state.error} />
      )}
      <Button label={t('video.pickAnother')} onPress={again} />
      <Button variant="outline" label={t('common.back')} onPress={onLeave} />
    </ScrollView>
  );
}

/** The phone would not let the app into the gallery (`MediaLibraryDeniedError`). */
function isLibraryDenied(error: unknown): boolean {
  return error instanceof Error && error.name === 'MediaLibraryDeniedError';
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
  });
