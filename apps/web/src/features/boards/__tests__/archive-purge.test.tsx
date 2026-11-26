import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  ADMIN,
  BOARD,
  OWNER,
  cardId,
  makeBoard,
  resetBoards,
  router,
  spies,
  state,
} from './fixtures';

/**
 * «Удалить навсегда» on the boards (owner, 2026-11-26; 20261126150000): only an admin, only what is
 * in an archive — the archived board, an archived or a deleted card — and only after a question
 * that says it cannot be undone.
 */

vi.mock('../use-boards', async () => (await import('./fixtures')).useBoardsModule);
vi.mock('@/features/tasks/use-tasks', () => ({ useProperties: () => ({ data: [] }) }));
vi.mock('@/lib/format-date', async (original) => ({
  ...(await original<typeof import('@/lib/format-date')>()),
  todayIso: () => '2026-11-18',
}));
vi.mock('next/navigation', async () => {
  const { useSyncExternalStore } = await import('react');
  const { router } = await import('./fixtures');
  const subscribe = (onChange: () => void) => {
    window.addEventListener('popstate', onChange);
    return () => window.removeEventListener('popstate', onChange);
  };
  return {
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(subscribe, () => window.location.search)),
    usePathname: () => window.location.pathname,
    useRouter: () => router,
  };
});

import { deleteArchivedBoard, deleteShelvedCard, type Client } from '../api';
import { ManagerBoardView } from '../manager-board-view';

type Viewer = { id: string; isAdmin: boolean };
const AS_OWNER: Viewer = { id: OWNER, isAdmin: false };
const AS_ADMIN: Viewer = { id: ADMIN, isAdmin: true };

const ARCHIVED = '2026-11-15T10:00:00Z';

function show(viewer: Viewer) {
  window.history.replaceState(null, '', `/problems?board=${BOARD}`);
  return render(<ManagerBoardView boardId={BOARD} viewer={viewer} />);
}

/** The row of a shelved card in the archive tab. */
const shelfRow = (title: string) =>
  screen.getByRole('link', { name: title }).closest('li') as HTMLElement;

async function openArchive(viewer: Viewer) {
  const user = userEvent.setup();
  show(viewer);
  await user.click(screen.getByRole('tab', { name: /Архив/ }));
  return user;
}

beforeEach(() => {
  resetBoards();
});

describe('an archived board', () => {
  test('an admin sees «Удалить доску навсегда»; its owner, a manager, does not', () => {
    state.boards = [makeBoard({ archived_at: ARCHIVED })];
    const { unmount } = show(AS_OWNER);
    expect(screen.getByRole('button', { name: 'Вернуть доску' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Удалить доску навсегда' })).toBeNull();
    unmount();

    show(AS_ADMIN);
    expect(screen.getByRole('button', { name: 'Удалить доску навсегда' })).toBeInTheDocument();
  });

  test('a live board offers no delete for good, even to an admin', () => {
    show(AS_ADMIN);
    expect(screen.queryByRole('button', { name: 'Удалить доску навсегда' })).toBeNull();
  });

  test('asks first, says it cannot be undone, and «Отмена» sends nothing', async () => {
    const user = userEvent.setup();
    state.boards = [makeBoard({ archived_at: ARCHIVED })];
    show(AS_ADMIN);

    await user.click(screen.getByRole('button', { name: 'Удалить доску навсегда' }));
    const dialog = screen.getByRole('dialog', { name: 'Удалить доску навсегда' });
    expect(dialog).toHaveTextContent('Доска «Проекты» удалится вместе со всеми карточками');
    expect(dialog).toHaveTextContent('Отменить это нельзя.');
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }));

    expect(spies.purgeBoard).not.toHaveBeenCalled();
  });

  test('confirmed, the board is deleted, forgotten and left for the technicians’ board', async () => {
    const user = userEvent.setup();
    state.boards = [makeBoard({ archived_at: ARCHIVED })];
    show(AS_ADMIN);

    await user.click(screen.getByRole('button', { name: 'Удалить доску навсегда' }));
    await user.click(screen.getByRole('button', { name: 'Да, удалить навсегда' }));

    expect(spies.purgeBoard).toHaveBeenCalledWith(BOARD);
    expect(spies.forget).toHaveBeenCalledWith(BOARD);
    expect(router.push).toHaveBeenCalledWith('/problems');
  });

  test('a refusal stays on the board and says why, in the reader’s words', async () => {
    const user = userEvent.setup();
    state.boards = [makeBoard({ archived_at: ARCHIVED })];
    state.refusals.set(spies.purgeBoard, {
      message: 'Only an admin may delete for good',
      hint: 'serverErrors.archivePurgeAdminOnly',
    });
    show(AS_ADMIN);

    await user.click(screen.getByRole('button', { name: 'Удалить доску навсегда' }));
    await user.click(screen.getByRole('button', { name: 'Да, удалить навсегда' }));

    expect(router.push).not.toHaveBeenCalled();
    expect(spies.forget).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent('Удалить навсегда может только админ');
  });
});

