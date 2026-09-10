'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { formatDateTime } from '@/lib/format-date';
import { serverErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import { splitMinutes } from './format';
import { localizedTitle, taskMinutes, type Task } from './schema';
import { useSetDuration, useTaskProblems, useTaskWork } from './use-tasks';

interface TaskDrawerProps {
  /** The finished task being read. */
  task: Task;
  onClose: () => void;
}

type StepState = 'done' | 'skipped' | 'waived' | 'pending';

const STATE_VARIANT: Record<StepState, 'default' | 'secondary' | 'outline'> = {
  done: 'default',
  waived: 'secondary',
  skipped: 'secondary',
  pending: 'outline',
};

/** A day is the longest a correction can sensibly claim. */
const MAX_CORRECTION_MINUTES = 24 * 60;

function stepState(step: {
  completed_at: string | null;
  skipped_at: string | null;
  waived_at: string | null;
}): StepState {
  if (step.completed_at !== null) {
    return 'done';
  }
  if (step.waived_at !== null) {
    return 'waived';
  }
  if (step.skipped_at !== null) {
    return 'skipped';
  }
  return 'pending';
}

/**
 * What happened on a finished cleaning: the steps, the photos, the problems
 * it turned up, and how long it is counted as.
 *
 * The measurement itself is never rewritten (§13.3). A correction goes into
 * its own field and can be taken back, and the drawer shows both numbers so
 * the manager can see what was changed and by how much.
 */
export function TaskDrawer({ task, onClose }: TaskDrawerProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const work = useTaskWork(task.id);
  const problems = useTaskProblems(task.id);
  const setDuration = useSetDuration();
  const [correction, setCorrection] = useState(() =>
    task.duration_override_min === null ? '' : task.duration_override_min.toString(),
  );

  const title = localizedTitle(task, language) ?? t(`panel.tasks.types.${task.type}`);
  const counted = taskMinutes(task);
  const failure = setDuration.isError ? serverErrorText(setDuration.error) : null;
  const parsed = Number(correction);
  const isCorrectionValid =
    correction.trim() === '' ||
    (Number.isInteger(parsed) && parsed > 0 && parsed < MAX_CORRECTION_MINUTES);

  const duration = (minutes: number) => {
    const parts = splitMinutes(minutes);
    return parts.hours === 0
      ? t('panel.tasks.work.duration.m', { minutes: parts.minutes })
      : t('panel.tasks.work.duration.hm', parts);
  };
  const saveCorrection = () =>
    setDuration.mutate({
      taskId: task.id,
      minutes: correction.trim() === '' ? null : parsed,
    });

  return (
    <Sheet open onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent className="gap-4 overflow-y-auto p-4 sm:max-w-lg">
        <SheetHeader className="p-0">
          <SheetTitle>{t('panel.tasks.work.title')}</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-1">
          <span className="font-medium">{title}</span>
          <span className="text-muted-foreground">{task.property?.name ?? ''}</span>
          <span className="text-muted-foreground">{task.assignee?.full_name ?? ''}</span>
        </div>

        <div className="flex flex-col gap-1">
          {task.started_at === null ? null : (
            <span>
              {t('panel.tasks.work.started')}: {formatDateTime(task.started_at, language)}
            </span>
          )}
          {task.completed_at === null ? null : (
            <span>
              {t('panel.tasks.work.finished')}: {formatDateTime(task.completed_at, language)}
            </span>
          )}
          {task.measured_minutes === null ? null : (
            <span>
              {t('panel.tasks.work.measured')}: {duration(task.measured_minutes)}
            </span>
          )}
          {counted === null || counted === task.measured_minutes ? null : (
            <span className="font-medium">
              {t('panel.tasks.work.corrected')}: {duration(counted)}
            </span>
          )}
          <div className="flex flex-wrap gap-1">
            {task.is_short_measurement === true ? (
              <Badge variant="destructive">{t('panel.tasks.work.short')}</Badge>
            ) : null}
            {task.is_parallel ? (
              <Badge variant="secondary">{t('panel.tasks.work.parallel')}</Badge>
            ) : null}
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <Label htmlFor="task-correction">{t('panel.tasks.work.correction')}</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="task-correction"
              type="number"
              min={1}
              className="w-28"
              value={correction}
              onChange={(event) => setCorrection(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={setDuration.isPending || !isCorrectionValid}
              onClick={saveCorrection}
            >
              {t('panel.tasks.work.correctionSave')}
            </Button>
            {task.duration_override_min === null ? null : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={setDuration.isPending}
                onClick={() => {
                  setCorrection('');
                  setDuration.mutate({ taskId: task.id, minutes: null });
                }}
              >
                {t('panel.tasks.work.correctionReset')}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t('panel.tasks.work.correctionHint')}</p>
          {failure === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {failure.text}
              {failure.detail === null ? null : (
                <span className="block text-xs text-muted-foreground">{failure.detail}</span>
              )}
            </p>
          )}
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <h3 className="font-medium">{t('panel.tasks.work.steps')}</h3>
          {work.isPending ? (
            <p className="text-muted-foreground">{t('panel.tasks.work.loading')}</p>
          ) : work.isError ? (
            <p role="alert" className="text-destructive">
              {t('panel.tasks.work.loadError')}
            </p>
          ) : work.data.steps.length === 0 ? (
            <p className="text-muted-foreground">{t('panel.tasks.work.noSteps')}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {work.data.steps.map((step, index) => {
                const state = stepState(step);
                const photos = work.data.photosByStep[step.id] ?? [];
                const stepTitle =
                  step.title_i18n?.[language] ?? step.title ?? t(`steps.types.${step.type}`);
                return (
                  <li key={step.id} className="flex flex-col gap-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">
                        {index + 1}. {stepTitle}
                      </span>
                      <Badge variant={STATE_VARIANT[state]}>
                        {t(`panel.tasks.work.stepStates.${state}`)}
                      </Badge>
                    </div>
                    {photos.length === 0 ? null : (
                      <>
                        <span className="text-xs text-muted-foreground">
                          {t('panel.tasks.work.photos', { count: photos.length })}
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {photos.map((photo) =>
                            photo.url === null ? null : (
                              <a
                                key={photo.id}
                                href={photo.url}
                                target="_blank"
                                rel="noreferrer"
                                className="block"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={photo.url}
                                  alt=""
                                  className="h-20 w-20 rounded-md object-cover"
                                />
                              </a>
                            ),
                          )}
                        </div>
                      </>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <Separator />

        <div className="flex flex-col gap-2">
          <h3 className="font-medium">{t('panel.tasks.work.problems')}</h3>
          {problems.isPending || problems.isError ? null : problems.data.length === 0 ? (
            <p className="text-muted-foreground">{t('panel.tasks.work.noProblems')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {problems.data.map((problem) => (
                <li key={problem.id}>
                  <Link href={`/problems/${problem.id}`} className="underline">
                    {problem.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('panel.tasks.work.close')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
