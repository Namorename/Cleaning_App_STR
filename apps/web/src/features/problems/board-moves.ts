import { BOARD_STATUSES, boardMove, liveFixTask, type BoardStatus, type Problem } from './schema';

/** A move the manager makes on the board, by the menu «⋯» or by the mouse. */
export type CardMove = 'assign' | 'resolve' | 'unassign' | 'reopen';

/**
 * What moving this card to a column means, or null where the manager makes
 * no move: as `boardMove`, without the technician's own column («В работе»
 * is his phone's), and without taking off a technician a stale row no
 * longer has a live job for.
 */
export function cardMove(problem: Problem, to: BoardStatus): CardMove | null {
  const move = boardMove(problem.status, to);
  if (move === null || move === 'startOnPhone') {
    return null;
  }
  return move === 'unassign' && liveFixTask(problem) === null ? null : move;
}

/** The columns a card's menu offers: every move the manager can make from here. */
export function menuMoves(problem: Problem): BoardStatus[] {
  return BOARD_STATUSES.filter((status) => cardMove(problem, status) !== null);
}

/**
 * The moves a card makes by mouse (owner, 05.10): an open task to «Назначено»,
 * and an assigned one back to «Открыто». The mouse is an addition to the menu
 * «⋯», which makes every move — from the keyboard and on a touch screen too.
 */
export function isDragMove(problem: Problem, to: BoardStatus): boolean {
  const move = cardMove(problem, to);
  return move === 'assign' || (move === 'unassign' && problem.status === 'assigned');
}
