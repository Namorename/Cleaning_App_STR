'use client';

import { PhotoSource } from '@/features/media/photo-source';
import { VideoTile } from '@/features/media/video-tile';
import { STATUS_TONE } from '@str-ops/shared';
import { MessageSquare } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, LoadingState } from '@/components/states';
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
import {
  isTechnicianJob,
  localizedTitle,
  taskMinutes,
  taskPropertyName,
  type Task,
} from './schema';
import { useSetDuration, useTaskProblems, useTaskWork } from './use-tasks';

interface TaskDrawerProps {
  /** The task being read; finished or not. */
  task: Task;
  onClose: () => void;
  /**
   * Put the drawer away and open the conversation about the same task: the
   * caller holds both, so one sheet stands at a time, never one over another.
   */
  onOpenChat: (task: Task) => void;
}

type StepState = 'done' | 'skipped' | 'waived' | 'pending';

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
 * A job up close, once it has been worked: the steps, the photos and videos,
 * the problems it turned up, and how long it is counted as.
 *
 * The conversation is not in here any more (5.4, «Чат», variant B): it has a
 * sheet of its own, which every job's row opens; the drawer's «Чат»
 * swaps one sheet for the other. The work sections appear once the job has
 * been started; the time correction only once it is done.
 *
 * The measurement itself is never rewritten (§13.3). A correction goes into
 * its own field and can be taken back, and the drawer shows both numbers so
 * the manager can see what was changed and by how much.
 */
export function TaskDrawer({ task, onClose, onOpenChat }: TaskDrawerProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const work = useTaskWork(task.id);
  const problems = useTaskProblems(task.id);
  const setDuration = useSetDuration();
  const [correction, setCorrection] = useState(() =>
    task.duration_override_min === null ? '' : task.duration_override_min.toString(),
  );

  const title = localizedTitle(task, language) ?? t(`panel.tasks.types.${task.type}`);
  const isDone = task.status === 'done';
  // A technician's job is «работа» (CLAUDE.md), not a cleaning.
  const isJob = isTechnicianJob(task);
  const isStarted = task.started_at !== null;
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
          <SheetTitle>
            {isDone
              ? t(isJob ? 'panel.tasks.work.titleRepair' : 'panel.tasks.work.title')
              : t(isJob ? 'panel.tasks.work.titleRepairOpen' : 'panel.tasks.work.titleOpen')}
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-1">
          <span className="font-medium">{title}</span>
          <span className="text-muted-foreground">{taskPropertyName(task) ?? ''}</span>
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
              <Badge tone={STATUS_TONE['tasks.flags.tooShort']}>
                {t('panel.tasks.work.short')}
              </Badge>
            ) : null}
            {task.is_parallel ? (
              <Badge tone={STATUS_TONE['tasks.flags.parallel']}>
                {t('panel.tasks.work.parallel')}
              </Badge>
            ) : null}
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-11 self-start"
          onClick={() => onOpenChat(task)}
        >
          <MessageSquare aria-hidden="true" />
          {t('panel.chat.open')}
        </Button>

        {isDone ? (
          <>
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
              <p className="text-xs text-muted-foreground">
                {t('panel.tasks.work.correctionHint')}
              </p>
              {failure === null ? null : (
                <p role="alert" className="text-sm text-destructive">
                  {failure.text}
                  {failure.detail === null ? null : (
                    <span className="block text-xs text-muted-foreground">{failure.detail}</span>
                  )}
                </p>
              )}
            </div>
          </>
        ) : null}

        {isStarted ? (
          <>
            <Separator />

            <div className="flex flex-col gap-2">
              <h3 className="font-medium">{t('panel.tasks.work.steps')}</h3>
              {work.isPending ? (
                <LoadingState>{t('panel.tasks.work.loading')}</LoadingState>
              ) : work.isError ? (
                <ErrorState message={t('panel.tasks.work.loadError')} error={work.error} />
              ) : work.data.steps.length === 0 ? (
                <EmptyState>{t('panel.tasks.work.noSteps')}</EmptyState>
              ) : (
                <ol className="flex flex-col gap-2">
                  {work.data.steps.map((step, index) => {
                    const state = stepState(step);
                    const media = work.data.mediaByStep[step.id] ?? [];
                    const photos = media.filter((item) => item.kind === 'photo');
                    const videos = media.filter((item) => item.kind === 'video');
                    const stepTitle =
                      step.title_i18n?.[language] ?? step.title ?? t(`steps.types.${step.type}`);
                    return (
                      <li key={step.id} className="flex flex-col gap-2 rounded-md border p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">
                            {index + 1}. {stepTitle}
                          </span>
                          <Badge tone={STATUS_TONE[`steps.${state}`]}>
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
                                    className="relative block h-20 w-20"
                                  >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={photo.url}
                                      alt=""
                                      className="h-20 w-20 rounded-md object-cover"
                                    />
                                    <PhotoSource source={photo.source} />
                                  </a>
                                ),
                              )}
                            </div>
                          </>
                        )}
                        {videos.length === 0 ? null : (
                          <div className="flex flex-wrap gap-2">
                            {videos.map((video) =>
                              video.url === null ? null : (
                                <VideoTile
                                  key={video.id}
                                  url={video.url}
                                  durationSec={video.duration_sec}
                                  label={t('panel.media.videoOf', { step: stepTitle })}
                                  className="w-20"
                                />
                              ),
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </>
        ) : null}

        <Separator />

        <div className="flex flex-col gap-2">
          <h3 className="font-medium">{t('panel.tasks.work.problems')}</h3>
          {problems.isPending || problems.isError ? null : problems.data.length === 0 ? (
            <EmptyState>{t('panel.tasks.work.noProblems')}</EmptyState>
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
