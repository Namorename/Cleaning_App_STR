'use client';

import { problemPriorityTone, problemStatusTone } from '@str-ops/shared';
import Link from 'next/link';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Person } from '@/components/person';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UnreadChatLink } from '@/features/chat/unread-mark';
import { useUnreadSubjects } from '@/features/chat/use-chat';
import { formatDateTime } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import { problemChatHref, problemHref, type ProblemsAddress } from './address';
import { EMPTY_PROBLEM_FILTERS, filtersKey, type ProblemFilters } from './filters';
import { liveFixTask, problemPlace, type Problem } from './schema';
import { LIST_PAGE, ShowMoreButton, useShowMore } from './show-more';

interface ProblemsTableProps {
  problems: Problem[];
  /** What the list is filtered by: a task's page carries it back. */
  filters?: ProblemFilters;
}

/**
 * Every problem in one table, cancelled ones included. A problem somebody
 * wrote about carries «Новое сообщение» beside its title — a link to its
 * page with the conversation open (5.4, «Чат»).
 *
 * Newest reported first, a page at a time (owner, 10.10: the page must not
 * grow without end); «Показать ещё» under the table brings the older ones.
 */
export function ProblemsTable({ problems, filters = EMPTY_PROBLEM_FILTERS }: ProblemsTableProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const unread = useUnreadSubjects();
  const from: ProblemsAddress = { view: 'list', filters };
  const tableRef = useRef<HTMLDivElement>(null);
  const paging = useShowMore({
    total: problems.length,
    page: LIST_PAGE,
    listRef: tableRef,
    itemSelector: 'tbody > tr',
    resetKey: filtersKey(filters),
  });

  return (
    <div className="flex flex-col gap-3">
      <div ref={tableRef} className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('panel.problems.columns.title')}</TableHead>
              <TableHead>{t('panel.problems.columns.property')}</TableHead>
              <TableHead>{t('panel.problems.columns.priority')}</TableHead>
              <TableHead>{t('panel.problems.columns.status')}</TableHead>
              <TableHead>{t('panel.problems.columns.assignee')}</TableHead>
              <TableHead>{t('panel.problems.columns.reporter')}</TableHead>
              <TableHead>{t('panel.problems.columns.reported')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {problems.slice(0, paging.shown).map((problem) => {
              const fixTask = liveFixTask(problem);
              return (
                <TableRow key={problem.id}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-x-2">
                      <Link
                        href={problemHref(problem.id, from)}
                        className="font-medium hover:underline"
                      >
                        {problem.title}
                      </Link>
                      {unread.problems.has(problem.id) ? (
                        <UnreadChatLink
                          href={problemChatHref(problem.id, from)}
                          about={problem.title}
                        />
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>{problemPlace(problem) ?? t('problems.noProperty')}</TableCell>
                  <TableCell>
                    <Badge tone={problemPriorityTone(problem.priority)}>
                      {t(`problems.priorities.${problem.priority}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge tone={problemStatusTone(problem.status)}>
                      {t(`problems.statuses.${problem.status}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {fixTask === null ? (
                      t('panel.problems.noAssignee')
                    ) : (
                      <Person
                        name={fixTask.assignee?.full_name}
                        role={fixTask.assignee?.role}
                        fallback={t('panel.problems.unknownPerson')}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    <Person
                      name={problem.reporter?.full_name}
                      role={problem.reporter?.role}
                      fallback={t('panel.problems.unknownPerson')}
                    />
                  </TableCell>
                  <TableCell>{formatDateTime(problem.created_at, language)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <ShowMoreButton more={paging.more} total={problems.length} onPress={paging.showMore} />
    </div>
  );
}
