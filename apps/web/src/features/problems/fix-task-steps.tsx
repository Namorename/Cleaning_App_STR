'use client';

import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/lib/use-language';

import { stepTitle } from './format';
import { ProblemPhotos } from './problem-photos';
import { stepState, type StepState } from './schema';
import { useFixTaskSteps } from './use-problems';

interface FixTaskStepsProps {
  taskId: string;
}

const STATE_VARIANT: Record<StepState, 'default' | 'secondary' | 'outline'> = {
  done: 'default',
  waived: 'secondary',
  skipped: 'secondary',
  pending: 'outline',
};

/** The technician's steps, with what she photographed on each. */
export function FixTaskSteps({ taskId }: FixTaskStepsProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { data, isPending, isError } = useFixTaskSteps(taskId);

  if (isPending) {
    return <p className="text-sm text-muted-foreground">{t('panel.problems.loading')}</p>;
  }
  if (isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('panel.problems.loadError')}
      </p>
    );
  }
  if (data.steps.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('panel.problems.detail.noSteps')}</p>;
  }

  return (
    <ol className="flex flex-col gap-3">
      {data.steps.map((step, index) => {
        const state = stepState(step);
        const title = stepTitle(step, language) ?? t(`steps.types.${step.type}`);
        const photos = data.photosByStep[step.id] ?? [];
        return (
          <li key={step.id} className="flex flex-col gap-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">
                {index + 1}. {title}
              </span>
              <Badge variant={STATE_VARIANT[state]}>{t(`steps.state.${state}`)}</Badge>
            </div>
            {photos.length > 0 ? (
              <ProblemPhotos photos={photos} emptyText={t('problems.noPhotos')} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
