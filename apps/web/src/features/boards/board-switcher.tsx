'use client';

import { Archive, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  useId,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
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
import {
  defaultTabs,
  isSameOrder,
  MINE_TAB,
  moveTabBy,
  tabOrderAfterDrop,
  TECH_TAB,
  type TabSide,
} from './tab-order';
import { useBoards } from './use-boards';
import { slideOffset, useFlip } from './use-flip';
import { useBoardTabOrder } from './use-tab-order';

interface BoardSwitcherProps {
  /** The manager board open now; null for the technicians' board. */
  activeId: string | null;
}

interface Tab {
  id: string;
  href: string;
  label: string;
  isActive: boolean;
}

const PILL =
  'inline-flex min-h-11 max-w-64 items-center truncate rounded-full px-4 text-sm font-medium outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50';

/** The side of a tab the pointer is on, by where the tab stands in the layout (not where it slides). */
function sideOf(clientX: number, node: HTMLElement): TabSide {
  const rect = node.getBoundingClientRect();
  const middle = rect.left - slideOffset(node).x + rect.width / 2;
  return clientX < middle ? 'before' : 'after';
}

/**
 * The boards of «Задания», one click each: the technicians' board, «Назначено
 * мне» (the viewer's cards from every board) and every manager board of the
 * company that is not archived — in the person's own order (owner, 2026-11-26),
 * by default as before: those two first, then the boards oldest first. Then
 * «Новая доска» and «Архив досок», always last; the archived boards wait under
 * the latter, each opening read-only with «Вернуть доску».
 *
 * A tab is dragged to another place; the others slide aside as it goes, and
 * the row takes the new order when it is let go (Escape, or a drop outside the
 * row, leaves it as it was). From the keyboard: Space picks the focused tab up,
 * the arrows move it, Space or Enter puts it down, Escape puts it back. The
 * order shows at once and is saved to the person's account a moment later
 * (useBoardTabOrder); a save that fails brings the saved order back and says
 * so. A plain click still opens the board, and a drag never does. The row
 * breaks onto the next line when it is full, as every row of the panel.
 */
export function BoardSwitcher({ activeId }: BoardSwitcherProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const boards = useBoards();
  const [isCreating, setIsCreating] = useState(false);
  const hintId = useId();
  const all = boards.data ?? [];
  const live = all.filter((board) => board.archived_at === null);
  const archived = all.filter((board) => board.archived_at !== null);

  const tabs = new Map<string, Tab>([
    [
      TECH_TAB,
      {
        id: TECH_TAB,
        href: boardHref(null),
        label: t('boards.techBoard'),
        isActive: activeId === null,
      },
    ],
    [
      MINE_TAB,
      {
        id: MINE_TAB,
        href: boardHref(MY_CARDS),
        label: t('boards.assignedToMe'),
        isActive: activeId === MY_CARDS,
      },
    ],
    ...live.map(
      (board) =>
        [
          board.id,
          {
            id: board.id,
            href: boardHref(board.id),
            label: board.title,
            isActive: activeId === board.id,
          },
        ] as const,
    ),
  ]);
  const tabOrder = useBoardTabOrder(defaultTabs(live.map((board) => board.id)));
  // Until the boards are read an order of the two fixed tabs would drop every board from it.
  const canReorder = boards.data !== undefined;

  const [dragging, setDragging] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const nodes = useRef(new Map<string, HTMLElement>());
  // Set from a drag's start until just after its end: the click a browser may send then opens nothing.
  const justDragged = useRef(false);
  const pickedRef = useRef<string | null>(null);

  const shown = preview ?? tabOrder.order;
  useFlip(shown, nodes, dragging !== null || picked !== null);

  const place = (order: readonly string[], id: string) => ({
    name: tabs.get(id)?.label ?? '',
    position: order.indexOf(id) + 1,
    total: order.length,
  });

  const commit = (next: readonly string[]) => {
    if (!isSameOrder(next, tabOrder.order)) {
      tabOrder.change(next);
    }
  };

  const pick = (id: string | null) => {
    pickedRef.current = id;
    setPicked(id);
  };

  const endDrag = () => {
    setDragging(null);
    setPreview(null);
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
  };

  const startDrag = (event: DragEvent<HTMLAnchorElement>, id: string) => {
    if (!canReorder) {
      event.preventDefault();
      return;
    }
    // Firefox starts a drag only when something is set.
    event.dataTransfer?.setData('text/plain', id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
    }
    justDragged.current = true;
    pick(null);
    setDragging(id);
    setPreview(tabOrder.order);
  };

  const dragOverTab = (event: DragEvent<HTMLAnchorElement>, id: string) => {
    if (dragging === null) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    if (id === dragging) {
      return;
    }
    const node = nodes.current.get(id);
    const side = node === undefined ? 'after' : sideOf(event.clientX, node);
    setPreview((current) => {
      const base = current ?? tabOrder.order;
      const next = tabOrderAfterDrop(base, dragging, id, side);
      return isSameOrder(base, next) ? current : next;
    });
  };

  // The row takes the drop anywhere — between the tabs too; the order is the one the drag showed.
  const dragOverRow = (event: DragEvent<HTMLElement>) => {
    if (dragging !== null) {
      event.preventDefault();
    }
  };
  const dropOnRow = (event: DragEvent<HTMLElement>) => {
    if (dragging === null) {
      return;
    }
    event.preventDefault();
    const next = preview;
    const moved = dragging;
    endDrag();
    if (next !== null) {
      commit(next);
      setAnnouncement(t('boards.tabDropped', place(next, moved)));
    }
  };

  const clickTab = (event: MouseEvent<HTMLAnchorElement>) => {
    if (justDragged.current || pickedRef.current !== null) {
      event.preventDefault();
    }
  };

  const keyTab = (event: KeyboardEvent<HTMLAnchorElement>, id: string) => {
    if (!canReorder) {
      return;
    }
    if (picked === null) {
      if (event.key === ' ') {
        event.preventDefault();
        pick(id);
        setPreview(tabOrder.order);
        setAnnouncement(t('boards.tabPicked', place(tabOrder.order, id)));
      }
      return;
    }
    if (picked !== id) {
      return;
    }
    const base = preview ?? tabOrder.order;
    const moveTo = (next: string[]) => {
      event.preventDefault();
      setPreview(next);
      setAnnouncement(t('boards.tabMoved', place(next, id)));
    };
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowUp':
        moveTo(moveTabBy(base, id, -1));
        return;
      case 'ArrowRight':
      case 'ArrowDown':
        moveTo(moveTabBy(base, id, 1));
        return;
      case 'Home':
        moveTo(moveTabBy(base, id, -base.length));
        return;
      case 'End':
        moveTo(moveTabBy(base, id, base.length));
        return;
      case ' ':
      case 'Enter':
        event.preventDefault();
        pick(null);
        setPreview(null);
        commit(base);
        setAnnouncement(t('boards.tabDropped', place(base, id)));
        return;
      case 'Escape':
        event.preventDefault();
        pick(null);
        setPreview(null);
        setAnnouncement(t('boards.tabCancelled', place(tabOrder.order, id)));
        return;
      case 'Tab':
        pick(null);
        setPreview(null);
        return;
      default:
    }
  };

  // Focus that goes elsewhere puts a picked tab back. Checked a moment later: a tab that moves in
  // the row keeps its focus, but the browser may blur it on the way.
  const blurTab = (id: string) => {
    setTimeout(() => {
      if (pickedRef.current === id && document.activeElement !== nodes.current.get(id)) {
        pick(null);
        setPreview(null);
      }
    }, 0);
  };

  const pill = (tab: Tab) =>
    cn(
      PILL,
      tab.isActive
        ? 'bg-primary text-primary-foreground'
        : 'bg-card ring-1 ring-foreground/15 hover:bg-accent',
      dragging === tab.id && 'opacity-50',
      picked === tab.id && 'ring-3 ring-ring',
    );

  return (
    <div className="flex flex-col gap-1">
      <nav
        aria-label={t('boards.switcherLabel')}
        className="flex flex-wrap items-center gap-2"
        onDragOver={dragOverRow}
        onDrop={dropOnRow}
      >
        {shown.map((id) => {
          const tab = tabs.get(id);
          if (tab === undefined) {
            return null;
          }
          return (
            <Link
              key={id}
              ref={(node) => {
                if (node === null) {
                  nodes.current.delete(id);
                } else {
                  nodes.current.set(id, node);
                }
              }}
              href={tab.href}
              aria-current={tab.isActive ? 'page' : undefined}
              aria-describedby={canReorder ? hintId : undefined}
              draggable={canReorder}
              onDragStart={(event) => startDrag(event, id)}
              onDragOver={(event) => dragOverTab(event, id)}
              onDragEnd={endDrag}
              onClick={clickTab}
              onKeyDown={(event) => keyTab(event, id)}
              onBlur={() => blurTab(id)}
              className={pill(tab)}
              title={id === TECH_TAB || id === MINE_TAB ? undefined : tab.label}
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
        {announcement}
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
