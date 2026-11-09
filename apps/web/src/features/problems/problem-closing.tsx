'use client';

import { closingLines } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import type { Problem } from './schema';

interface ProblemClosingProps {
  problem: Problem;
  className?: string;
}

/**
 * Who did a closed task's work and who closed it (20261106125000): «Выполнил: Иван»,
 * «Закрыл: менеджер Пётр», «Закрыто автоматически». Nothing while the task is open.
 */
export function ProblemClosing({ problem, className }: ProblemClosingProps) {
  const { t } = useTranslation();
  const lines = closingLines(problem, t);
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className={cn('flex flex-col', className)}>
      {lines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </div>
  );
}
