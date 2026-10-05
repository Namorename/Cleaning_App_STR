'use client';

import { problemPriorityTone, problemStatusTone } from '@str-ops/shared';
import Link from 'next/link';
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
import { formatDateTime } from '@/lib/format-date';
import { useLanguage } from '@/lib/use-language';

import { problemHref } from './address';
import { liveFixTask, problemPlace, type Problem } from './schema';

interface ProblemsTableProps {
  problems: Problem[];
}

/** Every problem in one table, cancelled ones included. */
export function ProblemsTable({ problems }: ProblemsTableProps) {
  const { t } = useTranslation();
  const language = useLanguage();

  return (
    <div className="overflow-x-auto rounded-lg border">
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
          {problems.map((problem) => {
            const fixTask = liveFixTask(problem);
            return (
              <TableRow key={problem.id}>
                <TableCell>
                  <Link
                    href={problemHref(problem.id, 'list')}
                    className="font-medium hover:underline"
                  >
                    {problem.title}
                  </Link>
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
  );
}
