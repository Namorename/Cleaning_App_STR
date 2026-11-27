'use client';

import { orderTaskHistory, problemStatusTone } from '@str-ops/shared';
import Link from 'next/link';
import { useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { UnreadChatLink } from '@/features/chat/unread-mark';
import { useUnreadSubjects } from '@/features/chat/use-chat';
import { formatDateTime } from '@/lib/format-date';
import { serverErrorText } from '@/lib/server-error';
import { useLanguage } from '@/lib/use-language';

import { problemChatHref, problemHref, type ProblemsAddress } from './address';
import { EMPTY_PROBLEM_FILTERS, filtersKey, type ProblemFilters } from './filters';
import { ProblemClosing } from './problem-closing';
import { ProblemPurge } from './problem-purge';
import { problemPlace, type Problem } from './schema';
import { ARCHIVE_PAGE, ShowMoreButton, useShowMore } from './show-more';
import { useUnarchiveProblem } from './use-problems';

interface ProblemsArchiveProps {
  /** Only the archived ones; the caller splits them off. */
  problems: Problem[];
  /** True while a search or a filter narrows them: empty then says "nothing found". */
  isFiltered?: boolean;
  /** What the archive is filtered by: a task's page carries it back. */
  filters?: ProblemFilters;
  /** An admin deletes an archived task for good (20261126150000); nobody else sees the button. */
  isAdmin?: boolean;
}

/**
 * Problems the manager put away: still openable, one click from coming back.
 * An archived problem may still be written about; its mark leads to the
 * conversation, as in the list.
 *
 * The archive only grows, so it shows a page at a time (owner, 10.10): by the day
 * reported, the latest first, then the property by name (owner, 2026-11-27:
 * `orderTaskHistory`); «Показать ещё» under it brings the older ones. An admin also
 * has «Удалить навсегда» on each, behind a question (owner, 2026-11-26).
 */
export function ProblemsArchive({
  problems,
  isFiltered = false,
  filters = EMPTY_PROBLEM_FILTERS,
  isAdmin = false,
}: ProblemsArchiveProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const unread = useUnreadSubjects();
  const unarchive = useUnarchiveProblem();
  const failure = unarchive.isError ? serverErrorText(unarchive.error) : null;
  const from: ProblemsAddress = { view: 'archive', filters };
  const listRef = useRef<HTMLUListElement>(null);
  const rows = useMemo(
    () => orderTaskHistory(problems, { place: problemPlace, language }),
    [problems, language],
  );
  const paging = useShowMore({
    total: rows.length,
    page: ARCHIVE_PAGE,
    listRef,
    itemSelector: ':scope > li',
    resetKey: filtersKey(filters),
  });

  if (rows.length === 0) {
    return (
      <EmptyState>
        {isFiltered ? t('panel.problems.emptyFiltered') : t('panel.problems.archive.empty')}
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t('panel.problems.archive.hint')}</p>
      <ul ref={listRef} className="flex flex-col gap-2">
        {rows.slice(0, paging.shown).map((problem) => (
          <li
            key={problem.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 text-sm"
          >
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={problemHref(problem.id, from)} className="font-medium hover:underline">
                  {problem.title}
                </Link>
                <Badge tone={problemStatusTone(problem.status)}>
                  {t(`problems.statuses.${problem.status}`)}
                </Badge>
                {unread.problems.has(problem.id) ? (
                  <UnreadChatLink href={problemChatHref(problem.id, from)} about={problem.title} />
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
              <ProblemClosing problem={problem} className="text-muted-foreground" />
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={unarchive.isPending}
                onClick={() => unarchive.mutate(problem.id)}
              >
                {t('panel.problems.actions.unarchive')}
              </Button>
              {isAdmin ? <ProblemPurge problem={problem} isCompact /> : null}
            </div>
          </li>
        ))}
      </ul>
      <ShowMoreButton more={paging.more} total={problems.length} onPress={paging.showMore} />
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
