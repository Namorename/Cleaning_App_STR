import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import { z } from 'zod';

import { ErrorState } from '@/components/error-state';
import { Text } from '@/components/text';
import { Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
import { useRole } from '@/features/auth/use-role';
import { ProblemDispatch } from '@/features/board/problem-dispatch';
import { capturePhoto, pickPhotoFromGallery } from '@/features/media/capture';
import { attachFailure } from '@/features/media/failure';
import { useGalleryAllowed } from '@/features/host/use-host';
import { toLocalRecord, type LocalMediaRecord } from '@/features/media/local-store';
import { mediaOfProblem } from '@/features/media/schema';
import {
  mediaItemViews,
  useAttachMedia,
  useLocalMedia,
  useMediaUrls,
  useProblemMedia,
  useRememberLocalMedia,
  useRemoveMedia,
  useUploadingMediaIds,
} from '@/features/media/use-media';
import { ProblemDetail, ProblemDetailSkeleton } from '@/features/problems/problem-detail';
import { canEditProblem, ownFixTaskId } from '@/features/problems/schema';
import { useProblem } from '@/features/problems/use-problems';
import { useThemedStyles } from '@/hooks/use-themed-styles';

const Params = z.object({ id: z.string().uuid() });

/**
 * One report. Thin: params in, hooks wired, the screen itself is ProblemDetail.
 *
 * The camera and the upload queue are wired the same way as on a media step:
 * a capture is remembered on the phone first, then handed to the queue, which
 * registers, uploads and confirms it whenever there is signal.
 */
export default function ProblemRoute() {
  const { t } = useTranslation();
  const styles = useThemedStyles(createStyles);
  const { userId } = useSession();
  // Hands the task out and takes the person off — the head technician's alone
  // (docs/tech-plan.md §3.3); what he may do the server decides again.
  const isDispatcher = useRole() === 'head_tech';
  const parsed = Params.safeParse(useLocalSearchParams());
  const problemId = parsed.success ? parsed.data.id : '';

  const problem = useProblem(problemId);
  const media = useProblemMedia(problemId);
  const attach = useAttachMedia();
  const removeMedia = useRemoveMedia();
  const rememberLocal = useRememberLocalMedia();
  const local = useLocalMedia();
  const uploading = useUploadingMediaIds();
  const galleryAllowed = useGalleryAllowed();
  const [isCapturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const photos = useMemo(
    () => mediaOfProblem(media.data ?? [], problemId),
    [media.data, problemId],
  );
  const remotePaths = useMemo(
    () =>
      photos
        .filter((item) => item.uploaded_at !== null && local.data?.[item.id] === undefined)
        .map((item) => item.storage_path),
    [photos, local.data],
  );
  const urls = useMediaUrls(remotePaths);
  const items = useMemo(
    () => mediaItemViews(photos, local.data ?? {}, urls.data ?? {}, uploading),
    [photos, local.data, urls.data, uploading],
  );

  if (!parsed.success || userId === null) {
    return <Message text={t('problems.notFound')} styles={styles} />;
  }

  if (problem.isPending) {
    return <ProblemDetailSkeleton label={t('problems.loading')} />;
  }

  // A report that never loaded. One that did and only failed to refresh
  // (TanStack keeps the data beside the error) stays on screen below. There
  // is no «could not load the report» of its own: the general sentence.
  if (problem.error && problem.data === undefined) {
    return (
      <View style={styles.screen}>
        <ErrorState
          error={problem.error}
          title={t('common.screenFailed')}
          onRetry={() => void problem.refetch()}
        />
      </View>
    );
  }

  if (problem.data === null || problem.data === undefined) {
    return <Message text={t('problems.notFound')} styles={styles} />;
  }

  const startUpload = (record: LocalMediaRecord) => {
    attach.mutate({
      problemId,
      uri: record.uri,
      mediaId: record.id,
      kind: record.kind,
      mimeType: record.mimeType,
      byteSize: record.byteSize,
      width: record.width,
      height: record.height,
      durationSec: record.durationSec,
      takenAt: record.takenAt,
      source: record.source,
    });
  };

  const attachFrom = async (source: 'camera' | 'gallery') => {
    if (isCapturing) {
      return;
    }
    setCapturing(true);
    setNotice(null);
    try {
      const captured =
        source === 'gallery' ? await pickPhotoFromGallery() : await capturePhoto();
      if (captured === null) {
        return;
      }
      const record = toLocalRecord(captured);
      await rememberLocal(record);
      startUpload(record);
    } catch (error: unknown) {
      setNotice(attachFailure(error, t));
    } finally {
      setCapturing(false);
    }
  };

  const onRetryPhoto = (mediaId: string) => {
    const record = local.data?.[mediaId];
    if (record !== undefined) {
      startUpload(record);
    }
  };

  // The header and its title are the root layout's (app/_layout.tsx).
  return (
    <ProblemDetail
      problem={problem.data}
      photos={items}
      canEdit={canEditProblem(problem.data, userId)}
      onEdit={() => router.push({ pathname: '/problem/[id]/edit', params: { id: problemId } })}
      onCapture={() => void attachFrom('camera')}
      onPickFromGallery={galleryAllowed ? () => void attachFrom('gallery') : undefined}
      onRemovePhoto={(mediaId) => removeMedia.mutate({ problemId, mediaId })}
      onRetryPhoto={onRetryPhoto}
      isCapturing={isCapturing}
      fixTaskId={ownFixTaskId(problem.data, userId)}
      onOpenFixTask={(taskId) => router.push({ pathname: '/task/[id]', params: { id: taskId } })}
      onOpenChat={() =>
        router.push({
          pathname: '/chat/[subject]/[id]',
          params: { subject: 'problem', id: problemId },
        })
      }
      error={attach.error ?? removeMedia.error}
      notice={notice}
      refreshError={problem.error}
      dispatch={isDispatcher ? <ProblemDispatch problemId={problemId} /> : undefined}
    />
  );
}

interface MessageProps {
  text: string;
  styles: ReturnType<typeof createStyles>;
}

function Message({ text, styles }: MessageProps) {
  return (
    <View style={[styles.screen, styles.centered]}>
      <Text tone="secondary" align="center">
        {text}
      </Text>
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    centered: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
    },
  });
