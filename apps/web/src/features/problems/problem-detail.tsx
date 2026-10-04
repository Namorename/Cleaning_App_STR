'use client';

import { useTranslation } from 'react-i18next';

import { PageBackLink, PageHeader } from '@/components/page-header';
import { Person } from '@/components/person';
import { StatusBadge } from '@/components/status-badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/states';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ThreadPanel } from '@/features/chat/thread-panel';
import { formatDateTime, formatDay } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import { AssignForm } from './assign-form';
import { FixTaskSteps } from './fix-task-steps';
import { formatClock } from './format';
import { ProblemActions } from './problem-actions';
import { ProblemPhotos } from './problem-photos';
import {
  isProblemArchived,
  isProblemClosed,
  liveFixTask,
  type FixTask,
  type Problem,
  problemPlace,
} from './schema';
import { useProblem, useProblemPhotos } from './use-problems';

interface ProblemDetailProps {
  problemId: string;
}

/** The problem's card: the report, its photos, the fix and the manager's levers. */
export function ProblemDetail({ problemId }: ProblemDetailProps) {
  const { t } = useTranslation();
  const problem = useProblem(problemId);

  if (problem.isPending) {
    return <LoadingState>{t('panel.problems.loading')}</LoadingState>;
  }
  if (problem.isError) {
    return <ErrorState message={t('panel.problems.loadError')} error={problem.error} />;
  }
  if (problem.data === null) {
    return (
      <div className="flex flex-col gap-4">
        <BackLink />
        <EmptyState>{t('panel.problems.notFound')}</EmptyState>
      </div>
    );
  }

  return <ProblemPage problem={problem.data} />;
}

const PROBLEMS_HREF = '/problems';

/** The way back to the section's list; on its own while there is no title to head. */
function BackLink() {
  const { t } = useTranslation();
  return <PageBackLink href={PROBLEMS_HREF} label={t('panel.problems.detail.back')} />;
}

/**
 * The problem's page (5.4, variant A): a header that stays on screen with the
 * title, the status and the levers; under it two columns — the report, and
 * the technician's work beside it; the conversation below (its own panel is
 * the «Чат» group's).
 */
function ProblemPage({ problem }: { problem: Problem }) {
  const { t } = useTranslation();
  const fixTask = liveFixTask(problem);
  // Nothing to assign on a closed or archived problem; the header's levers still apply.
  const isClosed = isProblemClosed(problem) || isProblemArchived(problem);

  return (
    <div className="flex flex-col gap-4">
      {/* On a phone the header scrolls away with the page: stuck, it would take
          a third of the screen. */}
      <div data-slot="problem-head" className="bg-background py-2 md:sticky md:top-0 md:z-10">
        <PageHeader
          back={{ href: PROBLEMS_HREF, label: t('panel.problems.detail.back') }}
          title={problem.title}
          meta={
            <>
              <StatusBadge status={`problems.${problem.status}`}>
                {t(`problems.statuses.${problem.status}`)}
              </StatusBadge>
              <StatusBadge status={`problems.priority.${problem.priority}`}>
                {t(`problems.priorities.${problem.priority}`)}
              </StatusBadge>
            </>
          }
          actions={<ProblemActions problem={problem} />}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{problemPlace(problem) ?? t('problems.noProperty')}</CardTitle>
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
          </CardContent>
        </Card>

        {/* The repair speaks in the report's thread (open_thread), so one
            conversation serves the problem and whichever task fixes it. */}
        <Card className="lg:col-span-2">
          <CardContent className="pt-6">
            <ThreadPanel subject={{ problemId: problem.id }} />
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
    return <LoadingState>{t('panel.problems.loading')}</LoadingState>;
  }
  if (photos.isError) {
    return <ErrorState message={t('panel.problems.loadError')} error={photos.error} />;
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
          status: t(`panel.tasks.statuses.${fixTask.status}`),
        })}
      </span>
    </div>
  );
}
