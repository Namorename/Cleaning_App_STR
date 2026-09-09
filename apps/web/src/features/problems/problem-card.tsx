'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/lib/use-language';

import { formatDay, priorityVariant } from './format';
import { liveFixTask, type Problem } from './schema';

interface ProblemCardProps {
  problem: Problem;
}

/** One problem on the board: enough to decide whether to open it. */
export function ProblemCard({ problem }: ProblemCardProps) {
  const { t } = useTranslation();
  const language = useLanguage();
  const fixTask = liveFixTask(problem);
  const assignee = fixTask?.assignee?.full_name ?? null;

  return (
    <Link
      href={`/problems/${problem.id}`}
      className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-sm shadow-xs hover:bg-accent"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium">{problem.title}</span>
        <Badge variant={priorityVariant(problem.priority)}>
          {t(`problems.priorities.${problem.priority}`)}
        </Badge>
      </div>
      <span className="text-muted-foreground">
        {problem.property?.name ?? t('problems.noProperty')}
      </span>
      {fixTask !== null ? (
        <span className="text-xs text-muted-foreground">
          {assignee ?? t('panel.problems.unknownPerson')} ·{' '}
          {formatDay(fixTask.scheduled_date, language)}
        </span>
      ) : null}
    </Link>
  );
}
