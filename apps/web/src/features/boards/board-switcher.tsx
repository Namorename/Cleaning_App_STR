'use client';

import { Archive, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { boardHref, MY_CARDS } from './address';
import { BoardNameDialog } from './board-name-dialog';
import type { Board } from './schema';
import { defaultTabs, MINE_TAB, TECH_TAB } from './tab-order';
import { useBoards } from './use-boards';
import { useTabReorder } from './use-tab-reorder';
import { useBoardTabOrder } from './use-tab-order';

interface BoardSwitcherProps {
  /** The manager board open now; null for the technicians' board. */
  activeId: string | null;
  /** Whose order of the tabs the row shows (20261126160000). */
  viewerId: string;
}

interface Tab {
  href: string;
  label: string;
  /** A board's own title, in full on hover; the two fixed tabs need none. */
  title?: string;
  isActive: boolean;
}

const PILL =
  'inline-flex min-h-11 max-w-64 items-center truncate rounded-full px-4 text-sm font-medium outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50';

/** Every tab of the row by its id: the two fixed ones and the live boards. */
function tabsOf(
  live: readonly Board[],
  activeId: string | null,
  names: { tech: string; mine: string },
): Map<string, Tab> {
  return new Map<string, Tab>([
    [TECH_TAB, { href: boardHref(null), label: names.tech, isActive: activeId === null }],
    [MINE_TAB, { href: boardHref(MY_CARDS), label: names.mine, isActive: activeId === MY_CARDS }],
    ...live.map(
      (board) =>
        [
          board.id,
          {
            href: boardHref(board.id),
            label: board.title,
            title: board.title,
            isActive: activeId === board.id,
          },
        ] as const,
    ),
  ]);
}

/**
 * The boards of «Задания», one click each: the technicians' board, «Назначено
 * мне» (the viewer's cards from every board) and every manager board of the
 * company that is not archived — in the person's own order (owner, 2026-11-26;
 * useBoardTabOrder), by default as before: those two first, then the boards
 * oldest first. Then «Новая доска» and «Архив досок», always last; the archived
 * boards wait under the latter, each opening read-only with «Вернуть доску».
 *
 * The tabs are dragged, or moved from the keyboard, into another order
 * (useTabReorder) once the boards and her order are read; a save that fails
 * brings the saved order back and says so. The row breaks onto the next line
 * when it is full, as every row of the panel.
 */
export function BoardSwitcher({ activeId, viewerId }: BoardSwitcherProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const boards = useBoards();
  const [isCreating, setIsCreating] = useState(false);
  const hintId = useId();
  const all = boards.data ?? [];
  const live = all.filter((board) => board.archived_at === null);
  const archived = all.filter((board) => board.archived_at !== null);

  const tabs = tabsOf(live, activeId, {
    tech: t('boards.techBoard'),
    mine: t('boards.assignedToMe'),
  });
  const tabOrder = useBoardTabOrder(viewerId, defaultTabs(live.map((board) => board.id)));
  // Until the boards are read an order of the two fixed tabs would drop every board from it.
  const canReorder = boards.data !== undefined && tabOrder.isReady;
  const reorder = useTabReorder({
    order: tabOrder.order,
    canReorder,
    labelOf: (id) => tabs.get(id)?.label ?? '',
    onChange: tabOrder.change,
  });

  return (
    <div className="flex flex-col gap-1">
      <nav
        aria-label={t('boards.switcherLabel')}
        className="flex flex-wrap items-center gap-2"
        {...reorder.row}
      >
        {reorder.shown.map((id) => {
          const tab = tabs.get(id);
          if (tab === undefined) {
            return null;
          }
          return (
            <Link
              key={id}
              ref={(node) => {
                if (node === null) {
                  reorder.nodes.current.delete(id);
                } else {
                  reorder.nodes.current.set(id, node);
                }
              }}
              href={tab.href}
              aria-current={tab.isActive ? 'page' : undefined}
              aria-describedby={canReorder ? hintId : undefined}
              {...reorder.tab(id)}
              className={cn(
                PILL,
                tab.isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card ring-1 ring-foreground/15 hover:bg-accent',
                reorder.dragging === id && 'opacity-50',
                reorder.picked === id && 'ring-3 ring-ring',
              )}
              title={tab.title}
            >
              <span className="truncate">{tab.label}</span>
            </Link>
          );
        })}
        <Button
          type="button"
          variant="ghost"
          className="h-11 rounded-full"
          onClick={() => setIsCreating(true)}
        >
          <Plus aria-hidden="true" />
          {t('boards.newBoard')}
        </Button>
        {archived.length === 0 ? null : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button type="button" variant="ghost" className="h-11 rounded-full" />}
            >
              <Archive aria-hidden="true" />
              {t('boards.archivedBoards')}
              <span className="text-xs text-muted-foreground tabular-nums">{archived.length}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {archived.map((board) => (
                <DropdownMenuItem key={board.id} onClick={() => router.push(boardHref(board.id))}>
                  {board.title}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>
      <span id={hintId} className="sr-only">
        {t('boards.tabOrderHint')}
      </span>
      <p role="status" aria-live="polite" className="sr-only">
        {reorder.announcement}
      </p>
      {tabOrder.failure === null ? null : (
        <p role="alert" className="text-sm text-destructive">
          {t('boards.tabOrderSaveError')}{' '}
          <span className="text-xs text-muted-foreground">
            {tabOrder.failure.text}
            {tabOrder.failure.detail === null ? '' : ` (${tabOrder.failure.detail})`}
          </span>
        </p>
      )}
      {isCreating ? (
        <BoardNameDialog
          onClose={() => setIsCreating(false)}
          onSaved={(boardId) => {
            setIsCreating(false);
            router.push(boardHref(boardId));
          }}
        />
      ) : null}
    </div>
  );
}
