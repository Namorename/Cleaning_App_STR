import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, ScrollView, StyleSheet } from 'react-native';

import { useScreenEdgePadding } from '@/components/bottom-inset';
import { Button } from '@/components/button';
import { FailureText } from '@/components/failure-text';
import { LoadingState } from '@/components/loading-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import {
  pickVideoFromGallery,
  type GalleryVideoForm,
  type PickedVideo,
} from '@/features/media/capture';
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
  | { kind: 'notCompressed' }
  | { kind: 'failed'; error: unknown };

/** A chosen video let go of, with the picker's copies of the same choice — those and nothing else. */
function letGo(video: PickedVideo): void {
  discardFile(video.uri);
  video.pickerCopies.forEach((copy) => discardFile(copy));
}

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
  // After an iPhone could not compress the chosen video, the next choice is
  // asked for as it is (owner's word of 2026-10-11, 00:40).
  const [form, setForm] = useState<GalleryVideoForm>('compressed');
  // What the answer is handed to: the latest, without opening the gallery again.
  const latest = useRef({ limits, onPicked, onLeave });
  useEffect(() => {
    latest.current = { limits, onPicked, onLeave };
  });

  useEffect(() => {
    let isCurrent = true;
    pickVideoFromGallery(form).then(
      (video) => {
        if (!isCurrent) {
          // The screen went while the gallery was open: the copies are nobody's.
          if (video !== null) {
            letGo(video);
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
        letGo(video);
        noteStep('video.gallery', 'refused', { reason: refusal.key });
        setState({ kind: 'refused', refusal });
      },
      (error: unknown) => {
        if (!isCurrent) {
          return;
        }
        if (isNotCompressed(error)) {
          setState({ kind: 'notCompressed' });
          return;
        }
        reportError(error);
        setState({ kind: 'failed', error });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [attempt, form]);

  if (state.kind === 'picking') {
    // An iPhone's gallery covers this screen while she chooses; it shows
    // again once she has chosen, while the picker compresses the video
    // (features/media/capture.ts) — as long as the video takes.
    const label = Platform.OS === 'ios' ? 'video.preparingGallery' : 'video.openingGallery';
    return <LoadingState label={t(label)} />;
  }

  const again = () => {
    setState({ kind: 'picking' });
    setAttempt((count) => count + 1);
  };

  if (state.kind === 'notCompressed') {
    const asOriginal = () => {
      setState({ kind: 'picking' });
      setForm('original');
      setAttempt((count) => count + 1);
    };
    return (
      <ScrollView style={styles.screen} contentContainerStyle={[layout.content, edge]}>
        <Text accessibilityRole="alert" align="center">
          {t('video.compressionFailed')}
        </Text>
        <Button label={t('steps.pickVideo')} onPress={asOriginal} />
        <Button variant="outline" label={t('common.back')} onPress={onLeave} />
      </ScrollView>
    );
  }

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

/** An iPhone could not compress the chosen video (`VideoNotCompressedError`). */
function isNotCompressed(error: unknown): boolean {
  return error instanceof Error && error.name === 'VideoNotCompressedError';
}

/** Sizes only: nothing here depends on the colour scheme. */
const layout = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: 'center', gap: Spacing.md, padding: Spacing.xl },
});

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
  });
