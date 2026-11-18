'use client';

import { useSearchParams } from 'next/navigation';

import { ProblemsView } from '@/features/problems/problems-view';

import { readBoardAddress } from './address';
import { BoardSwitcher } from './board-switcher';
import { ManagerBoardView } from './manager-board-view';
import type { BoardViewer } from './schema';

interface ProblemsSectionProps {
  viewer: BoardViewer;
}

/**
 * «Задания» with its boards (owner, 2026-11-18): the switcher on top, then
 * the technicians' board as it always was — a bare `/problems` — or the
 * manager board the address names. The technicians' board, its views and its
 * address are untouched.
 */
export function ProblemsSection({ viewer }: ProblemsSectionProps) {
  const params = useSearchParams();
  const { boardId } = readBoardAddress(new URLSearchParams(params.toString()));

  return (
    <div className="flex flex-col gap-4">
      <BoardSwitcher activeId={boardId} />
      {boardId === null ? (
        <ProblemsView />
      ) : (
        <ManagerBoardView key={boardId} boardId={boardId} viewer={viewer} />
      )}
    </div>
  );
}
