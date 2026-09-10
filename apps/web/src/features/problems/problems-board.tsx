'use client';

import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { serverErrorText } from '@/lib/server-error';
import { cn } from '@/lib/utils';

import { AssignForm } from './assign-form';
import { ProblemCard } from './problem-card';
import { statusVariant } from './format';
import {
  BOARD_STATUSES,
  boardMove,
  liveFixTask,
  type BoardStatus,
  type Problem,
} from './schema';
import { useReopenProblem, useResolveProblem, useUnassignProblem } from './use-problems';

interface ProblemsBoardProps {
  problems: Problem[];
}

/** A drop that needs the manager's word before anything is sent. */
interface PendingMove {
  kind: 'assign' | 'resolve';
  problem: Problem;
}

/**
 * Four columns, one per live status; cancelled problems are the list's business.
 *
 * Cards move by mouse. A drop is only a shortcut to what the card page
 * offers: assigning opens the same form, resolving asks first, moving back
 * to "open" cancels the technician's task, and a resolved card dragged back
 * to "open" is reopened. "In progress" belongs to the technician's phone, so
 * a drop there only explains itself.
 */
export function ProblemsBoard({ problems }: ProblemsBoardProps) {
  const { t } = useTranslation();
  const resolve = useResolveProblem();
  const unassign = useUnassignProblem();
  const reopen = useReopenProblem();
  const [dragging, setDragging] = useState<Problem | null>(null);
  const [over, setOver] = useState<BoardStatus | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const failed = [resolve, unassign, reopen].find((mutation) => mutation.isError);
  const failure = failed === undefined ? null : serverErrorText(failed.error);

  const canDrop = (status: BoardStatus) => {
    if (dragging === null) {
      return false;
    }
    const move = boardMove(dragging.status, status);
    return move !== null && move !== 'startOnPhone';
  };

  const onDragOver = (status: BoardStatus) => (event: DragEvent<HTMLElement>) => {
    if (!canDrop(status)) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    setOver(status);
  };

  const onDrop = (status: BoardStatus) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOver(null);
    if (dragging === null) {
      return;
    }
    const problem = dragging;
    setDragging(null);
    const move = boardMove(problem.status, status);
    switch (move) {
      case 'assign':
      case 'resolve':
        setNotice(null);
        setPending({ kind: move, problem });
        return;
      case 'unassign': {
        const task = liveFixTask(problem);
        if (task !== null) {
          setNotice(null);
          unassign.mutate(task.id, {
            onSuccess: () => setNotice(t('panel.problems.board.unassigned')),
          });
        }
        return;
      }
      case 'reopen':
        setNotice(null);
        reopen.mutate(problem.id, {
          onSuccess: () => setNotice(t('panel.problems.board.reopened')),
        });
        return;
      case 'startOnPhone':
        setNotice(t('panel.problems.board.startOnPhone'));
        return;
      case null:
        setNotice(t('panel.problems.board.cannotMove'));
        return;
    }
  };

  // The column the technician fills: a drop is refused, but the reason is worth a line.
  const onDropRefused = (status: BoardStatus) => () => {
    if (dragging !== null && boardMove(dragging.status, status) === 'startOnPhone') {
      setNotice(t('panel.problems.board.startOnPhone'));
    }
  };

  const closePending = () => setPending(null);

  // The dialog closes either way: a refusal is shown in the status line under
  // the board, which the open dialog would otherwise cover.
  const confirmResolve = () => {
    if (pending === null) {
      return;
    }
    resolve.mutate(pending.problem.id, { onSettled: closePending });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {BOARD_STATUSES.map((status) => {
          const column = problems.filter((problem) => problem.status === status);
          const heading = t(`problems.statuses.${status}`);
          const droppable = canDrop(status);
          return (
            <section
              key={status}
              aria-label={heading}
              onDragOver={onDragOver(status)}
              onDragLeave={() => setOver((current) => (current === status ? null : current))}
              onDrop={onDrop(status)}
              onDragEnter={onDropRefused(status)}
              className={cn(
                'flex min-h-32 flex-col gap-2 rounded-lg bg-muted/40 p-2 transition-colors',
                droppable && 'ring-1 ring-primary/30',
                over === status && 'bg-accent ring-2 ring-primary',
              )}
            >
              <header className="flex items-center justify-between px-1 py-1">
                <Badge variant={statusVariant(status)}>{heading}</Badge>
                <span className="text-xs text-muted-foreground">{column.length}</span>
              </header>
              {column.map((problem) => (
                <ProblemCard
                  key={problem.id}
                  problem={problem}
                  onDragStart={setDragging}
                  onDragEnd={() => {
                    setDragging(null);
                    setOver(null);
                  }}
                />
              ))}
            </section>
          );
        })}
      </div>

      <p role="status" aria-live="polite" className="min-h-5 text-xs text-muted-foreground">
        {failure !== null ? (
          <span className="text-destructive">
            {failure.text}
            {failure.detail !== null ? ` (${failure.detail})` : ''}
          </span>
        ) : (
          (notice ?? t('panel.problems.board.dragHint'))
        )}
      </p>

      <Dialog open={pending?.kind === 'assign'} onOpenChange={(open) => !open && closePending()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('panel.problems.board.assignTitle')}</DialogTitle>
            <DialogDescription>{pending?.problem.title}</DialogDescription>
          </DialogHeader>
          {pending?.kind === 'assign' ? (
            <AssignForm problem={pending.problem} fixTask={null} onAssigned={closePending} />
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={pending?.kind === 'resolve'} onOpenChange={(open) => !open && closePending()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('panel.problems.board.resolveTitle')}</DialogTitle>
            <DialogDescription>
              {t('panel.problems.board.resolveText', { title: pending?.problem.title ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closePending}>
              {t('panel.problems.board.resolveAbort')}
            </Button>
            <Button type="button" disabled={resolve.isPending} onClick={confirmResolve}>
              {t('panel.problems.board.resolveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
