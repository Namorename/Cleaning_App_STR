'use client';

import { problemStatusTone } from '@str-ops/shared';
import { useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useUnreadSubjects } from '@/features/chat/use-chat';
import { TONE_MARK_BG } from '@/lib/design/tone-classes';
import { serverErrorText } from '@/lib/server-error';
import { cn } from '@/lib/utils';

import { AssignForm } from './assign-form';
import { ProblemCard } from './problem-card';
import {
  BOARD_STATUSES,
  boardMove,
  liveFixTask,
  type BoardMove,
  type BoardStatus,
  type Problem,
} from './schema';
import { useReopenProblem, useResolveProblem, useUnassignProblem } from './use-problems';

interface ProblemsBoardProps {
  problems: Problem[];
  /** True while a search narrows the board: an empty column then says "nothing found". */
  isFiltered?: boolean;
}

/** A move that needs the manager's word before anything is sent. */
interface PendingMove {
  kind: 'assign' | 'resolve';
  problem: Problem;
}

/**
 * What moving this card to a column means. As `boardMove`, except that taking
 * the technician off needs a live job to take him off: without one — a stale
 * row — there is nothing to do, by the drop and by the menu alike.
 */
function cardMove(problem: Problem, to: BoardStatus): BoardMove {
  const move = boardMove(problem.status, to);
  return move === 'unassign' && liveFixTask(problem) === null ? null : move;
}

/** A move the manager makes here, rather than one only the technician's phone can. */
function isManagerMove(move: BoardMove): boolean {
  return move !== null && move !== 'startOnPhone';
}

/** The columns a card's menu offers: every move the manager can make from here. */
function menuMoves(problem: Problem): BoardStatus[] {
  return BOARD_STATUSES.filter((status) => isManagerMove(cardMove(problem, status)));
}

/**
 * Four columns, one per live status; cancelled problems are the list's business.
 *
 * A card moves by mouse or through its menu «⋯» (5.4, variant A) — both are
 * only a shortcut to what the card page offers: assigning opens the same
 * form, resolving asks first, moving back to "open" takes the technician off
 * the job (unassign_problem, with the person the card shows), and a resolved
 * card moved back to "open" is reopened. "In progress" belongs to the
 * technician's phone, so a drop there only explains itself and the menu does
 * not offer it.
 *
 * The four columns stay side by side and the board scrolls sideways inside
 * its frame on a narrow screen (decision 14).
 */
export function ProblemsBoard({ problems, isFiltered = false }: ProblemsBoardProps) {
  const { t } = useTranslation();
  const resolve = useResolveProblem();
  const unassign = useUnassignProblem();
  const reopen = useReopenProblem();
  const unread = useUnreadSubjects();
  const [dragging, setDragging] = useState<Problem | null>(null);
  const [over, setOver] = useState<BoardStatus | null>(null);
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const failed = [resolve, unassign, reopen].find((mutation) => mutation.isError);
  const failure = failed === undefined ? null : serverErrorText(failed.error);

  const canDrop = (status: BoardStatus) => {
    return dragging !== null && isManagerMove(cardMove(dragging, status));
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

  // The status line shows the first mutation that failed, whenever it did: a
  // new action starts from a clean line, or an old refusal hides its answer.
  const clearOutcome = () => {
    resolve.reset();
    unassign.reset();
    reopen.reset();
  };

  /** What a drop on a column — or the menu's «Перевести в …» — does. */
  const moveTo = (problem: Problem, status: BoardStatus) => {
    clearOutcome();
    const move = cardMove(problem, status);
    switch (move) {
      case 'assign':
      case 'resolve':
        setNotice(null);
        setPending({ kind: move, problem });
        return;
      case 'unassign': {
        // cardMove offers this only with a live job.
        const task = liveFixTask(problem);
        if (task === null) {
          setNotice(t('panel.problems.board.cannotMove'));
          return;
        }
        setNotice(null);
        unassign.mutate(
          { taskId: task.id, assigneeId: task.assignee_id },
          { onSuccess: () => setNotice(t('panel.problems.board.unassigned')) },
        );
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

  const onDrop = (status: BoardStatus) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOver(null);
    if (dragging === null) {
      return;
    }
    const problem = dragging;
    setDragging(null);
    moveTo(problem, status);
  };

  // The column the technician fills: a drop is refused, but the reason is worth a line.
  const onDropRefused = (status: BoardStatus) => () => {
    if (dragging !== null && boardMove(dragging.status, status) === 'startOnPhone') {
      clearOutcome();
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
      <div className="overflow-x-auto pb-1">
        <div
          data-slot="problems-board"
          className="grid grid-cols-[repeat(4,minmax(16rem,1fr))] items-start gap-3"
        >
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
                <span
                  aria-hidden="true"
                  className={cn('h-1 rounded-full', TONE_MARK_BG[problemStatusTone(status)])}
                />
                <header className="flex items-center justify-between px-1">
                  <StatusBadge status={`problems.${status}`}>{heading}</StatusBadge>
                  <span className="text-xs font-semibold text-muted-foreground tabular-nums">
                    {column.length}
                  </span>
                </header>
                {column.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {isFiltered
                      ? t('panel.problems.board.columnEmptyFiltered')
                      : t('panel.problems.board.columnEmpty')}
                  </p>
                ) : (
                  column.map((problem) => (
                    <ProblemCard
                      key={problem.id}
                      problem={problem}
                      moves={menuMoves(problem)}
                      onMove={moveTo}
                      hasUnread={unread.problems.has(problem.id)}
                      onDragStart={setDragging}
                      onDragEnd={() => {
                        setDragging(null);
                        setOver(null);
                      }}
                    />
                  ))
                )}
              </section>
            );
          })}
        </div>
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
            <Button type="button" variant="outline" className="h-11" onClick={closePending}>
              {t('panel.problems.board.resolveAbort')}
            </Button>
            <Button
              type="button"
              className="h-11"
              disabled={resolve.isPending}
              onClick={confirmResolve}
            >
              {t('panel.problems.board.resolveConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
