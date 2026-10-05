'use client';

import { useTranslation } from 'react-i18next';

import { useUnreadSubjects } from '@/features/chat/use-chat';

import { BoardColumn } from './board-column';
import { AssignMoveDialog, ConfirmMoveDialog } from './board-dialogs';
import { isDragMove } from './board-moves';
import { BOARD_STATUSES, liveFixTask, type Problem } from './schema';
import { useBoardDrag } from './use-board-drag';
import { useBoardMoves, type BoardMoves } from './use-board-moves';

interface ProblemsBoardProps {
  problems: Problem[];
  /** True while a search narrows the board: an empty column then says "nothing found". */
  isFiltered?: boolean;
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
 * is marked; let go anywhere else, it stays, and the line under the board
 * says the move is the menu's or the technician's.
 *
 * The four columns stay side by side and the board scrolls sideways inside
 * its frame on a narrow screen (decision 14).
 */
export function ProblemsBoard({ problems, isFiltered = false }: ProblemsBoardProps) {
  const unread = useUnreadSubjects();
  const moves = useBoardMoves();
  const drag = useBoardDrag({
    canMove: isDragMove,
    onMove: moves.moveTo,
    onRefused: moves.refuse,
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto pb-1">
        <div
          data-slot="problems-board"
          className="grid grid-cols-[repeat(4,minmax(16rem,1fr))] items-start gap-3"
        >
          {BOARD_STATUSES.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              problems={problems.filter((problem) => problem.status === status)}
              isFiltered={isFiltered}
              isDroppable={drag.isDroppable(status)}
              isOver={drag.isOver(status)}
              drop={drag.column(status)}
              drag={drag.card}
              onMove={moves.moveTo}
              unread={unread.problems}
            />
          ))}
        </div>
      </div>
      <BoardStatusLine moves={moves} />
      <BoardQuestions moves={moves} />
    </div>
  );
}

/**
 * The line under the board: a refusal, or what a move did, or how to move a
 * card. A sentence is written afresh each time (its key), so a screen reader
 * says even the same one again.
 */
function BoardStatusLine({ moves }: { moves: BoardMoves }) {
  const { t } = useTranslation();
  const { failure, notice } = moves;

  return (
    <p role="status" aria-live="polite" className="min-h-5 text-xs text-muted-foreground">
      {failure !== null ? (
        <span className="text-destructive">
          {failure.text}
          {failure.detail !== null ? ` (${failure.detail})` : ''}
        </span>
      ) : notice !== null ? (
        <span key={notice.count}>{notice.text}</span>
      ) : (
        t('panel.problems.board.dragHint')
      )}
    </p>
  );
}

/** The questions a move asks; their words stay while a dialog fades out. */
function BoardQuestions({ moves }: { moves: BoardMoves }) {
  const { t } = useTranslation();
  const { pending, shown } = moves;
  const asked = (kind: 'assign' | 'resolve' | 'unassign') =>
    shown?.kind === kind ? shown.problem : null;
  const resolving = asked('resolve');
  const unassigning = asked('unassign');

  return (
    <>
      <AssignMoveDialog
        open={pending?.kind === 'assign'}
        problem={asked('assign')}
        onClose={moves.closePending}
      />
      <ConfirmMoveDialog
        open={pending?.kind === 'resolve'}
        title={t('panel.problems.board.resolveTitle')}
        description={t('panel.problems.board.resolveText', { title: resolving?.title ?? '' })}
        confirmLabel={t('panel.problems.board.resolveConfirm')}
        abortLabel={t('panel.problems.board.resolveAbort')}
        isBusy={moves.isResolving}
        onConfirm={moves.confirmResolve}
        onClose={moves.closePending}
      />
      <ConfirmMoveDialog
        open={pending?.kind === 'unassign'}
        title={t('panel.problems.board.unassignTitle')}
        description={t('panel.problems.board.unassignText', {
          name:
            (unassigning === null ? null : liveFixTask(unassigning)?.assignee?.full_name) ??
            t('panel.problems.unknownPerson'),
          title: unassigning?.title ?? '',
        })}
        confirmLabel={t('panel.problems.board.unassignConfirm')}
        abortLabel={t('panel.problems.board.unassignAbort')}
        isDestructive
        isBusy={moves.isUnassigning}
        onConfirm={moves.confirmUnassign}
        onClose={moves.closePending}
      />
    </>
  );
}
