'use client';

import { problemStatusTone } from '@str-ops/shared';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UnreadChatLink } from '@/features/chat/unread-mark';
import { useUnreadSubjects } from '@/features/chat/use-chat';
import { formatDateTime } from '@/lib/format-date';
import { serverErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import { problemChatHref, problemHref } from './address';
import { problemPlace, type Problem } from './schema';
import { useUnarchiveProblem } from './use-problems';

interface ProblemsArchiveProps {
  /** Only the archived ones; the caller splits them off. */
  problems: Problem[];
}

/**
 * Problems the manager put away: still openable, one click from coming back.
 * An archived problem may still be written about; its mark leads to the
 * conversation, as in the list.
 */
export function ProblemsArchive({ problems }: ProblemsArchiveProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const unread = useUnreadSubjects();
  const unarchive = useUnarchiveProblem();
  const failure = unarchive.isError ? serverErrorText(unarchive.error) : null;

  if (problems.length === 0) {
    return <EmptyState>{t('panel.problems.archive.empty')}</EmptyState>;
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('panel.problems.archive.hint')}</p>
      <ul className="flex flex-col gap-2">
        {problems.map((problem) => (
          <li
            key={problem.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm"
          >
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={problemHref(problem.id, 'archive')}
                  className="font-medium hover:underline"
                >
                  {problem.title}
                </Link>
                <Badge tone={problemStatusTone(problem.status)}>
                  {t(`problems.statuses.${problem.status}`)}
                </Badge>
                {unread.problems.has(problem.id) ? (
                  <UnreadChatLink
                    href={problemChatHref(problem.id, 'archive')}
                    about={problem.title}
                  />
                ) : null}
              </div>
              <span className="text-muted-foreground">
                {problemPlace(problem) ?? t('problems.noProperty')}
                {problem.archived_at !== null
                  ? ` · ${t('panel.problems.detail.archivedAt', {
                      date: formatDateTime(problem.archived_at, language),
                    })}`
                  : ''}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={unarchive.isPending}
              onClick={() => unarchive.mutate(problem.id)}
            >
              {t('panel.problems.actions.unarchive')}
            </Button>
          </li>
        ))}
      </ul>
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
