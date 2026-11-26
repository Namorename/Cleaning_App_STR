'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { serverErrorText, type ServerErrorText } from '@/lib/server-error';

import { cardMove } from './board-moves';
import type { ResolveChoice } from './resolve-dialog';
import { liveFixTask, type BoardStatus, type Problem } from './schema';
import {
  useArchiveProblem,
  useReopenProblem,
  useResolveProblem,
  useUnassignProblem,
} from './use-problems';

/** A move that needs the manager's word before anything is sent; «В архив» is one too. */
export interface PendingMove {
  kind: 'assign' | 'resolve' | 'unassign' | 'archive';
  problem: Problem;
}

/**
 * The line under the board. `count` grows with every sentence, so the same
 * refusal said twice is written afresh — a live region speaks on a change.
 */
export interface BoardNotice {
  text: string;
  count: number;
}

export interface BoardMoves {
  /** The question open now. */
  pending: PendingMove | null;
  /** The last question asked: its words stay while its dialog fades out. */
  shown: PendingMove | null;
  notice: BoardNotice | null;
  /** The first of the board's writes that failed, in the reader's words. */
  failure: ServerErrorText | null;
  isResolving: boolean;
  /** The refusal of a closing that carried a comment or files; the dialog shows it. */
  resolveError: unknown;
  isUnassigning: boolean;
  isArchiving: boolean;
  /** What a drop on a column — or the menu's «Перевести в …» — does. */
  moveTo: (problem: Problem, status: BoardStatus) => void;
  /** «В архив» from the card's menu: asks first, as the task's page does. */
  askArchive: (problem: Problem) => void;
  /** A drag that may not go where it went: the line says where it is done. */
  refuse: () => void;
  closePending: () => void;
  /** Who did the work; null: nobody, the manager did it alone. */
  confirmResolve: (choice: ResolveChoice) => void;
  confirmUnassign: () => void;
  confirmArchive: () => void;
}

/**
 * The board's moves and the questions they ask (5.4; owner, 05.10): assigning
 * opens the technician form, resolving and taking the technician off ask
 * first, reopening a resolved card goes at once. «В архив» (owner, 2026-11-26)
 * asks the question of the task's page and sends archive_problem, as it does.
 */
export function useBoardMoves(): BoardMoves {
  const { t } = useTranslation();
  const resolve = useResolveProblem();
  const unassign = useUnassignProblem();
  const reopen = useReopenProblem();
  const archive = useArchiveProblem();
  const [pending, setPending] = useState<PendingMove | null>(null);
  const [shown, setShown] = useState<PendingMove | null>(null);
  const [notice, setNotice] = useState<BoardNotice | null>(null);
  if (pending !== null && pending !== shown) {
    setShown(pending);
  }

  const failed = [resolve, unassign, reopen, archive].find((mutation) => mutation.isError);
  const say = (text: string | null) =>
    setNotice((last) => (text === null ? null : { text, count: (last?.count ?? 0) + 1 }));
  // The line shows the first mutation that failed, whenever it did: a new
  // action starts from a clean line, or an old refusal hides its answer.
  const clearOutcome = () => {
    resolve.reset();
    unassign.reset();
    reopen.reset();
    archive.reset();
  };
  // A request answers the question that sent it: a later one, opened while it
  // was on its way, is not the answer's to close.
  const closeIf = (asked: PendingMove) => () =>
    setPending((current) => (current === asked ? null : current));

  return {
    pending,
    shown,
    notice,
    failure: failed === undefined ? null : serverErrorText(failed.error),
    isResolving: resolve.isPending,
    resolveError: resolve.isError ? resolve.error : null,
    isUnassigning: unassign.isPending,
    isArchiving: archive.isPending,
    moveTo: (problem, status) => {
      clearOutcome();
      const move = cardMove(problem, status);
      say(null);
      if (move === 'reopen') {
        reopen.mutate(problem.id, { onSuccess: () => say(t('panel.problems.board.reopened')) });
      } else if (move !== null) {
        setPending({ kind: move, problem });
      }
    },
    askArchive: (problem) => {
      clearOutcome();
      say(null);
      setPending({ kind: 'archive', problem });
    },
    refuse: () => {
      clearOutcome();
      say(t('panel.problems.board.dragRefused'));
    },
    closePending: () => setPending(null),
    // The dialog closes once the server has answered: a refusal is shown in
    // the line under the board, which the open dialog would cover.
    confirmResolve: (choice) => {
      if (pending?.kind === 'resolve') {
        resolve.mutate(
          { problemId: pending.problem.id, ...choice },
          // What was typed and picked stays on a refusal; nothing added closes as before.
          choice.closing === null ? { onSettled: closeIf(pending) } : { onSuccess: closeIf(pending) },
        );
      }
    },
    // unassign_problem with the person the card showed (f969563): if the job
    // went to somebody else meanwhile, the server refuses.
    confirmUnassign: () => {
      const task = pending?.kind === 'unassign' ? liveFixTask(pending.problem) : null;
      if (pending !== null && task !== null) {
        unassign.mutate(
          { taskId: task.id, assigneeId: task.assignee_id },
          {
            onSuccess: () => say(t('panel.problems.board.unassigned')),
            onSettled: closeIf(pending),
          },
        );
      }
    },
    confirmArchive: () => {
      if (pending?.kind === 'archive') {
        const { problem } = pending;
        archive.mutate(problem.id, {
          onSuccess: () => say(t('panel.problems.board.archived', { title: problem.title })),
          onSettled: closeIf(pending),
        });
      }
    },
  };
}
