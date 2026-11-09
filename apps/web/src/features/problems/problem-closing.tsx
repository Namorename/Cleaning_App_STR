'use client';

import { closingLines, closingSourceNote, isProblemWorkerNameable } from '@str-ops/shared';
import { useTranslation } from 'react-i18next';

import { workerChoices } from '@/components/who-did-it-dialog';
import { WorkerMarkForm } from '@/components/worker-mark-form';
import { serverErrorText } from '@/lib/server-error';
import { cn } from '@/lib/utils';

import type { Problem } from './schema';
import { useNameProblemWorker, useWorkers } from './use-problems';

interface ProblemClosingProps {
  problem: Problem;
  className?: string;
}

/**
 * Who did a closed task's work and who closed it (20261106125000): «Выполнил: Иван», with how
 * that is known in small print, «Закрыл: менеджер Пётр», «Закрыто автоматически». Nothing while
 * the task is open.
 */
export function ProblemClosing({ problem, className }: ProblemClosingProps) {
  const { t } = useTranslation();
  const lines = closingLines(problem, t);
  if (lines.length === 0) {
    return null;
  }
  const note = closingSourceNote(problem, t);
  return (
    <div className={cn('flex flex-col', className)}>
      {lines.map((line, index) => (
        <span key={line}>
          {line}
          {index === 0 && note !== null ? (
            <span className="block text-xs font-normal text-muted-foreground">{note}</span>
          ) : null}
        </span>
      ))}
    </div>
  );
}

/** «Указать исполнителя» on a resolved task that says «не указано» (20261106125500). */
export function ProblemWorkerMark({ problem }: { problem: Problem }) {
  const { t } = useTranslation();
  const workers = useWorkers();
  const mark = useNameProblemWorker();
  if (!isProblemWorkerNameable(problem)) {
    return null;
  }
  return (
    <WorkerMarkForm
      id={problem.id}
      people={workerChoices(workers.data ?? [], null, {
        unknown: t('panel.problems.unknownPerson'),
        holder: t('panel.problems.resolveDialog.holder'),
      })}
      isBusy={mark.isPending}
      failure={mark.isError ? serverErrorText(mark.error) : null}
      onSave={(personId) => mark.mutate({ problemId: problem.id, personId })}
    />
  );
}
