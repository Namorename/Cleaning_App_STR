'use client';

import { problemStatusTone } from '@str-ops/shared';
import { useRef, useState, type DragEvent } from 'react';
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
  kind: 'assign' | 'resolve' | 'unassign';
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
 * The moves a card makes by mouse (owner, 05.10): an open task to «Назначено»,
 * and an assigned one back to «Открыто». The mouse is an addition to the menu
 * «⋯», which makes every move — from the keyboard and on a touch screen too.
 */
function isDragMove(problem: Problem, to: BoardStatus): boolean {
  const move = cardMove(problem, to);
  return move === 'assign' || (move === 'unassign' && problem.status === 'assigned');
}

/**
 * Four columns, one per live status; cancelled problems are the list's business.
 *
 * A card moves through its menu «⋯» (5.4, variant A) — a shortcut to what the
 * card page offers: assigning opens the same form, resolving asks first,
 * moving back to "open" asks first and takes the technician off the job
 * (unassign_problem, with the person the card shows), and a resolved card
 * moved back to "open" is reopened. "In progress" belongs to the technician's
 * phone, so the menu does not offer it.
 *
 * The mouse adds two of those moves (owner, 05.10): an open card dragged to
 * «Назначено» and an assigned one back to «Открыто», through the same form
 * and the same question. While a card is dragged only the column it may go to
 * is lit; let go anywhere else, it stays, and the line under the board says
 * the move is the menu's or the technician's.
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
  // Where the dragged card was last over, and whether it was dropped: a card
  // let go over a column it may not enter is never dropped there, and the
  // line says so when the drag ends.
  const lastOver = useRef<BoardStatus | null>(null);
  const wasDropped = useRef(false);

  const failed = [resolve, unassign, reopen].find((mutation) => mutation.isError);
  const failure = failed === undefined ? null : serverErrorText(failed.error);

  const canDrop = (status: BoardStatus) => dragging !== null && isDragMove(dragging, status);

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
      case 'unassign':
        // Taking the technician off asks first, by the drop and by the menu
        // alike (owner, 05.10); cardMove offers it only with a live job.
        setNotice(null);
        setPending({ kind: 'unassign', problem });
        return;
      case 'reopen':
        setNotice(null);
        reopen.mutate(problem.id, {
          onSuccess: () => setNotice(t('panel.problems.board.reopened')),
        });
        return;
      // Neither path asks for these: the menu does not offer them, the drag
      // refuses them first. A stale card that gets here is told so.
      case 'startOnPhone':
      case null:
        setNotice(t('panel.problems.board.cannotMove'));
        return;
    }
  };

  /** A drag that may not go where it went: the card stays, the line says where it is done. */
  const refuseDrag = () => {
    clearOutcome();
    setNotice(t('panel.problems.board.dragRefused'));
  };

  const onDragStart = (problem: Problem) => {
    lastOver.current = null;
    wasDropped.current = false;
    setDragging(problem);
  };

  const onDragEnter = (status: BoardStatus) => () => {
    lastOver.current = status;
  };

  const onDrop = (status: BoardStatus) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOver(null);
    if (dragging === null) {
      return;
    }
    wasDropped.current = true;
    const problem = dragging;
    setDragging(null);
    if (isDragMove(problem, status)) {
      moveTo(problem, status);
    } else {
      refuseDrag();
    }
  };

  const onDragEnd = () => {
    const refusedAt = lastOver.current;
    if (
      !wasDropped.current &&
      dragging !== null &&
      refusedAt !== null &&
      refusedAt !== dragging.status &&
      !isDragMove(dragging, refusedAt)
    ) {
      refuseDrag();
    }
    setDragging(null);
    setOver(null);
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

  // unassign_problem with the person the card showed (f969563): if the job
  // went to somebody else meanwhile, the server refuses.
  const confirmUnassign = () => {
    const task = pending === null ? null : liveFixTask(pending.problem);
    if (task === null) {
      closePending();
      return;
    }
    unassign.mutate(
      { taskId: task.id, assigneeId: task.assignee_id },
      {
        onSuccess: () => setNotice(t('panel.problems.board.unassigned')),
        onSettled: closePending,
      },
    );
  };
  const unassigning = pending?.kind === 'unassign' ? pending.problem : null;

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
                onDragEnter={onDragEnter(status)}
                data-droppable={droppable ? 'true' : undefined}
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
                      onDragStart={onDragStart}
                      onDragEnd={onDragEnd}
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

      <Dialog open={unassigning !== null} onOpenChange={(open) => !open && closePending()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('panel.problems.board.unassignTitle')}</DialogTitle>
            <DialogDescription>
              {unassigning === null
                ? null
                : t('panel.problems.board.unassignText', {
                    name:
                      liveFixTask(unassigning)?.assignee?.full_name ??
                      t('panel.problems.unknownPerson'),
                    title: unassigning.title,
                  })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" className="h-11" onClick={closePending}>
              {t('panel.problems.board.unassignAbort')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="h-11"
              disabled={unassign.isPending}
              onClick={confirmUnassign}
            >
              {t('panel.problems.board.unassignConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
