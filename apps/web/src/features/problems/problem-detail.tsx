'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
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
import {
  isProblemArchived,
  isProblemClosed,
  liveFixTask,
  type FixTask,
  type Problem,
} from './schema';
import {
  useArchiveProblem,
  useCancelProblem,
  useProblem,
  useProblemPhotos,
  useReopenProblem,
  useResolveProblem,
  useUnarchiveProblem,
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
  // Nothing to assign on a closed or archived problem; the levers below still apply.
  const isClosed = isProblemClosed(problem) || isProblemArchived(problem);

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
            <ManagerActions problem={problem} />
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
      <dd className="inline-flex items-center gap-1">
        {t('panel.problems.detail.reporterLabel')}
        <Person
          name={problem.reporter?.full_name}
          role={problem.reporter?.role}
          fallback={t('panel.problems.unknownPerson')}
        />
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
      {problem.archived_at !== null ? (
        <dd className="text-destructive">
          {t('panel.problems.detail.archivedAt', {
            date: formatDateTime(problem.archived_at, language),
          })}
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
      <Person
        name={fixTask.assignee?.full_name}
        role={fixTask.assignee?.role}
        fallback={t('panel.problems.unknownPerson')}
        className="font-medium"
      />
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

/** Which inline question, if any, is waiting for the manager's word. */
type PendingAction = 'cancel' | 'archive' | null;

/**
 * The manager's levers, by where the problem is.
 *
 * Live: resolve, cancel, archive. Closed: reopen, archive. Archived: restore
 * only — everything else waits until the problem is back. Cancelling asks
 * for a reason, archiving asks for confirmation; both inline.
 */
function ManagerActions({ problem }: { problem: Problem }) {
  const { t } = useTranslation();
  const resolve = useResolveProblem();
  const cancel = useCancelProblem();
  const reopen = useReopenProblem();
  const archive = useArchiveProblem();
  const unarchive = useUnarchiveProblem();
  const [pending, setPending] = useState<PendingAction>(null);
  const [reason, setReason] = useState('');

  const failed = [resolve, cancel, reopen, archive, unarchive].find((mutation) => mutation.isError);
  const failure = failed === undefined ? null : serverErrorText(failed.error);
  const isBusy = [resolve, cancel, reopen, archive, unarchive].some(
    (mutation) => mutation.isPending,
  );
  const isArchived = isProblemArchived(problem);
  const isClosed = isProblemClosed(problem);

  const archiveButton = (
    <Button type="button" variant="ghost" disabled={isBusy} onClick={() => setPending('archive')}>
      {t('panel.problems.actions.archive')}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3 border-t pt-4">
      {pending === 'cancel' ? (
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
              disabled={isBusy}
              onClick={() => cancel.mutate({ problemId: problem.id, reason })}
            >
              {t('panel.problems.actions.cancelConfirm')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>
              {t('panel.problems.actions.cancelAbort')}
            </Button>
          </div>
        </div>
      ) : pending === 'archive' ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">{t('panel.problems.actions.archiveText')}</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              disabled={isBusy}
              onClick={() => archive.mutate(problem.id, { onSettled: () => setPending(null) })}
            >
              {t('panel.problems.actions.archiveConfirm')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>
              {t('panel.problems.actions.archiveAbort')}
            </Button>
          </div>
        </div>
      ) : isArchived ? (
        <div className="flex gap-2">
          <Button type="button" disabled={isBusy} onClick={() => unarchive.mutate(problem.id)}>
            {t('panel.problems.actions.unarchive')}
          </Button>
        </div>
      ) : isClosed ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={isBusy} onClick={() => reopen.mutate(problem.id)}>
            {t('panel.problems.actions.reopen')}
          </Button>
          {archiveButton}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={isBusy} onClick={() => resolve.mutate(problem.id)}>
            {t('panel.problems.actions.resolve')}
          </Button>
          <Button type="button" variant="outline" onClick={() => setPending('cancel')}>
            {t('panel.problems.actions.cancel')}
          </Button>
          {archiveButton}
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
