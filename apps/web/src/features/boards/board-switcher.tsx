'use client';

import { Archive, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { boardHref } from './address';
import { BoardNameDialog } from './board-name-dialog';
import { useBoards } from './use-boards';

interface BoardSwitcherProps {
  /** The manager board open now; null for the technicians' board. */
  activeId: string | null;
}

const PILL =
  'inline-flex min-h-11 max-w-64 items-center truncate rounded-full px-4 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50';

/**
 * The boards of «Задания», one click each: the technicians' board first, as
 * it always was, then every manager board of the company that is not archived,
 * oldest first, and «Новая доска». The archived ones wait under «Архив досок»,
 * each opening read-only with «Вернуть доску».
 */
export function BoardSwitcher({ activeId }: BoardSwitcherProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const boards = useBoards();
  const [isCreating, setIsCreating] = useState(false);
  const all = boards.data ?? [];
  const live = all.filter((board) => board.archived_at === null);
  const archived = all.filter((board) => board.archived_at !== null);

  const pill = (isActive: boolean) =>
    cn(
      PILL,
      isActive
        ? 'bg-primary text-primary-foreground'
        : 'bg-card ring-1 ring-foreground/15 hover:bg-accent',
    );

  return (
    <nav aria-label={t('boards.switcherLabel')} className="flex flex-wrap items-center gap-2">
      <Link
        href={boardHref(null)}
        aria-current={activeId === null ? 'page' : undefined}
        className={pill(activeId === null)}
      >
        {t('boards.techBoard')}
      </Link>
      {live.map((board) => (
        <Link
          key={board.id}
          href={boardHref(board.id)}
          aria-current={activeId === board.id ? 'page' : undefined}
          className={pill(activeId === board.id)}
          title={board.title}
        >
          {board.title}
        </Link>
      ))}
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
      {isCreating ? (
        <BoardNameDialog
          onClose={() => setIsCreating(false)}
          onSaved={(boardId) => {
            setIsCreating(false);
            router.push(boardHref(boardId));
          }}
        />
      ) : null}
    </nav>
  );
}
