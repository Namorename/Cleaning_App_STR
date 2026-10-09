'use client';

import { STATUS_TONE } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/lib/use-language';

import { stepTitle } from './format';
import { ProblemPhotos } from './problem-photos';
import { stepState } from './schema';
import { useFixTaskSteps } from './use-problems';

interface FixTaskStepsProps {
  taskId: string;
}

/** The technician's steps, with what she photographed or filmed on each. */
export function FixTaskSteps({ taskId }: FixTaskStepsProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { data, isPending, isError, error } = useFixTaskSteps(taskId);

  if (isPending) {
    return <LoadingState>{t('panel.problems.loading')}</LoadingState>;
  }
  if (isError) {
    return <ErrorState message={t('panel.problems.loadError')} error={error} />;
  }
  if (data.steps.length === 0) {
    return <EmptyState>{t('panel.problems.detail.noSteps')}</EmptyState>;
  }

  return (
    <ol className="flex flex-col gap-3">
      {data.steps.map((step, index) => {
        const state = stepState(step);
        const title = stepTitle(step, language) ?? t(`steps.types.${step.type}`);
        const media = data.mediaByStep[step.id] ?? [];
        return (
          <li key={step.id} className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {index + 1}. {title}
              </span>
              <Badge tone={STATUS_TONE[`steps.${state}`]}>{t(`steps.state.${state}`)}</Badge>
            </div>
            {media.length > 0 ? (
              <ProblemPhotos photos={media} emptyText={t('problems.noPhotos')} videoLabel={title} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
