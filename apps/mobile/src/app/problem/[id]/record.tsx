import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { LoadingState } from '@/components/loading-state';
import { useVideoSettings } from '@/features/host/use-host';
import type { CapturedMedia } from '@/features/media/capture';
import { videoLimits, type VideoLimits } from '@/features/media/schema';
import { addPick } from '@/features/problems/office-picks';
import { RecordScreen } from '@/features/video/record-screen';

// A screen that cannot draw says so, with «Повторить» and «Назад», and is reported.
export { RouteError as ErrorBoundary } from '@/components/route-error';

const Params = z.object({
  id: z.string().uuid(),
  // The office's video: recorded here, or chosen from the gallery.
  from: z.enum(['camera', 'gallery']).optional(),
});

/**
 * A video the office adds to a task (20261126100000): the recording screen of a step's video,
 * under the company's numbers, and what it keeps goes to the files picked for the task
 * (features/problems/office-picks.ts) — not to the upload queue: the files of the office go
 * together, when the manager adds them.
 */
export default function OfficeRecordRoute() {
  const { t } = useTranslation();
  const parsed = Params.safeParse(useLocalSearchParams());
  const settings = useVideoSettings();
  // The numbers the camera opened with; a refetch under it does not change them.
  const [limits, setLimits] = useState<VideoLimits | null>(null);
  if (limits === null && settings !== null) {
    setLimits(videoLimits(settings));
  }

  const goBack = () => {
    if (router.canGoBack()) {
      router.back();
    }
  };

  if (!parsed.success || limits === null) {
    return <LoadingState label={t('video.starting')} />;
  }

  const problemId = parsed.data.id;
  const send = async (captured: CapturedMedia) => {
    addPick(problemId, captured);
  };

  return (
    <RecordScreen
      limits={limits}
      source={parsed.data.from ?? 'camera'}
      onSend={send}
      onDone={goBack}
    />
  );
}
