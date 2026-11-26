'use client';

import { useSearchParams } from 'next/navigation';

import { BOARD_PAGE_CLASS } from '@/components/board/board-viewport';
import { ProblemsView } from '@/features/problems/problems-view';

import { MY_CARDS, readBoardAddress } from './address';
import { BoardSwitcher } from './board-switcher';
import { ManagerBoardView } from './manager-board-view';
import { MyCardsView } from './my-cards-view';
import type { BoardViewer } from './schema';

interface ProblemsSectionProps {
  viewer: BoardViewer;
  /**
   * Whether the person has manager boards at all: the reception does not (the owner's request of
   * 2026-11-19) — the database shows her none either.
   */
  hasBoards?: boolean;
}

/**
 * «Задания» with its boards (owner, 2026-11-18): the switcher on top, then
 * the technicians' board as it always was — a bare `/problems` — or the
 * manager board the address names. The technicians' board, its views and its
 * address are untouched. Without boards, the technicians' board alone, under
 * any address: no switcher, no «Назначено мне». While a board shows, from `md`
 * up, the section is the window's height and the board takes what is left of
 * it (`BOARD_PAGE_CLASS`).
 */
export function ProblemsSection({ viewer, hasBoards = true }: ProblemsSectionProps) {
  const params = useSearchParams();
  const { boardId } = readBoardAddress(new URLSearchParams(params.toString()));

  if (!hasBoards) {
    return (
      <div className={BOARD_PAGE_CLASS}>
        <ProblemsView isAdmin={viewer.isAdmin} />
      </div>
    );
  }

  return (
    <div className={BOARD_PAGE_CLASS}>
      <BoardSwitcher activeId={boardId} />
      {boardId === null ? (
        <ProblemsView isAdmin={viewer.isAdmin} />
      ) : boardId === MY_CARDS ? (
        <MyCardsView viewer={viewer} />
      ) : (
        <ManagerBoardView key={boardId} boardId={boardId} viewer={viewer} />
      )}
    </div>
  );
}