describe('the cards in the archive', () => {
  test('an admin has «Удалить навсегда» on an archived and on a deleted card', async () => {
    await openArchive(AS_ADMIN);
    for (const title of ['Старый проект', 'Ошибочная']) {
      expect(
        within(shelfRow(title)).getByRole('button', { name: 'Удалить навсегда' }),
      ).toBeInTheDocument();
    }
  });

  test('a manager, the board’s owner included, has «Вернуть» alone', async () => {
    await openArchive(AS_OWNER);
    for (const title of ['Старый проект', 'Ошибочная']) {
      const row = shelfRow(title);
      expect(within(row).getByRole('button', { name: 'Вернуть' })).toBeInTheDocument();
      expect(within(row).queryByRole('button', { name: 'Удалить навсегда' })).toBeNull();
    }
  });

  test('asks first, naming the card; confirmed, deletes that card and says so', async () => {
    const user = await openArchive(AS_ADMIN);

    await user.click(
      within(shelfRow('Старый проект')).getByRole('button', { name: 'Удалить навсегда' }),
    );
    const dialog = screen.getByRole('dialog', { name: 'Удалить карточку навсегда?' });
    expect(dialog).toHaveTextContent(
      'Карточка «Старый проект» удалится вместе с шагами и журналом. Отменить это нельзя.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Да, удалить навсегда' }));

    expect(spies.purgeCard).toHaveBeenCalledWith(cardId(4));
    expect(spies.shelve).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Карточка удалена навсегда · Старый проект',
    );
  });

  test('«Отмена» sends nothing', async () => {
    const user = await openArchive(AS_ADMIN);

    await user.click(
      within(shelfRow('Ошибочная')).getByRole('button', { name: 'Удалить навсегда' }),
    );
    await user.click(
      within(screen.getByRole('dialog', { name: 'Удалить карточку навсегда?' })).getByRole(
        'button',
        { name: 'Отмена' },
      ),
    );

    expect(spies.purgeCard).not.toHaveBeenCalled();
  });

  test('a card on the board is refused by the server in the reader’s words', async () => {
    state.refusals.set(spies.purgeCard, {
      message: 'Card is neither archived nor deleted',
      hint: 'serverErrors.boardCardNotShelved',
    });
    const user = await openArchive(AS_ADMIN);

    await user.click(
      within(shelfRow('Ошибочная')).getByRole('button', { name: 'Удалить навсегда' }),
    );
    await user.click(screen.getByRole('button', { name: 'Да, удалить навсегда' }));

    expect(screen.getByRole('status')).toHaveTextContent(
      'Карточка на доске — навсегда удаляется только карточка из архива или удалённых',
    );
  });
});

describe('what the panel sends', () => {
  test('the board and the card by their ids; true when deleted, false when gone', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });
    const client = { rpc } as unknown as Client;

    expect(await deleteArchivedBoard(client, BOARD)).toBe(true);
    expect(await deleteShelvedCard(client, cardId(4))).toBe(false);
    expect(rpc.mock.calls).toEqual([
      ['delete_archived_board', { p_id: BOARD }],
      ['delete_shelved_board_card', { p_id: cardId(4) }],
    ]);
  });
});
