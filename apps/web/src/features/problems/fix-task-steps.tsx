'use client';

import { STATUS_TONE } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { DetailSection } from '@/components/detail-section';
import { Person } from '@/components/person';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { formatDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import type { FixTaskSteps as FixTaskStepsData } from './api';
import { stepTitle } from './format';
import { ProblemPhotos } from './problem-photos';
import { stepState, type FixTask } from './schema';
import { useFixTaskSteps } from './use-problems';

interface FixTaskStepsProps {
  taskId: string;
}

/** The live attempt's steps, with what the technician photographed or filmed on each. */
export function FixTaskSteps({ taskId }: FixTaskStepsProps) {
  const { t } = useTranslation();
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
  return <StepList data={data} />;
}

interface PastFixWorkProps {
  fixTask: FixTask;
}

/**
 * An attempt that is over — done, cancelled or expired — with its steps and the technician's
 * photos and videos on them, under who, which day and how it ended. Nothing for one that never
 * started: it has no steps to show.
 */
export function PastFixWork({ fixTask }: PastFixWorkProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const { data, isPending, isError, error } = useFixTaskSteps(fixTask.id);

  if (isPending || (!isError && data.steps.length === 0)) {
    return null;
  }
  return (
    <DetailSection title={t('panel.problems.detail.steps')}>
      <p
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground"
        data-testid="past-fix-work"
      >
        <Person
          name={fixTask.assignee?.full_name}
          role={fixTask.assignee?.role}
          fallback={t('panel.problems.unknownPerson')}
          className="text-foreground"
        />
        <span aria-hidden="true">·</span>
        <span>{formatDay(fixTask.scheduled_date, language)}</span>
        <span aria-hidden="true">·</span>
        <span>{t(`panel.tasks.statuses.${fixTask.status}`)}</span>
      </p>
      {isError ? (
        <ErrorState message={t('panel.problems.loadError')} error={error} />
      ) : (
        <StepList data={data} />
      )}
    </DetailSection>
  );
}

/** The numbered steps, each with its state and its photos and videos. */
function StepList({ data }: { data: FixTaskStepsData }) {
  const { t } = useTranslation();
  const language = useLanguage();

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
              <ProblemPhotos media={media} emptyText={t('problems.noPhotos')} title={title} />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
