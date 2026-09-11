import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { FontSize, Spacing, type Theme } from '@/constants/theme';
import { useSession } from '@/features/auth/session';
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
import { ProblemDetail } from '@/features/problems/problem-detail';
import { canEditProblem, ownFixTaskId } from '@/features/problems/schema';
import { useProblem } from '@/features/problems/use-problems';
import { useThemedStyles } from '@/hooks/use-themed-styles';
import { serverErrorText } from '@/lib/server-error';

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
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={styles.message.color} />
        <Text style={styles.message}>{t('problems.loading')}</Text>
      </View>
    );
  }

  if (problem.error) {
    const failure = serverErrorText(problem.error);
    return <Message text={failure.text} detail={failure.detail} styles={styles} />;
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

  return (
    <>
      <Stack.Screen options={{ title: t('problems.one') }} />
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
        error={attach.error ?? removeMedia.error}
        notice={notice}
      />
    </>
  );
}

interface MessageProps {
  text: string;
  detail?: string | null;
  styles: ReturnType<typeof createStyles>;
}

function Message({ text, detail = null, styles }: MessageProps) {
  return (
    <View style={styles.centered}>
      <Text style={styles.message}>{text}</Text>
      {detail !== null ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const createStyles = (theme: Theme) =>
  StyleSheet.create({
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.xl,
      gap: Spacing.sm,
      backgroundColor: theme.background,
    },
    message: { color: theme.textSecondary, fontSize: FontSize.body, textAlign: 'center' },
    detail: { color: theme.textSecondary, fontSize: FontSize.caption, textAlign: 'center' },
  });
