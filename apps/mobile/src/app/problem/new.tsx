import { randomUUID } from 'expo-crypto';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { CameraDeniedError, capturePhoto } from '@/features/media/capture';
import { discardFile } from '@/features/media/file';
import { toLocalRecord, type LocalMediaRecord } from '@/features/media/local-store';
import type { StripItem } from '@/features/media/media-strip';
import { useRememberLocalMedia } from '@/features/media/use-media';
import { ProblemForm } from '@/features/problems/problem-form';
import { EMPTY_PROBLEM_DRAFT, MAX_PROBLEM_PHOTOS } from '@/features/problems/schema';
import { useReportProblem } from '@/features/problems/use-problems';
import { propertyName } from '@/features/tasks/format';
import { useTask } from '@/features/tasks/use-tasks';

const Params = z.object({
  taskId: z.string().uuid().optional(),
  propertyId: z.coerce.number().int().positive().optional(),
});

/**
 * Reporting a problem, from a task or from the list.
 *
 * The id is minted here, before anything is sent: the report and its
 * photos replay under it after a lost connection without duplicates. Photos
 * are kept on the phone until the report goes; the moment it is queued she
 * is taken to the report's own screen, where the uploads show their progress.
 */
export default function NewProblemRoute() {
  const { t } = useTranslation();
  const parsed = Params.safeParse(useLocalSearchParams());
  const taskId = parsed.success ? (parsed.data.taskId ?? null) : null;
  const propertyId = parsed.success ? (parsed.data.propertyId ?? null) : null;

  const [problemId] = useState(() => randomUUID());
  const [draft, setDraft] = useState(EMPTY_PROBLEM_DRAFT);
  const [photos, setPhotos] = useState<LocalMediaRecord[]>([]);
  const [isCapturing, setCapturing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const task = useTask(taskId ?? '');
  const report = useReportProblem();
  const rememberLocal = useRememberLocalMedia();

  const isLeaving = report.isSuccess || report.isPaused;
  useEffect(() => {
    if (isLeaving) {
      router.replace({ pathname: '/problem/[id]', params: { id: problemId } });
    }
  }, [isLeaving, problemId]);

  const items = useMemo<StripItem[]>(
    () => photos.map((photo) => ({ id: photo.id, uri: photo.uri, status: 'local' })),
    [photos],
  );

  const onCapture = async () => {
    if (isCapturing || photos.length >= MAX_PROBLEM_PHOTOS) {
      return;
    }
    setCapturing(true);
    setNotice(null);
    try {
      const captured = await capturePhoto();
      if (captured === null) {
        return;
      }
      const record = toLocalRecord(captured);
      await rememberLocal(record);
      setPhotos((current) => [...current, record]);
    } catch (error: unknown) {
      setNotice(
        error instanceof CameraDeniedError ? t('steps.cameraDenied') : t('steps.captureFailed'),
      );
    } finally {
      setCapturing(false);
    }
  };

  const onRemovePhoto = (mediaId: string) => {
    const photo = photos.find((item) => item.id === mediaId);
    if (photo !== undefined) {
      discardFile(photo.uri);
    }
    setPhotos((current) => current.filter((item) => item.id !== mediaId));
  };

  const onSubmit = () => {
    report.mutate({
      problemId,
      title: draft.title.trim(),
      description: draft.description.trim(),
      priority: draft.priority,
      taskId,
      propertyId: taskId === null ? propertyId : null,
      photos,
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: t('problems.new') }} />
      <ProblemForm
        draft={draft}
        onChange={setDraft}
        place={task.data ? propertyName(task.data) : null}
        photos={items}
        onCapture={() => void onCapture()}
        onRemovePhoto={onRemovePhoto}
        isCapturing={isCapturing}
        isSubmitting={report.isPending && !report.isPaused}
        submitLabel={t('problems.submit')}
        onSubmit={onSubmit}
        error={report.error}
        notice={notice}
      />
    </>
  );
}
