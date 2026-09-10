'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatDateTime, formatDay } from '@/lib/format-date';
import { serverErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import { AssignForm } from './assign-form';
import { FixTaskSteps } from './fix-task-steps';
import { formatClock, priorityVariant, statusVariant } from './format';
import { ProblemPhotos } from './problem-photos';
import { isProblemClosed, liveFixTask, type FixTask, type Problem } from './schema';
import {
  useCancelProblem,
  useProblem,
  useProblemPhotos,
  useResolveProblem,
} from './use-problems';

interface ProblemDetailProps {
  problemId: string;
}

/** The problem's card: the report, its photos, the fix and the manager's levers. */
export function ProblemDetail({ problemId }: ProblemDetailProps) {
  const { t } = useTranslation();
  const problem = useProblem(problemId);

  if (problem.isPending) {
    return <p className="text-sm text-muted-foreground">{t('panel.problems.loading')}</p>;
  }
  if (problem.isError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('panel.problems.loadError')}
      </p>
    );
  }
  if (problem.data === null) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <p className="text-sm text-muted-foreground">{t('panel.problems.notFound')}</p>
      </div>
    );
  }

  return <ProblemCard problem={problem.data} />;
}

function BackLink() {
  const { t } = useTranslation();
  return (
    <Link href="/problems" className="text-sm text-muted-foreground hover:underline">
      ← {t('panel.problems.detail.back')}
    </Link>
  );
}

function ProblemCard({ problem }: { problem: Problem }) {
  const { t } = useTranslation();
  const fixTask = liveFixTask(problem);
  const isClosed = isProblemClosed(problem);

  return (
    <div className="flex flex-col gap-4">
      <BackLink />
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{problem.title}</h1>
        <Badge variant={statusVariant(problem.status)}>
          {t(`problems.statuses.${problem.status}`)}
        </Badge>
        <Badge variant={priorityVariant(problem.priority)}>
          {t(`problems.priorities.${problem.priority}`)}
        </Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{problem.property?.name ?? t('problems.noProperty')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <ReportMeta problem={problem} />
            <section className="flex flex-col gap-1">
              <h2 className="font-medium">{t('panel.problems.detail.description')}</h2>
              <p className="whitespace-pre-wrap text-muted-foreground">
                {problem.description ?? t('panel.problems.detail.noDescription')}
              </p>
            </section>
            <section className="flex flex-col gap-1">
              <h2 className="font-medium">{t('panel.problems.detail.photos')}</h2>
              <ReportPhotos problemId={problem.id} />
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('panel.problems.detail.fixTask')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 text-sm">
            {fixTask === null ? (
              <p className="text-muted-foreground">{t('panel.problems.detail.noFixTask')}</p>
            ) : (
              <FixTaskSummary fixTask={fixTask} />
            )}
            {isClosed ? null : (
              <AssignForm key={fixTask?.id ?? 'new'} problem={problem} fixTask={fixTask} />
            )}
            {fixTask !== null ? (
              <section className="flex flex-col gap-2">
                <h2 className="font-medium">{t('panel.problems.detail.steps')}</h2>
                <FixTaskSteps taskId={fixTask.id} />
              </section>
            ) : null}
            {isClosed ? null : <ManagerActions problem={problem} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function ReportMeta({ problem }: { problem: Problem }) {
  const { t } = useTranslation();
  const language = useLanguage();

  return (
    <dl className="flex flex-col gap-1 text-muted-foreground">
      <dd>
        {t('panel.problems.detail.reportedBy', {
          name: problem.reporter?.full_name ?? t('panel.problems.unknownPerson'),
        })}
      </dd>
      <dd>
        {t('panel.problems.detail.reportedAt', {
          date: formatDateTime(problem.created_at, language),
        })}
      </dd>
      {problem.task_id !== null ? <dd>{t('panel.problems.detail.fromTask')}</dd> : null}
      {problem.resolved_at !== null ? (
        <dd>
          {t('panel.problems.detail.resolvedAt', {
            date: formatDateTime(problem.resolved_at, language),
          })}
        </dd>
      ) : null}
      {problem.cancelled_at !== null ? (
        <dd>
          {t('panel.problems.detail.cancelledAt', {
            date: formatDateTime(problem.cancelled_at, language),
          })}
          {problem.cancel_reason !== null ? (
            <span className="block">
              {t('panel.problems.detail.cancelReason')}: {problem.cancel_reason}
            </span>
          ) : null}
        </dd>
      ) : null}
    </dl>
  );
}

function ReportPhotos({ problemId }: { problemId: string }) {
  const { t } = useTranslation();
  const photos = useProblemPhotos(problemId);

  if (photos.isPending) {
    return <p className="text-muted-foreground">{t('panel.problems.loading')}</p>;
  }
  if (photos.isError) {
    return (
      <p role="alert" className="text-destructive">
        {t('panel.problems.loadError')}
      </p>
    );
  }
  return <ProblemPhotos photos={photos.data} emptyText={t('panel.problems.detail.noPhotos')} />;
}

type Translate = (key: string, options?: Record<string, string>) => string;

function windowText(fixTask: FixTask, t: Translate): string {
  const from = fixTask.time_from === null ? null : formatClock(fixTask.time_from);
  const to = fixTask.time_to === null ? null : formatClock(fixTask.time_to);
  if (from !== null && to !== null) {
    return t('panel.problems.detail.window', { from, to });
  }
  if (from !== null) {
    return t('panel.problems.detail.windowFrom', { from });
  }
  if (to !== null) {
    return t('panel.problems.detail.windowTo', { to });
  }
  return t('panel.problems.detail.anyTime');
}

function FixTaskSummary({ fixTask }: { fixTask: FixTask }) {
  const { t } = useTranslation();
  const language = useLanguage();

  return (
    <div className="flex flex-col gap-1">
      <span className="font-medium">
        {fixTask.assignee?.full_name ?? t('panel.problems.unknownPerson')}
      </span>
      <span className="text-muted-foreground">
        {t('panel.problems.detail.schedule', {
          date: formatDay(fixTask.scheduled_date, language),
          window: windowText(fixTask, t),
        })}
      </span>
      <span className="text-muted-foreground">
        {t('panel.problems.detail.taskStatus', {
          status: t(`tasks.statuses.${fixTask.status}`, { defaultValue: fixTask.status }),
        })}
      </span>
    </div>
  );
}

function ManagerActions({ problem }: { problem: Problem }) {
  const { t } = useTranslation();
  const resolve = useResolveProblem();
  const cancel = useCancelProblem();
  const [isCancelling, setIsCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const failure = resolve.isError
    ? serverErrorText(resolve.error)
    : cancel.isError
      ? serverErrorText(cancel.error)
      : null;

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      {isCancelling ? (
        <div className="flex flex-col gap-2">
          <Label htmlFor="cancelReason">{t('panel.problems.actions.cancelReason')}</Label>
          <Textarea
            id="cancelReason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
          />
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate({ problemId: problem.id, reason })}
            >
              {t('panel.problems.actions.cancelConfirm')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setIsCancelling(false)}>
              {t('panel.problems.actions.cancelAbort')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            type="button"
            disabled={resolve.isPending}
            onClick={() => resolve.mutate(problem.id)}
          >
            {t('panel.problems.actions.resolve')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setIsCancelling(true)}>
            {t('panel.problems.actions.cancel')}
          </Button>
        </div>
      )}
      {failure !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {failure.text}
          {failure.detail !== null ? (
            <span className="block text-xs text-muted-foreground">{failure.detail}</span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}
