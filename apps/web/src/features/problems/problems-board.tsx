'use client';

import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';

import { ProblemCard } from './problem-card';
import { statusVariant } from './format';
import { BOARD_STATUSES, type Problem } from './schema';

interface ProblemsBoardProps {
  problems: Problem[];
}

/** Four columns, one per live status; cancelled problems are the list's business. */
export function ProblemsBoard({ problems }: ProblemsBoardProps) {
  const { t } = useTranslation();

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {BOARD_STATUSES.map((status) => {
        const column = problems.filter((problem) => problem.status === status);
        const heading = t(`problems.statuses.${status}`);
        return (
          <section
            key={status}
            aria-label={heading}
            className="flex flex-col gap-2 rounded-lg bg-muted/40 p-2"
          >
            <header className="flex items-center justify-between px-1 py-1">
              <Badge variant={statusVariant(status)}>{heading}</Badge>
              <span className="text-xs text-muted-foreground">{column.length}</span>
            </header>
            {column.map((problem) => (
              <ProblemCard key={problem.id} problem={problem} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
